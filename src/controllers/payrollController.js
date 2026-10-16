const PayrollRun = require('../models/PayrollRun');
const Employee = require('../models/Employee');
const EmployeePfRecord = require('../models/EmployeePfRecord');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');
const { round2, formatINR, numberToWordsINR } = require('../utils/financials');
const PDFDocument = require('pdfkit');

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Calculates a single employee's monthly pay according to working days, basic salary, allowances, and PF rules
 */
const calculateEmployeePayrollItem = (employee, daysConfig = {}) => {
  const s = employee.salaryStructure || {};
  const stat = employee.statutoryInfo || {};

  const totalWorkingDays = Number(daysConfig.totalWorkingDays) || 30;
  const paidDays = daysConfig.paidDays !== undefined ? Number(daysConfig.paidDays) : totalWorkingDays;
  const attendanceRatio = totalWorkingDays > 0 ? (paidDays / totalWorkingDays) : 1;

  // Pro-rated earnings
  const basicSalary = round2((Number(s.basicSalary) || 0) * attendanceRatio);
  const hra = round2((Number(s.hra) || 0) * attendanceRatio);
  const conveyanceAllowance = round2((Number(s.conveyanceAllowance) || 0) * attendanceRatio);
  const specialAllowance = round2((Number(s.specialAllowance) || 0) * attendanceRatio);
  const medicalAllowance = round2((Number(s.medicalAllowance) || 0) * attendanceRatio);
  const otherAllowances = round2((Number(s.otherAllowances) || 0) * attendanceRatio);

  const bonusOrIncentive = Number(daysConfig.bonusOrIncentive) || 0;
  const overtimeAmount = Number(daysConfig.overtimeAmount) || 0;

  const grossEarnings = round2(
    basicSalary + hra + conveyanceAllowance + specialAllowance + medicalAllowance + otherAllowances + bonusOrIncentive + overtimeAmount
  );

  // Provident Fund Calculation:
  // Standard statutory wage base in India is Basic Salary (plus Dearness Allowance if any).
  // If stat.pfWageLimitApplicable is true, cap pfWageBase at statutory ceiling Rs 15,000.
  let pfWageBase = basicSalary;
  if (stat.pfWageLimitApplicable && pfWageBase > 15000) {
    pfWageBase = 15000;
  }

  let employeePfContribution = 0;
  let employerPfContribution = 0;

  if (stat.isPfEligible !== false) {
    const empRate = Number(s.employeePfRate) !== undefined ? Number(s.employeePfRate) : 12;
    const emplyrRate = Number(s.employerPfRate) !== undefined ? Number(s.employerPfRate) : 12;

    employeePfContribution = round2((pfWageBase * empRate) / 100);
    employerPfContribution = round2((pfWageBase * emplyrRate) / 100);
  }

  const professionalTax = Number(s.professionalTax) || 0;
  const tdsDeduction = Number(daysConfig.tdsDeduction) !== undefined ? Number(daysConfig.tdsDeduction) : (Number(s.tdsEstimate) || 0);
  const otherDeductions = Number(daysConfig.otherDeductions) || 0;

  const totalEmployeeDeductions = round2(employeePfContribution + professionalTax + tdsDeduction + otherDeductions);
  const netSalaryPayable = round2(grossEarnings - totalEmployeeDeductions);
  const employerCostTotal = round2(grossEarnings + employerPfContribution);

  const b = employee.bankDetails || {};

  return {
    employee: employee._id,
    employeeId: employee.employeeId,
    employeeName: employee.fullName || `${employee.firstName} ${employee.lastName}`,
    department: employee.department,
    designation: employee.designation,
    panNumber: stat.panNumber || '',
    bankAccount: b.accountNumber || '',
    bankName: b.bankName || '',
    ifscCode: b.ifscCode || '',
    uan: stat.uan || '',
    pfAccountNumber: stat.pfAccountNumber || '',

    totalWorkingDays,
    paidDays,
    unpaidLeaveDays: Math.max(0, totalWorkingDays - paidDays),

    basicSalary,
    hra,
    conveyanceAllowance,
    specialAllowance,
    medicalAllowance,
    otherAllowances,
    bonusOrIncentive,
    overtimeAmount,
    grossEarnings,

    pfWageBase,
    employeePfContribution,
    professionalTax,
    tdsDeduction,
    otherDeductions,
    totalEmployeeDeductions,

    netSalaryPayable,
    employerPfContribution,
    employerCostTotal,

    paymentStatus: 'Pending',
    paymentMethod: 'Bank Transfer'
  };
};

