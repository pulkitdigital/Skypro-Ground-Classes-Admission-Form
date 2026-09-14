// Backend/services/googleService.js
// Shared Google Sheets client. Admission rows are written by admissionSheet.js;
// Application IDs by applicationIdService.js.

const { google } = require("googleapis");

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

module.exports = {
  sheets,
  serviceAccountEmail: credentials.client_email,
};
