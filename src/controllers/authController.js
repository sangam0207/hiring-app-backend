const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const { successResponse, errorResponse } = require("../utils/response");

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, name, role, company, phone } = req.body;

    if (!email || !password || !name || !role) {
      return errorResponse(res, "Email, password, name, and role are required.");
    }

    if (!["HR", "CANDIDATE"].includes(role)) {
      return errorResponse(res, "Role must be HR or CANDIDATE.");
    }

    if (role === "HR" && !company) {
      return errorResponse(res, "Company name is required for HR users.");
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return errorResponse(res, "Email already registered.", 409);
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        company: role === "HR" ? company : null,
        phone: phone || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company: true,
        createdAt: true,
      },
    });

    const token = generateToken(user.id);

    return successResponse(
      res,
      { user, token },
      "Registration successful.",
      201
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return errorResponse(res, "Email and password are required.");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return errorResponse(res, "Invalid email or password.", 401);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return errorResponse(res, "Invalid email or password.", 401);
    }

    const token = generateToken(user.id);

    const userWithoutPassword = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      company: user.company,
      phone: user.phone,
    };

    return successResponse(res, { user: userWithoutPassword, token }, "Login successful.");
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/me
const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company: true,
        phone: true,
        createdAt: true,
      },
    });

    return successResponse(res, { user });
  } catch (error) {
    next(error);
  }
};

// PUT /api/auth/me
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, company } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(company && req.user.role === "HR" && { company }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company: true,
        phone: true,
      },
    });

    return successResponse(res, { user }, "Profile updated.");
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, getMe, updateProfile };
