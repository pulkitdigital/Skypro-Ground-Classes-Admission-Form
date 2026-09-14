const { getCountries, getCountryCallingCode, parsePhoneNumberFromString } = require("libphonenumber-js/min");

const SUBJECTS = ["Air Navigation", "Aviation Meteorology", "Air Regulations", "Technical General", "Radio Telephony (RTR)"];
const COURSES = ["Complete Ground School Package", "Individual Subject(s)"];
const MEDICAL_CLASSES = ["DGCA Class-1 Medical", "DGCA Class-2 Medical"];
const QUALIFICATIONS = ["Class 12 / 10+2", "Graduate", "Postgraduate", "Other"];
const PHYSICS_MATHS = ["Physics and Mathematics Completed", "Physics Completed, Mathematics Not Completed", "Mathematics Completed, Physics Not Completed", "Neither Completed", "Currently Studying / Result Awaited"];
const FILE_FIELDS = ["photo", "passport", "dgcaExamResult", "dgcaMedicalAssessment", "marksheet10", "marksheet12", "aadhar", "signature", "parentSignature"];
const TEXT_FIELDS = [
  "fullName", "dob", "gender", "mobileCountry", "mobileCountryCode", "mobile", "email", "nationality",
  "countryOfCitizenship", "passportNumber", "passportExpiryDate", "permanentState", "permanentCity", "permanentAddress", "currentState", "currentCity", "currentAddress",
  "highestQualification", "otherQualification", "physicsMathematicsStatus", "courseSelection", "modeOfClass", "heardAboutSkypro", "previousFlyingExperience",
  "hasDgcaComputerNumber", "dgcaComputerNumber", "dgcaPapersCleared", "dgcaExamResultDate", "hasEgcaId", "egcaId", "hasDgcaMedical", "dgcaMedicalClass",
  "hasJaipurContact", "jaipurContactRelationship", "jaipurContactAddress", "emergencyContactSource", "emergencyOtherRelationship",
  ...["father", "mother", "jaipurContact", "emergencyOther"].flatMap(prefix => ["Name", "MobileCountry", "MobileCountryCode", "Mobile"].map(suffix => prefix + suffix)),
  "fatherEmail", "fatherOccupation", "motherEmail", "motherOccupation",
];
// These client summaries are accepted for wire compatibility, but never trusted.
const DERIVED_FIELDS = ["age", "course", "emergencyContact", "declarationStudentName", "declarationDate"];
const ALLOWED = new Set([...TEXT_FIELDS, ...DERIVED_FIELDS, "dgcaSubjects", "enrollmentSubjects", "declarationAccepted", "recaptchaToken"]);
const COUNTRIES = new Set(getCountries());

class AdmissionError extends Error {
  constructor(message, fields = {}) { super(message); this.status = 400; this.fields = fields; }
}

