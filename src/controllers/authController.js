const User = require('../models/User');
const jwt = require('jsonwebtoken');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'innomatrics_crm_super_secret_jwt_key_2026_production_safe', {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// @desc    Register initial admin / user
// @route   POST /api/auth/register
// @access  Public (for initial setup) / Admin
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, employeeId, phone } = req.body;

    const userCount = await User.countDocuments();
    // First user is automatically Administrator
    const assignedRole = userCount === 0 ? 'Administrator' : (role || 'Staff');

    const user = await User.create({
      name,
      email,
      password,
      role: assignedRole,
      employeeId,
      phone
    });

    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact administrator.'
      });
    }

    const token = signToken(user._id);

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all employees / users for assignments
// @route   GET /api/auth/users
// @access  Private
exports.getUsers = async (req, res, next) => {
  try {
    const users = await User.find({ isActive: true }).select('name email role employeeId phone createdAt');
    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new employee from Settings
// @route   POST /api/auth/users
// @access  Private (Admin only)
exports.createEmployee = async (req, res, next) => {
  try {
    const { name, email, password, role, employeeId, phone } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Please provide employee name and email' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }

    let empId = employeeId;
    if (!empId) {
      const userCount = await User.countDocuments();
      empId = `EMP-${String(userCount + 1).padStart(3, '0')}`;
    }

    const newEmployee = await User.create({
      name,
      email: email.toLowerCase(),
      password: password || 'Innomatrics123!',
      role: role || 'Staff',
      employeeId: empId,
      phone: phone || ''
    });

    res.status(201).json({
      success: true,
      data: {
        _id: newEmployee._id,
        name: newEmployee.name,
        email: newEmployee.email,
        role: newEmployee.role,
        employeeId: newEmployee.employeeId,
        phone: newEmployee.phone
      },
      message: 'Employee added successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete/Deactivate employee
// @route   DELETE /api/auth/users/:id
// @access  Private (Admin only)
exports.deleteEmployee = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    // Do not allow deleting own self or the main admin
    if (req.user._id.toString() === user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot remove your own active administrator account' });
    }

    user.isActive = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Employee ${user.name} removed successfully`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Change current user password
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both current password and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password does not match'
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

