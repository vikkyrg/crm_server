const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEmployeePayrollItem } = require('../src/controllers/payrollController');

const employee = (statutoryInfo) => ({
  _id: 'employee-id',
  employeeId: 'EMP-TEST',
  fullName: 'Payroll Test',
  department: 'Finance',
  designation: 'Analyst',
  salaryStructure: {
    basicSalary: 20000,
    hra: 0,
    conveyanceAllowance: 0,
    specialAllowance: 0,
    medicalAllowance: 0,
    otherAllowances: 0,
    professionalTax: 200,
    tdsMonthly: 0
  },
  statutoryInfo,
  bankDetails: {}
});

const period = {
  startDate: new Date('2026-10-01T00:00:00.000Z'),
  endDate: new Date('2026-10-31T23:59:59.999Z')
};

const configuredRules = {
  pf: {
    employeeRate: 12,
    employerRate: 12,
    wageCeiling: 15000,
    epsRate: 8.33,
    effectiveFrom: new Date('2026-04-01')
  },
  esi: {
    employeeRate: 0.75,
    employerRate: 3.25,
    wageCeiling: 21000,
    effectiveFrom: new Date('2026-04-01')
  }
};

test('calculates configured PF and ESI deductions separately from employer contributions', () => {
  const item = calculateEmployeePayrollItem(employee({
    pfApplicable: true,
    isPfEligible: true,
    pfWageBasis: 'Basic',
    pfWageLimitApplicable: true,
    esiApplicable: true,
    isEsiEligible: true,
    esiEligibilityConfirmed: true,
    esiWageBasis: 'Gross'
  }), {}, configuredRules, period);

  assert.equal(item.pfWageBase, 15000);
  assert.equal(item.employeePfContribution, 1800);
  assert.equal(item.employerPfContribution, 1800);
  assert.equal(item.esiWageBase, 20000);
  assert.equal(item.employeeEsiContribution, 150);
  assert.equal(item.employerEsiContribution, 650);
  assert.equal(item.totalEmployeeDeductions, 2150);
  assert.equal(item.netSalaryPayable, 17850);
  assert.equal(item.employerCostTotal, 22450);
  assert.equal(item.pfRemittanceStatus, 'Pending');
  assert.equal(item.esiRemittanceStatus, 'Pending');
});

test('does not calculate PF or ESI when disabled or statutory rules are not configured', () => {
  const enabledButUnconfigured = calculateEmployeePayrollItem(employee({
    pfApplicable: true,
    isPfEligible: true,
    esiApplicable: true,
    isEsiEligible: true,
    esiEligibilityConfirmed: true
  }), {}, {}, period);

  assert.equal(enabledButUnconfigured.employeePfContribution, 0);
  assert.equal(enabledButUnconfigured.employeeEsiContribution, 0);
  assert.equal(enabledButUnconfigured.netSalaryPayable, 19800);

  const disabled = calculateEmployeePayrollItem(employee({
    pfApplicable: false,
    isPfEligible: false,
    esiApplicable: false,
    isEsiEligible: false,
    esiEligibilityConfirmed: false
  }), {}, configuredRules, period);

  assert.equal(disabled.employeePfContribution, 0);
  assert.equal(disabled.employerPfContribution, 0);
  assert.equal(disabled.employeeEsiContribution, 0);
  assert.equal(disabled.employerEsiContribution, 0);
  assert.equal(disabled.netSalaryPayable, 19800);
});

test('does not apply statutory configuration outside its effective period', () => {
  const outOfPeriod = calculateEmployeePayrollItem(employee({
    pfApplicable: true,
    isPfEligible: true,
    esiApplicable: true,
    isEsiEligible: true,
    esiEligibilityConfirmed: true
  }), {}, {
    pf: { ...configuredRules.pf, effectiveTo: new Date('2026-09-30') },
    esi: { ...configuredRules.esi, effectiveTo: new Date('2026-09-30') }
  }, period);

  assert.equal(outOfPeriod.employeePfContribution, 0);
  assert.equal(outOfPeriod.employeeEsiContribution, 0);
});

