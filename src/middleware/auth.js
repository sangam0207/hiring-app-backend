const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company: true,
        plan: true,
        planExpiresAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid token. User not found.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ success: false, message: "Token expired. Please login again." });
    }
    return res
      .status(401)
      .json({ success: false, message: "Invalid token." });
  }
};

// Role-based guards
const requireHR = (req, res, next) => {
  if (req.user.role !== "HR") {
    return res.status(403).json({
      success: false,
      message: "Access denied. HR role required.",
    });
  }
  next();
};

const requireCandidate = (req, res, next) => {
  if (req.user.role !== "CANDIDATE") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Candidate role required.",
    });
  }
  next();
};

module.exports = { authenticate, requireHR, requireCandidate };
