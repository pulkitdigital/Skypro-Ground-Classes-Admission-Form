const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const { createApp } = require("../server");
const { validBody, filesFor } = require("./fixtures");

test("multipart API validates contents, rejects bad submissions, and cleans all rejected uploads", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-api-test-"));
  // Images match the upload rules; the parent signature is a PNG to cover both formats.
  const image = (width, height) => sharp({ create: { width, height, channels: 3, background: "white" } });
  const jpeg = await image(300, 150).jpeg().toBuffer();
  const uploads = {
    photo: { bytes: await image(413, 531).jpeg().toBuffer(), type: "image/jpeg", name: "photo.jpg" },
    signature: { bytes: jpeg, type: "image/jpeg", name: "signature.jpg" },
    parentSignature: { bytes: await image(300, 150).png().toBuffer(), type: "image/png", name: "parent.PNG" },
  };
  const pdfDoc = await PDFDocument.create(); pdfDoc.addPage();
  const pdf = await pdfDoc.save();
  const jobs = [];
  let captcha = { success: true };
  let queueFailure = false;
  let allocationFailure = false;
  let allocations = 0;
  let verifyCalls = 0;
  const server = createApp({ uploadRoot: root, allocateApplicationId: async () => { allocations++; if (allocationFailure) throw new Error("Allocator unavailable"); return "SKY-GS-2026-09-0001"; }, verifyRecaptcha: async () => { verifyCalls++; if (captcha instanceof Error) throw captcha; return captcha; }, queue: { addJob: job => { if (queueFailure) throw new Error("Queue unavailable"); jobs.push(job); return "test-job"; }, getQueueStatus: () => ({}) } }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const post = async (body = validBody(), alter = () => {}) => {
    const form = new FormData();
    Object.entries(body).forEach(([key, value]) => form.append(key, value));
    filesFor(body).forEach(({ fieldname }) => {
      const upload = uploads[fieldname] || { bytes: pdf, type: "application/pdf", name: "document.pdf" };
      form.append(fieldname, new Blob([upload.bytes], { type: upload.type }), upload.name);
    });
    await alter(form);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/submit`, { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  };
  const rejected = async (body, alter, expected = 400) => {
    const response = await post(body, alter);
    assert.equal(response.status, expected, JSON.stringify(response.body));
    assert.ok(response.body.error);
    assert.deepEqual(await fs.readdir(root), []);
    return response.body;
  };
  await rejected(validBody({ fullName: "" }));
  assert.equal(verifyCalls, 0);
  await rejected(validBody(), form => form.delete("signature"));
  await rejected(validBody(), form => form.append("paymentReceipt", new Blob([pdf], { type: "application/pdf" }), "old.pdf"));
  await rejected(validBody(), form => form.set("signature", new Blob([jpeg], { type: "image/png" }), "signature.png"));
  await rejected(validBody(), form => form.set("signature", new Blob([jpeg], { type: "image/jpeg" }), "signature.pdf"));
  await rejected(validBody(), form => form.set("signature", new Blob(["fake"], { type: "image/jpeg" }), "signature.jpg"));
  await rejected(validBody(), form => form.set("marksheet10", new Blob(["%PDF-fake"], { type: "application/pdf" }), "document.pdf"));
  await rejected(validBody(), form => form.set("signature", new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/jpeg" }), "signature.jpg"));
  const wrongSize = await rejected(validBody(), async form => form.set("photo", new Blob([await image(600, 800).png().toBuffer()], { type: "image/png" }), "photo.png"));
  assert.deepEqual(wrongSize.fields, { photo: "Photo must be exactly 413 × 531 px. Your image is 600 × 800 px. Please resize it using Reduce Images." });
  assert.equal(verifyCalls, 0, "image rules are enforced before reCAPTCHA verification");
  await rejected(validBody(), form => form.append("fullName", "Duplicate"));
  await rejected(validBody({ recaptchaToken: "" }));
  for (const result of [{ success: false }, { success: true, score: 0 }, new Error("Verification unavailable")]) { captcha = result; await rejected(validBody()); }
  assert.equal(allocations, 0, "validation and reCAPTCHA failures cannot allocate IDs");
  captcha = { success: true };
  await rejected(validBody({ applicationId: "SKY-GS-2026-09-9999" }));
  allocationFailure = true;
  await rejected(validBody(), undefined, 503);
  allocationFailure = false; queueFailure = true;
  await rejected(validBody(), undefined, 500);
  queueFailure = false;
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].formData.applicationId, "SKY-GS-2026-09-0001");
  assert.equal(JSON.stringify(response.body).includes("SKY-GS"), false);
  assert.ok(jobs[0].files.signature.path);
  assert.equal(jobs[0].formData.emergencyContact.name, "Test Mother");
  assert.equal(jobs[0].formData.recaptchaToken, undefined);
  assert.equal((await fs.readdir(root)).length, 1, "accepted job retains files for processing");
});
