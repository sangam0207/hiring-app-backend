const prisma = require("../config/prisma");
const {
  generateInterviewQuestions,
  evaluateInterviewAnswers,
} = require("../services/aiInterviewService");
const { successResponse, errorResponse } = require("../utils/response");
const { sendAIInterviewEmail } = require("../services/emailService");
const notificationService = require("../services/notificationService");

// POST /api/ai-interview/:applicationId/generate-questions — HR previews AI-generated questions
const generateQuestions = async (req, res, next) => {
  try {
    const { applicationId } = req.params;

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        parsedResume: true,
        aiInterview: true,
      },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);
    if (application.job.hrId !== req.user.id)
      return errorResponse(res, "Access denied.", 403);

    if (application.aiInterview) {
      return errorResponse(
        res,
        "AI interview already exists for this application.",
        409
      );
    }

    const questions = await generateInterviewQuestions(
      application.job,
      application.parsedResume
    );

    if (!questions || questions.length === 0) {
      return errorResponse(res, "Failed to generate interview questions.", 500);
    }

    return successResponse(res, { questions }, "Questions generated successfully.");
  } catch (error) {
    next(error);
  }
};

// POST /api/ai-interview/:applicationId/trigger — HR triggers AI interview for a candidate
const triggerAIInterview = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const { questions: customQuestions } = req.body;

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: { include: { hr: { select: { company: true } } } },
        candidate: { select: { id: true, name: true, email: true } },
        parsedResume: true,
        aiInterview: true,
      },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);
    if (application.job.hrId !== req.user.id)
      return errorResponse(res, "Access denied.", 403);

    // Check if AI interview already exists
    if (application.aiInterview) {
      return errorResponse(
        res,
        "AI interview already exists for this application.",
        409
      );
    }

    // Use custom questions from HR or generate new ones
    let questions = customQuestions;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      questions = await generateInterviewQuestions(
        application.job,
        application.parsedResume
      );
    }

    if (!questions || questions.length === 0) {
      return errorResponse(res, "Failed to generate interview questions.", 500);
    }

    // Set deadline to 2 days from now
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 2);

    // Create AI interview record
    const aiInterview = await prisma.aIInterview.create({
      data: {
        applicationId,
        questions,
        status: "PENDING",
        deadline,
      },
    });

    // Update application status
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "AI_INTERVIEW_PENDING" },
    });

    // Notify candidate
    await notificationService.createNotification({
      userId: application.candidateId,
      applicationId: application.id,
      type: "AI_INTERVIEW_READY",
      message: `Your AI interview for ${application.job.title} is ready. Please complete it by ${deadline.toLocaleDateString()}.`,
    });

    // Send email notification to candidate (fire and forget)
    sendAIInterviewEmail({
      to: application.candidate.email,
      candidateName: application.candidate.name,
      jobTitle: application.job.title,
      company: application.job.hr?.company,
      deadline,
    }).catch((err) =>
      console.error("[AI Interview] Email error:", err.message)
    );

    return successResponse(
      res,
      { aiInterview },
      "AI interview triggered. Candidate has been notified via email.",
      201
    );
  } catch (error) {
    next(error);
  }
};

