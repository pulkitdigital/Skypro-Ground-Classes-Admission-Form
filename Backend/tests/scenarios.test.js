// Cross-stack scenario matrix: real frontend models build the multipart payload,
// which then runs through the real backend contract, Sheets row, PDF sections and
// email builders. No network, Google, or Brevo access is used.
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { normalizeAdmission } = require("../services/admissionContract");
const { validateFileMetadata } = require("../services/uploadService");
const { ADMISSION_HEADERS, admissionRow } = require("../services/admissionSheet");
const generatePDF = require("../services/pdfGenerator");
const email = require("../services/emailService");

const ID = "SKY-GS-2026-09-0042";
const NOW = new Date("2026-09-14T06:30:00Z");
const MB2 = 2 * 1024 * 1024;
let ui;

before(async () => {
  const modules = await Promise.all(["formState.js", "studentDetailsModel.js", "contactModel.js", "educationModel.js", "enrollmentModel.js", "aviationWorkflowModel.js"]
    .map(file => import(pathToFileURL(path.join(__dirname, "../../Frontend/src", file)).href)));
  ui = Object.assign({}, ...modules);
});

const pdfFile = (name, size) => new File([size ? new Uint8Array(size) : "%PDF-1.4 sample"], `${name}.pdf`, { type: "application/pdf" });
const jpegFile = name => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], `${name}.jpg`, { type: "image/jpeg" });
// Every possible upload is always selected, so tests prove hidden uploads are not sent.
const allFiles = () => ({ photo: jpegFile("photo"), signature: jpegFile("signature"), parentSignature: jpegFile("parent"), marksheet10: pdfFile("m10"), marksheet12: pdfFile("m12"), aadhar: pdfFile("aadhar"), passport: pdfFile("passport"), dgcaExamResult: pdfFile("result"), dgcaMedicalAssessment: pdfFile("medical") });

// Mirrors form.jsx handleChange.
const change = (form, name, value, sameAddress = false) => ui.sanitizeEnrollment(ui.sanitizeContacts(ui.sanitizeEducation(ui.sanitizeAviationForm(ui.updateFormField(form, name, value, sameAddress))), name));
const fill = (form, values) => Object.entries(values).reduce((next, [name, value]) => change(next, name, value), form);
// Mirrors form.jsx validateForm.
function frontendErrors(form, files = allFiles()) {
  const errors = { ...ui.validateStudentDetails(form), ...ui.validateContacts(form), ...ui.validateEducation(form), ...ui.validateEnrollment(form) };
  if (!form.previousFlyingExperience) errors.previousFlyingExperience = "required";
  return { ...errors, ...ui.validateAviationWorkflow(form), ...ui.validateFormUploads(form, files) };
}

const baseForm = () => ui.normalizeForm({
  fullName: "Aarav Sharma", dob: "2000-09-15", gender: "Male", mobile: "9876543210", email: "aarav@example.com", nationality: "Indian National",
  permanentState: "Rajasthan", permanentCity: "Jaipur", permanentAddress: "1 Test Road", currentState: "Delhi", currentCity: "New Delhi", currentAddress: "2 Test Road",
  fatherName: "Raj Sharma", fatherMobile: "9876543211", fatherEmail: "father@example.com", fatherOccupation: "Engineer",
  motherName: "Sita Sharma", motherMobile: "9876543212", motherEmail: "mother@example.com", motherOccupation: "Teacher",
  hasJaipurContact: "No", emergencyContactSource: "Mother", highestQualification: "Graduate", physicsMathematicsStatus: "Physics and Mathematics Completed",
  courseSelection: "Complete Ground School Package", modeOfClass: "Online", previousFlyingExperience: "No", hasDgcaComputerNumber: "No", hasEgcaId: "No",
});

function submit(form, { files = allFiles(), declaration = true } = {}) {
  const payload = ui.createSubmission(form, files, "test-token", declaration, NOW);
  const body = {};
  const uploads = [];
  for (const [key, value] of payload.entries()) {
    if (typeof value === "string") { assert.equal(key in body, false, `duplicate ${key}`); body[key] = value; }
    else uploads.push({ fieldname: key, originalname: value.name, mimetype: value.type, size: value.size });
  }
  return { payload, body, uploads };
}

