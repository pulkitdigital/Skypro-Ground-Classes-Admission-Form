const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLib } = require("pdf-lib");
const { formatDate, formatDateTime, phone } = require("./formatting");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 45;
const WIDTH = PAGE_WIDTH - LEFT * 2;
const LABEL_WIDTH = 150;
const HEADER_PATH = path.join(__dirname, "../assets/header.png");
const FOOTER_PATH = path.join(__dirname, "../assets/footer.png");
const FONT = { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" };
const COLOR = { navy: "#003366", gold: "#f4b221", text: "#1a1a1a", muted: "#5f6b7a", faint: "#a3adb8", line: "#c9d3df", shade: "#f5f7fa", auto: "#eaf2fb" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Keep in sync with Frontend/src/DeclarationDetails.jsx.
const DECLARATION_PARAGRAPHS = [
  "I declare that the information provided by me in this admission form is true and correct to the best of my knowledge. I understand that providing incorrect or misleading information may affect my enrollment.",
  "I understand that submission of this form constitutes my enrollment with the SkyPro Aviation Ground School and does not, by itself, guarantee any DGCA examination result, licence, medical certification, or other regulatory approval.",
  "I confirm that all documents submitted/uploaded by me are genuine and belong to me.",
  "I acknowledge that I have read and accepted the applicable course terms, fee policy, cancellation/refund policy, and student guidelines.",
  "I consent to SkyPro Aviation collecting, storing, and using the information and documents submitted by me for the purposes of admission, student administration, academic records, fee/payment administration, and course-related communication.",
];

// Photo and signatures are embedded in the form; documents are appended in this order.
const EMBEDDED_UPLOADS = [["photo", "Passport-size Photograph"], ["signature", "Student Signature"], ["parentSignature", "Parent/Guardian Signature"]];
const APPENDED_UPLOADS = [["aadhar", "Aadhaar Card"], ["passport", "Passport"], ["marksheet10", "Class 10 Marksheet"], ["marksheet12", "Class 12 Marksheet"], ["dgcaExamResult", "DGCA Exam Result"], ["dgcaMedicalAssessment", "DGCA Medical Assessment"]];

// Standard PDF fonts encode WinAnsi only; anything else would corrupt the text stream.
const WIN_ANSI_EXTRAS = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
const encodable = code => (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(code);
function pdfText(value) {
  return String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/[^\S\n]/g, " ").replace(/[^\n]/gu, char => {
    if (encodable(char.codePointAt(0))) return char;
    const base = char.normalize("NFKD").replace(/\p{M}/gu, "");
    return base && [...base].every(part => encodable(part.codePointAt(0))) ? base : "?";
  });
}

const numbered = values => (Array.isArray(values) ? values : []).map((value, index) => `${index + 1}. ${value}`).join("\n");
const address = (street, city, state) => [street, [city, state].filter(Boolean).join(", ")].filter(Boolean).join("\n");
const isPackage = form => (form.courseSelection || form.course) === "Complete Ground School Package";

function enrolledCourse(form) {
  const subjects = (form.enrollmentSubjects || []).join(", ");
  if (isPackage(form)) return `Complete Ground School Package${subjects ? ` (all subjects: ${subjects})` : ""}`;
  return `Individual Subject(s)${subjects ? `: ${subjects}` : ""}`;
}

function uploadApplies(field, form, files) {
  return files.some(file => file.fieldname === field) || require("./admissionContract").applicableUploads(form).has(field);
}

function buildSections(form, { audience = "student" } = {}) {
  const row = (label, value, fallback = "Not provided") => ({ label, value: value === undefined || value === null || value === "" ? fallback : String(value) });
  const na = "Not applicable";
  const sections = [];
  if (audience === "admin") {
    sections.push({ id: "internal", title: "Internal Application Information", tag: "ADMIN ONLY", rows: [
      row("SkyPro Application ID", form.applicationId, "Not allocated"),
      row("Submitted On", formatDateTime(form.submittedAt)),
    ] });
  }
  const foreign = form.nationality === "Foreign National";
  sections.push({ id: "student", title: "Student Details", photo: true, rows: [
    row("Full Name", form.fullName),
    row("Date of Birth", formatDate(form.dob)),
    row("Age", Number.isInteger(form.age) ? `${form.age} years` : ""),
    row("Gender", form.gender),
    row("WhatsApp Number", phone(form.mobileCountryCode, form.mobile)),
    row("Email Address", form.email),
    row("Nationality", form.nationality),
    ...(foreign ? [row("Country of Citizenship", form.countryOfCitizenship), row("Passport Number", form.passportNumber), row("Passport Expiry Date", formatDate(form.passportExpiryDate))] : []),
    row("Permanent Address", address(form.permanentAddress, form.permanentCity, form.permanentState)),
    row("Current Address", address(form.currentAddress, form.currentCity, form.currentState)),
  ] });

  const computer = form.hasDgcaComputerNumber === "Yes";
  const cleared = computer && form.dgcaPapersCleared === "Yes";
  const egca = form.hasEgcaId === "Yes";
  const medical = egca && form.hasDgcaMedical === "Yes";
  sections.push({ id: "dgca", title: "DGCA Information", rows: [
    row("DGCA Computer Number Status", form.hasDgcaComputerNumber),
    row("DGCA Computer Number", computer ? form.dgcaComputerNumber : na),
    row("DGCA Papers Cleared", computer ? form.dgcaPapersCleared : na),
    ...(cleared ? [row("Papers Cleared", numbered(form.dgcaSubjects)), row("Exam Result Date", formatDate(form.dgcaExamResultDate))] : []),
    row("eGCA ID Status", form.hasEgcaId),
    row("eGCA ID", egca ? form.egcaId : na),
    row("DGCA Medical Status", egca ? form.hasDgcaMedical : na),
    ...(medical ? [row("DGCA Medical Class", form.dgcaMedicalClass)] : []),
    row("Previous Flying Experience", form.previousFlyingExperience),
  ] });

  sections.push({ id: "education", title: "Educational Qualification", rows: [
    row("Highest Qualification", form.highestQualification === "Other" ? `Other: ${form.otherQualification || ""}` : form.highestQualification),
    row("Physics & Mathematics (10+2)", form.physicsMathematicsStatus),
  ] });

  const parent = (prefix, label) => [{ subheading: label }, row("Name", form[`${prefix}Name`]), row("Mobile Number", phone(form[`${prefix}MobileCountryCode`], form[`${prefix}Mobile`])), row("Email Address", form[`${prefix}Email`]), row("Occupation", form[`${prefix}Occupation`])];
  sections.push({ id: "parents", title: "Parent Details", rows: [...parent("father", "Father"), ...parent("mother", "Mother")] });

  if (form.hasJaipurContact === "Yes") {
    sections.push({ id: "jaipur", title: "Jaipur Local Contact", rows: [
      row("Name", form.jaipurContactName),
      row("Relationship", form.jaipurContactRelationship),
      row("Mobile Number", phone(form.jaipurContactMobileCountryCode, form.jaipurContactMobile)),
      row("Address in Jaipur", form.jaipurContactAddress),
    ] });
  }

  const emergency = form.emergencyContact || {};
  sections.push({ id: "emergency", title: "Emergency Contact", rows: [
    row("Selected Contact", emergency.source),
    row("Name", emergency.name),
    row("Relationship", emergency.relationship),
    row("Mobile Number", phone(emergency.countryCode, emergency.mobile)),
  ] });

  sections.push({ id: "course", title: "Course & Enrollment", rows: [
    row("Course Selection", form.courseSelection || form.course),
    row(isPackage(form) ? "Subjects Included" : "Subjects Enrolled", numbered(form.enrollmentSubjects)),
    row("Mode of Class", form.modeOfClass),
    row("How Did You Hear About SkyPro", form.heardAboutSkypro),
  ] });

  sections.push({ id: "declaration", title: "Declaration & Undertaking", declaration: true, rows: [
    row("Declaration Accepted", form.declarationAccepted === true ? "Yes - accepted electronically at submission" : "No"),
    row("Student Name", form.declarationStudentName),
    row("Declaration Date", formatDate(form.declarationDate)),
  ] });
  sections.push({ id: "documents", title: "Submitted Documents", documents: true, rows: [] });
  return sections;
}

// Office Use is rendered only for the admin audience.
function officeFields(form) {
  return [
    { label: "SkyPro Application ID", value: form.applicationId || "Not allocated", auto: true },
    { label: "Admission No." },
    { label: "Batch" },
    { label: "Class Mode", value: form.modeOfClass || "", auto: Boolean(form.modeOfClass) },
    { label: "Course / Subject(s) Enrolled", value: enrolledCourse(form), auto: true, span: 2 },
    { label: "Final Course Fee Payable", kind: "amount", span: 2 },
    { label: "Registration Amount Received", kind: "amount" },
    { label: "Registration Payment Date", kind: "date" },
    { label: "Full Fee Received", kind: "amount" },
    { label: "Final Payment Date", kind: "date" },
    { label: "Remarks", span: 2, height: 64 },
    { label: "Verified By" },
    { label: "Date", kind: "date" },
  ];
}

// Merges the applicable supporting documents, unmodified, in APPENDED_UPLOADS order.
// Each result's `offset` is its 0-based position within the merged bundle.
async function prepareAttachments(form, files) {
  const bundle = await PDFLib.create();
  const results = [];
  for (const [field, label] of APPENDED_UPLOADS) {
    if (!uploadApplies(field, form, files)) continue;
    const file = files.find(candidate => candidate.fieldname === field);
    if (!file) { results.push({ field, label, status: "missing" }); continue; }
    try {
      if (file.mimetype !== "application/pdf") throw new Error("unsupported format");
      const source = await PDFLib.load(await fsp.readFile(file.path));
      const pages = await bundle.copyPages(source, source.getPageIndices());
      const offset = bundle.getPageCount();
      pages.forEach(page => bundle.addPage(page));
      results.push({ field, label, status: "appended", offset, pageCount: pages.length });
    } catch (error) {
      console.error(`Could not append ${label} to admission PDF:`, error.message);
      results.push({ field, label, status: "failed" });
    }
  }
  return { bundle, results };
}

// The admin Documents PDF starts with a one-page cover/index before the documents.
const DOCUMENTS_COVER_PAGES = 1;
const IN_DOCUMENTS_PDF = "In Documents PDF";

// Shared status text for the form's Submitted Documents section and the documents cover.
function documentStatus(result, prefix, pagesBefore) {
  if (result.status === "failed") return "Uploaded, but could not be appended - request the original from the student";
  if (result.status !== "appended") return "Not provided";
  const start = pagesBefore + result.offset + 1;
  return result.pageCount === 1 ? `${prefix} - page ${start}` : `${prefix} - pages ${start}-${start + result.pageCount - 1}`;
}

// Cover page plus the merged documents. `pdf` is null when no document could be appended.
async function buildDocumentsPdf(form, files) {
  const { bundle, results } = await prepareAttachments(form, files);
  if (!bundle.getPageCount()) return { pdf: null, results };
  const totalPages = DOCUMENTS_COVER_PAGES + bundle.getPageCount();
  const pdf = await PDFLib.load(await renderPdf("SkyPro Ground School Supporting Documents", doc => documentsCover(doc, form, results, totalPages)));
  if (pdf.getPageCount() !== DOCUMENTS_COVER_PAGES) throw new Error("Supporting documents cover did not fit on one page");
  (await pdf.copyPages(bundle, bundle.getPageIndices())).forEach(page => pdf.addPage(page));
  return { pdf, results };
}

function renderPdf(title, draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: { Title: title, Author: "SkyPro Aviation" } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc);
      doc.end();
    } catch (error) { reject(error); }
  });
}

