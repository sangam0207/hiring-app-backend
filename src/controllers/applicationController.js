const prisma = require("../config/prisma");
const { uploadResume, fetchFileAsBuffer, deleteResume, getSignedUrl } = require("../services/s3Service");
const { extractTextFromResume } = require("../utils/resumeExtractor");
const { parseResumeWithAI } = require("../services/resumeParserService");
const { successResponse, errorResponse, paginatedResponse } = require("../utils/response");
const { sendInterviewEmail } = require("../services/emailService");
const notificationService = require("../services/notificationService");
const { hasActivePlan } = require("../services/creditService");

// POST /api/applications/:jobId/apply - Candidate applies with resume
const applyToJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { coverLetter, resumeId, screeningAnswers } = req.body;
    const candidateId = req.user.id;

    // Must provide either a file upload or a saved resumeId
    if (!req.file && !resumeId) {
      return errorResponse(res, "Resume file or saved resume selection is required.");
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

    let resumeUrl, resumeFileName, fileBuffer, fileMimetype, savedResumeId = null;

    if (resumeId) {
      // Using a saved resume
      const savedResume = await prisma.resume.findUnique({ where: { id: resumeId } });
      if (!savedResume || savedResume.userId !== candidateId) {
        return errorResponse(res, "Selected resume not found.", 404);
      }
      resumeUrl = savedResume.fileUrl;
      resumeFileName = savedResume.fileName;
      savedResumeId = savedResume.id;

      // Fetch file buffer from S3 for parsing
      fileBuffer = await fetchFileAsBuffer(resumeUrl);
      const ext = resumeFileName.split(".").pop().toLowerCase();
      const mimetypeMap = {
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
      fileMimetype = mimetypeMap[ext] || "application/pdf";
    } else {
      // New file upload (original behavior)
      resumeUrl = await uploadResume(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      resumeFileName = req.file.originalname;
      fileBuffer = req.file.buffer;
      fileMimetype = req.file.mimetype;
    }

    // Create application
    // Parse screeningAnswers if sent as string (FormData)
    let parsedScreeningAnswers = null;
    if (screeningAnswers) {
      try {
        parsedScreeningAnswers = typeof screeningAnswers === "string"
          ? JSON.parse(screeningAnswers)
          : screeningAnswers;
      } catch { parsedScreeningAnswers = null; }
    }

    const application = await prisma.application.create({
      data: {
        jobId,
        candidateId,
        coverLetter: coverLetter || null,
        resumeUrl,
        resumeFileName,
        resumeId: savedResumeId,
        screeningAnswers: parsedScreeningAnswers,
        status: "APPLIED",
      },
      include: {
        job: { select: { id: true, title: true, hrId: true } },
        candidate: { select: { id: true, name: true, email: true } },
      },
    });

    // Only run AI resume parsing if the HR has an active paid plan (Standard or Premium)
    const hrHasPlan = await hasActivePlan(job.hrId);
    if (hrHasPlan) {
      parseResumeInBackground(
        application.id,
        fileBuffer,
        fileMimetype,
        job,
        null // screening answers only evaluated on premium re-analysis
      ).catch((err) =>
        console.error(`Resume parsing failed for application ${application.id}:`, err)
      );
    }

    return successResponse(
      res,
      { application },
      hrHasPlan
        ? "Application submitted successfully. Resume is being analyzed."
        : "Application submitted successfully.",
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
const parseResumeInBackground = async (applicationId, fileBuffer, mimetype, job, screeningAnswers = null) => {
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

    // Parse with OpenAI (include screening answers for evaluation)
    const parsedData = await parseResumeWithAI(resumeText, job, screeningAnswers);

    // Save parsed results (screeningEvaluation stored alongside screening answers on application)
    const { screeningEvaluation, ...resumeData } = parsedData;

    await prisma.parsedResume.create({
      data: {
        applicationId,
        ...resumeData,
        education: resumeData.education,
        workExperience: resumeData.workExperience,
        projects: resumeData.projects,
      },
    });

    // Save screening evaluation on the application record
    if (screeningEvaluation) {
      await prisma.application.update({
        where: { id: applicationId },
        data: {
          screeningAnswers: screeningAnswers?.map((qa, i) => ({
            ...qa,
            rating: screeningEvaluation[i]?.rating || null,
            remark: screeningEvaluation[i]?.remark || null,
          })) || undefined,
        },
      });
    }

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
      await parseResumeInBackground(applicationId, fileBuffer, mimetype, application.job, application.screeningAnswers);
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
              screeningScore: true,
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
          interview: {
            select: {
              interviewDate: true,
              interviewTime: true,
              duration: true,
              meetingLink: true,
            },
          },
          aiInterview: {
            select: {
              status: true,
              overallScore: true,
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
            hr: { select: { company: true } },
          },
        },
        candidate: {
          select: { id: true, name: true, email: true, phone: true },
        },
        parsedResume: true,
        interview: true,
        aiInterview: true,
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

    // Attach a signed URL so the frontend can view/download the resume
    const resumeSignedUrl = application.resumeUrl
      ? getSignedUrl(application.resumeUrl, 3600)
      : null;

    return successResponse(res, {
      application: { ...application, resumeSignedUrl },
    });
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
      "AI_INTERVIEW_PENDING",
      "AI_INTERVIEW_COMPLETED",
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
        job: { select: { title: true } },
        parsedResume: {
          select: { overallScore: true, isRecommended: true },
        },
      },
    });

    // Notify candidate
    await notificationService.createNotification({
      userId: updated.candidateId,
      applicationId: updated.id,
      type: "STATUS_CHANGE",
      message: `Your application for ${updated.job.title} is now ${status.replace("_", " ")}.`,
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
          interview: {
            select: {
              interviewDate: true,
              interviewTime: true,
              duration: true,
              meetingLink: true,
              notes: true,
            },
          },
          aiInterview: {
            select: {
              deadline: true,
              status: true,
              overallScore: true,
              startedAt: true,
            }
          }
        },
      }),
      prisma.application.count({ where: { candidateId: req.user.id } }),
    ]);

    // Add computed expiry info for AI interviews
    const now = new Date();
    const enrichedApplications = applications.map((app) => {
      if (app.aiInterview && app.aiInterview.deadline) {
        const deadline = new Date(app.aiInterview.deadline);
        const isExpired = now > deadline;
        const timeRemainingMs = isExpired ? 0 : deadline.getTime() - now.getTime();
        return {
          ...app,
          aiInterview: {
            ...app.aiInterview,
            isExpired,
            timeRemainingMs,
          },
        };
      }
      return app;
    });

    return paginatedResponse(res, { applications: enrichedApplications }, {
      total,
      page: parseInt(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/applications/:applicationId/schedule-interview - HR schedules interview
const scheduleInterview = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const { interviewDate, interviewTime, duration, meetingLink, notes } = req.body;

    // Validate required fields
    if (!interviewDate || !interviewTime || !meetingLink) {
      return errorResponse(res, "Interview date, time, and meeting link are required.");
    }

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: { select: { hrId: true, title: true, hr: { select: { company: true } } } },
        candidate: { select: { id: true, name: true, email: true } },
      },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);
    if (application.job.hrId !== req.user.id) return errorResponse(res, "Access denied.", 403);

    // Upsert interview (update if already exists, create if not)
    await prisma.interview.upsert({
      where: { applicationId },
      update: {
        interviewDate,
        interviewTime,
        duration: duration || 30,
        meetingLink,
        notes: notes || null,
      },
      create: {
        applicationId,
        interviewDate,
        interviewTime,
        duration: duration || 30,
        meetingLink,
        notes: notes || null,
      },
    });

    // Update application status to INTERVIEW_SCHEDULED
    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: { status: "INTERVIEW_SCHEDULED" },
      include: {
        candidate: { select: { id: true, name: true, email: true } },
        job: { select: { title: true } },
        parsedResume: { select: { overallScore: true, isRecommended: true } },
        interview: true,
      },
    });

    // Notify candidate
    await notificationService.createNotification({
      userId: updated.candidateId,
      applicationId: updated.id,
      type: "INTERVIEW_SCHEDULED",
      message: `An interview for ${updated.job.title} has been scheduled for ${interviewDate} at ${interviewTime}.`,
    });

    // Send email notification (fire and forget)
    sendInterviewEmail({
      to: application.candidate.email,
      candidateName: application.candidate.name,
      jobTitle: application.job.title,
      company: application.job.hr?.company,
      interviewDate,
      interviewTime,
      duration: duration || 30,
      meetingLink,
      notes,
    }).catch((err) => console.error("[Schedule] Email error:", err.message));

    return successResponse(
      res,
      { application: updated },
      "Interview scheduled successfully."
    );
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
  scheduleInterview,
};
