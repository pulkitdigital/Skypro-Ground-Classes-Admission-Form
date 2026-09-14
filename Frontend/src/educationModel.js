export const EDUCATION_DEFAULTS = {
  highestQualification: "",
  otherQualification: "",
  physicsMathematicsStatus: "",
};
export const EDUCATION_FIELDS = Object.keys(EDUCATION_DEFAULTS);
export const QUALIFICATION_OPTIONS = ["Class 12 / 10+2", "Graduate", "Postgraduate", "Other"];
export const PHYSICS_MATHEMATICS_OPTIONS = [
  "Physics and Mathematics Completed",
  "Physics Completed, Mathematics Not Completed",
  "Mathematics Completed, Physics Not Completed",
  "Neither Completed",
  "Currently Studying / Result Awaited",
];

export function sanitizeEducation(form) {
  return { ...form, otherQualification: form.highestQualification === "Other" ? form.otherQualification : "" };
}

export function validateEducation(form) {
  const errors = {};
  if (!QUALIFICATION_OPTIONS.includes(form.highestQualification)) {
    errors.highestQualification = "Please select your highest educational qualification";
  }
  if (form.highestQualification === "Other" && !form.otherQualification.trim()) {
    errors.otherQualification = "Please mention your qualification";
  }
  if (!PHYSICS_MATHEMATICS_OPTIONS.includes(form.physicsMathematicsStatus)) {
    errors.physicsMathematicsStatus = "Please select your Physics and Mathematics status at 10+2 level";
  }
  return errors;
}
