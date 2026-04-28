const openai = require("../config/openai");
const { generateResumePackage } = require("./resumePDFService");
const { getSignedUrl } = require("./s3Service");
const {
  pushSnapshot,
  restorePreviousSnapshot,
} = require("./chatbotSessionService");
const { importLinkedInProfile } = require("./linkedinImportService");

const STEP = {
  MODE: -1, // Choose between manual creation or LinkedIn import
  LINKEDIN_URL: 0, // Collect LinkedIn profile URL for prefill flow
  NAME: 1,
  SECTOR: 2,
  ROLE: 3,
  EXPERIENCE_TYPE: 4,
  WORK_DETAILS: 5,
  RESPONSIBILITIES: 6,
  SKILLS: 7,
  EDUCATION: 8,
  CERTIFICATIONS: 9,
  CONTACT: 10,
  GENERATE: 11,
};

const PROGRESS_MAP = {
  // LinkedIn import step: shown before the 9 guided resume steps
  0: null,
  // Create mode: NAME through CONTACT shown as 1/9 through 9/9
  1: "1/9",
  2: "2/9",
  3: "3/9",
  4: "4/9",
  5: "5/9",
  6: "6/9",
  7: "7/9",
  8: "8/9",
  9: "9/9",
  10: "9/9", // CONTACT also shows 9/9
  11: null, // GENERATE doesn't show progress
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGIT_RE = /\d/g;
const CITY_RE = /^[a-zA-Z .'-]{2,60}$/;

const BASE_SECTOR_OPTIONS = [
  "Hospitality",
  "Aviation",
  "Retail",
  "Customer Service",
];

const SECTORS = {
  hospitality: {
    label: "Hospitality",
    roles: [
      "Hotel Front Desk",
      "Waiter / Server",
      "Housekeeping",
      "Guest Relations",
      "Food Service Associate",
    ],
    skillChips: [
      "Customer Service",
      "Guest Handling",
      "POS Handling",
      "Team Coordination",
      "Problem Solving",
      "Time Management",
    ],
    responsibilityHint:
      "Handled guest check-ins, managed bookings, assisted visitors, and coordinated service requests.",
  },
  aviation: {
    label: "Aviation",
    roles: [
      "Cabin Crew",
      "Ground Staff",
      "Check-in Agent",
      "Boarding Agent",
      "Airport Support Associate",
    ],
    skillChips: [
      "Safety Compliance",
      "Customer Service",
      "Emergency Readiness",
      "Communication",
      "Queue Management",
      "Team Coordination",
    ],
    responsibilityHint:
      "Supported passengers, followed safety procedures, and helped with boarding and service operations.",
  },
  retail: {
    label: "Retail",
    roles: [
      "Sales Associate",
      "Store Assistant",
      "Cashier",
      "Inventory Associate",
      "Visual Merchandising Assistant",
    ],
    skillChips: [
      "Sales Support",
      "Customer Service",
      "POS Handling",
      "Inventory Handling",
      "Upselling",
      "Product Knowledge",
    ],
    responsibilityHint:
      "Assisted customers, processed purchases, organized stock, and maintained product displays.",
  },
  "customer service": {
    label: "Customer Service",
    roles: [
      "Customer Support Executive",
      "Call Center Associate",
      "Chat Support Associate",
      "Client Relations Associate",
      "Support Specialist",
    ],
    skillChips: [
      "Communication",
      "Active Listening",
      "CRM Usage",
      "Issue Resolution",
      "Empathy",
      "Time Management",
    ],
    responsibilityHint:
      "Handled customer questions, updated support records, and resolved service issues across channels.",
  },
  custom: {
    label: "Selected Sector",
    roles: [
      "Operations Associate",
      "Customer-Facing Role",
      "Service Coordinator",
      "Support Executive",
      "Team Assistant",
    ],
    skillChips: [
      "Communication",
      "Customer Handling",
      "Coordination",
      "Problem Solving",
      "Time Management",
      "Attention to Detail",
    ],
    responsibilityHint:
      "Supported day-to-day work, coordinated tasks, communicated with customers or teams, and maintained service quality.",
  },
};

const TONE_BY_SECTOR = {
  hospitality: "customer service, guest satisfaction, and service reliability",
  aviation: "safety, communication, discipline, and process compliance",
  retail: "sales support, customer engagement, and store operations",
  "customer service": "service quality, empathy, and issue resolution",
  custom: "role-relevant practical execution, professionalism, and reliability",
};

const CERT_SUGGESTIONS_BY_SECTOR = {
  hospitality: [
    "Food Safety Certification",
    "Hospitality Management Certification",
    "Guest Service Excellence Training",
  ],
  aviation: [
    "IATA Certification",
    "Cabin Crew Training Certification",
    "Aviation Safety Training",
  ],
  retail: [
    "Retail Sales Certification",
    "Customer Service Certification",
    "POS System Training",
  ],
  "customer service": [
    "Customer Support Certification",
    "CRM Platform Training",
    "Communication and Conflict Resolution Training",
  ],
  technical: [
    "AWS Certification",
    "React Certification",
    "Google Associate Developer",
  ],
};

function firstNameOf(session) {
  const full = String(session?.data?.name || "").trim();
  if (!full) return "";
  return full.split(/\s+/)[0] || "";
}

function upsertPersonalization(session, patch = {}) {
  session.data.personalization = {
    tonePreference: "balanced",
    acknowledgementHistory: [],
    questionDepth: "normal",
    ...(session.data.personalization || {}),
    ...patch,
  };
}

function pickAcknowledgement(session, key, options) {
  upsertPersonalization(session);
  const history = Array.isArray(
    session.data.personalization.acknowledgementHistory,
  )
    ? session.data.personalization.acknowledgementHistory
    : [];
  const used = new Set(
    history.filter((entry) => entry?.key === key).map((entry) => entry.text),
  );
  const choice = options.find((item) => !used.has(item)) || options[0] || null;
  if (!choice) return null;
  history.push({ key, text: choice });
  session.data.personalization.acknowledgementHistory = history.slice(-20);
  return choice;
}

function sectorLabel(session) {
  return session.data.customSector || sectorConfig(session).label;
}

function heuristicRoleProfile({ customSector, targetRole }) {
  const source = `${customSector || ""} ${targetRole || ""}`.toLowerCase();
  const profile = {
    domain: "general service",
    displayDomain: customSector || "Service Operations",
    sampleRoles: [
      "Operations Assistant",
      "Service Associate",
      "Support Executive",
      "Coordinator",
      "Field Associate",
    ],
    dynamicSkills: [
      "Communication",
      "Problem Solving",
      "Team Coordination",
      "Time Management",
      "Customer Interaction",
      "Attention to Detail",
    ],
    responsibilityQuestion:
      "Describe the core tasks you usually handled in this role.",
    responsibilityHint:
      "Example: handled day-to-day tasks, followed process standards, and coordinated with team members to deliver outcomes.",
    workPrompt: "Add your latest work details relevant to this domain.",
    resumeTone:
      "practical execution, reliability, and professional communication",
    keywords: ["service", "operations", "support", "coordination", "quality"],
  };

  if (
    /mechanic|repair|technician|maintenance|garage|bike|auto|engine/.test(
      source,
    )
  ) {
    return {
      ...profile,
      domain: "technical service and maintenance",
      displayDomain: "Technical Repair and Maintenance",
      sampleRoles: [
        "Bike Mechanic",
        "Service Technician",
        "Maintenance Associate",
        "Workshop Assistant",
        "Repair Specialist",
      ],
      dynamicSkills: [
        "Troubleshooting",
        "Preventive Maintenance",
        "Tool Handling",
        "Diagnostics",
        "Quality Inspection",
        "Customer Communication",
      ],
      responsibilityQuestion:
        "What kind of repair or maintenance tasks did you usually handle?",
      responsibilityHint:
        "Example: diagnosed issues, performed repairs and part replacements, checked final performance, and explained fixes to customers.",
      workPrompt: "Add your most recent technical service role details.",
      resumeTone: "troubleshooting, precision, efficiency, and service quality",
      keywords: ["repair", "diagnostics", "maintenance", "tools", "inspection"],
    };
  }

  if (/teacher|trainer|tutor|instructor|education/.test(source)) {
    return {
      ...profile,
      domain: "education and training",
      displayDomain: "Education and Training",
      sampleRoles: [
        "Trainer",
        "Teaching Assistant",
        "Tutor",
        "Academic Coordinator",
        "Instruction Associate",
      ],
      dynamicSkills: [
        "Lesson Planning",
        "Communication",
        "Classroom Management",
        "Learner Support",
        "Content Delivery",
        "Assessment",
      ],
      responsibilityQuestion:
        "What teaching, training, or learner-support tasks did you handle regularly?",
      responsibilityHint:
        "Example: prepared sessions, supported learners with questions, tracked progress, and improved engagement.",
      resumeTone:
        "learner support, communication clarity, and structured delivery",
      keywords: ["training", "teaching", "learning", "assessment", "delivery"],
    };
  }

  if (/driver|delivery|logistics|warehouse|inventory|transport/.test(source)) {
    return {
      ...profile,
      domain: "logistics and field operations",
      displayDomain: "Logistics and Operations",
      sampleRoles: [
        "Operations Associate",
        "Inventory Associate",
        "Warehouse Assistant",
        "Delivery Support Associate",
        "Dispatch Coordinator",
      ],
      dynamicSkills: [
        "Inventory Tracking",
        "Process Compliance",
        "Time Management",
        "Coordination",
        "Documentation",
        "Issue Resolution",
      ],
      responsibilityQuestion:
        "What operational or logistics tasks did you handle in your last role?",
      responsibilityHint:
        "Example: tracked stock movement, coordinated dispatch, maintained records, and resolved on-ground issues.",
      resumeTone: "operational consistency, timeliness, and process discipline",
      keywords: [
        "operations",
        "inventory",
        "dispatch",
        "tracking",
        "compliance",
      ],
    };
  }

  return profile;
}

async function inferRoleProfile(session, input = {}) {
  const customSector = String(
    input.customSector || session.data.customSector || "",
  ).trim();
  const targetRole = String(
    input.targetRole || session.data.targetRole || "",
  ).trim();
  if (!customSector && !targetRole) return null;

  const fallback = heuristicRoleProfile({ customSector, targetRole });
  try {
    const prompt = `Infer a practical resume profile for this user input.

Custom sector: ${customSector || "N/A"}
Target role: ${targetRole || "N/A"}

Return JSON with keys:
domain, displayDomain, sampleRoles (max 5), dynamicSkills (5 to 6), responsibilityQuestion, responsibilityHint, workPrompt, resumeTone, keywords (max 6).
Keep content concise, professional, and realistic.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    return {
      ...fallback,
      ...parsed,
      sampleRoles: Array.isArray(parsed.sampleRoles)
        ? parsed.sampleRoles.slice(0, 5)
        : fallback.sampleRoles,
      dynamicSkills: Array.isArray(parsed.dynamicSkills)
        ? parsed.dynamicSkills.slice(0, 6)
        : fallback.dynamicSkills,
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.slice(0, 6)
        : fallback.keywords,
    };
  } catch {
    return fallback;
  }
}

function suggestSkills(session) {
  const base = session.data.roleProfile?.dynamicSkills?.length
    ? session.data.roleProfile.dynamicSkills
    : sectorConfig(session).skillChips;

  const fresherBoost = [
    "Communication",
    "Team Collaboration",
    "Adaptability",
    "Learning Agility",
    "Customer Interaction",
  ];

  const experiencedBoost = [
    "Process Ownership",
    "Operational Execution",
    "Issue Resolution",
    "Quality Control",
    "Cross-Team Coordination",
  ];

  const merged = [
    ...base,
    ...(session.data.experienceType === "experienced"
      ? experiencedBoost
      : fresherBoost),
  ];

  return [...new Set(merged)].slice(0, 6);
}

function fallbackCertificationSuggestions(session) {
  const roleText =
    `${session?.data?.targetRole || ""} ${session?.data?.customSector || ""}`.toLowerCase();
  const sector = session?.sector;
  const base = CERT_SUGGESTIONS_BY_SECTOR[sector] || [];

  const technicalHint =
    /developer|engineer|technical|software|frontend|backend|full.?stack|it|devops|cloud|data/.test(
      roleText,
    )
      ? CERT_SUGGESTIONS_BY_SECTOR.technical
      : [];

  return [...new Set([...base, ...technicalHint])].slice(0, 3);
}

async function inferCertificationSuggestions(session) {
  const fallback = fallbackCertificationSuggestions(session);
  const role = String(session?.data?.targetRole || "").trim();
  const sector = String(
    session?.data?.customSector || sectorLabel(session) || "",
  ).trim();

  if (!role && !sector) return fallback;

  try {
    const prompt = `Suggest 4 to 6 realistic certifications for this profile.

Sector: ${sector || "N/A"}
Target role: ${role || "N/A"}

Rules:
- Keep suggestions relevant to role and sector
- Do not include irrelevant generic items
- Return JSON only: {"suggestions": ["...", "..."]}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    const aiList = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];

    const merged = [...new Set([...aiList, ...fallback])];
    return merged.slice(0, 3);
  } catch {
    return fallback.slice(0, 3);
  }
}

function refineResponsibilityBullets(rawText, session) {
  const lines = String(rawText || "")
    .split(/[\n\.]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const roleHint = session.data.targetRole || "role";
  const verbTemplates = [
    "Handled",
    "Coordinated",
    "Supported",
    "Managed",
    "Improved",
    "Assisted",
  ];

  if (!lines.length) return [];

  return lines.slice(0, 5).map((line, index) => {
    const normalized = line.replace(/^[a-z]/, (char) => char.toLowerCase());
    const startsWithVerb =
      /^(handled|managed|coordinated|assisted|supported|maintained|improved|resolved|performed)\b/i.test(
        line,
      );
    if (startsWithVerb) return line;
    const verb = verbTemplates[index % verbTemplates.length];
    return `${verb} ${normalized} to deliver reliable outcomes as a ${roleHint}.`;
  });
}

function setQuestionDepth(session, text) {
  const length = String(text || "").trim().length;
  const depth = length > 120 ? "fast" : length < 30 ? "guided" : "normal";
  upsertPersonalization(session, { questionDepth: depth });
}

function computeWeightedSkills(session) {
  const picked = Array.isArray(session.data.skills) ? session.data.skills : [];
  const keys = (session.data.roleProfile?.keywords || []).map((key) =>
    key.toLowerCase(),
  );
  const scored = picked.map((skill) => {
    const lower = String(skill).toLowerCase();
    const score = keys.some((key) => lower.includes(key)) ? 2 : 1;
    return { skill, score };
  });

  scored.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
  session.data.weightedSkills = scored.map((entry) => entry.skill);
}

function normalizeSector(value) {
  const v = String(value || "")
    .toLowerCase()
    .trim();
  if (
    v.includes("hospitality") ||
    v.includes("hotel") ||
    v.includes("restaurant")
  )
    return "hospitality";
  if (v.includes("aviation") || v.includes("airline") || v.includes("flight"))
    return "aviation";
  if (v.includes("retail") || v.includes("store") || v.includes("shop"))
    return "retail";
  if (v.includes("customer") || v.includes("support") || v.includes("call"))
    return "customer service";
  return null;
}

function parsePayload(raw) {
  if (raw && typeof raw === "object") return raw;
  const str = String(raw || "").trim();
  if (!str) return {};
  if (str.startsWith("{") && str.endsWith("}")) {
    try {
      return JSON.parse(str);
    } catch {
      return { value: str };
    }
  }
  return { value: str };
}

function nameOf(session) {
  return firstNameOf(session) || "there";
}

function sectorConfig(session) {
  return SECTORS[session.sector] || SECTORS.custom;
}

function sanitizePdfFilename(name) {
  const cleaned = String(name || "resume")
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${cleaned || "resume"}.pdf`;
}

function buildPdfAccessLinks(pdfUrl, preferredName) {
  if (!pdfUrl) return { viewUrl: null, downloadUrl: null };
  const viewUrl = getSignedUrl(pdfUrl, 3600) || pdfUrl;
  const downloadUrl =
    getSignedUrl(pdfUrl, 3600, {
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: `attachment; filename=\"${sanitizePdfFilename(preferredName)}\"`,
    }) || viewUrl;
  return { viewUrl, downloadUrl };
}

