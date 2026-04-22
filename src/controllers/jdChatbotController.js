const {
  createSession,
  getSession,
  deleteSession,
} = require("../services/jdChatbotSessionService");
const {
  getWelcomeMessage,
  processMessage,
} = require("../services/jdChatbotFlowService");
const { getSignedUrl } = require("../services/s3Service");
const { errorResponse } = require("../utils/response");

function sanitizePdfFilename(name) {
  const cleaned = String(name || "job-description")
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);

  return `${cleaned || "job-description"}.pdf`;
}

async function startSession(req, res) {
  try {
    const { sessionId } = req.body || {};

    if (sessionId) deleteSession(sessionId);

    const session = createSession();
    const welcome = getWelcomeMessage();

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      message: welcome,
    });
  } catch (error) {
    console.error("[JDChatbot] startSession error:", error);
    return errorResponse(res, "Failed to start JD chat session.", 500);
  }
}

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

    if (session.step > 6) {
      const pdfUrl = session.pdfUrl
        ? getSignedUrl(session.pdfUrl, 3600) || session.pdfUrl
        : undefined;
      const pdfDownloadUrl = session.pdfUrl
        ? getSignedUrl(session.pdfUrl, 3600, {
            ResponseContentType: "application/pdf",
            ResponseContentDisposition: `attachment; filename=\"${sanitizePdfFilename(session.data.jobTitle)}\"`,
          }) || pdfUrl
        : undefined;

      return res.status(200).json({
        success: true,
        sessionId,
        response: {
          type: "jd_pdf",
          markdown: "Here is the final job description.",
          html: session.jdHtml,
          meta: { step: 6, progress: null, isFinal: true },
          pdfUrl,
          pdfDownloadUrl,
          pdfFilename: "Job-Description.pdf",
        },
      });
    }

    const response = await processMessage(session, message);

    return res.status(200).json({
      success: true,
      sessionId,
      response,
    });
  } catch (error) {
    console.error("[JDChatbot] handleMessage error:", error);
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

function resetSession(req, res) {
  try {
    const { sessionId } = req.params;
    deleteSession(sessionId);
    return res
      .status(200)
      .json({ success: true, message: "JD session reset successfully." });
  } catch (error) {
    console.error("[JDChatbot] resetSession error:", error);
    return errorResponse(res, "Failed to reset JD session.", 500);
  }
}

module.exports = {
  startSession,
  handleMessage,
  resetSession,
};
