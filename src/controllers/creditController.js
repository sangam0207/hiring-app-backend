const prisma = require("../config/prisma");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const creditService = require("../services/creditService");
const {
  STANDARD_PRICE_INR,
  PREMIUM_PRICE_INR,
  PLAN_DURATION_DAYS,
} = require("../config/credits");
const { successResponse, errorResponse } = require("../utils/response");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLAN_DETAILS = {
  STANDARD: {
    name: "Standard",
    priceInr: STANDARD_PRICE_INR,
    durationDays: PLAN_DURATION_DAYS,
    features: [
      "5 job posts per day",
      "AI Resume parsing & scoring",
      "AI skill matching",
      "AI candidate recommendations",
    ],
  },
  PREMIUM: {
    name: "Premium",
    priceInr: PREMIUM_PRICE_INR,
    durationDays: PLAN_DURATION_DAYS,
    features: [
      "10 job posts per day",
      "Everything in Standard",
      "Screening answer evaluation",
      "AI Interview generation",
      "JD AI Chatbot assistant",
      "Manual resume re-analysis",
    ],
  },
};

// GET /api/credits/plans — return all plans
const getPlans = async (req, res, next) => {
  try {
    return successResponse(res, { plans: PLAN_DETAILS });
  } catch (error) {
    next(error);
  }
};

// GET /api/credits/me — current plan info
const getMyCredits = async (req, res, next) => {
  try {
    const planInfo = await creditService.getPlanInfo(req.user.id);

    const payments = await prisma.payment.findMany({
      where: { userId: req.user.id, status: "PAID" },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return successResponse(res, { ...planInfo, payments });
  } catch (error) {
    next(error);
  }
};

// POST /api/credits/create-order — create Razorpay order for a plan
const createOrder = async (req, res, next) => {
  try {
    const { planType } = req.body;

    if (!planType || !PLAN_DETAILS[planType]) {
      return errorResponse(res, "Invalid plan type. Must be STANDARD or PREMIUM.");
    }

    const plan = PLAN_DETAILS[planType];

    const order = await razorpay.orders.create({
      amount: plan.priceInr,
      currency: "INR",
      receipt: `${planType.toLowerCase().slice(0, 4)}_${Date.now()}`,
    });

    await prisma.payment.create({
      data: {
        userId: req.user.id,
        planType,
        amount: plan.priceInr,
        durationDays: plan.durationDays,
        razorpayOrderId: order.id,
        status: "PENDING",
      },
    });

    return successResponse(res, {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: plan.name,
      planType,
      durationDays: plan.durationDays,
    }, "Order created.", 201);
  } catch (error) {
    next(error);
  }
};

// POST /api/credits/verify-payment — verify Razorpay signature and activate plan
const verifyPayment = async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return errorResponse(res, "Missing payment verification fields.");
    }

    // Verify signature
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      await prisma.payment.updateMany({
        where: { razorpayOrderId },
        data: { status: "FAILED" },
      });
      return errorResponse(res, "Payment verification failed.", 400);
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId },
    });

    if (!payment) return errorResponse(res, "Payment record not found.", 404);
    if (payment.status === "PAID") return errorResponse(res, "Payment already processed.", 409);
    if (payment.userId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        razorpayPaymentId,
        razorpaySignature,
        status: "PAID",
      },
    });

    // Activate the purchased plan
    const planInfo = await creditService.activatePlan(
      req.user.id,
      payment.planType,
      payment.durationDays
    );

    return successResponse(res, planInfo, `Payment verified. ${payment.planType} plan activated!`);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPlans,
  getMyCredits,
  createOrder,
  verifyPayment,
};