function buildResponse({
  type,
  markdown,
  options,
  input,
  step,
  isFinal = false,
  pdfUrl,
  pdfDownloadUrl,
  replaceLast = false,
  session,
}) {
  return {
    type,
    markdown,
    ...(options && { options }),
    ...(input && { input }),
    ...(pdfUrl && { pdfUrl }),
    ...(pdfDownloadUrl && { pdfDownloadUrl }),
    meta: {
      step,
      progress: PROGRESS_MAP[step] || null,
      isFinal,
      canGoBack: Boolean(session?.snapshots?.length),
      replaceLast,
    },
  };
}

function introMarkdown(title, body, hint, acknowledgement, validationNote) {
  const lines = [`## ${title}`];
  if (acknowledgement) lines.push("", acknowledgement);
  lines.push("", body);
  if (hint) lines.push("", `Guidance: ${hint}`);
  if (validationNote) lines.push("", validationNote);
  return lines.join("\n");
}

function validationNoteFromErrors(errors) {
  const entries = Object.values(errors || {}).filter(Boolean);
  if (!entries.length) return null;
  return [
    "Please enter valid details:",
    ...entries.map((msg) => `- ${msg}`),
  ].join("\n");
}

function getWelcomeMessage() {
  const sessionLike = { step: STEP.MODE, data: {}, snapshots: [] };
  return buildStepResponse(sessionLike);
}

