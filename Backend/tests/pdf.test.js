const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { PDFDocument, PDFName, PDFRawStream } = require("pdf-lib");
const generatePDF = require("../services/pdfGenerator");
const { sampleAdmission, extractText, SAMPLE_DOCUMENTS } = require("./pdfFixtures");

const A4_WIDTH = 595;

// Image XObjects in a PDF, identified by pixel size (photo 413 × 531, signatures 300 × 150).
async function embeddedImages(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const value = (dict, key) => dict.get(PDFName.of(key));
  return pdf.context.enumerateIndirectObjects().map(([, object]) => object)
    .filter(object => object instanceof PDFRawStream && value(object.dict, "Subtype") === PDFName.of("Image"))
    .map(({ dict }) => ({ size: `${value(dict, "Width").asNumber()}x${value(dict, "Height").asNumber()}`, bits: value(dict, "BitsPerComponent").asNumber(), filter: String(value(dict, "Filter")), transparent: dict.has(PDFName.of("SMask")) }));
}
const imagesOfSize = (images, size) => images.filter(image => image.size === size);

async function setup(t, scenario, alter = async () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-pdf-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { form, files } = await sampleAdmission(scenario, directory);
  await alter(files, form);
  return { directory, form, files };
}

async function inspect(file) {
  const bytes = await fs.readFile(file);
  return { text: extractText(bytes), widths: (await PDFDocument.load(bytes)).getPages().map(page => Math.round(page.getWidth())) };
}

async function render(t, scenario, audience, alter) {
  const { directory, form, files } = await setup(t, scenario, alter);
  const { text, widths } = await inspect(await generatePDF(form, files, directory, { copyType: audience }));
  const formPages = widths.filter(width => width === A4_WIDTH).length;
  assert.ok(formPages >= 2, "the form itself is rendered");
  assert.ok(widths.slice(0, formPages).every(width => width === A4_WIDTH), "attachments follow the form pages");
  return { form, text, attachments: widths.slice(formPages), totalPages: widths.length };
}

// Generates both admin files; `documents` is null when no Documents PDF was produced.
async function renderAdmin(t, scenario, alter) {
  const { directory, form, files } = await setup(t, scenario, alter);
  const formPath = await generatePDF(form, files, directory, { copyType: "admin", part: "form" });
  const documentsPath = await generatePDF(form, files, directory, { copyType: "admin", part: "documents" });
  const safeName = form.fullName.replace(/ /g, "_");
  assert.equal(path.basename(formPath), `SkyPro_GroundSchool_${safeName}_Admin_Form.pdf`);
  if (documentsPath) assert.equal(path.basename(documentsPath), `SkyPro_GroundSchool_${safeName}_Admin_Documents.pdf`);
  const adminForm = await inspect(formPath);
  assert.ok(adminForm.widths.every(width => width === A4_WIDTH), "the admin form has no appended document pages");
  return { form, directory, adminForm, documents: documentsPath && await inspect(documentsPath) };
}

const pagesFor = fields => fields.flatMap(field => Array(SAMPLE_DOCUMENTS[field].pages).fill(SAMPLE_DOCUMENTS[field].width));
const ranges = text => [...text.matchAll(/In Documents PDF - pages? (\d+)(?:-(\d+))?/g)].map(match => [Number(match[1]), Number(match[2] || match[1])]);

// The cover and the form must state the same ranges, and each range must hold that document's pages.
function assertDocumentRanges({ adminForm, documents }, fields) {
  assert.equal(documents.widths[0], A4_WIDTH, "cover page comes first");
  assert.deepEqual(documents.widths.slice(generatePDF.DOCUMENTS_COVER_PAGES), pagesFor(fields));
  const listed = ranges(documents.text);
  assert.equal(listed.length, fields.length);
  assert.deepEqual(ranges(adminForm.text), listed, "form Submitted Documents matches the cover index");
  fields.forEach((field, index) => {
    const [start, end] = listed[index];
    assert.deepEqual(documents.widths.slice(start - 1, end), pagesFor([field]), `${field} is on pages ${start}-${end}`);
  });
}

