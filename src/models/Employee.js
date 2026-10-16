const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    firstName: {
      type: String,
      trim: true
    },
    lastName: {
      type: String,
      trim: true
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      index: true
    },
    email: {
      type: String,
      required: [true, 'Corporate email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    },
    alternatePhone: {
      type: String,
      trim: true
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
      default: 'Engineering'
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true
    },
    joiningDate: {
      type: Date,
      required: [true, 'Joining date is required'],
      default: Date.now
    },
    employmentStatus: {
      type: String,
      enum: ['Active', 'On Probation', 'Notice Period', 'Terminated', 'Resigned', 'Inactive'],
      default: 'Active',
      index: true
    },
    employmentType: {
      type: String,
      enum: ['Full-time', 'Part-time', 'Contract', 'Intern'],
      default: 'Full-time'
    },
    
    // Address & Emergency
    currentAddress: {
      type: String,
      trim: true
    },
    permanentAddress: {
      type: String,
      trim: true
    },
    emergencyContact: {
      name: String,
      relationship: String,
      phone: String
    },

    // Bank Details (Secured / Role Protected)
    bankDetails: {
      bankName: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifscCode: { type: String, trim: true, uppercase: true },
      branch: { type: String, trim: true },
      accountHolderName: { type: String, trim: true }
    },

    // PF & Statutory Information
    statutoryInfo: {
      panNumber: { type: String, trim: true, uppercase: true },
      aadhaarNumber: { type: String, trim: true },
      uan: { type: String, trim: true }, // Universal Account Number
      pfAccountNumber: { type: String, trim: true },
      isPfEligible: { type: Boolean, default: true },
      pfEnrollmentDate: { type: Date },
      pfWageLimitApplicable: { type: Boolean, default: false } // e.g. capping at Rs 15,000 wage ceiling
    },

    // Salary Structure
    salaryStructure: {
      basicSalary: { type: Number, default: 0, min: 0 },
      hra: { type: Number, default: 0, min: 0 },
      conveyanceAllowance: { type: Number, default: 0, min: 0 },
      specialAllowance: { type: Number, default: 0, min: 0 },
      medicalAllowance: { type: Number, default: 0, min: 0 },
      otherAllowances: { type: Number, default: 0, min: 0 },
      grossSalary: { type: Number, default: 0, min: 0 },
      grossSalaryMonthly: { type: Number, default: 0, min: 0 },

      // Statutory config
      employeePfRate: { type: Number, default: 12 }, // default 12%
      employerPfRate: { type: Number, default: 12 }, // default 12%
      professionalTax: { type: Number, default: 200, min: 0 },
      tdsEstimate: { type: Number, default: 0, min: 0 },
      tdsMonthly: { type: Number, default: 0, min: 0 },

      effectiveDate: { type: Date, default: Date.now }
    },

    remarks: {
      type: String,
      trim: true
    },

    // System User linkage (optional)
    linkedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

// Auto-populate names and gross salary before saving
employeeSchema.pre('save', function (next) {
  if (this.fullName && (!this.firstName || !this.lastName)) {
    const parts = this.fullName.trim().split(/\s+/);
    this.firstName = this.firstName || parts[0] || '';
    this.lastName = this.lastName || parts.slice(1).join(' ') || '.';
  } else if (!this.fullName && (this.firstName || this.lastName)) {
    this.fullName = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }
  
  // Calculate gross salary if structure exists
  if (this.salaryStructure) {
    const s = this.salaryStructure;
    const computedGross = (Number(s.basicSalary) || 0) +
                          (Number(s.hra) || 0) +
                          (Number(s.conveyanceAllowance) || 0) +
                          (Number(s.specialAllowance) || 0) +
                          (Number(s.medicalAllowance) || 0) +
                          (Number(s.otherAllowances) || 0);
    s.grossSalary = computedGross;
    s.grossSalaryMonthly = computedGross;
  }
  next();
});

employeeSchema.index({ fullName: 'text', email: 'text', employeeId: 'text', department: 'text' });

module.exports = mongoose.model('Employee', employeeSchema);
