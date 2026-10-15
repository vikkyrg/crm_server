const express = require('express');
const router = express.Router();
const {
  getQuantities,
  getQuantity,
  createQuantity,
  updateQuantity,
  deleteQuantity
} = require('../controllers/quantityController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getQuantities)
  .post(createQuantity);

router.route('/:id')
  .get(getQuantity)
  .put(updateQuantity)
  .delete(deleteQuantity);

module.exports = router;
