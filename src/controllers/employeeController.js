const Employee = require('../models/Employee');
const PayrollRun = require('../models/PayrollRun');
const EmployeePfRecord = require('../models/EmployeePfRecord');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');

// @desc    Get all employees with search, department, and status filters
// @route   GET /api/employees
// @access  Private
exports.getEmployees = async (req, res, next) => {
  try {
    const { search, department, status, page = 1, limit = 20, sort = '-createdAt' } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { designation: { $regex: search, $options: 'i' } }
      ];
    }

    if (department) {
      query.department = department;
    }

    if (status) {
      query.employmentStatus = status;
    }

    const total = await Employee.countDocuments(query);
    const employees = await Employee.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Get distinct departments for filter dropdown
    const departments = await Employee.distinct('department');

    res.status(200).json({
      success: true,
      total,
      totalCount: total,
      page: Number(page),
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      departments,
      data: employees,
      employees
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single employee details with salary history and PF summary
// @route   GET /api/employees/:id
// @access  Private
exports.getEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // Role-based security check for salary and bank details
    const isAuthorizedForSensitive = req.user && req.user.role === 'Administrator';

    // Retrieve payroll history for this employee
    const payrollHistory = await PayrollRun.aggregate([
      { $unwind: '$items' },
      { $match: { 'items.employee': employee._id } },
      {
        $project: {
          payrollCode: '$payrollCode',
          periodName: '$periodName',
          month: '$month',
          year: '$year',
          item: '$items',
          status: '$status',
          createdAt: '$createdAt'
        }
      },
      { $sort: { year: -1, month: -1 } }
    ]);

    // Retrieve PF statutory records
    const pfRecords = await EmployeePfRecord.find({ employee: employee._id }).sort({ year: -1, month: -1 });

    const safeEmployee = employee.toObject();
    if (!isAuthorizedForSensitive) {
      // Redact sensitive details for standard staff
      delete safeEmployee.bankDetails;
      delete safeEmployee.salaryStructure;
    }

    res.status(200).json({
      success: true,
      data: safeEmployee,
      payrollHistory: isAuthorizedForSensitive ? payrollHistory : [],
      pfRecords: isAuthorizedForSensitive ? pfRecords : []
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new employee
// @route   POST /api/employees
// @access  Private (Administrator, Finance)
exports.createEmployee = async (req, res, next) => {
  try {
    let employeeId = req.body.employeeId;
    if (!employeeId || employeeId.trim() === '') {
      const settings = await CompanySettings.findOne();
      const prefix = settings?.employeePrefix || 'EMP-';
      let candidateId = '';
      let isUnique = false;
      while (!isUnique) {
        const seq = await getNextSequence('employeeId');
        candidateId = `${prefix}${String(seq).padStart(3, '0')}`;
        const exists = await Employee.findOne({ employeeId: candidateId });
        if (!exists) {
          isUnique = true;
        }
      }
      employeeId = candidateId;
    } else {
      // Validate unique employeeId
      const exists = await Employee.findOne({ employeeId: employeeId.trim() });
      if (exists) {
        return res.status(400).json({ success: false, message: `Employee ID "${employeeId}" already exists. Please choose a different ID or leave blank to auto-generate.` });
      }
    }

    // Validate email
    const emailExists = await Employee.findOne({ email: req.body.email.trim().toLowerCase() });
    if (emailExists) {
      return res.status(400).json({ success: false, message: `Email ${req.body.email} is already in use by another employee.` });
    }

    const employee = await Employee.create({
      ...req.body,
      employeeId: employeeId.trim(),
      email: req.body.email.trim().toLowerCase()
    });

    res.status(201).json({
      success: true,
      data: employee,
      message: 'Employee registered successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update employee
// @route   PUT /api/employees/:id
// @access  Private (Administrator, Finance)
exports.updateEmployee = async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // Check duplicate email if changed
    if (req.body.email && req.body.email.trim().toLowerCase() !== employee.email) {
      const exists = await Employee.findOne({ email: req.body.email.trim().toLowerCase(), _id: { $ne: employee._id } });
      if (exists) {
        return res.status(400).json({ success: false, message: `Email ${req.body.email} is already registered.` });
      }
    }

    // Check duplicate employee ID if changed
    if (req.body.employeeId && req.body.employeeId.trim() !== employee.employeeId) {
      const exists = await Employee.findOne({ employeeId: req.body.employeeId.trim(), _id: { $ne: employee._id } });
      if (exists) {
        return res.status(400).json({ success: false, message: `Employee ID ${req.body.employeeId} already belongs to someone else.` });
      }
    }

    Object.assign(employee, req.body);
    await employee.save();

    res.status(200).json({
      success: true,
      data: employee,
      message: 'Employee record updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle or update employee status (Active / Inactive / Resigned)
// @route   PATCH /api/employees/:id/status
// @access  Private (Administrator, Finance)
exports.updateEmployeeStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    employee.employmentStatus = status || (employee.employmentStatus === 'Active' ? 'Inactive' : 'Active');
    await employee.save();

    res.status(200).json({
      success: true,
      data: employee,
      message: `Employee marked as ${employee.employmentStatus}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete employee safely (Blocked if payroll or statutory records exist)
// @route   DELETE /api/employees/:id
// @access  Private (Administrator)
exports.deleteEmployee = async (req, res, next) => {
  try {
    const employeeId = req.params.id;
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // Check historical payroll dependencies
    const payrollCount = await PayrollRun.countDocuments({ 'items.employee': employee._id });
    const pfCount = await EmployeePfRecord.countDocuments({ employee: employee._id });

    // If query contains deactivateOnly or forceDeactivate, mark as Terminated / Inactive
    if (req.query.action === 'deactivate') {
      employee.employmentStatus = 'Terminated';
      await employee.save();
      return res.status(200).json({
        success: true,
        action: 'deactivated',
        data: employee,
        message: `Employee ${employee.fullName} (${employee.employeeId}) has been marked as Terminated/Archived.`
      });
    }

    if (payrollCount > 0 || pfCount > 0) {
      return res.status(400).json({
        success: false,
        canDeactivate: true,
        payrollCount,
        pfCount,
        message: `Cannot permanently delete employee ${employee.fullName} (${employee.employeeId}) because historical payroll (${payrollCount}) or statutory PF (${pfCount}) records exist. Please deactivate or mark the employee as Inactive instead to maintain statutory audit integrity.`
      });
    }

    await Employee.findByIdAndDelete(employeeId);

    res.status(200).json({
      success: true,
      action: 'deleted',
      message: `Employee ${employee.fullName} (${employee.employeeId}) deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};
