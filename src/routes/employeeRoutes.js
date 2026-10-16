const express = require('express');
const router = express.Router();
const {
  getEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  updateEmployeeStatus,
  deleteEmployee
} = require('../controllers/employeeController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getEmployees)
  .post(authorize('Administrator'), createEmployee);

router.route('/:id')
  .get(getEmployee)
  .put(authorize('Administrator'), updateEmployee)
  .delete(authorize('Administrator'), deleteEmployee);

router.patch('/:id/status', authorize('Administrator'), updateEmployeeStatus);

module.exports = router;
