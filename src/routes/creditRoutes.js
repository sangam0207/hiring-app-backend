const express = require("express");
const router = express.Router();
const { authenticate, requireHR } = require("../middleware/auth");
const creditCtrl = require("../controllers/creditController");

// Public: get premium plan details
router.get("/plans", creditCtrl.getPlans);

// HR only: plan info, purchase
router.get("/me", authenticate, requireHR, creditCtrl.getMyCredits);
router.post("/create-order", authenticate, requireHR, creditCtrl.createOrder);
router.post("/verify-payment", authenticate, requireHR, creditCtrl.verifyPayment);

module.exports = router;
