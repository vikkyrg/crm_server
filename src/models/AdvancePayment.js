const mongoose = require('mongoose');

const allocationRecordSchema = new mongoose.Schema({
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  invoiceNumber: {
    type: String,
    required: true
  },
  allocatedAmount: {
    type: Number,
    required: true,
    min: 0.01
  },
  allocatedAt: {
    type: Date,
    default: Date.now
  },
  allocatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: String
});

const advancePaymentSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
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
      city: String,
      state: String
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: [true, 'Please provide payment amount'],
      min: [0.01, 'Amount must be greater than zero']
    },
    allocatedAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    unallocatedAmount: {
      type: Number,
      required: true,
      min: 0,
      index: true
    },
    paymentMethod: {
      type: String,
      enum: ['Bank Transfer', 'NEFT/RTGS', 'UPI', 'Cheque', 'Cash'],
      required: true,
      default: 'Bank Transfer'
    },
    transactionReference: {
      type: String,
      trim: true
    },
    bankDetails: {
      type: String,
      trim: true
    },
    associatedProject: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['Verified', 'Pending', 'Reversed'],
      default: 'Verified',
      index: true
    },
    allocations: [allocationRecordSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

advancePaymentSchema.index({ receiptNumber: 'text', 'clientSnapshot.companyName': 'text', transactionReference: 'text' });

module.exports = mongoose.model('AdvancePayment', advancePaymentSchema);