const renderForm = (form, files, attachments, options) =>
  renderPdf("SkyPro Ground School Admission Form", doc => layout(doc, form, files, attachments, options));

// Page furniture and drawing primitives shared by the form and the documents cover.
function pageKit(doc) {
  const openAsset = file => { try { return fs.existsSync(file) ? doc.openImage(file) : null; } catch { return null; } };
  const header = openAsset(HEADER_PATH);
  const footer = openAsset(FOOTER_PATH);
  const headerHeight = header ? PAGE_WIDTH * header.height / header.width : 0;
  const footerHeight = footer ? PAGE_WIDTH * footer.height / footer.width : 0;
  const top = headerHeight + 22;
  const bottom = PAGE_HEIGHT - footerHeight - 30;
  const branding = () => {
    if (header) doc.image(header, 0, 0, { width: PAGE_WIDTH, height: headerHeight });
    if (footer) doc.image(footer, 0, PAGE_HEIGHT - footerHeight, { width: PAGE_WIDTH, height: footerHeight });
  };
  const measure = (text, font, size, width) => doc.font(font).fontSize(size).heightOfString(pdfText(text), { width, lineGap: 1.5 });
  const write = (text, x, atY, { font = FONT.regular, size = 9.5, color = COLOR.text, width, align = "left" } = {}) =>
    doc.font(font).fontSize(size).fillColor(color).text(pdfText(text), x, atY, { width, align, lineGap: 1.5 });
  const rule = (x1, x2, atY, color = COLOR.line, lineWidth = 0.5) => doc.moveTo(x1, atY).lineTo(x2, atY).lineWidth(lineWidth).strokeColor(color).stroke();
  const rowHeight = (label, sample, width) => Math.max(measure(label, FONT.bold, 9, LABEL_WIDTH - 16), measure(sample, FONT.regular, 9.5, width - LABEL_WIDTH - 10)) + 10;
  // Draws a shaded label/value row; a non-string value is left for the caller to fill.
  const labelRow = (label, value, atY, index, width, height) => {
    if (index % 2 === 0) doc.rect(LEFT, atY, width, height).fill(COLOR.shade);
    rule(LEFT, LEFT + width, atY + height);
    write(label, LEFT + 8, atY + 5, { font: FONT.bold, size: 9, color: COLOR.navy, width: LABEL_WIDTH - 16 });
    if (typeof value === "string") write(value, LEFT + LABEL_WIDTH, atY + 5, { width: width - LABEL_WIDTH - 10 });
  };
  const copyBadge = (label, atY) => {
    doc.rect(PAGE_WIDTH / 2 - 120, atY, 240, 18).fill(COLOR.gold);
    write(label, PAGE_WIDTH / 2 - 120, atY + 4, { font: FONT.bold, size: 10, color: COLOR.navy, width: 240, align: "center" });
  };
  const pageFooter = (label, index, totalPages) => {
    write(label, LEFT, bottom + 10, { size: 7.5, color: COLOR.muted, width: WIDTH / 2 });
    write(`Page ${index + 1} of ${totalPages}`, LEFT + WIDTH / 2, bottom + 10, { size: 7.5, color: COLOR.muted, width: WIDTH / 2, align: "right" });
  };
  return { top, bottom, branding, measure, write, rule, rowHeight, labelRow, copyBadge, pageFooter };
}

