const express = require('express');
const router = express.Router();
const {
  getPayrollRuns,
  getPayrollRun,
  previewMonthlyPayroll,
  savePayrollRun,
  recordSalaryPayment,
  downloadPayslipPDF
} = require('../controllers/payrollController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(authorize('Administrator'), getPayrollRuns);

router.post('/preview', authorize('Administrator'), previewMonthlyPayroll);
router.post('/save', authorize('Administrator'), savePayrollRun);

router.route('/:id')
  .get(authorize('Administrator'), getPayrollRun);

router.post('/:id/pay/:employeeId', authorize('Administrator'), recordSalaryPayment);
router.get('/:id/payslip/:employeeId/pdf', downloadPayslipPDF);

module.exports = router;
