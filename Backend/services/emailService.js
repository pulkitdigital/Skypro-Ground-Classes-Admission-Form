// Backend/services/emailService.js
require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { admissionPdfName } = require("./pdfGenerator");
const brevo = require("@getbrevo/brevo");
const { formatDateTime, phone } = require("./formatting");

/* ==========================
   BREVO API CLIENT (SINGLETON)
========================== */

let apiInstance;
let isVerified = false;

function createBrevoClient() {
  if (apiInstance) return apiInstance;

  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    throw new Error("❌ BREVO_API_KEY missing in .env");
  }

  console.log("📧 Initializing Brevo API client...");

  apiInstance = new brevo.TransactionalEmailsApi();
  apiInstance.authentications["apiKey"].apiKey = apiKey;

  return apiInstance;
}

/* ==========================
   VERIFY API KEY (ONE TIME)
========================== */

async function verifyConnection() {
  if (isVerified) return;

  createBrevoClient();

  try {
    console.log("🔍 Verifying Brevo API key...");

    const accountApi = new brevo.AccountApi();
    accountApi.authentications["apiKey"].apiKey = process.env.BREVO_API_KEY;
    await accountApi.getAccount();

    console.log("✅ Brevo API key verified successfully");
    isVerified = true;
  } catch (error) {
    console.error("❌ Brevo API verification failed:", error.message);
    throw new Error(`Brevo API Error: ${error.message}`);
  }
}

/* ==========================
   EMAIL CONTENT
========================== */

const FROM_NAME = "SkyPro Aviation";
const SKYPRO_PHONE = "+91 8209388460";
const CELL = "padding: 8px; border-bottom: 1px solid #d1d5db;";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const courseOf = form => form.courseSelection || form.course || "";
const subjectsOf = form => (form.enrollmentSubjects || []).join(", ");
const htmlRows = rows => rows.map(([label, value]) => `
          <tr>
            <td style="${CELL}"><strong>${escapeHtml(label)}:</strong></td>
            <td style="${CELL}">${escapeHtml(value || "N/A")}</td>
          </tr>`).join("");
const textRows = rows => rows.map(([label, value]) => `${label}: ${value || "N/A"}`).join("\n");

const DOCUMENTS_NOT_ATTACHED = "Supporting documents are NOT attached: none of the uploaded documents could be appended. See Submitted Documents in the form and request the originals from the student.";

