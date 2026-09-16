import test from "node:test";
import assert from "node:assert/strict";
import { submissionFeedback } from "./submissionFeedback.js";

test("400 validation errors keep the server message and map fields to frontend names", () => {
  const feedback = submissionFeedback({ response: { status: 400, data: { error: "Please correct the required form fields", fields: { dob: "Enter a valid date (YYYY-MM-DD)", enrollmentSubjects: "Provide a JSON array with at least one listed subject", course: "Course must match courseSelection", ignored: 42 } } } });
  assert.equal(feedback.message, "Please correct the required form fields");
  assert.deepEqual(feedback.fields, { dob: "Enter a valid date (YYYY-MM-DD)", individualSubjects: "Provide a JSON array with at least one listed subject", courseSelection: "Course must match courseSelection" });
});

test("server image dimension errors are shown on the photo and signature fields", () => {
  const message = "Photo must be exactly 413 × 531 px. Your image is 600 × 800 px. Please resize it using Reduce Images.";
  const signature = "Signature must be exactly 300 × 150 px. Your image is 500 × 200 px. Please resize it using Reduce Images.";
  const parent = "Parent's signature must be exactly 300 × 150 px. Your image is 150 × 300 px. Please resize it using Reduce Images.";
  const feedback = submissionFeedback({ response: { status: 400, data: { error: message, fields: { photo: message, signature, parentSignature: parent } } } });
  assert.equal(feedback.message, message);
  assert.deepEqual(feedback.fields, { photo: message, signature, parentSignature: parent });
});

test("network, timeout and server failures give safe messages without internal details", () => {
  assert.match(submissionFeedback(new Error("Network Error")).message, /could not reach/);
  assert.match(submissionFeedback({ code: "ECONNABORTED" }).message, /took too long/);
  assert.match(submissionFeedback({ response: { status: 503, data: { error: "Submission failed. Please try again." } } }).message, /temporarily unavailable/);
  const internal = submissionFeedback({ response: { status: 500, data: { error: "Queue failure", jobId: "job-1", applicationId: "SKY-GS-2026-09-0001", fields: { fullName: "x" } } } });
  assert.equal(/Queue|job-1|SKY-GS/.test(internal.message), false);
  assert.deepEqual(internal.fields, {});
});