function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeAdmission(body, files = [], now = new Date()) {
  const errors = {};
  const data = {};
  for (const key of Object.keys(body)) {
    if (!ALLOWED.has(key)) errors[key] = "Unsupported form field";
    else if (typeof body[key] !== "string") errors[key] = "Provide this field exactly once as text";
  }
  for (const key of TEXT_FIELDS) {
    data[key] = typeof body[key] === "string" ? body[key].trim() : "";
    const limit = /Address$/.test(key) ? 2000 : 254;
    if (data[key].length > limit || /[<>\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(data[key])) errors[key] = `Use plain text, maximum ${limit} characters`;
  }
  const required = key => { if (!data[key]) errors[key] = "This field is required"; };
  const choice = (key, options) => { if (!options.includes(data[key])) errors[key] = `Choose one of: ${options.join(", ")}`; };
  const yesNo = key => choice(key, ["Yes", "No"]);
  const date = key => { if (!calendarDate(data[key])) errors[key] = "Enter a valid date (YYYY-MM-DD)"; };
  const drop = keys => keys.forEach(key => { delete data[key]; delete errors[key]; });
  const dropPrefix = prefix => drop(TEXT_FIELDS.filter(key => key.startsWith(prefix)));
  const email = key => { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[key])) errors[key] = "Enter a valid email address"; };
  const phone = (prefix = "") => {
    const numberKey = prefix ? prefix + "Mobile" : "mobile";
    const countryKey = prefix ? prefix + "MobileCountry" : "mobileCountry";
    const codeKey = prefix ? prefix + "MobileCountryCode" : "mobileCountryCode";
    const country = data[countryKey];
    const code = COUNTRIES.has(country) ? `+${getCountryCallingCode(country)}` : null;
    if (!code || data[codeKey] !== code) errors[countryKey] = "Select a valid country and matching calling code";
    const parsed = code && /^\d+$/.test(data[numberKey]) ? parsePhoneNumberFromString(data[numberKey], country) : null;
    if (!parsed?.isPossible() || parsed.countryCallingCode !== code?.slice(1) || parsed.number.length > 16) errors[numberKey] = "Enter a possible local phone number for the selected country";
    else data[numberKey] = parsed.nationalNumber;
  };
  const subjects = key => {
    let values;
    try { values = JSON.parse(body[key]); } catch { /* Report malformed JSON below. */ }
    if (!Array.isArray(values) || !values.length || values.length > SUBJECTS.length || values.some(value => !SUBJECTS.includes(value))) {
      errors[key] = "Provide a JSON array with at least one listed subject";
      return [];
    }
    return [...new Set(values)];
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  required("fullName"); date("dob");
  if (data.dob > today) errors.dob = "Date of birth cannot be in the future";
  choice("gender", ["Male", "Female"]); phone(); email("email");
  choice("nationality", ["Indian National", "Foreign National"]);
  for (const prefix of ["permanent", "current"]) for (const suffix of ["State", "City", "Address"]) required(prefix + suffix);
  const requiredFiles = new Set(["photo", "marksheet10", "marksheet12", "signature", "parentSignature"]);
  if (data.nationality === "Foreign National") {
    required("countryOfCitizenship"); required("passportNumber"); date("passportExpiryDate"); requiredFiles.add("passport");
  } else {
    drop(["countryOfCitizenship", "passportNumber", "passportExpiryDate"]);
    if (data.nationality === "Indian National") requiredFiles.add("aadhar");
  }
  for (const prefix of ["father", "mother"]) { required(prefix + "Name"); required(prefix + "Occupation"); email(prefix + "Email"); phone(prefix); }
  yesNo("hasJaipurContact");
  if (data.hasJaipurContact === "Yes") {
    for (const suffix of ["Name", "Relationship", "Address"]) required("jaipurContact" + suffix);
    phone("jaipurContact");
  } else dropPrefix("jaipurContact");
  choice("emergencyContactSource", ["Mother", "Father", "Jaipur Local Contact", "Other"]);
  if (data.emergencyContactSource === "Jaipur Local Contact" && data.hasJaipurContact !== "Yes") errors.emergencyContactSource = "A Jaipur contact must exist before selecting it";
  if (data.emergencyContactSource === "Other") { required("emergencyOtherName"); required("emergencyOtherRelationship"); phone("emergencyOther"); }
  else dropPrefix("emergencyOther");
  choice("highestQualification", QUALIFICATIONS);
  if (data.highestQualification === "Other") required("otherQualification"); else drop(["otherQualification"]);
  choice("physicsMathematicsStatus", PHYSICS_MATHS);
  choice("courseSelection", COURSES); choice("modeOfClass", ["Online", "Offline"]);
  data.enrollmentSubjects = data.courseSelection === COURSES[0] ? [...SUBJECTS] : subjects("enrollmentSubjects");
  if (body.course !== undefined && body.course !== data.courseSelection) errors.course = "Course must match courseSelection";
  yesNo("previousFlyingExperience");
  choice("hasDgcaComputerNumber", ["Yes", "No", "Applied for Computer Number"]);
  if (data.hasDgcaComputerNumber === "Yes") { required("dgcaComputerNumber"); yesNo("dgcaPapersCleared"); }
  else drop(["dgcaComputerNumber", "dgcaPapersCleared"]);
  if (data.hasDgcaComputerNumber === "Yes" && data.dgcaPapersCleared === "Yes") {
    data.dgcaSubjects = subjects("dgcaSubjects"); date("dgcaExamResultDate"); requiredFiles.add("dgcaExamResult");
  } else drop(["dgcaSubjects", "dgcaExamResultDate"]);
  yesNo("hasEgcaId");
  if (data.hasEgcaId === "Yes") { required("egcaId"); yesNo("hasDgcaMedical"); }
  else drop(["egcaId", "hasDgcaMedical"]);
  if (data.hasEgcaId === "Yes" && data.hasDgcaMedical === "Yes") { choice("dgcaMedicalClass", MEDICAL_CLASSES); requiredFiles.add("dgcaMedicalAssessment"); }
  else drop(["dgcaMedicalClass"]);
  if (body.declarationAccepted !== "true") errors.declarationAccepted = "You must accept the Declaration & Undertaking";
  const counts = {};
  for (const file of files) {
    counts[file.fieldname] = (counts[file.fieldname] || 0) + 1;
    if (!requiredFiles.has(file.fieldname)) errors[file.fieldname] = "This upload is not applicable to the selected answers";
    if (counts[file.fieldname] > 1) errors[file.fieldname] = "Upload exactly one file";
  }
  for (const key of requiredFiles) if (!counts[key]) errors[key] = "This upload is required";
  if (Object.keys(errors).length) throw new AdmissionError("Please correct the required form fields", errors);
  const prefix = { Mother: "mother", Father: "father", "Jaipur Local Contact": "jaipurContact", Other: "emergencyOther" }[data.emergencyContactSource];
  data.emergencyContact = { source: data.emergencyContactSource, name: data[prefix + "Name"], relationship: ["Mother", "Father"].includes(data.emergencyContactSource) ? data.emergencyContactSource : data[prefix + "Relationship"], countryCode: data[prefix + "MobileCountryCode"], mobile: data[prefix + "Mobile"] };
  data.age = Number(today.slice(0, 4)) - Number(data.dob.slice(0, 4)) - (today.slice(5) < data.dob.slice(5) ? 1 : 0);
  data.course = data.courseSelection;
  data.declarationAccepted = true;
  data.declarationStudentName = data.fullName;
  data.declarationDate = today;
  data.submittedAt = now.toISOString();
  return data;
}

// Uploads that apply to normalized data (hidden dependent answers are already removed).
function applicableUploads(data) {
  const fields = new Set(["photo", "marksheet10", "marksheet12", "signature", "parentSignature"]);
  if (data.nationality === "Foreign National") fields.add("passport");
  else if (data.nationality === "Indian National") fields.add("aadhar");
  if (data.hasDgcaComputerNumber === "Yes" && data.dgcaPapersCleared === "Yes") fields.add("dgcaExamResult");
  if (data.hasEgcaId === "Yes" && data.hasDgcaMedical === "Yes") fields.add("dgcaMedicalAssessment");
  return fields;
}

module.exports = { normalizeAdmission, applicableUploads, AdmissionError, FILE_FIELDS, SUBJECTS, TEXT_FIELDS };
