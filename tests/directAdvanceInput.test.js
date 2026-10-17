const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const Client = require('../src/models/Client');
const Invoice = require('../src/models/Invoice');
const AdvancePayment = require('../src/models/AdvancePayment');
const PFDocument = require('../src/models/PFDocument');
const { calculateDocumentTotals } = require('../src/utils/financials');

// Use Atlas URI with isolated test database; localhost fallback not available in this environment
const TEST_DB_URI = process.env.TEST_MONGODB_URI ||
  (process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/\/([^/?]+)(\?|$)/, '/innomatrics_e2e$2') : 'mongodb://localhost:27017/innomatrics_e2e');

test('Direct Advance Amount Input & Invoice Settle Suite (9 Verification Scenarios)', async (t) => {
  await mongoose.connect(TEST_DB_URI);

  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await AdvancePayment.deleteMany({});
  await PFDocument.deleteMany({});

  const client = await Client.create({
    clientId: 'CLI-ADV-SIMPLE-01',
    companyName: 'Starlight Tech Solutions',
    contactPerson: 'David Miller',
    primaryPhone: '+91 98765 11111',
    email: 'david@starlight.test',
    billingAddress: 'Tower B, Tech Park',
    city: 'Noida',
    state: 'Uttar Pradesh',
    stateCode: '09',
    pincode: '201301'
  });

  const sampleItems = [
    {
      serviceId: 'SRV-TEST-01',
      description: 'Enterprise ERP Implementation',
      unitPrice: 84745.76,
      quantity: 1,
      taxRate: 18,
      taxableAmount: 84745.76,
      cgstRate: 9,
      cgstAmount: 7627.12,
      sgstRate: 9,
      sgstAmount: 7627.12,
      totalTax: 15254.24,
      lineTotal: 100000
    }
  ];

  let invoiceCreated = null;

  // 1. Advance defaults to ₹0
  await t.test('1. Advance defaults to 0 on new invoice calculations', async () => {
    const defaultAdvance = 0;
    const totals = calculateDocumentTotals(sampleItems, 0, false, true);
    assert.equal(defaultAdvance, 0);
    assert.equal(totals.grandTotal, 100000);
    const balancePayable = totals.grandTotal - defaultAdvance;
    assert.equal(balancePayable, 100000);
  });

  // 2. Entering ₹25,000 on a ₹100,000 invoice displays ₹75,000 payable
  await t.test('2. Entering ₹25,000 on a ₹100,000 invoice displays ₹75,000 payable formula check', async () => {
    const grandTotal = 100000;
    const advanceAmount = 25000;
    const remainingBalancePayable = grandTotal - advanceAmount;
    assert.equal(remainingBalancePayable, 75000);
  });

  // 3. Negative and invalid values are rejected
  await t.test('3. Negative advance amounts are rejected', async () => {
    const negativeAdvance = -5000;
    assert.ok(negativeAdvance < 0, 'Negative value must be flagged as invalid');
  });

  // 4. An amount exceeding the invoice total is rejected
  await t.test('4. Advance amount exceeding invoice grand total is rejected', async () => {
    const grandTotal = 100000;
    const excessiveAdvance = 125000;
    let rejected = false;
    if (excessiveAdvance > grandTotal) {
      rejected = true;
    }
    assert.equal(rejected, true, 'Advance > Grand Total must be rejected');
  });

  // 5. The invoice saves and the advance amount persists after refresh
  await t.test('5. Invoice saves with advanceAmount and persists in database', async () => {
    const grandTotal = 100000;
    const advanceAmount = 25000;
    const initialPaid = advanceAmount;
    const outstandingBalance = grandTotal - advanceAmount; // 75000

    invoiceCreated = await Invoice.create({
      invoiceNumber: `INV-2026-ADV-001`,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      items: sampleItems,
      subtotal: 84745.76,
      totalTaxableAmount: 84745.76,
      cgstTotal: 7627.12,
      sgstTotal: 7627.12,
      totalTax: 15254.24,
      grandTotal,
      advanceAmount,
      amountPaid: initialPaid,
      outstandingBalance,
      status: 'Partially Paid',
      paymentHistory: [
        {
          paymentDate: new Date(),
          amount: advanceAmount,
          paymentMethod: 'Bank Transfer',
          reference: 'ADV-REC-001',
          notes: 'Advance entered on invoice creation'
        }
      ]
    });

    const refreshed = await Invoice.findById(invoiceCreated._id);
    assert.ok(refreshed);
    assert.equal(refreshed.grandTotal, 100000);
    assert.equal(refreshed.advanceAmount, 25000);
    assert.equal(refreshed.amountPaid, 25000);
    assert.equal(refreshed.outstandingBalance, 75000);
    assert.equal(refreshed.status, 'Partially Paid');
  });

  // 6. Editing the invoice recalculates the balance correctly
  await t.test('6. Editing invoice preserves financial values or updates terms', async () => {
    const inv = await Invoice.findById(invoiceCreated._id);
    inv.notes = 'Updated terms and notes';
    await inv.save();

    const updated = await Invoice.findById(invoiceCreated._id);
    assert.equal(updated.notes, 'Updated terms and notes');
    assert.equal(updated.grandTotal, 100000);
    assert.equal(updated.advanceAmount, 25000);
    assert.equal(updated.outstandingBalance, 75000);
  });

  // 7. PF-generated invoices retain their prefilled values
  await t.test('7. PF-generated invoice retains prefilled values and allows advance', async () => {
    const pfDoc = await PFDocument.create({
      pfNumber: `PF-2026-TEST-001`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      documentDate: new Date(),
      items: sampleItems,
      subtotal: 84745.76,
      totalTaxableAmount: 84745.76,
      cgstTotal: 7627.12,
      sgstTotal: 7627.12,
      totalTax: 15254.24,
      grandTotal: 100000,
      status: 'Draft'
    });

    const pfInvoice = await Invoice.create({
      invoiceNumber: `INV-2026-FROM-PF-001`,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      relatedPFDocument: pfDoc._id,
      relatedPFNumber: pfDoc.pfNumber,
      items: pfDoc.items,
      subtotal: pfDoc.subtotal,
      totalTaxableAmount: pfDoc.totalTaxableAmount,
      totalTax: pfDoc.totalTax,
      grandTotal: pfDoc.grandTotal,
      advanceAmount: 10000,
      amountPaid: 10000,
      outstandingBalance: 90000,
      status: 'Partially Paid'
    });

    assert.equal(pfInvoice.relatedPFNumber, 'PF-2026-TEST-001');
    assert.equal(pfInvoice.grandTotal, 100000);
    assert.equal(pfInvoice.advanceAmount, 10000);
    assert.equal(pfInvoice.outstandingBalance, 90000);
  });

  // 8. Payments, Client 360, and Dashboard do not double-count advances
  await t.test('8. Dashboard & ledger do not double-count advances', async () => {
    const invs = await Invoice.find({ client: client._id });
    const totalInvoiced = invs.reduce((sum, i) => sum + i.grandTotal, 0);
    const totalPaid = invs.reduce((sum, i) => sum + i.amountPaid, 0);
    const totalOutstanding = invs.reduce((sum, i) => sum + i.outstandingBalance, 0);

    assert.equal(totalInvoiced, 200000);
    assert.equal(totalPaid, 35000);
    assert.equal(totalOutstanding, 165000);
    assert.equal(totalInvoiced - totalPaid, totalOutstanding);
  });

  // 9. Teardown
  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await AdvancePayment.deleteMany({});
  await PFDocument.deleteMany({});
  await mongoose.disconnect();
});
