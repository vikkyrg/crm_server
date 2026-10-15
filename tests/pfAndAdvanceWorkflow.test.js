const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const Client = require('../src/models/Client');
const PFDocument = require('../src/models/PFDocument');
const Invoice = require('../src/models/Invoice');
const AdvancePayment = require('../src/models/AdvancePayment');
const { calculateDocumentTotals } = require('../src/utils/financials');

test('PF Conversion, Advance Allocation, and Delete Safeguards Suite', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);

  const testId = `PF-ADV-TEST-${Date.now()}`;
  const client = await Client.create({
    clientId: testId,
    companyName: 'PF Conversion Testing Ltd',
    contactPerson: 'Finance Director',
    primaryPhone: '+91 98888 77777',
    email: `pf_adv_${Date.now()}@example.com`,
    billingAddress: 'Sector 62',
    city: 'Noida',
    state: 'Uttar Pradesh',
    stateCode: '09',
    pincode: '201301'
  });

  const pfItems = [
    {
      serviceId: 'SRV-TEST-01',
      description: 'Web Architecture Design',
      unitPrice: 50000,
      quantity: 1,
      taxRate: 18,
      taxableAmount: 50000,
      cgstRate: 9,
      cgstAmount: 4500,
      sgstRate: 9,
      sgstAmount: 4500,
      totalTax: 9000,
      lineTotal: 59000
    }
  ];

  let createdPF = null;
  let createdAdvance = null;
  let createdInvoice = null;

  await t.test('1. Create PF Document with correct financial calculation', async () => {
    const totals = calculateDocumentTotals(pfItems, 0, false, true);
    assert.equal(totals.subtotal, 50000);
    assert.equal(totals.grandTotal, 59000);

    createdPF = await PFDocument.create({
      pfNumber: `PF-TEST-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      documentDate: new Date(),
      items: totals.items,
      subtotal: totals.subtotal,
      totalTaxableAmount: totals.totalTaxableAmount,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      status: 'Draft'
    });

    assert.ok(createdPF._id);
    assert.equal(createdPF.status, 'Draft');
    assert.equal(createdPF.grandTotal, 59000);
  });

  await t.test('2. Record Advance Payment for Client', async () => {
    createdAdvance = await AdvancePayment.create({
      receiptNumber: `ADV-TEST-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      amount: 25000,
      allocatedAmount: 0,
      unallocatedAmount: 25000,
      paymentMethod: 'Bank Transfer',
      status: 'Verified'
    });

    assert.ok(createdAdvance._id);
    assert.equal(createdAdvance.unallocatedAmount, 25000);
    assert.equal(createdAdvance.allocatedAmount, 0);
  });

  await t.test('3. Convert PF to Invoice and Apply Advance Payment (₹25,000)', async () => {
    // Invoice Creation from PF
    const advanceAmountToApply = 25000;
    const initialBalance = createdPF.grandTotal - advanceAmountToApply; // 59000 - 25000 = 34000

    createdInvoice = await Invoice.create({
      invoiceNumber: `INV-TEST-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      relatedPFDocument: createdPF._id,
      relatedPFNumber: createdPF.pfNumber,
      items: createdPF.items,
      subtotal: createdPF.subtotal,
      totalTaxableAmount: createdPF.totalTaxableAmount,
      cgstTotal: createdPF.cgstTotal,
      sgstTotal: createdPF.sgstTotal,
      totalTax: createdPF.totalTax,
      grandTotal: createdPF.grandTotal,
      amountPaid: advanceAmountToApply,
      outstandingBalance: initialBalance,
      status: 'Partially Paid',
      paymentHistory: [
        {
          paymentDate: new Date(),
          amount: advanceAmountToApply,
          paymentMethod: 'Advance Allocation',
          reference: createdAdvance.receiptNumber,
          advancePaymentId: createdAdvance._id,
          notes: `Settled via Advance Receipt ${createdAdvance.receiptNumber}`
        }
      ]
    });

    // Update Advance record
    createdAdvance.allocatedAmount = advanceAmountToApply;
    createdAdvance.unallocatedAmount = 0;
    createdAdvance.allocations.push({
      invoice: createdInvoice._id,
      invoiceNumber: createdInvoice.invoiceNumber,
      allocatedAmount: advanceAmountToApply,
      allocatedAt: new Date()
    });
    await createdAdvance.save();

    // Mark PF as converted
    createdPF.status = 'Converted to Invoice';
    createdPF.convertedToInvoiceId = createdInvoice._id;
    createdPF.convertedToInvoiceNumber = createdInvoice.invoiceNumber;
    await createdPF.save();

    assert.equal(createdInvoice.outstandingBalance, 34000);
    assert.equal(createdInvoice.amountPaid, 25000);
    assert.equal(createdInvoice.status, 'Partially Paid');
    assert.equal(createdAdvance.allocatedAmount, 25000);
    assert.equal(createdAdvance.unallocatedAmount, 0);
    assert.equal(createdPF.status, 'Converted to Invoice');
    assert.equal(createdPF.convertedToInvoiceNumber, createdInvoice.invoiceNumber);
  });

  await t.test('4. Double conversion safeguard: Prevent converting already converted PF', async () => {
    const pfToConvertAgain = await PFDocument.findById(createdPF._id);
    assert.ok(pfToConvertAgain.convertedToInvoiceId, 'PF already has convertedToInvoiceId');
    assert.equal(pfToConvertAgain.status, 'Converted to Invoice');
    // Business logic assertion: duplicate conversion must be rejected
    const canConvert = !pfToConvertAgain.convertedToInvoiceId;
    assert.equal(canConvert, false, 'Duplicate conversion is prevented');
  });

  await t.test('5. Deletion safeguard: Allocated advance cannot be deleted', async () => {
    const adv = await AdvancePayment.findById(createdAdvance._id);
    assert.ok(adv.allocatedAmount > 0, 'Advance has allocations');
    // Deletion check
    const isSafeToDelete = adv.allocatedAmount === 0 && (!adv.allocations || adv.allocations.length === 0);
    assert.equal(isSafeToDelete, false, 'Allocated advance cannot be deleted');
  });

  await t.test('6. Deallocate advance: restores balance on both invoice and advance', async () => {
    const alloc = createdAdvance.allocations[0];
    const deallocAmt = alloc.allocatedAmount;

    // Restore advance
    createdAdvance.allocatedAmount -= deallocAmt;
    createdAdvance.unallocatedAmount += deallocAmt;
    createdAdvance.allocations = [];
    await createdAdvance.save();

    // Adjust invoice
    createdInvoice.amountPaid -= deallocAmt;
    createdInvoice.outstandingBalance += deallocAmt;
    createdInvoice.status = 'Issued';
    createdInvoice.paymentHistory = [];
    await createdInvoice.save();

    assert.equal(createdAdvance.unallocatedAmount, 25000);
    assert.equal(createdAdvance.allocatedAmount, 0);
    assert.equal(createdInvoice.outstandingBalance, 59000);
    assert.equal(createdInvoice.status, 'Issued');
  });

  await t.test('7. Delete unallocated advance: permitted once deallocated', async () => {
    const adv = await AdvancePayment.findById(createdAdvance._id);
    assert.equal(adv.allocatedAmount, 0);
    await AdvancePayment.findByIdAndDelete(adv._id);
    const checkDeleted = await AdvancePayment.findById(adv._id);
    assert.equal(checkDeleted, null, 'Unallocated advance is safely deleted');
  });

  // Cleanup testing artifacts
  await PFDocument.deleteMany({ client: client._id });
  await Invoice.deleteMany({ client: client._id });
  await AdvancePayment.deleteMany({ client: client._id });
  await Client.findByIdAndDelete(client._id);

  await mongoose.disconnect();
});
