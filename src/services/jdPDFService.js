const PDFDocument = require("pdfkit");
const { uploadResume } = require("./s3Service");

function safeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .trim();
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function ensureSentence(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/[.!?]$/.test(text)) return text;
  return `${text}.`;
}

function dedupe(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result;
}

function normalizeJD(jd) {
  return {
    jobTitle: String(jd?.jobTitle || "").trim(),
    companyName: String(jd?.companyName || "").trim(),
    industryType: String(jd?.industryType || "").trim(),
    aboutRole: dedupe(toArray(jd?.aboutRole).map(ensureSentence)).slice(0, 3),
    keyObjectives: dedupe(toArray(jd?.keyObjectives).map(ensureSentence)).slice(
      0,
      5,
    ),
    responsibilities: dedupe(
      toArray(jd?.responsibilities).map(ensureSentence),
    ).slice(0, 8),
    requirements: dedupe(toArray(jd?.requirements).map(ensureSentence)).slice(
      0,
      10,
    ),
    preferredQualifications: dedupe(
      toArray(jd?.preferredQualifications).map(ensureSentence),
    ).slice(0, 5),
    benefits: dedupe(toArray(jd?.benefits).map(ensureSentence)).slice(0, 8),
  };
}

function sectionToMarkdown(title, lines) {
  if (!lines?.length) return "";
  return `## ${title}\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function createJDMarkdown(jd) {
  const blocks = [
    `# Job Description\n\n**Job Title:** ${jd.jobTitle}`,
    sectionToMarkdown("About the Role", jd.aboutRole),
    sectionToMarkdown("Key Objectives", jd.keyObjectives),
    sectionToMarkdown("Responsibilities", jd.responsibilities),
    sectionToMarkdown("Requirements", jd.requirements),
    jd.preferredQualifications.length
      ? sectionToMarkdown(
          "Preferred Qualifications",
          jd.preferredQualifications,
        )
      : "",
    sectionToMarkdown("Benefits", jd.benefits),
  ];

  return blocks.filter(Boolean).join("\n\n");
}

function createJDHtml(jd) {
  const list = (items) =>
    items.map((item) => `<li>${safeText(item)}</li>`).join("");
  const about = jd.aboutRole.map((line) => `<p>${safeText(line)}</p>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Job Description</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      background: #ffffff;
      line-height: 1.45;
      font-size: 12px;
    }
    .page {
      box-sizing: border-box;
      width: 100%;
      padding: 34px 38px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
    }
    .meta {
      margin-top: 6px;
      color: #374151;
      font-size: 12px;
    }
    section {
      margin-top: 14px;
      page-break-inside: avoid;
    }
    h2 {
      margin: 0 0 6px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      border-bottom: 1px solid #d1d5db;
      padding-bottom: 2px;
    }
    p {
      margin: 0 0 8px;
      text-align: justify;
    }
    p:last-child {
      margin-bottom: 0;
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    li {
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <main class="page">
    <h1>${safeText(jd.jobTitle)}</h1>
    <div class="meta">${safeText(jd.companyName)} | ${safeText(jd.industryType)}</div>

    <section>
      <h2>About the Role</h2>
      ${about}
    </section>

    <section>
      <h2>Key Objectives</h2>
      <ul>${list(jd.keyObjectives)}</ul>
    </section>

    <section>
      <h2>Responsibilities</h2>
      <ul>${list(jd.responsibilities)}</ul>
    </section>

    <section>
      <h2>Requirements</h2>
      <ul>${list(jd.requirements)}</ul>
    </section>

    ${jd.preferredQualifications.length ? `<section><h2>Preferred Qualifications</h2><ul>${list(jd.preferredQualifications)}</ul></section>` : ""}

    <section>
      <h2>Benefits</h2>
      <ul>${list(jd.benefits)}</ul>
    </section>
  </main>
</body>
</html>`;
}

function makeFilename(jobTitle, companyName) {
  const base = `${jobTitle || "job-description"}-${companyName || "company"}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);

  return `jd-${base || "generated"}-${Date.now()}.pdf`;
}

function renderSectionTitle(doc, text) {
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#111827")
    .text(text.toUpperCase(), { characterSpacing: 0.2 });

  const y = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.7)
    .strokeColor("#d1d5db")
    .stroke();
  doc.y = y + 8;
}

function renderBullets(doc, items) {
  for (const item of items || []) {
    doc
      .font("Helvetica")
      .fontSize(10.4)
      .fillColor("#111827")
      .text(`- ${item}`, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        lineGap: 1.8,
      });
    doc.moveDown(0.08);
  }
}

function jdToPdfBuffer(jd) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 36, right: 38, bottom: 34, left: 38 },
      info: {
        Title: `JD - ${jd.jobTitle || "Role"}`,
        Author: "AI JD Assistant",
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor("#111827")
      .text(jd.jobTitle || "Job Description", { width: contentWidth });

    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#374151")
      .text([jd.companyName, jd.industryType].filter(Boolean).join(" | "), {
        width: contentWidth,
      });

    doc.moveDown(0.7);
    renderSectionTitle(doc, "About the Role");
    for (const paragraph of jd.aboutRole || []) {
      doc
        .font("Helvetica")
        .fontSize(10.4)
        .fillColor("#111827")
        .text(paragraph, {
          width: contentWidth,
          lineGap: 1.6,
          align: "justify",
        });
      doc.moveDown(0.18);
    }

    doc.moveDown(0.2);
    renderSectionTitle(doc, "Key Objectives");
    renderBullets(doc, jd.keyObjectives);

    doc.moveDown(0.2);
    renderSectionTitle(doc, "Responsibilities");
    renderBullets(doc, jd.responsibilities);

    doc.moveDown(0.2);
    renderSectionTitle(doc, "Requirements");
    renderBullets(doc, jd.requirements);

    if ((jd.preferredQualifications || []).length) {
      doc.moveDown(0.2);
      renderSectionTitle(doc, "Preferred Qualifications");
      renderBullets(doc, jd.preferredQualifications);
    }

    doc.moveDown(0.2);
    renderSectionTitle(doc, "Benefits");
    renderBullets(doc, jd.benefits);

    doc.end();
  });
}

async function generateJDPackage(rawJd) {
  const jd = normalizeJD(rawJd);
  const markdown = createJDMarkdown(jd);
  const html = createJDHtml(jd);
  const pdfBuffer = await jdToPdfBuffer(jd);

  const pdfUrl = await uploadResume(
    pdfBuffer,
    makeFilename(jd.jobTitle, jd.companyName),
    "application/pdf",
  );

  return { markdown, html, pdfUrl };
}

module.exports = {
  generateJDPackage,
};
