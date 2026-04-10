const openai = require("../config/openai");
const { getSignedUrl } = require("./s3Service");
const { generateJDPackage } = require("./jdPDFService");
const {
  pushSnapshot,
  restorePreviousSnapshot,
} = require("./jdChatbotSessionService");

const STEP = {
  JOB_TITLE: 1,
  COMPANY_NAME: 2,
  INDUSTRY_TYPE: 3,
  YOE: 4,
  BENEFITS: 5,
  GENERATE: 6,
};

const PROGRESS_MAP = {
  1: "1/5",
  2: "2/5",
  3: "3/5",
  4: "4/5",
  5: "5/5",
  6: null,
};

const JOB_TITLE_OPTIONS = [
  "Front Desk Executive",
  "Waiter",
  "Cabin Crew",
  "Sales Associate",
  "Developer",
];

const INDUSTRY_OPTIONS = [
  "Hospitality",
  "Aviation",
  "Retail",
  "IT",
  "Healthcare",
  "Manufacturing",
  "Logistics",
  "Education",
];

const BENEFIT_OPTIONS = [
  "Health Insurance",
  "Paid Leave",
  "Flexible Hours",
  "Bonuses",
  "Learning & Development",
];

const YOE_OPTIONS = [
  { label: "0-1", value: "0-1" },
  { label: "1-3", value: "1-3" },
  { label: "3-5", value: "3-5" },
  { label: "5+", value: "5+" },
  { label: "Other", value: "other" },
];

function sanitizePdfFilename(jobTitle) {
  const cleaned = String(jobTitle || "job-description")
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);

  return `${cleaned || "job-description"}.pdf`;
}

function parsePayload(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw || "").trim();
  if (!text) return {};

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      return JSON.parse(text);
    } catch {
      return { value: text };
    }
  }

  return { value: text };
}

function normalizeYoeLabel(value) {
  const text = String(value || "").trim();
  if (["0-1", "1-3", "3-5", "5+"].includes(text)) return text;

  const asNumber = Number(text);
  if (Number.isNaN(asNumber) || asNumber < 0 || asNumber > 50) return null;

  if (asNumber <= 1) return "0-1";
  if (asNumber <= 3) return "1-3";
  if (asNumber <= 5) return "3-5";
  return "5+";
}

function buildResponse({
  type,
  markdown,
  input,
  step,
  session,
  pdfUrl,
  html,
  replaceLast = false,
  isFinal = false,
}) {
  return {
    type,
    markdown,
    ...(input && { input }),
    ...(html && { html }),
    ...(pdfUrl && { pdfUrl }),
    ...(pdfUrl && { pdfFilename: "Job-Description.pdf" }),
    meta: {
      step,
      progress: PROGRESS_MAP[step] || null,
      isFinal,
      canGoBack: Boolean(session?.snapshots?.length),
      replaceLast,
    },
  };
}

function validationBlock(errors) {
  const list = Object.values(errors || {}).filter(Boolean);
  if (!list.length) return "";
  return `\n\nPlease update the input:\n${list.map((item) => `- ${item}`).join("\n")}`;
}

function getWelcomeMessage() {
  return buildStepResponse({ step: STEP.JOB_TITLE, data: {}, snapshots: [] });
}

function buildStepResponse(session, extras = {}) {
  const { errors = {}, values = {}, replaceLast = false } = extras;

  switch (session.step) {
    case STEP.JOB_TITLE:
      return buildResponse({
        type: "chip_select_with_custom",
        markdown:
          "## AI Job Description Generator\n\nI will collect 5 quick inputs and generate a polished, ATS-friendly Job Description in PDF format.\n\nChoose a job title to begin." +
          validationBlock(errors),
        input: {
          options: JOB_TITLE_OPTIONS,
          customPlaceholder: "Enter custom job title",
          allowMultiple: false,
          initialValue: values.value ?? session.data.jobTitle ?? "",
          selected: values.value ? [values.value] : [],
          errors,
        },
        step: STEP.JOB_TITLE,
        replaceLast,
        session,
      });

    case STEP.COMPANY_NAME:
      return buildResponse({
        type: "input",
        markdown:
          "## Company Name\n\nEnter the company name for this Job Description." +
          validationBlock(errors),
        input: {
          type: "text",
          placeholder: "Enter company name",
          initialValue: values.value ?? session.data.companyName ?? "",
          errors,
        },
        step: STEP.COMPANY_NAME,
        replaceLast,
        session,
      });

    case STEP.INDUSTRY_TYPE:
      return buildResponse({
        type: "chip_select_with_custom",
        markdown:
          "## Industry Type\n\nChoose the relevant industry to personalize role tone and responsibilities." +
          validationBlock(errors),
        input: {
          options: INDUSTRY_OPTIONS,
          customPlaceholder: "Enter industry type",
          allowMultiple: false,
          initialValue: values.value ?? session.data.industryType ?? "",
          selected: values.value ? [values.value] : [],
          errors,
        },
        step: STEP.INDUSTRY_TYPE,
        replaceLast,
        session,
      });

    case STEP.YOE:
      return buildResponse({
        type: "dynamic_input",
        markdown:
          "## Years of Experience\n\nPick an experience band or choose Other to enter a numeric value." +
          validationBlock(errors),
        input: {
          options: YOE_OPTIONS,
          conditional: {
            other: {
              fields: [
                {
                  key: "yoeNumeric",
                  label: "Years of experience",
                  type: "number",
                  placeholder: "Enter years (e.g. 2)",
                  min: 0,
                  max: 50,
                },
              ],
              submitLabel: "Confirm",
            },
          },
          selectedOption: values.option ?? session.data.yoe ?? null,
          initialValues: {
            yoeNumeric: values.yoeNumeric ?? "",
          },
          errors,
        },
        step: STEP.YOE,
        replaceLast,
        session,
      });

    case STEP.BENEFITS:
      return buildResponse({
        type: "chip_select_with_custom",
        markdown:
          "## Benefits\n\nSelect one or more benefits. You can add custom benefits with Other." +
          validationBlock(errors),
        input: {
          options: BENEFIT_OPTIONS,
          customPlaceholder: "Add custom benefits (comma separated)",
          allowMultiple: true,
          selected: values.values ?? session.data.benefits ?? [],
          errors,
        },
        step: STEP.BENEFITS,
        replaceLast,
        session,
      });

    default:
      return buildResponse({
        type: "error",
        markdown: "Unable to continue. Please restart the JD assistant.",
        step: session.step,
        session,
      });
  }
}

