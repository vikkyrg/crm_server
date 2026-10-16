const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Employee = require('../src/models/Employee');
const PayrollRun = require('../src/models/PayrollRun');
const EmployeePfRecord = require('../src/models/EmployeePfRecord');
const DeliveryChallan = require('../src/models/DeliveryChallan');
const Invoice = require('../src/models/Invoice');
const Client = require('../src/models/Client');

test('Innomatrics ERP Modules Test Suite', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);

  let testClient = await Client.findOne();
  if (!testClient) {
    testClient = await Client.create({
      clientId: `CLI-ERP-${Date.now()}`,
      companyName: 'ERP Test Corporation',
      contactPerson: 'QA Lead',
      email: `qa.${Date.now()}@erptest.com`,
      primaryPhone: '9988776655',
      billingAddress: 'Unit 101, Cyber City',
      city: 'Noida',
      state: 'Uttar Pradesh',
      stateCode: '09',
      pincode: '201301'
    });
  }

  let testEmployee;

  await t.test('Phase 2: Employee CRUD & Salary Configuration', async () => {
    testEmployee = await Employee.create({
      employeeId: `TEST-EMP-${Date.now()}`,
      fullName: 'Aarav Sharma',
      email: `aarav.${Date.now()}@innomatrics.test`,
      phone: '+91 9811223344',
      department: 'Engineering',
      designation: 'Senior Backend Architect',
      employmentStatus: 'Active',
      employmentType: 'Full-time',
      salaryStructure: {
        basicSalary: 40000,
        hra: 20000,
        conveyanceAllowance: 1600,
        medicalAllowance: 1250,
        specialAllowance: 7150,
        professionalTax: 200,
        tdsMonthly: 1500
      },
      statutoryInfo: {
        uan: '101234567890',
        pfAccountNumber: 'DL/CPM/12345/001',
        isPfEligible: true,
        pfWageLimitApplicable: true
      },
      bankDetails: {
        bankName: 'HDFC Bank',
        accountNumber: '50100234567890',
        ifscCode: 'HDFC0001234'
      }
    });

    assert.ok(testEmployee._id);
    assert.equal(testEmployee.fullName, 'Aarav Sharma');
    assert.equal(testEmployee.salaryStructure.grossSalary, 70000);
  });

  await t.test('Phase 3: Salary Calculation & Monthly Payroll Math', async () => {
    const workingDays = 30;
    const daysAttended = 30;
    const ratio = daysAttended / workingDays;

    const gross = testEmployee.salaryStructure.grossSalary * ratio;
    const pfWageBase = testEmployee.statutoryInfo.pfWageLimitApplicable
      ? Math.min(15000, testEmployee.salaryStructure.basicSalary * ratio)
      : testEmployee.salaryStructure.basicSalary * ratio;

    const employeePf = Math.round(pfWageBase * 0.12);
    const employerEps = Math.round(pfWageBase * 0.0833);
    const employerEpf = Math.round(pfWageBase * 0.0367);
    const totalDeductions = employeePf + testEmployee.salaryStructure.professionalTax + testEmployee.salaryStructure.tdsMonthly;
    const netSalary = gross - totalDeductions;

    assert.equal(gross, 70000);
    assert.equal(pfWageBase, 15000);
    assert.equal(employeePf, 1800);
    assert.equal(employerEps, 1250);
    assert.equal(employerEpf, 551);
    assert.equal(totalDeductions, 3500);
    assert.equal(netSalary, 66500);
  });

  await t.test('Phase 4: Employee PF Statutory Record & Remittance TRRN', async () => {
    const pfRecord = await EmployeePfRecord.create({
      recordCode: `PFR-TEST-${Date.now()}`,
      employee: testEmployee._id,
      employeeId: testEmployee.employeeId,
      employeeName: testEmployee.fullName,
      uan: testEmployee.statutoryInfo.uan,
      pfAccountNumber: testEmployee.statutoryInfo.pfAccountNumber,
      month: 11,
      year: 2026,
      periodName: 'November 2026',
      pfWageBase: 15000,
      employeeContribution: 1800,
      employerContribution: 1800,
      adminCharges: 0,
      totalPfAmount: 3600,
      remittanceStatus: 'Pending',
      remarks: 'ERP-TEST-RUN'
    });

    assert.ok(pfRecord._id);
    assert.equal(pfRecord.totalPfAmount, 3600);
    assert.equal(pfRecord.remittanceStatus, 'Pending');

    pfRecord.remittanceStatus = 'Remitted';
    pfRecord.challanNumber = 'TRRN-TEST-998877';
    pfRecord.remittanceDate = new Date();
    await pfRecord.save();

    const verified = await EmployeePfRecord.findById(pfRecord._id);
    assert.equal(verified.remittanceStatus, 'Remitted');
    assert.equal(verified.challanNumber, 'TRRN-TEST-998877');
  });

  let testChallan;

  await t.test('Phase 5: Delivery Challan Dispatch and Delivery Flow', async () => {
    testChallan = await DeliveryChallan.create({
      challanNumber: `DC-TEST-${Date.now()}`,
      client: testClient._id,
      clientSnapshot: {
        companyName: testClient.companyName,
        contactPerson: testClient.contactPerson,
        primaryPhone: testClient.primaryPhone,
        email: testClient.email,
        billingAddress: testClient.billingAddress
      },
      deliveryAddress: testClient.billingAddress,
      projectOrWorkOrder: 'ERP-TEST-PROJECT',
      deliveryType: 'Material Supply',
      vehicleNumber: 'UP 16 AB 9988',
      items: [
        {
          itemCode: 'RACK-42U',
          description: '42U Server Rack Enclosure',
          quantityDispatched: 2,
          unit: 'Units'
        }
      ],
      status: 'Issued'
    });

    assert.ok(testChallan._id);
    assert.equal(testChallan.status, 'Issued');

    testChallan.status = 'Delivered';
    testChallan.receivedBy = {
      name: 'Site Manager Rohit',
      receivedAt: new Date()
    };
    testChallan.actualDeliveryDate = new Date();
    await testChallan.save();

    const delivered = await DeliveryChallan.findById(testChallan._id);
    assert.equal(delivered.status, 'Delivered');
    assert.equal(delivered.receivedBy.name, 'Site Manager Rohit');
  });

  await t.test('Phase 6: Material Invoice Creation and Challan Linking', async () => {
    const invoice = await Invoice.create({
      invoiceNumber: `INV-MAT-TEST-${Date.now()}`,
      invoiceType: 'Material',
      client: testClient._id,
      clientSnapshot: {
        companyName: testClient.companyName,
        contactPerson: testClient.contactPerson,
        email: testClient.email,
        primaryPhone: testClient.primaryPhone,
        billingAddress: testClient.billingAddress,
        state: testClient.state,
        stateCode: testClient.stateCode
      },
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      items: [
        {
          serviceId: 'MAT-RACK',
          description: testChallan.items[0].description,
          quantity: testChallan.items[0].quantityDispatched,
          unitPrice: 25000,
          discountPercent: 0,
          taxRate: 18,
          taxableAmount: 50000,
          cgstAmount: 4500,
          sgstAmount: 4500,
          igstAmount: 0,
          lineTotal: 59000,
          unit: 'Units'
        }
      ],
      subtotal: 50000,
      totalTaxableAmount: 50000,
      totalTax: 9000,
      cgstTotal: 4500,
      sgstTotal: 4500,
      igstTotal: 0,
      grandTotal: 59000,
      outstandingBalance: 59000,
      status: 'Issued',
      linkedChallans: [testChallan._id],
      linkedChallanNumbers: [testChallan.challanNumber],
      notes: 'ERP-TEST-INVOICE'
    });

    assert.ok(invoice._id);
    assert.equal(invoice.invoiceType, 'Material');
    assert.equal(invoice.grandTotal, 59000);
    assert.equal(invoice.linkedChallanNumbers[0], testChallan.challanNumber);

    testChallan.status = 'Invoiced';
    testChallan.invoices = [invoice._id];
    await testChallan.save();
    const updatedChallan = await DeliveryChallan.findById(testChallan._id);
    assert.equal(updatedChallan.status, 'Invoiced');
    assert.equal(updatedChallan.invoices.length, 1);

    // Test invoice deletion unlinking challan safely
    const invoiceController = require('../src/controllers/invoiceController');
    const mockRes = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { this.data = data; return this; }
    };
    await invoiceController.deleteInvoice({ params: { id: invoice._id.toString() } }, mockRes, () => {});
    assert.equal(mockRes.statusCode, 200);

    const postDeleteChallan = await DeliveryChallan.findById(testChallan._id);
    assert.equal(postDeleteChallan.invoices.length, 0);
    assert.equal(postDeleteChallan.status, 'Delivered');
  });

  // Cleanup test artifacts
  if (testEmployee?._id) await Employee.deleteOne({ _id: testEmployee._id });
  if (testChallan?._id) await DeliveryChallan.deleteOne({ _id: testChallan._id });
  await EmployeePfRecord.deleteMany({ remarks: 'ERP-TEST-RUN' });
  await Invoice.deleteMany({ notes: 'ERP-TEST-INVOICE' });

  await mongoose.disconnect();
});
