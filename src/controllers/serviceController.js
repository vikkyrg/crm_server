const Service = require('../models/Service');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');

// @desc    Get all services with filtering, search, pagination
// @route   GET /api/services
// @access  Private
exports.getServices = async (req, res, next) => {
  try {
    const { search, category, status, page = 1, limit = 20, sort = '-createdAt' } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { serviceId: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    if (category) {
      query.category = category;
    }

    if (status) {
      query.isActive = status === 'active';
    }

    const total = await Service.countDocuments(query);
    const services = await Service.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Get unique categories for filter dropdowns
    const categories = await Service.distinct('category');

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      categories,
      data: services
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single service
// @route   GET /api/services/:id
// @access  Private
exports.getService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }
    res.status(200).json({ success: true, data: service });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new service
// @route   POST /api/services
// @access  Private
exports.createService = async (req, res, next) => {
  try {
    const { name, description, category, unit, defaultUnitPrice, taxRate, sacCode } = req.body;

    // Generate atomic Service ID if not supplied
    let serviceId = req.body.serviceId;
    if (!serviceId) {
      const settings = await CompanySettings.findOne();
      const prefix = settings?.servicePrefix || 'INN-SRV-';
      const seq = await getNextSequence('serviceId');
      serviceId = `${prefix}${String(seq).padStart(6, '0')}`;
    }

    const service = await Service.create({
      serviceId,
      name,
      description,
      category: category || 'General',
      unit: unit || 'Units',
      defaultUnitPrice: Number(defaultUnitPrice) || 0,
      taxRate: Number(taxRate) !== undefined ? Number(taxRate) : 18,
      sacCode: sacCode || '998313',
      isActive: true
    });

    res.status(201).json({
      success: true,
      data: service,
      message: 'Service created successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update service
// @route   PUT /api/services/:id
// @access  Private
exports.updateService = async (req, res, next) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    res.status(200).json({
      success: true,
      data: service,
      message: 'Service updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle service active status
// @route   PATCH /api/services/:id/toggle-status
// @access  Private
exports.toggleServiceStatus = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    service.isActive = !service.isActive;
    await service.save();

    res.status(200).json({
      success: true,
      data: service,
      message: `Service marked as ${service.isActive ? 'Active' : 'Inactive'}`
    });
  } catch (error) {
    next(error);
  }
};
