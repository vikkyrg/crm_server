const CompanySettings = require('../models/CompanySettings');

// @desc    Get company settings
// @route   GET /api/settings
// @access  Public (for documents/branding) or Private
exports.getSettings = async (req, res, next) => {
  try {
    let settings = await CompanySettings.findOne();
    if (!settings) {
      settings = await CompanySettings.create({});
    }
    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update company settings
// @route   PUT /api/settings
// @access  Private (Administrator)
exports.updateSettings = async (req, res, next) => {
  try {
    const statutoryPayrollRules = req.body.statutoryPayrollRules || {};
    for (const scheme of ['pf', 'esi']) {
      const rule = statutoryPayrollRules[scheme];
      if (!rule) continue;
      const employeeRate = rule.employeeRate;
      const employerRate = rule.employerRate;
      const hasEmployeeRate = employeeRate !== undefined && employeeRate !== null && employeeRate !== '';
      const hasEmployerRate = employerRate !== undefined && employerRate !== null && employerRate !== '';
      if (hasEmployeeRate !== hasEmployerRate) {
        return res.status(400).json({
          success: false,
          message: `${scheme.toUpperCase()} employee and employer rates must both be configured`
        });
      }
      if (hasEmployeeRate && !rule.effectiveFrom) {
        return res.status(400).json({
          success: false,
          message: `${scheme.toUpperCase()} effective start date is required when rates are configured`
        });
      }
      if (scheme === 'esi' && hasEmployeeRate &&
        (rule.wageCeiling === undefined || rule.wageCeiling === null || rule.wageCeiling === '')) {
        return res.status(400).json({
          success: false,
          message: 'ESI wage ceiling is required when ESI rates are configured'
        });
      }
      if (rule.effectiveFrom && rule.effectiveTo && new Date(rule.effectiveTo) < new Date(rule.effectiveFrom)) {
        return res.status(400).json({
          success: false,
          message: `${scheme.toUpperCase()} effective end date cannot be before its start date`
        });
      }
    }

    let settings = await CompanySettings.findOne();
    if (!settings) {
      settings = await CompanySettings.create(req.body);
    } else {
      settings = await CompanySettings.findByIdAndUpdate(settings._id, req.body, {
        new: true,
        runValidators: true
      });
    }

    res.status(200).json({
      success: true,
      data: settings,
      message: 'Company settings updated successfully'
    });
  } catch (error) {
    next(error);
  }
};
