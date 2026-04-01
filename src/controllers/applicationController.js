const prisma = require("../config/prisma");
const { uploadResume, fetchFileAsBuffer } = require("../services/s3Service");
const { extractTextFromResume } = require("../utils/resumeExtractor");
const { parseResumeWithAI } = require("../services/resumeParserService");
const { successResponse, errorResponse, paginatedResponse } = require("../utils/response");

// POST /api/applications/:jobId/apply - Candidate applies with resume
const applyToJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { coverLetter } = req.body;
    const candidateId = req.user.id;

    if (!req.file) {
      return errorResponse(res, "Resume file is required.");
    }

    // Check job exists and is active
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return errorResponse(res, "Job not found.", 404);
    if (job.status !== "ACTIVE") {
      return errorResponse(res, "This job is not accepting applications.", 400);
    }

    // Check if already applied
    const existing = await prisma.application.findUnique({
      where: { jobId_candidateId: { jobId, candidateId } },
    });
    if (existing) {
      return errorResponse(res, "You have already applied to this job.", 409);
    }

    // Upload resume buffer → S3 → get back public URL
    const resumeUrl = await uploadResume(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Create application with S3 URL
    const application = await prisma.application.create({
      data: {
        jobId,
        candidateId,
        coverLetter: coverLetter || null,
        resumeUrl,                          // S3 URL stored here
        resumeFileName: req.file.originalname,
        status: "APPLIED",
      },
      include: {
        job: { select: { id: true, title: true, hrId: true } },
        candidate: { select: { id: true, name: true, email: true } },
      },
    });

    // Trigger async resume parsing — pass buffer directly (already in memory)
    parseResumeInBackground(
      application.id,
      req.file.buffer,
      req.file.mimetype,
      job
    ).catch((err) =>
      console.error(`Resume parsing failed for application ${application.id}:`, err)
    );

    return successResponse(
      res,
      { application },
      "Application submitted successfully. Resume is being analyzed.",
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Background: extract text from buffer → OpenAI → save results to DB
 * @param {string} applicationId
 * @param {Buffer} fileBuffer  - In-memory buffer (from multer or S3 fetch)
 * @param {string} mimetype
 * @param {object} job         - Full job object for context
 */
const parseResumeInBackground = async (applicationId, fileBuffer, mimetype, job) => {
  try {
    console.log(`[Resume Parser] Starting for application: ${applicationId}`);

    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "SCREENING" },
    });

    // Extract text from buffer
    const resumeText = await extractTextFromResume(fileBuffer, mimetype);
    if (!resumeText || resumeText.trim().length < 50) {
      throw new Error("Could not extract meaningful text from resume.");
    }

    // Parse with OpenAI
    const parsedData = await parseResumeWithAI(resumeText, job);

    // Save parsed results
    await prisma.parsedResume.create({
      data: {
        applicationId,
        ...parsedData,
        education: parsedData.education,
        workExperience: parsedData.workExperience,
        projects: parsedData.projects,
      },
    });

    const newStatus = parsedData.isRecommended ? "SHORTLISTED" : "APPLIED";
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: newStatus },
    });

    console.log(
      `[Resume Parser] Done for ${applicationId}. Score: ${parsedData.overallScore}, Recommended: ${parsedData.isRecommended}`
    );
  } catch (error) {
    console.error(`[Resume Parser] Error for ${applicationId}:`, error.message);
    await prisma.application
      .update({ where: { id: applicationId }, data: { status: "APPLIED" } })
      .catch(() => {});
  }
};

