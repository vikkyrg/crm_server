const mongoose = require('mongoose');

const companySettingsSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      default: 'Innomatrics Technologies'
    },
    displayName: {
      type: String,
      default: 'Innomatrics Technologies'
    },
    tagline: {
      type: String,
      default: 'Leading Edge Software & Cloud Solutions'
    },
    companyLogo: {
      type: String, // Base64 data URL or image URL
      default: ''
    },
    address: {
      type: String,
      default: 'Plot No. 42, Knowledge Park III, Greater Noida, Uttar Pradesh 201306'
    },
    city: {
      type: String,
      default: 'Greater Noida'
    },
    state: {
      type: String,
      default: 'Uttar Pradesh'
    },
    stateCode: {
      type: String,
      default: '09' // Uttar Pradesh GST state code
    },
    pincode: {
      type: String,
      default: '201306'
    },
    phone: {
      type: String,
      default: '+91 98765 43210'
    },
    email: {
      type: String,
      default: 'billing@innomatrics.com'
    },
    website: {
      type: String,
      default: 'https://www.innomatrics.com'
    },
    gstin: {
      type: String,
      default: '09AAACI1234F1Z5'
    },
    pan: {
      type: String,
      default: 'AAACI1234F'
    },
    bankName: {
      type: String,
      default: 'HDFC Bank'
    },
    accountNumber: {
      type: String,
      default: '50200012345678'
    },
    ifscCode: {
      type: String,
      default: 'HDFC0001234'
    },
    branch: {
      type: String,
      default: 'Sector 62, Noida Branch'
    },
    upiId: {
      type: String,
      default: 'innomatrics@hdfcbank'
    },
    invoicePrefix: {
      type: String,
      default: 'INV-2026-'
    },
    pfPrefix: {
      type: String,
      default: 'PF-2026-'
    },
    advancePrefix: {
      type: String,
      default: 'ADV-2026-'
    },
    clientPrefix: {
      type: String,
      default: 'INN-CL-'
    },
    servicePrefix: {
      type: String,
      default: 'INN-SRV-'
    },
    quantityPrefix: {
      type: String,
      default: 'QTY-2026-'
    },
    employeePrefix: {
      type: String,
      default: 'EMP-'
    },
    challanPrefix: {
      type: String,
      default: 'DC-2026-'
    },
    payrollPrefix: {
      type: String,
      default: 'PAY-2026-'
    },
    defaultPaymentTerms: {
      type: String,
      default: 'Payment due within 15 days of invoice date. Late payments subject to 1.5% monthly interest.'
    },
    defaultNotes: {
      type: String,
      default: 'Thank you for partnering with Innomatrics Technologies!'
    },
    roundingPolicy: {
      type: String,
      enum: ['round_to_nearest', 'none'],
      default: 'round_to_nearest'
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('CompanySettings', companySettingsSchema);
