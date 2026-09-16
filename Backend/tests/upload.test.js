const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { purgeStaleUploadDirectories, validateFileContents, validateFileMetadata } = require("../services/uploadService");
const { IMAGE_RULES, checkImageDimensions } = require("../services/imageRules");
const { SCENARIOS, sampleAdmission } = require("./pdfFixtures");

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
  const ok = [["photo", "image/jpeg", "Photo.JPG"], ["signature", "image/jpg", "sign.jpeg"], ["photo", "image/png", "photo.png"], ["parentSignature", "image/png", "Parent.PNG"], ["marksheet10", "application/pdf", "m10.PDF"]];
  for (const [fieldname, mimetype, originalname] of ok) assert.doesNotThrow(() => validateFileMetadata({ fieldname, mimetype, originalname }), `${fieldname} ${originalname}`);
  const bad = [
    ["photo", "image/jpeg", "photo.pdf"], ["photo", "image/png", "photo.jpg"], ["signature", "image/jpeg", "signature.png"],
    ["photo", "image/gif", "photo.gif"], ["signature", "image/webp", "signature.webp"], ["photo", "image/png", "photo.png.exe"], ["photo", "constructor", "photo.constructor"],
    ["marksheet10", "image/jpeg", "m10.jpg"], ["marksheet10", "image/png", "m10.png"], ["passport", "application/pdf", "passport.pdf.exe"], ["paymentReceipt", "application/pdf", "receipt.pdf"],
  ];
  for (const [fieldname, mimetype, originalname] of bad) assert.throws(() => validateFileMetadata({ fieldname, mimetype, originalname }), error => error.status === 400, `${fieldname} ${originalname}`);
});

test("dimension check is exact by default and tolerance comes only from the rule", () => {
  assert.deepEqual(IMAGE_RULES, {
    photo: { dimensionLabel: "Photo", width: 413, height: 531, tolerancePx: 0 },
    signature: { dimensionLabel: "Signature", width: 300, height: 150, tolerancePx: 0 },
    parentSignature: { dimensionLabel: "Parent's signature", width: 300, height: 150, tolerancePx: 0 },
  });
  assert.deepEqual(checkImageDimensions(413, 531, IMAGE_RULES.photo), { ok: true, message: "" });
  for (const [width, height] of [[412, 531], [414, 531], [413, 530], [413, 532], [531, 413]]) assert.equal(checkImageDimensions(width, height, IMAGE_RULES.photo).ok, false, `${width}x${height}`);
  const tolerant = { ...IMAGE_RULES.photo, tolerancePx: 2 };
  assert.equal(checkImageDimensions(415, 529, tolerant).ok, true);
  assert.equal(checkImageDimensions(416, 531, tolerant).message, "Photo must be 413 × 531 px (±2 px). Your image is 416 × 531 px. Please resize it using Reduce Images.");
});

test("every sample PDF fixture (JPEG and PNG) passes server upload validation", async t => {
  for (const [name, { imageFormat }] of Object.entries(SCENARIOS)) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-fixture-test-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const { files } = await sampleAdmission(name, directory);
    await validateFileContents(files);
    const images = files.filter(file => IMAGE_RULES[file.fieldname]).map(file => file.mimetype);
    assert.deepEqual(images, Array(3).fill(imageFormat === "png" ? "image/png" : "image/jpeg"), name);
  }
});

// Writes an image upload into its own directory and validates it like the server does.
async function validateImage(t, { fieldname, bytes, originalname, mimetype }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-image-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = { fieldname, originalname, mimetype, path: path.join(directory, `upload${path.extname(originalname).toLowerCase()}`) };
  await fs.writeFile(file.path, bytes);
  await validateFileContents([file]);
  return file;
}
const canvas = (width, height, channels = 3) => sharp({ create: { width, height, channels, background: channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0 } : "white" } });
const rejectsWith = (promise, fieldname, pattern) => assert.rejects(promise, error => error.status === 400 && pattern.test(error.fields?.[fieldname] || "") ? true : assert.fail(`${fieldname}: ${JSON.stringify(error.fields)} ${error.message}`));

