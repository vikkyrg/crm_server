const express = require('express');
const router = express.Router();
const { register, login, getMe, getUsers, createEmployee, deleteEmployee } = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);

router.route('/users')
  .get(protect, getUsers)
  .post(protect, authorize('Administrator'), createEmployee);

router.route('/users/:id')
  .delete(protect, authorize('Administrator'), deleteEmployee);

module.exports = router;
