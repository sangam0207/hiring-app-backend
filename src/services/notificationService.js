const prisma = require('../config/prisma');

const createNotification = async ({ userId, applicationId, type, message }) => {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        applicationId,
        type,
        message,
        isRead: false
      }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
};

const getUnreadCount = async (userId) => {
  return await prisma.notification.count({
    where: {
      userId,
      isRead: false
    }
  });
};

const getNotifications = async (userId) => {
  return await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
};

const markAsRead = async (notificationId, userId) => {
  return await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId
    },
    data: { isRead: true }
  });
};

const markAllAsRead = async (userId) => {
  return await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true }
  });
};

module.exports = {
  createNotification,
  getUnreadCount,
  getNotifications,
  markAsRead,
  markAllAsRead
};
