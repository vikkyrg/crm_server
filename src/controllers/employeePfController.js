const EmployeePfRecord = require('../models/EmployeePfRecord');
const Employee = require('../models/Employee');
const { round2 } = require('../utils/financials');

// @desc    Get all employee PF statutory records with filtering by period, employee, status
// @route   GET /api/employee-pf
// @access  Private (Administrator, Finance)
exports.getPfRecords = async (req, res, next) => {
  try {
    const { month, year, periodMonth, periodYear, employeeId, status, search, page = 1, limit = 50, sort = '-year -month' } = req.query;
    const query = {};

    const rawMonth = month !== undefined ? month : periodMonth;
    const rawYear = year !== undefined ? year : periodYear;

    if (rawMonth) {
      let mNum = Number(rawMonth);
      if (isNaN(mNum)) {
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const idx = monthNames.indexOf(String(rawMonth).toLowerCase());
        if (idx !== -1) mNum = idx + 1;
      }
      if (mNum) query.month = mNum;
    }

    if (rawYear) query.year = Number(rawYear);
    if (status) query.remittanceStatus = status;

    if (employeeId) {
      query.employeeId = { $regex: employeeId, $options: 'i' };
    }

    if (search) {
      query.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { uan: { $regex: search, $options: 'i' } },
        { pfAccountNumber: { $regex: search, $options: 'i' } },
        { challanNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await EmployeePfRecord.countDocuments(query);
    const records = await EmployeePfRecord.find(query)
      .populate('employee', 'department designation email phone')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Summary statistics for selected query
    const stats = await EmployeePfRecord.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalWageBase: { $sum: '$pfWageBase' },
          totalEmployeeShare: { $sum: '$employeeContribution' },
          totalEmployerShare: { $sum: '$employerContribution' },
          totalPfPool: { $sum: '$totalPfAmount' },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$remittanceStatus', 'Pending'] }, 1, 0] }
          },
          remittedCount: {
            $sum: { $cond: [{ $eq: ['$remittanceStatus', 'Remitted'] }, 1, 0] }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      total,
      totalCount: total,
      page: Number(page),
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      summary: stats[0] || {
        totalWageBase: 0,
        totalEmployeeShare: 0,
        totalEmployerShare: 0,
        totalPfPool: 0,
        pendingCount: 0,
        remittedCount: 0
      },
      data: records,
      records
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Record or update PF remittance details (Challan TRRN, Remittance Date, Bank Ref)
// @route   PUT /api/employee-pf/:id/remit
// @access  Private (Administrator, Finance)
exports.updatePfRemittance = async (req, res, next) => {
  try {
    const { challanNumber, remittanceDate, bankReference, remarks, remittanceStatus } = req.body;

    const record = await EmployeePfRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Employee PF record not found' });
    }

    if (challanNumber !== undefined) record.challanNumber = challanNumber;
    if (remittanceDate !== undefined) record.remittanceDate = remittanceDate;
    if (bankReference !== undefined) record.bankReference = bankReference;
    if (remarks !== undefined) record.remarks = remarks;
    if (remittanceStatus !== undefined) record.remittanceStatus = remittanceStatus;

    await record.save();

    res.status(200).json({
      success: true,
      data: record,
      message: `PF Remittance updated for ${record.employeeName} (${record.periodName})`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Batch remit PF records for an entire payroll period with a single Challan / TRRN
// @route   POST /api/employee-pf/batch-remit
// @access  Private (Administrator, Finance)
exports.batchRemitPfPeriod = async (req, res, next) => {
  try {
    const { month, year, periodMonth, periodYear, challanNumber, challanTrrn, remittanceDate, bankReference, remarks, notes } = req.body;

    const rawMonth = month !== undefined ? month : periodMonth;
    const finalYear = Number(year || periodYear);
    const finalChallan = challanNumber || challanTrrn;
    const finalRemarks = remarks || notes;

    if (!rawMonth || !finalYear || !finalChallan) {
      return res.status(400).json({ success: false, message: 'Month, year, and challan reference number are required' });
    }

    let monthNum = Number(rawMonth);
    if (isNaN(monthNum)) {
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      const idx = monthNames.indexOf(String(rawMonth).toLowerCase());
      monthNum = idx !== -1 ? idx + 1 : null;
    }

    if (!monthNum || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ success: false, message: 'Valid month (1-12 or month name) is required' });
    }

    const result = await EmployeePfRecord.updateMany(
      { month: monthNum, year: finalYear, remittanceStatus: { $ne: 'Reversed' } },
      {
        remittanceStatus: 'Remitted',
        challanNumber: finalChallan,
        remittanceDate: remittanceDate || new Date(),
        bankReference,
        remarks: finalRemarks || `Batch remitted under Challan ${finalChallan}`
      }
    );

    res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: `Successfully marked ${result.modifiedCount} employee PF records as Remitted under Challan ${finalChallan}`
    });
  } catch (error) {
    next(error);
  }
};
