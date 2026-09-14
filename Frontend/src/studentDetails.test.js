import test from "node:test";
import assert from "node:assert/strict";
import { calculateAge, synchronizeAddress, updateFormField, validateStudentDetails } from "./studentDetailsModel.js";
import { DRAFT_KEY, DRAFT_TIMESTAMP_KEY, DRAFT_TTL, DRAFT_VERSION, UPLOAD_FIELDS, normalizeForm, readDraft, createSubmission, validateUpload } from "./formState.js";

const today = new Date(2026, 8, 13);
const validStudent = () => normalizeForm({
  fullName: "Zoë O'Connor", dob: "2000-09-14", gender: "Female",
  mobile: "9876543210", email: "zoe@example.com", nationality: "Indian National",
  permanentState: "Rajasthan", permanentCity: "Jaipur", permanentAddress: "12 Test Road",
  currentState: "Delhi", currentCity: "New Delhi", currentAddress: "34 Test Road",
});

test("age accounts for birthdays, leap days, invalid dates, and future dates", () => {
  assert.equal(calculateAge("2000-09-14", today), 25);
  assert.equal(calculateAge("2000-09-13", today), 26);
  assert.equal(calculateAge("2000-09-12", today), 26);
  assert.equal(calculateAge("2026-09-13", today), 0);
  assert.equal(calculateAge("2026-09-14", today), "");
  assert.equal(calculateAge("2025-02-29", today), "");
  assert.equal(calculateAge("2000-02-29", new Date(2025, 1, 28)), 24);
  assert.equal(calculateAge("2000-02-29", new Date(2025, 2, 1)), 25);
  assert.equal(calculateAge("", today), "");
});

test("phones use country-specific lengths rather than a universal ten-digit rule", () => {
  for (const [mobileCountry, mobileCountryCode, mobile] of [
    ["IN", "+91", "9876543210"], ["SG", "+65", "81234567"],
    ["GB", "+44", "07911123456"], ["US", "+1", "2025550123"],
  ]) {
    assert.deepEqual(validateStudentDetails({ ...validStudent(), mobileCountry, mobileCountryCode, mobile }, today), {});
  }
  assert.ok(validateStudentDetails({ ...validStudent(), mobile: "123" }, today).mobile);
  assert.ok(validateStudentDetails({ ...validStudent(), mobile: "123abc4567" }, today).mobile);
  assert.ok(validateStudentDetails({ ...validStudent(), mobileCountryCode: "+44" }, today).mobileCountry);
  assert.ok(validateStudentDetails({ ...validStudent(), email: "invalid@" }, today).email);
  assert.ok(validateStudentDetails({ ...validStudent(), dob: "2099-01-01" }, today).dob);
});

test("all three address parts copy, stay synchronized, and become independent when unchecked", () => {
  let form = synchronizeAddress(validStudent());
  assert.equal(form.currentState, "Rajasthan");
  assert.equal(form.currentCity, "Jaipur");
  assert.equal(form.currentAddress, "12 Test Road");
  form = updateFormField(form, "permanentState", "Goa", true);
  form = updateFormField(form, "permanentCity", "Panaji", true);
  form = updateFormField(form, "permanentAddress", "56 Test Road", true);
  assert.equal(form.currentState, "Goa");
  assert.equal(form.currentCity, "Panaji");
  assert.equal(form.currentAddress, "56 Test Road");
  form = updateFormField(form, "permanentCity", "Margao", false);
  assert.equal(form.currentCity, "Panaji");
  form = updateFormField(form, "currentCity", "Mapusa", false);
  assert.equal(form.permanentCity, "Margao");
});

test("foreign fields validate conditionally and clear when switching nationality", () => {
  const foreign = { ...validStudent(), nationality: "Foreign National", countryOfCitizenship: "", passportNumber: "", passportExpiryDate: "" };
  const errors = validateStudentDetails(foreign, today);
  for (const key of ["countryOfCitizenship", "passportNumber", "passportExpiryDate"]) assert.ok(errors[key]);
  const complete = { ...foreign, countryOfCitizenship: "France", passportNumber: "AB1234567", passportExpiryDate: "2030-01-01" };
  assert.deepEqual(validateStudentDetails(complete, today), {});
  const indian = updateFormField(complete, "nationality", "Indian National", false);
  for (const key of ["countryOfCitizenship", "passportNumber", "passportExpiryDate"]) assert.equal(indian[key], "");
  assert.deepEqual(validateStudentDetails(indian, today), {});
  const phone = updateFormField(indian, "mobileCountry", "SG", false);
  assert.equal(phone.mobileCountryCode, "+65");
});

