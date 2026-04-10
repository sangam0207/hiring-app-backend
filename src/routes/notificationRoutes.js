const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, notificationController.getMyNotifications);
router.put('/mark-all-read', authenticate, notificationController.markAllRead);
router.put('/:id/read', authenticate, notificationController.markRead);

module.exports = router;
