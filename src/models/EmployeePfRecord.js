const mongoose = require('mongoose');

const employeePfRecordSchema = new mongoose.Schema(
  {
    recordCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true
    },
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    uan: { type: String, trim: true },
    pfAccountNumber: { type: String, trim: true },

    payrollRun: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayrollRun'
    },
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    periodName: { type: String, required: true }, // e.g. "October 2026"

    // Financial base and contributions
    pfWageBase: { type: Number, required: true, min: 0 },
    employeeContribution: { type: Number, required: true, min: 0 },
    employerContribution: { type: Number, required: true, min: 0 },
    epsContribution: { type: Number, default: 0 }, // 8.33% EPS component
    epfDifference: { type: Number, default: 0 },   // 3.67% EPF component
    adminCharges: { type: Number, default: 0 }, // EDLI + Admin component if configured
    totalPfAmount: { type: Number, required: true, min: 0 },

    // Remittance Lifecycle
    remittanceStatus: {
      type: String,
      enum: ['Pending', 'Submitted', 'Remitted', 'Reversed'],
      default: 'Pending',
      index: true
    },
    challanNumber: { type: String, trim: true }, // TRRN / ECR Challan reference
    remittanceDate: Date,
    bankReference: { type: String, trim: true },
    remarks: { type: String, trim: true }
  },
  {
    timestamps: true
  }
);

employeePfRecordSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('EmployeePfRecord', employeePfRecordSchema);