test('correctly calculates October 2026 payroll for Rs 52,850 employee with configured rates', () => {
  const highSalaryEmp = {
    _id: 'emp-52850',
    employeeId: 'EMP-005',
    fullName: 'High Earner Test',
    salaryStructure: {
      basicSalary: 30000,
      hra: 15000,
      conveyanceAllowance: 1600,
      medicalAllowance: 1250,
      specialAllowance: 5000,
      otherAllowances: 0,
      grossSalaryMonthly: 52850,
      professionalTax: 0,
      tdsMonthly: 0
    },
    statutoryInfo: {
      pfApplicable: true,
      isPfEligible: true,
      pfWageBasis: 'Basic',
      restrictPfWageLimit: true,
      pfWageLimitApplicable: true,
      esiApplicable: true,
      isEsiEligible: true,
      esiWageBasis: 'Gross',
      esiEligibilityConfirmed: true
    }
  };

  const octRules = {
    pf: {
      employeeRate: 12,
      employerRate: 12,
      wageCeiling: 15000,
      epsRate: 8.33,
      effectiveFrom: '2026-10-01',
      effectiveTo: null
    },
    esi: {
      employeeRate: 0.75,
      employerRate: 3.25,
      wageCeiling: 21000,
      effectiveFrom: '2026-10-01',
      effectiveTo: null
    }
  };

  const item = calculateEmployeePayrollItem(highSalaryEmp, {}, octRules, {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  });

  // Gross earnings: 52,850
  assert.equal(item.grossEarnings, 52850);
  // PF applies on ceiling 15,000 => 12% = 1,800
  assert.equal(item.pfWageBase, 15000);
  assert.equal(item.employeePfContribution, 1800);
  assert.equal(item.employerPfContribution, 1800);
  // ESI: gross earnings 52,850 exceeds configured wage ceiling 21,000 => not eligible, 0
  assert.equal(item.esiWageBase, 52850);
  assert.equal(item.employeeEsiContribution, 0);
  assert.equal(item.employerEsiContribution, 0);
  // Total employee deductions = 1,800 (only employee PF, employer PF is not deducted)
  assert.equal(item.totalEmployeeDeductions, 1800);
  // Net payable = 52,850 - 1,800 = 51,050
  assert.equal(item.netSalaryPayable, 51050);
  // Employer cost = 52,850 + 1,800 = 54,650
  assert.equal(item.employerCostTotal, 54650);
});

test('supports restrictPfWageLimit alias with ceiling enabled', () => {
  const empWithRestrictAlias = {
    _id: 'emp-alias',
    employeeId: 'EMP-ALIAS',
    fullName: 'Alias Test',
    salaryStructure: {
      basicSalary: 30000,
      grossSalaryMonthly: 52850
    },
    statutoryInfo: {
      pfApplicable: true,
      isPfEligible: true,
      pfWageBasis: 'Basic',
      restrictPfWageLimit: true
    }
  };

  const octRules = {
    pf: {
      employeeRate: 12,
      employerRate: 12,
      wageCeiling: 15000,
      effectiveFrom: '2026-10-01'
    }
  };

  const item = calculateEmployeePayrollItem(empWithRestrictAlias, {}, octRules, {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  });

  assert.equal(item.pfWageBase, 15000);
  assert.equal(item.employeePfContribution, 1800);
  assert.equal(item.employerPfContribution, 1800);
  assert.equal(item.netSalaryPayable, 28200); // 30,000 basic - 1,800
});

test('calculates PF on full wage basis when ceiling is disabled', () => {
  const empWithoutCeiling = {
    _id: 'emp-no-cap',
    employeeId: 'EMP-NOCAP',
    fullName: 'No Cap Test',
    salaryStructure: {
      basicSalary: 30000,
      grossSalaryMonthly: 52850
    },
    statutoryInfo: {
      pfApplicable: true,
      isPfEligible: true,
      pfWageBasis: 'Basic',
      restrictPfWageLimit: false,
      pfWageLimitApplicable: false
    }
  };

  const octRules = {
    pf: {
      employeeRate: 12,
      employerRate: 12,
      wageCeiling: 15000,
      effectiveFrom: '2026-10-01'
    }
  };

  const item = calculateEmployeePayrollItem(empWithoutCeiling, {}, octRules, {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  });

  // When ceiling is off, 12% of full 30,000 basic = 3,600
  assert.equal(item.pfWageBase, 30000);
  assert.equal(item.employeePfContribution, 3600);
  assert.equal(item.employerPfContribution, 3600);
  // Net pay deducts employee PF only (30,000 - 3,600 = 26,400)
  assert.equal(item.totalEmployeeDeductions, 3600);
  assert.equal(item.netSalaryPayable, 26400);
});

