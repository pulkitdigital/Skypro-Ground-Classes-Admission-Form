import test from "node:test";
import assert from "node:assert/strict";
import { QUALIFICATION_OPTIONS, PHYSICS_MATHEMATICS_OPTIONS, sanitizeEducation, validateEducation } from "./educationModel.js";
import { normalizeForm, readDraft, createSubmission, validateUpload, validateFormUploads, isUploadVisible, DRAFT_KEY, DRAFT_TIMESTAMP_KEY, DRAFT_VERSION, MAX_UPLOAD_BYTES } from "./formState.js";
import { omitFields } from "./aviationWorkflowModel.js";

const obsolete = { school: "Old school", classYear: "Graduation", class12Stream: "Science", board: "Old board" };
const valid = () => normalizeForm({ highestQualification: "Graduate", physicsMathematicsStatus: "Physics and Mathematics Completed" });
const pdf = (name) => new File(["%PDF-1.7"], name, { type: "application/pdf" });

test("qualification and Physics/Mathematics selections are required and accept all specified options", () => {
  assert.ok(validateEducation(normalizeForm()).highestQualification);
  assert.ok(validateEducation(normalizeForm()).physicsMathematicsStatus);
  for (const highestQualification of QUALIFICATION_OPTIONS) {
    for (const physicsMathematicsStatus of PHYSICS_MATHEMATICS_OPTIONS) {
      assert.deepEqual(validateEducation({ ...valid(), highestQualification, physicsMathematicsStatus, otherQualification: "Diploma" }), {});
    }
  }
  assert.ok(validateEducation({ ...valid(), highestQualification: "Graduation" }).highestQualification);
  assert.ok(validateEducation({ ...valid(), physicsMathematicsStatus: "Science" }).physicsMathematicsStatus);
});

test("Other requires text and switching away clears it and permits error removal", () => {
  assert.ok(validateEducation({ ...valid(), highestQualification: "Other", otherQualification: "  " }).otherQualification);
  const next = sanitizeEducation({ ...valid(), otherQualification: "Old diploma" });
  assert.equal(next.otherQualification, "");
  assert.deepEqual(validateEducation(next), {});
  assert.deepEqual(omitFields({ otherQualification: "old error" }, ["otherQualification"]), {});
  assert.equal(createSubmission({ ...valid(), otherQualification: "stale" }, {}, "token").has("otherQualification"), false);
});

test("old academic keys are excluded from state, restored drafts, and multipart", () => {
  const form = normalizeForm({ ...valid(), ...obsolete });
  const payload = createSubmission({ ...form, ...obsolete }, {}, "token");
  const now = Date.now();
  const storage = (draft) => ({ getItem: (key) => key === DRAFT_KEY ? JSON.stringify(draft) : key === DRAFT_TIMESTAMP_KEY ? String(now) : null });
  const old = readDraft(storage({ version: 4, form: { fullName: "Saved Applicant", ...obsolete } }), now);
  assert.equal(old.form.fullName, "Saved Applicant");
  assert.equal(old.form.highestQualification, "");
  for (const key of Object.keys(obsolete)) {
    assert.equal(key in form, false);
    assert.equal(key in old.form, false);
    assert.equal(payload.has(key), false);
  }
  const current = { ...valid(), highestQualification: "Other", otherQualification: "Diploma" };
  assert.deepEqual(readDraft(storage({ version: DRAFT_VERSION, form: current }), now).form, current);
  assert.equal(createSubmission(current, {}, "token").get("otherQualification"), "Diploma");
});

test("both marksheets remain required for every qualification and completion status", () => {
  for (const highestQualification of QUALIFICATION_OPTIONS) {
    for (const physicsMathematicsStatus of PHYSICS_MATHEMATICS_OPTIONS) {
      const errors = validateFormUploads({ ...valid(), highestQualification, physicsMathematicsStatus }, {});
      assert.ok(errors.marksheet10);
      assert.ok(errors.marksheet12);
    }
  }
});

test("Aadhaar is Indian-only; foreigners require a passport instead and hidden files are not submitted", () => {
  const indian = { ...valid(), nationality: "Indian National" };
  const foreign = { ...valid(), nationality: "Foreign National" };
  assert.ok(validateFormUploads(indian, {}).aadhar);
  assert.equal(validateFormUploads(indian, {}).passport, undefined);
  assert.equal(validateFormUploads(foreign, {}, { aadhar: "old error" }).aadhar, undefined);
  assert.ok(validateFormUploads(foreign, {}).passport);
  assert.equal(isUploadVisible("aadhar", foreign), false);
  assert.equal(isUploadVisible("aadhar", { ...valid(), nationality: "" }), false);
  const files = { aadhar: pdf("aadhaar.pdf"), passport: pdf("passport.pdf"), marksheet10: pdf("10.pdf"), marksheet12: pdf("12.pdf") };
  const foreignPayload = createSubmission(foreign, files, "token");
  assert.equal(foreignPayload.has("aadhar"), false);
  assert.ok(foreignPayload.get("passport"));
  const indianPayload = createSubmission(indian, files, "token");
  assert.ok(indianPayload.get("aadhar"));
  assert.equal(indianPayload.has("passport"), false);
  for (const key of ["marksheet10", "marksheet12"]) assert.equal(foreignPayload.getAll(key).length, 1);
});

test("central upload validation enforces PDF/JPEG MIME, legacy image/jpg compatibility, and byte limits", () => {
  for (const key of ["marksheet10", "marksheet12", "aadhar"]) {
    assert.equal(validateUpload({ name: "document.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES }, key), "");
    assert.ok(validateUpload({ name: "document.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 }, key));
    assert.ok(validateUpload({ name: "document.pdf", type: "image/jpeg", size: 100 }, key));
    assert.ok(validateUpload({ name: "document.pdf", type: "application/pdf", size: 0 }, key));
  }
  for (const key of ["photo", "signature", "parentSignature"]) {
    assert.equal(validateUpload({ name: "image.jpeg", type: "image/jpeg", size: MAX_UPLOAD_BYTES }, key), "");
    assert.equal(validateUpload({ name: "image.jpg", type: "image/jpg", size: 100 }, key), "");
    assert.ok(validateUpload({ name: "image.png", type: "image/png", size: 100 }, key));
    assert.ok(validateUpload({ name: "image.jpeg", type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 }, key));
  }
});
