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

test('Client Cascade Deletion Integration Test', async (t) => {
  // Connect to DB
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Create a disposable client
  const testClientId = `DISP-${Date.now()}`;
  const disposableClient = await Client.create({
    clientId: testClientId,
    companyName: 'Disposable QA Corp',
    contactPerson: 'QA Tester',
    primaryPhone: '+91 99999 88888',
    email: `disposable_${Date.now()}@example.com`,
    billingAddress: 'QA Tower, Sector 62',
    city: 'Noida',
    state: 'Uttar Pradesh',
    stateCode: '09',
    pincode: '201309'
  });

  assert.ok(disposableClient._id);

  // 2. Create related PF Document
  const pfDoc = await PFDocument.create({
    pfNumber: `PF-DISP-${Date.now()}`,
    client: disposableClient._id,
    clientSnapshot: { companyName: disposableClient.companyName },
    subtotal: 50000,
    totalTaxableAmount: 50000,
    totalTax: 9000,
    grandTotal: 59000,
    status: 'Issued',
    items: [{
      serviceId: 'SRV-01',
      description: 'QA Service',
      unitPrice: 50000,
      quantity: 1,
      taxableAmount: 50000,
      lineTotal: 59000
    }]
  });

  // 3. Create related Invoice
  const invoice = await Invoice.create({
    invoiceNumber: `INV-DISP-${Date.now()}`,
    client: disposableClient._id,
    clientSnapshot: { companyName: disposableClient.companyName },
    dueDate: new Date(Date.now() + 86400000 * 15),
    subtotal: 50000,
    totalTaxableAmount: 50000,
    totalTax: 9000,
    grandTotal: 59000,
    amountPaid: 0,
    outstandingBalance: 59000,
    status: 'Issued',
    items: [{
      serviceId: 'SRV-01',
      description: 'QA Service',
      unitPrice: 50000,
      quantity: 1,
      taxableAmount: 50000,
      lineTotal: 59000
    }]
  });

  // 4. Create related Advance Payment
  const advance = await AdvancePayment.create({
    receiptNumber: `ADV-DISP-${Date.now()}`,
    client: disposableClient._id,
    clientSnapshot: { companyName: disposableClient.companyName },
    amount: 15000,
    allocatedAmount: 0,
    unallocatedAmount: 15000,
    paymentMethod: 'Bank Transfer',
    status: 'Verified'
  });

  // 5. Create related Quantity Record
  const quantity = await QuantityRecord.create({
    recordId: `QTY-DISP-${Date.now()}`,
    client: disposableClient._id,
    service: new mongoose.Types.ObjectId(),
    serviceId: 'SRV-01',
    serviceName: 'QA Consulting',
    quantity: 10,
    unit: 'Hours',
    unitPriceSnapshot: 5000
  });

  // Verify all 5 records exist
  assert.equal(await Client.countDocuments({ _id: disposableClient._id }), 1);
  assert.equal(await PFDocument.countDocuments({ client: disposableClient._id }), 1);
  assert.equal(await Invoice.countDocuments({ client: disposableClient._id }), 1);
  assert.equal(await AdvancePayment.countDocuments({ client: disposableClient._id }), 1);
  assert.equal(await QuantityRecord.countDocuments({ client: disposableClient._id }), 1);

  // 6. Execute permanent cascading deletion
  await QuantityRecord.deleteMany({ client: disposableClient._id });
  await PFDocument.deleteMany({ client: disposableClient._id });
  await AdvancePayment.deleteMany({ client: disposableClient._id });
  await Invoice.deleteMany({ client: disposableClient._id });
  await Client.findByIdAndDelete(disposableClient._id);

  // 7. Assert that all client-owned records are gone
  assert.equal(await Client.countDocuments({ _id: disposableClient._id }), 0);
  assert.equal(await PFDocument.countDocuments({ client: disposableClient._id }), 0);
  assert.equal(await Invoice.countDocuments({ client: disposableClient._id }), 0);
  assert.equal(await AdvancePayment.countDocuments({ client: disposableClient._id }), 0);
  assert.equal(await QuantityRecord.countDocuments({ client: disposableClient._id }), 0);

  // 8. Assert global services remain untouched
  const globalServicesCount = await Service.countDocuments();
  assert.ok(globalServicesCount > 0, 'Global services must not be deleted');

  await mongoose.disconnect();
});
