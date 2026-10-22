const mongoose = require('mongoose');

const pfItemSchema = new mongoose.Schema({
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  serviceId: {
    type: String,
    default: 'INN-SRV-ADHOC'
  },
  description: {
    type: String,
    required: true
  },
  unit: {
    type: String,
    default: 'Units'
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 0.01
  },
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  taxableAmount: {
    type: Number,
    required: true,
    min: 0
  },
  taxRate: {
    type: Number,
    default: 18,
    min: 0
  },
  isInterState: {
    type: Boolean,
    default: false
  },
  cgstRate: {
    type: Number,
    default: 0
  },
  cgstAmount: {
    type: Number,
    default: 0
  },
  sgstRate: {
    type: Number,
    default: 0
  },
  sgstAmount: {
    type: Number,
    default: 0
  },
  igstRate: {
    type: Number,
    default: 0
  },
  igstAmount: {
    type: Number,
    default: 0
  },
  totalTax: {
    type: Number,
    default: 0
  },
  lineTotal: {
    type: Number,
    required: true,
    min: 0
  }
});

const pfDocumentSchema = new mongoose.Schema(
  {
    pfNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    documentDate: {
      type: Date,
      default: Date.now,
      required: true
    },
    validityDate: {
      type: Date
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      index: true
    },
    clientSnapshot: {
      companyName: String,
      contactPerson: String,
      primaryPhone: String,
      email: String,
      gstin: String,
      pan: String,
      billingAddress: String,
      city: String,
      state: String,
      stateCode: String,
      pincode: String
    },
    assignedEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedEmployeeName: String,
    items: [pfItemSchema],
    documentDiscount: {
      type: Number,
      default: 0,
      min: 0
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0
    },
    totalTaxableAmount: {
      type: Number,
      required: true,
      min: 0
    },
    cgstTotal: {
      type: Number,
      default: 0
    },
    sgstTotal: {
      type: Number,
      default: 0
    },
    igstTotal: {
      type: Number,
      default: 0
    },
    totalTax: {
      type: Number,
      default: 0
    },
    roundOffAdjustment: {
      type: Number,
      default: 0
    },
    grandTotal: {
      type: Number,
      required: true,
      min: 0
    },
    notes: {
      type: String,
      trim: true
    },
    termsAndConditions: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['Draft', 'Issued', 'Accepted', 'Rejected', 'Expired', 'Converted to Invoice'],
      default: 'Draft',
      index: true
    },
    convertedToInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice'
    },
    convertedToInvoiceNumber: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

pfDocumentSchema.index({ pfNumber: 'text', 'clientSnapshot.companyName': 'text' });

module.exports = mongoose.model('PFDocument', pfDocumentSchema);
