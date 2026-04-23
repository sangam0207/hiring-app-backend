const prisma = require("../config/prisma");
const {
  FREE_JOB_LIMIT,
  STANDARD_JOB_LIMIT_PER_DAY,
  PREMIUM_JOB_LIMIT_PER_DAY,
} = require("../config/credits");

const PAID_PLANS = ["STANDARD", "PREMIUM"];
const isDevEnvironment = process.env.NODE_ENV !== "production";
console.warn("is", isDevEnvironment);
/**
 * Middleware: require an active Premium plan.
 * Gates: AI Interview, JD Chatbot, Re-analysis, Screening evaluation.
 */
const requirePremium = async (req, res, next) => {
  try {
    if (isDevEnvironment) return next();

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true, planExpiresAt: true },
    });

    const isPremium =
      user &&
      user.plan === "PREMIUM" &&
      user.planExpiresAt &&
      new Date(user.planExpiresAt) > new Date();

    if (!isPremium) {
      return res.status(403).json({
        success: false,
        message: "Premium plan required for this feature.",
        code: "PREMIUM_REQUIRED",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware: require at least an active Standard plan (Standard or Premium).
 * Gates: AI resume parsing and other Standard+ features.
 */
const requireStandard = async (req, res, next) => {
  try {
    if (isDevEnvironment) return next();

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true, planExpiresAt: true },
    });

    const hasActive =
      user &&
      PAID_PLANS.includes(user.plan) &&
      user.planExpiresAt &&
      new Date(user.planExpiresAt) > new Date();

    if (!hasActive) {
      return res.status(403).json({
        success: false,
        message:
          "A paid plan is required for this feature. Please subscribe to Standard or Premium.",
        code: "PLAN_REQUIRED",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware: check job post limit based on plan tier.
 * FREE: 3 active jobs max (total)
 * STANDARD: 5 jobs per day
 * PREMIUM: 10 jobs per day
 */
const checkJobPostLimit = async (req, res, next) => {
  try {
    if (isDevEnvironment) return next();

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true, planExpiresAt: true },
    });

    const notExpired =
      user && user.planExpiresAt && new Date(user.planExpiresAt) > new Date();

    const activePlan =
      PAID_PLANS.includes(user?.plan) && notExpired ? user.plan : "FREE";

    if (activePlan === "FREE") {
      // Free: max 3 active/draft jobs total
      const activeJobCount = await prisma.job.count({
        where: {
          hrId: req.user.id,
          status: { in: ["ACTIVE", "DRAFT"] },
        },
      });

      if (activeJobCount >= FREE_JOB_LIMIT) {
        return res.status(403).json({
          success: false,
          message: `Free plan allows up to ${FREE_JOB_LIMIT} active jobs. Subscribe to a paid plan for more.`,
          code: "JOB_LIMIT_REACHED",
          limit: FREE_JOB_LIMIT,
          current: activeJobCount,
        });
      }

      return next();
    }

    // Paid plans: daily job creation limit
    const dailyLimit =
      activePlan === "PREMIUM"
        ? PREMIUM_JOB_LIMIT_PER_DAY
        : STANDARD_JOB_LIMIT_PER_DAY;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const jobsCreatedToday = await prisma.job.count({
      where: {
        hrId: req.user.id,
        createdAt: { gte: todayStart },
      },
    });

    if (jobsCreatedToday >= dailyLimit) {
      return res.status(403).json({
        success: false,
        message: `${activePlan === "PREMIUM" ? "Premium" : "Standard"} plan allows ${dailyLimit} job posts per day. You've reached today's limit.`,
        code: "DAILY_JOB_LIMIT_REACHED",
        limit: dailyLimit,
        current: jobsCreatedToday,
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { requirePremium, requireStandard, checkJobPostLimit };
