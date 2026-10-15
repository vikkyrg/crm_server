const express = require('express');
const router = express.Router();
const { exportReportCSV } = require('../controllers/reportController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/export/:type', exportReportCSV);

module.exports = router;
