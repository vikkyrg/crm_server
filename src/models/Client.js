const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    companyName: {
      type: String,
      required: [true, 'Please provide company name'],
      trim: true,
      index: true
    },
    contactPerson: {
      type: String,
      required: [true, 'Please provide contact person name'],
      trim: true
    },
    primaryPhone: {
      type: String,
      required: [true, 'Please provide primary contact phone'],
      trim: true,
      index: true
    },
    alternatePhone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Please provide email address'],
      trim: true,
      lowercase: true,
      index: true
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      index: true
    },
    pan: {
      type: String,
      trim: true,
      uppercase: true
    },
    billingAddress: {
      type: String,
      required: [true, 'Please provide billing address'],
      trim: true
    },
    shippingAddress: {
      type: String,
      trim: true
    },
    city: {
      type: String,
      required: [true, 'Please provide city'],
      trim: true
    },
    state: {
      type: String,
      required: [true, 'Please provide state'],
      trim: true
    },
    stateCode: {
      type: String,
      trim: true
    },
    pincode: {
      type: String,
      required: [true, 'Please provide PIN code'],
      trim: true
    },
    assignedEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedEmployeeName: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

clientSchema.index({ companyName: 'text', contactPerson: 'text', email: 'text', gstin: 'text' });

module.exports = mongoose.model('Client', clientSchema);
