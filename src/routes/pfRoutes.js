const express = require('express');
const router = express.Router();
const {
  getPFDocuments,
  getPFDocument,
  createPFDocument,
  updatePFDocument,
  deletePFDocument,
  convertPFToInvoice,
  downloadPFPDF,
  downloadPFDocx
} = require('../controllers/pfController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getPFDocuments)
  .post(createPFDocument);

router.route('/:id')
  .get(getPFDocument)
  .put(updatePFDocument)
  .delete(deletePFDocument);

router.post('/:id/convert-to-invoice', convertPFToInvoice);
router.get('/:id/pdf', downloadPFPDF);
router.get('/:id/docx', downloadPFDocx);

module.exports = router;