// POST /api/applications/:applicationId/parse - HR triggers manual re-parse
const triggerResumeParse = async (req, res, next) => {
  try {
    const { applicationId } = req.params;

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { job: true },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);
    if (application.job.hrId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    // Delete old parsed data
    await prisma.parsedResume.deleteMany({ where: { applicationId } });

    // Fetch file buffer from S3 in background then re-parse
    const reparseAsync = async () => {
      const fileBuffer = await fetchFileAsBuffer(application.resumeUrl);
      // Detect mimetype from filename extension
      const ext = application.resumeFileName.split(".").pop().toLowerCase();
      const mimetypeMap = {
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
      const mimetype = mimetypeMap[ext] || "application/pdf";
      await parseResumeInBackground(applicationId, fileBuffer, mimetype, application.job);
    };

    reparseAsync().catch(console.error);

    return successResponse(res, null, "Resume re-parsing triggered. Check back shortly.");
  } catch (error) {
    next(error);
  }
};

// GET /api/applications/job/:jobId - HR gets all applicants for a job
const getApplicationsByJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const {
      page = 1,
      limit = 10,
      status,
      sortBy = "overallScore",
      sortOrder = "desc",
    } = req.query;

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return errorResponse(res, "Job not found.", 404);
    if (job.hrId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      jobId,
      ...(status && { status }),
    };

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        skip,
        take,
        orderBy:
          sortBy === "overallScore"
            ? { parsedResume: { overallScore: sortOrder } }
            : { createdAt: sortOrder },
        include: {
          candidate: {
            select: { id: true, name: true, email: true, phone: true },
          },
          parsedResume: {
            select: {
              overallScore: true,
              skillMatchScore: true,
              matchScore: true,
              extractedSkills: true,
              totalExperience: true,
              currentRole: true,
              isRecommended: true,
              aiSummary: true,
              strengths: true,
              gaps: true,
              parsedAt: true,
            },
          },
        },
      }),
      prisma.application.count({ where }),
    ]);

    return paginatedResponse(res, { applications }, {
      total,
      page: parseInt(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/applications/:applicationId - Get single application with full parsed resume
const getApplicationById = async (req, res, next) => {
  try {
    const { applicationId } = req.params;

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            requiredSkills: true,
            experienceLevel: true,
            hrId: true,
          },
        },
        candidate: {
          select: { id: true, name: true, email: true, phone: true },
        },
        parsedResume: true,
      },
    });

    if (!application) {
      return errorResponse(res, "Application not found.", 404);
    }

    // HR can view; candidate can view their own
    const isHR = req.user.role === "HR" && application.job.hrId === req.user.id;
    const isOwner = req.user.role === "CANDIDATE" && application.candidateId === req.user.id;

    if (!isHR && !isOwner) {
      return errorResponse(res, "Access denied.", 403);
    }

    return successResponse(res, { application });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/applications/:applicationId/status - HR updates application status
const updateApplicationStatus = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const { status } = req.body;

    const validStatuses = [
      "APPLIED",
      "SCREENING",
      "SHORTLISTED",
      "INTERVIEW_SCHEDULED",
      "INTERVIEWED",
      "SELECTED",
      "REJECTED",
    ];

    if (!validStatuses.includes(status)) {
      return errorResponse(res, `Status must be one of: ${validStatuses.join(", ")}`);
    }

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { job: { select: { hrId: true } } },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);
    if (application.job.hrId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: { status },
      include: {
        candidate: { select: { id: true, name: true, email: true } },
        parsedResume: {
          select: { overallScore: true, isRecommended: true },
        },
      },
    });

    return successResponse(
      res,
      { application: updated },
      `Application status updated to ${status}.`
    );
  } catch (error) {
    next(error);
  }
};

// GET /api/applications/my - Candidate sees their own applications
const getMyApplications = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where: { candidateId: req.user.id },
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              jobType: true,
              location: true,
              status: true,
              hr: { select: { company: true } },
            },
          },
          parsedResume: {
            select: {
              overallScore: true,
              isRecommended: true,
              aiSummary: true,
            },
          },
        },
      }),
      prisma.application.count({ where: { candidateId: req.user.id } }),
    ]);

    return paginatedResponse(res, { applications }, {
      total,
      page: parseInt(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  applyToJob,
  triggerResumeParse,
  getApplicationsByJob,
  getApplicationById,
  updateApplicationStatus,
  getMyApplications,
};