function buildStepResponse(session, extras = {}) {
  const {
    errors = {},
    values = {},
    replaceLast = false,
    acknowledgement = null,
  } = extras;
  const config = sectorConfig(session);
  const profile = session.data.roleProfile || null;
  const shortName = nameOf(session);

  switch (session.step) {
    case STEP.MODE:
      return buildResponse({
        type: "options",
        markdown: introMarkdown(
          "Resume Builder Assistant",
          "Welcome! I'll help you create a professional resume.",
          "Choose how you want to begin.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        options: [
          {
            label: "Create Resume Manually",
            value: "create",
            icon: "file-text",
          },
          {
            label: "Import from LinkedIn",
            value: "linkedin",
            icon: "linkedin",
          },
        ],
        step: STEP.MODE,
        replaceLast,
        session,
      });

    case STEP.LINKEDIN_URL:
      return buildResponse({
        type: "input",
        markdown: introMarkdown(
          "Import LinkedIn Profile",
          "Paste your public LinkedIn profile URL and I will prefill your resume details.",
          "Use format: https://www.linkedin.com/in/profile-id",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          type: "url",
          placeholder: "https://www.linkedin.com/in/your-profile-id",
          initialValue: values.value ?? "",
          errors,
        },
        step: STEP.LINKEDIN_URL,
        replaceLast,
        session,
      });

    case STEP.NAME:
      return buildResponse({
        type: "input",
        markdown: introMarkdown(
          "Resume Builder Assistant",
          "I will guide you through quick structured steps to generate a professional resume.",
          "Enter your full name as you want it to appear on the resume.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          type: "text",
          placeholder: "Enter your full name",
          initialValue: values.value ?? session.data.name ?? "",
          errors,
        },
        step: STEP.NAME,
        replaceLast,
        session,
      });

    case STEP.SECTOR:
      return buildResponse({
        type: "chip_select_with_custom",
        markdown: introMarkdown(
          "Target Sector",
          "Choose the sector you want to target.",
          "If your sector is not listed, use Other and type your custom choice.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          options: BASE_SECTOR_OPTIONS,
          customPlaceholder: "Enter your sector",
          allowMultiple: false,
          initialValue: values.value ?? session.data.customSector ?? "",
          selected: values.value
            ? [values.value]
            : session.data.customSector
              ? [session.data.customSector]
              : session.sector && session.sector !== "custom"
                ? [SECTORS[session.sector]?.label || ""]
                : [],
          errors,
        },
        step: STEP.SECTOR,
        replaceLast,
        session,
      });

    case STEP.ROLE: {
      const roleOptions =
        session.sector === "custom" && Array.isArray(profile?.sampleRoles)
          ? profile.sampleRoles
          : config.roles;
      return buildResponse({
        type: "chip_select_with_custom",
        markdown: introMarkdown(
          "Role or Sub-Field",
          `Select the role you are targeting in ${sectorLabel(session).toLowerCase()}.`,
          "Use Other if you want to type a custom role.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          options: roleOptions,
          customPlaceholder: `Enter a custom ${config.label.toLowerCase()} role`,
          allowMultiple: false,
          initialValue: values.value ?? session.data.targetRole ?? "",
          selected: values.value
            ? [values.value]
            : session.data.targetRole
              ? [session.data.targetRole]
              : [],
          errors,
        },
        step: STEP.ROLE,
        replaceLast,
        session,
      });
    }

    case STEP.EXPERIENCE_TYPE:
      return buildResponse({
        type: "dynamic_input",
        markdown: introMarkdown(
          "Experience Type",
          "Tell me whether you are a fresher or already have relevant work experience.",
          "If you are experienced, add your number of years before continuing.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          options: [
            { label: "Fresher", value: "fresher" },
            { label: "Experienced", value: "experienced" },
          ],
          conditional: {
            experienced: {
              fields: [
                {
                  key: "yearsExperience",
                  label: "Years of experience",
                  type: "number",
                  placeholder: "Enter years",
                  min: 0,
                  max: 50,
                },
              ],
              submitLabel: "Confirm experience",
            },
          },
          selectedOption: values.option ?? session.data.experienceType ?? null,
          initialValues: {
            yearsExperience:
              values.yearsExperience ?? session.data.yearsExperience ?? "",
          },
          errors,
        },
        step: STEP.EXPERIENCE_TYPE,
        replaceLast,
        session,
      });

    case STEP.WORK_DETAILS:
      if (session.data.experienceType === "fresher") {
        return buildResponse({
          type: "dynamic_input",
          markdown: introMarkdown(
            "Internship Background",
            "Have you done any internships?",
            "If yes, add the role and duration. If not, we will shift the next question to projects, training, or activities.",
            acknowledgement,
            validationNoteFromErrors(errors),
          ),
          input: {
            options: [
              { label: "Yes", value: "yes" },
              { label: "No", value: "no" },
            ],
            conditional: {
              yes: {
                fields: [
                  {
                    key: "internshipRole",
                    label: "Internship role",
                    type: "text",
                    placeholder: "Enter internship role",
                  },
                  {
                    key: "internshipDuration",
                    label: "Duration",
                    type: "text",
                    placeholder: "e.g. 3 months",
                  },
                ],
                submitLabel: "Confirm internship details",
              },
            },
            selectedOption:
              values.option ??
              (session.data.hasInternship === true
                ? "yes"
                : session.data.hasInternship === false
                  ? "no"
                  : null),
            initialValues: {
              internshipRole:
                values.internshipRole ?? session.data.internshipRole ?? "",
              internshipDuration:
                values.internshipDuration ??
                session.data.internshipDuration ??
                "",
            },
            errors,
          },
          step: STEP.WORK_DETAILS,
          replaceLast,
          session,
        });
      }

      return buildResponse({
        type: "multi_field_input",
        markdown: introMarkdown(
          "Last Job Details",
          profile?.workPrompt ||
            "Add your latest job details so I can frame your experience correctly.",
          "Include role, company, and duration.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          fields: [
            {
              key: "lastJobRole",
              label: "Last job role",
              type: "text",
              placeholder: "Enter role",
              icon: "work",
            },
            {
              key: "lastCompany",
              label: "Company name",
              type: "text",
              placeholder: "Enter company",
              icon: "work",
            },
            {
              key: "lastDuration",
              label: "Duration",
              type: "text",
              placeholder: "e.g. 2 years",
              icon: "work",
            },
          ],
          initialItems:
            values.items ??
            (session.data.lastJobRole ||
            session.data.lastCompany ||
            session.data.lastDuration
              ? [
                  {
                    lastJobRole: session.data.lastJobRole ?? "",
                    lastCompany: session.data.lastCompany ?? "",
                    lastDuration: session.data.lastDuration ?? "",
                  },
                ]
              : undefined),
          errors,
          submitLabel: "Confirm work details",
          repeatable: false,
        },
        step: STEP.WORK_DETAILS,
        replaceLast,
        session,
      });

    case STEP.RESPONSIBILITIES: {
      const fresherNoInternship =
        session.data.experienceType === "fresher" &&
        session.data.hasInternship === false;
      const body = fresherNoInternship
        ? "Tell me about any projects, training, or activities where you developed relevant skills."
        : profile?.responsibilityQuestion ||
          "Describe your key responsibilities in your last internship or job.";
      const hint = fresherNoInternship
        ? "Example: Completed front office training, handled guest simulations, supported college event coordination, or managed project work."
        : profile?.responsibilityHint || config.responsibilityHint;
      const ack = fresherNoInternship
        ? "That is completely fine. Projects, training, and real activities still help build a strong profile."
        : acknowledgement;

      return buildResponse({
        type: "input",
        markdown: introMarkdown(
          "Relevant Experience",
          body,
          hint,
          ack,
          validationNoteFromErrors(errors),
        ),
        input: {
          type: "multiline",
          placeholder: hint,
          initialValue: values.value ?? session.data.responsibilities ?? "",
          errors,
        },
        step: STEP.RESPONSIBILITIES,
        replaceLast,
        session,
      });
    }

    case STEP.SKILLS:
      return buildResponse({
        type: "chip_select_with_custom",
        markdown: introMarkdown(
          "Skills",
          "Select the skills that best match your profile.",
          "You can also add custom skills separated by commas.",
          acknowledgement || "Nice, that will really strengthen your profile.",
          validationNoteFromErrors(errors),
        ),
        input: {
          options: suggestSkills(session),
          customPlaceholder: "Add custom skills (comma separated)",
          allowMultiple: true,
          selected: values.values ?? session.data.skills ?? [],
          errors,
        },
        step: STEP.SKILLS,
        replaceLast,
        session,
      });

    case STEP.EDUCATION: {
      const depth = session.data.personalization?.questionDepth || "normal";
      return buildResponse({
        type: "multi_field_input",
        markdown: introMarkdown(
          "Education",
          "Add your education details.",
          depth === "fast"
            ? "Add your key education entries. Keep only what is most relevant."
            : "You can add more than one entry if needed.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          fields: [
            {
              key: "qualification",
              label: "Qualification",
              type: "text",
              placeholder: "e.g. BBA",
              icon: "education",
            },
            {
              key: "endYear",
              label: "End year",
              type: "number",
              placeholder: "e.g. 2022",
              icon: "education",
            },
          ],
          repeatable: true,
          addLabel: "Add more education",
          submitLabel: "Confirm education",
          initialItems: values.items ?? session.data.education,
          errors,
        },
        step: STEP.EDUCATION,
        replaceLast,
        session,
      });
    }

    case STEP.CERTIFICATIONS:
      return buildResponse({
        type: "expandable_input",
        markdown: introMarkdown(
          "Certifications",
          "Do you have any certifications that support your profile?",
          "Choose from role-aware suggestions below or add your own.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          options: [
            { label: "Yes", value: "yes" },
            { label: "No", value: "no" },
          ],
          expandOn: "yes",
          fields: [
            {
              key: "name",
              label: "Certification name",
              type: "text",
              placeholder: "Enter certification",
            },
          ],
          suggestions:
            Array.isArray(session.data.certificationSuggestions) &&
            session.data.certificationSuggestions.length
              ? session.data.certificationSuggestions
              : fallbackCertificationSuggestions(session),
          addLabel: "Add more certifications",
          submitLabel: "Confirm certifications",
          initialOption:
            values.option ?? session.data.certificationOption ?? null,
          initialItems:
            values.items ??
            session.data.certifications?.map((name) => ({ name })),
          errors,
        },
        step: STEP.CERTIFICATIONS,
        replaceLast,
        session,
      });

    case STEP.CONTACT:
      return buildResponse({
        type: "multi_field_input",
        markdown: introMarkdown(
          "Contact Details",
          `Final step${shortName ? `, ${shortName}` : ""}. Add your contact details so they appear correctly on the resume.`,
          "Please enter valid details before generating the resume.",
          acknowledgement,
          validationNoteFromErrors(errors),
        ),
        input: {
          fields: [
            {
              key: "email",
              label: "Email",
              type: "email",
              placeholder: "name@example.com",
              icon: "user",
            },
            {
              key: "phone",
              label: "Phone number",
              type: "text",
              placeholder: "+1 555 123 4567",
              icon: "user",
            },
            {
              key: "city",
              label: "City",
              type: "text",
              placeholder: "Enter city",
              icon: "user",
            },
          ],
          submitLabel: "Generate resume",
          repeatable: false,
          initialItems: values.items ?? [
            {
              email: session.data.email ?? "",
              phone: session.data.phone ?? "",
              city: session.data.city ?? "",
            },
          ],
          errors,
        },
        step: STEP.CONTACT,
        replaceLast,
        session,
      });

    default:
      return buildResponse({
        type: "error",
        markdown: "Unable to continue. Please restart the chat.",
        step: session.step,
        replaceLast,
        session,
      });
  }
}

