const express = require('express');
const router = express.Router();
const {
  getPfRecords,
  updatePfRemittance,
  batchRemitPfPeriod
} = require('../controllers/employeePfController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('Administrator'));

router.get('/', getPfRecords);
router.put('/:id/remit', updatePfRemittance);
router.post('/batch-remit', batchRemitPfPeriod);
router.post('/remit-period', batchRemitPfPeriod);

module.exports = router;
