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
    const { challanNumber, challanTrrn, remittanceDate, bankReference, remarks, remittanceStatus } = req.body;

    const record = await EmployeePfRecord.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Employee PF record not found' });
    }

    const suppliedChallan = challanNumber !== undefined ? challanNumber : challanTrrn;
    if (suppliedChallan !== undefined) record.challanNumber = suppliedChallan;
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

// @desc    Get preview / summary of pending PF records for a given period before remitting
// @route   GET /api/employee-pf/pending-summary
// @access  Private (Administrator)
exports.getPendingPeriodSummary = async (req, res, next) => {
  try {
    const { month, year, periodMonth, periodYear } = req.query;
    const rawMonth = month !== undefined ? month : periodMonth;
    const finalYear = Number(year || periodYear);

    if (!rawMonth || !finalYear) {
      return res.status(400).json({ success: false, message: 'Month and year are required' });
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

    const records = await EmployeePfRecord.find({
      month: monthNum,
      year: finalYear,
      remittanceStatus: 'Pending'
    }).populate('employee', 'department designation');

    const totalEmployees = records.length;
    const totalWageBase = round2(records.reduce((acc, r) => acc + (Number(r.pfWageBase) || 0), 0));
    const totalEmployeeShare = round2(records.reduce((acc, r) => acc + (Number(r.employeeContribution) || 0), 0));
    const totalEmployerShare = round2(records.reduce((acc, r) => acc + (Number(r.employerContribution) || 0), 0));
    const totalDeposit = round2(records.reduce((acc, r) => acc + (Number(r.totalPfAmount) || 0), 0));

    // Also check already remitted count
    const alreadyRemittedCount = await EmployeePfRecord.countDocuments({
      month: monthNum,
      year: finalYear,
      remittanceStatus: 'Remitted'
    });

    res.status(200).json({
      success: true,
      month: monthNum,
      year: finalYear,
      pendingCount: totalEmployees,
      alreadyRemittedCount,
      summary: {
        totalEmployees,
        totalWageBase,
        totalEmployeeShare,
        totalEmployerShare,
        totalDeposit
      },
      records
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Batch remit PF records for an entire payroll period with a single Challan / TRRN
// @route   POST /api/employee-pf/batch-remit or POST /api/employee-pf/remit-period
// @access  Private (Administrator, Finance)
exports.batchRemitPfPeriod = async (req, res, next) => {
  try {
    const {
      month,
      year,
      periodMonth,
      periodYear,
      challanNumber,
      challanTrrn,
      remittanceDate,
      bankReference,
      remarks,
      notes
    } = req.body;

    const rawMonth = month !== undefined ? month : periodMonth;
    const finalYear = Number(year || periodYear);
    const finalChallan = (challanNumber || challanTrrn || '').trim();
    const finalRemarks = remarks || notes;

    if (!rawMonth || !finalYear || !finalChallan) {
      return res.status(400).json({ success: false, message: 'Month, year, and a valid challan / TRRN reference are required' });
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

    // Find strictly pending records for this month and year
    const pendingRecords = await EmployeePfRecord.find({
      month: monthNum,
      year: finalYear,
      remittanceStatus: 'Pending'
    });

    if (pendingRecords.length === 0) {
      // Check if all were already remitted to provide clear duplicate prevention message
      const alreadyRemitted = await EmployeePfRecord.countDocuments({
        month: monthNum,
        year: finalYear,
        remittanceStatus: 'Remitted'
      });

      if (alreadyRemitted > 0) {
        return res.status(400).json({
          success: false,
          message: `All ${alreadyRemitted} PF record(s) for ${rawMonth} ${finalYear} have already been remitted. Duplicate remittance is not permitted.`
        });
      }

      return res.status(400).json({
        success: false,
        message: `No pending PF records found for ${rawMonth} ${finalYear} to remit.`
      });
    }

    const result = await EmployeePfRecord.updateMany(
      {
        month: monthNum,
        year: finalYear,
        remittanceStatus: 'Pending'
      },
      {
        $set: {
          remittanceStatus: 'Remitted',
          challanNumber: finalChallan,
          remittanceDate: remittanceDate ? new Date(remittanceDate) : new Date(),
          bankReference: (bankReference || '').trim(),
          remarks: finalRemarks ? String(finalRemarks).trim() : `Batch remitted under EPFO Challan ${finalChallan}`
        }
      }
    );

    res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount,
      remittedCount: result.modifiedCount,
      challanNumber: finalChallan,
      message: `Successfully marked ${result.modifiedCount} employee PF record(s) as Remitted under Challan/TRRN ${finalChallan}`
    });
  } catch (error) {
    next(error);
  }
};