async function callAIForJD(session) {
  const d = session.data;

  const systemPrompt = `You are a professional HR specialist and job description writer.

Your job is to generate high-quality, engaging, and ATS-friendly job descriptions based on minimal input.

Tone:
- Professional
- Engaging
- Clear and structured
- No emojis

Rules:
- Expand input intelligently without fabricating unrealistic requirements.
- Tailor content based on job title, industry, and experience level.
- Use sections: About the Role, Key Objectives, Responsibilities, Requirements, Preferred Qualifications, Benefits.
- Junior roles should emphasize learning and support.
- Senior roles should emphasize ownership and leadership.
- Infer role type from the job title and adapt responsibilities and skills.
- Do not invent fake company facts.

Return strict JSON with keys:
jobTitle, companyName, industryType, aboutRole (2-3 short paragraphs), keyObjectives (4-5 bullets), responsibilities (6-8 bullets), requirements (6-10 bullets), preferredQualifications (3-5 bullets), benefits (4-8 bullets).`;

  const userPrompt = `Generate Job Description content using the following details:

Job Title: ${d.jobTitle}
Company Name: ${d.companyName}
Industry Type: ${d.industryType}
Years of Experience: ${d.yoe}
Benefits Input: ${(d.benefits || []).join(", ") || "Not provided"}

If user benefits are empty, provide practical standard benefits.
Keep content ATS-safe and concise.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.25,
    max_tokens: 1600,
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0].message.content);
}

function fallbackJD(session) {
  const { jobTitle, companyName, industryType, yoeLabel, benefits } =
    session.data;

  const isJunior = yoeLabel === "0-1" || yoeLabel === "1-3";

  return {
    jobTitle,
    companyName,
    industryType,
    aboutRole: [
      `${companyName} is looking for a ${jobTitle} to support high-quality execution across key ${industryType} workflows. The role requires strong communication, accountability, and reliable delivery.`,
      isJunior
        ? "This role is designed for professionals who are building practical exposure and can grow quickly with structured guidance, clear goals, and cross-functional collaboration."
        : "This role is designed for professionals who can independently drive outcomes, improve process quality, and collaborate across teams to deliver measurable impact.",
    ],
    keyObjectives: [
      "Deliver role-specific outcomes aligned with business goals and service quality standards.",
      "Maintain consistency, compliance, and operational reliability in day-to-day execution.",
      "Collaborate effectively with internal and external stakeholders.",
      "Contribute to continuous process improvement and performance optimization.",
      "Support a professional and accountable work culture.",
    ],
    responsibilities: [
      `Execute core ${jobTitle} responsibilities with accuracy and ownership.`,
      "Coordinate with cross-functional teams to maintain smooth workflow delivery.",
      "Track, report, and resolve task-level issues in a timely and structured manner.",
      "Ensure process adherence, quality standards, and documentation hygiene.",
      "Communicate updates, blockers, and action plans clearly to relevant stakeholders.",
      "Contribute ideas to improve efficiency and service outcomes.",
    ],
    requirements: [
      `${yoeLabel} years of relevant experience in ${industryType} or similar domain.`,
      "Strong communication and interpersonal collaboration skills.",
      "Ability to work in structured environments with high accountability.",
      "Solid problem-solving approach and attention to detail.",
      "Comfort with process documentation and standard operating procedures.",
      isJunior
        ? "Learning mindset with the ability to absorb feedback and adapt quickly."
        : "Demonstrated ownership mindset with ability to drive independent execution.",
    ],
    preferredQualifications: [
      "Exposure to role-relevant tools and operational workflows.",
      "Experience working in fast-paced and customer-sensitive environments.",
      "Ability to prioritize tasks effectively across competing requirements.",
    ],
    benefits: (benefits || []).length
      ? benefits
      : [
          "Health Insurance",
          "Paid Leave",
          "Flexible Hours",
          "Learning & Development support",
        ],
  };
}

async function handleGeneration(session) {
  try {
    let jd;
    try {
      jd = await callAIForJD(session);
    } catch {
      jd = fallbackJD(session);
    }

    const output = await generateJDPackage({
      ...jd,
      jobTitle: session.data.jobTitle,
      companyName: session.data.companyName,
      industryType: session.data.industryType,
      benefits: jd.benefits?.length ? jd.benefits : session.data.benefits,
    });

    session.jdMarkdown = output.markdown;
    session.jdHtml = output.html;
    session.pdfUrl = output.pdfUrl;
    session.step = STEP.GENERATE + 1;

    const viewUrl = getSignedUrl(output.pdfUrl, 3600) || output.pdfUrl;
    const downloadUrl =
      getSignedUrl(output.pdfUrl, 3600, {
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: `attachment; filename=\"${sanitizePdfFilename(
          session.data.jobTitle,
        )}\"`,
      }) || viewUrl;

    return {
      type: "jd_pdf",
      markdown: "Here is the final job description.",
      html: output.html,
      pdfUrl: viewUrl,
      pdfDownloadUrl: downloadUrl,
      pdfFilename: "Job-Description.pdf",
      meta: {
        step: STEP.GENERATE,
        progress: null,
        isFinal: true,
        canGoBack: true,
        replaceLast: false,
      },
    };
  } catch (error) {
    console.error("[JDChatbotFlow] Generation error:", error);
    return buildResponse({
      type: "error",
      markdown:
        "We could not generate the Job Description right now. Please try again.",
      step: STEP.GENERATE,
      session,
    });
  }
}

