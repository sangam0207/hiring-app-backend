const prisma = require("../config/prisma");
const { uploadResume, deleteResume } = require("../services/s3Service");
const { successResponse, errorResponse } = require("../utils/response");

// POST /api/resumes/upload
const uploadUserResume = async (req, res, next) => {
  try {
    if (!req.file) {
      return errorResponse(res, "Resume file is required.");
    }

    const userId = req.user.id;
    const { profileId } = req.body; // ✅ optional — user may or may not link to a profile

    // Validate profileId belongs to this user (if provided)
    if (profileId) {
      const profile = await prisma.profile.findFirst({
        where: { id: profileId, userId },
      });
      if (!profile) {
        return errorResponse(res, "Profile not found.", 404);
      }
    }

    // Upload to S3
    const fileUrl = await uploadResume(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // First resume ever = auto default
    const existingCount = await prisma.resume.count({ where: { userId } });

    const resume = await prisma.resume.create({
      data: {
        userId,
        fileName: req.file.originalname,
        fileUrl,
        isDefault: existingCount === 0,
        ...(profileId && { profileId }), // ✅ link to profile if provided
      },
    });

    return successResponse(res, { resume }, "Resume uploaded successfully.", 201);
  } catch (error) {
    next(error);
  }
};

// GET /api/resumes
const getUserResumes = async (req, res, next) => {
  try {
    const { profileId } = req.query; // ?profileId=xxx (optional)

    const resumes = await prisma.resume.findMany({
      where: {
        userId: req.user.id,
        ...(profileId && { profileId }), // ✅ filter by profile if provided
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return successResponse(res, { resumes });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/resumes/:id
const deleteUserResume = async (req, res, next) => {
  try {
    const { id } = req.params;

    const resume = await prisma.resume.findUnique({ where: { id } });
    if (!resume) return errorResponse(res, "Resume not found.", 404);
    if (resume.userId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    // Delete from S3
    await deleteResume(resume.fileUrl);

    // Delete from DB
    await prisma.resume.delete({ where: { id } });

    // If deleted resume was default, make the most recent one default
    if (resume.isDefault) {
      const latest = await prisma.resume.findFirst({
        where: { userId: req.user.id },
        orderBy: { createdAt: "desc" },
      });
      if (latest) {
        await prisma.resume.update({
          where: { id: latest.id },
          data: { isDefault: true },
        });
      }
    }

    return successResponse(res, null, "Resume deleted.");
  } catch (error) {
    next(error);
  }
};

// PATCH /api/resumes/:id/default
const setDefaultResume = async (req, res, next) => {
  try {
    const { id } = req.params;

    const resume = await prisma.resume.findUnique({ where: { id } });
    if (!resume) return errorResponse(res, "Resume not found.", 404);
    if (resume.userId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    // Unset all defaults for this user, then set the chosen one
    await prisma.$transaction([
      prisma.resume.updateMany({
        where: { userId: req.user.id },
        data: { isDefault: false },
      }),
      prisma.resume.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);

    return successResponse(res, null, "Default resume updated.");
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadUserResume, getUserResumes, deleteUserResume, setDefaultResume };