async function callAIForResumeJSON(session) {
  const d = session.data;
  const config = sectorConfig(session);
  const sectorLabel = session.data.customSector || config.label;
  const educationText = (d.education || [])
    .map(
      (entry) =>
        `${entry.qualification || entry.degree || ""} (${entry.endYear || entry.year || ""})`,
    )
    .join(", ");
  const refinedResponsibilities = (d.refinedResponsibilities || []).join("; ");
  const weightedSkills = (d.weightedSkills || d.skills || []).join(", ");
  const roleProfileText = d.roleProfile
    ? JSON.stringify({
        domain: d.roleProfile.domain,
        resumeTone: d.roleProfile.resumeTone,
        keywords: d.roleProfile.keywords,
      })
    : "None";

  const certificationsText = (d.certifications || [])
    .map((item) => (typeof item === "string" ? item : item?.name || ""))
    .filter(Boolean)
    .join(", ");

  const prompt = `You are an expert resume writer. Convert this data into polished resume JSON.

Tone:
- Professional
- Warm but concise
- ATS-friendly

Input:
Name: ${d.name}
Sector: ${sectorLabel}
Target Role: ${d.targetRole}
Experience Type: ${d.experienceType}
Years: ${d.yearsExperience || "0"}
Last Role: ${d.lastJobRole || d.internshipRole || ""}
Company: ${d.lastCompany || ""}
Duration: ${d.lastDuration || d.internshipDuration || ""}
Responsibilities: ${d.responsibilities}
Refined Responsibilities: ${refinedResponsibilities || "None"}
Parsed Summary: ${d.summary || ""}
Skills: ${(d.skills || []).join(", ")}
Weighted Skills: ${weightedSkills}
Education: ${educationText}
Certifications: ${certificationsText || "None"}
Email: ${d.email}
Phone: ${d.phone}
City: ${d.city}
Role Profile: ${roleProfileText}
Preferred resume emphasis: ${d.roleProfile?.resumeTone || TONE_BY_SECTOR[session.sector] || TONE_BY_SECTOR.custom}

Ensure experience bullets use action verb + task + outcome style.

STRICT TRUTHFULNESS RULES:
- Do NOT invent or assume any facts.
- Do NOT add fake companies, dates, tools, certifications, projects, metrics, or responsibilities.
- If a section has no input, return it empty ("" or []).
- Only rephrase and structure what is provided.

Return valid JSON:
{
  "name": "",
  "phone": "",
  "email": "",
  "location": "",
  "target_role": "",
  "summary": "",
  "experience": [{ "job_title": "", "company": "", "duration": "", "responsibilities": ["", ""] }],
  "skills": ["", ""],
  "education": [{ "degree": "", "institution": "", "year": "" }],
  "certifications": [],
  "languages": []
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0].message.content);
}

function fallbackResume(session) {
  const d = session.data;
  const config = sectorConfig(session);
  const topSkills = (d.weightedSkills || d.skills || []).slice(0, 3);
  const resumeTone =
    d.roleProfile?.resumeTone ||
    TONE_BY_SECTOR[session.sector] ||
    TONE_BY_SECTOR.custom;
  const refinedResponsibilities = d.refinedResponsibilities?.length
    ? d.refinedResponsibilities
    : String(d.responsibilities || "")
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
  return {
    name: d.name,
    phone: d.phone,
    email: d.email,
    location: d.city,
    target_role: d.targetRole,
    summary: `${d.targetRole} profile in ${d.customSector || config.label} with strengths in ${topSkills.join(", ") || "core role skills"}, focused on ${resumeTone}.`,
    experience: [
      {
        job_title: d.lastJobRole || d.internshipRole || d.targetRole,
        company: d.lastCompany || "Not specified",
        duration: d.lastDuration || d.internshipDuration || "Not specified",
        responsibilities: refinedResponsibilities,
      },
    ],
    skills: d.skills || [],
    education: (d.education || []).map((entry) => ({
      degree: entry.qualification || entry.degree || "",
      institution: entry.institution || "",
      year: String(entry.endYear || entry.year || ""),
    })),
    certifications: (d.certifications || [])
      .map((item) => (typeof item === "string" ? item : item?.name || ""))
      .filter(Boolean),
    languages: [],
  };
}

async function handleGeneration(session) {
  try {
    let resumeJson;
    try {
      resumeJson = await callAIForResumeJSON(session);
    } catch {
      resumeJson = fallbackResume(session);
    }

    session.resumeJson = resumeJson;
    const { html, pdfUrl } = await generateResumePackage(resumeJson, {
      enforceSectionPresence: session.mode === "edit",
    });
    session.resumeHtml = html;
    session.pdfUrl = pdfUrl;
    const { viewUrl, downloadUrl } = buildPdfAccessLinks(
      pdfUrl,
      session.data.name,
    );
    session.step = STEP.GENERATE + 1;

    return buildResponse({
      type: "pdf",
      markdown: `## Resume Ready\n\n${nameOf(session)}, your resume is ready.\n\n- Review it carefully\n- Download the PDF\n- Use it as your base version for applications`,
      pdfUrl: viewUrl,
      pdfDownloadUrl: downloadUrl,
      step: STEP.GENERATE,
      isFinal: true,
      session,
    });
  } catch (err) {
    console.error("[ChatbotFlow] Generation error:", err);
    return buildResponse({
      type: "error",
      markdown:
        "We could not generate your resume right now. Please try again.",
      step: STEP.GENERATE,
      session,
    });
  }
}