function documentsCover(doc, form, results, totalPages) {
  const { top, branding, write, rule, rowHeight, labelRow, copyBadge, pageFooter } = pageKit(doc);
  let y = top;
  branding();
  copyBadge("ADMIN COPY", y);
  y += 26;
  write("SUPPORTING DOCUMENTS", LEFT, y, { font: FONT.bold, size: 19, color: COLOR.navy, width: WIDTH, align: "center" });
  y += 26;
  rule(PAGE_WIDTH / 2 - 110, PAGE_WIDTH / 2 + 110, y, COLOR.gold, 2.5);
  y += 8;
  write("SkyPro Aviation  |  Ground School Admission", LEFT, y, { size: 9, color: COLOR.muted, width: WIDTH, align: "center" });
  y += 30;

  const table = (title, list) => {
    doc.rect(LEFT, y, WIDTH, 22).fill(COLOR.navy);
    write(title, LEFT + 10, y + 6.5, { font: FONT.bold, size: 10.5, color: "#ffffff", width: WIDTH - 20 });
    y += 26;
    list.forEach(([label, value], index) => {
      const height = rowHeight(label, value, WIDTH);
      labelRow(label, value, y, index, WIDTH, height);
      y += height;
    });
    y += 14;
  };
  table("APPLICATION", [
    ["Student Full Name", form.fullName || "Not provided"],
    ["SkyPro Application ID", form.applicationId || "Not allocated"],
    ["Submitted On", formatDateTime(form.submittedAt) || "Not provided"],
  ]);
  table("DOCUMENT INDEX", results.map(result => [result.label, documentStatus(result, IN_DOCUMENTS_PDF, DOCUMENTS_COVER_PAGES)]));
  write("Page numbers refer to this PDF. Documents follow this page as uploaded, in the order listed.", LEFT, y, { font: FONT.italic, size: 8, color: COLOR.muted, width: WIDTH });
  pageFooter(form.applicationId ? `Supporting Documents  |  ${form.applicationId}` : "Supporting Documents", 0, totalPages);
}

