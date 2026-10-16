const mongoose = require('mongoose');

const challanItemSchema = new mongoose.Schema({
  itemCode: { type: String, required: true },
  description: { type: String, required: true },
  quantityDispatched: { type: Number, required: true, min: 0.01 },
  quantityDelivered: { type: Number, default: 0, min: 0 },
  quantityInvoiced: { type: Number, default: 0, min: 0 },
  unit: { type: String, default: 'Units' },
  batchOrSerialNo: { type: String, trim: true },
  unitPriceEstimate: { type: Number, default: 0, min: 0 }, // For transit value declaration
  notes: String
});

const deliveryChallanSchema = new mongoose.Schema(
  {
    challanNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    challanDate: {
      type: Date,
      default: Date.now,
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
      billingAddress: String,
      shippingAddress: String,
      city: String,
      state: String,
      stateCode: String,
      pincode: String,
      gstin: String
    },
    deliveryAddress: {
      type: String,
      required: [true, 'Delivery address is required']
    },
    deliveryType: {
      type: String,
      enum: ['Supply on Approval', 'Job Work', 'Project Site Delivery', 'Material Supply', 'Inter-Branch Transfer', 'Other'],
      default: 'Material Supply'
    },
    projectOrWorkOrder: {
      type: String,
      trim: true
    },
    items: [challanItemSchema],

    // Logistics & Dispatch
    transporterName: String,
    vehicleNumber: String,
    driverName: String,
    driverPhone: String,
    lrOrDocketNumber: String,
    dispatchDate: Date,
    expectedDeliveryDate: Date,
    actualDeliveryDate: Date,

    // Acknowledgment
    receivedBy: {
      name: String,
      phone: String,
      designation: String,
      receivedAt: Date,
      remarks: String
    },

    status: {
      type: String,
      enum: ['Draft', 'Issued', 'Dispatched', 'Partially Delivered', 'Delivered', 'Invoiced', 'Cancelled'],
      default: 'Draft',
      index: true
    },
    
    // Invoicing Linkage
    invoices: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Invoice'
      }
    ],
    termsAndConditions: String,
    notes: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

deliveryChallanSchema.index({ challanNumber: 'text', 'clientSnapshot.companyName': 'text', projectOrWorkOrder: 'text' });

module.exports = mongoose.model('DeliveryChallan', deliveryChallanSchema);
