const AWS = require("aws-sdk");
const mime = require("mime-types");

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

/**
 * Upload a resume buffer directly to S3
 * @param {Buffer} fileBuffer - File buffer from multer memoryStorage
 * @param {string} originalName - Original filename from the upload
 * @param {string} mimetype - File mimetype
 * @returns {string} - S3 public URL of uploaded resume
 */
async function uploadResume(fileBuffer, originalName, mimetype) {
  const fileExtension = mime.extension(mimetype);
  const key = `resumes/${Date.now()}-${Math.round(Math.random() * 1e9)}.${fileExtension}`;

  const params = {
    Bucket: process.env.AWS_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: mimetype || "application/octet-stream",
    // Remove ACL if your bucket uses Object Ownership = BucketOwnerEnforced
    // ACL: "public-read",
  };

  const data = await s3.upload(params).promise();
  return data.Location; // Full public S3 URL
}

/**
 * Delete a resume from S3 by its URL
 * @param {string} url - Full S3 URL of the resume
 */
async function deleteResume(url) {
  try {
    const key = extractS3KeyFromUrl(url);
    if (!key) return false;

    await s3
      .deleteObject({ Bucket: process.env.AWS_BUCKET, Key: key })
      .promise();
    return true;
  } catch (error) {
    console.error("[S3] Delete failed:", error.message);
    return false;
  }
}

/**
 * Generate a signed URL to securely access a private S3 file
 * @param {string} url - Full S3 URL
 * @param {number} expiresIn - Seconds until expiry (default: 1 hour)
 * @param {Object} overrides - Additional getObject params (e.g. ResponseContentDisposition)
 */
function getSignedUrl(url, expiresIn = 3600, overrides = {}) {
  try {
    const key = extractS3KeyFromUrl(url);
    if (!key) return null;

    return s3.getSignedUrl("getObject", {
      Bucket: process.env.AWS_BUCKET,
      Key: key,
      Expires: expiresIn,
      ...overrides,
    });
  } catch (error) {
    console.error("[S3] Signed URL error:", error.message);
    return null;
  }
}

/**
 * Fetch a file from S3 as a Buffer (used for re-parsing resumes)
 * @param {string} url - Full S3 URL
 * @returns {Buffer}
 */
async function fetchFileAsBuffer(url) {
  const key = extractS3KeyFromUrl(url);
  if (!key) throw new Error("Could not extract S3 key from URL.");

  const data = await s3
    .getObject({ Bucket: process.env.AWS_BUCKET, Key: key })
    .promise();

  return data.Body; // Buffer
}

// Helper: extract the S3 key from a full S3 URL
function extractS3KeyFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const bucketName = process.env.AWS_BUCKET;

    // Format: https://bucket.s3.region.amazonaws.com/key
    if (urlObj.hostname.startsWith(`${bucketName}.s3`)) {
      return decodeURIComponent(urlObj.pathname.slice(1));
    }

    // Format: https://s3.region.amazonaws.com/bucket/key
    const parts = urlObj.pathname.split("/");
    if (parts[1] === bucketName) {
      return decodeURIComponent(parts.slice(2).join("/"));
    }

    throw new Error("Could not parse S3 URL format.");
  } catch (err) {
    console.error("[S3] extractS3KeyFromUrl failed:", err.message);
    return null;
  }
}

/**
 * Upload an image (profile photo or cover) to S3
 */
async function uploadImage(fileBuffer, originalName, mimetype) {
  const fileExtension = mime.extension(mimetype) || "png";
  const key = `images/${Date.now()}-${Math.round(Math.random() * 1e9)}.${fileExtension}`;

  const params = {
    Bucket: process.env.AWS_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: mimetype || "image/png",
  };

  const data = await s3.upload(params).promise();
  return data.Location;
}

module.exports = {
  uploadResume,
  deleteResume,
  getSignedUrl,
  fetchFileAsBuffer,
  uploadImage,
};
