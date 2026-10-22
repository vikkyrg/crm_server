const PayrollRun = require('../models/PayrollRun');
const mongoose = require('mongoose');
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

const toCalendarDateString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  // If the date has local year/month/day, format as YYYY-MM-DD
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Calculates a single employee's monthly pay according to working days, basic salary, allowances, and PF rules
 */
const calculateEmployeePayrollItem = (employee, daysConfig = {}, statutoryRules = {}, period = {}) => {
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

  const periodStartStr = toCalendarDateString(period.startDate);
  const periodEndStr = toCalendarDateString(period.endDate);

  const rulesApply = (rule) => {
    if (!rule || !periodStartStr || !periodEndStr || !rule.effectiveFrom) return false;
    const fromStr = toCalendarDateString(rule.effectiveFrom);
    const toStr = toCalendarDateString(rule.effectiveTo);
    if (!fromStr) return false;
    return fromStr <= periodStartStr && (!toStr || toStr >= periodEndStr);
  };
  const pfRules = statutoryRules.pf || {};
  const esiRules = statutoryRules.esi || {};
  const hasConfiguredNumber = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
  const pfLimitEnabled = Boolean(stat.pfWageLimitApplicable || stat.restrictPfWageLimit);
  const pfConfigured = rulesApply(pfRules) &&
    (!pfLimitEnabled || hasConfiguredNumber(pfRules.wageCeiling));
  const esiConfigured = rulesApply(esiRules) && hasConfiguredNumber(esiRules.wageCeiling);

  let pfWageBase = stat.pfWageBasis === 'Gross' ? grossEarnings : basicSalary;
  if (pfLimitEnabled && hasConfiguredNumber(pfRules.wageCeiling)) {
    pfWageBase = Math.min(pfWageBase, Number(pfRules.wageCeiling));
  }
  pfWageBase = round2(pfWageBase);

  let employeePfContribution = 0;
  let employerPfContribution = 0;
  let epsContribution = 0;
  let epfDifference = 0;

  const pfApplicable = stat.pfApplicable === undefined
    ? stat.isPfEligible === true
    : stat.pfApplicable === true;
  const employeePfRate = pfRules.employeeRate;
  const employerPfRate = pfRules.employerRate;
  const pfRatesConfigured = hasConfiguredNumber(employeePfRate) && hasConfiguredNumber(employerPfRate);
  if (pfApplicable && stat.isPfEligible !== false && pfConfigured && pfRatesConfigured) {
    const empRate = Number(employeePfRate);
    const emplyrRate = Number(employerPfRate);
    employeePfContribution = round2((pfWageBase * empRate) / 100);
    employerPfContribution = round2((pfWageBase * emplyrRate) / 100);

    const epsRate = hasConfiguredNumber(pfRules.epsRate) ? Number(pfRules.epsRate) : 0;
    epsContribution = round2((pfWageBase * epsRate) / 100);
    epfDifference = round2(Math.max(0, employerPfContribution - epsContribution));
  }

  const esiWageBase = round2(stat.esiWageBasis === 'Basic' ? basicSalary : grossEarnings);
  const employeeEsiRate = esiRules.employeeRate;
  const employerEsiRate = esiRules.employerRate;
  const esiRatesConfigured = hasConfiguredNumber(employeeEsiRate) && hasConfiguredNumber(employerEsiRate);
  const esiWithinConfiguredCeiling = !hasConfiguredNumber(esiRules.wageCeiling) ||
    esiWageBase <= Number(esiRules.wageCeiling);
  const esiEligible = stat.esiApplicable === true &&
    stat.isEsiEligible === true &&
    stat.esiEligibilityConfirmed === true &&
    esiConfigured &&
    esiRatesConfigured &&
    esiWithinConfiguredCeiling;
  const employeeEsiContribution = esiEligible
    ? round2((esiWageBase * Number(employeeEsiRate)) / 100)
    : 0;
  const employerEsiContribution = esiEligible
    ? round2((esiWageBase * Number(employerEsiRate)) / 100)
    : 0;

  let esiReason = 'Eligible and calculated';
  if (stat.esiApplicable !== true) {
    esiReason = 'ESI not applicable for employee';
  } else if (stat.isEsiEligible !== true || stat.esiEligibilityConfirmed !== true) {
    esiReason = 'ESI eligibility not confirmed';
  } else if (!rulesApply(esiRules)) {
    esiReason = 'No effective statutory ESI rules configured for this payroll period';
  } else if (!esiRatesConfigured) {
    esiReason = 'Statutory ESI employee/employer rates not fully configured';
  } else if (!esiWithinConfiguredCeiling) {
    const basisLabel = stat.esiWageBasis === 'Basic' ? 'Basic' : 'Gross';
    esiReason = `${basisLabel} wages (₹${esiWageBase.toLocaleString('en-IN')}) exceed statutory ESI wage ceiling (₹${Number(esiRules.wageCeiling).toLocaleString('en-IN')})`;
  }

  let pfReason = 'Eligible and calculated';
  if (!pfApplicable) {
    pfReason = 'PF not applicable for employee';
  } else if (stat.isPfEligible === false) {
    pfReason = 'Employee marked ineligible for PF';
  } else if (!rulesApply(pfRules)) {
    pfReason = 'No effective statutory PF rules configured for this payroll period';
  } else if (!pfRatesConfigured) {
    pfReason = 'Statutory PF employee/employer rates not fully configured';
  } else if (pfLimitEnabled && !hasConfiguredNumber(pfRules.wageCeiling)) {
    pfReason = 'PF wage limit enabled but statutory wage ceiling not configured';
  }

  const professionalTax = Number(s.professionalTax) || 0;
  const tdsDeduction = Number.isFinite(Number(daysConfig.tdsDeduction))
    ? Number(daysConfig.tdsDeduction)
    : (Number(s.tdsMonthly ?? s.tdsEstimate) || 0);
  const otherDeductions = Number.isFinite(Number(daysConfig.otherDeductions))
    ? Number(daysConfig.otherDeductions)
    : 0;

  const totalEmployeeDeductions = round2(employeePfContribution + employeeEsiContribution + professionalTax + tdsDeduction + otherDeductions);
  const netSalaryPayable = round2(grossEarnings - totalEmployeeDeductions);
  const employerCostTotal = round2(grossEarnings + employerPfContribution + employerEsiContribution);

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
    esiNumber: stat.esiInsuranceNumber || stat.esiNumber || '',

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
    esiWageBase,
    employeePfContribution,
    employeeEsiContribution,
    professionalTax,
    tdsDeduction,
    otherDeductions,
    totalEmployeeDeductions,

    netSalaryPayable,
    employerPfContribution,
    employerEsiContribution,
    epsContribution,
    epfDifference,
    employerCostTotal,
    statutoryCalculation: {
      estimate: true,
      pf: {
        applicable: pfApplicable,
        eligible: pfApplicable && stat.isPfEligible !== false,
        configured: pfConfigured && pfRatesConfigured,
        wageCeilingApplied: pfLimitEnabled && hasConfiguredNumber(pfRules.wageCeiling),
        employeeRate: pfConfigured && pfRatesConfigured ? Number(employeePfRate) : null,
        employerRate: pfConfigured && pfRatesConfigured ? Number(employerPfRate) : null,
        wageCeiling: hasConfiguredNumber(pfRules.wageCeiling) ? Number(pfRules.wageCeiling) : null,
        effectiveFrom: pfRules.effectiveFrom || null,
        effectiveTo: pfRules.effectiveTo || null,
        reason: pfReason
      },
      esi: {
        applicable: stat.esiApplicable === true,
        eligible: esiEligible,
        configured: esiConfigured && esiRatesConfigured,
        employeeRate: esiConfigured && esiRatesConfigured ? Number(employeeEsiRate) : null,
        employerRate: esiConfigured && esiRatesConfigured ? Number(employerEsiRate) : null,
        wageCeiling: hasConfiguredNumber(esiRules.wageCeiling) ? Number(esiRules.wageCeiling) : null,
        effectiveFrom: esiRules.effectiveFrom || null,
        effectiveTo: esiRules.effectiveTo || null,
        reason: esiReason
      }
    },
    pfRemittanceStatus: pfApplicable && employeePfContribution + employerPfContribution > 0 ? 'Pending' : 'Not Applicable',
    esiRemittanceStatus: esiEligible && employeeEsiContribution + employerEsiContribution > 0 ? 'Pending' : 'Not Applicable',

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

    // Ensure paymentStatus is strictly derived and populated for any historical records
    const normalizedRuns = runs.map((run) => {
      const obj = run.toObject ? run.toObject() : run;
      if (Array.isArray(obj.items) && obj.items.length > 0) {
        const paidItems = obj.items.filter(i => i.paymentStatus === 'Paid');
        if (paidItems.length === obj.items.length && obj.items.length > 0) {
          obj.paymentStatus = 'Paid';
        } else if (paidItems.length > 0 || (obj.totalAmountPaid || 0) > 0) {
          obj.paymentStatus = 'Partially Paid';
        } else {
          obj.paymentStatus = 'Pending';
        }
      } else {
        if (obj.totalAmountPaid >= obj.totalNetPayable && (obj.totalNetPayable || 0) > 0) {
          obj.paymentStatus = 'Paid';
        } else if ((obj.totalAmountPaid || 0) > 0) {
          obj.paymentStatus = 'Partially Paid';
        } else {
          obj.paymentStatus = 'Pending';
        }
      }
      return obj;
    });

    res.status(200).json({
      success: true,
      count: normalizedRuns.length,
      data: normalizedRuns
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

    const obj = run.toObject ? run.toObject() : run;
    if (Array.isArray(obj.items) && obj.items.length > 0) {
      const paidItems = obj.items.filter(i => i.paymentStatus === 'Paid');
      if (paidItems.length === obj.items.length && obj.items.length > 0) {
        obj.paymentStatus = 'Paid';
      } else if (paidItems.length > 0 || (obj.totalAmountPaid || 0) > 0) {
        obj.paymentStatus = 'Partially Paid';
      } else {
        obj.paymentStatus = 'Pending';
      }
    } else {
      if (obj.totalAmountPaid >= obj.totalNetPayable && (obj.totalNetPayable || 0) > 0) {
        obj.paymentStatus = 'Paid';
      } else if ((obj.totalAmountPaid || 0) > 0) {
        obj.paymentStatus = 'Partially Paid';
      } else {
        obj.paymentStatus = 'Pending';
      }
    }

    res.status(200).json({
      success: true,
      data: obj
    });
  } catch (error) {
    next(error);
  }
};

const parseMonthNumber = (m) => {
  if (typeof m === 'number' && m >= 1 && m <= 12) return m;
  if (!m) return null;
  const num = Number(m);
  if (!isNaN(num) && num >= 1 && num <= 12) return num;
  const clean = String(m).trim().toLowerCase();
  const idx = MONTH_NAMES.findIndex(name => name && name.toLowerCase() === clean);
  return idx > 0 ? idx : null;
};

// @desc    Preview or Initialize Monthly Payroll Run
// @route   POST /api/payroll/preview
// @access  Private (Administrator, Finance)
exports.previewMonthlyPayroll = async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const numMonth = parseMonthNumber(month);
    const numYear = Number(year);

    if (!numMonth || !numYear || numMonth < 1 || numMonth > 12) {
      return res.status(400).json({ success: false, message: 'Valid month (1-12 or month name) and year are required' });
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

    const companySettings = await CompanySettings.findOne() || {};
    const periodStart = new Date(Date.UTC(numYear, numMonth - 1, 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(numYear, numMonth, 0, 23, 59, 59, 999));
    const statutoryRules = companySettings.statutoryPayrollRules || {};
    const items = employees.map((emp) => calculateEmployeePayrollItem(
      emp,
      {},
      statutoryRules,
      { startDate: periodStart, endDate: periodEnd }
    ));
    const negativeNetItem = items.find((item) => item.netSalaryPayable < 0);
    if (negativeNetItem) {
      return res.status(400).json({
        success: false,
        message: `Configured deductions exceed gross earnings for ${negativeNetItem.employeeName}; correct the employee deductions before payroll.`
      });
    }

    const totalGrossEarnings = round2(items.reduce((acc, i) => acc + i.grossEarnings, 0));
    const totalEmployeePf = round2(items.reduce((acc, i) => acc + i.employeePfContribution, 0));
    const totalEmployerPf = round2(items.reduce((acc, i) => acc + i.employerPfContribution, 0));
    const totalEmployeeEsi = round2(items.reduce((acc, i) => acc + i.employeeEsiContribution, 0));
    const totalEmployerEsi = round2(items.reduce((acc, i) => acc + i.employerEsiContribution, 0));
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
        totalEmployeeEsi,
        totalEmployerEsi,
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
// @route   POST /api/payroll/save or POST /api/payroll
// @access  Private (Administrator, Finance)
exports.savePayrollRun = async (req, res, next) => {
  try {
    const { month, year, items: submittedItems, status = 'Draft', remarks } = req.body;
    const numMonth = parseMonthNumber(month);
    const numYear = Number(year);

    if (!numMonth || !numYear || !submittedItems || !submittedItems.length) {
      return res.status(400).json({ success: false, message: 'Valid month, year, and payroll items are required' });
    }
    const employeeIds = submittedItems.map((item) => String(item.employee?._id || item.employee || ''));
    if (employeeIds.some((id) => !mongoose.isValidObjectId(id)) || new Set(employeeIds).size !== employeeIds.length) {
      return res.status(400).json({ success: false, message: 'Payroll items must contain unique, valid employee records' });
    }

    // Check existing
    let run = await PayrollRun.findOne({ month: numMonth, year: numYear });
    if (run && run.status === 'Finalized') {
      return res.status(400).json({
        success: false,
        message: `Payroll for ${MONTH_NAMES[numMonth]} ${numYear} is already finalized and cannot be overwritten.`
      });
    }

    const [employees, companySettings] = await Promise.all([
      Employee.find({ _id: { $in: employeeIds }, employmentStatus: { $in: ['Active', 'On Probation', 'Notice Period'] } }),
      CompanySettings.findOne()
    ]);
    if (employees.length !== employeeIds.length) {
      return res.status(400).json({ success: false, message: 'One or more payroll employees are missing or no longer active' });
    }
    const submittedByEmployee = new Map(submittedItems.map((item) => [
      String(item.employee?._id || item.employee),
      item
    ]));
    const periodStart = new Date(Date.UTC(numYear, numMonth - 1, 1, 0, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(numYear, numMonth, 0, 23, 59, 59, 999));
    const statutoryRules = companySettings?.statutoryPayrollRules || {};
    const items = employees.map((employee) => {
      const submitted = submittedByEmployee.get(String(employee._id)) || {};
      const numberOrDefault = (value, fallback) => {
        if (value === undefined || value === null || value === '') return fallback;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
      };
      return calculateEmployeePayrollItem(employee, {
        totalWorkingDays: numberOrDefault(submitted.totalWorkingDays, 30),
        paidDays: numberOrDefault(submitted.paidDays, 30),
        bonusOrIncentive: numberOrDefault(submitted.bonusOrIncentive, 0),
        overtimeAmount: numberOrDefault(submitted.overtimeAmount, 0),
        tdsDeduction: numberOrDefault(submitted.tdsDeduction, Number(employee.salaryStructure?.tdsMonthly) || 0),
        otherDeductions: numberOrDefault(submitted.otherDeductions, 0)
      }, statutoryRules, { startDate: periodStart, endDate: periodEnd });
    });
    const negativeNetItem = items.find((item) => item.netSalaryPayable < 0);
    if (negativeNetItem) {
      return res.status(400).json({
        success: false,
        message: `Configured deductions exceed gross earnings for ${negativeNetItem.employeeName}; correct the employee deductions before payroll.`
      });
    }

    const totalGrossEarnings = round2(items.reduce((acc, i) => acc + (Number(i.grossEarnings) || 0), 0));
    const totalEmployeePf = round2(items.reduce((acc, i) => acc + (Number(i.employeePfContribution) || 0), 0));
    const totalEmployerPf = round2(items.reduce((acc, i) => acc + (Number(i.employerPfContribution) || 0), 0));
    const totalEmployeeEsi = round2(items.reduce((acc, i) => acc + (Number(i.employeeEsiContribution) || 0), 0));
    const totalEmployerEsi = round2(items.reduce((acc, i) => acc + (Number(i.employerEsiContribution) || 0), 0));
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
    run.totalEmployeeEsi = totalEmployeeEsi;
    run.totalEmployerEsi = totalEmployerEsi;
    run.totalPfContribution = round2(totalEmployeePf + totalEmployerPf);
    run.totalProfessionalTax = totalProfessionalTax;
    run.totalTdsDeductions = totalTdsDeductions;
    run.totalDeductions = totalDeductions;
    run.totalNetPayable = totalNetPayable;
    run.totalEmployerCost = totalEmployerCost;
    run.totalAmountPaid = totalAmountPaid;
    run.totalPendingAmount = totalPendingAmount;
    run.paymentStatus = (totalAmountPaid >= totalNetPayable && totalNetPayable > 0)
      ? 'Paid'
      : (totalAmountPaid > 0 ? 'Partially Paid' : 'Pending');
    run.status = status;
    run.remarks = remarks || run.remarks;

    if (status === 'Finalized') {
      run.finalizedAt = new Date();
      run.finalizedBy = req.user._id;

      // Automatically generate / update Employee PF Statutory records
      for (const itm of items) {
        if (itm.employeePfContribution > 0 || itm.employerPfContribution > 0) {
          const recCode = `PF-${numYear}-${String(numMonth).padStart(2, '0')}-${itm.employeeId}`;
          const epsCont = itm.epsContribution !== undefined
            ? Number(itm.epsContribution)
            : 0;
          const epfDiff = itm.epfDifference !== undefined
            ? Number(itm.epfDifference)
            : round2(Math.max(0, (Number(itm.employerPfContribution) || 0) - epsCont));

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
              epsContribution: epsCont,
              epfDifference: epfDiff,
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
        ? `Payroll for ${periodName} finalized. Internal PF contribution records created; remittance remains pending.`
        : `Payroll draft for ${periodName} saved successfully.`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Explicitly Finalize a Payroll Run and generate PF statutory records
// @route   POST /api/payroll/:id/finalize
// @access  Private (Administrator)
exports.finalizePayrollBatch = async (req, res, next) => {
  try {
    const run = await PayrollRun.findById(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Payroll run not found' });
    }

    if (run.status === 'Finalized') {
      return res.status(400).json({
        success: false,
        message: `Payroll batch ${run.payrollCode} has already been finalized.`
      });
    }

    run.status = 'Finalized';
    run.finalizedAt = new Date();
    run.finalizedBy = req.user._id;

    // Generate / update Employee PF Statutory records for all eligible employees
    const numYear = run.year;
    const numMonth = run.month;
    const periodName = run.periodName || `${MONTH_NAMES[numMonth]} ${numYear}`;

    for (const itm of run.items) {
      if ((Number(itm.employeePfContribution) || 0) > 0 || (Number(itm.employerPfContribution) || 0) > 0) {
        const recCode = `PF-${numYear}-${String(numMonth).padStart(2, '0')}-${itm.employeeId}`;
        const epsCont = itm.epsContribution !== undefined
          ? Number(itm.epsContribution)
          : 0;
        const epfDiff = itm.epfDifference !== undefined
          ? Number(itm.epfDifference)
          : round2(Math.max(0, (Number(itm.employerPfContribution) || 0) - epsCont));

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
            epsContribution: epsCont,
            epfDifference: epfDiff,
            totalPfAmount: round2(itm.employeePfContribution + itm.employerPfContribution),
            remittanceStatus: 'Pending'
          },
          { upsert: true, new: true }
        );
      }
    }

    await run.save();

    res.status(200).json({
      success: true,
      data: run,
      message: `Payroll run ${run.payrollCode} for ${periodName} finalized. Internal PF contribution records created; remittance remains pending.`
    });
  } catch (error) {
    next(error);
  }
};

exports.calculateEmployeePayrollItem = calculateEmployeePayrollItem;

// @desc    Record salary disbursement payment against an employee's payslip
// @route   POST /api/payroll/:id/pay/:employeeId
// @access  Private (Administrator, Finance)
exports.recordSalaryPayment = async (req, res, next) => {
  try {
    const { paymentDate, paymentMethod, paymentReference, transactionReference, remarks } = req.body;
    const ref = (transactionReference || paymentReference || '').trim();

    if (!ref) {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference or bank UTR number is required to confirm disbursement'
      });
    }

    const run = await PayrollRun.findById(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Payroll run not found' });
    }

    const item = run.items.find(i => i.employee.toString() === req.params.employeeId || i.employeeId === req.params.employeeId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Employee payslip item not found in this payroll' });
    }

    if (item.paymentStatus === 'Paid') {
      return res.status(400).json({
        success: false,
        message: `Salary for ${item.employeeName} has already been recorded as Paid (Ref: ${item.paymentReference || 'N/A'})`
      });
    }

    item.paymentStatus = 'Paid';
    item.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
    item.paymentMethod = paymentMethod || 'Bank Transfer';
    item.paymentReference = ref;
    item.remarks = remarks || item.remarks || '';

    // Recalculate totals
    run.totalAmountPaid = round2(run.items.reduce((acc, i) => acc + (i.paymentStatus === 'Paid' ? i.netSalaryPayable : 0), 0));
    run.totalPendingAmount = round2(run.totalNetPayable - run.totalAmountPaid);

    if (run.totalAmountPaid >= run.totalNetPayable && run.totalNetPayable > 0) {
      run.paymentStatus = 'Paid';
    } else if (run.totalAmountPaid > 0) {
      run.paymentStatus = 'Partially Paid';
    } else {
      run.paymentStatus = 'Pending';
    }

    await run.save();

    res.status(200).json({
      success: true,
      data: item,
      run: run,
      runSummary: {
        paymentStatus: run.paymentStatus,
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
    doc.fillColor(primaryColor).fontSize(18).text(companySettings.companyName || 'Navadurga Electricals', 40, 40, { bold: true });
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
      { label: 'Employee PF Contribution', val: item.employeePfContribution },
      { label: 'Employee ESI Contribution', val: item.employeeEsiContribution },
      { label: 'Professional Tax (PT)', val: item.professionalTax },
      { label: 'TDS / Income Tax Withheld', val: item.tdsDeduction },
      { label: 'Other Voluntary Deductions', val: item.otherDeductions },
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
    doc.rect(40, tableY, 515, 44).fill('#f8fafc');
    doc.fillColor('#4b5563').fontSize(8).font('Helvetica')
      .text(`Employer PF: Rs. ${formatNum(item.employerPfContribution)} | Employer ESI: Rs. ${formatNum(item.employerEsiContribution)} | Total employer cost: Rs. ${formatNum(item.employerCostTotal)}`, 48, tableY + 7);
    doc.text(`PF wage base: Rs. ${formatNum(item.pfWageBase)} | ESI wage base: Rs. ${formatNum(item.esiWageBase)}`, 48, tableY + 19);
    doc.font('Helvetica-Oblique').fontSize(7)
      .text(`Configured estimate only. PF remittance: ${item.pfRemittanceStatus || 'Pending'}; ESI remittance: ${item.esiRemittanceStatus || 'Pending'}. Salary payment does not confirm statutory remittance.`, 48, tableY + 31, { width: 495 });

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