function normalizeSectorSelection(session, rawValue) {
  const text = String(rawValue || "").trim();
  if (text.length < 2) return { error: "Please enter a sector name." };
  const normalized = normalizeSector(text);
  if (normalized) {
    return { sector: normalized, customSector: null };
  }
  return { sector: "custom", customSector: text };
}

function validatePhone(phone) {
  const digits = (String(phone || "").match(PHONE_DIGIT_RE) || []).join("");
  return digits.length >= 7 && digits.length <= 15;
}

function mapLinkedInToSessionData(session, linkedInData) {
  const data = linkedInData || {};

  if (data.name) session.data.name = data.name;
  if (data.email) session.data.email = String(data.email).trim();
  if (data.phone != null) session.data.phone = String(data.phone).trim();
  if (data.city) session.data.city = String(data.city).trim();
  if (data.location) {
    session.data.location = data.location;
    session.data.city = data.location;
  }

  if (Array.isArray(data.skills) && data.skills.length) {
    session.data.skills = [
      ...new Set(
        data.skills.map((item) => String(item).trim()).filter(Boolean),
      ),
    ];
    computeWeightedSkills(session);
  }

  if (Array.isArray(data.education) && data.education.length) {
    session.data.education = data.education
      .map((item) => ({
        qualification: String(item.qualification || "").trim(),
        endYear: String(item.endYear || "").trim(),
        institution: String(item.institution || "").trim(),
      }))
      .filter(
        (entry) => entry.qualification || entry.endYear || entry.institution,
      );
  }

  if (Array.isArray(data.certifications) && data.certifications.length) {
    session.data.certifications = data.certifications
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    session.data.certificationOption = session.data.certifications.length
      ? "yes"
      : "no";
  }

  if (data.targetRole || data.headline) {
    session.data.targetRole = String(
      data.targetRole || data.headline || "",
    ).trim();
  }

  if (data.lastJobRole)
    session.data.lastJobRole = String(data.lastJobRole).trim();
  if (data.lastCompany)
    session.data.lastCompany = String(data.lastCompany).trim();
  if (data.lastDuration)
    session.data.lastDuration = String(data.lastDuration).trim();

  if (data.responsibilities) {
    session.data.responsibilities = String(data.responsibilities).trim();
    session.data.refinedResponsibilities = refineResponsibilityBullets(
      session.data.responsibilities,
      session,
    );
  }

  if (
    data.experienceType === "experienced" ||
    data.experienceType === "fresher"
  ) {
    session.data.experienceType = data.experienceType;
  }

  if (data.yearsExperience != null) {
    const years = String(data.yearsExperience).trim();
    if (years) session.data.yearsExperience = years;
  }

  if (data.industry) {
    const normalizedSector = normalizeSector(data.industry);
    if (normalizedSector) {
      session.sector = normalizedSector;
      session.data.sector = normalizedSector;
      session.data.customSector = null;
    } else {
      session.sector = "custom";
      session.data.sector = "custom";
      session.data.customSector = data.industry;
    }
  }

  session.data.linkedin = {
    imported: true,
    identifier: data.identifier || null,
    importedAt: new Date().toISOString(),
    profileUrl: data.sourceProfileUrl || null,
  };
}

