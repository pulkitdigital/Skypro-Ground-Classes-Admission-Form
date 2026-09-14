import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeContacts, hiddenContactFields, validateContacts, deriveEmergencyContact } from "./contactModel.js";
import { normalizeForm, createSubmission, readDraft, DRAFT_KEY, DRAFT_TIMESTAMP_KEY, DRAFT_VERSION } from "./formState.js";
import { omitFields } from "./aviationWorkflowModel.js";

const complete = () => normalizeForm({
  fatherName: "Father Name", fatherMobile: "9876543210", fatherEmail: "father@example.com", fatherOccupation: "Teacher",
  motherName: "Mother Name", motherMobileCountry: "SG", motherMobileCountryCode: "+65", motherMobile: "81234567", motherEmail: "mother@example.com", motherOccupation: "Engineer",
  hasJaipurContact: "Yes", jaipurContactName: "Local Name", jaipurContactRelationship: "Uncle", jaipurContactMobile: "9123456789", jaipurContactAddress: "12 Test Road, Jaipur",
  emergencyContactSource: "Other", emergencyOtherName: " Other Name ", emergencyOtherRelationship: " Friend ", emergencyOtherMobileCountry: "GB", emergencyOtherMobileCountryCode: "+44", emergencyOtherMobile: "07911123456",
});

test("both parent sections require names, occupations, valid email and country-aware phone", () => {
  assert.deepEqual(validateContacts(complete()), {});
  for (const prefix of ["father", "mother"]) {
    for (const suffix of ["Name", "Occupation", "Email", "Mobile"]) {
      const key = prefix + suffix;
      assert.ok(validateContacts({ ...complete(), [key]: "" })[key]);
    }
    assert.ok(validateContacts({ ...complete(), [prefix + "Email"]: "bad@" })[prefix + "Email"]);
    assert.ok(validateContacts({ ...complete(), [prefix + "Mobile"]: "123" })[prefix + "Mobile"]);
  }
  const switched = sanitizeContacts({ ...complete(), fatherMobileCountry: "SG", fatherMobile: "81234567" }, "fatherMobileCountry");
  assert.equal(switched.fatherMobileCountryCode, "+65");
  assert.deepEqual(validateContacts(switched), {});
});

test("Jaipur fields are conditionally required; removing Jaipur clears values/errors and its emergency selection", () => {
  for (const key of ["jaipurContactName", "jaipurContactRelationship", "jaipurContactMobile", "jaipurContactAddress"]) assert.ok(validateContacts({ ...complete(), [key]: "" })[key]);
  const unavailable = { ...complete(), hasJaipurContact: "No", emergencyContactSource: "Jaipur Local Contact" };
  assert.ok(validateContacts(unavailable).emergencyContactSource);
  const next = sanitizeContacts(unavailable);
  assert.equal(next.emergencyContactSource, "");
  for (const key of hiddenContactFields(next)) assert.equal(next[key], "");
  const errors = { jaipurContactName: "old", jaipurContactMobile: "old", emergencyContactSource: "old" };
  assert.deepEqual(omitFields(errors, [...hiddenContactFields(next), "emergencyContactSource"]), {});
  assert.deepEqual(validateContacts({ ...next, emergencyContactSource: "Mother" }), {});
  assert.equal(deriveEmergencyContact(unavailable), null);
});

test("Mother/Father/Jaipur emergency contacts are derived from current data, not copied state", () => {
  const form = complete();
  for (const [source, prefix, relationship] of [["Mother", "mother", "Mother"], ["Father", "father", "Father"], ["Jaipur Local Contact", "jaipurContact", "Uncle"]]) {
    const selected = sanitizeContacts({ ...form, emergencyContactSource: source });
    const emergency = deriveEmergencyContact(selected);
    assert.equal(emergency.name, form[prefix + "Name"]);
    assert.equal(emergency.relationship, relationship);
    assert.equal(emergency.countryCode, form[prefix + "MobileCountryCode"]);
    assert.equal(selected.emergencyOtherName, "");
    assert.equal(deriveEmergencyContact({ ...selected, [prefix + "Name"]: "Updated Name" }).name, "Updated Name");
    assert.equal(deriveEmergencyContact({ ...selected, [prefix + "Mobile"]: "9123456789" }).mobile, "9123456789");
    assert.equal("emergencyContact" in selected, false);
  }
});

test("Other requires its fields, normalizes phone and name, and is cleared when source changes", () => {
  const form = complete();
  for (const key of ["emergencyOtherName", "emergencyOtherRelationship", "emergencyOtherMobile"]) assert.ok(validateContacts({ ...form, [key]: "" })[key]);
  assert.deepEqual(deriveEmergencyContact(form), { source: "Other", name: "Other Name", relationship: "Friend", countryCode: "+44", mobile: "7911123456" });
  const next = sanitizeContacts({ ...form, emergencyContactSource: "Father" });
  const hidden = hiddenContactFields(next);
  assert.deepEqual(omitFields({ emergencyOtherName: "old error", emergencyOtherMobile: "old error" }, hidden), {});
  const reopened = sanitizeContacts({ ...next, emergencyContactSource: "Other" });
  assert.equal(reopened.emergencyOtherName, "");
  assert.equal(reopened.emergencyOtherMobile, "");
  assert.equal(reopened.emergencyOtherMobileCountryCode, "+91");
  assert.ok(validateContacts({ ...form, emergencyContactSource: "" }).emergencyContactSource);
});

test("drafts restore new contacts, discard generic guardian keys, and sanitize hidden data", () => {
  const now = Date.now();
  const storage = (data) => ({ getItem: (key) => key === DRAFT_KEY ? JSON.stringify(data) : key === DRAFT_TIMESTAMP_KEY ? String(now) : null });
  assert.deepEqual(readDraft(storage({ version: DRAFT_VERSION, form: complete() }), now).form, complete());
  const old = readDraft(storage({ version: 5, form: { fullName: "Applicant", parentName: "Generic Guardian", parentMobile: "9876543210", relationship: "Uncle", occupation: "Teacher" } }), now).form;
  assert.equal(old.fullName, "Applicant");
  assert.equal(old.fatherName, "");
  assert.equal(old.motherName, "");
  for (const key of ["parentName", "parentMobile", "relationship", "occupation"]) assert.equal(key in old, false);
  const stale = readDraft(storage({ version: DRAFT_VERSION, form: { ...complete(), hasJaipurContact: "No", emergencyContactSource: "Jaipur Local Contact" } }), now).form;
  assert.equal(stale.emergencyContactSource, "");
  assert.equal(stale.jaipurContactName, "");
});

test("multipart includes one normalized emergency object and excludes stale Other/Jaipur and legacy values", () => {
  const raw = { ...complete(), hasJaipurContact: "No", emergencyContactSource: "Mother", parentName: "obsolete", parentMobile: "obsolete", relationship: "obsolete", occupation: "obsolete", feesPaid: "Yes" };
  const payload = createSubmission(raw, {}, "token");
  assert.equal(payload.getAll("emergencyContact").length, 1);
  assert.deepEqual(JSON.parse(payload.get("emergencyContact")), { source: "Mother", name: "Mother Name", relationship: "Mother", countryCode: "+65", mobile: "81234567" });
  for (const key of [...hiddenContactFields(raw), "parentName", "parentMobile", "relationship", "occupation", "feesPaid"]) assert.equal(payload.has(key), false);
  assert.equal(payload.get("emergencyContactSource"), "Mother");
});
