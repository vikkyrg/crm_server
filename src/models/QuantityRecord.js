const mongoose = require('mongoose');

const quantityRecordSchema = new mongoose.Schema(
  {
    recordId: {
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
      contactPerson: String
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true
    },
    serviceId: {
      type: String,
      required: true
    },
    serviceName: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: [true, 'Please provide quantity'],
      min: [0.01, 'Quantity must be greater than zero']
    },
    unit: {
      type: String,
      default: 'Units',
      trim: true
    },
    unitPriceSnapshot: {
      type: Number,
      default: 0
    },
    relatedPFDocument: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PFDocument'
    },
    relatedPFNumber: String,
    relatedInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice'
    },
    relatedInvoiceNumber: String,
    date: {
      type: Date,
      default: Date.now,
      required: true,
      index: true
    },
    notes: {
      type: String,
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

quantityRecordSchema.index({ recordId: 'text', 'clientSnapshot.companyName': 'text', serviceName: 'text' });

module.exports = mongoose.model('QuantityRecord', quantityRecordSchema);
