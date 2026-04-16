const PDFDocument = require("pdfkit");
const { uploadResume } = require("./s3Service");

const PAGE = {
  width: 595.28,
  height: 841.89,
};

const TARGET_FILL_MIN = 0.7;
const TARGET_FILL_MAX = 0.92;

const LAYOUT_PROFILES = [
  {
    id: "spacious",
    margins: { top: 42, right: 38, bottom: 40, left: 38 },
    headerGap: 12,
    nameSize: 30,
    roleSize: 13,
    contactSize: 10.8,
    headingSize: 11.6,
    bodySize: 10.9,
    metaSize: 9.8,
    sectionGap: 15,
    itemGap: 10,
    bulletGap: 5,
    lineGap: 3,
  },
  {
    id: "airy",
    margins: { top: 40, right: 36, bottom: 38, left: 36 },
    headerGap: 10,
    nameSize: 27,
    roleSize: 12.4,
    contactSize: 10.4,
    headingSize: 11.2,
    bodySize: 10.5,
    metaSize: 9.5,
    sectionGap: 13,
    itemGap: 8,
    bulletGap: 4,
    lineGap: 2,
  },
  {
    id: "balanced",
    margins: { top: 36, right: 34, bottom: 34, left: 34 },
    headerGap: 9,
    nameSize: 24,
    roleSize: 11.8,
    contactSize: 10,
    headingSize: 10.8,
    bodySize: 10,
    metaSize: 9.2,
    sectionGap: 11,
    itemGap: 7,
    bulletGap: 3,
    lineGap: 1.5,
  },
  {
    id: "compact",
    margins: { top: 30, right: 30, bottom: 30, left: 30 },
    headerGap: 7,
    nameSize: 21,
    roleSize: 11.2,
    contactSize: 9.4,
    headingSize: 10.2,
    bodySize: 9.4,
    metaSize: 8.8,
    sectionGap: 9,
    itemGap: 5,
    bulletGap: 2,
    lineGap: 1,
  },
];

function getOpenAIClient() {
  try {
    return require("../config/openai");
  } catch {
    return null;
  }
}

function safeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .trim();
}

function toList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function trimPunctuation(value) {
  return String(value || "")
    .trim()
    .replace(/[\s,;:.-]+$/, "");
}

function sentenceCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text[0].toUpperCase() + text.slice(1);
}

