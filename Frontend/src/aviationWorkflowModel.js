export const COMPUTER_NUMBER_OPTIONS = ["Yes", "No", "Applied for Computer Number"];
export const YES_NO_OPTIONS = ["Yes", "No"];
export const MEDICAL_CLASSES = ["DGCA Class-1 Medical", "DGCA Class-2 Medical"];
export const DGCA_SUBJECTS = [
  "Air Navigation",
  "Aviation Meteorology",
  "Air Regulations",
  "Technical General",
  "Radio Telephony (RTR)",
];

export const AVIATION_DEFAULTS = {
  hasDgcaComputerNumber: "",
  dgcaComputerNumber: "",
  dgcaPapersCleared: "",
  dgcaSubjects: [],
  dgcaExamResultDate: "",
  hasEgcaId: "",
  egcaId: "",
  hasDgcaMedical: "",
  dgcaMedicalClass: "",
};
export const AVIATION_UPLOAD_KEYS = ["dgcaExamResult", "dgcaMedicalAssessment"];
export const AVIATION_FIELD_KEYS = [...Object.keys(AVIATION_DEFAULTS), ...AVIATION_UPLOAD_KEYS];

// A single dependency map controls JSX visibility, cleanup, validation, and payloads.
export function aviationVisibility(form) {
  const computerNumber = form.hasDgcaComputerNumber === "Yes";
  const papers = computerNumber && form.dgcaPapersCleared === "Yes";
  const egca = form.hasEgcaId === "Yes";
  const medical = egca && form.hasDgcaMedical === "Yes";
  return {
    dgcaComputerNumber: computerNumber,
    dgcaPapersCleared: computerNumber,
    dgcaSubjects: papers,
    dgcaExamResultDate: papers,
    dgcaExamResult: papers,
    egcaId: egca,
    hasDgcaMedical: egca,
    dgcaMedicalClass: medical,
    dgcaMedicalAssessment: medical && MEDICAL_CLASSES.includes(form.dgcaMedicalClass),
  };
}

export function hiddenAviationFields(form) {
  return Object.entries(aviationVisibility(form)).filter(([, visible]) => !visible).map(([key]) => key);
}

export function omitFields(record, keys) {
  const next = { ...record };
  keys.forEach((key) => { delete next[key]; });
  return next;
}

export function sanitizeAviationForm(form) {
  const next = { ...form };
  hiddenAviationFields(form).forEach((key) => {
    if (key in AVIATION_DEFAULTS) next[key] = Array.isArray(AVIATION_DEFAULTS[key]) ? [] : "";
  });
  return next;
}

export function validateAviationWorkflow(form) {
  const errors = {};
  const visible = aviationVisibility(form);
  if (!COMPUTER_NUMBER_OPTIONS.includes(form.hasDgcaComputerNumber)) {
    errors.hasDgcaComputerNumber = "Please select your DGCA computer number status";
  }
  if (visible.dgcaComputerNumber && !form.dgcaComputerNumber.trim()) {
    errors.dgcaComputerNumber = "DGCA computer number is required";
  }
  if (visible.dgcaPapersCleared && !YES_NO_OPTIONS.includes(form.dgcaPapersCleared)) {
    errors.dgcaPapersCleared = "Please select whether you have cleared any DGCA papers";
  }
  if (visible.dgcaSubjects && (!form.dgcaSubjects.length || form.dgcaSubjects.some((subject) => !DGCA_SUBJECTS.includes(subject)))) {
    errors.dgcaSubjects = "Please select at least one of the listed DGCA subjects";
  }
  if (visible.dgcaExamResultDate) {
    if (!form.dgcaExamResultDate) errors.dgcaExamResultDate = "Exam result date is required";
    else {
      const date = new Date(`${form.dgcaExamResultDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dgcaExamResultDate) || !Number.isFinite(date.getTime())
        || date.toISOString().slice(0, 10) !== form.dgcaExamResultDate || form.dgcaExamResultDate.startsWith("0000")) {
        errors.dgcaExamResultDate = "Enter a valid exam result date";
      }
    }
  }
  if (!YES_NO_OPTIONS.includes(form.hasEgcaId)) errors.hasEgcaId = "Please select whether you have an eGCA ID";
  if (visible.egcaId && !form.egcaId.trim()) errors.egcaId = "eGCA ID is required";
  if (visible.hasDgcaMedical && !YES_NO_OPTIONS.includes(form.hasDgcaMedical)) {
    errors.hasDgcaMedical = "Please select whether you have a DGCA medical";
  }
  if (visible.dgcaMedicalClass && !MEDICAL_CLASSES.includes(form.dgcaMedicalClass)) {
    errors.dgcaMedicalClass = "Please select a DGCA medical class";
  }
  return errors;
}