function rejects(sent, field) {
  assert.throws(() => normalizeAdmission(sent.body, sent.uploads, NOW), error => error.status === 400 && Boolean(error.fields[field]), `backend should reject ${field}`);
}

// Accepted on both sides; checks ID visibility rules for every scenario (41, 42).
function accept(form, options = {}) {
  assert.deepEqual(frontendErrors(form, options.files), {}, "frontend validation");
  const sent = submit(form, options);
  sent.uploads.forEach(file => validateFileMetadata(file));
  const data = normalizeAdmission(sent.body, sent.uploads, NOW);
  data.applicationId = ID;
  const cells = admissionRow(data, sent.uploads);
  const row = Object.fromEntries(ADMISSION_HEADERS.map((header, index) => [header, cells[index]]));
  const student = email.buildStudentEmail(data, { from: "sender@example.com", contactEmail: "info@skyproaviation.org" });
  email.assertStudentSafe(student, data);
  assert.equal(JSON.stringify(student).includes(ID), false);
  assert.equal(JSON.stringify(generatePDF.buildSections(data)).includes(ID), false);
  const admin = email.buildAdminEmail(data, { from: "sender@example.com", to: "info@skyproaviation.org", pdfName: `${ID}.pdf`, pdfContent: "" });
  assert.ok(admin.subject.includes(ID) && admin.htmlContent.includes(ID) && admin.textContent.includes(ID));
  assert.equal(generatePDF.buildSections(data, { audience: "admin" })[0].rows[0].value, ID);
  assert.equal(generatePDF.officeFields(data)[0].value, ID);
  assert.equal(row["SkyPro Application ID"], ID);
  return { ...sent, data, row, uploadNames: sent.uploads.map(file => file.fieldname).sort(), sections: generatePDF.buildSections(data, { audience: "admin" }) };
}
const values = (row, headers) => headers.map(header => row[header]);
const lacks = (result, keys) => keys.forEach(key => assert.equal(result.payload.has(key), false, `stale ${key} submitted`));

test("1-3 Indian, foreign, and foreign-to-Indian switch clears passport data and upload", () => {
  const indian = accept(baseForm());
  assert.deepEqual(values(indian.row, ["Nationality", "Aadhaar", "Passport", "Passport Number"]), ["Indian National", "Uploaded", "Not Applicable", ""]);
  assert.deepEqual(indian.uploadNames, ["aadhar", "marksheet10", "marksheet12", "parentSignature", "photo", "signature"]);
  lacks(indian, ["passportNumber", "passport", "dgcaExamResult", "dgcaMedicalAssessment"]);

  const foreignForm = fill(baseForm(), { nationality: "Foreign National", countryOfCitizenship: "Singapore", passportNumber: "K1234567A", passportExpiryDate: "2031-05-20" });
  const foreign = accept(foreignForm);
  assert.deepEqual(values(foreign.row, ["Country of Citizenship", "Passport Number", "Passport Expiry", "Passport", "Aadhaar"]), ["Singapore", "K1234567A", "2031-05-20", "Uploaded", "Not Applicable"]);
  lacks(foreign, ["aadhar"]);

  const switched = accept(change(foreignForm, "nationality", "Indian National"));
  lacks(switched, ["countryOfCitizenship", "passportNumber", "passportExpiryDate", "passport"]);
  assert.deepEqual(values(switched.row, ["Passport Number", "Passport", "Aadhaar"]), ["", "Not Applicable", "Uploaded"]);
  assert.equal(JSON.stringify(switched.sections).includes("K1234567A"), false);
});

