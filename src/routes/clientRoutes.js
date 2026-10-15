const express = require('express');
const router = express.Router();
const {
  getClients,
  getClient,
  createClient,
  updateClient,
  toggleClientStatus,
  getClientDeletionSummary,
  permanentDeleteClient
} = require('../controllers/clientController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(getClients)
  .post(createClient);

router.route('/:id')
  .get(getClient)
  .put(updateClient)
  .delete(authorize('Administrator'), permanentDeleteClient);

router.patch('/:id/toggle-status', toggleClientStatus);
router.get('/:id/deletion-summary', authorize('Administrator'), getClientDeletionSummary);
router.delete('/:id/permanent', authorize('Administrator'), permanentDeleteClient);

module.exports = router;
