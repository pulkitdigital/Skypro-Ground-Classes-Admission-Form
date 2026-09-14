const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAdmission, SUBJECTS } = require("../services/admissionContract");
const { validBody, filesFor } = require("./fixtures");
const normalize = body => normalizeAdmission(body, filesFor(body), new Date("2026-09-14T10:00:00Z"));
const invalid = (body, key) => assert.throws(() => normalize(body), error => error.status === 400 && Boolean(error.fields[key]));

test("required fields, scalar types, choice values, dates, email and country-aware phone are enforced", () => {
  const body = validBody();
  for (const key of Object.keys(body).filter(key => !["recaptchaToken", "enrollmentSubjects"].includes(key))) invalid({ ...body, [key]: "" }, key.replace(/CountryCode$/, "Country"));
  invalid({ ...body, fullName: ["A", "B"] }, "fullName");
  invalid({ ...body, gender: "Unknown" }, "gender");
  invalid({ ...body, email: "bad-email" }, "email");
  invalid({ ...body, dob: "2025-02-30" }, "dob");
  invalid({ ...body, dob: "2030-01-01" }, "dob");
  invalid({ ...body, mobileCountryCode: "+44" }, "mobileCountry");
  invalid({ ...body, mobile: "12" }, "mobile");
  assert.equal(normalize(validBody({ mobileCountry: "GB", mobileCountryCode: "+44", mobile: "02079460018" })).mobile, "2079460018");
});

test("derived name/date/age/emergency and complete package cannot be forged", () => {
  const data = normalize(validBody({ age: "99", declarationDate: "2000-01-01", declarationStudentName: "Fake", emergencyContact: '{"name":"Fake"}', enrollmentSubjects: '["Fake"]' }));
  assert.equal(data.age, 25);
  assert.equal(data.declarationDate, "2026-09-14");
  assert.equal(data.declarationStudentName, "Test Student");
  assert.equal(data.emergencyContact.name, "Test Mother");
  assert.deepEqual(data.enrollmentSubjects, SUBJECTS);
  assert.equal(data.recaptchaToken, undefined);
  assert.equal(data.declarationAccepted, true);
});

test("foreign passport, Other qualification and individual subjects are conditional", () => {
  const foreign = validBody({ nationality: "Foreign National", countryOfCitizenship: "UK", passportNumber: "AB123", passportExpiryDate: "2030-10-01" });
  assert.equal(normalize(foreign).passportNumber, "AB123");
  for (const key of ["countryOfCitizenship", "passportNumber", "passportExpiryDate"]) invalid({ ...foreign, [key]: "" }, key);
  assert.throws(() => normalizeAdmission(foreign, filesFor(foreign).filter(f => f.fieldname !== "passport")), /required/);
  invalid(validBody({ highestQualification: "Other" }), "otherQualification");
  for (const enrollmentSubjects of ["[]", '"Air Navigation"', '["Unknown"]', "bad-json"]) invalid(validBody({ courseSelection: "Individual Subject(s)", enrollmentSubjects }), "enrollmentSubjects");
  assert.deepEqual(normalize(validBody({ courseSelection: "Individual Subject(s)", enrollmentSubjects: '["Air Navigation"]' })).enrollmentSubjects, ["Air Navigation"]);
});

test("DGCA/eGCA branches enforce data and drop hidden stale values", () => {
  const body = validBody({ hasDgcaComputerNumber: "Yes", dgcaComputerNumber: "1234", dgcaPapersCleared: "Yes", dgcaSubjects: '["Air Navigation"]', dgcaExamResultDate: "2025-01-01", hasEgcaId: "Yes", egcaId: "ID123", hasDgcaMedical: "Yes", dgcaMedicalClass: "DGCA Class-1 Medical" });
  for (const key of ["dgcaComputerNumber", "dgcaPapersCleared", "dgcaSubjects", "dgcaExamResultDate", "egcaId", "hasDgcaMedical", "dgcaMedicalClass"]) invalid({ ...body, [key]: "" }, key);
  assert.deepEqual(normalize(body).dgcaSubjects, ["Air Navigation"]);
  for (const status of ["No", "Applied for Computer Number"]) {
    const hidden = normalize({ ...body, hasDgcaComputerNumber: status, hasEgcaId: "No" });
    for (const key of ["dgcaComputerNumber", "dgcaPapersCleared", "dgcaSubjects", "dgcaExamResultDate", "egcaId", "hasDgcaMedical", "dgcaMedicalClass"]) assert.equal(key in hidden, false);
  }
});

test("Jaipur and Other emergency dependencies are validated and normalized", () => {
  invalid(validBody({ emergencyContactSource: "Jaipur Local Contact" }), "emergencyContactSource");
  const body = validBody({ hasJaipurContact: "Yes", jaipurContactName: "Local Person", jaipurContactRelationship: "Uncle", jaipurContactAddress: "Jaipur", jaipurContactMobileCountry: "IN", jaipurContactMobileCountryCode: "+91", jaipurContactMobile: "9876543210", emergencyContactSource: "Jaipur Local Contact" });
  assert.equal(normalize(body).emergencyContact.name, "Local Person");
  for (const key of ["jaipurContactName", "jaipurContactRelationship", "jaipurContactAddress", "jaipurContactMobile"]) invalid({ ...body, [key]: "" }, key);
  const other = validBody({ emergencyContactSource: "Other", emergencyOtherName: "Other Person", emergencyOtherRelationship: "Friend", emergencyOtherMobileCountry: "IN", emergencyOtherMobileCountryCode: "+91", emergencyOtherMobile: "9876543210" });
  assert.equal(normalize(other).emergencyContact.relationship, "Friend");
  for (const key of ["emergencyOtherName", "emergencyOtherRelationship", "emergencyOtherMobile"]) invalid({ ...other, [key]: "" }, key);
  const hidden = normalize({ ...other, emergencyContactSource: "Father" });
  assert.equal(hidden.emergencyOtherName, undefined);
  assert.equal(hidden.emergencyContact.name, "Test Father");
});

test("obsolete inputs and hidden uploads are rejected", () => {
  for (const key of ["feesPaid", "installment", "paymentMode", "transactionId", "paymentDate", "parentName", "relationship", "parentMobile", "occupation", "school", "classYear", "class12Stream", "board", "dgca", "egca", "medical"]) invalid(validBody({ [key]: "old" }), key);
  invalid(validBody({ courseSelection: "DGCA Ground Classes" }), "courseSelection");
  assert.throws(() => normalizeAdmission(validBody(), [...filesFor(), { fieldname: "passport" }]), error => Boolean(error.fields.passport));
  for (const field of filesFor()) assert.throws(() => normalizeAdmission(validBody(), filesFor().filter(f => f.fieldname !== field.fieldname)), error => Boolean(error.fields[field.fieldname]));
});