// The student form is followed by its appended documents (`appendedPageCount`); the admin
// form stands alone and points to page ranges in the separate Documents PDF.
function layout(doc, form, files, attachments, { audience, appendedPageCount }) {
  const admin = audience === "admin";
  const { top, bottom, branding, measure, write, rule, rowHeight, labelRow, copyBadge, pageFooter } = pageKit(doc);
  let y = top;
  let page = 0;
  let sectionNumber = 0;
  let reserve = null;
  const deferred = [];

  const newPage = () => { doc.addPage({ size: "A4", margin: 0 }); page++; branding(); y = top; };
  const ensure = height => { if (y + height > bottom) newPage(); };

  function imageBox(field, x, atY, width, height, placeholder) {
    doc.rect(x, atY, width, height).lineWidth(1).strokeColor(COLOR.navy).stroke();
    const file = files.find(candidate => candidate.fieldname === field);
    if (file?.path && fs.existsSync(file.path)) {
      try { doc.image(file.path, x + 4, atY + 4, { fit: [width - 8, height - 8], align: "center", valign: "center" }); return; }
      catch (error) { console.error(`Could not embed ${field} in admission PDF:`, error.message); }
    }
    write(placeholder, x + 4, atY + height / 2 - 5, { size: 8, color: COLOR.muted, width: width - 8, align: "center" });
  }

  function sectionHeader(title, { tag, minBody = 40 } = {}) {
    ensure(26 + minBody);
    doc.rect(LEFT, y, WIDTH, 22).fill(COLOR.navy);
    write(`${++sectionNumber}. ${title.toUpperCase()}`, LEFT + 10, y + 6.5, { font: FONT.bold, size: 10.5, color: "#ffffff", width: WIDTH - 120 });
    if (tag) {
      doc.rect(LEFT + WIDTH - 92, y + 4, 84, 14).fill(COLOR.gold);
      write(tag, LEFT + WIDTH - 92, y + 7.5, { font: FONT.bold, size: 7.5, color: COLOR.navy, width: 84, align: "center" });
    }
    y += 26;
  }

  function fieldRow(label, value, index) {
    const sample = typeof value === "function" ? "Appended - pages 999-999" : value;
    const size = () => {
      const width = reserve && reserve.page === page && y < reserve.bottom ? WIDTH - reserve.width : WIDTH;
      return { width, height: rowHeight(label, sample, width) };
    };
    let box = size();
    const before = page;
    ensure(box.height);
    if (page !== before) box = size();
    labelRow(label, value, y, index, box.width, box.height);
    if (typeof value === "function") deferred.push({ page, x: LEFT + LABEL_WIDTH, y: y + 5, width: box.width - LABEL_WIDTH - 10, value });
    y += box.height;
  }

  function rows(list) {
    let index = 0;
    for (const item of list) {
      if (item.subheading) {
        ensure(20 + 24);
        write(item.subheading.toUpperCase(), LEFT + 2, y + 4, { font: FONT.bold, size: 9, color: COLOR.navy, width: WIDTH });
        rule(LEFT, LEFT + WIDTH, y + 16, COLOR.gold, 1);
        y += 20; index = 0;
      } else fieldRow(item.label, item.value, index++);
    }
  }

  function declaration(section) {
    sectionHeader(section.title, { minBody: 60 });
    for (const paragraph of DECLARATION_PARAGRAPHS) {
      const height = measure(paragraph, FONT.regular, 9, WIDTH - 20) + 5;
      ensure(height);
      write(paragraph, LEFT + 10, y, { size: 9, width: WIDTH - 20, align: "justify" });
      y += height;
    }
    y += 4;
    rows(section.rows);
    const boxWidth = (WIDTH - 20) / 2;
    const boxHeight = 64;
    y += 10;
    ensure(14 + boxHeight + 6);
    [["signature", "Student Signature"], ["parentSignature", "Parent/Guardian Signature"]].forEach(([field, label], index) => {
      const x = LEFT + index * (boxWidth + 20);
      write(label, x, y, { font: FONT.bold, size: 9, color: COLOR.navy, width: boxWidth });
      imageBox(field, x, y + 13, boxWidth, boxHeight, `${label} not available`);
    });
    y += 13 + boxHeight;
  }

  function documents(section) {
    sectionHeader(section.title);
    const list = [];
    for (const [field, label] of EMBEDDED_UPLOADS) {
      list.push({ label, value: files.some(file => file.fieldname === field) ? "Embedded in this form" : "Not provided" });
    }
    for (const result of attachments) {
      // Appended student pages are numbered once the form's own page count is known.
      const value = result.status === "appended" && !admin
        ? mainPages => documentStatus(result, "Appended", mainPages)
        : documentStatus(result, IN_DOCUMENTS_PDF, DOCUMENTS_COVER_PAGES);
      list.push({ label: result.label, value });
    }
    rows(list);
  }

  function officeUse() {
    const fields = officeFields(form);
    const gap = 14;
    const column = (WIDTH - gap) / 2;
    const grid = [];
    let pair = [];
    for (const field of fields) {
      if (field.span === 2) { if (pair.length) grid.push(pair); pair = []; grid.push([field]); }
      else { pair.push(field); if (pair.length === 2) { grid.push(pair); pair = []; } }
    }
    if (pair.length) grid.push(pair);
    const widthOf = field => field.span === 2 ? WIDTH : column;
    const boxHeight = field => field.height || Math.max(22, field.value ? measure(field.value, FONT.regular, 9.5, widthOf(field) - 12) + 10 : 22);
    const rowHeight = line => 12 + Math.max(...line.map(boxHeight)) + 9;
    const total = 30 + 16 + grid.reduce((sum, line) => sum + rowHeight(line), 0);
    ensure(Math.min(total, bottom - top));

    doc.rect(LEFT, y, WIDTH, 24).fill(COLOR.navy);
    doc.rect(LEFT, y + 24, WIDTH, 2).fill(COLOR.gold);
    write("FOR OFFICE USE ONLY", LEFT + 10, y + 7, { font: FONT.bold, size: 11.5, color: "#ffffff", width: WIDTH - 120 });
    doc.rect(LEFT + WIDTH - 92, y + 5, 84, 14).fill(COLOR.gold);
    write("ADMIN ONLY", LEFT + WIDTH - 92, y + 8.5, { font: FONT.bold, size: 7.5, color: COLOR.navy, width: 84, align: "center" });
    y += 32;
    write("Shaded (auto) boxes were filled from the submission. Complete the remaining boxes by hand.", LEFT, y, { font: FONT.italic, size: 8, color: COLOR.muted, width: WIDTH });
    y += 16;
    for (const line of grid) {
      const height = rowHeight(line);
      ensure(height);
      const inner = height - 21;
      line.forEach((field, index) => {
        const width = widthOf(field);
        const x = LEFT + index * (column + gap);
        const boxY = y + 12;
        write(field.auto ? `${field.label} (auto)` : field.label, x, y, { font: FONT.bold, size: 8.5, color: COLOR.navy, width });
        if (field.auto) doc.rect(x, boxY, width, inner).fill(COLOR.auto);
        doc.rect(x, boxY, width, inner).lineWidth(0.8).strokeColor(COLOR.line).stroke();
        if (field.value) write(field.value, x + 6, boxY + 6, { width: width - 12 });
        else if (field.kind === "amount") write("INR", x + 6, boxY + inner / 2 - 4.5, { size: 8.5, color: COLOR.muted, width: 30 });
        else if (field.kind === "date") write("DD / MM / YYYY", x + width - 96, boxY + inner / 2 - 4.5, { size: 8, color: COLOR.faint, width: 90, align: "right" });
      });
      y += height;
    }
  }

  branding();
  copyBadge(admin ? "ADMIN COPY" : "STUDENT COPY", y);
  y += 26;
  write("GROUND SCHOOL ADMISSION FORM", LEFT, y, { font: FONT.bold, size: 19, color: COLOR.navy, width: WIDTH, align: "center" });
  y += 26;
  rule(PAGE_WIDTH / 2 - 110, PAGE_WIDTH / 2 + 110, y, COLOR.gold, 2.5);
  y += 8;
  write(["SkyPro Aviation", formatDateTime(form.submittedAt) && `Submitted ${formatDateTime(form.submittedAt)}`].filter(Boolean).join("  |  "), LEFT, y, { size: 9, color: COLOR.muted, width: WIDTH, align: "center" });
  y += 16;
  y += 8;

  for (const section of buildSections(form, { audience })) {
    if (section.declaration) declaration(section);
    else if (section.documents) documents(section);
    else {
      const photoWidth = 100;
      const photoHeight = 125;
      sectionHeader(section.title, { tag: section.tag, minBody: section.photo ? photoHeight + 10 : 40 });
      if (section.photo) {
        imageBox("photo", LEFT + WIDTH - photoWidth, y, photoWidth, photoHeight, "Photograph not available");
        reserve = { page, bottom: y + photoHeight + 8, width: photoWidth + 12 };
      }
      rows(section.rows);
      if (reserve?.page === page) y = Math.max(y, reserve.bottom);
      reserve = null;
    }
    y += 14;
  }
  if (admin) { officeUse(); y += 14; }
  ensure(14);
  write("This is a computer-generated admission form.", LEFT, y, { font: FONT.italic, size: 8, color: COLOR.muted, width: WIDTH, align: "center" });

  const mainPages = doc.bufferedPageRange().count;
  for (const cell of deferred) {
    doc.switchToPage(cell.page);
    write(cell.value(mainPages), cell.x, cell.y, { width: cell.width });
  }
  const totalPages = mainPages + appendedPageCount;
  const footerLabel = admin && form.applicationId ? `Ground School Admission Form  |  ${form.applicationId}` : "Ground School Admission Form";
  for (let index = 0; index < mainPages; index++) {
    doc.switchToPage(index);
    pageFooter(footerLabel, index, totalPages);
  }
}

