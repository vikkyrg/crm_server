const test = require('node:test');
const assert = require('node:assert/strict');

const PFDocument = require('../src/models/PFDocument');
const Client = require('../src/models/Client');
const CompanySettings = require('../src/models/CompanySettings');
const Counter = require('../src/models/Counter');
const Invoice = require('../src/models/Invoice');
Counter.getNextSequence = async () => 1;
const pfController = require('../src/controllers/pfController');

const makeResponse = () => ({
  statusCode: null,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  }
});

test('PF issuance persists advance and balance without creating an invoice', async (t) => {
  const originals = {
    findClient: Client.findById,
    findSettings: CompanySettings.findOne,
    findPF: PFDocument.findOne,
    createPF: PFDocument.create,
    findPFById: PFDocument.findById,
    createInvoice: Invoice.create,
    nextSequence: Counter.getNextSequence
  };
  const client = {
    _id: 'client-1',
    companyName: 'PF Test Client',
    stateCode: '09'
  };
  const settings = {
    stateCode: '09',
    roundingPolicy: 'round_to_nearest',
    pfPrefix: 'PF-TEST-'
  };
  const items = [{
    serviceId: 'SRV-TEST',
    description: 'Service',
    unitPrice: 50000,
    quantity: 1,
    taxRate: 18
  }];
  const createdRecords = [];
  let createdInvoices = 0;

  Client.findById = async () => client;
  CompanySettings.findOne = async () => settings;
  PFDocument.findOne = async () => null;
  PFDocument.create = async (record) => {
    const saved = { ...record, _id: `pf-${createdRecords.length + 1}` };
    createdRecords.push(saved);
    return saved;
  };
  Invoice.create = async () => {
    createdInvoices += 1;
    throw new Error('PF issuance must not create an invoice');
  };

  try {
    await t.test('issue without advance and with partial advance', async () => {
      for (const advanceAmount of [0, 10000]) {
        const res = makeResponse();
        await pfController.createPFDocument({
          body: { clientId: client._id, items, advanceAmount },
          user: { _id: 'user-1' }
        }, res, assert.fail);

        assert.equal(res.statusCode, 201);
        assert.equal(res.payload.data.status, 'Issued');
        assert.equal(res.payload.data.grandTotal, 59000);
        assert.equal(res.payload.data.advanceAmount, advanceAmount);
        assert.equal(res.payload.data.balancePayable, 59000 - advanceAmount);
      }
      assert.equal(createdRecords.length, 2);
      assert.equal(createdInvoices, 0);
    });

    await t.test('reject advance larger than the PF total', async () => {
      const res = makeResponse();
      await pfController.createPFDocument({
        body: { clientId: client._id, items, advanceAmount: 59000.01 },
        user: { _id: 'user-1' }
      }, res, assert.fail);

      assert.equal(res.statusCode, 400);
      assert.match(res.payload.message, /cannot exceed PF Grand Total/i);
      assert.equal(createdRecords.length, 2);
    });

    await t.test('reject invalid and fractional-paisa advances', async () => {
      for (const advanceAmount of [-1, 100.001]) {
        const res = makeResponse();
        await pfController.createPFDocument({
          body: { clientId: client._id, items, advanceAmount },
          user: { _id: 'user-1' }
        }, res, assert.fail);
        assert.equal(res.statusCode, 400);
      }
      assert.equal(createdRecords.length, 2);
    });

    await t.test('update recalculates the remaining balance and rejects invalid advances', async () => {
      const existingPF = {
        _id: 'pf-edit',
        status: 'Issued',
        clientSnapshot: { stateCode: '09' },
        grandTotal: 59000,
        advanceAmount: 10000,
        items: [],
        save: async function save() { this.saved = true; }
      };
      PFDocument.findById = async () => existingPF;

      const validResponse = makeResponse();
      await pfController.updatePFDocument({
        params: { id: existingPF._id },
        body: { items, documentDiscount: 0, advanceAmount: 15000 }
      }, validResponse, assert.fail);
      assert.equal(validResponse.statusCode, 200);
      assert.equal(existingPF.advanceAmount, 15000);
      assert.equal(existingPF.balancePayable, 44000);

      existingPF.saved = false;
      const invalidResponse = makeResponse();
      await pfController.updatePFDocument({
        params: { id: existingPF._id },
        body: { items, documentDiscount: 0, advanceAmount: 59001 }
      }, invalidResponse, assert.fail);
      assert.equal(invalidResponse.statusCode, 400);
      assert.equal(existingPF.saved, false);
    });
  } finally {
    Client.findById = originals.findClient;
    CompanySettings.findOne = originals.findSettings;
    PFDocument.findOne = originals.findPF;
    PFDocument.create = originals.createPF;
    PFDocument.findById = originals.findPFById;
    Invoice.create = originals.createInvoice;
    Counter.getNextSequence = originals.nextSequence;
  }
});
