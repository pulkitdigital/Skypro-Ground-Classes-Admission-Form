import test from "node:test";
import assert from "node:assert/strict";
import { createSubmission, normalizeForm, readDraft, DRAFT_KEY, DRAFT_TIMESTAMP_KEY, MAX_UPLOAD_BYTES, validateUpload, validateFormUploads } from "./formState.js";

test("declaration name and local submission date are derived, ignoring stale draft values", () => {
  const form = { ...normalizeForm({ fullName: "Current Student" }), declarationStudentName: "Old Name", declarationDate: "2000-01-01" };
  const payload = createSubmission(form, {}, "captcha-token", true, new Date(2026, 8, 14, 0, 5));
  assert.equal(payload.get("declarationStudentName"), "Current Student");
  assert.equal(payload.get("declarationDate"), "2026-09-14");
  assert.equal(payload.get("declarationAccepted"), "true");
  assert.equal(payload.get("recaptchaToken"), "captcha-token");
  assert.equal(createSubmission(form, {}, "token").get("declarationAccepted"), "false");
});

test("Phase 7 draft restores applicant text but requires fresh acceptance of new wording", () => {
  const now = Date.now();
  const storage = { getItem: (key) => key === DRAFT_TIMESTAMP_KEY ? String(now) : key === DRAFT_KEY ? JSON.stringify({ version: 7, form: { fullName: "Saved Student" }, disclaimerAccepted: true }) : null };
  const draft = readDraft(storage, now);
  assert.equal(draft.form.fullName, "Saved Student");
  assert.equal(draft.disclaimerAccepted, false);
});

test("both signatures are required and accept only nonempty JPEG or PNG uploads up to 2 MB", () => {
  const errors = validateFormUploads(normalizeForm(), {});
  for (const key of ["signature", "parentSignature"]) {
    assert.match(errors[key], /required/);
    assert.equal(validateUpload({ name: "signature.JPEG", type: "image/jpeg", size: MAX_UPLOAD_BYTES }, key), "");
    assert.match(validateUpload({ name: "signature.jpg", type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 }, key), /2 MB/);
    assert.equal(validateUpload({ name: "signature.png", type: "image/png", size: 10 }, key), "");
    assert.match(validateUpload({ name: "signature.webp", type: "image/webp", size: 10 }, key), /Only JPG, JPEG or PNG/);
    assert.match(validateUpload({ name: "signature.jpg", type: "image/jpeg", size: 0 }, key), /empty/);
  }
});
