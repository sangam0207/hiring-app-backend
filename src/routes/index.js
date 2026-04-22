const express = require("express");
const router = express.Router();

const { authenticate, requireHR, requireCandidate } = require("../middleware/auth");
const upload = require("../config/multer");
const { imageUpload } = require("../config/multer");

// Controllers
const authCtrl = require("../controllers/authController");
const jobCtrl = require("../controllers/jobController");
const applicationCtrl = require("../controllers/applicationController");
const dashboardCtrl = require("../controllers/dashboardController");
const resumeCtrl = require("../controllers/resumeController");
const aiInterviewCtrl = require("../controllers/aiInterviewController");
const chatbotCtrl = require("../controllers/chatbotController");
const jdChatbotCtrl = require("../controllers/jdChatbotController");
const notificationRouter = require("./notificationRoutes");

// ─── Auth Routes ───────────────────────────────────────────────────────────────
const authRouter = express.Router();
authRouter.post("/register", authCtrl.register);
authRouter.post("/login", authCtrl.login);
authRouter.get("/me", authenticate, authCtrl.getMe);
authRouter.put("/me", authenticate, authCtrl.updateProfile);
authRouter.post("/upload-profile-image", authenticate, imageUpload.single("image"), authCtrl.uploadProfileImage);
authRouter.post("/upload-cover-image", authenticate, imageUpload.single("image"), authCtrl.uploadCoverImage);
authRouter.post("/autofill-resume", authenticate, requireCandidate, upload.single("resume"), authCtrl.autofillResume);

// ─── Job Routes ────────────────────────────────────────────────────────────────
const jobRouter = express.Router();

// HR operations (protected)
jobRouter.post("/", authenticate, requireHR, jobCtrl.createJob);
jobRouter.put("/:id", authenticate, requireHR, jobCtrl.updateJob);
jobRouter.delete("/:id", authenticate, requireHR, jobCtrl.deleteJob);
jobRouter.patch("/:id/status", authenticate, requireHR, jobCtrl.updateJobStatus);

// Shared - HR sees their jobs; candidates see active jobs
jobRouter.get("/", authenticate, jobCtrl.getJobs);
jobRouter.get("/filters", authenticate, jobCtrl.getJobFilters);
jobRouter.get("/recommended", authenticate, requireCandidate, jobCtrl.getRecommendedJobs);
jobRouter.get("/:id", authenticate, jobCtrl.getJobById);
jobRouter.get("/:jobId/screening-questions", authenticate, jobCtrl.getScreeningQuestions);

// ─── Application Routes ────────────────────────────────────────────────────────
const applicationRouter = express.Router();

// Candidate: apply to a job (file upload optional if using saved resumeId)
applicationRouter.post(
  "/:jobId/apply",
  authenticate,
  requireCandidate,
  upload.single("resume"),
  applicationCtrl.applyToJob
);

// Candidate: view own applications
applicationRouter.get(
  "/my",
  authenticate,
  requireCandidate,
  applicationCtrl.getMyApplications
);

// HR: view all applications for a job
applicationRouter.get(
  "/job/:jobId",
  authenticate,
  requireHR,
  applicationCtrl.getApplicationsByJob
);

// HR: update application status
applicationRouter.patch(
  "/:applicationId/status",
  authenticate,
  requireHR,
  applicationCtrl.updateApplicationStatus
);

// HR: schedule interview for an application
applicationRouter.post(
  "/:applicationId/schedule-interview",
  authenticate,
  requireHR,
  applicationCtrl.scheduleInterview
);

// HR: trigger manual resume re-parse
applicationRouter.post(
  "/:applicationId/parse",
  authenticate,
  requireHR,
  applicationCtrl.triggerResumeParse
);

// Shared: view single application (HR or candidate owner)
applicationRouter.get(
  "/:applicationId",
  authenticate,
  applicationCtrl.getApplicationById
);

