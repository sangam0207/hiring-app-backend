const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const { successResponse, errorResponse } = require("../utils/response");
const { uploadImage, deleteResume: deleteS3File, getSignedUrl } = require("../services/s3Service");

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

function signImageUrls(user) {
  if (!user) return user;
  const copy = { ...user };
  if (copy.profileImageUrl) copy.profileImageUrl = getSignedUrl(copy.profileImageUrl, 86400) || copy.profileImageUrl;
  if (copy.coverImageUrl)   copy.coverImageUrl   = getSignedUrl(copy.coverImageUrl,   86400) || copy.coverImageUrl;
  return copy;
}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  company: true,
  phone: true,
  profileImageUrl: true,
  coverImageUrl: true,
  plan: true,
  planExpiresAt: true,
  createdAt: true,
};

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, name, role, company, phone } = req.body;

    if (!email || !password || !name || !role)
      return errorResponse(res, "Email, password, name, and role are required.");

    if (!["HR", "CANDIDATE"].includes(role))
      return errorResponse(res, "Role must be HR or CANDIDATE.");

    if (role === "HR" && !company)
      return errorResponse(res, "Company name is required for HR users.");

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return errorResponse(res, "Email already registered.", 409);

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
      select: USER_SELECT,
    });

    const token = generateToken(user.id);
    return successResponse(res, { user, token }, "Registration successful.", 201);
  } catch (error) { next(error); }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return errorResponse(res, "Email and password are required.");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return errorResponse(res, "Invalid email or password.", 401);

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return errorResponse(res, "Invalid email or password.", 401);

    const token = generateToken(user.id);

    const userWithoutPassword = {
      id: user.id, email: user.email, name: user.name,
      role: user.role, company: user.company, phone: user.phone,
      plan: user.plan, planExpiresAt: user.planExpiresAt,
    };

    return successResponse(res, { user: userWithoutPassword, token }, "Login successful.");
  } catch (error) { next(error); }
};

// GET /api/auth/me
const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: USER_SELECT,
    });
    return successResponse(res, { user: signImageUrls(user) });
  } catch (error) { next(error); }
};

// PUT /api/auth/me — basic fields only: name, phone, company
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, company } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        name,
        phone,
        ...(req.user.role === "HR" && { company }),
      },
      select: USER_SELECT,
    });

    return successResponse(res, { user: signImageUrls(user) }, "Profile updated.");
  } catch (error) { next(error); }
};

// GET /api/users/:id/profile — public candidate profile for HR
const getPublicProfile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, role: true, phone: true,
        profileImageUrl: true, coverImageUrl: true, createdAt: true,
        profiles: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          take: 1,
        },
      },
    });

    if (!user) return errorResponse(res, "User not found.", 404);
    if (user.role !== "CANDIDATE") return errorResponse(res, "Profile not available.", 404);

    const defaultProfile = user.profiles[0] || null;

    return successResponse(res, {
      profile: {
        ...signImageUrls(user),
        profiles: undefined,
        activeProfile: defaultProfile,
      },
    });
  } catch (error) { next(error); }
};

// POST /api/auth/upload-profile-image
const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, "Image file is required.");

    const imageUrl = await uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype);

    const current = await prisma.user.findUnique({ where: { id: req.user.id }, select: { profileImageUrl: true } });
    if (current?.profileImageUrl) deleteS3File(current.profileImageUrl).catch(() => {});

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { profileImageUrl: imageUrl },
      select: { id: true, profileImageUrl: true },
    });

    return successResponse(res, { user }, "Profile image uploaded.");
  } catch (error) { next(error); }
};

// POST /api/auth/upload-cover-image
const uploadCoverImage = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, "Image file is required.");

    const imageUrl = await uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype);

    const current = await prisma.user.findUnique({ where: { id: req.user.id }, select: { coverImageUrl: true } });
    if (current?.coverImageUrl) deleteS3File(current.coverImageUrl).catch(() => {});

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { coverImageUrl: imageUrl },
      select: { id: true, coverImageUrl: true },
    });

    return successResponse(res, { user }, "Cover image uploaded.");
  } catch (error) { next(error); }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  getPublicProfile,
  uploadProfileImage,
  uploadCoverImage,
};