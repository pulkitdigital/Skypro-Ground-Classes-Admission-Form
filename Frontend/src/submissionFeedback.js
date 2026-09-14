// Turns a failed submission into an applicant-friendly message and field errors.
// Only the server's validation text is shown; internal details are never displayed.
const FIELD_ALIASES = { enrollmentSubjects: "individualSubjects", course: "courseSelection", declarationStudentName: "fullName" };

export function submissionFeedback(error) {
  const response = error?.response;
  if (!response) {
    return {
      message: error?.code === "ECONNABORTED"
        ? "The submission took too long and was not completed. Please check your connection and try again."
        : "We could not reach the admission server. Please check your internet connection and try again.",
      fields: {},
    };
  }
  const data = response.data && typeof response.data === "object" ? response.data : {};
  const fields = {};
  if (response.status === 400 && data.fields && typeof data.fields === "object") {
    Object.entries(data.fields).forEach(([key, value]) => {
      if (typeof value === "string" && value) fields[FIELD_ALIASES[key] || key] = value;
    });
  }
  if (response.status === 400) {
    return { message: typeof data.error === "string" && data.error ? data.error : "Please check the form and try again.", fields };
  }
  if (response.status === 413) return { message: "The uploaded files are too large. Each file must be 2 MB or smaller.", fields };
  if (response.status === 503) return { message: "The admission service is temporarily unavailable, so your form was not submitted. Please try again in a few minutes.", fields };
  return { message: "Something went wrong and your form was not submitted. Please try again.", fields };
}