test("4-8 computer number Yes/No/Applied and DGCA papers Yes (multiple subjects)/No", () => {
  const withNumber = fill(baseForm(), { hasDgcaComputerNumber: "Yes", dgcaComputerNumber: "DGCA-778812" });
  const papersNo = accept(change(withNumber, "dgcaPapersCleared", "No"));
  assert.deepEqual(values(papersNo.row, ["DGCA Computer Number Status", "DGCA Computer Number", "DGCA Papers Cleared", "DGCA Subjects", "DGCA Exam Result"]), ["Yes", "DGCA-778812", "No", "", "Not Applicable"]);

  let cleared = change(withNumber, "dgcaPapersCleared", "Yes");
  cleared = ui.sanitizeAviationForm({ ...cleared, dgcaSubjects: ["Air Navigation", "Air Regulations", "Technical General"] });
  cleared = change(cleared, "dgcaExamResultDate", "2026-06-10");
  const papersYes = accept(cleared);
  assert.deepEqual(values(papersYes.row, ["DGCA Papers Cleared", "DGCA Subjects", "DGCA Exam Result Date", "DGCA Exam Result"]), ["Yes", "Air Navigation, Air Regulations, Technical General", "2026-06-10", "Uploaded"]);
  assert.ok(papersYes.uploadNames.includes("dgcaExamResult"));

  const backToNo = accept(change(cleared, "dgcaPapersCleared", "No"));
  lacks(backToNo, ["dgcaSubjects", "dgcaExamResultDate", "dgcaExamResult"]);
  for (const status of ["No", "Applied for Computer Number"]) {
    const result = accept(change(cleared, "hasDgcaComputerNumber", status));
    lacks(result, ["dgcaComputerNumber", "dgcaPapersCleared", "dgcaSubjects", "dgcaExamResultDate", "dgcaExamResult"]);
    assert.deepEqual(values(result.row, ["DGCA Computer Number Status", "DGCA Computer Number", "DGCA Papers Cleared", "DGCA Exam Result"]), [status, "", "", "Not Applicable"]);
  }
});

test("9-13 eGCA Yes/No and medical Yes Class 1, Yes Class 2, No", () => {
  const egca = fill(baseForm(), { hasEgcaId: "Yes", egcaId: "EGCA-445566" });
  const medicalNo = accept(change(egca, "hasDgcaMedical", "No"));
  assert.deepEqual(values(medicalNo.row, ["eGCA Status", "eGCA ID", "DGCA Medical Status", "DGCA Medical Class", "DGCA Medical Assessment"]), ["Yes", "EGCA-445566", "No", "", "Not Applicable"]);
  lacks(medicalNo, ["dgcaMedicalClass", "dgcaMedicalAssessment"]);
  for (const medicalClass of ["DGCA Class-1 Medical", "DGCA Class-2 Medical"]) {
    const result = accept(fill(egca, { hasDgcaMedical: "Yes", dgcaMedicalClass: medicalClass }));
    assert.deepEqual(values(result.row, ["DGCA Medical Status", "DGCA Medical Class", "DGCA Medical Assessment"]), ["Yes", medicalClass, "Uploaded"]);
    assert.ok(result.sections.find(section => section.id === "dgca").rows.some(row => row.value === medicalClass));
  }
  const withClass = fill(egca, { hasDgcaMedical: "Yes", dgcaMedicalClass: "DGCA Class-1 Medical" });
  lacks(accept(change(withClass, "hasDgcaMedical", "No")), ["dgcaMedicalClass", "dgcaMedicalAssessment"]);
  const egcaNo = accept(change(withClass, "hasEgcaId", "No"));
  lacks(egcaNo, ["egcaId", "hasDgcaMedical", "dgcaMedicalClass", "dgcaMedicalAssessment"]);
  assert.deepEqual(values(egcaNo.row, ["eGCA Status", "eGCA ID", "DGCA Medical Status", "DGCA Medical Class"]), ["No", "", "", ""]);
});

test("14-15 Other qualification and every Physics/Mathematics option", () => {
  const other = fill(baseForm(), { highestQualification: "Other", otherQualification: "Diploma in Aeronautics" });
  assert.deepEqual(values(accept(other).row, ["Highest Qualification", "Other Qualification"]), ["Other", "Diploma in Aeronautics"]);
  const switched = accept(change(other, "highestQualification", "Graduate"));
  lacks(switched, ["otherQualification"]);
  assert.equal(switched.row["Other Qualification"], "");
  for (const option of ui.PHYSICS_MATHEMATICS_OPTIONS) {
    assert.equal(accept(change(baseForm(), "physicsMathematicsStatus", option)).row["Physics & Mathematics Status"], option);
  }
});

