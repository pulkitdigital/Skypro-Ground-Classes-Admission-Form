const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { SHEET_TITLE, ADMISSION_HEADERS, HEADER_ROW, admissionRow, columnLetter, createAdmissionSheet, sheetCell } = require("../services/admissionSheet");
const { sampleAdmission } = require("./pdfFixtures");

const byHeader = row => Object.fromEntries(ADMISSION_HEADERS.map((header, index) => [header, row[index]]));

async function sample(t, name) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-sheet-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return sampleAdmission(name, directory);
}

test("schema has 63 unique backend columns and 10 reserved office columns at documented letters", () => {
  assert.equal(ADMISSION_HEADERS.length, 63);
  assert.equal(HEADER_ROW.length, 73);
  assert.equal(new Set(HEADER_ROW).size, HEADER_ROW.length);
  const letters = { "Submitted At (IST)": "A", "SkyPro Application ID": "B", "Passport Expiry": "M", "Current Address": "S", "DGCA Medical Class": "AB", "Previous Flying Experience": "AC", "Physics & Mathematics Status": "AF", "Mother Occupation": "AN", "Jaipur Address": "AS", "Emergency Mobile": "AW", "How Heard About SkyPro": "BA", "Photo": "BB", "Parent Signature": "BJ", "Declaration Accepted": "BK", "Admission No.": "BL", "Verification Date": "BU" };
  for (const [header, letter] of Object.entries(letters)) assert.equal(columnLetter(HEADER_ROW.indexOf(header)), letter, header);
  for (const retired of ["Fees Paid", "Payment Mode", "Transaction ID", "Installment", "Parent Name", "School", "Board", "Class 12 Stream", "Payment Receipt"]) {
    assert.equal(HEADER_ROW.some(header => header.toLowerCase().includes(retired.toLowerCase())), false, retired);
  }
});

test("Indian package applicant maps normalized fields and document applicability", async t => {
  const { form, files } = await sample(t, "indian-package");
  const row = byHeader(admissionRow(form, files));
  assert.equal(admissionRow(form, files).length, ADMISSION_HEADERS.length);
  assert.deepEqual({
    submitted: row["Submitted At (IST)"], id: row["SkyPro Application ID"], dob: row.DOB, age: row.Age, code: row["Mobile Country Code"], mobile: row["Mobile Number"],
    citizenship: row["Country of Citizenship"], computer: row["DGCA Computer Number Status"], papers: row["DGCA Papers Cleared"], father: row["Father Mobile"],
    jaipur: row["Jaipur Contact Available"], jaipurName: row["Jaipur Contact Name"], emergency: [row["Emergency Contact Type"], row["Emergency Contact Name"], row["Emergency Relationship"], row["Emergency Mobile"]],
    course: row["Course Selection"], subjects: row["Individual Subjects"], mode: row["Class Mode"], heard: row["How Heard About SkyPro"],
    documents: [row.Photo, row.Passport, row["DGCA Exam Result"], row["DGCA Medical Assessment"], row["Class 10 Marksheet"], row["Class 12 Marksheet"], row.Aadhaar, row["Student Signature"], row["Parent Signature"]],
    declaration: row["Declaration Accepted"],
  }, {
    submitted: "2026-09-14 12:00:00", id: "SKY-GS-2026-09-0001", dob: "2000-09-15", age: 25, code: "+91", mobile: "9876543210",
    citizenship: "", computer: "No", papers: "", father: "+91 9876543210",
    jaipur: "No", jaipurName: "", emergency: ["Mother", "Test Mother", "Mother", "+91 9876543210"],
    course: "Complete Ground School Package", subjects: "", mode: "Offline", heard: "",
    documents: ["Uploaded", "Not Applicable", "Not Applicable", "Not Applicable", "Uploaded", "Uploaded", "Uploaded", "Uploaded", "Uploaded"],
    declaration: "Yes",
  });
});

test("foreign DGCA applicant maps conditional DGCA, Jaipur, Other emergency and individual subjects", async t => {
  const { form, files } = await sample(t, "foreign-individual-dgca");
  const row = byHeader(admissionRow(form, files));
  const expected = {
    "Mobile Country Code": "+65", "Mobile Number": "81234567", "Country of Citizenship": "Singapore", "Passport Number": "K1234567A", "Passport Expiry": "2031-05-20",
    "DGCA Computer Number": "DGCA-CN-778812", "DGCA Papers Cleared": "Yes", "DGCA Subjects": "Air Regulations, Aviation Meteorology", "DGCA Exam Result Date": "2026-06-10",
    "eGCA Status": "Yes", "eGCA ID": "EGCA-445566", "DGCA Medical Status": "Yes", "DGCA Medical Class": "DGCA Class-1 Medical", "Previous Flying Experience": "Yes",
    "Highest Qualification": "Other", "Other Qualification": "Diploma in Aeronautics",
    "Jaipur Contact Available": "Yes", "Jaipur Contact Relationship": "Family Friend", "Jaipur Contact Mobile": "+91 9812345678", "Jaipur Address": "22 Civil Lines, Jaipur",
    "Emergency Contact Type": "Other", "Emergency Relationship": "Uncle", "Emergency Mobile": "+65 91234567",
    "Course Selection": "Individual Subject(s)", "Individual Subjects": "Air Navigation, Technical General, Radio Telephony (RTR)", "Class Mode": "Online", "How Heard About SkyPro": "Instagram",
    "Passport": "Uploaded", "Aadhaar": "Not Applicable", "DGCA Exam Result": "Uploaded", "DGCA Medical Assessment": "Uploaded",
  };
  for (const [header, value] of Object.entries(expected)) assert.equal(row[header], value, header);
});

