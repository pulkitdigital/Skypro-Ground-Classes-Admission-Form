// Upload rules for the photo and signatures. Keep in sync with UPLOAD_FIELDS in
// Frontend/src/formState.js (scenarios.test.js asserts both sides match).
// `tolerancePx` is the allowed difference per dimension; 0 means an exact match.
const IMAGE_RULES = {
  photo: { dimensionLabel: "Photo", width: 413, height: 531, tolerancePx: 0 },
  signature: { dimensionLabel: "Signature", width: 300, height: 150, tolerancePx: 0 },
  parentSignature: { dimensionLabel: "Parent's signature", width: 300, height: 150, tolerancePx: 0 },
};

// Accepted MIME types and extensions, each mapped to its image format; both must agree.
const IMAGE_TYPE_FORMATS = { "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/png": "png" };
const IMAGE_EXTENSION_FORMATS = { ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png" };

function checkImageDimensions(width, height, rule) {
  const tolerance = rule.tolerancePx || 0;
  if (Math.abs(width - rule.width) <= tolerance && Math.abs(height - rule.height) <= tolerance) return { ok: true, message: "" };
  const required = tolerance ? `${rule.width} × ${rule.height} px (±${tolerance} px)` : `exactly ${rule.width} × ${rule.height} px`;
  return { ok: false, message: `${rule.dimensionLabel} must be ${required}. Your image is ${width} × ${height} px. Please resize it using Reduce Images.` };
}

module.exports = { IMAGE_RULES, IMAGE_TYPE_FORMATS, IMAGE_EXTENSION_FORMATS, checkImageDimensions };
