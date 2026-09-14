const { SUBJECTS } = require("../services/admissionContract");

function validBody(extra = {}) {
  return {
    fullName: "Test Student", dob: "2000-09-15", gender: "Female", mobileCountry: "IN", mobileCountryCode: "+91", mobile: "9876543210", email: "student@example.com",
    nationality: "Indian National", permanentState: "Rajasthan", permanentCity: "Jaipur", permanentAddress: "1 Test Road", currentState: "Rajasthan", currentCity: "Jaipur", currentAddress: "1 Test Road",
    fatherName: "Test Father", fatherMobileCountry: "IN", fatherMobileCountryCode: "+91", fatherMobile: "9876543210", fatherEmail: "father@example.com", fatherOccupation: "Teacher",
    motherName: "Test Mother", motherMobileCountry: "IN", motherMobileCountryCode: "+91", motherMobile: "9876543210", motherEmail: "mother@example.com", motherOccupation: "Teacher",
    hasJaipurContact: "No", emergencyContactSource: "Mother", highestQualification: "Graduate", physicsMathematicsStatus: "Physics and Mathematics Completed",
    courseSelection: "Complete Ground School Package", enrollmentSubjects: JSON.stringify(SUBJECTS), modeOfClass: "Online", previousFlyingExperience: "No",
    hasDgcaComputerNumber: "No", hasEgcaId: "No", declarationAccepted: "true", recaptchaToken: "test-token", ...extra,
  };
}
function filesFor(body = validBody()) {
  const keys = ["photo", "marksheet10", "marksheet12", "signature", "parentSignature", body.nationality === "Foreign National" ? "passport" : "aadhar"];
  if (body.hasDgcaComputerNumber === "Yes" && body.dgcaPapersCleared === "Yes") keys.push("dgcaExamResult");
  if (body.hasEgcaId === "Yes" && body.hasDgcaMedical === "Yes") keys.push("dgcaMedicalAssessment");
  return keys.map(fieldname => ({ fieldname }));
}
module.exports = { validBody, filesFor };