// POST /api/ai-interview/:applicationId/start — Candidate starts the interview
const startAIInterview = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const { cameraEnabled } = req.body;

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        aiInterview: true,
        job: { select: { id: true, title: true } },
      },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);
    if (application.candidateId !== req.user.id)
      return errorResponse(res, "Access denied.", 403);

    if (!application.aiInterview) {
      return errorResponse(
        res,
        "No AI interview has been scheduled for this application.",
        404
      );
    }

    if (application.aiInterview.status === "COMPLETED" || application.aiInterview.status === "EVALUATED") {
      return errorResponse(
        res,
        "This interview has already been completed.",
        400
      );
    }

    // Check deadline
    if (new Date() > new Date(application.aiInterview.deadline)) {
      return res.status(403).json({
        success: false,
        message: "Time's up! The deadline for this AI interview has passed. You can no longer take this interview.",
        error: {
          code: "INTERVIEW_EXPIRED",
          deadline: application.aiInterview.deadline,
          expiredAt: new Date().toISOString(),
        },
      });
    }

    // Camera is mandatory — reject if not enabled
    if (!cameraEnabled) {
      return res.status(400).json({
        success: false,
        message: "Camera access is required to start the interview. Please enable your camera and try again.",
        error: {
          code: "CAMERA_REQUIRED",
        },
      });
    }

    // Mark as in progress (only if not already in progress)
    const updateData = {};
    if (application.aiInterview.status === "PENDING") {
      updateData.status = "IN_PROGRESS";
      updateData.startedAt = new Date();
    }

    const aiInterview = await prisma.aIInterview.update({
      where: { id: application.aiInterview.id },
      data: Object.keys(updateData).length > 0 ? updateData : { status: "IN_PROGRESS" },
    });

    return successResponse(res, {
      aiInterview: {
        id: aiInterview.id,
        status: aiInterview.status,
        questions: aiInterview.questions,
        deadline: aiInterview.deadline,
        startedAt: aiInterview.startedAt,
      },
      job: application.job,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/ai-interview/:applicationId/submit — Candidate submits answers
const submitAIInterview = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const { answers } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return errorResponse(res, "Answers array is required.", 400);
    }

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        aiInterview: true,
        job: true,
      },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);
    if (application.candidateId !== req.user.id)
      return errorResponse(res, "Access denied.", 403);

    if (!application.aiInterview) {
      return errorResponse(res, "No AI interview found.", 404);
    }

    if (application.aiInterview.status === "EVALUATED") {
      return errorResponse(res, "This interview has already been evaluated.", 400);
    }

    // Check deadline
    if (new Date() > new Date(application.aiInterview.deadline)) {
      return res.status(403).json({
        success: false,
        message: "Time's up! The deadline for this AI interview has passed. Your answers cannot be submitted.",
        error: {
          code: "INTERVIEW_EXPIRED",
          deadline: application.aiInterview.deadline,
          expiredAt: new Date().toISOString(),
        },
      });
    }

    const questions = application.aiInterview.questions;

    // Save answers and mark completed
    await prisma.aIInterview.update({
      where: { id: application.aiInterview.id },
      data: {
        answers,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    // Evaluate in background
    evaluateInBackground(
      application.aiInterview.id,
      applicationId,
      questions,
      answers,
      application.job
    ).catch((err) =>
      console.error(
        `[AI Interview] Evaluation failed for ${applicationId}:`,
        err
      )
    );

    return successResponse(
      res,
      null,
      "Answers submitted! AI is evaluating your responses..."
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Background evaluation of interview answers
 */
const evaluateInBackground = async (
  aiInterviewId,
  applicationId,
  questions,
  answers,
  job
) => {
  try {
    console.log(`[AI Interview] Starting evaluation for: ${applicationId}`);

    const result = await evaluateInterviewAnswers(questions, answers, job);

    await prisma.aIInterview.update({
      where: { id: aiInterviewId },
      data: {
        evaluation: result.evaluation,
        overallScore: result.overallScore,
        aiSummary: result.aiSummary,
        strengths: result.strengths,
        improvements: result.improvements,
        status: "EVALUATED",
      },
    });

    // Update application status
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "AI_INTERVIEW_COMPLETED" },
    });

    // Notify candidate
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { job: { select: { title: true } } }
    });
    await notificationService.createNotification({
      userId: application.candidateId,
      applicationId: application.id,
      type: "AI_INTERVIEW_COMPLETED",
      message: `Your AI interview evaluation for ${application.job.title} is complete. You can now view your results.`,
    });

    console.log(
      `[AI Interview] Evaluation done for ${applicationId}. Score: ${result.overallScore}`
    );
  } catch (error) {
    console.error(
      `[AI Interview] Evaluation error for ${applicationId}:`,
      error.message
    );
  }
};

// GET /api/ai-interview/:applicationId — Get interview details
const getAIInterview = async (req, res, next) => {
  try {
    const { applicationId } = req.params;

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        aiInterview: true,
        job: {
          select: {
            id: true,
            title: true,
            hrId: true,
            requiredSkills: true,
          },
        },
        candidate: { select: { id: true, name: true, email: true } },
      },
    });

    if (!application) return errorResponse(res, "Application not found.", 404);

    // HR can view; candidate can view their own
    const isHR =
      req.user.role === "HR" && application.job.hrId === req.user.id;
    const isOwner =
      req.user.role === "CANDIDATE" &&
      application.candidateId === req.user.id;

    if (!isHR && !isOwner) {
      return errorResponse(res, "Access denied.", 403);
    }

    if (!application.aiInterview) {
      return errorResponse(res, "No AI interview found for this application.", 404);
    }

    // Compute expiry info for frontend
    const now = new Date();
    const deadline = new Date(application.aiInterview.deadline);
    const isExpired = now > deadline;
    const timeRemainingMs = isExpired ? 0 : deadline.getTime() - now.getTime();

    return successResponse(res, {
      aiInterview: {
        ...application.aiInterview,
        isExpired,
        timeRemainingMs,
      },
      job: application.job,
      candidate: application.candidate,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateQuestions,
  triggerAIInterview,
  startAIInterview,
  submitAIInterview,
  getAIInterview,
};
