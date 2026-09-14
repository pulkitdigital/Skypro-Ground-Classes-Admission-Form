import test from "node:test";
import assert from "node:assert/strict";
import { AVIATION_DEFAULTS, AVIATION_FIELD_KEYS, aviationVisibility, hiddenAviationFields, omitFields, sanitizeAviationForm, validateAviationWorkflow } from "./aviationWorkflowModel.js";
import { DRAFT_KEY, DRAFT_TIMESTAMP_KEY, DRAFT_VERSION, normalizeForm, readDraft, createSubmission, validateFormUploads, validateUpload } from "./formState.js";

const completed = () => normalizeForm({
  hasDgcaComputerNumber: "Yes", dgcaComputerNumber: "12345678",
  dgcaPapersCleared: "Yes", dgcaSubjects: ["Air Navigation", "Air Regulations"], dgcaExamResultDate: "2026-08-15",
  hasEgcaId: "Yes", egcaId: "EGCA123", hasDgcaMedical: "Yes", dgcaMedicalClass: "DGCA Class-1 Medical",
});
const pdf = (name) => new File(["%PDF-1.7"], name, { type: "application/pdf" });
const uploads = () => ({ dgcaExamResult: pdf("result.pdf"), dgcaMedicalAssessment: pdf("medical.pdf") });

test("computer number No/Applied clears every papers descendant and its errors/files", () => {
  for (const answer of ["No", "Applied for Computer Number", ""]) {
    const next = sanitizeAviationForm({ ...completed(), hasDgcaComputerNumber: answer });
    const hidden = hiddenAviationFields(next);
    for (const key of ["dgcaComputerNumber", "dgcaPapersCleared", "dgcaSubjects", "dgcaExamResultDate", "dgcaExamResult"]) {
      assert.ok(hidden.includes(key));
      if (key in AVIATION_DEFAULTS) assert.deepEqual(next[key], AVIATION_DEFAULTS[key]);
    }
    const errors = Object.fromEntries(AVIATION_FIELD_KEYS.map((key) => [key, "old error"]));
    const remainingErrors = omitFields(errors, hidden);
    const remainingFiles = omitFields(uploads(), hidden);
    for (const key of hidden) assert.equal(key in remainingErrors, false);
    assert.equal("dgcaExamResult" in remainingFiles, false);
    assert.ok(remainingFiles.dgcaMedicalAssessment);
    assert.equal(next.egcaId, "EGCA123");
    const reopened = sanitizeAviationForm({ ...next, hasDgcaComputerNumber: "Yes" });
    assert.equal(reopened.dgcaPapersCleared, "");
    assert.deepEqual(reopened.dgcaSubjects, []);
  }
});

test("papers Yes to No clears result data while retaining computer number", () => {
  const next = sanitizeAviationForm({ ...completed(), dgcaPapersCleared: "No" });
  assert.equal(next.dgcaComputerNumber, "12345678");
  assert.deepEqual(next.dgcaSubjects, []);
  assert.equal(next.dgcaExamResultDate, "");
  assert.equal(aviationVisibility(next).dgcaExamResult, false);
  assert.deepEqual(validateAviationWorkflow(next), {});
});

test("eGCA Yes to No clears the ID and entire medical branch without changing papers", () => {
  const next = sanitizeAviationForm({ ...completed(), hasEgcaId: "No" });
  const hidden = hiddenAviationFields(next);
  for (const key of ["egcaId", "hasDgcaMedical", "dgcaMedicalClass"]) assert.equal(next[key], "");
  assert.ok(hidden.includes("dgcaMedicalAssessment"));
  assert.equal("dgcaMedicalAssessment" in omitFields(uploads(), hidden), false);
  assert.equal(next.dgcaExamResultDate, "2026-08-15");
  const errors = Object.fromEntries(hidden.map((key) => [key, "old error"]));
  assert.deepEqual(omitFields(errors, hidden), {});
  assert.deepEqual(validateAviationWorkflow(next), {});
});

test("medical No clears class/assessment; upload appears only after a valid class selection", () => {
  const next = sanitizeAviationForm({ ...completed(), hasDgcaMedical: "No" });
  assert.equal(next.egcaId, "EGCA123");
  assert.equal(next.dgcaMedicalClass, "");
  assert.equal(aviationVisibility(next).dgcaMedicalAssessment, false);
  for (const type of ["", "invalid", "DGCA Class-1 Medical", "DGCA Class-2 Medical"]) {
    const form = { ...completed(), dgcaMedicalClass: type };
    assert.equal(aviationVisibility(form).dgcaMedicalAssessment, type.startsWith("DGCA Class-"));
    assert.equal(Boolean(validateAviationWorkflow(form).dgcaMedicalClass), !type.startsWith("DGCA Class-"));
  }
});