test('does not calculate PF when employee is ineligible or PF is not applicable', () => {
  const ineligibleEmp = {
    _id: 'emp-ineligible',
    employeeId: 'EMP-INELIGIBLE',
    fullName: 'Ineligible Test',
    salaryStructure: {
      basicSalary: 30000,
      grossSalaryMonthly: 52850
    },
    statutoryInfo: {
      pfApplicable: true,
      isPfEligible: false,
      pfWageBasis: 'Basic',
      restrictPfWageLimit: true
    }
  };

  const notApplicableEmp = {
    _id: 'emp-not-applicable',
    employeeId: 'EMP-NOTAPP',
    fullName: 'Not Applicable Test',
    salaryStructure: {
      basicSalary: 30000,
      grossSalaryMonthly: 52850
    },
    statutoryInfo: {
      pfApplicable: false,
      isPfEligible: true,
      pfWageBasis: 'Basic',
      restrictPfWageLimit: true
    }
  };

  const octRules = {
    pf: {
      employeeRate: 12,
      employerRate: 12,
      wageCeiling: 15000,
      effectiveFrom: '2026-10-01'
    }
  };

  const periodOct = {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  };

  const item1 = calculateEmployeePayrollItem(ineligibleEmp, {}, octRules, periodOct);
  assert.equal(item1.employeePfContribution, 0);
  assert.equal(item1.employerPfContribution, 0);
  assert.equal(item1.netSalaryPayable, 30000);

  const item2 = calculateEmployeePayrollItem(notApplicableEmp, {}, octRules, periodOct);
  assert.equal(item2.employeePfContribution, 0);
  assert.equal(item2.employerPfContribution, 0);
  assert.equal(item2.netSalaryPayable, 30000);
});

test('respects statutory rule effective dates and does not apply un-effective rules', () => {
  const emp = {
    _id: 'emp-dates',
    employeeId: 'EMP-DATES',
    fullName: 'Effective Dates Test',
    salaryStructure: {
      basicSalary: 30000,
      grossSalaryMonthly: 52850
    },
    statutoryInfo: {
      pfApplicable: true,
      isPfEligible: true,
      pfWageBasis: 'Basic',
      restrictPfWageLimit: true
    }
  };

  // Rule effective only from 2026-11-01 (not effective in October 2026)
  const futureRule = {
    pf: {
      employeeRate: 12,
      employerRate: 12,
      wageCeiling: 15000,
      effectiveFrom: '2026-11-01',
      effectiveTo: null
    }
  };

  const itemOct = calculateEmployeePayrollItem(emp, {}, futureRule, {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  });

  assert.equal(itemOct.employeePfContribution, 0);
  assert.equal(itemOct.employerPfContribution, 0);

  // Now run for November 2026 where rule is effective
  const itemNov = calculateEmployeePayrollItem(emp, {}, futureRule, {
    startDate: new Date('2026-11-01T00:00:00.000Z'),
    endDate: new Date('2026-11-30T23:59:59.999Z')
  });

  assert.equal(itemNov.employeePfContribution, 1800);
  assert.equal(itemNov.employerPfContribution, 1800);
});

test('ESI eligible with wages within configured test limit: calculates employee (0.75%) and employer (3.25%) ESI separately', () => {
  const esiEligibleEmp = {
    _id: 'emp-esi-eligible',
    employeeId: 'EMP-ESI-01',
    fullName: 'ESI Eligible Employee',
    salaryStructure: {
      basicSalary: 12000,
      hra: 4000,
      conveyanceAllowance: 1000,
      medicalAllowance: 1000,
      specialAllowance: 0,
      otherAllowances: 0,
      grossSalaryMonthly: 18000,
      professionalTax: 150,
      tdsMonthly: 0
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
      esiWageBasis: 'Gross',
      esiNumber: '1234567890'
    }
  };

  const octRules = {
    pf: {
      employeeRate: 12,
      employerRate: 12,
      wageCeiling: 15000,
      effectiveFrom: '2026-10-01'
    },
    esi: {
      employeeRate: 0.75,
      employerRate: 3.25,
      wageCeiling: 21000,
      effectiveFrom: '2026-10-01'
    }
  };

  const periodOct = {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  };

  const item = calculateEmployeePayrollItem(esiEligibleEmp, {}, octRules, periodOct);

  // Gross: 18,000
  assert.equal(item.grossEarnings, 18000);
  // PF: Basic 12,000 <= 15,000 ceiling => 12% of 12,000 = 1,440
  assert.equal(item.pfWageBase, 12000);
  assert.equal(item.employeePfContribution, 1440);
  assert.equal(item.employerPfContribution, 1440);

  // ESI: Gross 18,000 <= 21,000 ceiling => 0.75% of 18,000 = 135, 3.25% of 18,000 = 585
  assert.equal(item.esiWageBase, 18000);
  assert.equal(item.employeeEsiContribution, 135);
  assert.equal(item.employerEsiContribution, 585);
  assert.equal(item.statutoryCalculation.esi.reason, 'Eligible and calculated');

  // Employee deductions: PF 1,440 + ESI 135 + PT 150 = 1,725
  assert.equal(item.totalEmployeeDeductions, 1725);
  // Net salary: 18,000 - 1,725 = 16,275 (only employee deductions subtracted)
  assert.equal(item.netSalaryPayable, 16275);
  // Employer cost: 18,000 + 1,440 (Employer PF) + 585 (Employer ESI) = 20,025
  assert.equal(item.employerCostTotal, 20025);
  assert.equal(item.esiRemittanceStatus, 'Pending');
});

