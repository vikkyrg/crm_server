const mongoose = require('mongoose');

const payrollItemSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  employeeId: { type: String, required: true },
  employeeName: { type: String, required: true },
  department: String,
  designation: String,
  panNumber: String,
  bankAccount: String,
  bankName: String,
  ifscCode: String,
  uan: String,
  pfAccountNumber: String,

  // Attendance & Days
  totalWorkingDays: { type: Number, default: 30 },
  paidDays: { type: Number, default: 30 },
  unpaidLeaveDays: { type: Number, default: 0 },

  // Earnings Breakdown
  basicSalary: { type: Number, default: 0 },
  hra: { type: Number, default: 0 },
  conveyanceAllowance: { type: Number, default: 0 },
  specialAllowance: { type: Number, default: 0 },
  medicalAllowance: { type: Number, default: 0 },
  otherAllowances: { type: Number, default: 0 },
  bonusOrIncentive: { type: Number, default: 0 },
  overtimeAmount: { type: Number, default: 0 },
  grossEarnings: { type: Number, required: true, default: 0 },

  // Employee Deductions Breakdown
  pfWageBase: { type: Number, default: 0 },
  esiWageBase: { type: Number, default: 0 },
  employeePfContribution: { type: Number, default: 0 },
  employeeEsiContribution: { type: Number, default: 0 },
  professionalTax: { type: Number, default: 0 },
  tdsDeduction: { type: Number, default: 0 },
  otherDeductions: { type: Number, default: 0 },
  totalEmployeeDeductions: { type: Number, required: true, default: 0 },

  // Net Take-Home
  netSalaryPayable: { type: Number, required: true, default: 0 },

  // Employer Contributions (Cost to Company side, not deducted from employee)
  employerPfContribution: { type: Number, default: 0 },
  employerEsiContribution: { type: Number, default: 0 },
  epsContribution: { type: Number, default: 0 },
  epfDifference: { type: Number, default: 0 },
  employerCostTotal: { type: Number, default: 0 },
  statutoryCalculation: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  pfRemittanceStatus: {
    type: String,
    enum: ['Not Applicable', 'Pending', 'Submitted', 'Remitted'],
    default: 'Not Applicable'
  },
  esiRemittanceStatus: {
    type: String,
    enum: ['Not Applicable', 'Pending', 'Submitted', 'Remitted'],
    default: 'Not Applicable'
  },

  // Payment Status
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid', 'Failed', 'Partially Paid'],
    default: 'Pending'
  },
  paymentDate: Date,
  paymentMethod: {
    type: String,
    enum: [
      'Bank Transfer',
      'Bank Transfer (NEFT/IMPS)',
      'NEFT/RTGS',
      'UPI',
      'UPI / Direct Credit',
      'Cheque',
      'Company Cheque',
      'Cash'
    ],
    default: 'Bank Transfer'
  },
  paymentReference: String,
  remarks: String
});

const payrollRunSchema = new mongoose.Schema(
  {
    payrollCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    month: {
      type: Number,
      required: true, // 1 - 12
      min: 1,
      max: 12
    },
    year: {
      type: Number,
      required: true,
      min: 2020
    },
    periodName: {
      type: String, // e.g. "October 2026"
      required: true
    },
    items: [payrollItemSchema],

    // Aggregated Totals
    totalEmployees: { type: Number, default: 0 },
    totalGrossEarnings: { type: Number, default: 0 },
    totalEmployeePf: { type: Number, default: 0 },
    totalEmployerPf: { type: Number, default: 0 },
    totalEmployeeEsi: { type: Number, default: 0 },
    totalEmployerEsi: { type: Number, default: 0 },
    totalPfContribution: { type: Number, default: 0 },
    totalProfessionalTax: { type: Number, default: 0 },
    totalTdsDeductions: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    totalNetPayable: { type: Number, default: 0 },
    totalEmployerCost: { type: Number, default: 0 },
    totalAmountPaid: { type: Number, default: 0 },
    totalPendingAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['Draft', 'Processing', 'Finalized', 'Cancelled'],
      default: 'Draft',
      index: true
    },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Partially Paid', 'Paid'],
      default: 'Pending',
      index: true
    },
    finalizedAt: Date,
    finalizedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    remarks: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

payrollRunSchema.index({ month: 1, year: 1 }, { unique: true });

// Pre-save hook to ensure aggregated payment fields and batch paymentStatus are consistently maintained
payrollRunSchema.pre('save', function (next) {
  if (Array.isArray(this.items) && this.items.length > 0) {
    let paidSum = 0;
    let paidCount = 0;

    for (const item of this.items) {
      if (item.paymentStatus === 'Paid') {
        paidSum += (Number(item.netSalaryPayable) || 0);
        paidCount++;
      }
    }

    const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;
    this.totalAmountPaid = round2(paidSum);
    this.totalPendingAmount = round2(Math.max(0, (Number(this.totalNetPayable) || 0) - this.totalAmountPaid));

    if (paidCount === this.items.length && this.items.length > 0) {
      this.paymentStatus = 'Paid';
    } else if (paidCount > 0) {
      this.paymentStatus = 'Partially Paid';
    } else {
      this.paymentStatus = 'Pending';
    }
  } else {
    this.totalAmountPaid = 0;
    this.totalPendingAmount = 0;
    this.paymentStatus = 'Pending';
  }
  next();
});

module.exports = mongoose.model('PayrollRun', payrollRunSchema);
