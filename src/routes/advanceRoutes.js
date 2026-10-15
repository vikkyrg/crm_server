const express = require('express');
const router = express.Router();
const {
  getAdvances,
  getAdvance,
  createAdvance,
  updateAdvance,
  deleteAdvance,
  allocateAdvance,
  deallocateAdvance,
  reverseAdvance,
  downloadAdvanceReceiptPDF
} = require('../controllers/advanceController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getAdvances)
  .post(createAdvance);

router.route('/:id')
  .get(getAdvance)
  .put(authorize('Administrator', 'Finance'), updateAdvance)
  .delete(authorize('Administrator', 'Finance'), deleteAdvance);

router.post('/:id/allocate', allocateAdvance);
router.post('/:id/deallocate', authorize('Administrator', 'Finance'), deallocateAdvance);
router.post('/:id/reverse', authorize('Administrator', 'Finance'), reverseAdvance);
router.get('/:id/pdf', downloadAdvanceReceiptPDF);

module.exports = router;
