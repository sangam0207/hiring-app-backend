const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Fallback for malformed PDFs (e.g. bad XRef tables): extract readable tokens
// directly from PDF content streams. This is less accurate than pdf-parse but
// works for many corrupted yet text-based PDFs.
function extractTextFromPdfBufferLenient(buffer) {
  const raw = buffer.toString("latin1");
  const tokens = [];
  const parenTextRe = /\(([^()]|\\\(|\\\)|\\n|\\r|\\t|\\\\)+\)\s*Tj/g;
  const arrayTextRe = /\[((?:[^\]]|\\\])+)\]\s*TJ/g;

  let match = null;
  while ((match = parenTextRe.exec(raw)) !== null) {
    tokens.push(match[0]);
  }
  while ((match = arrayTextRe.exec(raw)) !== null) {
    tokens.push(match[0]);
  }

  const decoded = tokens
    .map((entry) =>
      entry
        .replace(/^\(/, "")
        .replace(/\)\s*Tj$/, "")
        .replace(/^\[/, "")
        .replace(/\]\s*TJ$/, "")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/<[^>]*>/g, " ")
        .replace(/-?\d+(?:\.\d+)?/g, " "),
    )
    .join("\n");

  return normalizeWhitespace(decoded);
}

async function parsePdfWithFallback(buffer) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const data = await pdfParse(buffer);
      const strictText = normalizeWhitespace(data?.text);
      if (strictText.length >= 20) return strictText;
    } catch (_) {
      // Retry once before falling back to lenient extraction.
    }
  }

  const fallbackText = extractTextFromPdfBufferLenient(buffer);
  if (fallbackText.length >= 20) return fallbackText;

  throw new Error(
    "Could not extract enough readable text from this PDF. Try uploading another PDF or paste resume text.",
  );
}

/**
 * Extracts raw text from a resume.
 * Accepts either a Buffer (from S3 or memoryStorage) + mimetype,
 * or falls back to a local file path for backward compatibility.
 *
 * @param {Buffer|string} source   - File buffer OR local file path
 * @param {string}        mimetype - Required when source is a Buffer
 */
const extractTextFromResume = async (source, mimetype = "") => {
  try {
    // ── Buffer mode (from S3 fetch or multer memoryStorage) ──────────────
    if (Buffer.isBuffer(source)) {
      const isPdf =
        mimetype === "application/pdf" ||
        mimetype === "application/octet-stream";
      const isWord =
        mimetype === "application/msword" ||
        mimetype ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      if (isPdf) {
        return await parsePdfWithFallback(source);
      }

      if (isWord) {
        const result = await mammoth.extractRawText({ buffer: source });
        return result.value;
      }

      // Try PDF as fallback (some buffers don't have perfect mimetype)
      try {
        const parsed = await parsePdfWithFallback(source);
        if (parsed && parsed.trim().length > 20) return parsed;
      } catch (_) {}

      throw new Error(`Unsupported mimetype: ${mimetype}`);
    }

    // ── File path mode (legacy / local) ──────────────────────────────────
    const fs = require("fs");
    const path = require("path");
    const ext = path.extname(source).toLowerCase();

    if (ext === ".pdf") {
      const buf = fs.readFileSync(source);
      return await parsePdfWithFallback(buf);
    }

    if (ext === ".doc" || ext === ".docx") {
      const result = await mammoth.extractRawText({ path: source });
      return result.value;
    }

    throw new Error(`Unsupported file extension: ${ext}`);
  } catch (error) {
    throw new Error(`Failed to extract text from resume: ${error.message}`);
  }
};

module.exports = { extractTextFromResume };
