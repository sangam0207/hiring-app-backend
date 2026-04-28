const prisma = require("../config/prisma");

// APIFY TEMPORARILY DISABLED (kept commented for easy re-enable)
// const { ApifyClient } = require("apify-client");
// const REQUEST_TIMEOUT_MS = 90000;
// function resolveConfig() {
//   const token = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
//   const actorId = process.env.ACTOR_ID || process.env.APIFY_ACTOR_ID;
//   return { valid: Boolean(token && actorId), token, actorId };
// }
// async function fetchFromApify(url, config) {
//   const client = new ApifyClient({ token: config.token });
//   const run = await client.actor(config.actorId).call({ profileUrls: [url] });
//   const { items } = await client.dataset(run.defaultDatasetId).listItems();
//   return Array.isArray(items) ? items[0] : null;
// }

const LINKEDIN_URL_RE =
  /^https:\/\/www\.linkedin\.com\/in\/([a-zA-Z0-9-_%]+)\/?(?:\?.*)?$/i;
const MOCK_DELAY_MS = 1000;
const inMemoryCache = new Map();

const MOCK_LINKEDIN_DATA = {
  "kartic-joshi-a4558a137": {
    name: "Kartic Joshi",
    sector: "Software Development",
    role: "Full Stack Developer",
    experienceType: "experienced",
    yearsExperience: 1,
    workDetails: {
      lastJobRole: "React Native Developer",
      lastCompany: "VDOIT Technologies",
      lastDuration: "Oct 2024 - Present",
    },
    responsibilities:
      "Developed mobile applications using React Native, built authentication systems with OAuth and JWT, and created responsive SaaS dashboards with real-time data visualization.",
    skills: [
      "React Native",
      "Node.js",
      "TypeScript",
      "PostgreSQL",
      "Firebase",
      "MongoDB",
      "JavaScript",
    ],
    education: [
      {
        qualification: "B.Tech in Information Technology",
        year: "2024",
      },
    ],
    certifications: [],
    contact: {
      email: "karticjoshi68@gmail.com",
      phone: "",
      city: "New Delhi",
    },
  },
  "sangam-shukla-225412271": {
    name: "Sangam Shukla",
    sector: "Software Development",
    role: "Full Stack Developer",
    experienceType: "experienced",
    yearsExperience: 2,
    workDetails: {
      lastJobRole: "Senior IT Associate",
      lastCompany: "VDOIT Technologies",
      lastDuration: "Apr 2025 - Present",
    },
    responsibilities:
      "Worked on full stack applications using React.js, Next.js, Node.js and Express.js, implemented authentication systems using JWT, and built scalable MERN stack applications.",
    skills: [
      "React.js",
      "Next.js",
      "Node.js",
      "Express.js",
      "MongoDB",
      "JWT",
      "Redux",
      "Tailwind CSS",
    ],
    education: [
      {
        qualification: "B.Tech in Computer Science Engineering",
        year: "2024",
      },
    ],
    certifications: [],
    contact: {
      email: "ssrv2024@gmail.com",
      phone: "8381847820",
      city: "New Delhi",
    },
  },
  thardik1505: {
    name: "Hardik",
    sector: "Software Testing",
    role: "Test Automation Engineer",
    experienceType: "experienced",
    yearsExperience: 1,
    workDetails: {
      lastJobRole: "Test Automation Engineer",
      lastCompany: "VDOIT Technologies",
      lastDuration: "Jan 2025 - Present",
    },
    responsibilities:
      "Worked on automation testing using Selenium, created test cases, performed software testing, and contributed to RPA and automation workflows.",
    skills: [
      "Selenium",
      "Test Automation",
      "Software Testing",
      "Java",
      "JavaScript",
      "RPA",
      "Jira",
    ],
    education: [
      {
        qualification: "B.Tech in Information Technology",
        year: "2025",
      },
    ],
    certifications: [],
    contact: {
      email: "thardik1505@gmail.com",
      phone: "8950296925",
      city: "Gurugram",
    },
  },
};

function validateLinkedInProfileUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  const match = url.match(LINKEDIN_URL_RE);
  if (!match) {
    return {
      valid: false,
      error:
        "Please enter a valid LinkedIn profile URL in this format: https://www.linkedin.com/in/profile-id",
    };
  }

  const identifier = String(match[1] || "")
    .trim()
    .toLowerCase();
  if (!identifier) {
    return {
      valid: false,
      error: "Could not read profile identifier from that LinkedIn URL.",
    };
  }

  return {
    valid: true,
    identifier,
    normalizedUrl: `https://www.linkedin.com/in/${identifier}`,
  };
}

