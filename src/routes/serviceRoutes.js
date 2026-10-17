const express = require('express');
const router = express.Router();
const {
  getServices,
  getService,
  createService,
  updateService,
  deleteService,
  toggleServiceStatus
} = require('../controllers/serviceController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getServices)
  .post(createService);

router.route('/:id')
  .get(getService)
  .put(updateService)
  .delete(authorize('Administrator'), deleteService);

router.patch('/:id/toggle-status', toggleServiceStatus);

module.exports = router;