test("visible answers/identifiers, subjects, and a valid exam date are required", () => {
  assert.deepEqual(validateAviationWorkflow(completed()), {});
  assert.deepEqual(validateAviationWorkflow(normalizeForm({ hasDgcaComputerNumber: "No", hasEgcaId: "No" })), {});
  assert.deepEqual(Object.keys(validateAviationWorkflow(normalizeForm())).sort(), ["hasDgcaComputerNumber", "hasEgcaId"]);
  for (const key of ["dgcaComputerNumber", "dgcaPapersCleared", "dgcaExamResultDate", "egcaId", "hasDgcaMedical", "dgcaMedicalClass"]) {
    assert.ok(validateAviationWorkflow({ ...completed(), [key]: "" })[key]);
  }
  assert.ok(validateAviationWorkflow({ ...completed(), dgcaSubjects: [] }).dgcaSubjects);
  assert.ok(validateAviationWorkflow({ ...completed(), dgcaSubjects: ["invalid"] }).dgcaSubjects);
  assert.ok(validateAviationWorkflow({ ...completed(), dgcaExamResultDate: "2025-02-29" }).dgcaExamResultDate);
  assert.ok(validateAviationWorkflow({ ...completed(), dgcaExamResultDate: "invalid" }).dgcaExamResultDate);
  assert.equal(validateAviationWorkflow({ ...completed(), dgcaExamResultDate: "2024-02-29" }).dgcaExamResultDate, undefined);
});

test("result/assessment uploads validate only when visible and enforce PDF/2 MiB", () => {
  const missing = validateFormUploads(completed(), {});
  assert.ok(missing.dgcaExamResult);
  assert.ok(missing.dgcaMedicalAssessment);
  const hidden = normalizeForm({ hasDgcaComputerNumber: "No", hasEgcaId: "No" });
  const hiddenErrors = validateFormUploads(hidden, {}, { dgcaExamResult: "old error", dgcaMedicalAssessment: "old error" });
  assert.equal(hiddenErrors.dgcaExamResult, undefined);
  assert.equal(hiddenErrors.dgcaMedicalAssessment, undefined);
  for (const key of ["dgcaExamResult", "dgcaMedicalAssessment"]) {
    assert.equal(validateUpload({ name: "test.pdf", type: "application/pdf", size: 2 * 1024 * 1024 }, key), "");
    assert.ok(validateUpload({ name: "test.pdf", type: "application/pdf", size: 2 * 1024 * 1024 + 1 }, key));
    assert.ok(validateUpload({ name: "test.jpg", type: "image/jpeg", size: 100 }, key));
    assert.equal(validateFormUploads(completed(), uploads())[key], undefined);
  }
});

test("drafts restore compatible fields and clear stale hidden branches without storing files", () => {
  const now = Date.now();
  const storage = (draft) => ({ getItem: (key) => key === DRAFT_KEY ? JSON.stringify(draft) : key === DRAFT_TIMESTAMP_KEY ? String(now) : null });
  const old = readDraft(storage({ version: 3, form: { fullName: "Applicant", dgcaPapersCleared: "Yes", dgcaSubjects: ["Air Navigation"] } }), now);
  assert.equal(old.form.fullName, "Applicant");
  assert.equal(old.form.hasDgcaComputerNumber, "");
  assert.equal(old.form.dgcaPapersCleared, "");
  assert.deepEqual(old.form.dgcaSubjects, []);
  const restored = readDraft(storage({ version: DRAFT_VERSION, form: { ...completed(), ...uploads() } }), now);
  assert.deepEqual(restored.form, completed());
  const stale = readDraft(storage({ version: DRAFT_VERSION, form: { ...completed(), hasEgcaId: "No" } }), now);
  assert.equal(stale.form.egcaId, "");
  assert.equal(stale.form.dgcaMedicalClass, "");
});

test("FormData includes one shared result and drops hidden values/files even from stale input", () => {
  const payload = createSubmission(completed(), uploads(), "token");
  assert.equal(payload.getAll("dgcaExamResult").length, 1);
  assert.equal(payload.getAll("dgcaMedicalAssessment").length, 1);
  assert.deepEqual(JSON.parse(payload.get("dgcaSubjects")), ["Air Navigation", "Air Regulations"]);
  assert.equal(payload.get("dgcaExamResultDate"), "2026-08-15");
  for (const answer of ["No", "Applied for Computer Number"]) {
    const stale = { ...completed(), hasDgcaComputerNumber: answer, hasEgcaId: "No" };
    const hiddenPayload = createSubmission(stale, uploads(), "token");
    for (const key of hiddenAviationFields(stale)) assert.equal(hiddenPayload.has(key), false);
    assert.equal(hiddenPayload.get("hasDgcaComputerNumber"), answer);
    assert.equal(hiddenPayload.get("hasEgcaId"), "No");
    for (const key of ["feesPaid", "paymentReceipt", "installment", "paymentMode", "transactionId", "paymentDate"]) assert.equal(hiddenPayload.has(key), false);
  }
});