test("untrusted text beginning with formula characters is neutralized", async t => {
  for (const [input, output] of [["=HYPERLINK(\"http://x\")", "'=HYPERLINK(\"http://x\")"], ["+cmd", "'+cmd"], ["-2+3", "'-2+3"], ["@SUM(A1)", "'@SUM(A1)"], ["\t=1", "'\t=1"], ["+91", "+91"], ["+91 9876543210", "+91 9876543210"], ["+91 98765+1", "'+91 98765+1"], ["-5", "-5"], ["Plain = text", "Plain = text"], [25, 25], [undefined, ""]]) {
    assert.equal(sheetCell(input), output, JSON.stringify(input));
  }
  const { form, files } = await sample(t, "indian-package");
  Object.assign(form, { fullName: "=IMPORTXML(\"http://evil\",\"//a\")", heardAboutSkypro: "@friend", permanentAddress: "-1+1 Road", email: "=x@example.com" });
  const row = byHeader(admissionRow(form, files));
  assert.equal(row["Full Name"], "'=IMPORTXML(\"http://evil\",\"//a\")");
  assert.equal(row["How Heard About SkyPro"], "'@friend");
  assert.equal(row["Permanent Address"], "'-1+1 Road");
  assert.equal(row.Email, "'=x@example.com");
});

function fakeSheets(tabs = {}) {
  const state = { tabs: new Map(Object.entries(tabs)), requests: [], appends: [] };
  const titleOf = range => range.slice(1, range.indexOf("'!"));
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: [...state.tabs.keys()].map(title => ({ properties: { title } })) } }),
    batchUpdate: async ({ requestBody }) => {
      state.requests.push(...requestBody.requests);
      const { title } = requestBody.requests.find(request => request.addSheet).addSheet.properties;
      if (state.tabs.has(title)) throw new Error("Sheet already exists");
      state.tabs.set(title, [requestBody.requests.find(request => request.updateCells).updateCells.rows[0].values.map(cell => cell.userEnteredValue.stringValue)]);
    },
    values: {
      get: async ({ range }) => {
        const rows = state.tabs.get(titleOf(range)) || [];
        if (range.endsWith("!B:B")) return { data: { values: rows.map(row => [row[1]]) } };
        return { data: { values: rows.slice(0, 1).map(row => row.slice(0, ADMISSION_HEADERS.length)) } };
      },
      append: async params => { state.appends.push(params); state.tabs.get(titleOf(params.range)).push(params.requestBody.values[0]); },
    },
  } };
  return { state, writer: createAdmissionSheet({ sheets, spreadsheetId: "test" }) };
}

test("writer creates only its own tab with headers, appends RAW rows and skips a retried duplicate", async t => {
  const { form, files } = await sample(t, "indian-package");
  const legacy = [["Submitted time", "fullName"], ["old", "row"]];
  const { state, writer } = fakeSheets({ Sheet1: legacy });
  assert.equal(await writer.append(admissionRow(form, files)), true);
  assert.deepEqual(state.tabs.get(SHEET_TITLE)[0], HEADER_ROW);
  assert.equal(state.requests.find(request => request.addSheet).addSheet.properties.gridProperties.frozenRowCount, 1);
  assert.equal(state.requests.find(request => request.addProtectedRange).addProtectedRange.protectedRange.warningOnly, true);
  assert.equal(state.appends.length, 1);
  assert.equal(state.appends[0].valueInputOption, "RAW");
  assert.equal(state.appends[0].insertDataOption, "INSERT_ROWS");
  assert.equal(state.appends[0].range, `'${SHEET_TITLE}'!A1:BK1`);
  assert.equal(await writer.append(admissionRow(form, files)), false, "retry with the same Application ID is skipped");
  assert.equal(state.appends.length, 1);
  assert.deepEqual(state.tabs.get("Sheet1"), [["Submitted time", "fullName"], ["old", "row"]], "legacy tab untouched");
});

test("writer refuses mismatched headers and malformed rows without writing", async t => {
  const { form, files } = await sample(t, "indian-package");
  const wrong = [...HEADER_ROW]; wrong[2] = "fullName";
  const { state, writer } = fakeSheets({ [SHEET_TITLE]: [wrong] });
  await assert.rejects(writer.append(admissionRow(form, files)), /column C header must be "Full Name"/);
  await assert.rejects(writer.append(["too", "short"]), /does not match/);
  assert.equal(state.appends.length, 0);
  assert.equal(state.requests.length, 0);
});
