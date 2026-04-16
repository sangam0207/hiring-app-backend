const express = require("express");
const router = express.Router();

const {
  authenticate,
  requireHR,
  requireCandidate,
} = require("../middleware/auth");
const upload = require("../config/multer");

// Controllers
const authCtrl = require("../controllers/authController");
const jobCtrl = require("../controllers/jobController");
const applicationCtrl = require("../controllers/applicationController");
const dashboardCtrl = require("../controllers/dashboardController");
const chatbotCtrl = require("../controllers/chatbotController");
const jdChatbotCtrl = require("../controllers/jdChatbotController");

// ─── Auth Routes ───────────────────────────────────────────────────────────────
const authRouter = express.Router();
authRouter.post("/register", authCtrl.register);
authRouter.post("/login", authCtrl.login);
authRouter.get("/me", authenticate, authCtrl.getMe);
authRouter.put("/me", authenticate, authCtrl.updateProfile);

// ─── Job Routes ────────────────────────────────────────────────────────────────
const jobRouter = express.Router();

// HR operations (protected)
jobRouter.post("/", authenticate, requireHR, jobCtrl.createJob);
jobRouter.put("/:id", authenticate, requireHR, jobCtrl.updateJob);
jobRouter.delete("/:id", authenticate, requireHR, jobCtrl.deleteJob);
jobRouter.patch(
  "/:id/status",
  authenticate,
  requireHR,
  jobCtrl.updateJobStatus,
);

// Shared - HR sees their jobs; candidates see active jobs
jobRouter.get("/", authenticate, jobCtrl.getJobs);
jobRouter.get("/:id", authenticate, jobCtrl.getJobById);

// ─── Application Routes ────────────────────────────────────────────────────────
const applicationRouter = express.Router();

// Candidate: apply to a job
applicationRouter.post(
  "/:jobId/apply",
  authenticate,
  requireCandidate,
  upload.single("resume"),
  applicationCtrl.applyToJob,
);

// Candidate: view own applications
applicationRouter.get(
  "/my",
  authenticate,
  requireCandidate,
  applicationCtrl.getMyApplications,
);

// HR: view all applications for a job
applicationRouter.get(
  "/job/:jobId",
  authenticate,
  requireHR,
  applicationCtrl.getApplicationsByJob,
);

// HR: update application status
applicationRouter.patch(
  "/:applicationId/status",
  authenticate,
  requireHR,
  applicationCtrl.updateApplicationStatus,
);

// HR: trigger manual resume re-parse
applicationRouter.post(
  "/:applicationId/parse",
  authenticate,
  requireHR,
  applicationCtrl.triggerResumeParse,
);

// Shared: view single application (HR or candidate owner)
applicationRouter.get(
  "/:applicationId",
  authenticate,
  applicationCtrl.getApplicationById,
);

// ─── Dashboard Routes ──────────────────────────────────────────────────────────
const dashboardRouter = express.Router();
dashboardRouter.get(
  "/hr",
  authenticate,
  requireHR,
  dashboardCtrl.getHRDashboard,
);
dashboardRouter.get(
  "/hr/jobs/:jobId/report",
  authenticate,
  requireHR,
  dashboardCtrl.getJobReport,
);

// ─── Chatbot Routes ────────────────────────────────────────────────────────────
// Public — no auth required (the chatbot is a standalone resume builder tool)
const chatbotRouter = express.Router();
chatbotRouter.post("/start", chatbotCtrl.startSession);
chatbotRouter.post("/message", chatbotCtrl.handleMessage);
chatbotRouter.post(
  "/parse-resume",
  upload.single("file"),
  chatbotCtrl.parseResume,
);
chatbotRouter.post("/improve-resume-section", chatbotCtrl.improveResumeSection);
chatbotRouter.delete("/session/:sessionId", chatbotCtrl.resetSession);

const jdChatbotRouter = express.Router();
jdChatbotRouter.post("/start", jdChatbotCtrl.startSession);
jdChatbotRouter.post("/message", jdChatbotCtrl.handleMessage);
jdChatbotRouter.delete("/session/:sessionId", jdChatbotCtrl.resetSession);

// ─── Mount all routers ─────────────────────────────────────────────────────────
router.use("/auth", authRouter);
router.use("/jobs", jobRouter);
router.use("/applications", applicationRouter);
router.use("/dashboard", dashboardRouter);
router.use("/chatbot/jd", jdChatbotRouter);
router.use("/chatbot", chatbotRouter);

module.exports = router;
