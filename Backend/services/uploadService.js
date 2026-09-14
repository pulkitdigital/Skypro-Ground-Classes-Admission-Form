const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const multer = require("multer");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const { AdmissionError, FILE_FIELDS } = require("./admissionContract");

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const IMAGE_FIELDS = new Set(["photo", "signature", "parentSignature"]);

function validateFileMetadata(file) {
  const image = IMAGE_FIELDS.has(file.fieldname);
  if (!FILE_FIELDS.includes(file.fieldname)) throw new AdmissionError("Unsupported upload field");
  const typeOK = image ? ["image/jpeg", "image/jpg"].includes(file.mimetype) : file.mimetype === "application/pdf";
  const extensionOK = (image ? /\.jpe?g$/i : /\.pdf$/i).test(file.originalname);
  if (!typeOK || !extensionOK) throw new AdmissionError(`${file.fieldname}: only ${image ? "JPG/JPEG" : "PDF"} files are allowed`, { [file.fieldname]: "File type and extension must match the required format" });
}

function createUpload(uploadRoot) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, req.uploadDir),
      filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: FILE_FIELDS.length, fields: 100, parts: 110, fieldSize: 16 * 1024, fieldNameSize: 100 },
    fileFilter: (req, file, cb) => {
      try { validateFileMetadata(file); cb(null, true); } catch (error) { cb(error); }
    },
  }).fields(FILE_FIELDS.map(name => ({ name, maxCount: 1 })));
}

async function createUploadDirectory(uploadRoot) {
  await fs.mkdir(uploadRoot, { recursive: true });
  return fs.mkdtemp(path.join(uploadRoot, "admission-"));
}

async function cleanupUploadDirectory(uploadRoot, directory) {
  if (!directory) return;
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(uploadRoot) || !path.basename(resolved).startsWith("admission-")) {
    throw new Error("Refusing to clean a directory outside the admission upload root");
  }
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function validateFileContents(files) {
  for (const file of files) {
    validateFileMetadata(file);
    const stat = await fs.stat(file.path);
    if (!stat.size || stat.size > MAX_UPLOAD_BYTES) throw new AdmissionError(`${file.fieldname}: upload a nonempty file no larger than 2 MB`);
    const buffer = await fs.readFile(file.path);
    try {
      if (IMAGE_FIELDS.has(file.fieldname)) {
        if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) throw new Error("Not a JPEG");
        // Decode the actual image; MIME declarations alone are not trustworthy.
        const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "warning" });
        const metadata = await image.metadata();
        if (metadata.format !== "jpeg") throw new Error("Not a JPEG");
        await image.raw().toBuffer();
        file.mimetype = "image/jpeg";
      } else {
        if (!buffer.subarray(0, 8).toString("ascii").startsWith("%PDF-")) throw new Error("Not a PDF");
        const pdf = await PDFDocument.load(buffer);
        if (pdf.isEncrypted || !pdf.getPageCount()) throw new Error("Unreadable PDF");
      }
    } catch {
      throw new AdmissionError(`${file.fieldname}: upload a valid, readable ${IMAGE_FIELDS.has(file.fieldname) ? "JPG/JPEG image" : "unencrypted PDF"}`, { [file.fieldname]: "File contents do not match a supported, readable document" });
    }
  }
}

// The queue is in memory, so a request directory older than maxAgeMs cannot belong
// to a live job (jobs finish or exhaust their retries within minutes). Only
// server-created admission-* directories are removed; loose files are untouched.
async function purgeStaleUploadDirectories(uploadRoot, { maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  let entries;
  try { entries = await fs.readdir(uploadRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return 0; throw error; }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("admission-")) continue;
    const directory = path.join(uploadRoot, entry.name);
    if (now - (await fs.stat(directory)).mtimeMs < maxAgeMs) continue;
    await cleanupUploadDirectory(uploadRoot, directory);
    removed++;
  }
  return removed;
}

module.exports = { createUpload, createUploadDirectory, cleanupUploadDirectory, purgeStaleUploadDirectories, validateFileContents, validateFileMetadata, MAX_UPLOAD_BYTES };
