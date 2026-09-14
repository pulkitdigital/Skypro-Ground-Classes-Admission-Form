import { PHONE_COUNTRIES, FOREIGN_FIELDS, calculateAge, localDateString, synchronizeAddress } from "./studentDetailsModel.js";
import { AVIATION_DEFAULTS, DGCA_SUBJECTS, aviationVisibility, hiddenAviationFields, sanitizeAviationForm } from "./aviationWorkflowModel.js";
import { EDUCATION_DEFAULTS, sanitizeEducation } from "./educationModel.js";
import { CONTACT_DEFAULTS, sanitizeContacts, hiddenContactFields, deriveEmergencyContact } from "./contactModel.js";
import { ENROLLMENT_DEFAULTS, sanitizeEnrollment, enrollmentPayload } from "./enrollmentModel.js";

export const FORM_NAME = "Ground School Form";
export const DRAFT_VERSION = 8;
export const DRAFT_KEY = "admissionFormData";
export const DRAFT_TIMESTAMP_KEY = "admissionFormTimestamp";
export const DRAFT_TTL = 2 * 60 * 60 * 1000;

const EMPTY_FORM = {
  fullName: "",
  dob: "",
  gender: "",
  mobileCountry: "IN",
  mobileCountryCode: "+91",
  mobile: "",
  email: "",
  nationality: "",
  countryOfCitizenship: "",
  passportNumber: "",
  passportExpiryDate: "",
  permanentState: "",
  permanentCity: "",
  permanentAddress: "",
  currentState: "",
  currentCity: "",
  currentAddress: "",
  ...CONTACT_DEFAULTS,
  ...EDUCATION_DEFAULTS,
  ...ENROLLMENT_DEFAULTS,
  previousFlyingExperience: "",
  ...AVIATION_DEFAULTS,
};

const PDF_RULE = { accept: "application/pdf", formats: "PDF", extensions: /\.pdf$/i, types: ["application/pdf"] };
const JPEG_RULE = { accept: ".jpg,.jpeg,image/jpeg", formats: "JPG or JPEG", extensions: /\.jpe?g$/i, types: ["image/jpeg", "image/jpg"] };
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export const UPLOAD_FIELDS = {
  aadhar: { ...PDF_RULE, label: "Upload Aadhaar Card", section: "education", indianOnly: true },
  marksheet10: { ...PDF_RULE, label: "Upload Class-10th Marksheet", section: "education" },
  marksheet12: { ...PDF_RULE, label: "Upload Class-12th Marksheet", section: "education" },
  photo: { ...JPEG_RULE, label: "Passport Size Photo", section: "student" },
  passport: { ...PDF_RULE, label: "Upload Passport", section: "student", foreignOnly: true },
  dgcaExamResult: { ...PDF_RULE, label: "Upload DGCA Examination Result", section: "aviation" },
  dgcaMedicalAssessment: { ...PDF_RULE, label: "Upload DGCA Medical Assessment", section: "aviation" },
  signature: { ...JPEG_RULE, label: "Student's Signature", section: "declaration" },
  parentSignature: { ...JPEG_RULE, label: "Parent's Signature", section: "declaration" },
};

export function normalizeForm(saved = {}) {
  const source = saved && typeof saved === "object" ? saved : {};
  const form = Object.fromEntries(Object.entries(EMPTY_FORM).map(([key, fallback]) => [
    key,
    key === "dgcaSubjects"
      ? [...new Set(Array.isArray(source[key]) ? source[key].filter((subject) => DGCA_SUBJECTS.includes(subject)) : [])]
      : key === "individualSubjects" ? (Array.isArray(source[key]) ? source[key] : [])
      : typeof source[key] === "string" ? source[key] : fallback,
  ]));
  const country = PHONE_COUNTRIES.find((item) => item.country === source.mobileCountry)
    || PHONE_COUNTRIES.find((item) => item.callingCode === source.mobileCountryCode)
    || PHONE_COUNTRIES.find((item) => item.country === "IN");
  form.mobileCountry = country.country;
  form.mobileCountryCode = country.callingCode;
  if (form.nationality !== "Foreign National") FOREIGN_FIELDS.forEach((key) => { form[key] = ""; });
  return sanitizeEnrollment(sanitizeContacts(sanitizeEducation(sanitizeAviationForm(form))));
}