test("16-21 Jaipur contact Yes/No and emergency Father, Mother, Jaipur, Other", () => {
  const withJaipur = fill(baseForm(), { hasJaipurContact: "Yes", jaipurContactName: "Rohit Mehra", jaipurContactRelationship: "Family Friend", jaipurContactMobile: "9812345678", jaipurContactAddress: "22 Civil Lines, Jaipur" });
  assert.deepEqual(values(accept(withJaipur).row, ["Jaipur Contact Available", "Jaipur Contact Name", "Jaipur Contact Relationship", "Jaipur Contact Mobile", "Jaipur Address"]), ["Yes", "Rohit Mehra", "Family Friend", "+91 9812345678", "22 Civil Lines, Jaipur"]);
  const noJaipur = accept(change(withJaipur, "hasJaipurContact", "No"));
  lacks(noJaipur, ["jaipurContactName", "jaipurContactRelationship", "jaipurContactMobile", "jaipurContactAddress"]);
  assert.equal(noJaipur.sections.some(section => section.id === "jaipur"), false);

  const emergency = ["Emergency Contact Type", "Emergency Contact Name", "Emergency Relationship", "Emergency Mobile"];
  assert.deepEqual(values(accept(change(baseForm(), "emergencyContactSource", "Father")).row, emergency), ["Father", "Raj Sharma", "Father", "+91 9876543211"]);
  assert.deepEqual(values(accept(baseForm()).row, emergency), ["Mother", "Sita Sharma", "Mother", "+91 9876543212"]);
  const jaipurEmergency = change(withJaipur, "emergencyContactSource", "Jaipur Local Contact");
  assert.deepEqual(values(accept(jaipurEmergency).row, emergency), ["Jaipur Local Contact", "Rohit Mehra", "Family Friend", "+91 9812345678"]);
  assert.ok(frontendErrors(change(jaipurEmergency, "hasJaipurContact", "No")).emergencyContactSource, "removing Jaipur contact clears it as emergency contact");
  const other = fill(baseForm(), { emergencyContactSource: "Other", emergencyOtherName: "Daniel Tan", emergencyOtherRelationship: "Uncle", emergencyOtherMobileCountry: "SG", emergencyOtherMobile: "91234567" });
  assert.deepEqual(values(accept(other).row, emergency), ["Other", "Daniel Tan", "Uncle", "+65 91234567"]);
  lacks(accept(change(other, "emergencyContactSource", "Father")), ["emergencyOtherName", "emergencyOtherRelationship", "emergencyOtherMobile"]);
});

test("22-28 package, individual subjects (one/multiple), Online/Offline, same and independent address", () => {
  const complete = accept(baseForm());
  assert.deepEqual(complete.data.enrollmentSubjects, ui.DGCA_SUBJECTS);
  assert.deepEqual(values(complete.row, ["Course Selection", "Individual Subjects"]), ["Complete Ground School Package", ""]);

  const individual = change(baseForm(), "courseSelection", "Individual Subject(s)");
  for (const subjects of [["Air Navigation"], ["Air Navigation", "Technical General", "Radio Telephony (RTR)"]]) {
    const result = accept(ui.sanitizeEnrollment({ ...individual, individualSubjects: subjects }));
    assert.equal(result.row["Individual Subjects"], subjects.join(", "));
    assert.equal(generatePDF.officeFields(result.data).find(field => field.label === "Course / Subject(s) Enrolled").value, `Individual Subject(s): ${subjects.join(", ")}`);
  }
  const packageAgain = accept(change(ui.sanitizeEnrollment({ ...individual, individualSubjects: ["Air Navigation"] }), "courseSelection", "Complete Ground School Package"));
  assert.deepEqual(JSON.parse(packageAgain.body.enrollmentSubjects), ui.DGCA_SUBJECTS);

  for (const mode of ["Online", "Offline"]) {
    const result = accept(change(baseForm(), "modeOfClass", mode));
    assert.equal(result.row["Class Mode"], mode);
    assert.equal(generatePDF.officeFields(result.data).find(field => field.label === "Class Mode").value, mode);
  }

  const same = change(ui.synchronizeAddress(baseForm()), "permanentCity", "Udaipur", true);
  assert.deepEqual(values(accept(same).row, ["Permanent City", "Current City", "Current State", "Current Address"]), ["Udaipur", "Udaipur", "Rajasthan", "1 Test Road"]);
  assert.deepEqual(values(accept(baseForm()).row, ["Permanent City", "Current City"]), ["Jaipur", "New Delhi"]);
});

