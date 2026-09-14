import test from "node:test";
import assert from "node:assert/strict";
import { COMPLETE_PACKAGE, INDIVIDUAL_SUBJECTS, ENROLLMENT_SUBJECTS, sanitizeEnrollment, validateEnrollment, enrollmentPayload } from "./enrollmentModel.js";
import { normalizeForm, readDraft, createSubmission, DRAFT_KEY, DRAFT_TIMESTAMP_KEY, DRAFT_VERSION } from "./formState.js";
import { omitFields } from "./aviationWorkflowModel.js";

const individual = () => normalizeForm({ courseSelection: INDIVIDUAL_SUBJECTS, individualSubjects: ["Air Navigation", "Technical General"], modeOfClass: "Online", heardAboutSkypro: "A friend" });

test("course/mode are required; individual enrollment requires at least one approved subject", () => {
  assert.ok(validateEnrollment(normalizeForm()).courseSelection);
  assert.ok(validateEnrollment(normalizeForm()).modeOfClass);
  assert.deepEqual(validateEnrollment(individual()), {});
  assert.deepEqual(validateEnrollment({ ...individual(), courseSelection: COMPLETE_PACKAGE, individualSubjects: [], modeOfClass: "Offline", heardAboutSkypro: "" }), {});
  assert.ok(validateEnrollment({ ...individual(), individualSubjects: [] }).individualSubjects);
  assert.ok(validateEnrollment({ ...individual(), individualSubjects: ["Flight Training"] }).individualSubjects);
  assert.ok(validateEnrollment({ ...individual(), courseSelection: "DGCA Ground Classes" }).courseSelection);
  assert.ok(validateEnrollment({ ...individual(), modeOfClass: "Hybrid" }).modeOfClass);
});

test("switching to the complete package clears individual subjects/errors and does not restore stale selections", () => {
  const complete = sanitizeEnrollment({ ...individual(), courseSelection: COMPLETE_PACKAGE });
  assert.deepEqual(complete.individualSubjects, []);
  assert.deepEqual(omitFields({ individualSubjects: "old error" }, ["individualSubjects"]), {});
  const reopened = sanitizeEnrollment({ ...complete, courseSelection: INDIVIDUAL_SUBJECTS });
  assert.deepEqual(reopened.individualSubjects, []);
  assert.ok(validateEnrollment(reopened).individualSubjects);
  assert.deepEqual(enrollmentPayload(complete).enrollmentSubjects, ENROLLMENT_SUBJECTS);
});

test("enrollment subjects stay separate from cleared DGCA papers and normalize duplicate/unapproved values", () => {
  const form = normalizeForm({ ...individual(), individualSubjects: ["Air Navigation", "Air Navigation", "Invalid"], hasDgcaComputerNumber: "Yes", dgcaPapersCleared: "Yes", dgcaSubjects: ["Air Regulations"] });
  assert.deepEqual(form.individualSubjects, ["Air Navigation"]);
  assert.deepEqual(form.dgcaSubjects, ["Air Regulations"]);
  const payload = createSubmission(form, {}, "token");
  assert.deepEqual(JSON.parse(payload.get("enrollmentSubjects")), ["Air Navigation"]);
  assert.deepEqual(JSON.parse(payload.get("dgcaSubjects")), ["Air Regulations"]);
});

test("multipart clearly represents complete versus individual enrollment and has no obsolete payment fields", () => {
  for (const courseSelection of [COMPLETE_PACKAGE, INDIVIDUAL_SUBJECTS]) {
    const form = { ...individual(), courseSelection, course: "old generic course", feesPaid: "Yes" };
    const payload = createSubmission(form, {}, "token");
    assert.equal(payload.get("courseSelection"), courseSelection);
    assert.equal(payload.get("course"), courseSelection);
    assert.deepEqual(JSON.parse(payload.get("enrollmentSubjects")), courseSelection === COMPLETE_PACKAGE ? ENROLLMENT_SUBJECTS : individual().individualSubjects);
    assert.equal(payload.get("modeOfClass"), "Online");
    assert.equal(payload.get("heardAboutSkypro"), "A friend");
    for (const key of ["individualSubjects", "feesPaid", "installment", "paymentMode", "transactionId", "paymentDate", "paymentReceipt"]) assert.equal(payload.has(key), false);
  }
  assert.equal(enrollmentPayload({ ...individual(), heardAboutSkypro: "  Any unlisted source  " }).heardAboutSkypro, "Any unlisted source");
});

test("drafts restore new enrollment data and migrate old class modes without guessing a course", () => {
  const now = Date.now();
  const storage = (data) => ({ getItem: (key) => key === DRAFT_KEY ? JSON.stringify(data) : key === DRAFT_TIMESTAMP_KEY ? String(now) : null });
  assert.deepEqual(readDraft(storage({ version: DRAFT_VERSION, form: individual() }), now).form, individual());
  for (const [old, mode] of [["Online Class", "Online"], ["Offline Class", "Offline"]]) {
    const draft = readDraft(storage({ version: 6, form: { fullName: "Saved Applicant", modeOfClass: old, course: "ATPL Theory Training" } }), now);
    assert.equal(draft.form.modeOfClass, mode);
    assert.equal(draft.form.fullName, "Saved Applicant");
    assert.equal(draft.form.courseSelection, "");
  }
  const stale = readDraft(storage({ version: DRAFT_VERSION, form: { ...individual(), courseSelection: COMPLETE_PACKAGE } }), now);
  assert.deepEqual(stale.form.individualSubjects, []);
});