export function readDraft(storage, now = Date.now()) {
  const empty = { form: normalizeForm(), sameAddress: false, disclaimerAccepted: false };
  try {
    const timestamp = Number(storage.getItem(DRAFT_TIMESTAMP_KEY));
    if (!timestamp || timestamp > now || now - timestamp >= DRAFT_TTL) return empty;
    const saved = JSON.parse(storage.getItem(DRAFT_KEY));
    if (!saved || ![undefined, 2, 3, 4, 5, 6, 7, DRAFT_VERSION].includes(saved.version)) return empty;
    let form = normalizeForm(saved.form);
    const sameAddress = saved.sameAddress === true;
    if (sameAddress) form = synchronizeAddress(form);
    return {
      form,
      sameAddress,
      // Legacy drafts need a fresh declaration after the declaration wording changes.
      disclaimerAccepted: saved.version === DRAFT_VERSION && saved.disclaimerAccepted === true,
    };
  } catch {
    return empty;
  }
}

export function validateUpload(file, name) {
  const rule = UPLOAD_FIELDS[name];
  if (!rule) return "Unsupported upload field";
  if (!rule.types.includes(file.type) || !rule.extensions.test(file.name)) {
    return `Only ${rule.formats} files are allowed`;
  }
  if (file.size > MAX_UPLOAD_BYTES) return "File size must not exceed 2 MB";
  if (file.size === 0) return "The selected file is empty";
  return "";
}

export function isUploadVisible(name, form) {
  const rule = UPLOAD_FIELDS[name];
  if (!rule) return false;
  if (rule.indianOnly) return form.nationality === "Indian National";
  if (rule.foreignOnly) return form.nationality === "Foreign National";
  return rule.section === "aviation" ? aviationVisibility(form)[name] === true : true;
}

export function validateFormUploads(form, files, fileErrors = {}, validatingFiles = {}) {
  const errors = {};
  Object.entries(UPLOAD_FIELDS).forEach(([name, rule]) => {
    if (!isUploadVisible(name, form)) return;
    if (fileErrors[name]) errors[name] = fileErrors[name];
    else if (validatingFiles[name]) errors[name] = "Please wait for file validation";
    else if (!files[name]) errors[name] = `${rule.label} is required`;
    else {
      const error = validateUpload(files[name], name);
      if (error) errors[name] = error;
    }
  });
  return errors;
}

export function createSubmission(form, files, token, declarationAccepted = false, submittedAt = new Date()) {
  const payload = new FormData();
  const values = normalizeForm(form);
  Object.assign(values, enrollmentPayload(values));
  delete values.individualSubjects;
  const emergency = deriveEmergencyContact(values);
  hiddenContactFields(values).forEach((key) => { delete values[key]; });
  if (emergency) payload.append("emergencyContact", JSON.stringify(emergency));
  if (values.highestQualification !== "Other") delete values.otherQualification;
  hiddenAviationFields(values).forEach((key) => { delete values[key]; });
  if (values.nationality !== "Foreign National") FOREIGN_FIELDS.forEach((key) => { delete values[key]; });
  payload.append("age", String(calculateAge(values.dob)));
  Object.entries(values).forEach(([key, value]) => {
    payload.append(key, Array.isArray(value) ? JSON.stringify(value) : value);
  });
  // Keep the existing backend course summary meaningful until its migration.
  payload.append("course", values.courseSelection);
  Object.keys(UPLOAD_FIELDS).forEach((key) => {
    if (!isUploadVisible(key, values)) return;
    if (files[key]) payload.append(key, files[key]);
  });
  payload.append("declarationAccepted", String(declarationAccepted === true));
  payload.append("declarationStudentName", values.fullName);
  payload.append("declarationDate", localDateString(submittedAt));
  payload.append("recaptchaToken", token);
  return payload;
}
