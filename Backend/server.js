require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("node:path");
const axios = require("axios");
const { normalizeAdmission, AdmissionError } = require("./services/admissionContract");
const { createUpload, createUploadDirectory, cleanupUploadDirectory, purgeStaleUploadDirectories, validateFileContents } = require("./services/uploadService");

async function verifyRecaptcha(token) {
  if (!process.env.RECAPTCHA_SECRET_KEY) throw new Error("reCAPTCHA secret key not configured");
  // Send the secret in the POST body so it never appears in URLs or proxy logs.
  const response = await axios.post("https://www.google.com/recaptcha/api/siteverify",
    new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET_KEY, response: token }), { timeout: 15000 });
  return response.data;
}

// Comma-separated env lists, compared case-insensitively without trailing slashes.
const parseList = value => String(value || "").split(",").map(item => item.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);

// Inject external services in tests so API checks never send email or write Sheets.
function createApp(options = {}) {
  const queue = options.queue || require("./services/queueService");
  const verify = options.verifyRecaptcha || verifyRecaptcha;
  const allocateId = options.allocateApplicationId || require("./services/applicationIdService").allocateApplicationId;
  const uploadRoot = path.resolve(options.uploadRoot || path.join(__dirname, "uploads"));
  // ALLOWED_ORIGINS, e.g. https://groundschool.skyproaviation.org. Empty allows any origin (development).
  const allowedOrigins = options.allowedOrigins ? parseList(options.allowedOrigins.join(",")) : parseList(process.env.ALLOWED_ORIGINS);
  // RECAPTCHA_ALLOWED_HOSTNAMES, e.g. groundschool.skyproaviation.org. Empty skips the hostname check.
  const recaptchaHostnames = options.recaptchaHostnames ? parseList(options.recaptchaHostnames.join(",")) : parseList(process.env.RECAPTCHA_ALLOWED_HOSTNAMES);
  // Requests without an Origin header (health checks, server-to-server) are not browser cross-origin requests.
  const originAllowed = origin => !origin || !allowedOrigins.length || allowedOrigins.includes(origin.replace(/\/+$/, "").toLowerCase());
  const upload = createUpload(uploadRoot);
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: (origin, callback) => callback(null, originAllowed(origin)) }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.post("/api/submit", async (req, res) => {
    let queued = false;
    let status = 200;
    let response;
    try {
      // CORS alone cannot stop a simple multipart POST, so refuse unlisted browser origins before reading uploads.
      if (!originAllowed(req.get("origin"))) throw Object.assign(new Error(`Origin not allowed: ${req.get("origin")}`), { status: 403 });
      if (!req.is("multipart/form-data")) throw new AdmissionError("Submit this form as multipart/form-data");
      req.uploadDir = await createUploadDirectory(uploadRoot);
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      const uploadedFiles = Object.values(req.files || {}).flat();
      const formData = normalizeAdmission(req.body, uploadedFiles);
      await validateFileContents(uploadedFiles);
      const token = req.body.recaptchaToken;
      if (typeof token !== "string" || !token.trim() || token.length > 8192) throw new AdmissionError("reCAPTCHA token is missing or invalid. Please complete the verification.");
      let result;
      try { result = await verify(token); }
      catch { throw new AdmissionError("Security verification failed. Please try again."); }
      if (result?.success !== true) throw new AdmissionError("reCAPTCHA verification failed. Please try again.");
      if (recaptchaHostnames.length && !recaptchaHostnames.includes(String(result.hostname || "").toLowerCase())) {
        console.error("reCAPTCHA solved on an unexpected hostname:", result.hostname);
        throw new AdmissionError("reCAPTCHA verification failed. Please try again.");
      }
      if (typeof result.score === "number" && result.score < 0.5) throw new AdmissionError("Security check failed. Please try again.");
      if (req.aborted || res.destroyed) throw new AdmissionError("Submission connection was closed");
      try { formData.applicationId = await allocateId(new Date()); }
      catch (error) { console.error("Application ID allocation failed:", error.message); throw Object.assign(new Error("Application ID allocation unavailable"), { status: 503 }); }
      const jobId = await queue.addJob({
        formData, uploadedFiles, files: Object.fromEntries(uploadedFiles.map(file => [file.fieldname, file])),
        uploadDir: req.uploadDir, uploadRoot,
      });
      if (!jobId) throw new Error("Queue did not accept submission");
      queued = true; // Ownership transfers to the queue only after insertion succeeds.
      response = {
        success: true, message: "Form submitted successfully! Processing in background.",
        jobId, info: "You will receive a confirmation email shortly.",
      };
    } catch (error) {
      const multerError = error.name === "MulterError";
      status = error.status || (multerError ? 400 : 500);
      const message = error.code === "LIMIT_FILE_SIZE" ? "Each upload must be no larger than 2 MB"
        : multerError ? "Invalid uploads: use only the listed fields, with one file per field"
        : status === 400 ? error.message
        : status === 403 ? "This form must be submitted from the SkyPro Ground School website."
        : "Submission failed. Please try again.";
      response = { error: message, ...(error.fields ? { fields: error.fields } : {}) };
      if (status === 500 || status === 403) console.error("Submission failed:", error.message);
    } finally {
      if (!queued) {
        try { await cleanupUploadDirectory(uploadRoot, req.uploadDir); }
        catch (error) { console.error("Rejected-upload cleanup failed:", error.message); }
      }
    }
    if (!res.destroyed) res.status(status).json(response);
  });

  app.get("/", (req, res) => res.send("Backend started successfully 🚀"));
  // Aggregate counts only; see queueService.getQueueStatus.
  app.get("/api/queue-status", (req, res) => res.json(queue.getQueueStatus()));
  app.get("/health", (req, res) => res.json({
    status: "OK", recaptchaConfigured: !!process.env.RECAPTCHA_SECRET_KEY,
    corsRestricted: allowedOrigins.length > 0, recaptchaHostnameCheck: recaptchaHostnames.length > 0,
    timestamp: new Date().toISOString(),
  }));
  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 5000;
  if (process.env.NODE_ENV === "production" && !parseList(process.env.ALLOWED_ORIGINS).length) {
    console.warn("⚠️ ALLOWED_ORIGINS is not set: browser requests are accepted from any origin.");
  }
  // The queue is in memory, so request directories left by a crash or restart are never processed.
  const purgeUploads = () => purgeStaleUploadDirectories(path.join(__dirname, "uploads"))
    .then(count => { if (count) console.log(`🧹 Removed ${count} stale upload director${count === 1 ? "y" : "ies"}`); })
    .catch(error => console.error("Stale upload cleanup failed:", error.message));
  purgeUploads();
  setInterval(purgeUploads, 6 * 60 * 60 * 1000).unref();
  createApp().listen(port, () => console.log(`Server running at http://localhost:${port}`));
}
module.exports = { createApp, verifyRecaptcha };
