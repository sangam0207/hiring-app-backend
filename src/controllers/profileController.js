const prisma = require("../config/prisma");
const { successResponse, errorResponse } = require("../utils/response");
const { extractTextFromResume } = require("../utils/resumeExtractor");
const { parseProfileFromResume } = require("../services/resumeParserService");
const {uploadResume}= require("../services/s3Service");
// ─── GET /api/profiles ────────────────────────────────────────────────────────
const getProfiles = async (req, res, next) => {
  try {
    const profiles = await prisma.profile.findMany({
      where: { userId: req.user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return successResponse(res, { profiles });
  } catch (error) { next(error); }
};



// ─── GET /api/profiles/:id ────────────────────────────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const profile = await prisma.profile.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!profile) return errorResponse(res, "Profile not found.", 404);
    return successResponse(res, { profile });
  } catch (error) { next(error); }
};

// ─── POST /api/profiles ───────────────────────────────────────────────────────
// First profile is always default regardless of what is passed.
// Subsequent profiles are only default if isDefault: true is explicitly sent.
const createProfile = async (req, res, next) => {
  try {
    const {
      name, headline, summary, location,
      currentCompany, currentRole, totalExperience,
      skills, education, workExperience,
      certifications, languages,
      linkedinUrl, portfolioUrl, profileImageUrl,
      resumeUrl, isDefault,
    } = req.body;

    if (!name) return errorResponse(res, "Profile name is required.");

    const existingCount = await prisma.profile.count({ where: { userId: req.user.id } });
    const isFirst = existingCount === 0;

    // First profile is always default; subsequent only if explicitly requested
    const shouldBeDefault = isFirst || isDefault === true;

    if (shouldBeDefault) {
      await prisma.profile.updateMany({
        where: { userId: req.user.id },
        data: { isDefault: false },
      });
    }

    const profile = await prisma.profile.create({
      data: {
        userId: req.user.id,
        name,
        isDefault: shouldBeDefault,
        headline,
        summary,
        location,
        currentCompany,
        currentRole,
        totalExperience: totalExperience ? parseFloat(totalExperience) : null,
        skills: skills ?? [],
        education: education ?? null,
        workExperience: workExperience ?? null,
        certifications: certifications ?? [],
        languages: languages ?? [],
        linkedinUrl,
        portfolioUrl,
        profileImageUrl,
        resumeUrl,
      },
    });

    return successResponse(res, { profile }, "Profile created.", 201);
  } catch (error) { next(error); }
};

// ─── PUT /api/profiles/:id ────────────────────────────────────────────────────
// Updates professional fields. isDefault: true switches this to the default.
// isDefault: false is ignored — use PATCH /:id/set-default on another profile instead.
const updateProfile = async (req, res, next) => {
  try {
    const existing = await prisma.profile.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return errorResponse(res, "Profile not found.", 404);

    const {
      name, headline, summary, location,
      currentCompany, currentRole, totalExperience,
      skills, education, workExperience,
      certifications, languages,
      linkedinUrl, portfolioUrl, profileImageUrl,
      resumeUrl, isDefault,
    } = req.body;

    // Only act on isDefault: true — can't unset default directly
    const makingDefault = isDefault === true && !existing.isDefault;

    if (makingDefault) {
      await prisma.profile.updateMany({
        where: { userId: req.user.id },
        data: { isDefault: false },
      });
    }

    const profile = await prisma.profile.update({
      where: { id: req.params.id },
      data: {
        name,
        headline,
        summary,
        location,
        currentCompany,
        currentRole,
        totalExperience: totalExperience !== undefined
          ? (totalExperience ? parseFloat(totalExperience) : null)
          : undefined,
        skills,
        education,
        workExperience,
        certifications,
        languages,
        linkedinUrl,
        portfolioUrl,
        profileImageUrl,
        resumeUrl,
        ...(makingDefault && { isDefault: true }),
      },
    });

    return successResponse(res, { profile }, "Profile updated.");
  } catch (error) { next(error); }
};

// ─── DELETE /api/profiles/:id ─────────────────────────────────────────────────
// Cannot delete the only profile. If the deleted profile was default,
// the oldest remaining profile is automatically promoted to default.
const deleteProfile = async (req, res, next) => {
  try {
    const existing = await prisma.profile.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return errorResponse(res, "Profile not found.", 404);

    const count = await prisma.profile.count({ where: { userId: req.user.id } });
    if (count === 1) return errorResponse(res, "Cannot delete your only profile.");

    await prisma.profile.delete({ where: { id: req.params.id } });

    // Auto-promote oldest remaining profile if the deleted one was default
    if (existing.isDefault) {
      const oldest = await prisma.profile.findFirst({
        where: { userId: req.user.id },
        orderBy: { createdAt: "asc" },
      });
      if (oldest) {
        await prisma.profile.update({ where: { id: oldest.id }, data: { isDefault: true } });
      }
    }

    return successResponse(res, null, "Profile deleted.");
  } catch (error) { next(error); }
};

// ─── PATCH /api/profiles/:id/set-default ─────────────────────────────────────
// The only way to change which profile is default.
const setDefaultProfile = async (req, res, next) => {
  try {
    const existing = await prisma.profile.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return errorResponse(res, "Profile not found.", 404);

    if (existing.isDefault) {
      return successResponse(res, { profile: existing }, "Already the default profile.");
    }

    await prisma.profile.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
    const profile = await prisma.profile.update({
      where: { id: req.params.id },
      data: { isDefault: true },
    });

    return successResponse(res, { profile }, "Default profile updated.");
  } catch (error) { next(error); }
};

// ─── POST /api/profiles/autofill-resume ──────────────────────────────────────
// Upload a resume → AI parses it → returns prefill data.
// Candidate reviews and saves manually via POST /api/profiles.
const autofillFromResume = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, "Resume file is required.");

    const resumeText = await extractTextFromResume(req.file.buffer, req.file.mimetype);
    if (!resumeText || resumeText.trim().length < 50) {
      return errorResponse(res, "Could not extract enough text from the resume.");
    }

    const parsed = await parseProfileFromResume(resumeText);

    // ✅ ADD THIS BLOCK ONLY (no format change)

    const userId = req.user.id;

    // 1. Upload to S3
    const fileUrl = await uploadResume(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // 2. Find default profile
    const defaultProfile = await prisma.profile.findFirst({
      where: { userId, isDefault: true },
    });

    // 3. Save resume & link with profile
    await prisma.resume.create({
      data: {
        userId,
        profileId: defaultProfile?.id || null,
        fileName: req.file.originalname,
        fileUrl,
      },
    });

    // ✅ END BLOCK

    return successResponse(res, { profile: parsed }, "Resume parsed. Review and save as a new profile.");
  } catch (error) { next(error); }
};

module.exports = {
  getProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
  autofillFromResume,
};