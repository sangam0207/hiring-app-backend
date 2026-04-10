const notificationService = require('../services/notificationService');
const { successResponse, errorResponse } = require('../utils/response');
const prisma = require('../config/prisma');

const getMyNotifications = async (req, res) => {
  try {
    const notifications = await notificationService.getNotifications(req.user.id);
    const unreadCount = await notificationService.getUnreadCount(req.user.id);
    return successResponse(res, { notifications, unreadCount });
  } catch (error) {
    return errorResponse(res, 'Failed to fetch notifications', 500);
  }
};

const markRead = async (req, res) => {
  try {
    const { id } = req.params;
    await notificationService.markAsRead(id, req.user.id);
    return successResponse(res, null, 'Notification marked as read');
  } catch (error) {
    return errorResponse(res, 'Failed to mark as read', 500);
  }
};

const markAllRead = async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.id);
    return successResponse(res, null, 'All notifications marked as read');
  } catch (error) {
    return errorResponse(res, 'Failed to mark all as read', 500);
  }
};

module.exports = {
  getMyNotifications,
  markRead,
  markAllRead
};