async function processMessage(session, rawMessage) {
  const payload = parsePayload(rawMessage);

  // ──── STEP.MODE: Choose create or edit ────────────────────────────────
  if (session.step === STEP.MODE) {
    const mode = String(payload.option || payload.value || "").toLowerCase();
    if (!["create", "linkedin"].includes(mode)) {
      return buildStepResponse(session, {
        replaceLast: true,
        errors: {
          general: "Please choose manual creation or LinkedIn import.",
        },
      });
    }

    session.mode = mode;
    pushSnapshot(session);

    if (mode === "create") {
      // Move to NAME step for creating new resume
      session.step = STEP.NAME;
      return buildStepResponse(session, {
        acknowledgement: "Great! Let's build your resume from scratch.",
      });
    } else {
      // Move to LinkedIn URL input step
      session.step = STEP.LINKEDIN_URL;
      return buildStepResponse(session, {
        acknowledgement:
          "Perfect. Paste your LinkedIn profile URL and I'll prefill your resume.",
      });
    }
  }

  // ──── STEP.LINKEDIN_URL: Import and prefill from LinkedIn ──────────────
  if (session.step === STEP.LINKEDIN_URL) {
    const linkedInUrl = String(payload.value || "").trim();
    if (!linkedInUrl) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: linkedInUrl },
        errors: { value: "Please paste your LinkedIn profile URL." },
      });
    }

    const imported = await importLinkedInProfile(linkedInUrl);
    if (!imported.ok) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: linkedInUrl },
        errors: {
          value:
            imported.error ||
            "Could not import LinkedIn profile. Please continue manually.",
        },
      });
    }

    mapLinkedInToSessionData(session, {
      ...imported.normalized,
      identifier: imported.identifier,
      sourceProfileUrl: linkedInUrl,
    });

    if (session.sector === "custom" || session.data.targetRole) {
      session.data.roleProfile = await inferRoleProfile(session, {
        customSector: session.data.customSector,
        targetRole: session.data.targetRole,
      });
    }

    pushSnapshot(session);
    session.step = STEP.NAME;
    return buildStepResponse(session, {
      replaceLast: true,
      acknowledgement: imported.isPartial
        ? "Mock LinkedIn profile fetched. We imported what was available, and you can now complete missing fields step by step."
        : "Mock LinkedIn profile fetched successfully. Your details are prefilled and you can now review and edit them.",
    });
  }

  if (payload.action === "back") {
    const restored = restorePreviousSnapshot(session);
    if (!restored) {
      return buildStepResponse(session, {
        replaceLast: true,
        errors: { general: "You are already at the first step." },
      });
    }
    return buildStepResponse(session, {
      acknowledgement: "You can edit the previous step below.",
      replaceLast: false,
    });
  }

  if (session.step === STEP.NAME) {
    const name = String(payload.value || "").trim();
    if (name.length < 2) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: name },
        errors: {
          name: "That does not look complete. Please enter your full name.",
        },
      });
    }
    session.data.name = name;
    upsertPersonalization(session, { tonePreference: "balanced" });
    pushSnapshot(session);
    session.step = STEP.SECTOR;
    return buildStepResponse(session, {
      acknowledgement: `Thanks, ${firstNameOf(session)}. Let's move ahead.`,
    });
  }

  if (session.step === STEP.SECTOR) {
    const selection = payload.value || payload.option || "";
    const result = normalizeSectorSelection(session, selection);
    if (result.error) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: selection },
        errors: { sector: "Please select a sector or enter a custom one." },
      });
    }
    session.sector = result.sector;
    session.data.sector = result.sector;
    session.data.customSector = result.customSector;
    if (result.customSector) {
      session.data.roleProfile = await inferRoleProfile(session, {
        customSector: result.customSector,
      });
    } else {
      session.data.roleProfile = null;
    }
    pushSnapshot(session);
    session.step = STEP.ROLE;
    return buildStepResponse(session, {
      acknowledgement: result.customSector
        ? `Great. I mapped ${result.customSector} to a relevant profile so we can personalize your resume.`
        : pickAcknowledgement(session, "sector", [
            "Great, that helps.",
            "Perfect. That gives us a clear direction.",
            "Good choice. We can tailor the resume better now.",
          ]),
    });
  }

  if (session.step === STEP.ROLE) {
    const role = String(payload.value || "").trim();
    if (role.length < 2) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: role },
        errors: { role: "Please select a role or enter a custom role." },
      });
    }
    session.data.targetRole = role;
    const predefinedRoles = (sectorConfig(session).roles || []).map((item) =>
      String(item).toLowerCase(),
    );
    const isCustomRole = !predefinedRoles.includes(role.toLowerCase());

    if (session.sector === "custom" || isCustomRole) {
      session.data.roleProfile = await inferRoleProfile(session, {
        customSector: session.data.customSector,
        targetRole: role,
      });
    }

    pushSnapshot(session);
    session.step = STEP.EXPERIENCE_TYPE;
    return buildStepResponse(session, {
      acknowledgement: pickAcknowledgement(session, "role", [
        `Nice${firstNameOf(session) ? `, ${firstNameOf(session)}` : ""}. ${role} is a clear target role for your profile.`,
        `Great. ${role} is a strong role target.`,
        `Perfect, ${role} gives us the right resume direction.`,
      ]),
    });
  }

  if (session.step === STEP.EXPERIENCE_TYPE) {
    const option = String(payload.option || payload.value || "").toLowerCase();
    const errors = {};
    if (!["fresher", "experienced"].includes(option)) {
      errors.option = "Please choose Fresher or Experienced.";
    }
    if (option === "experienced") {
      const years = Number(payload.yearsExperience);
      if (Number.isNaN(years) || years < 0 || years > 50) {
        errors.yearsExperience =
          "Please enter valid years of experience between 0 and 50.";
      }
    }
    if (Object.keys(errors).length) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: payload,
        errors,
      });
    }
    session.data.experienceType = option;
    session.data.yearsExperience =
      option === "experienced" ? String(Number(payload.yearsExperience)) : "0";
    upsertPersonalization(session, {
      tonePreference: option === "experienced" ? "concise" : "guided",
    });
    pushSnapshot(session);
    session.step = STEP.WORK_DETAILS;
    return buildStepResponse(session, {
      acknowledgement:
        option === "experienced"
          ? pickAcknowledgement(session, "experience", [
              "That is strong experience to build on.",
              "Great, this experience depth helps position your profile.",
            ])
          : pickAcknowledgement(session, "experience", [
              "A fresher profile can still be very strong with the right positioning.",
              "Great start. We will highlight your potential with practical strengths.",
            ]),
    });
  }

  if (session.step === STEP.WORK_DETAILS) {
    if (session.data.experienceType === "fresher") {
      const option = String(payload.option || "").toLowerCase();
      const errors = {};
      if (!["yes", "no"].includes(option))
        errors.option = "Please choose Yes or No.";
      if (option === "yes") {
        if (!String(payload.internshipRole || "").trim())
          errors.internshipRole = "Please enter the internship role.";
        if (!String(payload.internshipDuration || "").trim())
          errors.internshipDuration = "Please enter the internship duration.";
      }
      if (Object.keys(errors).length) {
        return buildStepResponse(session, {
          replaceLast: true,
          values: payload,
          errors,
        });
      }
      session.data.hasInternship = option === "yes";
      session.data.internshipRole =
        option === "yes" ? String(payload.internshipRole || "").trim() : null;
      session.data.internshipDuration =
        option === "yes"
          ? String(payload.internshipDuration || "").trim()
          : null;
      pushSnapshot(session);
      session.step = STEP.RESPONSIBILITIES;
      return buildStepResponse(session, {
        acknowledgement:
          option === "yes"
            ? pickAcknowledgement(session, "internship", [
                "That internship experience is valuable for your resume.",
                "Great. This gives us useful practical evidence.",
              ])
            : pickAcknowledgement(session, "internship", [
                "No problem. Projects and training can still make your profile strong.",
                "That is fine. We will build your profile around relevant practical exposure.",
              ]),
      });
    }

    const item = Array.isArray(payload.items) ? payload.items[0] : null;
    const errors = {};
    if (!item) {
      errors.general = "Please enter your last role, company, and duration.";
    } else {
      if (!String(item.lastJobRole || "").trim())
        errors.lastJobRole = "Please enter your last job role.";
      if (!String(item.lastCompany || "").trim())
        errors.lastCompany = "Please enter the company name.";
      if (!String(item.lastDuration || "").trim())
        errors.lastDuration = "Please enter the duration.";
    }
    if (Object.keys(errors).length) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { items: item ? [item] : [] },
        errors,
      });
    }
    session.data.lastJobRole = String(item.lastJobRole).trim();
    session.data.lastCompany = String(item.lastCompany).trim();
    session.data.lastDuration = String(item.lastDuration).trim();
    pushSnapshot(session);
    session.step = STEP.RESPONSIBILITIES;
    return buildStepResponse(session, {
      acknowledgement: pickAcknowledgement(session, "work-details", [
        "That is strong practical experience.",
        "Great, this gives us a clear professional context.",
      ]),
    });
  }

  if (session.step === STEP.RESPONSIBILITIES) {
    const text = String(payload.value || "").trim();
    if (text.length < 12) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: text },
        errors: {
          value:
            session.data.experienceType === "fresher" &&
            session.data.hasInternship === false
              ? "Please add more detail about projects, training, or activities where you built relevant skills."
              : "Please add more detail about your responsibilities in your last internship or job.",
        },
      });
    }
    setQuestionDepth(session, text);
    session.data.responsibilities = text;
    session.data.refinedResponsibilities = refineResponsibilityBullets(
      text,
      session,
    );
    pushSnapshot(session);
    session.step = STEP.SKILLS;
    return buildStepResponse(session, {
      acknowledgement: pickAcknowledgement(session, "responsibilities", [
        "That's strong role context.",
        "Great detail. This will improve your resume quality.",
        "Hands-on work like this is valuable in your field.",
      ]),
    });
  }

  if (session.step === STEP.SKILLS) {
    const values = Array.isArray(payload.values)
      ? payload.values
      : String(payload.value || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
    if (!values.length) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { values: [] },
        errors: {
          values: "Please select at least one skill or add a custom skill.",
        },
      });
    }
    session.data.skills = [...new Set(values)];
    computeWeightedSkills(session);
    pushSnapshot(session);
    session.step = STEP.EDUCATION;
    return buildStepResponse(session, {
      acknowledgement: pickAcknowledgement(session, "skills", [
        "Strong skills selection. That adds clarity to your profile.",
        "Great set of skills. This improves profile relevance.",
      ]),
    });
  }

  if (session.step === STEP.EDUCATION) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const errors = {};
    if (!items.length) {
      errors.general = "Please add at least one education entry.";
    }
    const normalized = [];
    items.forEach((item, index) => {
      const qualification = String(item.qualification || "").trim();
      const endYear = String(item.endYear || "").trim();
      if (!qualification)
        errors[`qualification-${index}`] =
          `Education item ${index + 1}: qualification is required.`;
      if (!/^\d{4}$/.test(endYear))
        errors[`endYear-${index}`] =
          `Education item ${index + 1}: enter a valid 4-digit end year.`;
      normalized.push({ qualification, endYear });
    });
    if (Object.keys(errors).length) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { items },
        errors,
      });
    }
    session.data.education = normalized;
    session.data.certificationSuggestions =
      await inferCertificationSuggestions(session);
    pushSnapshot(session);
    session.step = STEP.CERTIFICATIONS;
    return buildStepResponse(session, {
      acknowledgement:
        "Good. That education history gives your resume useful structure.",
    });
  }

  if (session.step === STEP.CERTIFICATIONS) {
    const option = String(payload.option || "").toLowerCase();
    const errors = {};
    if (!["yes", "no"].includes(option))
      errors.option = "Please choose Yes or No.";
    const items = Array.isArray(payload.items) ? payload.items : [];
    const certs = items
      .map((item) => String(item.name || "").trim())
      .filter(Boolean);
    if (option === "yes" && !certs.length)
      errors.name = "Please add at least one certification name or choose No.";
    if (Object.keys(errors).length) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { option, items },
        errors,
      });
    }
    session.data.certificationOption = option;
    session.data.certifications = option === "yes" ? certs : [];
    pushSnapshot(session);
    session.step = STEP.CONTACT;
    return buildStepResponse(session, {
      acknowledgement:
        option === "yes"
          ? "Great. Certifications add additional credibility to your profile."
          : "That is fine. We can still keep the resume strong without certifications.",
    });
  }

  if (session.step === STEP.CONTACT) {
    const item = Array.isArray(payload.items) ? payload.items[0] : null;
    const errors = {};
    const currentValues = item ? { items: [item] } : { items: [] };
    if (!item) {
      errors.general = "Please enter valid details.";
      return buildStepResponse(session, {
        replaceLast: true,
        values: currentValues,
        errors,
      });
    }

    const email = String(item.email || "").trim();
    const phone = String(item.phone || "").trim();
    const city = String(item.city || "").trim();

    if (!EMAIL_RE.test(email))
      errors.email =
        "That does not look quite right. Could you enter a valid email address?";
    if (!validatePhone(phone))
      errors.phone =
        "Please enter a valid phone number using digits and a reasonable length.";
    if (!CITY_RE.test(city)) errors.city = "Please enter a valid city name.";

    if (Object.keys(errors).length) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: currentValues,
        errors,
      });
    }

    session.data.email = email;
    session.data.phone = phone;
    session.data.city = city;
    session.data.location = city;
    pushSnapshot(session);
    session.step = STEP.GENERATE;
    return handleGeneration(session);
  }

  return buildResponse({
    type: "error",
    markdown: "Session state is invalid. Please restart the chat.",
    step: session.step,
    session,
  });
}

module.exports = { getWelcomeMessage, processMessage };