// @desc    Get all payroll runs
// @route   GET /api/payroll
// @access  Private (Administrator, Finance)
exports.getPayrollRuns = async (req, res, next) => {
  try {
    const { year, status, sort = '-year -month' } = req.query;
    const query = {};

    if (year) query.year = Number(year);
    if (status) query.status = status;

    const runs = await PayrollRun.find(query).sort(sort);

    res.status(200).json({
      success: true,
      count: runs.length,
      data: runs
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single payroll run details
// @route   GET /api/payroll/:id
// @access  Private (Administrator, Finance)
exports.getPayrollRun = async (req, res, next) => {
  try {
    const run = await PayrollRun.findById(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Payroll run not found' });
    }

    res.status(200).json({
      success: true,
      data: run
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Preview or Initialize Monthly Payroll Run
// @route   POST /api/payroll/preview
// @access  Private (Administrator, Finance)
exports.previewMonthlyPayroll = async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const numMonth = Number(month);
    const numYear = Number(year);

    if (!numMonth || !numYear || numMonth < 1 || numMonth > 12) {
      return res.status(400).json({ success: false, message: 'Valid month (1-12) and year are required' });
    }

    // Check if payroll is already finalized for this month/year
    const existing = await PayrollRun.findOne({ month: numMonth, year: numYear });
    if (existing && existing.status === 'Finalized') {
      return res.status(400).json({
        success: false,
        message: `Payroll for ${MONTH_NAMES[numMonth]} ${numYear} has already been finalized (${existing.payrollCode}). Finalized payroll cannot be re-generated without an explicit reversal.`
      });
    }

    // Load all active or notice period employees
    const employees = await Employee.find({
      employmentStatus: { $in: ['Active', 'On Probation', 'Notice Period'] }
    });

    const items = employees.map((emp) => calculateEmployeePayrollItem(emp));

    const totalGrossEarnings = round2(items.reduce((acc, i) => acc + i.grossEarnings, 0));
    const totalEmployeePf = round2(items.reduce((acc, i) => acc + i.employeePfContribution, 0));
    const totalEmployerPf = round2(items.reduce((acc, i) => acc + i.employerPfContribution, 0));
    const totalDeductions = round2(items.reduce((acc, i) => acc + i.totalEmployeeDeductions, 0));
    const totalNetPayable = round2(items.reduce((acc, i) => acc + i.netSalaryPayable, 0));
    const totalEmployerCost = round2(items.reduce((acc, i) => acc + i.employerCostTotal, 0));

    res.status(200).json({
      success: true,
      periodName: `${MONTH_NAMES[numMonth]} ${numYear}`,
      month: numMonth,
      year: numYear,
      existingId: existing?._id || null,
      existingStatus: existing?.status || null,
      summary: {
        totalEmployees: items.length,
        totalGrossEarnings,
        totalEmployeePf,
        totalEmployerPf,
        totalPfContribution: round2(totalEmployeePf + totalEmployerPf),
        totalDeductions,
        totalNetPayable,
        totalEmployerCost
      },
      items
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Save or Finalize Payroll Run
// @route   POST /api/payroll/save
// @access  Private (Administrator, Finance)
exports.savePayrollRun = async (req, res, next) => {
  try {
    const { month, year, items, status = 'Draft', remarks } = req.body;
    const numMonth = Number(month);
    const numYear = Number(year);

    if (!numMonth || !numYear || !items || !items.length) {
      return res.status(400).json({ success: false, message: 'Month, year, and payroll items are required' });
    }

    // Check existing
    let run = await PayrollRun.findOne({ month: numMonth, year: numYear });
    if (run && run.status === 'Finalized') {
      return res.status(400).json({
        success: false,
        message: `Payroll for ${MONTH_NAMES[numMonth]} ${numYear} is already finalized and cannot be overwritten.`
      });
    }

    const totalGrossEarnings = round2(items.reduce((acc, i) => acc + (Number(i.grossEarnings) || 0), 0));
    const totalEmployeePf = round2(items.reduce((acc, i) => acc + (Number(i.employeePfContribution) || 0), 0));
    const totalEmployerPf = round2(items.reduce((acc, i) => acc + (Number(i.employerPfContribution) || 0), 0));
    const totalProfessionalTax = round2(items.reduce((acc, i) => acc + (Number(i.professionalTax) || 0), 0));
    const totalTdsDeductions = round2(items.reduce((acc, i) => acc + (Number(i.tdsDeduction) || 0), 0));
    const totalDeductions = round2(items.reduce((acc, i) => acc + (Number(i.totalEmployeeDeductions) || 0), 0));
    const totalNetPayable = round2(items.reduce((acc, i) => acc + (Number(i.netSalaryPayable) || 0), 0));
    const totalEmployerCost = round2(items.reduce((acc, i) => acc + (Number(i.employerCostTotal) || 0), 0));

    const totalAmountPaid = round2(items.reduce((acc, i) => acc + (i.paymentStatus === 'Paid' ? (Number(i.netSalaryPayable) || 0) : 0), 0));
    const totalPendingAmount = round2(totalNetPayable - totalAmountPaid);

    const periodName = `${MONTH_NAMES[numMonth]} ${numYear}`;

    if (!run) {
      const settings = await CompanySettings.findOne();
      const prefix = settings?.payrollPrefix || 'PAY-2026-';
      const seq = await getNextSequence('payrollRunId');
      const payrollCode = `${prefix}${String(seq).padStart(4, '0')}`;

      run = new PayrollRun({
        payrollCode,
        month: numMonth,
        year: numYear,
        periodName,
        createdBy: req.user._id
      });
    }

    run.items = items;
    run.totalEmployees = items.length;
    run.totalGrossEarnings = totalGrossEarnings;
    run.totalEmployeePf = totalEmployeePf;
    run.totalEmployerPf = totalEmployerPf;
    run.totalPfContribution = round2(totalEmployeePf + totalEmployerPf);
    run.totalProfessionalTax = totalProfessionalTax;
    run.totalTdsDeductions = totalTdsDeductions;
    run.totalDeductions = totalDeductions;
    run.totalNetPayable = totalNetPayable;
    run.totalEmployerCost = totalEmployerCost;
    run.totalAmountPaid = totalAmountPaid;
    run.totalPendingAmount = totalPendingAmount;
    run.status = status;
    run.remarks = remarks || run.remarks;

    if (status === 'Finalized') {
      run.finalizedAt = new Date();
      run.finalizedBy = req.user._id;

      // Automatically generate / update Employee PF Statutory records
      for (const itm of items) {
        if (itm.employeePfContribution > 0 || itm.employerPfContribution > 0) {
          const recCode = `PF-${numYear}-${String(numMonth).padStart(2, '0')}-${itm.employeeId}`;
          await EmployeePfRecord.findOneAndUpdate(
            { employee: itm.employee, month: numMonth, year: numYear },
            {
              recordCode: recCode,
              employee: itm.employee,
              employeeId: itm.employeeId,
              employeeName: itm.employeeName,
              uan: itm.uan,
              pfAccountNumber: itm.pfAccountNumber,
              payrollRun: run._id,
              month: numMonth,
              year: numYear,
              periodName,
              pfWageBase: itm.pfWageBase,
              employeeContribution: itm.employeePfContribution,
              employerContribution: itm.employerPfContribution,
              totalPfAmount: round2(itm.employeePfContribution + itm.employerPfContribution),
              remittanceStatus: 'Pending'
            },
            { upsert: true, new: true }
          );
        }
      }
    }

    await run.save();

    res.status(200).json({
      success: true,
      data: run,
      message: status === 'Finalized'
        ? `Payroll for ${periodName} finalized successfully. Statutory PF records posted.`
        : `Payroll draft for ${periodName} saved successfully.`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Record salary disbursement payment against an employee's payslip
// @route   POST /api/payroll/:id/pay/:employeeId
// @access  Private (Administrator, Finance)
exports.recordSalaryPayment = async (req, res, next) => {
  try {
    const { paymentDate, paymentMethod, paymentReference, remarks } = req.body;
    const run = await PayrollRun.findById(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Payroll run not found' });
    }

    const item = run.items.find(i => i.employee.toString() === req.params.employeeId || i.employeeId === req.params.employeeId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Employee payslip item not found in this payroll' });
    }

    item.paymentStatus = 'Paid';
    item.paymentDate = paymentDate || new Date();
    item.paymentMethod = paymentMethod || 'Bank Transfer';
    item.paymentReference = paymentReference || '';
    item.remarks = remarks || item.remarks;

    // Recalculate totals
    run.totalAmountPaid = round2(run.items.reduce((acc, i) => acc + (i.paymentStatus === 'Paid' ? i.netSalaryPayable : 0), 0));
    run.totalPendingAmount = round2(run.totalNetPayable - run.totalAmountPaid);

    await run.save();

    res.status(200).json({
      success: true,
      data: item,
      runSummary: {
        totalAmountPaid: run.totalAmountPaid,
        totalPendingAmount: run.totalPendingAmount
      },
      message: `Salary of ₹${item.netSalaryPayable} marked as Paid to ${item.employeeName}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Download Official Employee Payslip PDF
// @route   GET /api/payroll/:id/payslip/:employeeId/pdf
// @access  Private
exports.downloadPayslipPDF = async (req, res, next) => {
  try {
    const run = await PayrollRun.findById(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Payroll run not found' });
    }

    const item = run.items.find(i => i.employee.toString() === req.params.employeeId || i.employeeId === req.params.employeeId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Payslip item not found' });
    }

    const companySettings = await CompanySettings.findOne() || {};

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Payslip_${item.employeeId}_${run.month}_${run.year}.pdf"`);
    doc.pipe(res);

    const primaryColor = '#1e40af';
    const textColor = '#1f2937';

    // Header
    doc.fillColor(primaryColor).fontSize(18).text(companySettings.companyName || 'Innomatrics Technologies', 40, 40, { bold: true });
    doc.fillColor('#4b5563').fontSize(8.5).text(companySettings.tagline || 'Enterprise Cloud & Engineering Solutions', 40, 62);
    doc.text(`${companySettings.address || ''} | Email: ${companySettings.email || ''}`, 40, 74);

    doc.fillColor(primaryColor).fontSize(14).text('SALARY PAYSLIP', 380, 40, { align: 'right', bold: true });
    doc.fillColor(textColor).fontSize(9.5).text(`Pay Period: ${run.periodName}`, 380, 58, { align: 'right' });
    doc.text(`Payroll Ref: ${run.payrollCode}`, 380, 72, { align: 'right' });
    doc.text(`Disbursement: ${item.paymentStatus}`, 380, 86, { align: 'right' });

    doc.moveTo(40, 105).lineTo(555, 105).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // Employee Meta Grid Card
    doc.rect(40, 115, 515, 75).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('EMPLOYEE CREDENTIALS & WORK RECORD', 48, 122);
    
    doc.font('Helvetica').fontSize(8).fillColor(textColor);
    doc.text(`Employee ID: ${item.employeeId}`, 48, 138);
    doc.text(`Full Name: ${item.employeeName}`, 48, 150);
    doc.text(`Department: ${item.department || 'Engineering'}`, 48, 162);
    doc.text(`Designation: ${item.designation || 'Specialist'}`, 48, 174);

    doc.text(`Bank A/C: ${item.bankAccount || 'On File'}`, 230, 138);
    doc.text(`Bank Name: ${item.bankName || 'HDFC Bank'}`, 230, 150);
    doc.text(`IFSC Code: ${item.ifscCode || 'N/A'}`, 230, 162);
    doc.text(`PAN Number: ${item.panNumber || 'N/A'}`, 230, 174);

    doc.text(`Working Days: ${item.totalWorkingDays}`, 410, 138);
    doc.text(`Paid Days: ${item.paidDays}`, 410, 150);
    doc.text(`UAN: ${item.uan || 'N/A'}`, 410, 162);
    doc.text(`PF Number: ${item.pfAccountNumber || 'N/A'}`, 410, 174);

    // Earnings & Deductions Dual Table
    let tableY = 205;
    const colWidth = 250;

    // Table Headers
    doc.rect(40, tableY, colWidth, 20).fill('#2563eb');
    doc.rect(305, tableY, colWidth, 20).fill('#dc2626');
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
    doc.text('EARNINGS & ALLOWANCES', 48, tableY + 5);
    doc.text('AMOUNT (Rs.)', 215, tableY + 5, { align: 'right', width: 70 });
    doc.text('STATUTORY & OTHER DEDUCTIONS', 313, tableY + 5);
    doc.text('AMOUNT (Rs.)', 480, tableY + 5, { align: 'right', width: 70 });

    tableY += 20;

    const earnings = [
      { label: 'Basic Salary', val: item.basicSalary },
      { label: 'House Rent Allowance (HRA)', val: item.hra },
      { label: 'Conveyance Allowance', val: item.conveyanceAllowance },
      { label: 'Special Allowance', val: item.specialAllowance },
      { label: 'Medical Allowance', val: item.medicalAllowance },
      { label: 'Bonus / Incentive', val: item.bonusOrIncentive },
      { label: 'Overtime / Other Allowances', val: (item.overtimeAmount || 0) + (item.otherAllowances || 0) }
    ];

    const deductions = [
      { label: 'Employee PF Contribution (12%)', val: item.employeePfContribution },
      { label: 'Professional Tax (PT)', val: item.professionalTax },
      { label: 'TDS / Income Tax Withheld', val: item.tdsDeduction },
      { label: 'Other Voluntary Deductions', val: item.otherDeductions },
      { label: '-', val: 0 },
      { label: '-', val: 0 },
      { label: '-', val: 0 }
    ];

    const formatNum = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    for (let r = 0; r < earnings.length; r++) {
      const rowBg = r % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(40, tableY, colWidth, 18).fill(rowBg);
      doc.rect(305, tableY, colWidth, 18).fill(rowBg);

      doc.fillColor(textColor).fontSize(8).font('Helvetica');
      doc.text(earnings[r].label, 48, tableY + 4);
      doc.text(formatNum(earnings[r].val), 215, tableY + 4, { align: 'right', width: 70 });

      if (deductions[r].label !== '-') {
        doc.text(deductions[r].label, 313, tableY + 4);
        doc.text(formatNum(deductions[r].val), 480, tableY + 4, { align: 'right', width: 70 });
      }

      tableY += 18;
    }

    // Totals Row
    doc.rect(40, tableY, colWidth, 20).fill('#eff6ff');
    doc.rect(305, tableY, colWidth, 20).fill('#fef2f2');
    doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(8.5);
    doc.text('TOTAL GROSS EARNINGS', 48, tableY + 5);
    doc.text(`Rs. ${formatNum(item.grossEarnings)}`, 190, tableY + 5, { align: 'right', width: 95 });

    doc.fillColor('#b91c1c');
    doc.text('TOTAL DEDUCTIONS', 313, tableY + 5);
    doc.text(`Rs. ${formatNum(item.totalEmployeeDeductions)}`, 455, tableY + 5, { align: 'right', width: 95 });

    tableY += 30;

    // Net Salary Callout Box
    doc.rect(40, tableY, 515, 45).fillAndStroke('#ecfdf5', '#10b981');
    doc.fillColor('#065f46').fontSize(10).font('Helvetica-Bold').text('NET TAKE-HOME SALARY PAYABLE:', 55, tableY + 10);
    doc.fontSize(16).text(`Rs. ${formatNum(item.netSalaryPayable)}`, 55, tableY + 23);
    doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#047857')
      .text(`(In Words: ${numberToWordsINR(item.netSalaryPayable)})`, 240, tableY + 16, { width: 300 });

    // Employer Contribution Note
    tableY += 60;
    doc.rect(40, tableY, 515, 30).fill('#f8fafc');
    doc.fillColor('#4b5563').fontSize(8).font('Helvetica')
      .text(`Employer Statutory Contribution: Employer PF Contribution = Rs. ${formatNum(item.employerPfContribution)} | Total Cost to Company (CTC) = Rs. ${formatNum(item.employerCostTotal)}`, 48, tableY + 9);

    // Signatures
    const sigY = 700;
    doc.moveTo(40, sigY).lineTo(180, sigY).strokeColor('#9ca3af').stroke();
    doc.fontSize(8).fillColor('#64748b').text('Employee Signature', 40, sigY + 5);

    doc.moveTo(415, sigY).lineTo(555, sigY).strokeColor('#9ca3af').stroke();
    doc.fontSize(8).text('Authorized HR / Finance Signatory', 415, sigY + 5, { align: 'right' });

    doc.end();
  } catch (error) {
    next(error);
  }
};
