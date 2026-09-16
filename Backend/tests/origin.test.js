const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const { createApp } = require("../server");
const { validBody, filesFor } = require("./fixtures");

const HOST = "groundschool.skyproaviation.org";
const ORIGIN = `https://${HOST}`;

// node:http lets tests send the browser Origin header explicitly.
function request(port, { method = "GET", pathname, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("ALLOWED_ORIGINS and reCAPTCHA hostnames restrict the new Ground School host", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-origin-test-"));
  // Sized to the upload rules: photo 413 × 531 px, signatures 300 × 150 px.
  const jpegOf = (width, height) => sharp({ create: { width, height, channels: 3, background: "white" } }).jpeg().toBuffer();
  const jpegs = { photo: await jpegOf(413, 531), signature: await jpegOf(300, 150), parentSignature: await jpegOf(300, 150) };
  const pdfDoc = await PDFDocument.create(); pdfDoc.addPage();
  const pdf = await pdfDoc.save();
  const jobs = [];
  let captcha = { success: true, hostname: HOST };
  const server = createApp({
    uploadRoot: root, allowedOrigins: [`${ORIGIN}/`], recaptchaHostnames: [HOST],
    allocateApplicationId: async () => "SKY-GS-2026-09-0001", verifyRecaptcha: async () => captcha,
    queue: { addJob: job => { jobs.push(job); return "test-job"; }, getQueueStatus: () => ({}) },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const { port } = server.address();

  const submit = async origin => {
    const form = new FormData();
    const body = validBody();
    Object.entries(body).forEach(([key, value]) => form.append(key, value));
    filesFor(body).forEach(({ fieldname }) => {
      const image = jpegs[fieldname];
      form.append(fieldname, new Blob([image || pdf], { type: image ? "image/jpeg" : "application/pdf" }), image ? "image.jpg" : "document.pdf");
    });
    const encoded = new Request("http://local/", { method: "POST", body: form });
    return request(port, { method: "POST", pathname: "/api/submit", headers: { Origin: origin, "Content-Type": encoded.headers.get("content-type") }, body: Buffer.from(await encoded.arrayBuffer()) });
  };

  const allowed = await request(port, { pathname: "/health", headers: { Origin: ORIGIN } });
  assert.equal(allowed.headers["access-control-allow-origin"], ORIGIN);
  assert.deepEqual({ cors: JSON.parse(allowed.body).corsRestricted, hostname: JSON.parse(allowed.body).recaptchaHostnameCheck }, { cors: true, hostname: true });
  const oldHost = await request(port, { pathname: "/health", headers: { Origin: "https://admissions.skyproaviation.org" } });
  assert.equal(oldHost.headers["access-control-allow-origin"], undefined);
  const preflight = await request(port, { method: "OPTIONS", pathname: "/api/submit", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
  assert.equal(preflight.headers["access-control-allow-origin"], ORIGIN);

  const foreign = await submit("https://evil.example");
  assert.equal(foreign.status, 403);
  assert.match(JSON.parse(foreign.body).error, /SkyPro Ground School website/);
  assert.deepEqual(await fs.readdir(root), [], "rejected before any upload is stored");

  captcha = { success: true, hostname: "evil.example" };
  const wrongHostname = await submit(ORIGIN);
  assert.equal(wrongHostname.status, 400);
  assert.deepEqual(await fs.readdir(root), []);

  captcha = { success: true, hostname: HOST.toUpperCase() };
  const accepted = await submit(ORIGIN);
  assert.equal(accepted.status, 200, accepted.body);
  assert.equal(accepted.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(jobs.length, 1);
});
