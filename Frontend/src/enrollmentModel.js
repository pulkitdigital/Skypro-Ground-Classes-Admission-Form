import { DGCA_SUBJECTS } from "./aviationWorkflowModel.js";

export const ENROLLMENT_SUBJECTS = DGCA_SUBJECTS;
export const COMPLETE_PACKAGE = "Complete Ground School Package";
export const INDIVIDUAL_SUBJECTS = "Individual Subject(s)";
export const COURSE_OPTIONS = [COMPLETE_PACKAGE, INDIVIDUAL_SUBJECTS];
export const CLASS_MODES = ["Online", "Offline"];
export const ENROLLMENT_DEFAULTS = {
  courseSelection: "",
  individualSubjects: [],
  modeOfClass: "",
  heardAboutSkypro: "",
};
export const ENROLLMENT_FIELDS = Object.keys(ENROLLMENT_DEFAULTS);

export function sanitizeEnrollment(form) {
  return {
    ...form,
    individualSubjects: form.courseSelection === INDIVIDUAL_SUBJECTS
      ? [...new Set((Array.isArray(form.individualSubjects) ? form.individualSubjects : []).filter((subject) => ENROLLMENT_SUBJECTS.includes(subject)))]
      : [],
    modeOfClass: { "Online Class": "Online", "Offline Class": "Offline" }[form.modeOfClass] || form.modeOfClass,
  };
}

export function validateEnrollment(form) {
  const errors = {};
  if (!COURSE_OPTIONS.includes(form.courseSelection)) errors.courseSelection = "Please select a Ground School course option";
  if (form.courseSelection === INDIVIDUAL_SUBJECTS && (!form.individualSubjects.length || form.individualSubjects.some((subject) => !ENROLLMENT_SUBJECTS.includes(subject)))) {
    errors.individualSubjects = "Please select at least one of the listed subjects";
  }
  if (!CLASS_MODES.includes(form.modeOfClass)) errors.modeOfClass = "Please select Online or Offline classes";
  return errors;
}

export function enrollmentPayload(form) {
  const values = sanitizeEnrollment(form);
  return {
    courseSelection: values.courseSelection,
    enrollmentSubjects: values.courseSelection === COMPLETE_PACKAGE ? [...ENROLLMENT_SUBJECTS] : values.individualSubjects,
    modeOfClass: values.modeOfClass,
    heardAboutSkypro: values.heardAboutSkypro.trim(),
  };
}