test("valid JPEG and PNG images of the exact size pass content validation", async t => {
  const cases = [
    { fieldname: "photo", bytes: await canvas(413, 531).jpeg().toBuffer(), originalname: "photo.jpg", mimetype: "image/jpeg", expected: "image/jpeg" },
    { fieldname: "photo", bytes: await canvas(413, 531).png().toBuffer(), originalname: "photo.PNG", mimetype: "image/png", expected: "image/png" },
    { fieldname: "signature", bytes: await canvas(300, 150, 4).png().toBuffer(), originalname: "signature.png", mimetype: "image/png", expected: "image/png" },
    { fieldname: "parentSignature", bytes: await canvas(300, 150).jpeg().toBuffer(), originalname: "parent.jpeg", mimetype: "image/jpg", expected: "image/jpeg" },
    // Stored 531 × 413 with EXIF orientation 6 is displayed as 413 × 531.
    { fieldname: "photo", bytes: await canvas(531, 413).jpeg().withMetadata({ orientation: 6 }).toBuffer(), originalname: "rotated.jpg", mimetype: "image/jpeg", expected: "image/jpeg" },
  ];
  for (const { expected, ...upload } of cases) {
    const file = await validateImage(t, upload);
    assert.equal(file.mimetype, expected, upload.originalname);
  }
});

test("wrong, swapped or EXIF-rotated sizes, fake PNGs and format mismatches are rejected with field errors", async t => {
  const photoError = size => new RegExp(`^Photo must be exactly 413 × 531 px\\. Your image is ${size} px\\. Please resize it using Reduce Images\\.$`);
  for (const [width, height] of [[412, 531], [414, 531], [413, 530], [413, 532], [531, 413], [600, 800]]) {
    await rejectsWith(validateImage(t, { fieldname: "photo", bytes: await canvas(width, height).png().toBuffer(), originalname: "photo.png", mimetype: "image/png" }), "photo", photoError(`${width} × ${height}`));
  }
  await rejectsWith(validateImage(t, { fieldname: "signature", bytes: await canvas(500, 200).jpeg().toBuffer(), originalname: "signature.jpg", mimetype: "image/jpeg" }), "signature",
    /^Signature must be exactly 300 × 150 px\. Your image is 500 × 200 px\. Please resize it using Reduce Images\.$/);
  await rejectsWith(validateImage(t, { fieldname: "parentSignature", bytes: await canvas(150, 300).png().toBuffer(), originalname: "parent.png", mimetype: "image/png" }), "parentSignature",
    /^Parent's signature must be exactly 300 × 150 px\. Your image is 150 × 300 px\./);
  // Stored 413 × 531 but EXIF orientation 6 displays it as 531 × 413.
  await rejectsWith(validateImage(t, { fieldname: "photo", bytes: await canvas(413, 531).jpeg().withMetadata({ orientation: 6 }).toBuffer(), originalname: "photo.jpg", mimetype: "image/jpeg" }), "photo", photoError("531 × 413"));

  const contentError = /File contents do not match a supported, readable document/;
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await rejectsWith(validateImage(t, { fieldname: "photo", bytes: Buffer.concat([pngHeader, Buffer.from("not really a png")]), originalname: "photo.png", mimetype: "image/png" }), "photo", contentError);
  await rejectsWith(validateImage(t, { fieldname: "photo", bytes: await canvas(413, 531).jpeg().toBuffer(), originalname: "photo.png", mimetype: "image/png" }), "photo", contentError);
  await rejectsWith(validateImage(t, { fieldname: "signature", bytes: await canvas(300, 150).png().toBuffer(), originalname: "signature.jpg", mimetype: "image/jpeg" }), "signature", contentError);
  await rejectsWith(validateImage(t, { fieldname: "signature", bytes: await canvas(300, 150).gif().toBuffer(), originalname: "signature.png", mimetype: "image/png" }), "signature", contentError);
  const webp = await canvas(300, 150).webp().toBuffer();
  await assert.rejects(validateImage(t, { fieldname: "signature", bytes: webp, originalname: "signature.webp", mimetype: "image/webp" }), error => error.status === 400);
});
