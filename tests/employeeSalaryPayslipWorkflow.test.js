const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');
const zlib = require('node:zlib');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = require('../src/app');
const User = require('../src/models/User');
const Employee = require('../src/models/Employee');
const PayrollRun = require('../src/models/PayrollRun');
const CompanySettings = require('../src/models/CompanySettings');

test('Employee Salary / Payslip Workflow API Suite', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);

  const admin = await User.findOne({ role: 'Administrator' });
  const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const uniqueId = `SLR-${Date.now()}`;
  let testEmployee;
  let createdRunId;

  t.after(async () => {
    if (createdRunId) await PayrollRun.findByIdAndDelete(createdRunId);
    if (testEmployee) await Employee.findByIdAndDelete(testEmployee._id);
    await mongoose.disconnect();
  });

  await t.test('1. Setup active employee with structured salary and bank details', async () => {
    testEmployee = await Employee.create({
      employeeId: `EMP-${uniqueId}`,
      fullName: 'Rahul Sharma',
      email: `rahul_${uniqueId}@innomatrics.test`,
      phone: '9876543210',
      department: 'Engineering',
      designation: 'Senior Developer',
      joiningDate: new Date('2023-05-15'),
      employmentStatus: 'Active',
      bankDetails: {
        bankName: 'HDFC Bank',
        accountNumber: '50100234567890',
        ifscCode: 'HDFC0001234',
        branchName: 'Noida Sector 62'
      },
      salaryStructure: {
        basicSalary: 30000,
        hra: 15000,
        conveyanceAllowance: 2000,
        specialAllowance: 5000,
        medicalAllowance: 1250,
        otherAllowances: 0,
        professionalTax: 200,
        tdsMonthly: 500
      },
      statutoryInfo: {
        panNumber: 'ABCDE1234F',
        uan: '100908070605',
        pfAccountNumber: 'DL/12345/67890',
        pfApplicable: true,
        isPfEligible: true,
        pfWageBasis: 'Basic',
        pfWageLimitApplicable: true,
        esiApplicable: false
      }
    });

    assert.ok(testEmployee._id);
  });

  await t.test('2. Reject calculation when employee ID is invalid or missing', async () => {
    const res = await request(app)
      .post('/api/payroll/calculate-employee')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId: 'NON_EXISTENT_ID_9999',
        month: 10,
        year: 2026
      });

    assert.equal(res.status, 404);
    assert.match(res.body.message, /not found/i);
  });

  await t.test('3. Calculate salary with payable days proration (20 out of 30 days)', async () => {
    const res = await request(app)
      .post('/api/payroll/calculate-employee')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId: testEmployee.employeeId,
        month: 10,
        year: 2026,
        totalWorkingDays: 30,
        paidDays: 20
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const c = res.body.calculated;

    // Proration ratio = 20 / 30 = 2/3
    assert.equal(c.totalWorkingDays, 30);
    assert.equal(c.paidDays, 20);
    assert.equal(c.unpaidLeaveDays, 10);

    // Basic: 30000 * 20/30 = 20000
    assert.equal(c.basicSalary, 20000);
    // HRA: 15000 * 20/30 = 10000
    assert.equal(c.hra, 10000);
    // Conveyance: 2000 * 20/30 = 1333.33
    assert.equal(c.conveyanceAllowance, 1333.33);

    // Net salary should be positive and words should be generated
    assert.ok(c.netSalaryPayable > 0);
    assert.ok(typeof res.body.netSalaryInWords === 'string' && res.body.netSalaryInWords.includes('Rupees'));
  });

  await t.test('4. Save Draft payslip into PayrollRun without overwriting employee saved profile', async () => {
    const res = await request(app)
      .post('/api/payroll/employee-payslip')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId: testEmployee.employeeId,
        month: 10,
        year: 2026,
        status: 'Draft',
        totalWorkingDays: 30,
        paidDays: 30,
        bonusOrIncentive: 1000,
        remarks: 'October performance bonus included'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.runId);
    createdRunId = res.body.runId;

    // Verify employee master salary structure was NOT modified
    const refreshedEmp = await Employee.findById(testEmployee._id);
    assert.equal(refreshedEmp.salaryStructure.basicSalary, 30000);
    assert.equal(refreshedEmp.salaryStructure.hra, 15000);
  });

  await t.test('5. Retrieve saved payslip by employeeId, month, and year', async () => {
    const res = await request(app)
      .get(`/api/payroll/employee-payslip?employeeId=${testEmployee.employeeId}&month=10&year=2026`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data);
    assert.equal(res.body.data.employeeId, testEmployee.employeeId);
    assert.equal(res.body.data.bonusOrIncentive, 1000);
  });

  await t.test('6. Finalize payslip and prevent subsequent duplicate overwriting', async () => {
    const res = await request(app)
      .post('/api/payroll/employee-payslip')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId: testEmployee.employeeId,
        month: 10,
        year: 2026,
        status: 'Finalized',
        totalWorkingDays: 30,
        paidDays: 30
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'Finalized');

    // Attempt to overwrite finalized record
    const dupRes = await request(app)
      .post('/api/payroll/employee-payslip')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId: testEmployee.employeeId,
        month: 10,
        year: 2026,
        status: 'Draft',
        totalWorkingDays: 30,
        paidDays: 25
      });

    assert.equal(dupRes.status, 400);
    assert.match(dupRes.body.message, /already been finalized/i);
  });

  await t.test('7. Download official PDF payslip stream directly', async () => {
    const res = await request(app)
      .get(`/api/payroll/payslip-pdf?employeeId=${testEmployee.employeeId}&month=10&year=2026`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.ok(res.body.length > 500);

    const pdf = res.body.toString('latin1');
    const content = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map((match) => {
        try {
          return zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');
    const pdfText = [...content.matchAll(/\[((?:.|\r|\n)*?)\]\s*TJ|<([0-9a-f]+)>\s*Tj/gi)]
      .map((match) => {
        const hexStrings = match[1]
          ? [...match[1].matchAll(/<([0-9a-f]+)>/gi)].map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
          : [Buffer.from(match[2], 'hex').toString('latin1')];
        return hexStrings.join('');
      })
      .join('\n');
    const labelPosition = pdfText.indexOf('NET TAKE-HOME SALARY PAYABLE:');
    const amountPosition = pdfText.indexOf('Rs.', labelPosition);
    const wordsPosition = pdfText.indexOf('In Words:', amountPosition);
    assert.ok(labelPosition >= 0 && amountPosition > labelPosition && wordsPosition > amountPosition);
    assert.ok(!pdfText.includes('(In Words:'));
  });
});
