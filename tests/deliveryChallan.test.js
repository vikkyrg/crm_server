const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
require('dotenv').config();

const { createChallan, downloadChallanPDF } = require('../src/controllers/deliveryChallanController');
const DeliveryChallan = require('../src/models/DeliveryChallan');
const Client = require('../src/models/Client');
const User = require('../src/models/User');
const { Writable } = require('stream');
const zlib = require('node:zlib');

describe('Delivery Challan Creation & Validation Suite', () => {
  let dbUri;
  let testClient;
  let testUser;
  let createdChallanIds = [];

  before(async () => {
    dbUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
    await mongoose.connect(dbUri);

    testUser = await User.findOne();
    if (!testUser) {
      testUser = await User.create({
        name: 'Challan Test Admin',
        email: `dc-admin-${Date.now()}@example.com`,
        password: 'Password123!',
        role: 'Administrator'
      });
    }

    testClient = await Client.create({
      clientId: `CL-TST-${Date.now()}`,
      companyName: `Challan Client ${Date.now()}`,
      contactPerson: 'Delivery Receiver',
      primaryPhone: '9876543210',
      email: `dc-client-${Date.now()}@example.com`,
      billingAddress: '42 Industrial Area, Sector 62',
      shippingAddress: 'Site Office B, Noida Phase 3',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pincode: '201309'
    });
  });

  after(async () => {
    if (createdChallanIds.length > 0) {
      await DeliveryChallan.deleteMany({ _id: { $in: createdChallanIds } });
    }
    if (testClient?._id) {
      await Client.findByIdAndDelete(testClient._id);
    }
    await mongoose.disconnect();
  });

  test('1. Normalizes legacy/invalid "Material Supply to Site" deliveryType to "Material Supply" and generates challan', async () => {
    let statusCode = 0;
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

    const req = {
      user: testUser,
      body: {
        clientId: testClient._id.toString(),
        projectOrWorkOrder: 'Datacenter Expansion Phase 1',
        deliveryAddress: 'Site Office B, Noida Phase 3',
        deliveryType: 'Material Supply to Site', // Legacy frontend mismatch
        transporterName: 'Express Cargo',
        vehicleNumber: 'UP-16-AB-9999',
        items: [
          {
            itemCode: 'SFP-10G',
            description: '10G SFP+ Optical Transceivers',
            quantityDispatched: 5,
            unit: 'Nos'
          }
        ],
        notes: 'Handle with care'
      }
    };

    let nextCalled = null;
    await createChallan(req, res, (err) => {
      nextCalled = err;
    });

    assert.equal(nextCalled, null, `Should not throw error: ${nextCalled?.message}`);
    assert.equal(statusCode, 201);
    assert.equal(responseData?.success, true);
    assert.ok(responseData?.data?.challanNumber.startsWith('DC-'));
    assert.equal(responseData?.data?.deliveryType, 'Material Supply');
    assert.equal(responseData?.data?.items.length, 1);
    assert.equal(responseData?.data?.items[0].description, '10G SFP+ Optical Transceivers');
    assert.equal(responseData?.data?.items[0].quantityDispatched, 5);

    createdChallanIds.push(responseData.data._id);
  });

  test('2. Rejects submission when clientId is missing with 400 Bad Request', async () => {
    let statusCode = 0;
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

    const req = {
      user: testUser,
      body: {
        deliveryAddress: 'Some Site',
        items: [{ description: 'Test Item', quantityDispatched: 1 }]
      }
    };

    await createChallan(req, res, () => {});
    assert.equal(statusCode, 400);
    assert.equal(responseData?.success, false);
    assert.match(responseData?.message, /Client selection is required/i);
  });

  test('3. Rejects submission when items array is empty with 400 Bad Request', async () => {
    let statusCode = 0;
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

    const req = {
      user: testUser,
      body: {
        clientId: testClient._id.toString(),
        deliveryAddress: 'Some Site',
        items: []
      }
    };

    await createChallan(req, res, () => {});
    assert.equal(statusCode, 400);
    assert.equal(responseData?.success, false);
    assert.match(responseData?.message, /At least one material item is required/i);
  });

  test('4. Rejects submission when item description is empty with 400 Bad Request', async () => {
    let statusCode = 0;
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

    const req = {
      user: testUser,
      body: {
        clientId: testClient._id.toString(),
        deliveryAddress: 'Some Site',
        items: [{ description: '   ', quantityDispatched: 2 }]
      }
    };

    await createChallan(req, res, () => {});
    assert.equal(statusCode, 400);
    assert.equal(responseData?.success, false);
    assert.match(responseData?.message, /Description is required/i);
  });

  test('5. Rejects submission when item quantity is 0 or negative with 400 Bad Request', async () => {
    let statusCode = 0;
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

    const req = {
      user: testUser,
      body: {
        clientId: testClient._id.toString(),
        deliveryAddress: 'Some Site',
        items: [{ description: 'Switch Rack', quantityDispatched: 0 }]
      }
    };

    await createChallan(req, res, () => {});
    assert.equal(statusCode, 400);
    assert.equal(responseData?.success, false);
    assert.match(responseData?.message, /quantity must be greater than 0/i);
  });

  test('6. Generates valid A4 Delivery Challan PDF with proper headers and buffer stream', async () => {
    assert.ok(createdChallanIds.length > 0, 'Should have created challan from test 1');
    const challanId = createdChallanIds[0];

    const chunks = [];
    const mockWritable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    mockWritable.setHeader = () => {};

    let nextError = null;
    await downloadChallanPDF({ params: { id: challanId } }, mockWritable, (err) => {
      nextError = err;
    });

    assert.equal(nextError, null, 'Should not throw error in downloadChallanPDF');

    // Wait briefly for PDF document stream to finalize
    await new Promise((resolve) => {
      if (mockWritable.writableEnded) return resolve();
      mockWritable.on('finish', resolve);
      setTimeout(resolve, 500);
    });

    const pdfBuffer = Buffer.concat(chunks);
    assert.ok(pdfBuffer.length > 500, 'PDF buffer should be non-empty and greater than 500 bytes');
    assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF', 'PDF buffer must start with %PDF magic number');
    const pdfContent = pdfBuffer.toString('latin1');
    const pageBoxes = [...pdfContent.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
      .map((match) => match[1].trim().split(/\s+/).map(Number));
    assert.ok(pageBoxes.length > 0, 'Delivery Challan PDF should contain pages');
    pageBoxes.forEach((pageBox) => {
      assert.deepEqual(pageBox, [0, 0, 595.28, 841.89], 'Delivery Challan pages must use A4 dimensions');
    });

    const decodedStreams = [...pdfContent.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map((match) => {
        try {
          return zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');
    assert.ok(!decodedStreams.includes('Attention:'), 'Delivery Challan PDF should not include the Attention line');

    // Count pages in PDF buffer: single item challan must strictly be 1 page!
    const pageMatches = pdfBuffer.toString().match(/\/Type\s*\/Page[^s]/g);
    assert.equal(pageMatches ? pageMatches.length : 0, 1, 'Single item delivery challan must fit on exactly 1 page');
  });

  test('7. Multi-page pagination and continuation header on multi-row challans', async () => {
    // Create challan with 25 items to force multi-page layout
    const multiItems = [];
    for (let i = 1; i <= 25; i++) {
      multiItems.push({
        itemCode: `CAB-${i}`,
        description: `Long Description High Performance Gigabit Structured Ethernet Cable Spool Type ${i}`,
        quantityDispatched: i * 2,
        unit: 'Meters',
        batchOrSerialNo: `LOT-${i}`
      });
    }

    const challanDoc = await DeliveryChallan.create({
      challanNumber: `DC-PAGETEST-${Date.now()}`,
      challanDate: new Date(),
      client: testClient._id,
      clientSnapshot: {
        companyName: testClient.companyName,
        contactPerson: testClient.contactPerson
      },
      deliveryAddress: 'Noida Datacenter Complex Block B',
      deliveryType: 'Material Supply',
      items: multiItems,
      createdBy: testUser._id
    });
    createdChallanIds.push(challanDoc._id);

    const chunks = [];
    const mockWritable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    mockWritable.setHeader = () => {};

    let nextError = null;
    await downloadChallanPDF({ params: { id: challanDoc._id } }, mockWritable, (err) => {
      nextError = err;
    });

    assert.equal(nextError, null);

    await new Promise((resolve) => {
      if (mockWritable.writableEnded) return resolve();
      mockWritable.on('finish', resolve);
      setTimeout(resolve, 500);
    });

    const pdfBuffer = Buffer.concat(chunks);
    assert.ok(pdfBuffer.length > 2000, 'Multi-page PDF should be substantial in size');
    assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF');

    const multiPagePdf = pdfBuffer.toString('latin1');
    const pageBoxes = [...multiPagePdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
      .map((match) => match[1].trim().split(/\s+/).map(Number));
    assert.ok(pageBoxes.length > 1, 'Multi-row challan should have multiple pages');
    pageBoxes.forEach((pageBox) => {
      assert.deepEqual(pageBox, [0, 0, 595.28, 841.89], 'Every Delivery Challan page must use A4 dimensions');
    });

    const multiPageMatches = multiPagePdf.match(/\/Type\s*\/Page[^s]/g);
    assert.ok((multiPageMatches?.length || 0) > 1, 'Multi-row challan should span cleanly across multiple pages');
  });
});