// Internal notification for SkyPro admissions (ADMIN_EMAIL). `documentsPdf` is
// omitted when no supporting document could be appended.
function buildAdminEmail(form, { from, to, formPdf, documentsPdf }) {
  const attachments = [formPdf, documentsPdf].filter(Boolean);
  const attachmentLine = `Attachments: ${attachments.map(file => file.name).join(", ")}`;
  const emergency = form.emergencyContact || {};
  const applicationId = form.applicationId || "Not allocated";
  const rows = [
    ["SkyPro Application ID (Internal)", applicationId],
    ["Applicant Name", form.fullName],
    ["Course / Package", courseOf(form)],
    ["Subjects", subjectsOf(form)],
    ["Class Mode", form.modeOfClass],
    ["WhatsApp Number", phone(form.mobileCountryCode, form.mobile)],
    ["Email", form.email],
    ["Emergency Contact", emergency.name ? `${emergency.name} (${emergency.relationship}), ${phone(emergency.countryCode, emergency.mobile)}` : ""],
    ["Submitted", formatDateTime(form.submittedAt)],
  ];
  return {
    sender: { name: FROM_NAME, email: from },
    to: [{ email: to }],
    subject: `New Ground School Admission – ${form.fullName} – ${applicationId}`,
    htmlContent: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
        New Ground School Admission Application Received
      </h2>

      <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #1f2937; margin-top: 0;">Applicant Information</h3>
        <table style="width: 100%; border-collapse: collapse;">${htmlRows(rows)}
        </table>
      </div>

      <p style="color: #059669; font-weight: bold; margin: 20px 0;">
        📎 ${escapeHtml(attachmentLine)}
      </p>${documentsPdf ? "" : `

      <p style="color: #b91c1c; font-weight: bold; margin: 20px 0;">
        ⚠️ ${escapeHtml(DOCUMENTS_NOT_ATTACHED)}
      </p>`}

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

      <p style="color: #6b7280; font-size: 12px;">
        Internal notification from the SkyPro Aviation admission system. Do not forward to the applicant.
      </p>
    </div>
  `,
    textContent: `New Ground School admission application received.\n\n${textRows(rows)}\n\n${attachmentLine}${documentsPdf ? "" : `\n${DOCUMENTS_NOT_ATTACHED}`}\n\nInternal notification from the SkyPro Aviation admission system. Do not forward to the applicant.`,
    attachment: attachments.map(({ name, content }) => ({ name, content })),
  };
}

// Applicant confirmation. Built only from applicant-facing fields and never
// carries only the separately generated student PDF, never internal office data.
function buildStudentEmail(form, { from, contactEmail, pdfName, pdfContent }) {
  const rows = [
    ["Course", courseOf(form)],
    ["Subjects", subjectsOf(form)],
    ["Mode", form.modeOfClass],
    ["Submitted", formatDateTime(form.submittedAt)],
  ];
  const name = escapeHtml(form.fullName);
  return {
    sender: { name: FROM_NAME, email: from },
    to: [{ email: form.email, name: form.fullName }],
    subject: "Admission Application Received – SkyPro Aviation",
    attachment: [{ name: pdfName, content: pdfContent }],
    htmlContent: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #2563eb; margin: 0;">SkyPro Aviation</h1>
        <p style="color: #6b7280; margin: 5px 0;">Excellence in Aviation Training</p>
      </div>

      <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
        <h2 style="margin: 0 0 10px 0;">Application Received Successfully! ✓</h2>
        <p style="margin: 0; opacity: 0.9;">Thank you for choosing SkyPro Aviation</p>
      </div>

      <p style="font-size: 16px; line-height: 1.6;">Dear <strong>${name}</strong>,</p>

      <p style="font-size: 15px; line-height: 1.6; color: #374151;">
        We are pleased to confirm that your admission application for <strong>${escapeHtml(courseOf(form))}</strong>
        has been successfully received and is now being processed by our admissions team.
      </p>

      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 0; color: #92400e;">
          <strong>⏳ Next Steps:</strong><br>
          Our admissions team will review your application and contact you within 2-3 business days
          regarding the next steps in the admission process.
        </p>
      </div>

      <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #1f2937; margin-top: 0;">Application Details</h3>
        <table style="width: 100%; border-collapse: collapse;">${htmlRows(rows)}
        </table>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #6b7280;">
        If you have any questions in the meantime, please don't hesitate to reach out to us.
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

      <div style="text-align: center; color: #6b7280; font-size: 14px;">
        <p style="margin: 5px 0;"><strong>Best Regards,</strong></p>
        <p style="margin: 5px 0;"><strong>SkyPro Aviation Admissions Team</strong></p>
        <p style="margin: 5px 0;">📧 ${escapeHtml(contactEmail)}</p>
        <p style="margin: 5px 0;">📞 ${SKYPRO_PHONE}</p>
        <p style="margin: 15px 0 5px 0; font-size: 12px; color: #9ca3af;">
          This is an automated confirmation email. Please do not reply to this message.
        </p>
      </div>
    </div>
  `,
    textContent: `Dear ${form.fullName},\n\nWe are pleased to confirm that your admission application for ${courseOf(form)} has been successfully received and is now being processed by our admissions team.\n\nNext Steps: Our admissions team will review your application and contact you within 2-3 business days regarding the next steps in the admission process.\n\nApplication Details\n${textRows(rows)}\n\nIf you have any questions in the meantime, please don't hesitate to reach out to us.\n\nBest Regards,\nSkyPro Aviation Admissions Team\n${contactEmail}\n${SKYPRO_PHONE}\n\nThis is an automated confirmation email. Please do not reply to this message.`,
  };
}

// Defense in depth: refuse to send if internal data ever reaches the student message.
function assertStudentSafe(message, form) {
  const serialized = JSON.stringify(message);
  const internal = [form.applicationId, "Application ID", "Office Use", "Admission No", "Verified By", "Remarks"].filter(Boolean);
  const leaked = internal.find(value => serialized.includes(value));
  if (leaked) throw new Error("Student confirmation contains internal content; not sent");
  if (message.attachment?.length !== 1 || message.attachment[0].name !== admissionPdfName(form.fullName, "student") || !message.attachment[0].content) {
    throw new Error("Student confirmation requires the Student Copy PDF; not sent");
  }
}