function assertFormFooter(text, pages, applicationId) {
  const footers = [...text.matchAll(/Page (\d+) of (\d+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  assert.deepEqual(footers, Array.from({ length: pages }, (_, index) => [index + 1, pages]), "footer total counts form pages only");
  assert.ok(text.includes(`Ground School Admission Form  |  ${applicationId}`));
}

test("admin Form PDF includes internal information and office use with no appended pages; Documents PDF holds cover and ordered documents", async t => {
  const result = await renderAdmin(t, "indian-package");
  const { form, adminForm, documents } = result;
  for (const expected of ["ADMIN COPY", "GROUND SCHOOL ADMISSION FORM", "INTERNAL APPLICATION INFORMATION", form.applicationId, "STUDENT DETAILS", "DGCA INFORMATION", "EDUCATIONAL QUALIFICATION", "PARENT DETAILS", "EMERGENCY CONTACT", "COURSE & ENROLLMENT", "DECLARATION & UNDERTAKING", "SUBMITTED DOCUMENTS", "FOR OFFICE USE ONLY", "Aarav Sharma", "+91 9876543210", "Offline", "Complete Ground School Package", "Embedded in this form"]) {
    assert.ok(adminForm.text.includes(expected), `missing ${expected}`);
  }
  assert.equal(adminForm.text.includes("JAIPUR LOCAL CONTACT"), false, "Jaipur contact is omitted when not supplied");
  assert.equal(adminForm.text.includes("Appended"), false);
  assertFormFooter(adminForm.text, adminForm.widths.length, form.applicationId);

  for (const expected of ["SUPPORTING DOCUMENTS", "Aarav Sharma", form.applicationId, "14 Sep 2026, 12:00 IST", "Aadhaar Card", "Class 10 Marksheet", "Class 12 Marksheet", `Page 1 of ${documents.widths.length}`]) {
    assert.ok(documents.text.includes(expected), `cover missing ${expected}`);
  }
  assert.deepEqual(ranges(documents.text), [[2, 2], [3, 4], [5, 5]]);
  assertDocumentRanges(result, ["aadhar", "marksheet10", "marksheet12"]);
  for (const hidden of ["Passport", "DGCA Exam Result", "DGCA Medical Assessment"]) assert.equal(documents.text.includes(hidden), false, `${hidden} is not applicable`);
});

test("student audience never renders the Application ID or office section", async t => {
  const { form, text, attachments } = await render(t, "indian-package", "student");
  assert.ok(text.includes("Aarav Sharma"));
  assert.ok(text.includes("STUDENT COPY"));
  assert.equal(attachments.length, 4);
  for (const hidden of [form.applicationId, "SKY-GS", "OFFICE USE", "INTERNAL APPLICATION", "ADMIN COPY", "Admission No.", "Verified By", "Remarks"]) assert.equal(text.includes(hidden), false, `leaked ${hidden}`);
});

test("student copy stays a single file with appended documents and appended page numbers", async t => {
  const { text, attachments, totalPages } = await render(t, "foreign-individual-dgca", "student");
  assert.deepEqual(attachments, pagesFor(["passport", "marksheet10", "marksheet12", "dgcaExamResult", "dgcaMedicalAssessment"]));
  const formPages = totalPages - attachments.length;
  assert.ok(text.includes(`Appended - page ${formPages + 1}`));
  assert.ok(text.includes(`Page 1 of ${totalPages}`));
  assert.equal(text.includes("In Documents PDF"), false);
  assert.equal(text.includes("SUPPORTING DOCUMENTS"), false);
});

test("foreign DGCA applicant renders conditional details and passport, marksheets, DGCA result and medical in order", async t => {
  const result = await renderAdmin(t, "foreign-individual-dgca");
  assertDocumentRanges(result, ["passport", "marksheet10", "marksheet12", "dgcaExamResult", "dgcaMedicalAssessment"]);
  for (const expected of ["K1234567A", "Singapore", "DGCA-CN-778812", "Air Regulations", "10 Jun 2026", "EGCA-445566", "DGCA Class-1 Medical", "Diploma in Aeronautics", "JAIPUR LOCAL CONTACT", "Rohit Mehra", "Daniel Tan", "Uncle", "+65 91234567", "Individual Subject(s)", "Instagram"]) {
    assert.ok(result.adminForm.text.includes(expected), `missing ${expected}`);
  }
  assertFormFooter(result.adminForm.text, result.adminForm.widths.length, result.form.applicationId);
  assert.equal(result.adminForm.text.includes("Aadhaar Card"), false, "Aadhaar is not applicable to foreign nationals");
  assert.equal(result.documents.text.includes("Aadhaar Card"), false);
});

test("unreadable or missing uploads do not stop generation and are flagged for the office", async t => {
  const result = await renderAdmin(t, "indian-package", async files => {
    await fs.writeFile(files.find(file => file.fieldname === "marksheet12").path, "not a pdf");
    await fs.rm(files.find(file => file.fieldname === "photo").path);
  });
  assertDocumentRanges(result, ["aadhar", "marksheet10"]);
  for (const text of [result.adminForm.text, result.documents.text]) {
    assert.ok(text.includes("Class 12 Marksheet"));
    assert.ok(text.includes("could not be appended"));
  }
  assert.ok(result.adminForm.text.includes("Photograph not available"));
});

test("no Documents PDF is produced when no supporting document can be appended", async t => {
  const { form, directory, adminForm, documents } = await renderAdmin(t, "indian-package", async files => {
    for (const file of files.filter(candidate => candidate.mimetype === "application/pdf")) await fs.writeFile(file.path, "not a pdf");
  });
  assert.equal(documents, null);
  assert.equal((await fs.readdir(directory)).includes(generatePDF.admissionPdfName(form.fullName, "admin", "documents")), false);
  assert.equal(adminForm.text.match(/could not be appended/g).length, 3);
  assert.equal(ranges(adminForm.text).length, 0);
  assertFormFooter(adminForm.text, adminForm.widths.length, form.applicationId);
});

test("JPEG photo and signatures are embedded unchanged in the admin form and student copy", async t => {
  const { directory, form, files } = await setup(t, "indian-package");
  for (const options of [{ copyType: "admin", part: "form" }, { copyType: "student" }]) {
    const images = await embeddedImages(await fs.readFile(await generatePDF(form, files, directory, options)));
    assert.deepEqual(imagesOfSize(images, "413x531").map(image => image.filter), ["/DCTDecode"], `${options.copyType} photo`);
    assert.deepEqual(imagesOfSize(images, "300x150").map(image => image.filter), ["/DCTDecode", "/DCTDecode"], `${options.copyType} signatures`);
  }
});

test("PNG photo and transparent PNG signatures are embedded on white in the admin form and student copy", async t => {
  const { directory, form, files } = await setup(t, "indian-png-images");
  const images = files.filter(file => file.mimetype === "image/png");
  assert.deepEqual(images.map(file => file.fieldname).sort(), ["parentSignature", "photo", "signature"]);
  assert.equal((await sharp(files.find(file => file.fieldname === "signature").path).metadata()).hasAlpha, true, "fixture signature is transparent");
  const hashes = async () => Promise.all(images.map(async file => createHash("sha256").update(await fs.readFile(file.path)).digest("hex")));
  const before = await hashes();
  for (const options of [{ copyType: "admin", part: "form" }, { copyType: "student" }]) {
    const bytes = await fs.readFile(await generatePDF(form, files, directory, options));
    const text = extractText(bytes);
    for (const placeholder of ["Photograph not available", "Student Signature not available", "Parent/Guardian Signature not available"]) assert.equal(text.includes(placeholder), false, `${options.copyType}: ${placeholder}`);
    const embedded = await embeddedImages(bytes);
    const photo = imagesOfSize(embedded, "413x531");
    const signatures = imagesOfSize(embedded, "300x150");
    assert.equal(photo.length, 1, `${options.copyType} photo`);
    assert.equal(signatures.length, 2, `${options.copyType} signatures`);
    for (const image of [...photo, ...signatures]) assert.deepEqual([image.bits, image.transparent], [8, false], "8-bit and flattened onto white");
  }
  assert.deepEqual(await hashes(), before, "uploaded files are not modified");
});

test("16-bit, interlaced, palette and grayscale-alpha PNG uploads are converted and embedded", async t => {
  const { directory, form, files } = await setup(t, "indian-png-images");
  const variants = {
    photo: sharp({ create: { width: 413, height: 531, channels: 4, background: { r: 120, g: 150, b: 190, alpha: 1 } } }).toColourspace("rgb16").png(),
    signature: sharp({ create: { width: 300, height: 150, channels: 4, background: { r: 20, g: 40, b: 90, alpha: 0.4 } } }).png({ progressive: true }),
    parentSignature: sharp({ create: { width: 300, height: 150, channels: 4, background: { r: 20, g: 40, b: 90, alpha: 0.6 } } }).png({ palette: true, colours: 8 }),
  };
  for (const [field, image] of Object.entries(variants)) await fs.writeFile(files.find(file => file.fieldname === field).path, await image.toBuffer());
  const metadata = await Promise.all(Object.keys(variants).map(field => sharp(files.find(file => file.fieldname === field).path).metadata()));
  assert.deepEqual(metadata.map(item => [item.depth, item.isProgressive, item.isPalette]), [["ushort", false, false], ["uchar", true, false], ["uchar", false, true]]);
  const grayscale = await sharp({ create: { width: 300, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).toColourspace("b-w").png().toBuffer();
  for (const options of [{ copyType: "admin", part: "form" }, { copyType: "student" }]) {
    const embedded = await embeddedImages(await fs.readFile(await generatePDF(form, files, directory, options)));
    assert.equal(imagesOfSize(embedded, "413x531").length, 1);
    assert.equal(imagesOfSize(embedded, "300x150").length, 2);
    assert.ok([...imagesOfSize(embedded, "413x531"), ...imagesOfSize(embedded, "300x150")].every(image => image.bits === 8 && !image.transparent));
  }
  await fs.writeFile(files.find(file => file.fieldname === "signature").path, grayscale);
  const embedded = await embeddedImages(await fs.readFile(await generatePDF(form, files, directory, { copyType: "student" })));
  assert.equal(imagesOfSize(embedded, "300x150").length, 2, "grayscale-alpha signature embedded");
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
  assert.equal(generatePDF.pdfText("Zoë Ćwik देव "), "Zoë Cwik ??? ");
});


test("both copies share all applicant sections and sanitize filenames", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-copy-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { form, files } = await sampleAdmission("foreign-individual-dgca", directory);
  const adminSections = generatePDF.buildSections(form, { audience: "admin" }).filter(section => section.id !== "internal");
  assert.deepEqual(adminSections, generatePDF.buildSections(form, { audience: "student" }));
  const texts = [];
  for (const options of [{ copyType: "admin", part: "form" }, { copyType: "student" }]) {
    const target = await generatePDF(form, files, directory, options);
    assert.equal(path.basename(target), generatePDF.admissionPdfName(form.fullName, options.copyType, options.part));
    texts.push(extractText(await fs.readFile(target)));
  }
  for (const section of adminSections) {
    for (const row of section.rows || []) {
      const value = generatePDF.pdfText(row.value);
      if (value && !value.includes("\n")) {
        for (const text of texts) assert.ok(text.replace(/\s/g, "").includes(value.replace(/\s/g, "")), `missing shared value: ${value}`);
      }
    }
  }
  assert.equal(generatePDF.admissionPdfName("../../<>:", "student"), "SkyPro_GroundSchool_Student_Student_Copy.pdf");
  assert.equal(generatePDF.admissionPdfName("../../<>:", "admin", "form"), "SkyPro_GroundSchool_Student_Admin_Form.pdf");
  assert.equal(generatePDF.admissionPdfName("Mei Lin Tan", "admin", "documents"), "SkyPro_GroundSchool_Mei_Lin_Tan_Admin_Documents.pdf");
  assert.throws(() => generatePDF.admissionPdfName("Mei Lin Tan", "admin"), /admin PDF part/);
  await assert.rejects(generatePDF(form, files, directory, { copyType: "admin" }), /admin PDF part/);
});
