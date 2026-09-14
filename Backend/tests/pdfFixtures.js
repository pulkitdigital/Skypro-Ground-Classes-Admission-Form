const fs = require("node:fs/promises");
const path = require("node:path");
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
};

const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="450"><rect width="350" height="450" fill="#dfe9f5"/><circle cx="175" cy="170" r="80" fill="#8aa4c4"/><path d="M45 450 C60 300 290 300 305 450 Z" fill="#8aa4c4"/></svg>`;
const signatureSvg = curve => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="#ffffff"/><path d="${curve}" stroke="#1b2a6b" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`;
const IMAGES = {
  photo: PHOTO_SVG,
  signature: signatureSvg("M30 140 C80 40 120 180 170 90 S260 60 300 130 S420 70 470 110 S560 120 580 90"),
  parentSignature: signatureSvg("M40 120 C90 60 130 160 190 100 S300 150 350 90 S470 140 560 80"),
};

async function writeSampleUploads(directory, body) {
  const files = [];
  for (const { fieldname } of filesFor(body)) {
    let buffer;
    let extension;
    if (IMAGES[fieldname]) {
      buffer = await sharp(Buffer.from(IMAGES[fieldname])).jpeg().toBuffer();
      extension = ".jpg";
    } else {
      const spec = SAMPLE_DOCUMENTS[fieldname];
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let index = 0; index < spec.pages; index++) {
        pdf.addPage([spec.width, 560]).drawText(`Sample ${fieldname} - page ${index + 1} of ${spec.pages}`, { x: 30, y: 520, size: 12, font, color: rgb(0.1, 0.2, 0.4) });
      }
      buffer = Buffer.from(await pdf.save());
      extension = ".pdf";
    }
    const filePath = path.join(directory, fieldname + extension);
    await fs.writeFile(filePath, buffer);
    files.push({ fieldname, originalname: fieldname + extension, mimetype: extension === ".pdf" ? "application/pdf" : "image/jpeg", path: filePath, size: buffer.length });
  }
  return files;
}

async function sampleAdmission(name, directory, now = new Date("2026-09-14T06:30:00Z")) {
  const { body, applicationId } = SCENARIOS[name];
  const files = await writeSampleUploads(directory, body);
  const form = normalizeAdmission(body, files, now);
  form.applicationId = applicationId;
  return { form, files };
}

module.exports = { SCENARIOS, SAMPLE_DOCUMENTS, sampleAdmission, writeSampleUploads };