/* ==========================
   SEND BOTH EMAILS
========================== */

// `delivered` is owned by the queue job, so a job retry resends only the
// message that has not been delivered yet.
// `adminDocumentsPdfPath` is null when no supporting document could be appended.
async function sendAdminEmail({ formData, adminFormPdfPath, adminDocumentsPdfPath, studentPdfPath, delivered = {}, retryDelay = attempt => attempt * 3000 }) {
  const FROM_EMAIL = process.env.MAIL_FROM;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

  if (!FROM_EMAIL || !ADMIN_EMAIL) {
    throw new Error("❌ MAIL_FROM or ADMIN_EMAIL missing in .env");
  }
  if (!adminFormPdfPath || !studentPdfPath) throw new Error("Both Admin Form and Student Copy PDFs are required");
  const adminPaths = [["form", adminFormPdfPath], ["documents", adminDocumentsPdfPath]].filter(([, file]) => file);
  if (adminPaths.some(([, file]) => path.resolve(file) === path.resolve(studentPdfPath)) || (adminDocumentsPdfPath && path.resolve(adminFormPdfPath) === path.resolve(adminDocumentsPdfPath))) {
    throw new Error("Admin and Student Copy PDFs must be separate files");
  }
  if (adminPaths.some(([part, file]) => path.basename(file) !== admissionPdfName(formData.fullName, "admin", part)) || path.basename(studentPdfPath) !== admissionPdfName(formData.fullName, "student")) {
    throw new Error("PDF copy paths do not match their intended recipients");
  }
  const studentBytes = await fs.readFile(studentPdfPath);
  const [formPdf, documentsPdf] = await Promise.all(adminPaths.map(async ([part, file]) => {
    const bytes = await fs.readFile(file);
    if (bytes.equals(studentBytes)) throw new Error("Admin and Student Copy PDFs must have different content");
    return { name: admissionPdfName(formData.fullName, "admin", part), content: bytes.toString("base64") };
  }));

  const admin = buildAdminEmail(formData, { from: FROM_EMAIL, to: ADMIN_EMAIL, formPdf, documentsPdf });
  const student = buildStudentEmail(formData, { from: FROM_EMAIL, contactEmail: ADMIN_EMAIL,
    pdfName: admissionPdfName(formData.fullName, "student"), pdfContent: studentBytes.toString("base64") });
  assertStudentSafe(student, formData);

  await verifyConnection();
  const client = createBrevoClient();

  const sendWithRetry = async (emailData, label, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📤 Sending ${label} (Attempt ${attempt}/${maxRetries})...`);
        const result = await client.sendTransacEmail(emailData);
        console.log(`✅ ${label} sent successfully`);
        console.log(`   Message ID: ${result.messageId}`);
        return result;
      } catch (error) {
        console.error(`❌ ${label} Attempt ${attempt} failed:`, error.message);
        if (attempt === maxRetries) {
          throw new Error(`${label} failed after ${maxRetries} attempts: ${error.message}`);
        }
        const waitTime = retryDelay(attempt);
        console.log(`⏳ Waiting ${waitTime / 1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  };

  console.log("🚀 Sending emails via Brevo API...");

  const pending = [["admin", admin, "Admin Email"], ["student", student, "Student Confirmation"]].filter(([key]) => !delivered[key]);
  const results = await Promise.allSettled(pending.map(async ([key, message, label]) => {
    await sendWithRetry(Object.assign(new brevo.SendSmtpEmail(), message), label);
    delivered[key] = true;
  }));
  const failures = results.filter(result => result.status === "rejected").map(result => result.reason.message);
  if (failures.length) {
    console.error("❌ Email sending failed:", failures.join("; "));
    throw new Error(failures.join("; "));
  }

  console.log("✅ All emails sent successfully via Brevo API!");
}

module.exports = Object.assign(sendAdminEmail, { buildAdminEmail, buildStudentEmail, assertStudentSafe });
