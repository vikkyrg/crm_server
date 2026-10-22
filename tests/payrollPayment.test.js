const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = require('../src/app');
const User = require('../src/models/User');
const Employee = require('../src/models/Employee');
const PayrollRun = require('../src/models/PayrollRun');
const EmployeePfRecord = require('../src/models/EmployeePfRecord');

test('Salary & Payroll Payment Disbursement Recording Suite', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);

  const admin = await User.findOne({ role: 'Administrator' });
  const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const uniqueId = `TST-${Date.now()}`;
  let testEmployee;
  let testPayrollRun;

  t.after(async () => {
    if (testPayrollRun) await PayrollRun.findByIdAndDelete(testPayrollRun._id);
    if (testEmployee) await Employee.findByIdAndDelete(testEmployee._id);
    await mongoose.disconnect();
  });

  await t.test('1. Setup employee and payroll run with Pending payment status', async () => {
    testEmployee = await Employee.create({
      employeeId: `EMP-${uniqueId}`,
      fullName: 'Regression Tester',
      email: `reg_${uniqueId}@innomatrics.test`,
      phone: '9988776655',
      department: 'Engineering',
      designation: 'Staff QA',
      joiningDate: new Date('2024-01-01'),
      employmentStatus: 'Active',
      basicSalary: 30000,
      hra: 15000,
      specialAllowance: 5000,
      professionalTax: 200,
      employeePfRate: 12,
      employerPfRate: 12,
      isPfEligible: true,
      pfWageLimitApplicable: true
    });

    testPayrollRun = await PayrollRun.create({
      payrollCode: `PAY-TEST-${uniqueId}`,
      month: 12,
      year: 2026,
      periodName: 'December 2026',
      totalEmployees: 1,
      totalGrossEarnings: 50000,
      totalEmployeePf: 1800,
      totalEmployerPf: 1800,
      totalProfessionalTax: 200,
      totalNetPayable: 48000,
      totalAmountPaid: 0,
      totalPendingAmount: 48000,
      status: 'Finalized',
      items: [
        {
          employee: testEmployee._id,
          employeeId: testEmployee.employeeId,
          employeeName: 'Regression Tester',
          designation: 'Staff QA',
          grossEarnings: 50000,
          employeePfContribution: 1800,
          employerPfContribution: 1800,
          professionalTax: 200,
          totalEmployeeDeductions: 2000,
          netSalaryPayable: 48000,
          paymentStatus: 'Pending'
        }
      ]
    });

    assert.ok(testPayrollRun._id);
    assert.equal(testPayrollRun.items[0].paymentStatus, 'Pending');
  });

  await t.test('2. Reject payment without transaction reference (HTTP 400)', async () => {
    const res = await request(app)
      .post(`/api/payroll/${testPayrollRun._id}/employees/${testEmployee.employeeId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentDate: '2026-12-31',
        paymentMethod: 'Bank Transfer (NEFT/IMPS)',
        transactionReference: ''
      });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Transaction reference or bank UTR/i);
  });

  await t.test('3. Successfully record disbursement with "Bank Transfer (NEFT/IMPS)" (HTTP 200)', async () => {
    const testUtr = `UTR-${uniqueId}-001`;
    const res = await request(app)
      .post(`/api/payroll/${testPayrollRun._id}/employees/${testEmployee.employeeId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentDate: '2026-12-31',
        paymentMethod: 'Bank Transfer (NEFT/IMPS)',
        transactionReference: testUtr
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.paymentStatus, 'Paid');
    assert.equal(res.body.data.paymentReference, testUtr);
    assert.equal(res.body.data.paymentMethod, 'Bank Transfer (NEFT/IMPS)');

    // Verify in MongoDB
    const persisted = await PayrollRun.findById(testPayrollRun._id);
    const item = persisted.items.find(i => i.employeeId === testEmployee.employeeId);
    assert.equal(item.paymentStatus, 'Paid');
    assert.equal(item.paymentReference, testUtr);
    assert.equal(persisted.totalAmountPaid, 48000);
    assert.equal(persisted.totalPendingAmount, 0);
  });

  await t.test('4. Prevent duplicate payment submission (HTTP 400)', async () => {
    const res = await request(app)
      .post(`/api/payroll/${testPayrollRun._id}/employees/${testEmployee.employeeId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentDate: '2026-12-31',
        paymentMethod: 'Bank Transfer (NEFT/IMPS)',
        transactionReference: `UTR-${uniqueId}-DUP`
      });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /already been recorded as Paid/i);
  });

  await t.test('5. Verify single payroll fetch returns updated status for modal refresh', async () => {
    const res = await request(app)
      .get(`/api/payroll/${testPayrollRun._id}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const fetchedRun = res.body.data;
    assert.equal(fetchedRun.items[0].paymentStatus, 'Paid');
    assert.equal(fetchedRun.totalAmountPaid, 48000);
    assert.equal(fetchedRun.paymentStatus, 'Paid');
  });

  await t.test('6. Multi-employee batch workflow: Pending -> Partially Paid -> Paid', async () => {
    // Create a multi-employee batch
    const emp2 = await Employee.create({
      employeeId: `EMP2-${uniqueId}`,
      fullName: 'Second Tester',
      email: `reg2_${uniqueId}@innomatrics.test`,
      phone: '9988776656',
      department: 'Engineering',
      designation: 'Senior QA',
      joiningDate: new Date('2024-01-01'),
      employmentStatus: 'Active',
      basicSalary: 40000,
      hra: 20000,
      specialAllowance: 5000,
      professionalTax: 200,
      employeePfRate: 12,
      employerPfRate: 12,
      isPfEligible: true,
      pfWageLimitApplicable: true
    });

    const multiRun = await PayrollRun.create({
      payrollCode: `PAY-MULTI-${uniqueId}`,
      month: 11,
      year: 2026,
      periodName: 'November 2026',
      totalEmployees: 2,
      totalGrossEarnings: 115000,
      totalEmployeePf: 3600,
      totalEmployerPf: 3600,
      totalProfessionalTax: 400,
      totalNetPayable: 111000,
      totalAmountPaid: 0,
      totalPendingAmount: 111000,
      status: 'Draft',
      items: [
        {
          employee: testEmployee._id,
          employeeId: testEmployee.employeeId,
          employeeName: 'Regression Tester',
          designation: 'Staff QA',
          grossEarnings: 50000,
          employeePfContribution: 1800,
          employerPfContribution: 1800,
          professionalTax: 200,
          totalEmployeeDeductions: 2000,
          netSalaryPayable: 48000,
          paymentStatus: 'Pending'
        },
        {
          employee: emp2._id,
          employeeId: emp2.employeeId,
          employeeName: 'Second Tester',
          designation: 'Senior QA',
          grossEarnings: 65000,
          employeePfContribution: 1800,
          employerPfContribution: 1800,
          professionalTax: 200,
          totalEmployeeDeductions: 2000,
          netSalaryPayable: 63000,
          paymentStatus: 'Pending'
        }
      ]
    });

    // Step A: Initially Pending
    let listRes = await request(app).get('/api/payroll').set('Authorization', `Bearer ${token}`);
    let target = listRes.body.data.find(r => r.payrollCode === multiRun.payrollCode);
    assert.equal(target.paymentStatus, 'Pending');
    assert.equal(target.status, 'Draft'); // Lifecycle status remains Draft

    // Step B: Pay first employee -> should become Partially Paid
    const pay1 = await request(app)
      .post(`/api/payroll/${multiRun._id}/employees/${testEmployee.employeeId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentDate: '2026-11-30',
        paymentMethod: 'Bank Transfer (NEFT/IMPS)',
        transactionReference: `UTR-MULTI-01-${uniqueId}`
      });
    assert.equal(pay1.status, 200);
    assert.equal(pay1.body.run.paymentStatus, 'Partially Paid');
    assert.equal(pay1.body.run.status, 'Draft'); // Lifecycle unchanged

    listRes = await request(app).get('/api/payroll').set('Authorization', `Bearer ${token}`);
    target = listRes.body.data.find(r => r.payrollCode === multiRun.payrollCode);
    assert.equal(target.paymentStatus, 'Partially Paid');
    assert.equal(target.status, 'Draft');

    // Step C: Failed duplicate or empty reference attempt does not change status
    const failAttempt = await request(app)
      .post(`/api/payroll/${multiRun._id}/employees/${emp2.employeeId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentDate: '2026-11-30',
        paymentMethod: 'Bank Transfer (NEFT/IMPS)',
        transactionReference: ''
      });
    assert.equal(failAttempt.status, 400);

    const checkMid = await request(app).get(`/api/payroll/${multiRun._id}`).set('Authorization', `Bearer ${token}`);
    assert.equal(checkMid.body.data.paymentStatus, 'Partially Paid');

    // Step D: Pay second employee -> should become Paid
    const pay2 = await request(app)
      .post(`/api/payroll/${multiRun._id}/employees/${emp2.employeeId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentDate: '2026-11-30',
        paymentMethod: 'Bank Transfer (NEFT/IMPS)',
        transactionReference: `UTR-MULTI-02-${uniqueId}`
      });
    assert.equal(pay2.status, 200);
    assert.equal(pay2.body.run.paymentStatus, 'Paid');

    // Step E: Verify both list and single get return Paid and Draft
    listRes = await request(app).get('/api/payroll').set('Authorization', `Bearer ${token}`);
    target = listRes.body.data.find(r => r.payrollCode === multiRun.payrollCode);
    assert.equal(target.paymentStatus, 'Paid');
    assert.equal(target.status, 'Draft');

    const singleRes = await request(app).get(`/api/payroll/${multiRun._id}`).set('Authorization', `Bearer ${token}`);
    assert.equal(singleRes.body.data.paymentStatus, 'Paid');

    // Clean up second employee and multi run
    await PayrollRun.findByIdAndDelete(multiRun._id);
    await Employee.findByIdAndDelete(emp2._id);
  });

  await t.test('7. Payroll Finalization -> Statutory PF Record Creation -> Employee PF Page Retrieval', async () => {
    // 1. Create a draft payroll run with unique period
    const testMonth = 8;
    const testYear = 2026;
    const draftRun = await PayrollRun.create({
      payrollCode: `PAY-FIN-${uniqueId}`,
      month: testMonth,
      year: testYear,
      periodName: 'August 2026',
      totalEmployees: 1,
      totalGrossEarnings: 52850,
      totalEmployeePf: 1800,
      totalEmployerPf: 1800,
      totalProfessionalTax: 200,
      totalNetPayable: 50850,
      totalAmountPaid: 50850,
      totalPendingAmount: 0,
      status: 'Draft',
      paymentStatus: 'Paid',
      items: [
        {
          employee: testEmployee._id,
          employeeId: testEmployee.employeeId,
          employeeName: testEmployee.fullName,
          designation: testEmployee.designation,
          uan: '100987654321',
          pfAccountNumber: 'DL/CPM/0099887/000/0001234',
          pfWageBase: 15000,
          grossEarnings: 52850,
          employeePfContribution: 1800,
          employerPfContribution: 1800,
          epsContribution: 1250,
          epfDifference: 550,
          professionalTax: 200,
          totalEmployeeDeductions: 2000,
          netSalaryPayable: 50850,
          paymentStatus: 'Paid'
        }
      ]
    });

    // Verify initially no PF records exist for this period
    let pfPageRes = await request(app)
      .get(`/api/employee-pf?periodMonth=${testMonth}&periodYear=${testYear}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(pfPageRes.status, 200);
    const beforeRecords = (pfPageRes.body.records || pfPageRes.body.data || []).filter(
      r => r.employeeId === testEmployee.employeeId
    );
    assert.equal(beforeRecords.length, 0, 'No PF records before finalization');

    // 2. Finalize the payroll batch via endpoint
    const finalizeRes = await request(app)
      .post(`/api/payroll/${draftRun._id}/finalize`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(finalizeRes.status, 200);
    assert.equal(finalizeRes.body.success, true);
    assert.equal(finalizeRes.body.data.status, 'Finalized');

    // 3. Verify statutory PF record created in MongoDB
    const pfRecord = await EmployeePfRecord.findOne({
      employeeId: testEmployee.employeeId,
      month: testMonth,
      year: testYear
    });
    assert.ok(pfRecord, 'PF record must be created in DB');
    assert.equal(pfRecord.pfWageBase, 15000);
    assert.equal(pfRecord.employeeContribution, 1800);
    assert.equal(pfRecord.employerContribution, 1800);
    assert.equal(pfRecord.totalPfAmount, 3600);
    assert.equal(pfRecord.epsContribution, 1250);
    assert.equal(pfRecord.epfDifference, 550);
    assert.equal(pfRecord.remittanceStatus, 'Pending');
    assert.equal(pfRecord.uan, '100987654321');
    assert.equal(pfRecord.pfAccountNumber, 'DL/CPM/0099887/000/0001234');

    // 4. Retry finalization (duplicate safeguard check)
    const retryRes = await request(app)
      .post(`/api/payroll/${draftRun._id}/finalize`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(retryRes.status, 400, 'Duplicate finalization rejected');

    const pfRecordCount = await EmployeePfRecord.countDocuments({
      employeeId: testEmployee.employeeId,
      month: testMonth,
      year: testYear
    });
    assert.equal(pfRecordCount, 1, 'Duplicate records must not be created');

    // 5. Query Employee PF page API with filters and search
    pfPageRes = await request(app)
      .get(`/api/employee-pf?periodMonth=${testMonth}&periodYear=${testYear}&search=${testEmployee.employeeId}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(pfPageRes.status, 200);
    const retrieved = (pfPageRes.body.records || pfPageRes.body.data || []);
    assert.equal(retrieved.length, 1);
    assert.equal(retrieved[0].employeeId, testEmployee.employeeId);
    assert.equal(retrieved[0].employeeContribution, 1800);
    assert.equal(retrieved[0].employerContribution, 1800);
    assert.equal(retrieved[0].totalPfAmount, 3600);

    // Clean up
    await EmployeePfRecord.deleteMany({ employeeId: testEmployee.employeeId });
    await PayrollRun.findByIdAndDelete(draftRun._id);
  });

  await t.test('8. Employee PF Remittance Workflow: Pending -> Remitted & Duplicate Prevention & Independence', async () => {
    const remitMonth = 7;
    const remitYear = 2026;
    const testTrrn = `TRRN-TEST-${Date.now()}`;

    // 1. Setup a payroll run where employee salary is marked Paid
    const payrollPaid = await PayrollRun.create({
      payrollCode: `PAY-REMIT-${uniqueId}`,
      month: remitMonth,
      year: remitYear,
      periodName: 'July 2026',
      totalEmployees: 1,
      totalGrossEarnings: 52850,
      totalEmployeePf: 1800,
      totalEmployerPf: 1800,
      totalProfessionalTax: 200,
      totalNetPayable: 50850,
      totalAmountPaid: 50850,
      totalPendingAmount: 0,
      status: 'Finalized',
      paymentStatus: 'Paid',
      items: [
        {
          employee: testEmployee._id,
          employeeId: testEmployee.employeeId,
          employeeName: testEmployee.fullName,
          designation: testEmployee.designation,
          grossEarnings: 52850,
          pfWageBase: 15000,
          employeePfContribution: 1800,
          employerPfContribution: 1800,
          epsContribution: 1250,
          epfDifference: 550,
          professionalTax: 200,
          totalEmployeeDeductions: 2000,
          netSalaryPayable: 50850,
          paymentStatus: 'Paid'
        }
      ]
    });

    // 2. Setup the statutory PF record generated upon finalization
    const pfRecord = await EmployeePfRecord.create({
      recordCode: `PF-2026-07-${testEmployee.employeeId}`,
      employee: testEmployee._id,
      employeeId: testEmployee.employeeId,
      employeeName: testEmployee.fullName,
      uan: '100987654321',
      pfAccountNumber: 'DL/CPM/0099887/000/0001234',
      payrollRun: payrollPaid._id,
      month: remitMonth,
      year: remitYear,
      periodName: 'July 2026',
      pfWageBase: 15000,
      employeeContribution: 1800,
      employerContribution: 1800,
      epsContribution: 1250,
      epfDifference: 550,
      totalPfAmount: 3600,
      remittanceStatus: 'Pending'
    });

    // Requirement 1 & 5 Check: Employee salary is Paid, but PF remittance is strictly Pending
    assert.equal(payrollPaid.paymentStatus, 'Paid');
    assert.equal(pfRecord.remittanceStatus, 'Pending');
    assert.equal(pfRecord.challanNumber, undefined);

    // Requirement 2 Check: Call pending summary to inspect eligible records and total amount
    const summaryRes = await request(app)
      .get(`/api/employee-pf/pending-summary?periodMonth=${remitMonth}&periodYear=${remitYear}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(summaryRes.status, 200);
    assert.equal(summaryRes.body.pendingCount, 1);
    assert.equal(summaryRes.body.summary.totalDeposit, 3600);
    assert.equal(summaryRes.body.summary.totalEmployeeShare, 1800);
    assert.equal(summaryRes.body.summary.totalEmployerShare, 1800);

    // Reject remittance without TRRN / Challan reference
    const missingTrrnRes = await request(app)
      .post('/api/employee-pf/remit-period')
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodMonth: remitMonth,
        periodYear: remitYear,
        challanTrrn: '',
        remittanceDate: '2026-08-15'
      });
    assert.equal(missingTrrnRes.status, 400);

    // Requirement 3 Check: Confirm remittance with valid TRRN
    const remitRes = await request(app)
      .post('/api/employee-pf/remit-period')
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodMonth: remitMonth,
        periodYear: remitYear,
        challanTrrn: testTrrn,
        remittanceDate: '2026-08-15',
        bankReference: 'HDFC-NEFT-998877',
        notes: 'EPFO portal July remittance'
      });
    assert.equal(remitRes.status, 200);
    assert.equal(remitRes.body.success, true);
    assert.equal(remitRes.body.remittedCount, 1);

    // Verify in MongoDB that PF record is now Remitted with TRRN reference
    const remittedRecord = await EmployeePfRecord.findById(pfRecord._id);
    assert.equal(remittedRecord.remittanceStatus, 'Remitted');
    assert.equal(remittedRecord.challanNumber, testTrrn);
    assert.equal(remittedRecord.bankReference, 'HDFC-NEFT-998877');

    // Requirement 4 Check: Duplicate remittance prevention
    const dupRemitRes = await request(app)
      .post('/api/employee-pf/remit-period')
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodMonth: remitMonth,
        periodYear: remitYear,
        challanTrrn: `${testTrrn}-DUP`,
        remittanceDate: '2026-08-15'
      });
    assert.equal(dupRemitRes.status, 400);
    assert.match(dupRemitRes.body.message, /already been remitted|Duplicate remittance is not permitted/i);

    // Pending summary now reports 0 pending and 1 already remitted
    const postSummary = await request(app)
      .get(`/api/employee-pf/pending-summary?periodMonth=${remitMonth}&periodYear=${remitYear}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(postSummary.body.pendingCount, 0);
    assert.equal(postSummary.body.alreadyRemittedCount, 1);

    // Clean up
    await EmployeePfRecord.findByIdAndDelete(pfRecord._id);
    await PayrollRun.findByIdAndDelete(payrollPaid._id);
  });

  await t.test('9. Immutability & Consistency: historical finalized payroll remains unchanged after employee/settings edits', async () => {
    // Create an employee with basic 20000, gross 25000
    const immutEmp = await Employee.create({
      employeeId: `EMP-IMM-${uniqueId}`,
      fullName: 'Historical Integrity Emp',
      email: `imm_${uniqueId}@innomatrics.test`,
      phone: '9876543210',
      designation: 'Integrity Tester',
      department: 'Engineering',
      joiningDate: new Date('2025-01-01'),
      employmentStatus: 'Active',
      salaryStructure: {
        basicSalary: 20000,
        hra: 5000,
        grossSalaryMonthly: 25000
      },
      statutoryInfo: {
        pfApplicable: true,
        isPfEligible: true,
        pfWageBasis: 'Basic',
        restrictPfWageLimit: true,
        pfWageLimitApplicable: true,
        esiApplicable: true,
        isEsiEligible: true,
        esiEligibilityConfirmed: true,
        esiWageBasis: 'Gross'
      }
    });

    const targetMonth = 9; // September
    const targetYear = 2026;

    // 1. Get preview
    const previewRes = await request(app)
      .post('/api/payroll/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ month: targetMonth, year: targetYear });
    assert.equal(previewRes.status, 200);

    const empPreviewItem = previewRes.body.items.find(i => String(i.employee) === String(immutEmp._id));
    assert.ok(empPreviewItem, 'Employee found in preview');
    const origEmployeePf = empPreviewItem.employeePfContribution;
    const origNetSalary = empPreviewItem.netSalaryPayable;

    // 2. Finalize payroll
    const saveRes = await request(app)
      .post('/api/payroll')
      .set('Authorization', `Bearer ${token}`)
      .send({
        month: targetMonth,
        year: targetYear,
        items: previewRes.body.items,
        status: 'Finalized',
        notes: 'Finalized audit batch'
      });
    assert.equal(saveRes.status, 200);
    const finalizedRun = saveRes.body.data;
    const finalizedItem = finalizedRun.items.find(i => String(i.employee) === String(immutEmp._id));

    // Verify preview and finalized payroll use identical values
    assert.equal(finalizedItem.employeePfContribution, origEmployeePf);
    assert.equal(finalizedItem.netSalaryPayable, origNetSalary);

    // 3. Edit employee salary structure in MongoDB (e.g. raise salary)
    immutEmp.salaryStructure.basicSalary = 40000;
    immutEmp.salaryStructure.grossSalaryMonthly = 60000;
    await immutEmp.save();

    // 4. Reload finalized payroll from backend API and MongoDB
    const reloadedRunRes = await request(app)
      .get(`/api/payroll/${finalizedRun._id}`)
      .set('Authorization', `Bearer ${token}`);
    assert.equal(reloadedRunRes.status, 200);
    const reloadedItem = reloadedRunRes.body.data.items.find(i => String(i.employee) === String(immutEmp._id));

    // Verify historical finalized payroll did NOT change despite employee salary modification
    assert.equal(reloadedItem.basicSalary, 20000);
    assert.equal(reloadedItem.employeePfContribution, origEmployeePf);
    assert.equal(reloadedItem.netSalaryPayable, origNetSalary);

    // Clean up
    await PayrollRun.findByIdAndDelete(finalizedRun._id);
    await Employee.findByIdAndDelete(immutEmp._id);
  });
});

