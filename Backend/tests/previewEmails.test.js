const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { spawnSync } = require("node:child_process");
const brevo = require("@getbrevo/brevo");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const applicationIdService = require("../services/applicationIdService");
const admissionSheet = require("../services/admissionSheet");
const { parseArgs, runPreview } = require("../scripts/previewEmails");

const SCRIPT = path.join(__dirname, "../scripts/previewEmails.js");
const GOOGLE_SERVICE = require.resolve("../services/googleService");

// Any Google, ledger, Sheets or network access during a preview run throws and is counted.
function forbidExternalAccess(t) {
  const calls = [];
  const forbidden = name => (...args) => { calls.push(name); throw new Error(`preview must not call ${name}`); };
  t.mock.method(google, "sheets", forbidden("google.sheets"));
  t.mock.method(google.auth, "GoogleAuth", forbidden("google.auth.GoogleAuth"));
  t.mock.method(applicationIdService, "allocateApplicationId", forbidden("allocateApplicationId"));
  t.mock.method(applicationIdService, "defaultService", forbidden("applicationIdService.defaultService"));
  t.mock.method(admissionSheet, "appendAdmissionRow", forbidden("appendAdmissionRow"));
  t.mock.method(globalThis, "fetch", forbidden("fetch (/api/submit)"));
  t.mock.method(http, "request", forbidden("http.request"));
  t.mock.method(https, "request", forbidden("https.request"));
  t.mock.method(net, "connect", forbidden("net.connect"));
  t.mock.method(net, "createConnection", forbidden("net.createConnection"));
  t.mock.method(tls, "connect", forbidden("tls.connect"));
  const cached = require.cache[GOOGLE_SERVICE];
  require.cache[GOOGLE_SERVICE] = { id: GOOGLE_SERVICE, filename: GOOGLE_SERVICE, loaded: true, exports: new Proxy({}, { get: (_, key) => forbidden(`googleService.${String(key)}`)() }) };
  t.after(() => { if (cached) require.cache[GOOGLE_SERVICE] = cached; else delete require.cache[GOOGLE_SERVICE]; });
  return calls;
}

async function outputRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-email-preview-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function quiet(t) {
  for (const method of ["log", "table", "error"]) t.mock.method(console, method, () => {});
}

test("dry run captures every scenario through the real queue without Google, ledger, API or network calls", async t => {
  const calls = forbidExternalAccess(t);
  const root = await outputRoot(t);
  quiet(t);
  const originalSend = brevo.TransactionalEmailsApi.prototype.sendTransacEmail;
  const originalAccount = brevo.AccountApi.prototype.getAccount;
  const adminEmail = process.env.ADMIN_EMAIL;

  const { results, failed } = await runPreview({ outputRoot: root, log: () => {} });

  assert.deepEqual(failed, []);
  assert.deepEqual(calls, []);
  assert.ok(results.every(result => result.checks.some(check => check.label.startsWith("fixture uploads pass server upload validation") && check.pass)));
  assert.deepEqual(results.map(result => [result.name, result.form.applicationId]), [["indian", "SKY-GS-TEST-0001"], ["foreign", "SKY-GS-TEST-0002"], ["unreadable", "SKY-GS-TEST-0003"]]);
  assert.equal(brevo.TransactionalEmailsApi.prototype.sendTransacEmail, originalSend, "Brevo transport restored");
  assert.equal(brevo.AccountApi.prototype.getAccount, originalAccount, "Brevo verification restored");
  assert.equal(process.env.ADMIN_EMAIL, adminEmail, "environment restored");

  for (const [scenario, adminFiles] of [["indian", 2], ["foreign", 2], ["unreadable", 1]]) {
    for (const [role, count] of [["admin", adminFiles], ["student", 1]]) {
      const directory = path.join(root, scenario, role);
      const payload = JSON.parse(await fs.readFile(path.join(directory, "payload.json"), "utf8"));
      assert.equal(JSON.stringify(payload).includes("content"), false, "base64 content is not stored in payload.json");
      assert.equal(payload.attachments.length, count);
      assert.equal(payload.totalAttachmentBytes, payload.attachments.reduce((sum, file) => sum + file.bytes, 0));
      assert.deepEqual((await fs.readdir(path.join(directory, "attachments"))).sort(), payload.attachments.map(file => file.name).sort());
      for (const file of payload.attachments) assert.equal((await fs.stat(path.join(directory, "attachments", file.name))).size, file.bytes);
      assert.ok((await fs.readFile(path.join(directory, "body.html"), "utf8")).length);
      assert.ok((await fs.readFile(path.join(directory, "body.txt"), "utf8")).length);
    }
    const job = await fs.readdir(path.join(root, scenario, "job"));
    assert.ok(job.some(name => name.endsWith("_Admin_Form.pdf")) && job.some(name => name.endsWith("_Student_Copy.pdf")), "PDFs are generated in the job directory");
    const imageExtension = scenario === "foreign" ? ".png" : ".jpg";
    assert.deepEqual(["photo", "signature", "parentSignature"].map(field => job.includes(field + imageExtension)), [true, true, true], `${scenario} uploads ${imageExtension} images`);
  }
});

