import test from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_BYTES, UPLOAD_FIELDS, checkImageDimensions, normalizeForm, validateImageUpload, validateSelectedImages, validateUpload } from "./formState.js";

const IMAGE_FIELDS = ["photo", "signature", "parentSignature"];
const file = (name, type, size = 100) => ({ name, type, size });

test("photo and signature rules are exact pixel sizes with JPG, JPEG and PNG accepted", () => {
  assert.deepEqual(
    Object.fromEntries(IMAGE_FIELDS.map((name) => [name, [UPLOAD_FIELDS[name].width, UPLOAD_FIELDS[name].height, UPLOAD_FIELDS[name].tolerancePx]])),
    { photo: [413, 531, 0], signature: [300, 150, 0], parentSignature: [300, 150, 0] },
  );
  for (const name of IMAGE_FIELDS) {
    assert.equal(UPLOAD_FIELDS[name].formats, "JPG, JPEG or PNG");
    assert.equal(UPLOAD_FIELDS[name].accept, ".jpg,.jpeg,image/jpeg,.png,image/png");
  }
});

test("exact size passes; one pixel off in either dimension or swapped sizes fail", () => {
  const { photo, signature } = UPLOAD_FIELDS;
  assert.deepEqual(checkImageDimensions(413, 531, photo), { ok: true, message: "" });
  assert.deepEqual(checkImageDimensions(300, 150, signature), { ok: true, message: "" });
  for (const [width, height] of [[412, 531], [414, 531], [413, 530], [413, 532], [531, 413]]) {
    assert.equal(checkImageDimensions(width, height, photo).ok, false, `photo ${width}x${height}`);
  }
  for (const [width, height] of [[299, 150], [301, 150], [300, 149], [300, 151], [150, 300]]) {
    assert.equal(checkImageDimensions(width, height, signature).ok, false, `signature ${width}x${height}`);
  }
});

test("dimension errors name the required and actual size", () => {
  assert.equal(checkImageDimensions(600, 800, UPLOAD_FIELDS.photo).message, "Photo must be exactly 413 × 531 px. Your image is 600 × 800 px. Please resize it using Reduce Images.");
  assert.equal(checkImageDimensions(500, 200, UPLOAD_FIELDS.signature).message, "Signature must be exactly 300 × 150 px. Your image is 500 × 200 px. Please resize it using Reduce Images.");
  assert.equal(checkImageDimensions(500, 200, UPLOAD_FIELDS.parentSignature).message, "Parent's signature must be exactly 300 × 150 px. Your image is 500 × 200 px. Please resize it using Reduce Images.");
  const tolerant = { ...UPLOAD_FIELDS.photo, tolerancePx: 2 };
  assert.equal(checkImageDimensions(415, 529, tolerant).ok, true, "tolerance is configured only in the rule");
  assert.match(checkImageDimensions(416, 531, tolerant).message, /^Photo must be 413 × 531 px \(±2 px\)\./);
});

test("PNG, JPG and JPEG are accepted in any case; mismatched MIME and extension, GIF and WebP are rejected", () => {
  for (const name of IMAGE_FIELDS) {
    for (const accepted of [file("a.png", "image/png"), file("a.PNG", "image/png"), file("a.jpg", "image/jpeg"), file("a.JPEG", "image/jpeg"), file("a.jpeg", "image/jpg")]) {
      assert.equal(validateUpload(accepted, name), "", `${name} ${accepted.name}`);
    }
    for (const rejected of [file("a.png", "image/jpeg"), file("a.jpg", "image/png"), file("a.gif", "image/gif"), file("a.webp", "image/webp"), file("a.png.exe", "image/png"), file("a.constructor", "constructor")]) {
      assert.equal(validateUpload(rejected, name), "Only JPG, JPEG or PNG files are allowed", `${name} ${rejected.name}`);
    }
    assert.equal(validateUpload(file("a.png", "image/png", MAX_UPLOAD_BYTES + 1), name), "File size must not exceed 2 MB");
  }
});

test("image validation decodes after type and size checks and reports unreadable images", async () => {
  const sizeOf = (width, height) => async () => ({ width, height });
  assert.equal(await validateImageUpload(file("photo.png", "image/png"), "photo", sizeOf(413, 531)), "");
  assert.equal(await validateImageUpload(file("photo.png", "image/png"), "photo", sizeOf(600, 800)), "Photo must be exactly 413 × 531 px. Your image is 600 × 800 px. Please resize it using Reduce Images.");
  assert.equal(await validateImageUpload(file("sign.jpg", "image/jpeg"), "signature", async () => { throw new Error("decode failed"); }), "The selected image could not be read. Please upload a valid JPG, JPEG or PNG image.");
  assert.equal(await validateImageUpload(file("m10.pdf", "application/pdf"), "marksheet10", sizeOf(1, 1)), "", "documents have no dimension rule");
});

test("submit-time recheck covers every selected, visible image", async () => {
  const sizes = { "photo.jpg": [413, 531], "sign.png": [500, 200], "parent.jpeg": [300, 150], "passport.pdf": [1, 1] };
  const read = async (selected) => ({ width: sizes[selected.name][0], height: sizes[selected.name][1] });
  const files = { photo: file("photo.jpg", "image/jpeg"), signature: file("sign.png", "image/png"), parentSignature: file("parent.jpeg", "image/jpeg"), passport: file("passport.pdf", "application/pdf") };
  const errors = await validateSelectedImages(normalizeForm({ nationality: "Indian National" }), files, read);
  assert.deepEqual(errors, { signature: "Signature must be exactly 300 × 150 px. Your image is 500 × 200 px. Please resize it using Reduce Images." });
  assert.deepEqual(await validateSelectedImages(normalizeForm(), {}, read), {});
});
