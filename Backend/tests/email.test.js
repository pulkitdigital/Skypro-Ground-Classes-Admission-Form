const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const brevo = require("@getbrevo/brevo");
const sendAdmissionEmails = require("../services/emailService");
const { normalizeAdmission } = require("../services/admissionContract");
const { validBody, filesFor } = require("./fixtures");

const ID = "SKY-GS-2026-09-0001";
const INTERNAL = [ID, "SKY-GS", "Application ID", "Office Use", "OFFICE USE", "Admission No", "Verified By", "Remarks"];

function admission(extra = {}) {
  const body = validBody({ courseSelection: "Individual Subject(s)", enrollmentSubjects: JSON.stringify(["Air Navigation", "Technical General"]), modeOfClass: "Offline", ...extra });
  const form = normalizeAdmission(body, filesFor(body), new Date("2026-09-14T06:30:00Z"));
  form.applicationId = ID;
  return form;
}

async function mailSetup(t, send = async () => ({ messageId: "test-only" })) {
  const messages = [];
  t.mock.method(brevo.TransactionalEmailsApi.prototype, "sendTransacEmail", async message => { messages.push(message); return send(message); });
  t.mock.method(brevo.AccountApi.prototype, "getAccount", async () => ({}));
  const keys = ["BREVO_API_KEY", "MAIL_FROM", "ADMIN_EMAIL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BREVO_API_KEY: "mock", MAIL_FROM: "sender@example.com", ADMIN_EMAIL: "info@skyproaviation.org" });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-email-test-"));
  t.after(async () => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } await fs.rm(dir, { recursive: true, force: true }); });
  const adminPdfPath = path.join(dir, "SkyPro_GroundSchool_Test_Student_Admin_Copy.pdf");
  const studentPdfPath = path.join(dir, "SkyPro_GroundSchool_Test_Student_Student_Copy.pdf");
  await fs.writeFile(studentPdfPath, "student-only-pdf");
  await fs.writeFile(adminPdfPath, "admin-only-pdf");
  return { messages, adminPdfPath, studentPdfPath };
}
const byRecipient = (messages, email) => messages.filter(message => message.to[0].email === email);

test("admin template carries applicant, course, mode, contact details and the internal ID", () => {
  const form = admission();
  const email = sendAdmissionEmails.buildAdminEmail(form, { from: "sender@example.com", to: "info@skyproaviation.org", pdfName: `${ID}-Test-Student-Admission-Form.pdf`, pdfContent: "cGRm" });
  assert.equal(email.to[0].email, "info@skyproaviation.org");
  assert.ok(email.subject.includes("Test Student") && email.subject.includes(ID));
  for (const body of [email.htmlContent, email.textContent]) {
    for (const expected of [ID, "Test Student", "Individual Subject(s)", "Air Navigation, Technical General", "Offline", "+91 9876543210", "student@example.com", "Test Mother (Mother), +91 9876543210", "14 Sep 2026, 12:00 IST"]) {
      assert.ok(body.includes(expected), `admin email missing ${expected}`);
    }
  }
  assert.deepEqual(email.attachment, [{ name: `${ID}-Test-Student-Admission-Form.pdf`, content: "cGRm" }]);
});

test("student template has no internal identifier or office fields, and escapes applicant text", () => {
  const form = admission({ fullName: "Anya O'Brien & Co" });
  const email = sendAdmissionEmails.buildStudentEmail(form, { from: "sender@example.com", contactEmail: "info@skyproaviation.org", pdfName: "SkyPro_GroundSchool_Anya_O_Brien_Co_Student_Copy.pdf", pdfContent: "cGRm" });
  const serialized = JSON.stringify(email);
  for (const hidden of INTERNAL) assert.equal(serialized.includes(hidden), false, `student email leaked ${hidden}`);
  assert.equal(email.attachment.length, 1);
  sendAdmissionEmails.assertStudentSafe(email, form);
  assert.equal(email.to[0].email, "student@example.com");
  assert.ok(email.htmlContent.includes("Anya O&#39;Brien &amp; Co"));
  assert.ok(email.textContent.includes("Anya O'Brien & Co"));
  assert.ok(email.textContent.includes("Individual Subject(s)"));
  assert.throws(() => sendAdmissionEmails.assertStudentSafe({ ...email, textContent: `Reference ${ID}` }, form), /internal content/);
});

test("sending routes distinct copies to their intended recipients", async t => {
  const { messages, adminPdfPath, studentPdfPath } = await mailSetup(t);
  await sendAdmissionEmails({ formData: admission(), adminPdfPath, studentPdfPath, retryDelay: () => 0 });
  assert.equal(messages.length, 2);
  const [admin] = byRecipient(messages, "info@skyproaviation.org");
  const [student] = byRecipient(messages, "student@example.com");
  assert.ok(admin.subject.includes(ID) && admin.htmlContent.includes(ID) && admin.textContent.includes(ID));
  assert.equal(admin.attachment.length, 1);
  assert.equal(admin.attachment[0].name, "SkyPro_GroundSchool_Test_Student_Admin_Copy.pdf");
  assert.equal(Buffer.from(admin.attachment[0].content, "base64").toString(), "admin-only-pdf");
  for (const hidden of INTERNAL) assert.equal(JSON.stringify(student).includes(hidden), false, `student email leaked ${hidden}`);
  assert.equal(student.attachment[0].name, "SkyPro_GroundSchool_Test_Student_Student_Copy.pdf");
  assert.equal(Buffer.from(student.attachment[0].content, "base64").toString(), "student-only-pdf");
});

test("a failed recipient is retried on the next job attempt without resending the delivered one", async t => {
  let studentAvailable = false;
  const { messages, adminPdfPath, studentPdfPath } = await mailSetup(t, async message => {
    if (message.to[0].email === "student@example.com" && !studentAvailable) throw new Error("Brevo unavailable");
    return { messageId: "test-only" };
  });
  const delivered = {};
  await assert.rejects(sendAdmissionEmails({ formData: admission(), adminPdfPath, studentPdfPath, delivered, retryDelay: () => 0 }), /Student Confirmation failed after 3 attempts/);
  assert.deepEqual(delivered, { admin: true });
  assert.equal(byRecipient(messages, "info@skyproaviation.org").length, 1);
  studentAvailable = true;
  await sendAdmissionEmails({ formData: admission(), adminPdfPath, studentPdfPath, delivered, retryDelay: () => 0 });
  assert.deepEqual(delivered, { admin: true, student: true });
  assert.equal(byRecipient(messages, "info@skyproaviation.org").length, 1, "admin email is not duplicated");
  assert.equal(byRecipient(messages, "student@example.com").length, 4);
});


test("missing, swapped, identical and reused admin copies are rejected before sending", async t => {
  const { messages, adminPdfPath, studentPdfPath } = await mailSetup(t);
  const base = { formData: admission(), adminPdfPath, studentPdfPath };
  await assert.rejects(sendAdmissionEmails({ ...base, studentPdfPath: undefined }), /Both Admin/);
  await assert.rejects(sendAdmissionEmails({ ...base, studentPdfPath: adminPdfPath }), /separate files/);
  await assert.rejects(sendAdmissionEmails({ ...base, adminPdfPath: studentPdfPath, studentPdfPath: adminPdfPath }), /intended recipients/);
  await fs.copyFile(adminPdfPath, studentPdfPath);
  await assert.rejects(sendAdmissionEmails(base), /different content/);
  assert.equal(messages.length, 0);
});