test("draft restoration migrates old values, whitelists new fields, and handles bad storage", () => {
  const now = today.getTime();
  const storage = (draft, timestamp = now) => ({ getItem: (key) => key === DRAFT_KEY ? JSON.stringify(draft) : key === DRAFT_TIMESTAMP_KEY ? String(timestamp) : null });
  const legacy = { version: 2, form: { fullName: "Saved Name", mobile: "9876543210", permanentAddress: "Old address", course: "ATPL", feesPaid: "Yes" }, sameAddress: true, disclaimerAccepted: true };
  const restored = readDraft(storage(legacy), now);
  assert.equal(restored.form.currentAddress, "Old address");
  assert.equal(restored.form.mobileCountryCode, "+91");
  assert.equal(restored.form.mobileCountry, "IN");
  assert.equal(restored.form.nationality, "");
  assert.equal(restored.disclaimerAccepted, false);
  assert.equal("course" in restored.form, false);
  assert.equal("feesPaid" in restored.form, false);
  const form = { ...validStudent(), nationality: "Foreign National", countryOfCitizenship: "Singapore", passportNumber: "AB1234", passportExpiryDate: "2030-01-01", mobileCountry: "SG", mobileCountryCode: "+65", mobile: "81234567" };
  assert.deepEqual(readDraft(storage({ version: DRAFT_VERSION, form }), now).form, form);
  assert.deepEqual(readDraft(storage(legacy, now - DRAFT_TTL), now).form, normalizeForm());
  assert.deepEqual(readDraft({ getItem: () => "bad JSON" }, now).form, normalizeForm());
  assert.deepEqual(readDraft({ getItem() { throw new Error("blocked"); } }, now).form, normalizeForm());
});

test("passport and photo restrictions match the new specification", () => {
  assert.equal(UPLOAD_FIELDS.photo.width, undefined);
  assert.equal(UPLOAD_FIELDS.photo.height, undefined);
  assert.equal(validateUpload({ name: "photo.jpeg", type: "image/jpeg", size: 2 * 1024 * 1024 }, "photo"), "");
  assert.ok(validateUpload({ name: "photo.png", type: "image/png", size: 100 }, "photo"));
  assert.ok(validateUpload({ name: "photo.jpeg", type: "image/jpeg", size: 2 * 1024 * 1024 + 1 }, "photo"));
  assert.equal(validateUpload({ name: "passport.pdf", type: "application/pdf", size: 100 }, "passport"), "");
  assert.ok(validateUpload({ name: "passport.jpg", type: "image/jpeg", size: 100 }, "passport"));
});

test("multipart excludes hidden passport data, obsolete payment fields, and stale age", () => {
  const foreign = { ...validStudent(), nationality: "Foreign National", countryOfCitizenship: "France", passportNumber: "AB1234", passportExpiryDate: "2030-01-01", age: 999, feesPaid: "Yes" };
  const files = { passport: new File(["%PDF-"], "passport.pdf", { type: "application/pdf" }), paymentReceipt: new File(["old"], "receipt.pdf") };
  const payload = createSubmission(foreign, files, "token");
  assert.equal(payload.get("passportNumber"), "AB1234");
  assert.ok(payload.get("passport"));
  assert.equal(payload.get("mobileCountryCode"), "+91");
  assert.equal(payload.get("mobile"), "9876543210");
  assert.equal(payload.get("age"), String(calculateAge(foreign.dob)));
  const indian = createSubmission({ ...foreign, nationality: "Indian National" }, files, "token");
  for (const key of ["countryOfCitizenship", "passportNumber", "passportExpiryDate", "passport", "feesPaid", "paymentReceipt", "installment", "paymentMode", "transactionId", "paymentDate"]) assert.equal(indian.has(key), false);
  assert.equal(indian.get("recaptchaToken"), "token");
  assert.equal(indian.get("permanentCity"), "Jaipur");
});
