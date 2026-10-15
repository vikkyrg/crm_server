const express = require('express');
const router = express.Router();
const {
  getServices,
  getService,
  createService,
  updateService,
  toggleServiceStatus
} = require('../controllers/serviceController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getServices)
  .post(createService);

router.route('/:id')
  .get(getService)
  .put(updateService);

router.patch('/:id/toggle-status', toggleServiceStatus);

module.exports = router;
