const express = require('express');
const router = express.Router();
const {
  getInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  recordInvoicePayment,
  downloadInvoicePDF,
  downloadInvoiceDocx
} = require('../controllers/invoiceController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getInvoices)
  .post(createInvoice);

router.route('/:id')
  .get(getInvoice)
  .put(updateInvoice)
  .delete(deleteInvoice);

router.post('/:id/payments', recordInvoicePayment);
router.get('/:id/pdf', downloadInvoicePDF);
router.get('/:id/docx', downloadInvoiceDocx);

module.exports = router;
