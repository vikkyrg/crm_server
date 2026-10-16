const express = require('express');
const router = express.Router();
const {
  getChallans,
  getChallan,
  createChallan,
  updateChallan,
  updateDeliveryStatus,
  cancelChallan,
  downloadChallanPDF
} = require('../controllers/deliveryChallanController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getChallans)
  .post(createChallan);

router.route('/:id')
  .get(getChallan)
  .put(updateChallan);

router.patch('/:id/delivery-status', updateDeliveryStatus);
router.patch('/:id/cancel', cancelChallan);
router.get('/:id/pdf', downloadChallanPDF);

module.exports = router;
