const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

const Client = require('../src/models/Client');
const PFDocument = require('../src/models/PFDocument');
const Invoice = require('../src/models/Invoice');
const AdvancePayment = require('../src/models/AdvancePayment');
const pfController = require('../src/controllers/pfController');
const invoiceController = require('../src/controllers/invoiceController');

// Helper to simulate Express req/res
const mockReqRes = (params = {}, body = {}, user = { _id: new mongoose.Types.ObjectId(), name: 'Tester', role: 'admin' }) => {
  const req = { params, body, user };
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };
  return { req, res, getStatus: () => statusCode, getData: () => responseData };
};

test('Delete Operations & Financial Safeguards Suite', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);

  const testId = `DEL-SAFE-${Date.now()}`;
  const client = await Client.create({
    clientId: testId,
    companyName: 'Delete Safeguards Test Corp',
    contactPerson: 'Audit Officer',
    primaryPhone: '+91 99999 88888',
    email: `del_safe_${Date.now()}@example.com`,
    billingAddress: 'Tower B, Tech Park',
    city: 'Noida',
    state: 'Uttar Pradesh',
    stateCode: '09',
    pincode: '201301'
  });

  let unconvertedPF = null;
  let convertedPF = null;
  let paidInvoice = null;
  let unpaidInvoice = null;

  await t.test('1. Delete Unconverted PF Document (Allowed)', async () => {
    unconvertedPF = await PFDocument.create({
      pfNumber: `PF-DEL-UNCONV-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      items: [
        {
          serviceId: 'SRV-01',
          description: 'Consulting',
          unitPrice: 10000,
          quantity: 1,
          taxRate: 18,
          taxableAmount: 10000,
          lineTotal: 11800
        }
      ],
      subtotal: 10000,
      totalTaxableAmount: 10000,
      cgstTotal: 900,
      sgstTotal: 900,
      totalTax: 1800,
      grandTotal: 11800,
      status: 'Draft'
    });

    const mock = mockReqRes({ id: unconvertedPF._id });
    await pfController.deletePFDocument(mock.req, mock.res, (err) => { throw err; });

    assert.equal(mock.getStatus(), 200);
    assert.equal(mock.getData().success, true);

    const check = await PFDocument.findById(unconvertedPF._id);
    assert.equal(check, null, 'Unconverted PF should be permanently deleted');
  });

  await t.test('2. Delete Converted PF Document (Blocked by Safeguards)', async () => {
    convertedPF = await PFDocument.create({
      pfNumber: `PF-DEL-CONV-${Date.now()}`,
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      items: [
        {
          serviceId: 'SRV-02',
          description: 'Software Dev',
          unitPrice: 20000,
          quantity: 1,
          taxRate: 18,
          taxableAmount: 20000,
          lineTotal: 23600
        }
      ],
      subtotal: 20000,
      totalTaxableAmount: 20000,
      cgstTotal: 1800,
      sgstTotal: 1800,
      totalTax: 3600,
      grandTotal: 23600,
      status: 'Converted to Invoice',
      convertedToInvoiceId: new mongoose.Types.ObjectId(),
      convertedToInvoiceNumber: 'INV-2026-99999'
    });

    const mock = mockReqRes({ id: convertedPF._id });
    await pfController.deletePFDocument(mock.req, mock.res, (err) => { throw err; });

    assert.equal(mock.getStatus(), 400);
    assert.equal(mock.getData().success, false);
    assert.match(mock.getData().message, /already been converted to Tax Invoice/);

    const check = await PFDocument.findById(convertedPF._id);
    assert.ok(check, 'Converted PF must remain preserved in database');
  });

  await t.test('3. Delete Paid or Partially Paid Invoice (Blocked by Safeguards)', async () => {
    paidInvoice = await Invoice.create({
      invoiceNumber: `INV-PAID-${Date.now()}`,
      invoiceDate: new Date(),
      dueDate: new Date(),
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      items: [
        {
          serviceId: 'SRV-03',
          description: 'Maintenance',
          unitPrice: 30000,
          quantity: 1,
          taxRate: 18,
          taxableAmount: 30000,
          lineTotal: 35400
        }
      ],
      subtotal: 30000,
      totalTaxableAmount: 30000,
      cgstTotal: 2700,
      sgstTotal: 2700,
      totalTax: 5400,
      grandTotal: 35400,
      amountPaid: 15000,
      outstandingBalance: 20400,
      status: 'Partially Paid',
      paymentHistory: [
        {
          paymentDate: new Date(),
          amount: 15000,
          paymentMethod: 'Bank Transfer',
          reference: 'UTR123'
        }
      ]
    });

    const mock = mockReqRes({ id: paidInvoice._id });
    await invoiceController.deleteInvoice(mock.req, mock.res, (err) => { throw err; });

    assert.equal(mock.getStatus(), 400);
    assert.equal(mock.getData().success, false);
    assert.match(mock.getData().message, /Payments totalling/);

    const check = await Invoice.findById(paidInvoice._id);
    assert.ok(check, 'Invoice with payment history must not be deleted');
  });

  await t.test('4. Delete Unpaid Invoice without Allocations (Allowed & Resets PF conversion status)', async () => {
    // Re-use convertedPF to test reset
    unpaidInvoice = await Invoice.create({
      invoiceNumber: `INV-UNPAID-${Date.now()}`,
      invoiceDate: new Date(),
      dueDate: new Date(),
      client: client._id,
      clientSnapshot: { companyName: client.companyName },
      relatedPFDocument: convertedPF._id,
      relatedPFNumber: convertedPF.pfNumber,
      items: [
        {
          serviceId: 'SRV-02',
          description: 'Software Dev',
          unitPrice: 20000,
          quantity: 1,
          taxRate: 18,
          taxableAmount: 20000,
          lineTotal: 23600
        }
      ],
      subtotal: 20000,
      totalTaxableAmount: 20000,
      cgstTotal: 1800,
      sgstTotal: 1800,
      totalTax: 3600,
      grandTotal: 23600,
      amountPaid: 0,
      outstandingBalance: 23600,
      status: 'Issued'
    });

    const mock = mockReqRes({ id: unpaidInvoice._id });
    await invoiceController.deleteInvoice(mock.req, mock.res, (err) => { throw err; });

    assert.equal(mock.getStatus(), 200);
    assert.equal(mock.getData().success, true);

    const checkInvoice = await Invoice.findById(unpaidInvoice._id);
    assert.equal(checkInvoice, null, 'Unpaid invoice should be deleted');

    // Check that related PF conversion state is gracefully unlinked/reset
    const checkPF = await PFDocument.findById(convertedPF._id);
    assert.equal(checkPF.status, 'Accepted');
    assert.equal(checkPF.convertedToInvoiceId, null);
  });

  // Cleanup testing artifacts
  await PFDocument.deleteMany({ client: client._id });
  await Invoice.deleteMany({ client: client._id });
  await AdvancePayment.deleteMany({ client: client._id });
  await Client.findByIdAndDelete(client._id);

  await mongoose.disconnect();
});
