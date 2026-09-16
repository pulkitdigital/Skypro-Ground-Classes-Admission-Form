const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const sharp = require("sharp");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { normalizeAdmission } = require("../services/admissionContract");
const { validBody, filesFor } = require("./fixtures");

// Fictional applicants only. Distinct document page widths let tests verify
// attachment order without relying on PDF text extraction.
const SAMPLE_DOCUMENTS = {
  aadhar: { width: 401, pages: 1 },
  passport: { width: 402, pages: 1 },
  marksheet10: { width: 403, pages: 2 },
  marksheet12: { width: 404, pages: 1 },
  dgcaExamResult: { width: 405, pages: 1 },
  dgcaMedicalAssessment: { width: 406, pages: 3 },
};

const SCENARIOS = {
  "indian-package": {
    applicationId: "SKY-GS-2026-09-0001",
    body: validBody({ fullName: "Aarav Sharma", modeOfClass: "Offline", heardAboutSkypro: "" }),
  },
  "foreign-individual-dgca": {
    applicationId: "SKY-GS-2026-09-0002",
    body: validBody({
      fullName: "Mei Lin Tan", dob: "2003-02-11", gender: "Female", mobileCountry: "SG", mobileCountryCode: "+65", mobile: "81234567", email: "mei.tan@example.com",
      nationality: "Foreign National", countryOfCitizenship: "Singapore", passportNumber: "K1234567A", passportExpiryDate: "2031-05-20",
      highestQualification: "Other", otherQualification: "Diploma in Aeronautics", physicsMathematicsStatus: "Physics and Mathematics Completed",
      hasJaipurContact: "Yes", jaipurContactName: "Rohit Mehra", jaipurContactRelationship: "Family Friend", jaipurContactMobileCountry: "IN", jaipurContactMobileCountryCode: "+91", jaipurContactMobile: "9812345678", jaipurContactAddress: "22 Civil Lines, Jaipur",
      emergencyContactSource: "Other", emergencyOtherName: "Daniel Tan", emergencyOtherRelationship: "Uncle", emergencyOtherMobileCountry: "SG", emergencyOtherMobileCountryCode: "+65", emergencyOtherMobile: "91234567",
      courseSelection: "Individual Subject(s)", enrollmentSubjects: JSON.stringify(["Air Navigation", "Technical General", "Radio Telephony (RTR)"]), modeOfClass: "Online", heardAboutSkypro: "Instagram",
      previousFlyingExperience: "Yes", hasDgcaComputerNumber: "Yes", dgcaComputerNumber: "DGCA-CN-778812", dgcaPapersCleared: "Yes", dgcaSubjects: JSON.stringify(["Air Regulations", "Aviation Meteorology"]), dgcaExamResultDate: "2026-06-10",
      hasEgcaId: "Yes", egcaId: "EGCA-445566", hasDgcaMedical: "Yes", dgcaMedicalClass: "DGCA Class-1 Medical",
    }),
  },
  "indian-png-images": {
    applicationId: "SKY-GS-2026-09-0003",
    imageFormat: "png",
    body: validBody({ fullName: "Riya Kapoor", gender: "Female", email: "riya@example.com" }),
  },
};

// Sized to the upload rules: photo 413 × 531 px, signatures 300 × 150 px.
const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="413" height="531" viewBox="0 0 350 450" preserveAspectRatio="none"><rect width="350" height="450" fill="#dfe9f5"/><circle cx="175" cy="170" r="80" fill="#8aa4c4"/><path d="M45 450 C60 300 290 300 305 450 Z" fill="#8aa4c4"/></svg>`;
// PNG signatures have a transparent background, like a scanned signature exported with alpha.
const signatureSvg = (curve, transparent) => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 600 200" preserveAspectRatio="none">${transparent ? "" : `<rect width="600" height="200" fill="#ffffff"/>`}<path d="${curve}" stroke="#1b2a6b" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`;
const SIGNATURE_CURVES = {
  signature: "M30 140 C80 40 120 180 170 90 S260 60 300 130 S420 70 470 110 S560 120 580 90",
  parentSignature: "M40 120 C90 60 130 160 190 100 S300 150 350 90 S470 140 560 80",
};
const imageSvg = (fieldname, transparent) => fieldname === "photo" ? PHOTO_SVG : signatureSvg(SIGNATURE_CURVES[fieldname], transparent);
const IMAGE_FIELDS = ["photo", "signature", "parentSignature"];

// Renders a fixture image as JPEG (default) or PNG with the given extension and MIME type.
async function sampleImage(fieldname, imageFormat = "jpeg") {
  const png = imageFormat === "png";
  const image = sharp(Buffer.from(imageSvg(fieldname, png)));
  return { buffer: await (png ? image.png() : image.jpeg()).toBuffer(), extension: png ? ".png" : ".jpg", mimetype: png ? "image/png" : "image/jpeg" };
}

// Decodes the hex text operators PDFKit writes for standard fonts.
function extractText(bytes) {
  const raw = bytes.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    let content;
    try { content = zlib.inflateSync(bytes.subarray(start, raw.indexOf("endstream", start))).toString("latin1"); } catch { continue; }
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>/g)) text += Buffer.from(hex[1], "hex").toString("latin1");
    text += "\n";
  }
  return text;
}

async function sampleDocument(fieldname) {
  const spec = SAMPLE_DOCUMENTS[fieldname];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < spec.pages; index++) {
    pdf.addPage([spec.width, 560]).drawText(`Sample ${fieldname} - page ${index + 1} of ${spec.pages}`, { x: 30, y: 520, size: 12, font, color: rgb(0.1, 0.2, 0.4) });
  }
  return Buffer.from(await pdf.save());
}

// `imageFormat: "png"` writes the photo and both signatures as PNG instead of JPEG.
async function writeSampleUploads(directory, body, { imageFormat = "jpeg" } = {}) {
  const files = [];
  for (const { fieldname } of filesFor(body)) {
    const { buffer, extension, mimetype } = IMAGE_FIELDS.includes(fieldname)
      ? await sampleImage(fieldname, imageFormat)
      : { buffer: await sampleDocument(fieldname), extension: ".pdf", mimetype: "application/pdf" };
    const filePath = path.join(directory, fieldname + extension);
    await fs.writeFile(filePath, buffer);
    files.push({ fieldname, originalname: fieldname + extension, mimetype, path: filePath, size: buffer.length });
  }
  return files;
}

// Writes sample uploads for any request body and returns the normalized admission.
async function admissionFromBody(body, applicationId, directory, { now = new Date("2026-09-14T06:30:00Z"), imageFormat } = {}) {
  const files = await writeSampleUploads(directory, body, { imageFormat });
  const form = normalizeAdmission(body, files, now);
  form.applicationId = applicationId;
  return { form, files };
}

async function sampleAdmission(name, directory, now) {
  const { body, applicationId, imageFormat } = SCENARIOS[name];
  return admissionFromBody(body, applicationId, directory, { now, imageFormat });
}

module.exports = { SCENARIOS, SAMPLE_DOCUMENTS, admissionFromBody, extractText, sampleAdmission, sampleDocument, sampleImage, writeSampleUploads };
