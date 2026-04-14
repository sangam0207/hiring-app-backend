/**
 * chatbotController.js
 *
 * HTTP handlers for the AI Resume Builder chatbot.
 *
 * Endpoints:
 *  POST   /api/chatbot/start              → Create session, return welcome message
 *  POST   /api/chatbot/message            → Handle user message, return AI response
 *  DELETE /api/chatbot/session/:sessionId → Reset/delete session
 */

const {
  createSession,
  getSession,
  deleteSession,
} = require("../services/chatbotSessionService");
const {
  getWelcomeMessage,
  processMessage,
} = require("../services/chatbotFlowService");
const { getSignedUrl } = require("../services/s3Service");
const { errorResponse } = require("../utils/response");

function sanitizePdfFilename(name) {
  const cleaned = String(name || "resume")
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${cleaned || "resume"}.pdf`;
}

// ─── POST /api/chatbot/start ──────────────────────────────────────────────────

/**
 * Create a new chatbot session and return the welcome message.
 * If a sessionId is provided in the body and still active, reset it first.
 */
async function startSession(req, res) {
  try {
    const { sessionId } = req.body || {};

    // If client sends an existing sessionId, clean it up
    if (sessionId) deleteSession(sessionId);

    const session = createSession();
    const welcome = getWelcomeMessage();

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      message: welcome,
    });
  } catch (err) {
    console.error("[Chatbot] startSession error:", err);
    return errorResponse(res, "Failed to start chat session.", 500);
  }
}

// ─── POST /api/chatbot/message ────────────────────────────────────────────────

/**
 * Process a user message within an active session.
 * Body: { sessionId: string, message: string | object }
 */
async function handleMessage(req, res) {
  try {
    const { sessionId, message } = req.body || {};

    if (!sessionId || typeof sessionId !== "string") {
      return errorResponse(res, "sessionId is required.", 400);
    }

    const isStringMessage = typeof message === "string";
    const isObjectMessage = message && typeof message === "object";

    if (!isStringMessage && !isObjectMessage) {
      return errorResponse(
        res,
        "message is required and must be a string or object payload.",
        400,
      );
    }

    if (isStringMessage && !message.trim()) {
      return errorResponse(
        res,
        "message is required and must be non-empty.",
        400,
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(410).json({
        success: false,
        message: "Session expired or not found. Please start a new chat.",
        response: {
          type: "error",
          markdown:
            "Your session has expired. Please close and reopen the chat to start fresh.",
          meta: { step: null, progress: null, isFinal: false },
        },
      });
    }

    // Session is at terminal step (already generated a resume)
    if (session.step > 11) {
      const preferredName = session?.data?.name;
      const pdfUrl = session.pdfUrl
        ? getSignedUrl(session.pdfUrl, 3600) || session.pdfUrl
        : undefined;
      const pdfDownloadUrl = session.pdfUrl
        ? getSignedUrl(session.pdfUrl, 3600, {
            ResponseContentType: "application/pdf",
            ResponseContentDisposition: `attachment; filename=\"${sanitizePdfFilename(preferredName)}\"`,
          }) || pdfUrl
        : undefined;

      return res.status(200).json({
        success: true,
        sessionId,
        response: {
          type: "pdf",
          markdown:
            "Your resume has already been generated. If you want to create a new one, please close and reopen the chat.",
          meta: { step: session.step, progress: null, isFinal: true },
          pdfUrl,
          pdfDownloadUrl,
        },
      });
    }

    const response = await processMessage(session, message);

    return res.status(200).json({
      success: true,
      sessionId,
      response,
    });
  } catch (err) {
    console.error("[Chatbot] handleMessage error:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      response: {
        type: "error",
        markdown:
          "Something went wrong on our end. Please try again in a moment.",
        meta: { step: null, progress: null, isFinal: false },
      },
    });
  }
}

// ─── DELETE /api/chatbot/session/:sessionId ───────────────────────────────────

/**
 * Explicitly delete/reset a session (called when user closes chat).
 */
function resetSession(req, res) {
  try {
    const { sessionId } = req.params;
    deleteSession(sessionId);
    return res
      .status(200)
      .json({ success: true, message: "Session reset successfully." });
  } catch (err) {
    console.error("[Chatbot] resetSession error:", err);
    return errorResponse(res, "Failed to reset session.", 500);
  }
}

// ─── POST /api/chatbot/parse-resume ──────────────────────────────────────────

/**
 * Parse an uploaded or pasted resume into structured JSON.
 *
 * Body: { source: "text" | "file", text: string, file?: binary }
 * Returns: { success: boolean, resume?: Object, error?: string }
 */
async function parseResume(req, res) {
  try {
    const {
      structureResumeFromText,
    } = require("../services/resumeStructuringService");
    const { extractTextFromResume } = require("../utils/resumeExtractor");

    const { source, text } = req.body || {};
    const uploadedFile = req.file;

    let resumeText = null;

    // ──── Extract text from uploaded file or pasted text ────
    if (source === "file" && uploadedFile) {
      try {
        resumeText = await extractTextFromResume(
          uploadedFile.buffer,
          uploadedFile.mimetype,
        );
      } catch (error) {
        // Retry once for transient parser failures seen on first attempt.
        try {
          resumeText = await extractTextFromResume(
            uploadedFile.buffer,
            uploadedFile.mimetype,
          );
        } catch (retryError) {
          return res.status(400).json({
            success: false,
            error: `Failed to extract text from PDF: ${retryError.message}`,
          });
        }
      }
    } else if (source === "text" && text) {
      resumeText = String(text).trim();
    }

    if (!resumeText) {
      return res.status(400).json({
        success: false,
        error: "Please provide a resume (upload PDF or paste text).",
      });
    }

    // ──── Structure the text using LLM ────
    try {
      const structured = await structureResumeFromText(resumeText);
      return res.status(200).json({
        success: true,
        resume: structured,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message || "Failed to parse resume.",
      });
    }
  } catch (err) {
    console.error("[Chatbot] parseResume error:", err);
    return errorResponse(
      res,
      `An unexpected error occurred: ${err.message}`,
      500,
    );
  }
}

// ─── POST /api/chatbot/improve-resume-section ───────────────────────────────

/**
 * Improve a single resume section using AI.
 * Body: { section: string, sectionData: any }
 */
async function improveResumeSection(req, res) {
  try {
    const {
      improveSectionWithAI,
    } = require("../services/resumeStructuringService");
    const { section, sectionData, mode } = req.body || {};

    const allowed = new Set([
      "summary",
      "experience",
      "skills",
      "education",
      "certifications",
    ]);

    if (!allowed.has(String(section || ""))) {
      return res.status(400).json({
        success: false,
        error: "Invalid section requested for improvement.",
      });
    }

    const improved = await improveSectionWithAI(section, sectionData, mode);
    return res.status(200).json({ success: true, improved });
  } catch (err) {
    console.error("[Chatbot] improveResumeSection error:", err);
    return res.status(400).json({
      success: false,
      error: err.message || "Failed to improve section.",
    });
  }
}

module.exports = {
  startSession,
  handleMessage,
  resetSession,
  parseResume,
  improveResumeSection,
};
