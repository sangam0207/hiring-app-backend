const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

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
        const data = await pdfParse(source);
        return data.text;
      }

      if (isWord) {
        const result = await mammoth.extractRawText({ buffer: source });
        return result.value;
      }

      // Try PDF as fallback (some buffers don't have perfect mimetype)
      try {
        const data = await pdfParse(source);
        if (data.text && data.text.trim().length > 20) return data.text;
      } catch (_) {}

      throw new Error(`Unsupported mimetype: ${mimetype}`);
    }

    // ── File path mode (legacy / local) ──────────────────────────────────
    const fs = require("fs");
    const path = require("path");
    const ext = path.extname(source).toLowerCase();

    if (ext === ".pdf") {
      const buf = fs.readFileSync(source);
      const data = await pdfParse(buf);
      return data.text;
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