async function processMessage(session, rawMessage) {
  const payload = parsePayload(rawMessage);

  if (payload.action === "back") {
    const restored = restorePreviousSnapshot(session);
    if (!restored) {
      return buildStepResponse(session, {
        replaceLast: true,
        errors: { general: "You are already at the first step." },
      });
    }
    return buildStepResponse(session);
  }

  if (session.step === STEP.JOB_TITLE) {
    const jobTitle = String(payload.value || "").trim();
    if (jobTitle.length < 2) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: jobTitle },
        errors: { jobTitle: "Please choose or enter a valid job title." },
      });
    }

    session.data.jobTitle = jobTitle;
    pushSnapshot(session);
    session.step = STEP.COMPANY_NAME;
    return buildStepResponse(session);
  }

  if (session.step === STEP.COMPANY_NAME) {
    const companyName = String(payload.value || "").trim();
    if (companyName.length < 2) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: companyName },
        errors: { companyName: "Please enter a valid company name." },
      });
    }

    session.data.companyName = companyName;
    pushSnapshot(session);
    session.step = STEP.INDUSTRY_TYPE;
    return buildStepResponse(session);
  }

  if (session.step === STEP.INDUSTRY_TYPE) {
    const industryType = String(payload.value || "").trim();
    if (industryType.length < 2) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: { value: industryType },
        errors: { industryType: "Please choose or enter a valid industry." },
      });
    }

    session.data.industryType = industryType;
    pushSnapshot(session);
    session.step = STEP.YOE;
    return buildStepResponse(session);
  }

  if (session.step === STEP.YOE) {
    const option = String(payload.option || payload.value || "").trim();
    let yoe = option;

    if (option === "other") {
      yoe = String(payload.yoeNumeric || "").trim();
    }

    const yoeLabel = normalizeYoeLabel(yoe);
    if (!yoeLabel) {
      return buildStepResponse(session, {
        replaceLast: true,
        values: payload,
        errors: {
          yoe: "Please select a valid experience range or enter years between 0 and 50.",
        },
      });
    }

    session.data.yoe = option === "other" ? `${yoe} years` : option;
    session.data.yoeLabel = yoeLabel;
    pushSnapshot(session);
    session.step = STEP.BENEFITS;
    return buildStepResponse(session);
  }

  if (session.step === STEP.BENEFITS) {
    const values = Array.isArray(payload.values)
      ? payload.values
      : String(payload.value || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);

    session.data.benefits = [...new Set(values)];
    pushSnapshot(session);
    session.step = STEP.GENERATE;
    return handleGeneration(session);
  }

  return buildResponse({
    type: "error",
    markdown: "Session state is invalid. Please restart the JD assistant.",
    step: session.step,
    session,
  });
}

module.exports = {
  getWelcomeMessage,
  processMessage,
};