test('ESI ineligible or wages exceeding ceiling: ESI is not deducted, with a clear reason', () => {
  const octRules = {
    esi: {
      employeeRate: 0.75,
      employerRate: 3.25,
      wageCeiling: 21000,
      effectiveFrom: '2026-10-01'
    }
  };
  const periodOct = {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  };

  // Case A: Wages exceed 21,000
  const highSalaryEmp = {
    _id: 'emp-high',
    employeeId: 'EMP-HIGH',
    fullName: 'High Earner',
    salaryStructure: { basicSalary: 30000, grossSalaryMonthly: 52850 },
    statutoryInfo: {
      esiApplicable: true,
      isEsiEligible: true,
      esiEligibilityConfirmed: true,
      esiWageBasis: 'Gross'
    }
  };
  const itemA = calculateEmployeePayrollItem(highSalaryEmp, {}, octRules, periodOct);
  assert.equal(itemA.employeeEsiContribution, 0);
  assert.equal(itemA.employerEsiContribution, 0);
  assert.match(itemA.statutoryCalculation.esi.reason, /exceed statutory ESI wage ceiling/i);

  // Case B: ESI eligibility not confirmed
  const unconfirmedEmp = {
    _id: 'emp-unconfirmed',
    employeeId: 'EMP-UNCONFIRMED',
    fullName: 'Unconfirmed Emp',
    salaryStructure: { basicSalary: 15000, grossSalaryMonthly: 15000 },
    statutoryInfo: {
      esiApplicable: true,
      isEsiEligible: false,
      esiEligibilityConfirmed: false,
      esiWageBasis: 'Gross'
    }
  };
  const itemB = calculateEmployeePayrollItem(unconfirmedEmp, {}, octRules, periodOct);
  assert.equal(itemB.employeeEsiContribution, 0);
  assert.equal(itemB.employerEsiContribution, 0);
  assert.equal(itemB.statutoryCalculation.esi.reason, 'ESI eligibility not confirmed');

  // Case C: ESI not applicable
  const notApplicableEmp = {
    _id: 'emp-not-app',
    employeeId: 'EMP-NOT-APP',
    fullName: 'Not App Emp',
    salaryStructure: { basicSalary: 15000, grossSalaryMonthly: 15000 },
    statutoryInfo: {
      esiApplicable: false,
      isEsiEligible: false,
      esiEligibilityConfirmed: false
    }
  };
  const itemC = calculateEmployeePayrollItem(notApplicableEmp, {}, octRules, periodOct);
  assert.equal(itemC.employeeEsiContribution, 0);
  assert.equal(itemC.employerEsiContribution, 0);
  assert.equal(itemC.statutoryCalculation.esi.reason, 'ESI not applicable for employee');
});

test('Net-pay arithmetic: gross minus employee deductions only; employer contributions are not subtracted', () => {
  const emp = {
    _id: 'emp-arith',
    employeeId: 'EMP-ARITH',
    fullName: 'Arithmetic Check',
    salaryStructure: {
      basicSalary: 15000,
      hra: 3000,
      grossSalaryMonthly: 18000,
      professionalTax: 200,
      tdsMonthly: 500
    },
    statutoryInfo: {
      pfApplicable: true,
      isPfEligible: true,
      pfWageBasis: 'Basic',
      restrictPfWageLimit: true,
      esiApplicable: true,
      isEsiEligible: true,
      esiEligibilityConfirmed: true,
      esiWageBasis: 'Gross'
    }
  };

  const rules = {
    pf: { employeeRate: 12, employerRate: 12, wageCeiling: 15000, effectiveFrom: '2026-10-01' },
    esi: { employeeRate: 0.75, employerRate: 3.25, wageCeiling: 21000, effectiveFrom: '2026-10-01' }
  };

  const item = calculateEmployeePayrollItem(emp, { otherDeductions: 100 }, rules, {
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-31T23:59:59.999Z')
  });

  const expectedEmployeeDeductions = 1800 /* PF */ + 135 /* ESI */ + 200 /* PT */ + 500 /* TDS */ + 100 /* Other */ ;
  assert.equal(item.totalEmployeeDeductions, expectedEmployeeDeductions);
  assert.equal(item.netSalaryPayable, 18000 - expectedEmployeeDeductions);

  // Verify that employer contributions are completely separate
  const employerSum = item.employerPfContribution + item.employerEsiContribution;
  assert.equal(employerSum, 1800 + 585);
  assert.equal(item.employerCostTotal, 18000 + employerSum);
  // Net salary payable is NOT reduced by employer sum
  assert.equal(item.netSalaryPayable, 18000 - item.totalEmployeeDeductions);
});

