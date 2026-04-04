const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");
const { successResponse, errorResponse } = require("../utils/response");
const { uploadImage, deleteResume: deleteS3File, getSignedUrl } = require("../services/s3Service");
const { extractTextFromResume } = require("../utils/resumeExtractor");
const { parseProfileFromResume } = require("../services/resumeParserService");

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

// Convert private S3 URLs to signed URLs for images
function signImageUrls(user) {
  if (!user) return user;
  const copy = { ...user };
  if (copy.profileImageUrl) copy.profileImageUrl = getSignedUrl(copy.profileImageUrl, 86400) || copy.profileImageUrl;
  if (copy.coverImageUrl) copy.coverImageUrl = getSignedUrl(copy.coverImageUrl, 86400) || copy.coverImageUrl;
  return copy;
}

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
        headline: true,
        summary: true,
        location: true,
        currentCompany: true,
        currentRole: true,
        totalExperience: true,
        skills: true,
        education: true,
        workExperience: true,
        certifications: true,
        languages: true,
        linkedinUrl: true,
        portfolioUrl: true,
        profileImageUrl: true,
        coverImageUrl: true,
        createdAt: true,
      },
    });

    return successResponse(res, { user: signImageUrls(user) });
  } catch (error) {
    next(error);
  }
};

// PUT /api/auth/me
const updateProfile = async (req, res, next) => {
  try {
    const {
      name, phone, company,
      headline, summary, location,
      currentCompany, currentRole, totalExperience,
      skills, education, workExperience,
      certifications, languages,
      linkedinUrl, portfolioUrl,
    } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (company !== undefined && req.user.role === "HR") data.company = company;
    if (headline !== undefined) data.headline = headline;
    if (summary !== undefined) data.summary = summary;
    if (location !== undefined) data.location = location;
    if (currentCompany !== undefined) data.currentCompany = currentCompany;
    if (currentRole !== undefined) data.currentRole = currentRole;
    if (totalExperience !== undefined) data.totalExperience = totalExperience ? parseFloat(totalExperience) : null;
    if (skills !== undefined) data.skills = skills;
    if (education !== undefined) data.education = education;
    if (workExperience !== undefined) data.workExperience = workExperience;
    if (certifications !== undefined) data.certifications = certifications;
    if (languages !== undefined) data.languages = languages;
    if (linkedinUrl !== undefined) data.linkedinUrl = linkedinUrl;
    if (portfolioUrl !== undefined) data.portfolioUrl = portfolioUrl;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        company: true,
        phone: true,
        headline: true,
        summary: true,
        location: true,
        currentCompany: true,
        currentRole: true,
        totalExperience: true,
        skills: true,
        education: true,
        workExperience: true,
        certifications: true,
        languages: true,
        linkedinUrl: true,
        portfolioUrl: true,
        profileImageUrl: true,
        coverImageUrl: true,
      },
    });

    return successResponse(res, { user: signImageUrls(user) }, "Profile updated.");
  } catch (error) {
    next(error);
  }
};

// GET /api/users/:id/profile — Public profile for HR to view candidate
const getPublicProfile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        headline: true,
        summary: true,
        location: true,
        currentCompany: true,
        currentRole: true,
        totalExperience: true,
        skills: true,
        education: true,
        workExperience: true,
        certifications: true,
        languages: true,
        linkedinUrl: true,
        portfolioUrl: true,
        profileImageUrl: true,
        coverImageUrl: true,
        createdAt: true,
      },
    });

    if (!user) return errorResponse(res, "User not found.", 404);
    if (user.role !== "CANDIDATE") return errorResponse(res, "Profile not available.", 404);

    return successResponse(res, { profile: signImageUrls(user) });
  } catch (error) {
    next(error);
  }
};

// POST /api/auth/upload-profile-image
const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, "Image file is required.");

    const imageUrl = await uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype);

    // Delete old image from S3 if exists
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

// POST /api/auth/autofill-resume — AI parses resume and returns profile fields
const autofillResume = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, "Resume file is required.");

    const resumeText = await extractTextFromResume(req.file.buffer, req.file.mimetype);
    if (!resumeText || resumeText.trim().length < 50) {
      return errorResponse(res, "Could not extract enough text from the resume.");
    }

    const parsed = await parseProfileFromResume(resumeText);

    return successResponse(res, { profile: parsed }, "Resume parsed successfully.");
  } catch (error) { next(error); }
};

module.exports = { register, login, getMe, updateProfile, getPublicProfile, uploadProfileImage, uploadCoverImage, autofillResume };
