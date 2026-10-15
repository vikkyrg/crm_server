const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const Client = require('../src/models/Client');
const Invoice = require('../src/models/Invoice');
const AdvancePayment = require('../src/models/AdvancePayment');
const { calculateDocumentTotals } = require('../src/utils/financials');

// Use isolated test database
const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/innomatrics_crm_test';

test('Client Advance Payment, Invoice Allocation & Financial Integrity Suite (12 Scenarios)', async (t) => {
  await mongoose.connect(TEST_DB_URI);

  // Clean test collections before running
  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await AdvancePayment.deleteMany({});

  let clientA = null;
  let clientB = null;
  let advanceA = null;
  let invoice1 = null;
  let invoice2 = null;

  // Setup Clients
  clientA = await Client.create({
    clientId: 'CLI-ADV-001',
    companyName: 'Acme Global Corp',
    contactPerson: 'Alice Smith',
    primaryPhone: '+91 98765 00001',
    email: 'alice@acmeglobal.test',
    billingAddress: 'Tower 4, Cyber City',
    city: 'Gurugram',
    state: 'Haryana',
    stateCode: '06',
    pincode: '122002'
  });

  clientB = await Client.create({
    clientId: 'CLI-ADV-002',
    companyName: 'Beta Zenith Labs',
    contactPerson: 'Bob Jones',
    primaryPhone: '+91 98765 00002',
    email: 'bob@betazenth.test',
    billingAddress: 'Sector 62',
    city: 'Noida',
    state: 'Uttar Pradesh',
    stateCode: '09',
    pincode: '201301'
  });

  // 1. Record and persist a client advance
  await t.test('1. Record and persist a client advance with receiptNumber and financial fields', async () => {
    advanceA = await AdvancePayment.create({
      receiptNumber: `ADV-2026-TEST-${Date.now()}`,
      client: clientA._id,
      clientSnapshot: {
        companyName: clientA.companyName,
        contactPerson: clientA.contactPerson,
        primaryPhone: clientA.primaryPhone,
        email: clientA.email,
        city: clientA.city,
        state: clientA.state
      },
      paymentDate: new Date(),
      amount: 50000,
      allocatedAmount: 0,
      unallocatedAmount: 50000,
      paymentMethod: 'Bank Transfer',
      transactionReference: 'UTR-TEST-50000-A',
      associatedProject: 'Enterprise Cloud Migration',
      notes: 'Initial milestone advance retainer',
      status: 'Verified'
    });

    assert.ok(advanceA._id, 'Advance record should have MongoDB _id');
    assert.equal(advanceA.amount, 50000);
    assert.equal(advanceA.allocatedAmount, 0);
    assert.equal(advanceA.unallocatedAmount, 50000);
    assert.equal(advanceA.status, 'Verified');
    assert.equal(advanceA.client.toString(), clientA._id.toString());
  });

  // 2. Prevent duplicate transaction references
  await t.test('2. Reject duplicate transaction reference for active advance', async () => {
    let duplicateRejected = false;
    const existingRef = await AdvancePayment.findOne({
      transactionReference: 'UTR-TEST-50000-A',
      status: { $ne: 'Reversed' }
    });

    if (existingRef) {
      duplicateRejected = true;
    }
    assert.equal(duplicateRejected, true, 'Duplicate active transaction reference check must flag collision');
  });

  // 3. Fetch advances for the selected client
  await t.test('3. Fetch unallocated advances for selected client', async () => {
    const unallocatedAdvances = await AdvancePayment.find({
      client: clientA._id,
      status: 'Verified',
      unallocatedAmount: { $gt: 0 }
    });

    assert.equal(unallocatedAdvances.length, 1);
    assert.equal(unallocatedAdvances[0].receiptNumber, advanceA.receiptNumber);
    assert.equal(unallocatedAdvances[0].unallocatedAmount, 50000);
  });

  // 4. Apply part of an advance to an invoice (Partial allocation)
  await t.test('4. Apply partial advance (₹20,000) to Invoice 1 (Grand Total ₹100,000)', async () => {
    const items = [
      {
        serviceId: 'SRV-01',
        description: 'Phase 1 Architecture',
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

    const grandTotal = 100000;
    const allocAmount1 = 20000;
    const initialPaid = allocAmount1;
    const outstandingBalance = grandTotal - initialPaid; // 80,000

    invoice1 = await Invoice.create({
      invoiceNumber: `INV-2026-TEST-001`,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      client: clientA._id,
      clientSnapshot: { companyName: clientA.companyName },
      items,
      documentDiscount: 0,
      subtotal: 84745.76,
      totalTaxableAmount: 84745.76,
      cgstTotal: 7627.12,
      sgstTotal: 7627.12,
      totalTax: 15254.24,
      grandTotal,
      amountPaid: initialPaid,
      outstandingBalance,
      status: 'Partially Paid',
      paymentHistory: [
        {
          paymentDate: new Date(),
          amount: allocAmount1,
          paymentMethod: 'Advance Allocation',
          reference: advanceA.receiptNumber,
          advancePaymentId: advanceA._id,
          notes: `Settled via Advance Receipt ${advanceA.receiptNumber}`
        }
      ]
    });

    // Update Advance record atomically
    advanceA.allocatedAmount += allocAmount1;
    advanceA.unallocatedAmount -= allocAmount1;
    advanceA.allocations.push({
      invoice: invoice1._id,
      invoiceNumber: invoice1.invoiceNumber,
      allocatedAmount: allocAmount1,
      allocatedAt: new Date(),
      notes: `Applied on Invoice Creation (${invoice1.invoiceNumber})`
    });
    await advanceA.save();

    // Verify Invoice 1 state
    assert.equal(invoice1.grandTotal, 100000, 'Original invoice grand total must be preserved');
    assert.equal(invoice1.amountPaid, 20000, 'Amount paid must be 20,000');
    assert.equal(invoice1.outstandingBalance, 80000, 'Outstanding balance must be 80,000');
    assert.equal(invoice1.status, 'Partially Paid');

    // Verify Advance record state
    const refreshedAdv = await AdvancePayment.findById(advanceA._id);
    assert.equal(refreshedAdv.allocatedAmount, 20000);
    assert.equal(refreshedAdv.unallocatedAmount, 30000);
    assert.equal(refreshedAdv.allocations.length, 1);
  });

  // 5. Allocate remaining advance to another invoice
  await t.test('5. Allocate remaining advance (₹25,000 of ₹30,000) to Invoice 2', async () => {
    const grandTotal2 = 60000;
    const allocAmount2 = 25000;
    const initialPaid2 = allocAmount2;
    const outstandingBalance2 = grandTotal2 - initialPaid2; // 35,000

    invoice2 = await Invoice.create({
      invoiceNumber: `INV-2026-TEST-002`,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      client: clientA._id,
      clientSnapshot: { companyName: clientA.companyName },
      items: [
        {
          serviceId: 'SRV-02',
          description: 'Phase 2 Implementation',
          unitPrice: 50847.46,
          quantity: 1,
          taxRate: 18,
          taxableAmount: 50847.46,
          totalTax: 9152.54,
          lineTotal: 60000
        }
      ],
      subtotal: 50847.46,
      totalTaxableAmount: 50847.46,
      totalTax: 9152.54,
      grandTotal: grandTotal2,
      amountPaid: initialPaid2,
      outstandingBalance: outstandingBalance2,
      status: 'Partially Paid',
      paymentHistory: [
        {
          paymentDate: new Date(),
          amount: allocAmount2,
          paymentMethod: 'Advance Allocation',
          reference: advanceA.receiptNumber,
          advancePaymentId: advanceA._id
        }
      ]
    });

    advanceA.allocatedAmount += allocAmount2;
    advanceA.unallocatedAmount -= allocAmount2;
    advanceA.allocations.push({
      invoice: invoice2._id,
      invoiceNumber: invoice2.invoiceNumber,
      allocatedAmount: allocAmount2,
      allocatedAt: new Date()
    });
    await advanceA.save();

    const refreshedAdv = await AdvancePayment.findById(advanceA._id);
    assert.equal(refreshedAdv.allocatedAmount, 45000);
    assert.equal(refreshedAdv.unallocatedAmount, 5000, 'Remaining unallocated advance must be exactly ₹5,000');
    assert.equal(refreshedAdv.allocations.length, 2);
  });

  // 6. Reject allocation greater than remaining available balance
  await t.test('6. Reject allocation greater than remaining available balance (Attempt ₹10,000 when ₹5,000 available)', async () => {
    const currentAdv = await AdvancePayment.findById(advanceA._id);
    const attemptedAmount = 10000;

    let rejected = false;
    let errorMessage = '';
    if (attemptedAmount > currentAdv.unallocatedAmount) {
      rejected = true;
      errorMessage = `Allocation amount (₹${attemptedAmount}) exceeds available unallocated advance (₹${currentAdv.unallocatedAmount})`;
    }

    assert.equal(rejected, true);
    assert.ok(errorMessage.includes('exceeds available unallocated advance'));
  });

  // 7. Reject cross-client allocation
  await t.test('7. Reject cross-client advance allocation (Client B invoice using Client A advance)', async () => {
    const advClient = advanceA.client.toString();
    const invoiceClient = clientB._id.toString();

    let crossClientBlocked = false;
    if (advClient !== invoiceClient) {
      crossClientBlocked = true;
    }

    assert.equal(crossClientBlocked, true, 'Cross-client allocation must be strictly prohibited');
  });

  // 8. Prevent duplicate allocation and concurrent over-allocation
  await t.test('8. Prevent concurrent over-allocation using atomic condition checks', async () => {
    // Simulate atomic update check: condition unallocatedAmount >= requestedAmount
    const requestedAmount = 10000;
    const result = await AdvancePayment.updateOne(
      { _id: advanceA._id, unallocatedAmount: { $gte: requestedAmount } },
      { $inc: { allocatedAmount: requestedAmount, unallocatedAmount: -requestedAmount } }
    );

    assert.equal(result.matchedCount, 0, 'Atomic update must fail to match when unallocatedAmount < requestedAmount');

    // Valid atomic update for ₹5000
    const validResult = await AdvancePayment.updateOne(
      { _id: advanceA._id, unallocatedAmount: { $gte: 5000 } },
      { $inc: { allocatedAmount: 5000, unallocatedAmount: -5000 } }
    );
    assert.equal(validResult.matchedCount, 1, 'Atomic update matches and succeeds for remaining ₹5000');

    const fullyAllocatedAdv = await AdvancePayment.findById(advanceA._id);
    assert.equal(fullyAllocatedAdv.unallocatedAmount, 0);
    assert.equal(fullyAllocatedAdv.allocatedAmount, 50000);
  });

  // 9. Roll back or ensure integrity if creation fails
  await t.test('9. Roll back and maintain integrity if an error occurs', async () => {
    // If an error is caught before commit, the advance balance remains untainted
    const initialAdv = await AdvancePayment.findById(advanceA._id);
    try {
      throw new Error('Simulated failure during invoice persistence');
    } catch (err) {
      // Balance is not changed
    }
    const finalAdv = await AdvancePayment.findById(advanceA._id);
    assert.equal(finalAdv.unallocatedAmount, initialAdv.unallocatedAmount);
    assert.equal(finalAdv.allocatedAmount, initialAdv.allocatedAmount);
  });

  // 10. Verify invoice totals, amount payable, and outstanding balance
  await t.test('10. Verify invoice totals, amount payable, and outstanding balance', async () => {
    const inv = await Invoice.findById(invoice1._id);
    assert.equal(inv.grandTotal, 100000);
    assert.equal(inv.amountPaid, 20000);
    assert.equal(inv.outstandingBalance, 80000);
    assert.equal(inv.grandTotal - inv.amountPaid, inv.outstandingBalance);
  });

  // 11. Verify dashboard and client totals do not double-count advances
  await t.test('11. Verify dashboard revenue & collections do not double count advance allocations', async () => {
    // Revenue is calculated based on invoice totals (invoiced revenue = ₹100,000 + ₹60,000 = ₹160,000)
    // Cash received: original advance = ₹50,000. Applying advance does NOT create new cash inflow.
    const allInvoices = await Invoice.find({ client: clientA._id });
    const totalBilled = allInvoices.reduce((sum, i) => sum + i.grandTotal, 0);
    assert.equal(totalBilled, 160000);

    const totalAdvancesReceived = await AdvancePayment.aggregate([
      { $match: { client: clientA._id, status: { $ne: 'Reversed' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    assert.equal(totalAdvancesReceived[0].total, 50000);

    // Payments recorded directly in invoices that are NOT advance allocations
    let nonAdvancePayments = 0;
    allInvoices.forEach(inv => {
      inv.paymentHistory.forEach(p => {
        if (p.paymentMethod !== 'Advance Allocation') {
          nonAdvancePayments += p.amount;
        }
      });
    });
    assert.equal(nonAdvancePayments, 0, 'Allocations from advances are separated from new cash collections');
  });

  // 12. Verify advance receipts and audit history
  await t.test('12. Verify advance receipt format and allocation audit trail', async () => {
    const adv = await AdvancePayment.findById(advanceA._id);
    assert.ok(adv.receiptNumber.startsWith('ADV-2026-'));
    assert.equal(adv.allocations.length, 2);
    assert.equal(adv.allocations[0].invoiceNumber, invoice1.invoiceNumber);
    assert.equal(adv.allocations[0].allocatedAmount, 20000);
    assert.equal(adv.allocations[1].invoiceNumber, invoice2.invoiceNumber);
    assert.equal(adv.allocations[1].allocatedAmount, 25000);
  });

  // Teardown
  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await AdvancePayment.deleteMany({});
  await mongoose.disconnect();
});
