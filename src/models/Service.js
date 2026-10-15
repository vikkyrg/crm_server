const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    serviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Please provide service name'],
      trim: true,
      index: true
    },
    description: {
      type: String,
      trim: true
    },
    category: {
      type: String,
      default: 'General',
      trim: true,
      index: true
    },
    unit: {
      type: String,
      default: 'Hours',
      trim: true
    },
    defaultUnitPrice: {
      type: Number,
      required: [true, 'Please provide default unit price'],
      min: [0, 'Unit price cannot be negative'],
      default: 0
    },
    taxRate: {
      type: Number,
      default: 18,
      min: [0, 'Tax rate cannot be negative']
    },
    sacCode: {
      type: String,
      trim: true,
      default: '998313' // Information technology consulting and support services
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

module.exports = mongoose.model('Service', serviceSchema);
