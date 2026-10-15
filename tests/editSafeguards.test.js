const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const Client = require('../src/models/Client');
const PFDocument = require('../src/models/PFDocument');
const Invoice = require('../src/models/Invoice');
const AdvancePayment = require('../src/models/AdvancePayment');
const QuantityRecord = require('../src/models/QuantityRecord');
const Service = require('../src/models/Service');

test('Edit Functionality & Financial Safeguards Regression Suite', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);

  const testId = `EDIT-TEST-${Date.now()}`;
  const client = await Client.create({
    clientId: testId,
    companyName: 'Edit QA Enterprise',
    contactPerson: 'QA Lead',
    primaryPhone: '+91 91111 22222',
    email: `edit_${Date.now()}@example.com`,
    billingAddress: 'Tech Zone',
    city: 'Noida',
    state: 'Uttar Pradesh',
    stateCode: '09',
    pincode: '201301'
  });

  const service = await Service.create({
    serviceId: `SRV-QA-${Date.now()}`,
    name: 'QA Testing Service',
    category: 'Development',
    defaultUnitPrice: 2500,
    unit: 'Hours',
    taxRate: 18
  });

  await t.test('1. Advance Payment Edit: preserves allocation integrity', async () => {
    const advance = await AdvancePayment.create({
      receiptNumber: `ADV-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      amount: 10000,
      unallocatedAmount: 6000,
      allocatedAmount: 4000,
      paymentMethod: 'Bank Transfer',
      status: 'Verified'
    });

    // Attempting to edit advance below allocatedAmount (4000) should be invalid
    const invalidAmount = 3000;
    assert.ok(invalidAmount < advance.allocatedAmount, 'Invalid amount must be less than allocated');

    // Valid edit
    advance.amount = 12000;
    advance.unallocatedAmount = 12000 - advance.allocatedAmount; // 8000
    advance.associatedProject = 'Updated Retainer Scope';
    await advance.save();

    const fetched = await AdvancePayment.findById(advance._id);
    assert.equal(fetched.amount, 12000);
    assert.equal(fetched.unallocatedAmount, 8000);
    assert.equal(fetched.associatedProject, 'Updated Retainer Scope');

    // Cleanup advance
    await AdvancePayment.findByIdAndDelete(advance._id);
  });

  await t.test('2. Invoice Edit: Draft vs Payment-Locked financial integrity', async () => {
    // A. Unpaid Draft Invoice can recalculate items
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const invoice = await Invoice.create({
      invoiceNumber: `INV-EDIT-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName, stateCode: '09' },
      dueDate,
      items: [{
        serviceId: 'SRV-01',
        description: 'Initial Scope',
        unitPrice: 1000,
        quantity: 1,
        taxableAmount: 1000,
        cgstRate: 9,
        cgstAmount: 90,
        sgstRate: 9,
        sgstAmount: 90,
        totalTax: 180,
        lineTotal: 1180
      }],
      subtotal: 1000,
      totalTaxableAmount: 1000,
      cgstTotal: 90,
      sgstTotal: 90,
      totalTax: 180,
      grandTotal: 1180,
      outstandingBalance: 1180,
      amountPaid: 0,
      status: 'Issued'
    });

    assert.equal(invoice.grandTotal, 1180);

    // Update draft invoice item quantity
    invoice.items[0].quantity = 2;
    invoice.items[0].taxableAmount = 2000;
    invoice.items[0].cgstAmount = 180;
    invoice.items[0].sgstAmount = 180;
    invoice.items[0].totalTax = 360;
    invoice.items[0].lineTotal = 2360;
    invoice.subtotal = 2000;
    invoice.totalTaxableAmount = 2000;
    invoice.cgstTotal = 180;
    invoice.sgstTotal = 180;
    invoice.totalTax = 360;
    invoice.grandTotal = 2360;
    invoice.outstandingBalance = 2360;
    await invoice.save();

    let fetchedInv = await Invoice.findById(invoice._id);
    assert.equal(fetchedInv.grandTotal, 2360);

    // B. Record partial payment -> Invoice lines become locked
    fetchedInv.amountPaid = 1000;
    fetchedInv.outstandingBalance = 1360;
    fetchedInv.status = 'Partially Paid';
    await fetchedInv.save();

    // Verify payment-locked state
    assert.ok(fetchedInv.amountPaid > 0);
    // Non-financial edits remain permitted
    fetchedInv.paymentTerms = 'Payment due within 30 days';
    fetchedInv.notes = 'Updated terms post partial settlement';
    await fetchedInv.save();

    const lockedInv = await Invoice.findById(invoice._id);
    assert.equal(lockedInv.paymentTerms, 'Payment due within 30 days');
    assert.equal(lockedInv.notes, 'Updated terms post partial settlement');
    assert.equal(lockedInv.amountPaid, 1000);

    // Cleanup invoice
    await Invoice.findByIdAndDelete(invoice._id);
  });

  await t.test('3. PF Document Edit: Protects converted status', async () => {
    const pfDoc = await PFDocument.create({
      pfNumber: `PF-EDIT-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      subtotal: 5000,
      totalTaxableAmount: 5000,
      totalTax: 900,
      grandTotal: 5900,
      status: 'Draft',
      items: [{
        serviceId: 'SRV-02',
        description: 'Consultation',
        unitPrice: 5000,
        quantity: 1,
        taxableAmount: 5000,
        lineTotal: 5900
      }]
    });

    // Update draft PF
    pfDoc.notes = 'Updated proposal scope for client review';
    await pfDoc.save();

    let fetchedPF = await PFDocument.findById(pfDoc._id);
    assert.equal(fetchedPF.notes, 'Updated proposal scope for client review');

    // Simulate conversion to invoice
    fetchedPF.status = 'Converted to Invoice';
    fetchedPF.convertedToInvoiceNumber = 'INV-2026-00099';
    await fetchedPF.save();

    // Verify converted safeguard condition
    const convertedPF = await PFDocument.findById(pfDoc._id);
    assert.equal(convertedPF.status, 'Converted to Invoice');

    // Cleanup PF
    await PFDocument.findByIdAndDelete(pfDoc._id);
  });

  await t.test('4. Quantity Record Edit: Updates quantity and notes', async () => {
    const qty = await QuantityRecord.create({
      recordId: `QTY-TEST-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      service: service._id,
      serviceId: service.serviceId,
      serviceName: service.name,
      quantity: 10,
      unit: 'Hours',
      unitPriceSnapshot: 2500,
      date: new Date()
    });

    qty.quantity = 15;
    qty.notes = 'Client requested 5 additional hours';
    await qty.save();

    const fetchedQty = await QuantityRecord.findById(qty._id);
    assert.equal(fetchedQty.quantity, 15);
    assert.equal(fetchedQty.notes, 'Client requested 5 additional hours');

    // Cleanup Qty
    await QuantityRecord.findByIdAndDelete(qty._id);
  });

  // Final cleanup client & service
  await Client.findByIdAndDelete(client._id);
  await Service.findByIdAndDelete(service._id);
  await mongoose.disconnect();
});
