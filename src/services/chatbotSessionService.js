/**
 * chatbotSessionService.js
 * In-memory session store for chatbot conversations.
 * Keyed by sessionId (uuid). Sessions expire after SESSION_TTL_MS of inactivity.
 */

const { v4: uuidv4 } = require("uuid");

const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * @typedef {Object} ChatSession
 * @property {string}   id
 * @property {number}   step         - Current internal step (0-13)
 * @property {string|null} sector    - 'hospitality' | 'aviation' | 'retail' | 'customer service'
 * @property {Object}   data         - Collected resume data
 * @property {Array}    history      - OpenAI conversation history [{role, content}]
 * @property {Object|null} resumeJson- Final structured resume
 * @property {string|null} pdfUrl    - S3 URL of generated PDF
 * @property {number}   lastActivity - Timestamp of last interaction
 */

function createSession() {
  const id = uuidv4();
  const session = {
    id,
    step: 0,
    sector: null,
    data: {
      sector: null,
      experienceType: null,
      yearsExperience: null,
      hasInternship: null,
      internshipRole: null,
      internshipDuration: null,
      lastJobRole: null,
      lastCompany: null,
      lastDuration: null,
      targetRole: null,
      responsibilities: null,
      skills: [],
      education: [],
      certifications: [],
      certificationOption: null,
      roleProfile: null,
      weightedSkills: [],
      refinedResponsibilities: [],
      personalization: {
        tonePreference: "balanced",
        acknowledgementHistory: [],
        questionDepth: "normal",
      },
      name: null,
      phone: null,
      email: null,
      city: null,
      location: null,
    },
    history: [],
    snapshots: [],
    resumeJson: null,
    pdfUrl: null,
    lastActivity: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

function cloneState(session) {
  return {
    step: session.step,
    sector: session.sector,
    data: JSON.parse(JSON.stringify(session.data || {})),
  };
}

function pushSnapshot(session) {
  if (!session) return;
  session.snapshots = session.snapshots || [];
  session.snapshots.push(cloneState(session));
}

function restorePreviousSnapshot(session) {
  if (!session?.snapshots?.length) return false;
  const snapshot = session.snapshots.pop();
  session.step = snapshot.step;
  session.sector = snapshot.sector;
  session.data = snapshot.data;
  return true;
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  session.lastActivity = Date.now();
  return session;
}

function deleteSession(id) {
  return sessions.delete(id);
}

function sessionExists(id) {
  return sessions.has(id);
}

// Purge stale sessions every 30 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastActivity > SESSION_TTL_MS) sessions.delete(id);
    }
  },
  30 * 60 * 1000,
);

module.exports = {
  createSession,
  getSession,
  deleteSession,
  sessionExists,
  pushSnapshot,
  restorePreviousSnapshot,
};
