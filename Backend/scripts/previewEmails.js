// Testing only: runs fictional admissions through the real queue, PDF and email code
// and captures the admin and student Brevo payloads. It never calls the API,
// reCAPTCHA, Google Sheets or the Application ID ledger (IDs are fixed fakes).
//   node scripts/previewEmails.js                       dry run, all scenarios -> tmp/email-preview
//   node scripts/previewEmails.js --smtp-local [--smtp-host localhost] [--smtp-port 1025] [--scenario ...]
//   node scripts/previewEmails.js --send --to <test@email> [--scenario indian|foreign|unreadable|all]
// Dry run and --smtp-local need no Brevo key. --smtp-local delivers the captured payloads
// to a local SMTP catcher (Mailpit) with a "[LOCAL] " prefix and fixed local recipients.
// --send uses BREVO_API_KEY and MAIL_FROM from .env; every message goes to --to only,
// with a "[TEST] " subject prefix. ADMIN_EMAIL and applicant addresses are never used.
const fs = require("node:fs/promises");
const path = require("node:path");
const brevo = require("@getbrevo/brevo");
const nodemailer = require("nodemailer");
const { PDFDocument } = require("pdf-lib");
const { createQueue } = require("../services/queueService");
const generatePDF = require("../services/pdfGenerator");
const sendAdminEmail = require("../services/emailService");
const { SCENARIOS: PDF_SCENARIOS, admissionFromBody, extractText } = require("../tests/pdfFixtures");
const { validBody } = require("../tests/fixtures");

const OUTPUT_ROOT = path.join(__dirname, "../tmp/email-preview");
const PRODUCTION_ADMIN = "info@skyproaviation.org";
const STUDENT_SUBJECT = "Admission Application Received – SkyPro Aviation";
const STUDENT_FORBIDDEN = ["Application ID", "Office Use", "Admission No", "Verified By"];
const DRY_RUN_ENV = { BREVO_API_KEY: "dry-run-not-used", MAIL_FROM: "no-reply@preview.invalid", ADMIN_EMAIL: "admin@preview.invalid" };
const LOCAL_RECIPIENTS = { admin: "admin@preview.local", student: "student@preview.local" };
const LOCAL_SMTP_HOSTS = ["localhost", "127.0.0.1"];
const MAILPIT_HINT = "Mailpit start karo: http://localhost:8025";

const indianBody = extra => validBody({
  fullName: "Aarav Sharma", modeOfClass: "Offline",
  hasDgcaComputerNumber: "Yes", dgcaComputerNumber: "DGCA-CN-100201", dgcaPapersCleared: "Yes", dgcaSubjects: JSON.stringify(["Air Regulations", "Air Navigation"]), dgcaExamResultDate: "2026-06-10",
  hasEgcaId: "Yes", egcaId: "EGCA-100201", hasDgcaMedical: "Yes", dgcaMedicalClass: "DGCA Class-2 Medical", ...extra,
});

// Fictional applicants; `unreadable` replaces every uploaded PDF with invalid bytes.
const SCENARIOS = {
  indian: { applicationId: "SKY-GS-TEST-0001", body: indianBody() },
  foreign: { applicationId: "SKY-GS-TEST-0002", body: PDF_SCENARIOS["foreign-individual-dgca"].body },
  unreadable: { applicationId: "SKY-GS-TEST-0003", body: indianBody({ fullName: "Kabir Mehta" }), unreadable: true },
};

