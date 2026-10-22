const express = require('express');
const router = express.Router();
const {
  getPayrollRuns,
  getPayrollRun,
  previewMonthlyPayroll,
  savePayrollRun,
  finalizePayrollBatch,
  recordSalaryPayment,
  downloadPayslipPDF,
  calculateEmployeeSalary,
  getEmployeePayslip,
  saveEmployeePayslip,
  downloadPayslipPDFDirect
} = require('../controllers/payrollController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Individual Employee Salary & Payslip workflow
router.post('/calculate-employee', authorize('Administrator', 'Finance'), calculateEmployeeSalary);
router.route('/employee-payslip')
  .get(getEmployeePayslip)
  .post(authorize('Administrator'), saveEmployeePayslip);
router.get('/payslip-pdf', downloadPayslipPDFDirect);

// Batch Payroll Runs & Registers
router.route('/')
  .get(authorize('Administrator', 'Finance'), getPayrollRuns)
  .post(authorize('Administrator'), savePayrollRun);

router.post('/preview', authorize('Administrator', 'Finance'), previewMonthlyPayroll);
router.post('/save', authorize('Administrator'), savePayrollRun);

router.route('/:id')
  .get(authorize('Administrator', 'Finance'), getPayrollRun);

router.post('/:id/finalize', authorize('Administrator'), finalizePayrollBatch);

router.post('/:id/pay/:employeeId', authorize('Administrator'), recordSalaryPayment);
router.post('/:id/employees/:employeeId/payment', authorize('Administrator'), recordSalaryPayment);
router.get('/:id/payslip/:employeeId/pdf', downloadPayslipPDF);
router.get('/:id/employees/:employeeId/payslip', downloadPayslipPDF);
router.get('/:id/employees/:employeeId/payslip/pdf', downloadPayslipPDF);

module.exports = router;