const ADMIN_PARTS = ["form", "documents"];

// Student: one PDF, form followed by the appended documents.
// Admin: `part: "form"` (form pages only) or `part: "documents"` (cover + documents);
// the documents part resolves to null when no document could be appended.
async function generatePDF(formData, uploadedFiles = [], outputDirectory, options = {}) {
  const audience = options.copyType ?? options.audience ?? "student";
  if (!["admin", "student"].includes(audience)) throw new Error(`Unknown PDF audience: ${audience}`);
  const part = audience === "admin" ? options.part : undefined;
  if (audience === "admin" && !ADMIN_PARTS.includes(part)) throw new Error(`Unknown admin PDF part: ${part}`);
  const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const directory = outputDirectory || path.join(__dirname, "../uploads");
  await fsp.mkdir(directory, { recursive: true });

  let output;
  if (part === "documents") {
    output = (await buildDocumentsPdf(formData, files)).pdf;
    if (!output) return null;
  } else {
    // Page ranges come from the merge, so they are known before the form is rendered.
    const { bundle, results } = await prepareAttachments(formData, files);
    const appendedPageCount = audience === "student" ? bundle.getPageCount() : 0;
    output = await PDFLib.load(await renderForm(formData, files, results, { audience, appendedPageCount }));
    if (appendedPageCount) (await output.copyPages(bundle, bundle.getPageIndices())).forEach(page => output.addPage(page));
  }

  // Written once at the end, so a failed render never leaves a partial PDF.
  const pdfPath = path.join(directory, admissionPdfName(formData.fullName, audience, part));
  await fsp.writeFile(pdfPath, await output.save());
  return pdfPath;
}

function admissionPdfName(name, copyType, part) {
  if (!["admin", "student"].includes(copyType)) throw new Error("Invalid PDF copy type");
  if (copyType === "admin" && !ADMIN_PARTS.includes(part)) throw new Error("Invalid admin PDF part");
  const safeName = String(name || "").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "Student";
  if (copyType === "student") return `SkyPro_GroundSchool_${safeName}_Student_Copy.pdf`;
  return `SkyPro_GroundSchool_${safeName}_Admin_${part === "form" ? "Form" : "Documents"}.pdf`;
}

module.exports = Object.assign(generatePDF, { admissionPdfName, buildSections, buildDocumentsPdf, officeFields, pdfText, DECLARATION_PARAGRAPHS, APPENDED_UPLOADS, EMBEDDED_UPLOADS, DOCUMENTS_COVER_PAGES });