function parseArgs(argv) {
  const options = { send: false, to: undefined, scenario: undefined, smtpLocal: false, smtpHost: undefined, smtpPort: undefined };
  for (let index = 0; index < argv.length; index++) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    const value = () => { const next = inline ?? argv[++index]; if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value`); return next; };
    if (flag === "--send") options.send = true;
    else if (flag === "--to") options.to = value().trim();
    else if (flag === "--scenario") options.scenario = value().trim();
    else if (flag === "--smtp-local") options.smtpLocal = true;
    else if (flag === "--smtp-host") options.smtpHost = value().trim();
    else if (flag === "--smtp-port") options.smtpPort = value().trim();
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (options.send && options.smtpLocal) throw new Error("Use either --send or --smtp-local, not both");
  if (options.to !== undefined && !options.send) throw new Error("--to is only used with --send");
  if ((options.smtpHost !== undefined || options.smtpPort !== undefined) && !options.smtpLocal) throw new Error("--smtp-host and --smtp-port are only used with --smtp-local");
  if (options.smtpLocal) options.smtp = localSmtp(options.smtpHost, options.smtpPort);
  if (options.send) {
    if (!options.to) throw new Error("--send requires --to <test email address>");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.to)) throw new Error(`--to is not an email address: ${options.to}`);
    if (options.to.toLowerCase() === PRODUCTION_ADMIN) throw new Error(`Refusing to send test emails to the production admin inbox ${PRODUCTION_ADMIN}`);
  }
  options.scenario ??= options.send ? "indian" : "all";
  if (options.scenario !== "all" && !SCENARIOS[options.scenario]) throw new Error(`Unknown scenario "${options.scenario}" (use ${Object.keys(SCENARIOS).join(", ")} or all)`);
  options.scenarios = options.scenario === "all" ? Object.keys(SCENARIOS) : [options.scenario];
  return options;
}

// Only a local SMTP catcher is accepted, so a typo can never reach a real mail server.
function localSmtp(host = "localhost", port = 1025) {
  if (!LOCAL_SMTP_HOSTS.includes(String(host).toLowerCase())) throw new Error(`Refusing SMTP host "${host}": --smtp-local only delivers to ${LOCAL_SMTP_HOSTS.join(" or ")}`);
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`--smtp-port is not a valid port: ${port}`);
  return { host: String(host).toLowerCase(), port: number };
}

const refused = error => [error?.code, error?.message].some(value => /ECONNREFUSED/.test(String(value)));

// "localhost" may resolve to ::1 while the catcher listens on IPv4 only, so both
// loopback addresses are tried; nothing outside the machine is ever contacted.
async function openLocalSmtp(smtp) {
  const addresses = smtp.host === "localhost" ? ["127.0.0.1", "::1"] : [smtp.host];
  for (const address of addresses) {
    const transport = nodemailer.createTransport({ host: address, port: smtp.port, secure: false, ignoreTLS: true });
    try {
      await transport.verify();
      return transport;
    } catch (error) {
      transport.close();
      if (!refused(error)) throw new Error(`Local SMTP at ${smtp.host}:${smtp.port} failed: ${error.message}`);
    }
  }
  throw new Error(`No SMTP server at ${smtp.host}:${smtp.port} (connection refused). ${MAILPIT_HINT}`);
}

// Relays a captured Brevo payload unchanged apart from the fixed local recipient and prefix.
async function deliverLocal(transport, smtp, role, message) {
  const mail = {
    from: { name: message.sender.name, address: message.sender.email },
    to: LOCAL_RECIPIENTS[role],
    subject: `[LOCAL] ${message.subject}`,
    html: message.htmlContent,
    text: message.textContent,
    attachments: message.attachment.map(file => ({ filename: file.name, content: file.content, encoding: "base64", contentType: "application/pdf" })),
  };
  let info;
  try { info = await transport.sendMail(mail); }
  catch (error) { throw new Error(refused(error) ? `Local SMTP at ${smtp.host}:${smtp.port} refused the connection. ${MAILPIT_HINT}` : `Local SMTP delivery failed: ${error.message}`); }
  message.sentAs = { transport: `smtp://${smtp.host}:${smtp.port}`, to: [{ email: mail.to }], subject: mail.subject, accepted: info.accepted || [] };
}

// Replaces the Brevo SDK transport for the duration of a run. Dry run captures only;
// send mode forces the recipient and subject prefix before calling the real API.
function interceptBrevo({ send, to }) {
  const api = brevo.TransactionalEmailsApi.prototype;
  const account = brevo.AccountApi.prototype;
  const original = { sendTransacEmail: api.sendTransacEmail, getAccount: account.getAccount };
  const captured = [];
  api.sendTransacEmail = async function (message) {
    captured.push({ ...message, to: message.to.map(recipient => ({ ...recipient })), attachment: (message.attachment || []).map(file => ({ ...file })) });
    if (!send) return { messageId: `dry-run-${captured.length}` };
    const outgoing = Object.assign(new brevo.SendSmtpEmail(), message, { to: [{ email: to }], subject: `[TEST] ${message.subject}` });
    for (const key of ["cc", "bcc", "replyTo"]) delete outgoing[key];
    if (outgoing.to.length !== 1 || outgoing.to[0].email !== to) throw new Error("Test recipient override failed; not sent");
    captured[captured.length - 1].sentAs = { to: outgoing.to, subject: outgoing.subject };
    return original.sendTransacEmail.call(this, outgoing);
  };
  if (!send) account.getAccount = async () => ({});
  return { captured, restore: () => Object.assign(api, { sendTransacEmail: original.sendTransacEmail }) && Object.assign(account, { getAccount: original.getAccount }) };
}

async function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await run(); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

// Runs one job through the production queue. Sheets and cleanup are replaced so
// nothing leaves the machine except (in send mode) the Brevo emails.
async function runQueueJob({ formData, uploadedFiles, uploadRoot, uploadDir }) {
  const run = { pdfPaths: null, errors: [], sheetsSkipped: 0 };
  const queue = createQueue({
    generatePDF,
    sendAdminEmail: async args => {
      run.pdfPaths = { adminForm: args.adminFormPdfPath, adminDocuments: args.adminDocumentsPdfPath, student: args.studentPdfPath };
      try { await sendAdminEmail(args); } catch (error) { run.errors.push(error.message); throw error; }
      run.emailSent = true;
    },
    appendAdmissionRow: async () => { run.sheetsSkipped++; },
    cleanup: async () => {},
    retryDelay: () => 1000,
  });
  queue.addJob({ formData, uploadedFiles, uploadRoot, uploadDir });
  await new Promise(resolve => setImmediate(resolve));
  while (queue.getQueueStatus().queueLength) await new Promise(resolve => setTimeout(resolve, 50));
  if (!run.emailSent && !run.errors.length) run.errors.push("Queue job finished without sending email (PDF generation failed?)");
  return run;
}

const pdfInfo = async bytes => ({ pages: (await PDFDocument.load(bytes)).getPageCount(), text: extractText(bytes) });
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;

async function writeRecipient(directory, message) {
  await fs.mkdir(path.join(directory, "attachments"), { recursive: true });
  const attachments = [];
  for (const file of message.attachment) {
    const bytes = Buffer.from(file.content, "base64");
    await fs.writeFile(path.join(directory, "attachments", path.basename(file.name)), bytes);
    attachments.push({ name: file.name, bytes: bytes.length, info: await pdfInfo(bytes) });
  }
  const payload = {
    sender: message.sender, to: message.to, subject: message.subject,
    attachments: attachments.map(({ name, bytes }) => ({ name, bytes })),
    totalAttachmentBytes: attachments.reduce((sum, file) => sum + file.bytes, 0),
    ...(message.sentAs ? { sentAs: message.sentAs } : {}),
  };
  await fs.writeFile(path.join(directory, "payload.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(path.join(directory, "body.html"), message.htmlContent);
  await fs.writeFile(path.join(directory, "body.txt"), message.textContent);
  return { payload, attachments };
}

const rangesIn = text => [...text.matchAll(/In Documents PDF - pages? (\d+)(?:-(\d+))?/g)].map(match => [Number(match[1]), Number(match[2] || match[1])]);

function checkScenario(name, { form, admin, student, run }) {
  const checks = [];
  const check = (label, pass, detail = "") => checks.push({ scenario: name, label, pass: Boolean(pass), detail });
  const id = form.applicationId;
  check("queue job completed without errors", !run.errors.length, run.errors.join("; "));
  check("Google Sheets stage reached once and stubbed (no Sheets call)", run.sheetsSkipped === 1, `${run.sheetsSkipped} calls`);
  if (!admin || !student) {
    check("admin and student emails captured", false, `admin: ${Boolean(admin)}, student: ${Boolean(student)}`);
    return checks;
  }
  const formName = generatePDF.admissionPdfName(form.fullName, "admin", "form");
  const documentsName = generatePDF.admissionPdfName(form.fullName, "admin", "documents");
  const studentName = generatePDF.admissionPdfName(form.fullName, "student");
  const adminNames = admin.attachments.map(file => file.name);
  const documents = admin.attachments.find(file => file.name === documentsName);
  const adminForm = admin.attachments.find(file => file.name === formName);
  const bodies = [admin.message.htmlContent, admin.message.textContent];

  check("admin subject contains Application ID", admin.message.subject.includes(id), admin.message.subject);
  if (SCENARIOS[name].unreadable) {
    check("admin has only the Form PDF", JSON.stringify(adminNames) === JSON.stringify([formName]), adminNames.join(", "));
    check("admin HTML and text say supporting documents are not attached", bodies.every(body => /supporting documents are not attached/i.test(body)));
    check("admin Form PDF lists no Documents PDF page ranges", adminForm && !rangesIn(adminForm.info.text).length);
  } else {
    check("admin has exactly Form then Documents PDF", JSON.stringify(adminNames) === JSON.stringify([formName, documentsName]), adminNames.join(", "));
    check("admin HTML and text have the Attachments line", bodies.every(body => body.includes(`Attachments: ${formName}, ${documentsName}`)));
    if (adminForm && documents) {
      const ranges = rangesIn(adminForm.info.text);
      let expectedStart = generatePDF.DOCUMENTS_COVER_PAGES + 1;
      const contiguous = ranges.length > 0 && ranges.every(([start, end]) => { const ok = start === expectedStart && end >= start; expectedStart = end + 1; return ok; });
      check("Form PDF page ranges match the Documents PDF page count", contiguous && expectedStart - 1 === documents.info.pages, `ranges ${JSON.stringify(ranges)}, Documents PDF ${documents.info.pages} pages`);
      check("Documents PDF cover lists the same ranges", JSON.stringify(rangesIn(documents.info.text)) === JSON.stringify(ranges));
    }
  }

  const studentNames = student.attachments.map(file => file.name);
  check("student has exactly the Student Copy PDF", JSON.stringify(studentNames) === JSON.stringify([studentName]), studentNames.join(", "));
  check("student subject is unchanged", student.message.subject === STUDENT_SUBJECT, student.message.subject);
  const studentContent = [student.message.subject, student.message.htmlContent, student.message.textContent, ...student.attachments.map(file => file.info.text)].join("\n");
  const leaked = [id, ...STUDENT_FORBIDDEN].filter(value => studentContent.toLowerCase().includes(value.toLowerCase()));
  check("student email and PDF have no internal data", !leaked.length, leaked.join(", "));
  const copy = student.attachments[0];
  if (copy) {
    const footers = [...copy.info.text.matchAll(/Page (\d+) of (\d+)/g)];
    const formPages = footers.length;
    const declaredTotal = Number(footers[0]?.[2]);
    check("Student Copy footer total matches its page count", declaredTotal === copy.info.pages, `${declaredTotal} vs ${copy.info.pages}`);
    if (documents) {
      check("Student Copy has the documents appended after the form", copy.info.pages > formPages && copy.info.pages - formPages === documents.info.pages - generatePDF.DOCUMENTS_COVER_PAGES, `${copy.info.pages} pages, ${formPages} form pages`);
    } else {
      check("Student Copy has only form pages when nothing is appendable", copy.info.pages === formPages, `${copy.info.pages} pages, ${formPages} form pages`);
    }
  }
  return checks;
}

async function runScenario(name, { send, to, local, outputRoot }) {
  const scenarioDir = path.join(outputRoot, name);
  const jobDir = path.join(scenarioDir, "job");
  await fs.rm(scenarioDir, { recursive: true, force: true });
  await fs.mkdir(jobDir, { recursive: true });
  const { body, applicationId, unreadable } = SCENARIOS[name];
  const { form, files } = await admissionFromBody(body, applicationId, jobDir);
  if (unreadable) for (const file of files.filter(upload => upload.mimetype === "application/pdf")) await fs.writeFile(file.path, "not a pdf");
  if (send) form.email = to;
  if (local) form.email = LOCAL_RECIPIENTS.student;

  const transport = interceptBrevo({ send, to });
  let run;
  try {
    run = await runQueueJob({ formData: form, uploadedFiles: files, uploadRoot: scenarioDir, uploadDir: jobDir });
  } finally { transport.restore(); }

  const roleOf = message => message.attachment.some(file => file.name.includes("_Admin_")) ? "admin" : "student";
  // Admin first, so local delivery order is stable.
  const captured = [...transport.captured].sort((a, b) => roleOf(a).localeCompare(roleOf(b)));
  const recipients = {};
  for (const message of captured) {
    const role = roleOf(message);
    if (local) await deliverLocal(local.transport, local.smtp, role, message);
    recipients[role] = { message, ...(await writeRecipient(path.join(scenarioDir, role), message)) };
  }
  const checks = checkScenario(name, { form, admin: recipients.admin, student: recipients.student, run });
  if (local) {
    for (const role of ["admin", "student"]) {
      const accepted = recipients[role]?.message.sentAs?.accepted || [];
      checks.push({ scenario: name, label: `local SMTP accepted the ${role} email for ${LOCAL_RECIPIENTS[role]}`, pass: accepted.includes(LOCAL_RECIPIENTS[role]), detail: accepted.join(", ") || "not delivered" });
    }
  }
  return { name, form, recipients, checks };
}

async function runPreview({ send = false, to, smtp, scenarios = Object.keys(SCENARIOS), outputRoot = OUTPUT_ROOT, log = console.log } = {}) {
  if (send && smtp) throw new Error("Use either send mode or local SMTP mode, not both");
  if (send && (!to || to.toLowerCase() === PRODUCTION_ADMIN)) throw new Error("Send mode requires a non-production --to address");
  // Dry run and local SMTP use placeholder Brevo settings, so no API key is needed.
  const env = send ? { ADMIN_EMAIL: to } : smtp ? { ...DRY_RUN_ENV, ADMIN_EMAIL: LOCAL_RECIPIENTS.admin } : DRY_RUN_ENV;
  const local = smtp ? { smtp: localSmtp(smtp.host, smtp.port) } : null;
  if (local) local.transport = await openLocalSmtp(local.smtp);
  const mode = send ? `sent to ${to}` : local ? `delivered to smtp://${local.smtp.host}:${local.smtp.port}` : "dry run";
  const results = [];
  try {
    await withEnv(env, () => runScenarios({ scenarios, send, to, local, outputRoot, mode, results, log }));
  } finally { local?.transport.close(); }
  if (local) log("\nView the messages in Mailpit: http://localhost:8025");
  const failed = results.flatMap(result => result.checks).filter(item => !item.pass);
  log(`\n${failed.length ? `${failed.length} check(s) FAILED` : "All checks PASSED"}`);
  return { results, failed };
}

async function runScenarios({ scenarios, send, to, local, outputRoot, mode, results, log }) {
  for (const name of scenarios) {
    const result = await runScenario(name, { send, to, local, outputRoot });
    results.push(result);
    log(`\n=== ${name} (${result.form.applicationId}) ${mode} -> ${path.relative(process.cwd(), path.join(outputRoot, name))}`);
    console.table(Object.entries(result.recipients).map(([role, { payload }]) => ({
      role, recipient: (payload.sentAs?.to || payload.to).map(item => item.email).join(", "), subject: payload.sentAs?.subject || payload.subject,
      attachments: payload.attachments.map(file => file.name).join("\n"), sizes: payload.attachments.map(file => kb(file.bytes)).join(", "), total: kb(payload.totalAttachmentBytes),
    })));
    for (const { label, pass, detail } of result.checks) log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` (${detail})` : ""}`);
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.send) {
    require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
    if (!process.env.BREVO_API_KEY || !process.env.MAIL_FROM) throw new Error("--send requires BREVO_API_KEY and MAIL_FROM in Backend/.env");
  }
  const { failed } = await runPreview({ send: options.send, to: options.to, smtp: options.smtp, scenarios: options.scenarios });
  if (failed.length) process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { SCENARIOS, parseArgs, runPreview };