test("send mode delivers only to --to with a [TEST] prefix and never to ADMIN_EMAIL or the applicant", async t => {
  const calls = forbidExternalAccess(t);
  const root = await outputRoot(t);
  quiet(t);
  const keys = ["BREVO_API_KEY", "MAIL_FROM", "ADMIN_EMAIL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BREVO_API_KEY: "mock", MAIL_FROM: "sender@example.com", ADMIN_EMAIL: "info@skyproaviation.org" });
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const sent = [];
  // Stands in for the real Brevo API underneath the script's recipient override.
  t.mock.method(brevo.TransactionalEmailsApi.prototype, "sendTransacEmail", async message => { sent.push(message); return { messageId: "mock" }; });
  t.mock.method(brevo.AccountApi.prototype, "getAccount", async () => ({}));

  const { results, failed } = await runPreview({ send: true, to: "qa-inbox@example.com", scenarios: parseArgs(["--send", "--to", "qa-inbox@example.com"]).scenarios, outputRoot: root, log: () => {} });

  assert.deepEqual(failed, []);
  assert.deepEqual(calls, []);
  assert.deepEqual(results.map(result => result.name), ["indian"], "only one scenario is sent by default");
  assert.equal(sent.length, 2);
  for (const message of sent) {
    assert.deepEqual(message.to, [{ email: "qa-inbox@example.com" }]);
    assert.ok(message.subject.startsWith("[TEST] "));
    assert.equal(message.cc ?? message.bcc, undefined);
    assert.equal(JSON.stringify(message).includes("info@skyproaviation.org"), false, "production admin address is not used");
    assert.equal(JSON.stringify(message).includes("student@example.com"), false, "applicant address is not used");
  }
  assert.deepEqual(sent.map(message => message.attachment.length).sort(), [1, 2]);
  const payload = JSON.parse(await fs.readFile(path.join(root, "indian", "student", "payload.json"), "utf8"));
  assert.equal(payload.sentAs.subject, "[TEST] Admission Application Received – SkyPro Aviation");
  assert.equal(process.env.ADMIN_EMAIL, "info@skyproaviation.org", "environment restored");
  await assert.rejects(runPreview({ send: true, to: "INFO@skyproaviation.org", outputRoot: root }), /non-production/);
});

// A nodemailer transport stand-in: records each connection and message, opens no sockets.
function mockSmtp(t, { refuse = false } = {}) {
  const transports = [];
  const mails = [];
  t.mock.method(nodemailer, "createTransport", options => {
    transports.push(options);
    return {
      verify: async () => { if (refuse) throw Object.assign(new Error(`connect ECONNREFUSED ${options.host}:${options.port}`), { code: "ESOCKET" }); return true; },
      sendMail: async mail => { mails.push(mail); return { accepted: [mail.to], messageId: `<mock-${mails.length}@preview.local>` }; },
      close: () => {},
    };
  });
  return { transports, mails };
}

test("--smtp-local relays each captured payload to local recipients without a Brevo key, Brevo, Google or network calls", async t => {
  const calls = forbidExternalAccess(t);
  const root = await outputRoot(t);
  quiet(t);
  const keys = ["BREVO_API_KEY", "MAIL_FROM", "ADMIN_EMAIL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  delete process.env.BREVO_API_KEY;
  process.env.ADMIN_EMAIL = "info@skyproaviation.org";
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  const brevoSend = t.mock.method(brevo.TransactionalEmailsApi.prototype, "sendTransacEmail", async () => { throw new Error("Brevo must not be called"); });
  const brevoAccount = t.mock.method(brevo.AccountApi.prototype, "getAccount", async () => { throw new Error("Brevo must not be called"); });
  const { transports, mails } = mockSmtp(t);

  const options = parseArgs(["--smtp-local"]);
  const { results, failed } = await runPreview({ smtp: options.smtp, scenarios: options.scenarios, outputRoot: root, log: () => {} });

  assert.deepEqual(failed, []);
  assert.deepEqual(calls, []);
  assert.equal(brevoSend.mock.callCount(), 0);
  assert.equal(brevoAccount.mock.callCount(), 0);
  assert.equal(process.env.BREVO_API_KEY, undefined, "no Brevo key was needed or left behind");
  assert.deepEqual(transports.map(({ host, port }) => [host, port]), [["127.0.0.1", 1025]]);
  assert.equal(mails.length, results.length * 2, "two emails per scenario");

  results.forEach((result, index) => {
    const safeName = result.form.fullName.replace(/ /g, "_");
    const expected = {
      admin: result.name === "unreadable" ? [`SkyPro_GroundSchool_${safeName}_Admin_Form.pdf`] : [`SkyPro_GroundSchool_${safeName}_Admin_Form.pdf`, `SkyPro_GroundSchool_${safeName}_Admin_Documents.pdf`],
      student: [`SkyPro_GroundSchool_${safeName}_Student_Copy.pdf`],
    };
    [["admin", "admin@preview.local"], ["student", "student@preview.local"]].forEach(([role, recipient], offset) => {
      const mail = mails[index * 2 + offset];
      const { message } = result.recipients[role];
      assert.equal(mail.to, recipient, `${result.name} ${role} recipient`);
      assert.equal(mail.subject, `[LOCAL] ${message.subject}`);
      assert.deepEqual(mail.from, { name: message.sender.name, address: message.sender.email });
      assert.equal(mail.html, message.htmlContent);
      assert.equal(mail.text, message.textContent);
      assert.deepEqual(mail.attachments.map(file => file.filename), expected[role], `${result.name} ${role} attachments`);
      mail.attachments.forEach((file, fileIndex) => {
        assert.equal(file.contentType, "application/pdf");
        assert.equal(file.encoding, "base64");
        assert.equal(file.content, message.attachment[fileIndex].content, "attachment bytes unchanged");
      });
      const serialized = JSON.stringify(mail);
      for (const address of ["info@skyproaviation.org", "student@example.com", "mei.tan@example.com"]) assert.equal(serialized.includes(address), false, `${address} is never used`);
    });
  });
  const payload = JSON.parse(await fs.readFile(path.join(root, "foreign", "admin", "payload.json"), "utf8"));
  assert.deepEqual(payload.sentAs, { transport: "smtp://localhost:1025", to: [{ email: "admin@preview.local" }], subject: `[LOCAL] ${payload.subject}`, accepted: ["admin@preview.local"] });
  assert.deepEqual((await fs.readdir(path.join(root, "foreign", "admin", "attachments"))).sort(), payload.attachments.map(file => file.name).sort());
});

test("--smtp-local stops with a Mailpit hint when nothing listens and refuses non-local hosts", async t => {
  quiet(t);
  const root = await outputRoot(t);
  const { transports, mails } = mockSmtp(t, { refuse: true });
  await assert.rejects(runPreview({ smtp: { host: "localhost", port: 1025 }, outputRoot: root, log: () => {} }), /connection refused\)\. Mailpit start karo: http:\/\/localhost:8025/);
  assert.deepEqual(transports.map(({ host }) => host), ["127.0.0.1", "::1"], "only loopback addresses are tried");
  assert.equal(mails.length, 0);
  assert.deepEqual(await fs.readdir(root), [], "nothing is generated before the SMTP server is reachable");
  await assert.rejects(runPreview({ smtp: { host: "smtp.example.com", port: 25 }, outputRoot: root }), /Refusing SMTP host/);
  assert.equal(transports.length, 2, "a non-local host is never contacted");
});

test("arguments default safely and refuse unsafe send targets", () => {
  assert.deepEqual(parseArgs(["--smtp-local"]).smtp, { host: "localhost", port: 1025 });
  assert.deepEqual(parseArgs(["--smtp-local"]).scenarios, ["indian", "foreign", "unreadable"]);
  const custom = parseArgs(["--smtp-local", "--smtp-host", "127.0.0.1", "--smtp-port=2525", "--scenario", "foreign"]);
  assert.deepEqual([custom.smtp, custom.scenarios], [{ host: "127.0.0.1", port: 2525 }, ["foreign"]]);
  for (const host of ["smtp.gmail.com", "0.0.0.0", "smtp-relay.brevo.com"]) assert.throws(() => parseArgs(["--smtp-local", "--smtp-host", host]), /Refusing SMTP host/);
  assert.throws(() => parseArgs(["--smtp-local", "--smtp-port", "abc"]), /not a valid port/);
  assert.throws(() => parseArgs(["--smtp-host", "localhost"]), /only used with --smtp-local/);
  assert.throws(() => parseArgs(["--send", "--to", "qa@example.com", "--smtp-local"]), /either --send or --smtp-local/);
  assert.deepEqual(parseArgs([]).scenarios, ["indian", "foreign", "unreadable"]);
  assert.deepEqual(parseArgs(["--send", "--to=qa@example.com"]).scenarios, ["indian"]);
  assert.deepEqual(parseArgs(["--send", "--to", "qa@example.com", "--scenario", "all"]).scenarios, ["indian", "foreign", "unreadable"]);
  assert.deepEqual(parseArgs(["--scenario", "unreadable"]).scenarios, ["unreadable"]);
  assert.throws(() => parseArgs(["--send"]), /requires --to/);
  assert.throws(() => parseArgs(["--send", "--to", "Info@SkyproAviation.org"]), /production admin inbox/);
  assert.throws(() => parseArgs(["--send", "--to", "not-an-email"]), /not an email/);
  assert.throws(() => parseArgs(["--to", "qa@example.com"]), /only used with --send/);
  assert.throws(() => parseArgs(["--scenario", "nope"]), /Unknown scenario/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
});

test("the CLI exits with code 1 before doing anything for an unsafe --send or --smtp-local target", () => {
  for (const args of [["--send"], ["--send", "--to", "info@skyproaviation.org"], ["--smtp-local", "--smtp-host", "smtp.gmail.com"]]) {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, BREVO_API_KEY: "", MAIL_FROM: "" } });
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /--to|production admin inbox|Refusing SMTP host/);
    assert.equal(result.stdout.includes("==="), false, "no scenario ran");
  }
});