function ensureSentence(value) {
  const text = sentenceCase(trimPunctuation(value));
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function dedupe(values) {
  const seen = new Set();
  const result = [];
  for (const item of values) {
    const text = String(item || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function isNA(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  return (
    !text ||
    text === "n/a" ||
    text === "na" ||
    text === "not applicable" ||
    text === "unknown" ||
    text === "none" ||
    text === "tbd" ||
    text === "null" ||
    text === "undefined" ||
    text === "-" ||
    text === "–"
  );
}

function sanitizeField(value) {
  const text = String(value || "").trim();
  return isNA(text) ? "" : text;
}

function sanitizePlaceholder(value) {
  const text = sanitizeField(value);
  if (!text) return "";
  const placeholders = new Set([
    "university name",
    "company name",
    "school name",
    "college name",
    "institution name",
    "organization name",
    "employer name",
    "your university",
    "your company",
    "your school",
  ]);
  return placeholders.has(text.toLowerCase()) ? "" : text;
}

function sanitizeDuration(value) {
  const text = sanitizeField(value);
  if (!text) return "";
  if (/^0\s*(year|month|yr|mo)s?$/i.test(text)) return "";
  return text;
}

function extractEndYear(value) {
  const text = sanitizeField(value);
  if (!text) return "";
  // If it's a range like "2020-2022" or "2020 – 2022", keep only the end
  const rangeMatch = text.match(/\d{4}\s*[-–\/]\s*(\d{4}|present|current)/i);
  if (rangeMatch) return rangeMatch[1];
  // Just a single year
  const single = text.match(/\d{4}/);
  if (single) return single[0];
  return text;
}

function normalizeBullet(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (
    /^(Assisted|Supported|Handled|Managed|Coordinated|Maintained|Delivered|Resolved|Improved|Facilitated|Executed|Led)\b/i.test(
      text,
    )
  ) {
    return ensureSentence(text);
  }
  return ensureSentence(`Assisted with ${text.toLowerCase()}`);
}

function normalizeEducationEntry(entry) {
  if (typeof entry === "string") {
    return {
      degree: String(entry).trim(),
      institution: "",
      year: "",
      highlights: [],
    };
  }

  return {
    degree: String(entry?.degree || "").trim(),
    institution: sanitizePlaceholder(entry?.institution || ""),
    year: extractEndYear(entry?.year || ""),
    highlights: dedupe(
      toList(entry?.highlights).map(ensureSentence).filter(Boolean),
    ),
  };
}

function normalizeCertificationEntry(entry) {
  if (typeof entry === "string") {
    return { name: String(entry).trim(), highlight: "" };
  }

  return {
    name: String(entry?.name || entry?.title || "").trim(),
    highlight: ensureSentence(entry?.highlight || ""),
  };
}

function normalizeResumeInput(input) {
  return {
    name: String(input?.name || "").trim(),
    phone: String(input?.phone || "").trim(),
    email: String(input?.email || "").trim(),
    location: String(input?.location || "").trim(),
    target_role: String(input?.target_role || "").trim(),
    summary: String(input?.summary || "").trim(),
    experience: toList(input?.experience).map((entry) => ({
      job_title: String(entry?.job_title || input?.target_role || "").trim(),
      company: sanitizePlaceholder(entry?.company || ""),
      duration: sanitizeDuration(entry?.duration || ""),
      responsibilities: dedupe(
        toList(entry?.responsibilities).map(normalizeBullet).filter(Boolean),
      ),
    })),
    skills: dedupe(
      toList(input?.skills)
        .map((item) => String(item).trim())
        .filter(Boolean),
    ),
    skill_highlights: dedupe(
      toList(input?.skill_highlights).map(ensureSentence).filter(Boolean),
    ),
    education: toList(input?.education)
      .map(normalizeEducationEntry)
      .filter((item) => item.degree || item.institution || item.year),
    certifications: toList(input?.certifications)
      .map(normalizeCertificationEntry)
      .filter((item) => item.name),
  };
}

function ensureSectionPresence(resume) {
  const next = clone(resume || {});

  if (!String(next.summary || "").trim()) next.summary = "";

  if (!Array.isArray(next.experience) || !next.experience.length) {
    next.experience = [];
  }

  if (!Array.isArray(next.skills) || !next.skills.length) {
    next.skills = [];
  }

  if (!Array.isArray(next.skill_highlights) || !next.skill_highlights.length) {
    next.skill_highlights = [];
  }

  if (!Array.isArray(next.education) || !next.education.length) {
    next.education = [];
  }

  if (!Array.isArray(next.certifications) || !next.certifications.length) {
    next.certifications = [];
  }

  return next;
}

function hasNonEmptyText(value) {
  return String(value || "").trim().length > 0;
}

function hasNonEmptyExperience(resume) {
  return (resume.experience || []).some(
    (item) =>
      hasNonEmptyText(item?.job_title) ||
      hasNonEmptyText(item?.company) ||
      hasNonEmptyText(item?.duration) ||
      (item?.responsibilities || []).some((bullet) => hasNonEmptyText(bullet)),
  );
}

function hasNonEmptyEducation(resume) {
  return (resume.education || []).some(
    (item) =>
      hasNonEmptyText(item?.degree) ||
      hasNonEmptyText(item?.institution) ||
      hasNonEmptyText(item?.year) ||
      (item?.highlights || []).some((bullet) => hasNonEmptyText(bullet)),
  );
}

function hasNonEmptyCertifications(resume) {
  return (resume.certifications || []).some(
    (item) => hasNonEmptyText(item?.name) || hasNonEmptyText(item?.highlight),
  );
}

function summarizeRoleContext(resume) {
  const role = resume.target_role || "the target role";
  const topSkills = resume.skills.slice(0, 4).join(", ");
  const phrases = [
    `${role} profile presented with clear, ATS-friendly language and practical emphasis`,
    topSkills
      ? `Strengths include ${topSkills}, framed around reliable execution and professional communication`
      : `Focused on dependable execution, communication, and structured support responsibilities`,
  ];
  return ensureSentence(phrases.join(". "));
}

function expandResponsibilitySet(responsibilities, role) {
  const seeds = dedupe(
    toList(responsibilities).map(normalizeBullet).filter(Boolean),
  );
  const expanded = [...seeds];

  const templates = [
    (seed) =>
      ensureSentence(
        `${trimPunctuation(seed)} while maintaining a consistent and professional standard of work`,
      ),
    (seed) =>
      ensureSentence(
        `${trimPunctuation(seed)} to support smooth daily ${role ? role.toLowerCase() : "role"} responsibilities`,
      ),
    (seed) =>
      ensureSentence(
        `${trimPunctuation(seed)} with attention to service quality, responsiveness, and dependable follow-through`,
      ),
  ];

  let index = 0;
  while (expanded.length < 4 && seeds.length > 0) {
    const seed = seeds[index % seeds.length];
    const candidate = templates[index % templates.length](seed);
    if (
      !expanded.some((item) => item.toLowerCase() === candidate.toLowerCase())
    ) {
      expanded.push(candidate);
    }
    index += 1;
    if (index > 12) break;
  }

  return expanded.slice(0, 5);
}

function buildSkillHighlights(resume) {
  if (resume.skill_highlights.length)
    return resume.skill_highlights.slice(0, 8);
  const role = resume.target_role || "the target role";
  return resume.skills
    .slice(0, 8)
    .map((skill) =>
      ensureSentence(
        `${skill} applied in support of ${role.toLowerCase()} responsibilities with a practical and professional approach`,
      ),
    );
}

function buildEducationHighlights(entry, role) {
  if (entry.highlights.length) return entry.highlights.slice(0, 2);
  const title = [entry.degree, entry.institution].filter(Boolean).join(" at ");
  const bulletOne = ensureSentence(
    `${title || entry.degree || "Education"}${entry.year ? ` completed in ${entry.year}` : ""}, providing formal grounding relevant to ${role.toLowerCase()}`,
  );
  const bulletTwo = ensureSentence(
    `${entry.degree || "This qualification"} supports communication, structure, and learning agility in professional environments`,
  );
  return dedupe([bulletOne, bulletTwo]).slice(0, 2);
}

function buildCertificationHighlight(entry, role) {
  if (entry.highlight) return entry.highlight;
  return ensureSentence(
    `${entry.name} completed to reinforce practical knowledge and professional standards relevant to ${role.toLowerCase()}`,
  );
}

function fallbackEnrich(resume) {
  const role = resume.target_role || "Professional";
  const enriched = clone(resume);

  enriched.summary = enriched.summary
    ? ensureSentence(enriched.summary)
    : summarizeRoleContext(enriched);

  enriched.experience = enriched.experience.map((item) => ({
    ...item,
    responsibilities: expandResponsibilitySet(item.responsibilities, role),
  }));

  enriched.skill_highlights = buildSkillHighlights(enriched);
  enriched.education = enriched.education.map((entry) => ({
    ...entry,
    highlights: buildEducationHighlights(entry, role),
  }));
  enriched.certifications = enriched.certifications.map((entry) => ({
    ...entry,
    highlight: buildCertificationHighlight(entry, role),
  }));

  return enriched;
}

async function enrichWithLLM(resume) {
  const client = getOpenAIClient();
  if (!client) throw new Error("OpenAI client unavailable");

  const prompt = `You are an expert ATS resume writer.
You MUST NOT fabricate companies, dates, experience, tools, certifications, achievements, percentages, projects, education details, or responsibilities that are not already present in the input.
You MAY only improve wording, split or combine existing inputs, make bullets stronger, and expand concise text into professional phrasing without adding new facts.

Requirements:
- Summary: 2-3 lines, human-sounding, ATS-safe.
- Experience: each role gets 3-5 strong bullets from the provided responsibilities only.
- Skills: keep existing skills, and create skill_highlights bullets from those skills only.
- Education: keep original degree/institution/year, and add up to 2 highlights per education item using only safe wording inferred from the stated qualification.
- Certifications: keep original certification names, and add one short highlight per certification without inventing outcomes.
- The output should help fill a one-page resume, but must stay truthful.

Return valid JSON only with keys:
name, phone, email, location, target_role, summary, experience, skills, skill_highlights, education, certifications

Input JSON:
${JSON.stringify(resume)}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 2200,
    response_format: { type: "json_object" },
  });

  return normalizeResumeInput(
    JSON.parse(completion.choices[0]?.message?.content || "{}"),
  );
}

function fitResumeForProfile(resume, profileId) {
  const next = fallbackEnrich(resume);

  if (profileId === "compact") {
    next.summary =
      next.summary.length > 260
        ? `${next.summary.slice(0, 257).trimEnd()}...`
        : next.summary;
    next.experience = next.experience.map((item) => ({
      ...item,
      responsibilities: item.responsibilities
        .slice(0, 3)
        .map((bullet) =>
          bullet.length > 150 ? `${bullet.slice(0, 147).trimEnd()}...` : bullet,
        ),
    }));
    next.skill_highlights = next.skill_highlights.slice(0, 6);
    next.education = next.education.map((entry) => ({
      ...entry,
      highlights: entry.highlights.slice(0, 1),
    }));
    next.certifications = next.certifications.slice(0, 4);
  }

  return next;
}

function estimateHeight(resume, profile) {
  const doc = new PDFDocument({
    size: "A4",
    margins: profile.margins,
    autoFirstPage: false,
  });
  doc.addPage();

  const contentWidth =
    PAGE.width - profile.margins.left - profile.margins.right;

  const textHeight = (font, size, text, width, options = {}) => {
    const value = String(text || "").trim();
    if (!value) return 0;
    doc.font(font).fontSize(size);
    return doc.heightOfString(value, {
      width,
      lineGap: options.lineGap ?? profile.lineGap,
      align: options.align || "left",
    });
  };

  let total = 0;
  total += textHeight(
    "Helvetica-Bold",
    profile.nameSize,
    resume.name,
    contentWidth,
  );
  total += textHeight(
    "Helvetica",
    profile.roleSize,
    resume.target_role,
    contentWidth,
  );
  total += textHeight(
    "Helvetica",
    profile.contactSize,
    [resume.phone, resume.email, resume.location].filter(Boolean).join(" | "),
    contentWidth,
  );
  total += profile.headerGap;

  const addSectionBase = () => {
    total += profile.sectionGap;
    total += textHeight(
      "Helvetica-Bold",
      profile.headingSize,
      "SECTION",
      contentWidth,
    );
    total += 8; // 2pt line offset + 6pt gap after rule
  };

  addSectionBase();
  total += textHeight(
    "Helvetica",
    profile.bodySize,
    resume.summary,
    contentWidth,
    { align: "justify" },
  );

  addSectionBase();
  for (const item of resume.experience) {
    total += textHeight(
      "Helvetica-Bold",
      profile.bodySize,
      [item.job_title, item.company].filter(Boolean).join(" - ") ||
        "Professional Experience",
      contentWidth,
    );
    total += textHeight(
      "Helvetica",
      profile.metaSize,
      item.duration,
      contentWidth,
    );
    for (const bullet of item.responsibilities) {
      total += textHeight(
        "Helvetica",
        profile.bodySize,
        `- ${bullet}`,
        contentWidth - 10,
      );
      total += profile.bulletGap;
    }
    total += profile.itemGap;
  }

  if (resume.skill_highlights.length) {
    addSectionBase();
    for (const bullet of resume.skill_highlights) {
      total += textHeight(
        "Helvetica",
        profile.bodySize,
        `- ${bullet}`,
        contentWidth - 10,
      );
      total += profile.bulletGap;
    }
  }

  if (resume.education.length) {
    addSectionBase();
    for (const entry of resume.education) {
      total += textHeight(
        "Helvetica-Bold",
        profile.bodySize,
        [entry.degree, entry.institution, entry.year]
          .filter(Boolean)
          .join(" - "),
        contentWidth,
      );
      for (const bullet of entry.highlights) {
        total += textHeight(
          "Helvetica",
          profile.bodySize,
          `- ${bullet}`,
          contentWidth - 10,
        );
        total += profile.bulletGap;
      }
      total += profile.itemGap;
    }
  }

  if (resume.certifications.length) {
    addSectionBase();
    for (const entry of resume.certifications) {
      total += textHeight(
        "Helvetica-Bold",
        profile.bodySize,
        entry.name,
        contentWidth,
      );
      total += textHeight(
        "Helvetica",
        profile.bodySize,
        `- ${entry.highlight}`,
        contentWidth - 10,
      );
      total += profile.itemGap;
    }
  }

  return total;
}

function chooseLayoutProfile(baseResume) {
  const availableHeight = PAGE.height - 20;
  const candidates = LAYOUT_PROFILES.map((profile) => {
    const prepared = fitResumeForProfile(baseResume, profile.id);
    const estimatedHeight = estimateHeight(prepared, profile);
    const ratio = estimatedHeight / availableHeight;
    const withinTarget = ratio >= TARGET_FILL_MIN && ratio <= TARGET_FILL_MAX;
    const overflow = ratio > 1;
    let score;

    if (withinTarget) {
      score = Math.abs(0.84 - ratio);
    } else if (!overflow) {
      score = Math.abs(TARGET_FILL_MIN - ratio) + 0.25;
    } else {
      score = (ratio - 1) * 4 + 1;
    }

    return { profile, prepared, score };
  });

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0];
}

function buildHtml(resume, profile) {
  const contactLine = [resume.phone, resume.email, resume.location]
    .filter(Boolean)
    .map(safeText)
    .join(" | ");

  const experienceHtml = resume.experience
    .map(
      (item) => `
      <div class="item">
        <div class="item-title">${safeText([item.job_title, item.company].filter(Boolean).join(" - ") || "Professional Experience")}</div>
        ${item.duration ? `<div class="item-meta">${safeText(item.duration)}</div>` : ""}
        <ul>${item.responsibilities.map((bullet) => `<li>${safeText(bullet)}</li>`).join("")}</ul>
      </div>
    `,
    )
    .join("");

  const skillHtml = resume.skill_highlights
    .map((bullet) => `<li>${safeText(bullet)}</li>`)
    .join("");
  const educationHtml = resume.education
    .map(
      (entry) => `
      <div class="item">
        <div class="item-title">${safeText([entry.degree, entry.institution, entry.year].filter(Boolean).join(" - "))}</div>
        <ul>${entry.highlights.map((bullet) => `<li>${safeText(bullet)}</li>`).join("")}</ul>
      </div>
    `,
    )
    .join("");
  const certificationHtml = resume.certifications
    .map(
      (entry) => `
      <div class="item">
        <div class="item-title">${safeText(entry.name)}</div>
        <ul><li>${safeText(entry.highlight)}</li></ul>
      </div>
    `,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Resume</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      background: #ffffff;
      font-size: ${profile.bodySize}px;
      line-height: 1.45;
    }
    .page {
      width: 100%;
      padding: ${profile.margins.top}px ${profile.margins.right}px ${profile.margins.bottom}px ${profile.margins.left}px;
      box-sizing: border-box;
    }
    .name { font-size: ${profile.nameSize}px; font-weight: 700; }
    .role { font-size: ${profile.roleSize}px; margin-top: 4px; }
    .contact { font-size: ${profile.contactSize}px; margin-top: 4px; }
    .section { margin-top: ${profile.sectionGap}px; }
    .section h2 {
      font-size: ${profile.headingSize}px;
      text-transform: uppercase;
      border-bottom: 1px solid #d1d5db;
      padding-bottom: 2px;
      margin: 0 0 6px 0;
    }
    .item { margin-bottom: ${profile.itemGap}px; }
    .item-title { font-weight: 700; }
    .item-meta { font-size: ${profile.metaSize}px; color: #4b5563; }
    ul { margin: 4px 0 0 18px; padding: 0; }
    li { margin-bottom: ${profile.bulletGap}px; }
  </style>
</head>
<body>
  <main class="page">
    <div class="name">${safeText(resume.name)}</div>
    ${resume.target_role ? `<div class="role">${safeText(resume.target_role)}</div>` : ""}
    ${contactLine ? `<div class="contact">${contactLine}</div>` : ""}

    <section class="section">
      <h2>Summary</h2>
      <div>${safeText(resume.summary)}</div>
    </section>

    <section class="section">
      <h2>Experience</h2>
      ${experienceHtml}
    </section>

    ${resume.skill_highlights.length ? `<section class="section"><h2>Skills</h2><ul>${skillHtml}</ul></section>` : ""}

    ${resume.education.length ? `<section class="section"><h2>Education</h2>${educationHtml}</section>` : ""}

    ${resume.certifications.length ? `<section class="section"><h2>Certifications</h2>${certificationHtml}</section>` : ""}
  </main>
</body>
</html>`;
}

function renderSectionTitle(doc, profile, text) {
  doc.moveDown(0.35);
  doc
    .font("Helvetica-Bold")
    .fontSize(profile.headingSize)
    .fillColor("#111827")
    .text(text.toUpperCase(), { characterSpacing: 0.3 });
  const lineY = doc.y + 2;
  doc
    .moveTo(profile.margins.left, lineY)
    .lineTo(PAGE.width - profile.margins.right, lineY)
    .lineWidth(0.7)
    .strokeColor("#d1d5db")
    .stroke();
  doc.y = lineY + 6;
}

function renderBullet(doc, profile, text) {
  doc
    .font("Helvetica")
    .fontSize(profile.bodySize)
    .fillColor("#111827")
    .text(`- ${text}`, {
      width: PAGE.width - profile.margins.left - profile.margins.right - 10,
      lineGap: profile.lineGap,
    });
  doc.moveDown(profile.bulletGap / 10);
}

function buildPDFBuffer(resume, profile) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: profile.margins,
      info: {
        Title: `Resume - ${resume.name || "Candidate"}`,
        Author: "AI Resume Assistant",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentWidth =
      PAGE.width - profile.margins.left - profile.margins.right;

    doc
      .font("Helvetica-Bold")
      .fontSize(profile.nameSize)
      .fillColor("#111827")
      .text(resume.name || "Candidate Name", { width: contentWidth });

    if (resume.target_role) {
      doc
        .font("Helvetica")
        .fontSize(profile.roleSize)
        .fillColor("#1f2937")
        .text(resume.target_role, { width: contentWidth });
    }

    const contactLine = [resume.phone, resume.email, resume.location]
      .filter(Boolean)
      .join(" | ");
    if (contactLine) {
      doc
        .font("Helvetica")
        .fontSize(profile.contactSize)
        .fillColor("#4b5563")
        .text(contactLine, { width: contentWidth });
    }

    doc.moveDown(profile.headerGap / 10);

    renderSectionTitle(doc, profile, "Summary");
    doc
      .font("Helvetica")
      .fontSize(profile.bodySize)
      .fillColor("#111827")
      .text(resume.summary, {
        width: contentWidth,
        align: "justify",
        lineGap: profile.lineGap,
      });

    renderSectionTitle(doc, profile, "Experience");
    for (const item of resume.experience) {
      doc
        .font("Helvetica-Bold")
        .fontSize(profile.bodySize)
        .fillColor("#111827")
        .text(
          [item.job_title, item.company].filter(Boolean).join(" - ") ||
            "Professional Experience",
          {
            width: contentWidth,
          },
        );
      if (item.duration) {
        doc
          .font("Helvetica")
          .fontSize(profile.metaSize)
          .fillColor("#4b5563")
          .text(item.duration, { width: contentWidth });
      }
      for (const bullet of item.responsibilities) {
        renderBullet(doc, profile, bullet);
      }
      doc.moveDown(profile.itemGap / 12);
    }

    if (resume.skill_highlights.length) {
      renderSectionTitle(doc, profile, "Skills");
      for (const bullet of resume.skill_highlights) {
        renderBullet(doc, profile, bullet);
      }
    }

    if (resume.education.length) {
      renderSectionTitle(doc, profile, "Education");
      for (const entry of resume.education) {
        doc
          .font("Helvetica-Bold")
          .fontSize(profile.bodySize)
          .fillColor("#111827")
          .text(
            [entry.degree, entry.institution, entry.year]
              .filter(Boolean)
              .join(" - "),
            {
              width: contentWidth,
            },
          );
        for (const bullet of entry.highlights) {
          renderBullet(doc, profile, bullet);
        }
        doc.moveDown(profile.itemGap / 12);
      }
    }

    if (resume.certifications.length) {
      renderSectionTitle(doc, profile, "Certifications");
      for (const entry of resume.certifications) {
        doc
          .font("Helvetica-Bold")
          .fontSize(profile.bodySize)
          .fillColor("#111827")
          .text(entry.name, { width: contentWidth });
        renderBullet(doc, profile, entry.highlight);
        doc.moveDown(profile.itemGap / 12);
      }
    }

    doc.end();
  });
}

function makeFilename(name) {
  const base = String(name || "candidate")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `resume-${base || "candidate"}-${Date.now()}.pdf`;
}

async function generateResumePackage(resumeJson, options = {}) {
  const enforceSectionPresence = Boolean(options.enforceSectionPresence);
  const normalizedRaw = normalizeResumeInput(resumeJson || {});
  const normalized = enforceSectionPresence
    ? ensureSectionPresence(normalizedRaw)
    : normalizedRaw;

  let enriched;
  try {
    enriched = await enrichWithLLM(normalized);
  } catch {
    enriched = fallbackEnrich(normalized);
  }

  let postEnrich = enforceSectionPresence
    ? ensureSectionPresence(enriched)
    : enriched;

  // In create mode, keep sections only if user actually provided content.
  if (!enforceSectionPresence) {
    if (!hasNonEmptyExperience(postEnrich)) postEnrich.experience = [];
    if (!postEnrich.skills.length) postEnrich.skill_highlights = [];
    if (!hasNonEmptyEducation(postEnrich)) postEnrich.education = [];
    if (!hasNonEmptyCertifications(postEnrich)) postEnrich.certifications = [];
  }

  const candidate = chooseLayoutProfile(postEnrich);
  const finalResume = enforceSectionPresence
    ? ensureSectionPresence(candidate.prepared)
    : candidate.prepared;
  const html = buildHtml(finalResume, candidate.profile);
  const pdfBuffer = await buildPDFBuffer(finalResume, candidate.profile);
  const pdfUrl = await uploadResume(
    pdfBuffer,
    makeFilename(finalResume.name),
    "application/pdf",
  );

  return { html, pdfUrl };
}

async function generateResumePDF(resumeJson, options = {}) {
  const { pdfUrl } = await generateResumePackage(resumeJson, options);
  return pdfUrl;
}

module.exports = { generateResumePDF, generateResumePackage };
