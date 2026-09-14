const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { PDFDocument } = require("pdf-lib");
const generatePDF = require("../services/pdfGenerator");
const { sampleAdmission, SAMPLE_DOCUMENTS } = require("./pdfFixtures");

const A4_WIDTH = 595;

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

async function render(t, scenario, audience, alter = async () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-pdf-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { form, files } = await sampleAdmission(scenario, directory);
  await alter(files, form);
  const bytes = await fs.readFile(await generatePDF(form, files, directory, { audience }));
  const widths = (await PDFDocument.load(bytes)).getPages().map(page => Math.round(page.getWidth()));
  const formPages = widths.filter(width => width === A4_WIDTH).length;
  assert.ok(formPages >= 2, "the form itself is rendered");
  assert.ok(widths.slice(0, formPages).every(width => width === A4_WIDTH), "attachments follow the form pages");
  return { form, text: extractText(bytes), attachments: widths.slice(formPages), totalPages: widths.length };
}
const pagesFor = fields => fields.flatMap(field => Array(SAMPLE_DOCUMENTS[field].pages).fill(SAMPLE_DOCUMENTS[field].width));

test("admin PDF includes internal information, office use and ordered attachments without photo/signature pages", async t => {
  const { form, text, attachments, totalPages } = await render(t, "indian-package", "admin");
  assert.deepEqual(attachments, pagesFor(["aadhar", "marksheet10", "marksheet12"]));
  for (const expected of ["GROUND SCHOOL ADMISSION FORM", "INTERNAL APPLICATION INFORMATION", form.applicationId, "STUDENT DETAILS", "DGCA INFORMATION", "EDUCATIONAL QUALIFICATION", "PARENT DETAILS", "EMERGENCY CONTACT", "COURSE & ENROLLMENT", "DECLARATION & UNDERTAKING", "SUBMITTED DOCUMENTS", "FOR OFFICE USE ONLY", "Aarav Sharma", "+91 9876543210", "Offline", "Complete Ground School Package", `of ${totalPages}`]) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
  assert.equal(text.includes("JAIPUR LOCAL CONTACT"), false, "Jaipur contact is omitted when not supplied");
});

test("student audience never renders the Application ID or office section", async t => {
  const { form, text, attachments } = await render(t, "indian-package", "student");
  assert.ok(text.includes("Aarav Sharma"));
  assert.equal(attachments.length, 4);
  for (const hidden of [form.applicationId, "SKY-GS", "OFFICE USE", "INTERNAL APPLICATION", "ADMIN"]) assert.equal(text.includes(hidden), false, `leaked ${hidden}`);
});

test("foreign DGCA applicant renders conditional details and passport, marksheets, DGCA result and medical in order", async t => {
  const { text, attachments } = await render(t, "foreign-individual-dgca", "admin");
  assert.deepEqual(attachments, pagesFor(["passport", "marksheet10", "marksheet12", "dgcaExamResult", "dgcaMedicalAssessment"]));
  for (const expected of ["K1234567A", "Singapore", "DGCA-CN-778812", "Air Regulations", "10 Jun 2026", "EGCA-445566", "DGCA Class-1 Medical", "Diploma in Aeronautics", "JAIPUR LOCAL CONTACT", "Rohit Mehra", "Daniel Tan", "Uncle", "+65 91234567", "Individual Subject(s)", "Instagram"]) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
  assert.equal(text.includes("Aadhaar Card"), false, "Aadhaar is not applicable to foreign nationals");
});

test("unreadable or missing uploads do not stop generation and are flagged for the office", async t => {
  const { text, attachments } = await render(t, "indian-package", "admin", async files => {
    await fs.writeFile(files.find(file => file.fieldname === "marksheet12").path, "not a pdf");
    await fs.rm(files.find(file => file.fieldname === "photo").path);
  });
  assert.deepEqual(attachments, pagesFor(["aadhar", "marksheet10"]));
  assert.ok(text.includes("could not be appended"));
  assert.ok(text.includes("Photograph not available"));
});

test("office fields auto-populate ID, class mode and enrollment and leave administrative fields blank", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-pdf-model-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { form } = await sampleAdmission("foreign-individual-dgca", directory);
  const fields = Object.fromEntries(generatePDF.officeFields(form).map(field => [field.label, field]));
  assert.equal(fields["SkyPro Application ID"].value, "SKY-GS-2026-09-0002");
  assert.equal(fields["Class Mode"].value, "Online");
  assert.equal(fields["Course / Subject(s) Enrolled"].value, "Individual Subject(s): Air Navigation, Technical General, Radio Telephony (RTR)");
  for (const label of ["Admission No.", "Batch", "Final Course Fee Payable", "Registration Amount Received", "Registration Payment Date", "Full Fee Received", "Final Payment Date", "Remarks", "Verified By", "Date"]) {
    assert.equal(fields[label].value, undefined, `${label} is left for office completion`);
  }
  assert.deepEqual(generatePDF.buildSections(form).map(section => section.id), ["student", "dgca", "education", "parents", "jaipur", "emergency", "course", "declaration", "documents"]);
  assert.equal(generatePDF.buildSections(form, { audience: "admin" })[0].id, "internal");
  assert.equal(generatePDF.pdfText("Zo\u00eb \u0106wik \u0926\u0947\u0935 "), "Zo\u00eb Cwik ??? ");
});
