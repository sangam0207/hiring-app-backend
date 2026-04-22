const prisma = require("../config/prisma");

const PAID_PLANS = ["STANDARD", "PREMIUM"];

/**
 * Check if a user has an active Premium plan.
 */
const isPremium = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!user || user.plan !== "PREMIUM") return false;
  if (!user.planExpiresAt) return false;
  return new Date(user.planExpiresAt) > new Date();
};

/**
 * Check if a user has any active paid plan (STANDARD or PREMIUM).
 */
const hasActivePlan = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!user || !PAID_PLANS.includes(user.plan)) return false;
  if (!user.planExpiresAt) return false;
  return new Date(user.planExpiresAt) > new Date();
};

/**
 * Get plan info for a user (for API responses).
 */
const getPlanInfo = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });
  if (!user) return { plan: "FREE", isPremium: false, isStandard: false, hasActivePlan: false, expiresAt: null };

  const notExpired =
    user.planExpiresAt && new Date(user.planExpiresAt) > new Date();

  const activePlan = PAID_PLANS.includes(user.plan) && notExpired;

  return {
    plan: activePlan ? user.plan : "FREE",
    isPremium: user.plan === "PREMIUM" && notExpired,
    isStandard: user.plan === "STANDARD" && notExpired,
    hasActivePlan: activePlan,
    expiresAt: activePlan ? user.planExpiresAt : null,
  };
};

/**
 * Activate a plan for a user (set plan + expiry).
 * If already on the same plan and not expired, extends from current expiry.
 */
const activatePlan = async (userId, planType, durationDays) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planExpiresAt: true },
  });

  let startsFrom = new Date();
  // If already on the same plan and not yet expired, extend from current expiry
  if (
    user &&
    user.plan === planType &&
    user.planExpiresAt &&
    new Date(user.planExpiresAt) > startsFrom
  ) {
    startsFrom = new Date(user.planExpiresAt);
  }

  const newExpiry = new Date(startsFrom);
  newExpiry.setDate(newExpiry.getDate() + durationDays);

  await prisma.user.update({
    where: { id: userId },
    data: {
      plan: planType,
      planExpiresAt: newExpiry,
    },
  });

  return { plan: planType, expiresAt: newExpiry };
};

module.exports = {
  isPremium,
  hasActivePlan,
  getPlanInfo,
  activatePlan,
};
