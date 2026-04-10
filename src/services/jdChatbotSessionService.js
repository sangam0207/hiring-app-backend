const { v4: uuidv4 } = require("uuid");

const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function createSession() {
  const id = uuidv4();
  const session = {
    id,
    step: 1,
    data: {
      jobTitle: "",
      companyName: "",
      industryType: "",
      yoe: "",
      yoeLabel: "",
      benefits: [],
    },
    snapshots: [],
    jdMarkdown: null,
    jdHtml: null,
    pdfUrl: null,
    lastActivity: Date.now(),
  };

  sessions.set(id, session);
  return session;
}

function cloneState(session) {
  return {
    step: session.step,
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
  const previous = session.snapshots.pop();
  session.step = previous.step;
  session.data = previous.data;
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

setInterval(
  () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        sessions.delete(id);
      }
    }
  },
  30 * 60 * 1000,
);

module.exports = {
  createSession,
  getSession,
  deleteSession,
  pushSnapshot,
  restorePreviousSnapshot,
};
