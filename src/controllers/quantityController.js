const QuantityRecord = require('../models/QuantityRecord');
const Client = require('../models/Client');
const Service = require('../models/Service');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');

// @desc    Get all quantity records with search, filtering, and pagination
// @route   GET /api/quantities
// @access  Private
exports.getQuantities = async (req, res, next) => {
  try {
    const { search, client, service, startDate, endDate, page = 1, limit = 20, sort = '-date' } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { recordId: { $regex: search, $options: 'i' } },
        { serviceName: { $regex: search, $options: 'i' } },
        { serviceId: { $regex: search, $options: 'i' } },
        { 'clientSnapshot.companyName': { $regex: search, $options: 'i' } }
      ];
    }

    if (client) query.client = client;
    if (service) query.service = service;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const total = await QuantityRecord.countDocuments(query);
    const quantities = await QuantityRecord.find(query)
      .populate('client', 'companyName clientId')
      .populate('service', 'name serviceId unit')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      data: quantities
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single quantity record
// @route   GET /api/quantities/:id
// @access  Private
exports.getQuantity = async (req, res, next) => {
  try {
    const record = await QuantityRecord.findById(req.params.id)
      .populate('client')
      .populate('service');

    if (!record) {
      return res.status(404).json({ success: false, message: 'Quantity record not found' });
    }

    res.status(200).json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new quantity record
// @route   POST /api/quantities
// @access  Private
exports.createQuantity = async (req, res, next) => {
  try {
    const {
      clientId,
      serviceId,
      quantity,
      unit,
      unitPriceSnapshot,
      relatedPFNumber,
      relatedInvoiceNumber,
      date,
      notes
    } = req.body;

    if (!clientId || !serviceId || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Client, Service, and a positive quantity are required'
      });
    }

    const [client, service] = await Promise.all([
      Client.findById(clientId),
      Service.findById(serviceId)
    ]);

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const companySettings = await CompanySettings.findOne() || {};
    const prefix = companySettings.quantityPrefix || 'QTY-2026-';
    let candidateRecordId = '';
    let isUnique = false;
    while (!isUnique) {
      const seq = await getNextSequence('quantityRecordId');
      candidateRecordId = `${prefix}${String(seq).padStart(5, '0')}`;
      const exists = await QuantityRecord.findOne({ recordId: candidateRecordId });
      if (!exists) {
        isUnique = true;
      }
    }
    const recordId = candidateRecordId;

    const record = await QuantityRecord.create({
      recordId,
      client: client._id,
      clientSnapshot: {
        companyName: client.companyName,
        contactPerson: client.contactPerson
      },
      service: service._id,
      serviceId: service.serviceId,
      serviceName: service.name,
      quantity: Number(quantity),
      unit: unit || service.unit || 'Units',
      unitPriceSnapshot: unitPriceSnapshot !== undefined ? Number(unitPriceSnapshot) : service.defaultUnitPrice,
      relatedPFNumber,
      relatedInvoiceNumber,
      date: date || new Date(),
      notes,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      data: record,
      message: 'Quantity entry logged successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update quantity record
// @route   PUT /api/quantities/:id
// @access  Private
exports.updateQuantity = async (req, res, next) => {
  try {
    const { quantity, unit, unitPriceSnapshot, date, notes, relatedPFNumber, relatedInvoiceNumber } = req.body;

    const record = await QuantityRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Quantity record not found' });
    }

    if (quantity !== undefined) record.quantity = Number(quantity);
    if (unit !== undefined) record.unit = unit;
    if (unitPriceSnapshot !== undefined) record.unitPriceSnapshot = Number(unitPriceSnapshot);
    if (date !== undefined) record.date = date;
    if (notes !== undefined) record.notes = notes;
    if (relatedPFNumber !== undefined) record.relatedPFNumber = relatedPFNumber;
    if (relatedInvoiceNumber !== undefined) record.relatedInvoiceNumber = relatedInvoiceNumber;

    await record.save();

    res.status(200).json({
      success: true,
      data: record,
      message: 'Quantity entry updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete quantity record safely
// @route   DELETE /api/quantities/:id
// @access  Private
exports.deleteQuantity = async (req, res, next) => {
  try {
    const record = await QuantityRecord.findByIdAndDelete(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Quantity record not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Quantity record removed successfully'
    });
  } catch (error) {
    next(error);
  }
};