test("29-31 oversized upload, invalid document type and invalid image type are rejected on both sides", () => {
  const oversized = { ...allFiles(), marksheet10: pdfFile("m10", MB2 + 1) };
  assert.match(frontendErrors(baseForm(), oversized).marksheet10, /2 MB/);
  const imageAsDocument = { ...allFiles(), marksheet12: new File(["x"], "m12.jpg", { type: "image/jpeg" }) };
  assert.match(frontendErrors(baseForm(), imageAsDocument).marksheet12, /PDF/);
  assert.throws(() => validateFileMetadata({ fieldname: "marksheet12", mimetype: "image/jpeg", originalname: "m12.jpg" }), /PDF/);
  const pngPhoto = { ...allFiles(), photo: new File(["x"], "photo.png", { type: "image/png" }) };
  assert.match(frontendErrors(baseForm(), pngPhoto).photo, /JPG/);
  assert.throws(() => validateFileMetadata({ fieldname: "photo", mimetype: "image/png", originalname: "photo.png" }), /JPG/);
});

test("32-33 missing conditional fields/uploads and an unchecked declaration are rejected by frontend and backend", () => {
  const noNumber = change(baseForm(), "hasDgcaComputerNumber", "Yes");
  const errors = frontendErrors(noNumber);
  assert.ok(errors.dgcaComputerNumber && errors.dgcaPapersCleared);
  rejects(submit(noNumber), "dgcaComputerNumber");

  const medical = fill(baseForm(), { hasEgcaId: "Yes", egcaId: "EGCA-1", hasDgcaMedical: "Yes", dgcaMedicalClass: "DGCA Class-2 Medical" });
  const withoutAssessment = { ...allFiles() };
  delete withoutAssessment.dgcaMedicalAssessment;
  assert.ok(frontendErrors(medical, withoutAssessment).dgcaMedicalAssessment);
  rejects(submit(medical, { files: withoutAssessment }), "dgcaMedicalAssessment");

  assert.ok(frontendErrors(ui.sanitizeEnrollment({ ...change(baseForm(), "courseSelection", "Individual Subject(s)"), individualSubjects: [] })).individualSubjects);
  rejects(submit(fill(baseForm(), { highestQualification: "Other" })), "otherQualification");
  rejects(submit(baseForm(), { declaration: false }), "declarationAccepted");
});

test("43 a form with every branch filled then switched off submits exactly the minimal field set", () => {
  const minimal = new Set(submit(baseForm()).payload.keys());
  let form = fill(baseForm(), {
    nationality: "Foreign National", countryOfCitizenship: "Singapore", passportNumber: "K1234567A", passportExpiryDate: "2031-05-20",
    hasJaipurContact: "Yes", jaipurContactName: "Rohit Mehra", jaipurContactRelationship: "Friend", jaipurContactMobile: "9812345678", jaipurContactAddress: "Jaipur",
    emergencyContactSource: "Other", emergencyOtherName: "Daniel Tan", emergencyOtherRelationship: "Uncle", emergencyOtherMobile: "9123456780",
    highestQualification: "Other", otherQualification: "Diploma", courseSelection: "Individual Subject(s)",
    hasDgcaComputerNumber: "Yes", dgcaComputerNumber: "DGCA-1", dgcaPapersCleared: "Yes", dgcaExamResultDate: "2026-06-10", hasEgcaId: "Yes", egcaId: "EGCA-1", hasDgcaMedical: "Yes", dgcaMedicalClass: "DGCA Class-1 Medical",
  });
  form = ui.sanitizeAviationForm(ui.sanitizeEnrollment({ ...form, dgcaSubjects: ["Air Navigation"], individualSubjects: ["Air Navigation"] }));
  form = fill(form, { nationality: "Indian National", emergencyContactSource: "Mother", hasJaipurContact: "No", highestQualification: "Graduate", courseSelection: "Complete Ground School Package", hasDgcaComputerNumber: "No", hasEgcaId: "No" });
  const result = accept(form);
  assert.deepEqual(new Set(result.payload.keys()), minimal);
  for (const stale of ["K1234567A", "Rohit Mehra", "Daniel Tan", "Diploma", "DGCA-1", "EGCA-1", "DGCA Class-1 Medical"]) {
    assert.equal([...result.payload.values()].some(value => typeof value === "string" && value.includes(stale)), false, `payload contains ${stale}`);
    assert.equal(JSON.stringify(result.row).includes(stale) || JSON.stringify(result.sections).includes(stale), false, `outputs contain ${stale}`);
  }
});
