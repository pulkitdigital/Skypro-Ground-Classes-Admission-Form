const { randomInt } = require("node:crypto");
const { applicableUploads } = require("./admissionContract");

const SHEET_TITLE = "Ground School Admissions";
const API_OPTIONS = { timeout: 15000 };

const phone = (code, number) => number ? `${code || ""} ${number}`.trim() : "";
const list = values => Array.isArray(values) ? values.join(", ") : "";
const courseOf = form => form.courseSelection || form.course || "";

function sheetTimestamp(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const documentStatus = field => (form, files) => files.some(file => file.fieldname === field) ? "Uploaded"
  : applicableUploads(form).has(field) ? "Not Uploaded" : "Not Applicable";

// The column order is the contract with the spreadsheet. Add new columns only
// at the end, and update README.md with the header row.
const COLUMNS = [
  ["Submitted At (IST)", form => sheetTimestamp(form.submittedAt)],
  ["SkyPro Application ID", form => form.applicationId],
  // Student
  ["Full Name", form => form.fullName],
  ["DOB", form => form.dob],
  ["Age", form => Number.isInteger(form.age) ? form.age : ""],
  ["Gender", form => form.gender],
  ["Mobile Country Code", form => form.mobileCountryCode],
  ["Mobile Number", form => form.mobile],
  ["Email", form => form.email],
  ["Nationality", form => form.nationality],
  ["Country of Citizenship", form => form.countryOfCitizenship],
  ["Passport Number", form => form.passportNumber],
  ["Passport Expiry", form => form.passportExpiryDate],
  // Address
  ["Permanent State", form => form.permanentState],
  ["Permanent City", form => form.permanentCity],
  ["Permanent Address", form => form.permanentAddress],
  ["Current State", form => form.currentState],
  ["Current City", form => form.currentCity],
  ["Current Address", form => form.currentAddress],
  // DGCA
  ["DGCA Computer Number Status", form => form.hasDgcaComputerNumber],
  ["DGCA Computer Number", form => form.dgcaComputerNumber],
  ["DGCA Papers Cleared", form => form.dgcaPapersCleared],
  ["DGCA Subjects", form => list(form.dgcaSubjects)],
  ["DGCA Exam Result Date", form => form.dgcaExamResultDate],
  ["eGCA Status", form => form.hasEgcaId],
  ["eGCA ID", form => form.egcaId],
  ["DGCA Medical Status", form => form.hasDgcaMedical],
  ["DGCA Medical Class", form => form.dgcaMedicalClass],
  ["Previous Flying Experience", form => form.previousFlyingExperience],
  // Education
  ["Highest Qualification", form => form.highestQualification],
  ["Other Qualification", form => form.otherQualification],
  ["Physics & Mathematics Status", form => form.physicsMathematicsStatus],
  // Parents
  ["Father Name", form => form.fatherName],
  ["Father Mobile", form => phone(form.fatherMobileCountryCode, form.fatherMobile)],
  ["Father Email", form => form.fatherEmail],
  ["Father Occupation", form => form.fatherOccupation],
  ["Mother Name", form => form.motherName],
  ["Mother Mobile", form => phone(form.motherMobileCountryCode, form.motherMobile)],
  ["Mother Email", form => form.motherEmail],
  ["Mother Occupation", form => form.motherOccupation],
  // Jaipur contact
  ["Jaipur Contact Available", form => form.hasJaipurContact],
  ["Jaipur Contact Name", form => form.jaipurContactName],
  ["Jaipur Contact Relationship", form => form.jaipurContactRelationship],
  ["Jaipur Contact Mobile", form => phone(form.jaipurContactMobileCountryCode, form.jaipurContactMobile)],
  ["Jaipur Address", form => form.jaipurContactAddress],
  // Emergency (resolved by the contract from the selected source)
  ["Emergency Contact Type", form => form.emergencyContact?.source],
  ["Emergency Contact Name", form => form.emergencyContact?.name],
  ["Emergency Relationship", form => form.emergencyContact?.relationship],
  ["Emergency Mobile", form => phone(form.emergencyContact?.countryCode, form.emergencyContact?.mobile)],
  // Course
  ["Course Selection", form => courseOf(form)],
  ["Individual Subjects", form => courseOf(form) === "Individual Subject(s)" ? list(form.enrollmentSubjects) : ""],
  ["Class Mode", form => form.modeOfClass],
  ["How Heard About SkyPro", form => form.heardAboutSkypro],
  // Document status
  ["Photo", documentStatus("photo")],
  ["Passport", documentStatus("passport")],
  ["DGCA Exam Result", documentStatus("dgcaExamResult")],
  ["DGCA Medical Assessment", documentStatus("dgcaMedicalAssessment")],
  ["Class 10 Marksheet", documentStatus("marksheet10")],
  ["Class 12 Marksheet", documentStatus("marksheet12")],
  ["Aadhaar", documentStatus("aadhar")],
  ["Student Signature", documentStatus("signature")],
  ["Parent Signature", documentStatus("parentSignature")],
  // Declaration
  ["Declaration Accepted", form => form.declarationAccepted === true ? "Yes" : "No"],
];

const ADMISSION_HEADERS = COLUMNS.map(([header]) => header);
// Reserved for office staff. Headers are created with a new tab; the backend never writes these cells.
const OFFICE_HEADERS = ["Admission No.", "Batch", "Final Course Fee", "Registration Amount Received", "Registration Payment Date", "Full Fee Received", "Final Payment Date", "Remarks", "Verified By", "Verification Date"];
const HEADER_ROW = [...ADMISSION_HEADERS, ...OFFICE_HEADERS];

function columnLetter(index) {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return letters;
}

// Rows are written RAW, so nothing is evaluated by Sheets. Leading formula
// characters are still neutralized so values stay inert in CSV/Excel exports.
// Signed digit groups (e.g. "+91" or "+91 9876543210") cannot call functions or
// reference cells, so they stay unchanged.
function sheetCell(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const text = String(value);
  return /^[=+\-@\t\r\n]/.test(text) && !/^[+-]?\d+( \d+)*$/.test(text) ? `'${text}` : text;
}

function admissionRow(form, files = []) {
  return COLUMNS.map(([, value]) => sheetCell(value(form, files)));
}

function createAdmissionSheet({ sheets, spreadsheetId }) {
  const tab = `'${SHEET_TITLE}'`;
  const lastColumn = columnLetter(ADMISSION_HEADERS.length - 1);
  const idColumn = columnLetter(ADMISSION_HEADERS.indexOf("SkyPro Application ID"));

  async function tabExists() {
    const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }, API_OPTIONS);
    return (data.sheets || []).some(sheet => sheet.properties.title === SHEET_TITLE);
  }

  // Creates only a new tab; existing tabs (including legacy Sheet1) are never modified.
  async function ensureTab() {
    if (!(await tabExists())) {
      const sheetId = randomInt(1, 1_000_000_000);
      try {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
          { addSheet: { properties: { sheetId, title: SHEET_TITLE, gridProperties: { rowCount: 1000, columnCount: HEADER_ROW.length, frozenRowCount: 1 } } } },
          { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADER_ROW.map(stringValue => ({ userEnteredValue: { stringValue }, userEnteredFormat: { textFormat: { bold: true } } })) }], fields: "userEnteredValue,userEnteredFormat.textFormat.bold" } },
          { addProtectedRange: { protectedRange: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, description: "Ground School admission headers: the backend verifies these before writing", warningOnly: true } } },
        ] } }, API_OPTIONS);
      } catch (error) {
        // Another process may have created the tab first, or the reply was lost.
        if (!(await tabExists())) throw error;
      }
    }
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:${lastColumn}1` }, API_OPTIONS);
    const header = data.values?.[0] || [];
    const mismatch = ADMISSION_HEADERS.findIndex((name, index) => header[index] !== name);
    if (mismatch !== -1) throw new Error(`"${SHEET_TITLE}" column ${columnLetter(mismatch)} header must be "${ADMISSION_HEADERS[mismatch]}"; row not written to avoid misaligned data`);
  }

  async function append(row) {
    if (!Array.isArray(row) || row.length !== ADMISSION_HEADERS.length) throw new Error("Admission row does not match the Ground School sheet schema");
    await ensureTab();
    // Application IDs are unique, so a job retry after an ambiguous append does not duplicate the row.
    const applicationId = row[ADMISSION_HEADERS.indexOf("SkyPro Application ID")];
    if (applicationId) {
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!${idColumn}:${idColumn}` }, API_OPTIONS);
      if ((data.values || []).some(([value]) => value === applicationId)) {
        console.log(`📊 ${applicationId} already recorded in "${SHEET_TITLE}"; skipping duplicate row`);
        return false;
      }
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `${tab}!A1:${lastColumn}1`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    }, API_OPTIONS);
    console.log(`📊 Admission row appended to "${SHEET_TITLE}"`);
    return true;
  }

  return { append };
}

async function appendAdmissionRow(row) {
  const { sheets } = require("./googleService");
  return createAdmissionSheet({ sheets, spreadsheetId: process.env.SHEET_ID }).append(row);
}

module.exports = { SHEET_TITLE, ADMISSION_HEADERS, OFFICE_HEADERS, HEADER_ROW, admissionRow, appendAdmissionRow, columnLetter, createAdmissionSheet, sheetCell, sheetTimestamp };
