const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  serviceId: {
    type: String,
    required: true
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

const invoicePaymentRecordSchema = new mongoose.Schema({
  paymentDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  paymentMethod: {
    type: String,
    enum: ['Bank Transfer', 'NEFT/RTGS', 'UPI', 'Cheque', 'Cash', 'Advance Allocation', 'Credit Note'],
    required: true
  },
  reference: String,
  advancePaymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdvancePayment'
  },
  notes: String,
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  recordedAt: {
    type: Date,
    default: Date.now
  }
});

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    invoiceDate: {
      type: Date,
      default: Date.now,
      required: true,
      index: true
    },
    dueDate: {
      type: Date,
      required: true,
      index: true
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
    relatedPFDocument: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PFDocument'
    },
    relatedPFNumber: String,
    invoiceType: {
      type: String,
      enum: ['Service', 'Material'],
      default: 'Service',
      index: true
    },
    projectOrWorkOrder: {
      type: String,
      trim: true
    },
    linkedChallans: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DeliveryChallan'
      }
    ],
    linkedChallanNumbers: [String],
    items: [invoiceItemSchema],
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
    advanceAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0
    },
    creditAdjustment: {
      type: Number,
      default: 0,
      min: 0
    },
    outstandingBalance: {
      type: Number,
      required: true,
      min: 0,
      index: true
    },
    status: {
      type: String,
      enum: ['Draft', 'Issued', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
      default: 'Draft',
      index: true
    },
    paymentTerms: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    },
    paymentHistory: [invoicePaymentRecordSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

invoiceSchema.index({ invoiceNumber: 'text', 'clientSnapshot.companyName': 'text' });

module.exports = mongoose.model('Invoice', invoiceSchema);