// ─── Dashboard Routes ──────────────────────────────────────────────────────────
const dashboardRouter = express.Router();
dashboardRouter.get("/hr", authenticate, requireHR, dashboardCtrl.getHRDashboard);
dashboardRouter.get("/hr/jobs/:jobId/report", authenticate, requireHR, dashboardCtrl.getJobReport);
dashboardRouter.get("/candidate", authenticate, requireCandidate, dashboardCtrl.getCandidateDashboard);

// ─── Resume Routes ─────────────────────────────────────────────────────────────
const resumeRouter = express.Router();
resumeRouter.post("/upload", authenticate, requireCandidate, upload.single("resume"), resumeCtrl.uploadUserResume);
resumeRouter.get("/", authenticate, requireCandidate, resumeCtrl.getUserResumes);
resumeRouter.delete("/:id", authenticate, requireCandidate, resumeCtrl.deleteUserResume);
resumeRouter.patch("/:id/default", authenticate, requireCandidate, resumeCtrl.setDefaultResume);

// ─── User Profile Routes (public profile for HR) ───────────────────────────────
const userRouter = express.Router();
userRouter.get("/:id/profile", authenticate, authCtrl.getPublicProfile);

// ─── AI Interview Routes ───────────────────────────────────────────────────────
const aiInterviewRouter = express.Router();

// HR: generate preview questions for AI interview
aiInterviewRouter.post(
  "/:applicationId/generate-questions",
  authenticate,
  requireHR,
  aiInterviewCtrl.generateQuestions
);

// HR: trigger AI interview for a candidate (with optional custom questions)
aiInterviewRouter.post(
  "/:applicationId/trigger",
  authenticate,
  requireHR,
  aiInterviewCtrl.triggerAIInterview
);

// Candidate: start the AI interview (get questions)
aiInterviewRouter.post(
  "/:applicationId/start",
  authenticate,
  requireCandidate,
  aiInterviewCtrl.startAIInterview
);

// Candidate: submit answers
aiInterviewRouter.post(
  "/:applicationId/submit",
  authenticate,
  requireCandidate,
  aiInterviewCtrl.submitAIInterview
);

// Shared: view AI interview details (HR or candidate)
aiInterviewRouter.get(
  "/:applicationId",
  authenticate,
  aiInterviewCtrl.getAIInterview
);

aiInterviewRouter.post("/:applicationId/screenshot",  authenticate,requireCandidate, aiInterviewCtrl.saveScreenshot);
// ─── Chatbot Routes ────────────────────────────────────────────────────────────
// Public — no auth required (the chatbot is a standalone resume builder tool)
const chatbotRouter = express.Router();
chatbotRouter.post("/start", chatbotCtrl.startSession);
chatbotRouter.post("/message", chatbotCtrl.handleMessage);
chatbotRouter.post("/parse-resume", upload.single("file"), chatbotCtrl.parseResume);
chatbotRouter.post("/improve-resume-section", chatbotCtrl.improveResumeSection);
chatbotRouter.delete("/session/:sessionId", chatbotCtrl.resetSession);

// ─── JD Chatbot Routes ─────────────────────────────────────────────────────────
const jdChatbotRouter = express.Router();
jdChatbotRouter.post("/start", jdChatbotCtrl.startSession);
jdChatbotRouter.post("/message", jdChatbotCtrl.handleMessage);
jdChatbotRouter.delete("/session/:sessionId", jdChatbotCtrl.resetSession);

// ─── Mount all routers ─────────────────────────────────────────────────────────
router.use("/auth", authRouter);
router.use("/jobs", jobRouter);
router.use("/applications", applicationRouter);
router.use("/dashboard", dashboardRouter);
router.use("/resumes", resumeRouter);
router.use("/users", userRouter);
router.use("/ai-interview", aiInterviewRouter);
router.use("/chatbot/jd", jdChatbotRouter);
router.use("/chatbot", chatbotRouter);
router.use("/notifications", notificationRouter);

module.exports = router;