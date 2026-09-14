const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { purgeStaleUploadDirectories, validateFileMetadata } = require("../services/uploadService");

test("stale request directories are purged without touching recent directories or loose files", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-purge-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  for (const name of ["admission-old", "admission-recent", "unrelated-old"]) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, "file.pdf"), "x");
  }
  await fs.writeFile(path.join(root, "admission-1769068536574.pdf"), "legacy");
  for (const name of ["admission-old", "unrelated-old", "admission-1769068536574.pdf"]) await fs.utimes(path.join(root, name), old, old);
  assert.equal(await purgeStaleUploadDirectories(root), 1);
  assert.deepEqual((await fs.readdir(root)).sort(), ["admission-1769068536574.pdf", "admission-recent", "unrelated-old"]);
  assert.equal(await purgeStaleUploadDirectories(path.join(root, "missing")), 0);
});

test("upload metadata requires matching MIME type and extension per field", () => {
  const ok = [["photo", "image/jpeg", "Photo.JPG"], ["signature", "image/jpg", "sign.jpeg"], ["marksheet10", "application/pdf", "m10.PDF"]];
  for (const [fieldname, mimetype, originalname] of ok) assert.doesNotThrow(() => validateFileMetadata({ fieldname, mimetype, originalname }));
  const bad = [["photo", "image/png", "photo.png"], ["photo", "image/jpeg", "photo.pdf"], ["marksheet10", "image/jpeg", "m10.jpg"], ["passport", "application/pdf", "passport.pdf.exe"], ["paymentReceipt", "application/pdf", "receipt.pdf"]];
  for (const [fieldname, mimetype, originalname] of bad) assert.throws(() => validateFileMetadata({ fieldname, mimetype, originalname }), error => error.status === 400, `${fieldname} ${originalname}`);
});