function splitResponsibilities(text) {
  return String(text || "")
    .split(/\n|\.|•/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeMockProfile(raw, identifier, profileUrl) {
  const responsibilitiesList = splitResponsibilities(raw?.responsibilities);

  return {
    identifier,
    name: String(raw?.name || "").trim(),
    targetRole: String(raw?.role || "").trim(),
    headline: String(raw?.role || "").trim(),
    summary: "",
    skills: Array.isArray(raw?.skills)
      ? raw.skills.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    education: Array.isArray(raw?.education)
      ? raw.education
          .map((item) => ({
            qualification: String(item?.qualification || "").trim(),
            endYear: String(item?.year || "").trim(),
            institution: String(item?.institution || "").trim(),
          }))
          .filter(
            (item) => item.qualification || item.endYear || item.institution,
          )
      : [],
    certifications: Array.isArray(raw?.certifications)
      ? raw.certifications
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [],
    location: String(raw?.contact?.city || "").trim(),
    industry: String(raw?.sector || "").trim(),
    lastJobRole: String(raw?.workDetails?.lastJobRole || "").trim(),
    lastCompany: String(raw?.workDetails?.lastCompany || "").trim(),
    lastDuration: String(raw?.workDetails?.lastDuration || "").trim(),
    responsibilities: String(raw?.responsibilities || "").trim(),
    responsibilitiesList,
    experienceType:
      raw?.experienceType === "fresher" ? "fresher" : "experienced",
    yearsExperience: String(raw?.yearsExperience ?? "0").trim() || "0",
    sourceProfileUrl: profileUrl,
    email: String(raw?.contact?.email || "").trim(),
    phone: String(raw?.contact?.phone || "").trim(),
    city: String(raw?.contact?.city || "").trim(),
  };
}

async function getMockLinkedInData(url) {
  const parsed = validateLinkedInProfileUrl(url);
  if (!parsed.valid) {
    const err = new Error(parsed.error);
    err.kind = "validation";
    throw err;
  }

  const profile = MOCK_LINKEDIN_DATA[parsed.identifier];
  if (!profile) {
    const err = new Error(
      "We couldn't fetch this profile. Please continue manually.",
    );
    err.kind = "not-found";
    throw err;
  }

  const normalized = normalizeMockProfile(
    profile,
    parsed.identifier,
    parsed.normalizedUrl,
  );

  return {
    identifier: parsed.identifier,
    normalized,
    raw: profile,
    isPartial: false,
  };
}

async function getCacheFromStore(identifier) {
  const memoryHit = inMemoryCache.get(identifier);
  if (memoryHit) {
    return { source: "memory", record: memoryHit };
  }

  try {
    const dbRecord = await prisma.linkedInProfileCache.findUnique({
      where: { identifier },
    });
    if (dbRecord) {
      return { source: "db", record: dbRecord };
    }
  } catch {
    // DB table might not be migrated yet; memory cache still works.
  }

  return null;
}

async function saveCache(identifier, profileUrl, rawData, normalizedData) {
  const cacheValue = {
    identifier,
    profileUrl,
    rawData,
    normalizedData,
    scrapedAt: new Date(),
  };

  inMemoryCache.set(identifier, cacheValue);

  try {
    await prisma.linkedInProfileCache.upsert({
      where: { identifier },
      create: {
        identifier,
        profileUrl,
        rawData,
        normalizedData,
        scrapedAt: new Date(),
      },
      update: {
        profileUrl,
        rawData,
        normalizedData,
        scrapedAt: new Date(),
      },
    });
  } catch {
    // Ignore DB write issues; memory fallback remains available.
  }
}

async function importLinkedInProfile(url) {
  const parsed = validateLinkedInProfileUrl(url);
  if (!parsed.valid) {
    return { ok: false, kind: "validation", error: parsed.error };
  }

  const cached = await getCacheFromStore(parsed.identifier);
  if (cached?.record?.normalizedData) {
    return {
      ok: true,
      fromCache: true,
      identifier: parsed.identifier,
      normalized: cached.record.normalizedData,
      raw: cached.record.rawData || null,
      isPartial: false,
    };
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

    const mock = await getMockLinkedInData(parsed.normalizedUrl);

    await saveCache(
      parsed.identifier,
      parsed.normalizedUrl,
      mock.raw,
      mock.normalized,
    );

    return {
      ok: true,
      fromCache: false,
      identifier: parsed.identifier,
      normalized: mock.normalized,
      raw: mock.raw,
      isPartial: mock.isPartial,
    };
  } catch (error) {
    return {
      ok: false,
      kind: error?.kind || "fetch",
      error:
        error?.message ||
        "We couldn't fetch this profile. Please continue manually.",
    };
  }
}

module.exports = {
  importLinkedInProfile,
  validateLinkedInProfileUrl,
  getMockLinkedInData,
};
