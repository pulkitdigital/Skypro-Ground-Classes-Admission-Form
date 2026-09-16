# SkyPro Aviation Ground School Admission Form

## Project overview

An online admission form for the SkyPro Aviation Ground School (DGCA ground classes). Applicants complete a single-page React form with their personal, contact, education, enrollment, and DGCA/eGCA details, upload supporting documents, accept the declaration, and pass a reCAPTCHA check.

The Express backend validates every field and file again, verifies reCAPTCHA, allocates an internal SkyPro Application ID, and returns immediately. An in-memory background queue then:

1. generates the admin admission PDF (form, office-use section, and appended documents),
2. emails the admin (with the Form PDF and the supporting Documents PDF) and the applicant (confirmation with the Student Copy PDF) through Brevo,
3. appends a row to the `Ground School Admissions` tab of a Google Sheet.

There is no database. Google Sheets is the only persistent store (admission rows and the Application ID ledger); uploaded files are temporary.

Related documents: [`Backend/REQUEST_SCHEMA.md`](Backend/REQUEST_SCHEMA.md) (request contract notes) and [`Backend/APPLICATION_IDS.md`](Backend/APPLICATION_IDS.md) (ID allocation and recovery).

## Production frontend

**`https://groundschool.skyproaviation.org`**

- `Frontend/index.html` declares `https://groundschool.skyproaviation.org/` as the canonical URL.
- `Frontend/public/.htaccess` (copied to `dist/.htaccess` by Vite) removes Google Analytics `_gl` / `_ga` / `_ga_*` query parameters with a 301 redirect when the host is `groundschool.skyproaviation.org` and Apache `mod_rewrite` is available.
- DNS, HTTPS, and hosting for the hostname are managed outside this repository.

## Architecture

```mermaid
flowchart LR
  B["Browser: React form"] -->|"reCAPTCHA widget"| R["Google reCAPTCHA"]
  B -->|"multipart POST /api/submit"| A["Express API"]
  A -->|"siteverify"| R
  A -->|"allocate ID"| L[("Sheet tab: GroundSchoolApplicationIDs")]
  A -->|"addJob"| Q["In-memory queue"]
  Q --> P["PDFs: PDFKit + pdf-lib"]
  Q --> E["Brevo: admin and student emails"]
  Q --> S[("Sheet tab: Ground School Admissions")]
```

Request flow:

1. The browser validates the form, builds `multipart/form-data` containing only visible fields and uploads, and posts it to `VITE_API_URL/api/submit`.
2. The API checks the origin, stores uploads in a unique temporary directory, validates text and files, verifies reCAPTCHA, allocates the Application ID, queues the job, and responds `200`. Any rejection deletes the temporary directory first.
3. The queue processes jobs one at a time (PDF → emails → Sheets row), retries failures, and deletes the job's directory when it finishes or finally fails.

## Technology stack

| Layer | Implementation (versions from `package.json`) |
| --- | --- |
| Frontend | React 19.2, Vite 7.2, Tailwind CSS 4.1 (`@tailwindcss/vite`), Axios 1.13, `libphonenumber-js` 1.13, `react-icons` 5.5 (footer) |
| Frontend tooling | ESLint 9 with React Hooks and React Refresh plugins; tests use the built-in `node:test` runner |
| API | Node.js, Express 5.2, `cors`, Multer 2, `dotenv`, Axios 1.20 |
| Validation | `libphonenumber-js` (phones), `sharp` (JPEG decoding), `pdf-lib` (PDF parsing) |
| PDF | PDFKit 0.17 (form), pdf-lib 1.17 (attachment merge) |
| Email | Brevo transactional API (`@getbrevo/brevo` 3) |
| Records and IDs | Google Sheets API v4 via `googleapis` (service account) |
| Bot protection | Google reCAPTCHA v2 checkbox, verified server-side |
| Background work | In-memory JavaScript queue |

Node.js: Vite 7 requires Node 20.19+ or 22.12+. The project was last verified with Node 24.18. The backend tests use the global `File`, `FormData`, and `Blob` classes.

Declared but not imported by the current backend code: `puppeteer`, `nodemailer`, `@sendinblue/client`, `image-size`.

## Project structure

```text
Skypro Ground Classes Form/
├── Readme.md
├── Frontend/
│   ├── public/
│   │   ├── .htaccess                 # Tracking-parameter redirect (Apache)
│   │   ├── banner.webp, bannerOld.webp, logo.webp, Skypro-Favicon.svg, vite.svg
│   ├── src/
│   │   ├── main.jsx, App.jsx         # Entry; App = HeroSection + form + Footer
│   │   ├── HeroSection.jsx, Footer.jsx
│   │   ├── form.jsx                  # State, validation, draft, submission, reset
│   │   ├── StudentDetails.jsx        # 1. Student Details (+ photo, passport)
│   │   ├── ContactDetails.jsx        # 2. Contact Details (parents, Jaipur, emergency)
│   │   ├── EducationDetails.jsx      # 3. Education Details (+ marksheets, Aadhaar)
│   │   ├── EnrollmentDetails.jsx     # 4. Course & Enrollment
│   │   ├── AviationWorkflow.jsx      # 5. Aviation Background (DGCA, eGCA, medical)
│   │   ├── DeclarationDetails.jsx    # 6. Declaration & Undertaking (+ signatures)
│   │   ├── UploadField.jsx, ThankYouPopup.jsx
│   │   ├── formState.js              # Defaults, drafts, upload rules, multipart builder
│   │   ├── studentDetailsModel.js, contactModel.js, educationModel.js,
│   │   ├── enrollmentModel.js, aviationWorkflowModel.js
│   │   ├── submissionFeedback.js     # API error → message and field errors
│   │   ├── useCurrentDate.js, index.css, App.css
│   │   └── *.test.js                 # node:test unit tests
│   ├── index.html                    # Title, description, canonical URL
│   ├── vite.config.js                # Production build env checks
│   ├── eslint.config.js
│   ├── .env                          # Public VITE_ values (tracked in git)
│   └── package.json
└── Backend/
    ├── server.js                     # Express app, CORS, /api/submit, health, upload purge
    ├── services/
    │   ├── admissionContract.js      # Text/conditional validation and normalization
    │   ├── uploadService.js          # Multer config, file checks, directory cleanup/purge
    │   ├── applicationIdService.js   # SKY-GS-YYYY-MM-NNNN allocation (Sheets ledger + lock)
    │   ├── queueService.js           # In-memory job queue
    │   ├── pdfGenerator.js           # Admin/student PDF rendering and attachment merge
    │   ├── emailService.js           # Brevo admin and student emails
    │   ├── admissionSheet.js         # Sheets schema, escaping, tab/header checks, append
    │   ├── googleService.js          # Shared Google Sheets client
    │   ├── formatting.js             # Date/phone display helpers
    │   └── convertImageToPdf.js      # Entirely commented out; not used
    ├── scripts/applicationIdLock.js  # Admin tool: inspect/release a stuck ID lock
    ├── scripts/previewEmails.js      # Testing only: preview/send admin and student emails for fictional applicants
    ├── tests/                        # node:test suites and fixtures
    ├── assets/                       # header.png, footer.png (PDF branding; .webp copies unused)
    ├── uploads/                      # Temporary request directories (git-ignored)
    ├── tmp/pdfs/                     # Output of test-pdf.js (git-ignored)
    ├── test-pdf.js                   # Generates sample PDFs
    ├── test-converter.js             # Obsolete; imports a non-existent path
    ├── REQUEST_SCHEMA.md, APPLICATION_IDS.md
    ├── .env                          # Secrets (git-ignored)
    └── package.json
```

## Local setup

1. Install dependencies: `npm ci` in `Backend` and in `Frontend`.
2. Create the two `.env` files below.
3. Start the backend from `Backend` (`npm start`, port 5000 by default) and the frontend from `Frontend` (`npm run dev`, normally `http://localhost:5173`).

A complete local submission needs working reCAPTCHA keys (with `localhost` allowed), a Google service account with editor access to a test spreadsheet, and a Brevo API key. Use test recipients: a real submission sends emails and writes to the spreadsheet.

### Frontend environment

`Frontend/.env` (values are public and embedded into the JavaScript bundle at build time):

```dotenv
VITE_API_URL=http://localhost:5000
VITE_RECAPTCHA_SITE_KEY=your_recaptcha_v2_site_key
```

| Variable | Behavior |
| --- | --- |
| `VITE_API_URL` | Backend origin without `/api/submit`; trailing slashes are removed. Defaults to `http://localhost:5000` in development. |
| `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA v2 checkbox site key for the widget. |

`npm run build` (production mode) throws if either variable is missing or if `VITE_API_URL` does not start with `https://`. Restart Vite after changing these values.

### Backend environment

`Backend/.env` (never commit real values). Run the server from `Backend` so `dotenv` finds this file.

```dotenv
PORT=5000
NODE_ENV=development
RECAPTCHA_SECRET_KEY=your_recaptcha_secret_key
RECAPTCHA_ALLOWED_HOSTNAMES=
ALLOWED_ORIGINS=http://localhost:5173
BREVO_API_KEY=your_brevo_api_key
MAIL_FROM=verified-sender@example.com
ADMIN_EMAIL=admissions-test@example.com
SHEET_ID=your_test_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"...@....iam.gserviceaccount.com"}'
```

| Variable | Read by | Behavior |
| --- | --- | --- |
| `PORT` | `server.js` | Listening port; default `5000`. |
| `NODE_ENV` | `server.js` | Only used to log a warning when `production` and `ALLOWED_ORIGINS` is empty. |
| `RECAPTCHA_SECRET_KEY` | `server.js` | Secret for Google `siteverify`. If missing, every submission fails verification (400). `/health` reports whether it is set. |
| `RECAPTCHA_ALLOWED_HOSTNAMES` | `server.js` | Optional comma-separated hostnames. When set, the `hostname` returned by Google must match one (case-insensitive). |
| `ALLOWED_ORIGINS` | `server.js` | Comma-separated exact origins. When set, CORS headers are sent only to these origins and browser submissions from other origins get 403. Empty allows any origin. |
| `BREVO_API_KEY` | `emailService.js` | Brevo key; verified once per process with the Account API before sending. |
| `MAIL_FROM` | `emailService.js` | Sender address (sender name is fixed as `SkyPro Aviation`). |
| `ADMIN_EMAIL` | `emailService.js` | Admin recipient; also shown to students as the contact address. Production: `info@skyproaviation.org`. |
| `SHEET_ID` | `applicationIdService.js`, `admissionSheet.js` | Spreadsheet ID (not the URL) for both the ID ledger and admission rows. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `googleService.js` | Full service-account JSON on one line. Parsed when the Google client is first used (first ID allocation), not at server start. |

The service account needs editor access to the spreadsheet: it creates tabs, protected ranges, and developer metadata. Keep `\n` escapes in the private key. `MAX_FILE_SIZE_MB` and `SMTP_*` entries that may exist in older `.env` files are not read; the upload limit is fixed at 2 MB in code.

## Form structure

The page shows an "Important Instructions" box (file formats, 2 MB limit, "Fields marked * are required"), then six numbered sections, the reCAPTCHA widget, and the **Submit Application** button.

Conventions in the tables:

- **Text validation (backend)** applies to every text field: trimmed, at most **254** characters (**2000** for keys ending in `Address`), and no `<`, `>`, or control characters. Each key may appear only once, and unknown keys are rejected. The frontend does not enforce these length or character limits; violations are reported back by the server on the field.
- **Phone validation** (both sides): the country selector sends an ISO 3166 alpha-2 code (`…MobileCountry`) and its calling code (`…MobileCountryCode`, e.g. `+91`), which must match. The number (`…Mobile`) must be digits only (the input strips other characters, max 15), a *possible* number for that country per `libphonenumber-js`, and at most 16 characters in E.164 form. The backend stores the national number.
- **Email validation** (both sides): `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
- **Dates** are `YYYY-MM-DD` and must be real calendar dates.
- **Conditional** fields are rendered only when their rule is true. Hiding a branch clears its values, errors, and uploads in the browser, and the backend removes any dependent values it still receives.

### Student Details (section 1)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `fullName` | Full Name (as per official records) | Required | — | Text | Nonempty |
| `dob` | Date of Birth | Required | — | `YYYY-MM-DD` | Valid date, not in the future (backend compares with today in Asia/Kolkata) |
| `age` | Age (years) | Read-only | — | Calculated from `dob` | Sent by the browser but ignored; backend derives age |
| `gender` | Gender | Required | — | `Male`, `Female` | Exact value |
| `mobileCountry` | Mobile Number (WhatsApp), country selector | Required | — | ISO country code (default `IN`) | Phone validation |
| `mobileCountryCode` | (set from the selector) | Required | — | Matching calling code | Phone validation |
| `mobile` | Mobile Number (WhatsApp) | Required | — | Digits, without country code | Phone validation |
| `email` | Email ID | Required | — | Email address | Email validation |
| `nationality` | Nationality | Required | — | `Indian National`, `Foreign National` | Exact value |

### Nationality logic

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `countryOfCitizenship` | Country of Citizenship | Conditional | `nationality = Foreign National` | Text | Nonempty |
| `passportNumber` | Passport Number | Conditional | `nationality = Foreign National` | Text | Nonempty |
| `passportExpiryDate` | Passport Expiry Date | Conditional | `nationality = Foreign National` | `YYYY-MM-DD` | Valid date (no future/past rule) |
| `passport` (file) | Upload Passport (PDF) | Conditional | `nationality = Foreign National` | PDF | See [File upload requirements](#file-upload-requirements) |
| `aadhar` (file) | Upload Aadhaar Card (PDF), shown in section 3 | Conditional | `nationality = Indian National` | PDF | See file requirements |

Choosing anything other than `Foreign National` clears the three passport fields and the passport upload. Choosing anything other than `Indian National` removes the Aadhaar upload.

### Addresses

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `permanentState` | Permanent Address → State | Required | — | Text | Nonempty |
| `permanentCity` | Permanent Address → City | Required | — | Text | Nonempty |
| `permanentAddress` | Permanent Address → Address | Required | — | Text | Nonempty, ≤2000 |
| `currentState` | Current Address → State | Required | — | Text | Nonempty |
| `currentCity` | Current Address → City | Required | — | Text | Nonempty |
| `currentAddress` | Current Address → Address | Required | — | Text | Nonempty, ≤2000 |
| — | Current Address Same as Permanent Address (checkbox) | Optional | Browser only | Checked/unchecked | Not sent. When checked, current State/City/Address copy the permanent values, stay synchronized, and are disabled. |

### DGCA computer number (section 5A)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `hasDgcaComputerNumber` | Do You Have a DGCA Computer Number? | Required | — | `Yes`, `No`, `Applied for Computer Number` | Exact value |
| `dgcaComputerNumber` | Enter DGCA Computer Number | Conditional | `hasDgcaComputerNumber = Yes` | Text | Nonempty |

### DGCA papers (section 5B)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `dgcaPapersCleared` | Have You Cleared Any DGCA Papers? | Conditional | `hasDgcaComputerNumber = Yes` | `Yes`, `No` | Exact value |
| `dgcaSubjects` | Cleared DGCA Subjects (checkboxes) | Conditional | `hasDgcaComputerNumber = Yes` and `dgcaPapersCleared = Yes` | JSON array string of: `Air Navigation`, `Aviation Meteorology`, `Air Regulations`, `Technical General`, `Radio Telephony (RTR)` | At least one, only listed subjects, duplicates removed |
| `dgcaExamResult` (file) | Upload DGCA Examination Result (PDF) | Conditional | Same as `dgcaSubjects` | PDF | See file requirements |
| `dgcaExamResultDate` | Exam Result Date (with eGCA portal instructions) | Conditional | Same as `dgcaSubjects` | `YYYY-MM-DD` | Valid date (no future/past rule) |

### eGCA (section 5C)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `hasEgcaId` | Do You Have an eGCA ID? | Required | — | `Yes`, `No` | Exact value |
| `egcaId` | Enter eGCA ID | Conditional | `hasEgcaId = Yes` | Text | Nonempty |

### DGCA medical (section 5D)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `hasDgcaMedical` | Do You Have a DGCA Medical? | Conditional | `hasEgcaId = Yes` | `Yes`, `No` | Exact value |
| `dgcaMedicalClass` | DGCA Medical Type | Conditional | `hasEgcaId = Yes` and `hasDgcaMedical = Yes` | `DGCA Class-1 Medical`, `DGCA Class-2 Medical` | Exact value |
| `dgcaMedicalAssessment` (file) | Upload DGCA Medical Assessment (PDF) | Conditional | `hasEgcaId = Yes` and `hasDgcaMedical = Yes` (the browser shows it once a medical type is selected) | PDF | See file requirements |
| `previousFlyingExperience` | Previous Flying Experience | Required | — | `Yes`, `No` | Exact value |

### Education (section 3)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `highestQualification` | Highest Educational Qualification | Required | — | `Class 12 / 10+2`, `Graduate`, `Postgraduate`, `Other` | Exact value |
| `otherQualification` | Please mention qualification | Conditional | `highestQualification = Other` | Text | Nonempty |
| `physicsMathematicsStatus` | Physics & Mathematics at 10+2 Level | Required | — | `Physics and Mathematics Completed`, `Physics Completed, Mathematics Not Completed`, `Mathematics Completed, Physics Not Completed`, `Neither Completed`, `Currently Studying / Result Awaited` | Exact value |
| `marksheet10` (file) | Upload Class-10th Marksheet (PDF) | Required | — | PDF | See file requirements |
| `marksheet12` (file) | Upload Class-12th Marksheet (PDF) | Required | — | PDF | See file requirements. A note asks NIOS/other-board Physics and Mathematics marksheets to be merged into this PDF. |

### Father (section 2)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `fatherName` | Father's Name | Required | — | Text | Nonempty |
| `fatherMobileCountry` | Father's Mobile Number, country selector | Required | — | ISO country code (default `IN`) | Phone validation |
| `fatherMobileCountryCode` | (set from the selector) | Required | — | Matching calling code | Phone validation |
| `fatherMobile` | Father's Mobile Number | Required | — | Digits | Phone validation |
| `fatherEmail` | Father's E-mail ID | Required | — | Email address | Email validation |
| `fatherOccupation` | Father's Occupation | Required | — | Text | Nonempty |

### Mother (section 2)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `motherName` | Mother's Name | Required | — | Text | Nonempty |
| `motherMobileCountry` | Mother's Mobile Number, country selector | Required | — | ISO country code (default `IN`) | Phone validation |
| `motherMobileCountryCode` | (set from the selector) | Required | — | Matching calling code | Phone validation |
| `motherMobile` | Mother's Mobile Number | Required | — | Digits | Phone validation |
| `motherEmail` | Mother's E-mail ID | Required | — | Email address | Email validation |
| `motherOccupation` | Mother's Occupation | Required | — | Text | Nonempty |

### Jaipur contact (section 2)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `hasJaipurContact` | Do you have a relative, local guardian, or known contact in Jaipur? | Required | — | `Yes`, `No` | Exact value |
| `jaipurContactName` | Full Name | Conditional | `hasJaipurContact = Yes` | Text | Nonempty |
| `jaipurContactRelationship` | Relationship with Student | Conditional | `hasJaipurContact = Yes` | Text | Nonempty |
| `jaipurContactMobileCountry` | Mobile Number, country selector | Conditional | `hasJaipurContact = Yes` | ISO country code | Phone validation |
| `jaipurContactMobileCountryCode` | (set from the selector) | Conditional | `hasJaipurContact = Yes` | Matching calling code | Phone validation |
| `jaipurContactMobile` | Mobile Number | Conditional | `hasJaipurContact = Yes` | Digits | Phone validation |
| `jaipurContactAddress` | Address in Jaipur | Conditional | `hasJaipurContact = Yes` | Text | Nonempty, ≤2000 |

### Emergency contact (section 2)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `emergencyContactSource` | Who Should be Contacted in Case of an Emergency? | Required | `Jaipur Local Contact` is selectable only when `hasJaipurContact = Yes` | `Mother`, `Father`, `Jaipur Local Contact`, `Other` | Exact value; backend rejects `Jaipur Local Contact` without a Jaipur contact |
| `emergencyOtherName` | Emergency Contact Name | Conditional | `emergencyContactSource = Other` | Text | Nonempty |
| `emergencyOtherRelationship` | Relationship with Student | Conditional | `emergencyContactSource = Other` | Text | Nonempty |
| `emergencyOtherMobileCountry` | Emergency Contact Mobile Number, country selector | Conditional | `emergencyContactSource = Other` | ISO country code | Phone validation |
| `emergencyOtherMobileCountryCode` | (set from the selector) | Conditional | `emergencyContactSource = Other` | Matching calling code | Phone validation |
| `emergencyOtherMobile` | Emergency Contact Mobile Number | Conditional | `emergencyContactSource = Other` | Digits | Phone validation |
| `emergencyContact` | (summary box for Mother/Father/Jaipur) | Sent automatically | — | JSON | Ignored by the backend |

The backend resolves the final emergency contact as `{ source, name, relationship, countryCode, mobile }` from the selected source: Mother/Father use the parent's name and number with relationship `Mother`/`Father`; Jaipur uses the Jaipur contact; Other uses the `emergencyOther*` fields. Changing `hasJaipurContact` to `No` clears a `Jaipur Local Contact` selection.

### Course enrollment (section 4)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `courseSelection` | Course Selection | Required | — | `Complete Ground School Package`, `Individual Subject(s)` | Exact value |
| `enrollmentSubjects` | Select Individual Subject(s) (browser state `individualSubjects`) | Conditional | `courseSelection = Individual Subject(s)` | JSON array string of the five subjects listed under DGCA papers | At least one, only listed subjects, duplicates removed. For the complete package the browser sends all five and the backend always uses all five. |
| `modeOfClass` | Mode of Classes | Required | — | `Online`, `Offline` | Exact value |
| `heardAboutSkypro` | How Did You Hear About SkyPro Aviation? (optional) | Optional | — | Text | ≤254 characters |
| `course` | (not shown) | Sent automatically | — | Copy of `courseSelection` | If present it must equal `courseSelection` |

### Declaration (section 6)

| Request key | Label | Required | Conditional rule | Allowed values | Validation |
| --- | --- | --- | --- | --- | --- |
| `declarationAccepted` | I confirm that I have read, understood, and agree to the above Declaration & Undertaking. | Required | — | `true` | Must be the literal string `true` |
| `declarationStudentName` | Student Full Name (read-only) | Sent automatically | — | Copy of `fullName` | Ignored; backend uses `fullName` |
| `declarationDate` | Date (read-only, today) | Sent automatically | — | Browser-local date | Ignored; backend uses today's date in Asia/Kolkata |
| `signature` (file) | Student's Signature (JPG or JPEG) | Required | — | JPEG | See file requirements |
| `parentSignature` (file) | Parent's Signature (JPG or JPEG) | Required | — | JPEG | See file requirements |
| `recaptchaToken` | reCAPTCHA checkbox | Required | — | Widget token | Nonempty, ≤8192 characters, verified with Google |

The section shows five declaration paragraphs (the same text is printed in the admin PDF from `pdfGenerator.js`).

### Uploads

| Request key | Label | Section | Format | Required when |
| --- | --- | --- | --- | --- |
| `photo` | Passport Size Photo (JPG or JPEG) | 1 | JPEG | Always |
| `passport` | Upload Passport (PDF) | 1 (Foreign National Details) | PDF | `nationality = Foreign National` |
| `marksheet10` | Upload Class-10th Marksheet (PDF) | 3 | PDF | Always |
| `marksheet12` | Upload Class-12th Marksheet (PDF) | 3 | PDF | Always |
| `aadhar` | Upload Aadhaar Card (PDF) | 3 | PDF | `nationality = Indian National` |
| `dgcaExamResult` | Upload DGCA Examination Result (PDF) | 5B | PDF | Computer number `Yes` and papers cleared `Yes` |
| `dgcaMedicalAssessment` | Upload DGCA Medical Assessment (PDF) | 5D | PDF | eGCA `Yes` and medical `Yes` |
| `signature` | Student's Signature (JPG or JPEG) | 6 | JPEG | Always |
| `parentSignature` | Parent's Signature (JPG or JPEG) | 6 | JPEG | Always |

## File upload requirements

| Check | Browser (`formState.js`, `form.jsx`) | Server (`uploadService.js`, `admissionContract.js`) |
| --- | --- | --- |
| Allowed fields | Only visible upload inputs are sent | Only the nine keys above; one file per key; files for non-applicable branches are rejected; applicable files are required |
| Type (documents) | MIME `application/pdf` and `.pdf` extension | MIME `application/pdf` and `.pdf` extension (case-insensitive); content must start with `%PDF-`, load in pdf-lib, be unencrypted, and have at least one page |
| Type (photo, signatures) | MIME `image/jpeg` or `image/jpg` and `.jpg`/`.jpeg` extension; the image must decode in the browser | Same MIME/extension rule; content must start with the JPEG signature and fully decode with sharp (JPEG format, at most 40 megapixels) |
| Size | Nonempty, ≤ 2 × 1024 × 1024 bytes | Multer rejects files over 2 × 1024 × 1024 bytes; empty files are rejected |
| File names | Not used | Saved as `<random UUID><lowercased extension>` in a per-request `uploads/admission-XXXXXX` directory; original names are never used on disk |
| Multipart limits | — | At most 9 files, 100 text fields, 110 parts, 16 KB per text field, 100-byte field names |

There are no pixel-dimension requirements.

## Conditional dependency tree

```text
Always required: fullName, dob, gender, mobile*, email, nationality, addresses (6),
                 father* (6), mother* (6), hasJaipurContact, emergencyContactSource,
                 highestQualification, physicsMathematicsStatus, courseSelection, modeOfClass,
                 previousFlyingExperience, hasDgcaComputerNumber, hasEgcaId,
                 declarationAccepted=true, recaptchaToken,
                 photo, signature, parentSignature, marksheet10, marksheet12

nationality
├── Indian National ──► aadhar
└── Foreign National ─► countryOfCitizenship, passportNumber, passportExpiryDate, passport

hasDgcaComputerNumber
├── Yes ──► dgcaComputerNumber, dgcaPapersCleared
│           └── dgcaPapersCleared = Yes ──► dgcaSubjects (≥1), dgcaExamResultDate, dgcaExamResult
├── No ───► (nothing further)
└── Applied for Computer Number ──► (nothing further)

hasEgcaId
├── Yes ──► egcaId, hasDgcaMedical
│           └── hasDgcaMedical = Yes ──► dgcaMedicalClass, dgcaMedicalAssessment
└── No ───► (nothing further)

highestQualification = Other ──► otherQualification

hasJaipurContact = Yes ──► jaipurContactName, jaipurContactRelationship,
                           jaipurContactMobile*, jaipurContactAddress
                           (also enables emergencyContactSource = Jaipur Local Contact)

emergencyContactSource = Other ──► emergencyOtherName, emergencyOtherRelationship, emergencyOtherMobile*

courseSelection
├── Individual Subject(s) ──► enrollmentSubjects (≥1)
└── Complete Ground School Package ──► all five subjects (derived)

sameAddress (browser only) ──► current State/City/Address copied from permanent
```

`mobile*` means the `…MobileCountry`, `…MobileCountryCode`, and `…Mobile` trio.

## API

Base URL: the backend origin (`VITE_API_URL`).

### `POST /api/submit`

- **Content type:** `multipart/form-data` (anything else → 400).
- **Origin:** when `ALLOWED_ORIGINS` is set, a request whose `Origin` header is not listed gets 403 before any upload is read. Requests without an `Origin` header are allowed.

**Multipart fields.** All keys in [Form structure](#form-structure). Every text value is a single string. `dgcaSubjects` and `enrollmentSubjects` are JSON-encoded arrays, e.g. `["Air Navigation","Air Regulations"]`. `declarationAccepted` is `true`. The browser additionally sends `age`, `course`, `emergencyContact`, `declarationStudentName`, and `declarationDate`, which are accepted but ignored (only `course` is checked against `courseSelection`). Keys outside the contract — including the retired `course` selector values, payment fields (`feesPaid`, `installment`, `paymentMode`, `transactionId`, `paymentDate`, `paymentReceipt`), generic parent fields (`parentName`, `relationship`, `parentMobile`, `occupation`), academic fields (`school`, `classYear`, `class12Stream`, `board`), `dgca`, `egca`, `medical`, and `applicationId` — are rejected with "Unsupported form field".

**Uploaded files.** See [Uploads](#uploads) and [File upload requirements](#file-upload-requirements).

**Validation order.**

1. Origin check (403).
2. Multer: field names, count, size, MIME/extension (400).
3. `normalizeAdmission`: text rules, choices, dates, phones, emails, conditional requirements, applicable/required uploads; hidden dependent values are dropped. It derives `emergencyContact`, `age` (from `dob`, Asia/Kolkata), `course`, `declarationStudentName`, `declarationDate`, `enrollmentSubjects` for the package, and `submittedAt` (server ISO timestamp) (400 with `fields`).
4. File content checks (400).
5. reCAPTCHA (400).
6. Application ID allocation (503 on failure).
7. Queue insertion (500 on failure).

On any failure the request's upload directory is deleted before responding.

**reCAPTCHA.** The token is sent to `https://www.google.com/recaptcha/api/siteverify` in a form-encoded POST body with `RECAPTCHA_SECRET_KEY` (15 s timeout). The submission is rejected when the call fails, `success` is not `true`, `RECAPTCHA_ALLOWED_HOSTNAMES` is set and the returned `hostname` is not listed, or a numeric `score` is present and below 0.5 (v2 checkbox responses have no score). The token is never stored or queued.

**Responses.**

```json
{
  "success": true,
  "message": "Form submitted successfully! Processing in background.",
  "jobId": "job-<uuid>",
  "info": "You will receive a confirmation email shortly."
}
```

| Status | Body | When |
| --- | --- | --- |
| 200 | As above | Accepted and queued. Does not confirm PDF, email, or Sheets success. The Application ID is never returned. |
| 400 | `{ "error": "...", "fields": { "<key>": "<message>" } }` (`fields` only for field errors) | Validation, upload, or reCAPTCHA failure. Oversized file: `Each upload must be no larger than 2 MB`. |
| 403 | `{ "error": "This form must be submitted from the SkyPro Ground School website." }` | Origin not allowed |
| 503 | `{ "error": "Submission failed. Please try again." }` | Application ID allocation unavailable |
| 500 | `{ "error": "Submission failed. Please try again." }` | Queue insertion or other unexpected error |

The frontend maps these to messages (`submissionFeedback.js`): 400 shows the server message and field errors, 503/500/network/timeouts show generic retry messages, and the reCAPTCHA widget is reset after every failure.

### Other endpoints

| Method and path | Response |
| --- | --- |
| `GET /` | `Backend started successfully 🚀` |
| `GET /health` | `{ status: "OK", recaptchaConfigured, corsRestricted, recaptchaHostnameCheck, timestamp }` (configuration flags only; no connectivity test) |
| `GET /api/queue-status` | `{ queueLength, isProcessing, statusCounts }` (aggregate counts only) |

The frontend calls `GET /health` on load and every 10 minutes while open.

## SkyPro Application ID

Format: **`SKY-GS-YYYY-MM-NNNN`**, e.g. `SKY-GS-2026-09-0001`. The sequence is zero-padded to at least four digits and can grow beyond four (`SKY-GS-2026-09-10000`).

**Generation mechanism** (`services/applicationIdService.js`). The ID is generated by the backend only after text validation, file content checks, and reCAPTCHA succeed:

1. Ensure the ledger tab `GroundSchoolApplicationIDs` exists in `SHEET_ID` (created on first use with headers `Month`, `Sequence`, `Application ID`, `Allocation token`, `Reserved at`, and a protected range editable only by the service account).
2. Acquire a per-month lock by creating Sheets developer metadata with the fixed ID `1000000000 + YYYYMM` and key `skypro.gs.monthly-allocation-lock`. Google rejects a duplicate metadata ID, so only one allocator (process, instance, or restart) holds the lock. Contention is retried up to 8 times with 500–750 ms jittered waits, then returns 503.
3. Read and validate the ledger, take the highest sequence for the month plus one.
4. In one atomic `batchUpdate`, append the reservation row (with a random allocation token) and delete the lock (matched by its exact owner value).

**Monthly sequencing.** The month is the current month in **Asia/Kolkata**. Each month starts at `0001`; December rolls into January of the next year.

**Failure behavior.** A lost response is reconciled by the allocation token, so it is not appended twice. A definite HTTP 4xx rejection of the commit releases the lock. Timeouts and 5xx leave the lock in place, and locks never expire automatically. A corrupted ledger stops allocation. IDs are never reused, so gaps are possible (e.g. when a later stage fails). A stuck lock is inspected and released with `node scripts/applicationIdLock.js` (see [Commands](#commands) and `Backend/APPLICATION_IDS.md`); stop all backend instances first.

**Where it is stored or shown.**

| Location | Contains the ID |
| --- | --- |
| Ledger tab `GroundSchoolApplicationIDs` | Yes (reservation history) |
| Queue job `formData.applicationId` (memory) | Yes |
| `Ground School Admissions` sheet, column B | Yes |
| Admin Form PDF (Internal Application Information, office section, page footers) | Yes |
| Admin Documents PDF (cover page and its footer) | Yes |
| Admin email (subject, HTML, plain text, PDF attachments) | Yes |
| API response, success popup, page banner | No |
| Student email and Student Copy attachment | No |
| Student Copy PDF sent to applicant | No |

**Why it is admin-only.** It is an internal office reference for admissions administration, not a student-facing receipt number. The browser cannot supply it (an `applicationId` field is rejected), and the student email is checked before sending and refused if it contains the ID.

## PDF generation

`services/pdfGenerator.js` renders A4 pages with PDFKit and merges supporting documents with pdf-lib. Before sending emails the queue generates three files, all sharing the same layout and document-merge code:

| Call | File | Contents |
| --- | --- | --- |
| `{ copyType: "admin", part: "form" }` | `SkyPro_GroundSchool_<SanitizedStudentName>_Admin_Form.pdf` | Form pages only; no documents appended |
| `{ copyType: "admin", part: "documents" }` | `SkyPro_GroundSchool_<SanitizedStudentName>_Admin_Documents.pdf` | Cover/index page followed by the supporting documents. Not generated (`null`) when no document could be appended |
| `{ copyType: "student" }` | `SkyPro_GroundSchool_<SanitizedStudentName>_Student_Copy.pdf` | Form pages followed by the appended supporting documents |

The files are written inside the job upload directory and cleaned with that directory. Document page ranges are computed by merging the documents before the form is rendered, so the admin form and the Documents PDF cover always state the same pages. Retries reuse completed PDFs and do not resend confirmed deliveries.

**Branding and page furniture.** `Backend/assets/header.png` and `footer.png` are drawn full-width on every form page when present. Each form page has a footer line: `Ground School Admission Form | <Application ID>` (admin) and `Page X of Y`. In the admin Form PDF, Y counts form pages only; in the Student Copy, Y includes the appended pages.

**Admin PDF sections** (numbered automatically):

1. Title "GROUND SCHOOL ADMISSION FORM", `SkyPro Aviation | Submitted <date, time IST>`, and an "ADMIN COPY - CONTAINS INTERNAL INFORMATION" badge
2. Internal Application Information — SkyPro Application ID, Submitted On
3. Student Details — name, date of birth, age, gender, WhatsApp number with calling code, email, nationality, passport details for foreign nationals, permanent and current address; photo embedded top-right
4. DGCA Information — computer number status and number, papers cleared, papers list and exam result date (when cleared), eGCA status and ID, medical status and class, previous flying experience ("Not applicable" where a parent answer excludes a value)
5. Educational Qualification
6. Parent Details — Father and Mother
7. Jaipur Local Contact — only when `hasJaipurContact = Yes`
8. Emergency Contact — resolved contact
9. Course & Enrollment — course selection, subjects, class mode, how heard
10. Declaration & Undertaking — the five paragraphs, acceptance, student name, declaration date, embedded student and parent signatures
11. Submitted Documents — each applicable document with "Embedded in this form", "In Documents PDF - pages X-Y" (page numbers of the Documents PDF, cover page included), "Not provided", or "Uploaded, but could not be appended - request the original from the student". The Student Copy shows "Appended - pages X-Y" instead.
12. **For Office Use Only** (admin only, kept on one page when it fits)

**For Office Use Only.**

| Field | Filled |
| --- | --- |
| SkyPro Application ID | Automatically (shaded, marked "auto") |
| Class Mode | Automatically from `modeOfClass` |
| Course / Subject(s) Enrolled | Automatically: `Complete Ground School Package (all subjects: …)` or `Individual Subject(s): …` |
| Admission No., Batch, Remarks, Verified By | Blank box |
| Final Course Fee Payable, Registration Amount Received, Full Fee Received | Blank box with `INR` prefix |
| Registration Payment Date, Final Payment Date, Date | Blank box with `DD / MM / YYYY` guide |

**Supporting documents** (in this order): Aadhaar, Passport, Class 10 Marksheet, Class 12 Marksheet, DGCA Exam Result, DGCA Medical Assessment. Only applicable documents are included, and their pages are copied unmodified (no stamping or resizing). Photo and signatures are embedded in the form, not appended. An unreadable document does not stop generation; it is listed as not appended.

- **Admin Documents PDF:** page 1 is a cover/index page ("SUPPORTING DOCUMENTS", student full name, SkyPro Application ID, submission time in IST, and a table with each applicable document's status or page range, using the same statuses as the form). The documents follow from page 2. If no document could be appended, this PDF is not generated.
- **Student Copy:** the documents are appended directly after the form pages.

**Limitations.** Standard PDF fonts encode Latin (WinAnsi) text only. Accented Latin characters are kept or reduced to their base letter; other scripts (e.g. Devanagari) are printed as `?`.

The `student` audience omits the Internal Application Information and office sections and footer ID. It is generated for every submission and attached only to the student confirmation email. Both copies have a clear copy label above the form title.

## Email workflow

`services/emailService.js` sends both messages through the Brevo transactional API with sender `SkyPro Aviation <MAIL_FROM>`. The Brevo key is verified once per process before the first send.

| | Admin | Student |
| --- | --- | --- |
| Recipient | `ADMIN_EMAIL` (production `info@skyproaviation.org`) | Applicant `email` |
| Subject | `New Ground School Admission – <Full Name> – <Application ID>` | `Admission Application Received – SkyPro Aviation` |
| Content | SkyPro Application ID (Internal), applicant name, course/package, subjects, class mode, WhatsApp number, email, emergency contact (name, relationship, phone), submission time (IST); footer "Internal notification … Do not forward to the applicant." | Greeting, confirmation that the application for the selected course was received and is being processed, next steps (contact within 2-3 business days), course, subjects, mode, submission time, contact email (`ADMIN_EMAIL`) and phone `+91 8209388460` |
| Formats | HTML and plain text | HTML and plain text |
| Attachments | 1. `SkyPro_GroundSchool_<Name>_Admin_Form.pdf` (form only), 2. `SkyPro_GroundSchool_<Name>_Admin_Documents.pdf` (cover + supporting documents). The HTML and plain-text bodies list both names in an "Attachments:" line. If no document could be appended, only the Form PDF is attached and the body states that supporting documents are not attached | `SkyPro_GroundSchool_<Name>_Student_Copy.pdf` with supporting documents |
| Internal data | Included | Excluded: built only from applicant-facing fields; a guard refuses to send if the message contains the Application ID, "Application ID", "Office Use", "Admission No", "Verified By", "Remarks"; only the Student Copy attachment is allowed |

Applicant text is HTML-escaped in both HTML bodies.

**Retries.** Both emails are sent in parallel. Each gets up to 3 attempts with 3 s and 6 s waits. Delivery is recorded per recipient on the queue job, so when the job is retried only the undelivered message is sent again. If either message ultimately fails, the email stage fails and the queue retries the job. A timeout whose outcome is unknown can still result in a duplicate email.

## Google Sheets

`services/admissionSheet.js` writes to the **`Ground School Admissions`** tab of `SHEET_ID`.

Before each append the backend:

1. creates the tab if missing (header row A–BU in bold, frozen, with a warning-only protected header row); existing tabs, including any legacy `Sheet1`, are never read or modified;
2. verifies row 1, columns A–BK, exactly matches the headers below, and refuses to write otherwise (the error names the first mismatched column);
3. skips the append if column B already contains the Application ID (makes job retries idempotent).

Rows are appended with `valueInputOption: RAW` and `insertDataOption: INSERT_ROWS` to range `A1:BK1`. Text beginning with `=`, `+`, `-`, `@`, tab, or a line break is prefixed with `'`, except signed digit groups such as `+91` or `+91 9876543210`. Dates are `YYYY-MM-DD` text, the timestamp is `YYYY-MM-DD HH:mm:ss` in IST, Age is a number, and values that do not apply are blank.

**Exact column order.**

| Col | Header | Value |
| --- | --- | --- |
| A | Submitted At (IST) | Server submission time |
| B | SkyPro Application ID | Allocated ID |
| C | Full Name | `fullName` |
| D | DOB | `dob` |
| E | Age | Derived age |
| F | Gender | `gender` |
| G | Mobile Country Code | `mobileCountryCode` |
| H | Mobile Number | `mobile` (national number) |
| I | Email | `email` |
| J | Nationality | `nationality` |
| K | Country of Citizenship | `countryOfCitizenship` |
| L | Passport Number | `passportNumber` |
| M | Passport Expiry | `passportExpiryDate` |
| N | Permanent State | `permanentState` |
| O | Permanent City | `permanentCity` |
| P | Permanent Address | `permanentAddress` |
| Q | Current State | `currentState` |
| R | Current City | `currentCity` |
| S | Current Address | `currentAddress` |
| T | DGCA Computer Number Status | `hasDgcaComputerNumber` |
| U | DGCA Computer Number | `dgcaComputerNumber` |
| V | DGCA Papers Cleared | `dgcaPapersCleared` |
| W | DGCA Subjects | `dgcaSubjects`, comma-separated |
| X | DGCA Exam Result Date | `dgcaExamResultDate` |
| Y | eGCA Status | `hasEgcaId` |
| Z | eGCA ID | `egcaId` |
| AA | DGCA Medical Status | `hasDgcaMedical` |
| AB | DGCA Medical Class | `dgcaMedicalClass` |
| AC | Previous Flying Experience | `previousFlyingExperience` |
| AD | Highest Qualification | `highestQualification` |
| AE | Other Qualification | `otherQualification` |
| AF | Physics & Mathematics Status | `physicsMathematicsStatus` |
| AG | Father Name | `fatherName` |
| AH | Father Mobile | `<code> <number>` |
| AI | Father Email | `fatherEmail` |
| AJ | Father Occupation | `fatherOccupation` |
| AK | Mother Name | `motherName` |
| AL | Mother Mobile | `<code> <number>` |
| AM | Mother Email | `motherEmail` |
| AN | Mother Occupation | `motherOccupation` |
| AO | Jaipur Contact Available | `hasJaipurContact` |
| AP | Jaipur Contact Name | `jaipurContactName` |
| AQ | Jaipur Contact Relationship | `jaipurContactRelationship` |
| AR | Jaipur Contact Mobile | `<code> <number>` |
| AS | Jaipur Address | `jaipurContactAddress` |
| AT | Emergency Contact Type | Resolved source |
| AU | Emergency Contact Name | Resolved name |
| AV | Emergency Relationship | Resolved relationship |
| AW | Emergency Mobile | `<code> <number>` |
| AX | Course Selection | `courseSelection` |
| AY | Individual Subjects | Subjects, comma-separated; blank for the complete package |
| AZ | Class Mode | `modeOfClass` |
| BA | How Heard About SkyPro | `heardAboutSkypro` |
| BB | Photo | `Uploaded` / `Not Uploaded` / `Not Applicable` |
| BC | Passport | same |
| BD | DGCA Exam Result | same |
| BE | DGCA Medical Assessment | same |
| BF | Class 10 Marksheet | same |
| BG | Class 12 Marksheet | same |
| BH | Aadhaar | same |
| BI | Student Signature | same |
| BJ | Parent Signature | same |
| BK | Declaration Accepted | `Yes` / `No` |
| BL | Admission No. | Office staff only (never written by the backend) |
| BM | Batch | Office staff only |
| BN | Final Course Fee | Office staff only |
| BO | Registration Amount Received | Office staff only |
| BP | Registration Payment Date | Office staff only |
| BQ | Full Fee Received | Office staff only |
| BR | Final Payment Date | Office staff only |
| BS | Remarks | Office staff only |
| BT | Verified By | Office staff only |
| BU | Verification Date | Office staff only |

Files are not linked from the sheet. To print the exact tab-separated header row:

```powershell
cd Backend
node -e "console.log(require('./services/admissionSheet').HEADER_ROW.join('\t'))"
```

The same spreadsheet also holds the `GroundSchoolApplicationIDs` ledger tab (see [SkyPro Application ID](#skypro-application-id)).

## Background queue

`services/queueService.js` keeps jobs in process memory.

- **Order:** jobs are processed one at a time, first in, first out.
- **Stages per job:** (1) generate the admin Form PDF, the admin Documents PDF and the Student Copy PDF (on a retry, only a file that is missing is regenerated; a Documents PDF that could not be produced because no document was appendable is not retried), (2) send emails (skipped once both recipients are delivered), (3) append the Sheets row (skipped once written).
- **Retries:** a job is attempted at most 3 times. After a failed attempt it moves to the back of the queue and processing pauses for 5 s (after attempt 1) or 10 s (after attempt 2); this pause also delays other queued jobs.
- **Cleanup:** the job's upload directory (uploads and all generated PDFs) is deleted after success or after the third failed attempt. Failed jobs are then discarded with only a console log; there is no failure history or dead-letter store.
- **Restarts:** queued jobs are lost on crash or restart. Their Application IDs stay reserved in the ledger. Orphaned `uploads/admission-*` directories older than 24 hours are deleted at server start and every 6 hours. Loose files in `uploads/` are not touched.
- **Status:** `GET /api/queue-status` exposes only queue length, processing flag, and counts per status.

## Security

**Implemented controls.**

- Complete server-side validation of every text field, choice, date, phone, email, and conditional rule, independent of the browser; unknown, duplicated, or obsolete fields are rejected; hidden dependent values are dropped.
- Upload allowlist per field and branch, one file each, MIME and extension match, content verification (PDF parsing, JPEG decoding with a pixel limit), 2 MB limit, multipart count/size limits.
- Random server-side file names; original file names are never used as paths; cleanup refuses directories outside `uploads/admission-*`.
- Rejected requests delete their upload directory before responding, including reCAPTCHA failures; stale request directories are purged after 24 hours.
- reCAPTCHA verification with the secret in the POST body, optional hostname allowlist, and token length limit.
- CORS allowlist and 403 for unlisted browser origins when `ALLOWED_ORIGINS` is set; `x-powered-by` disabled.
- Application ID generated only by the backend and excluded from all student-facing output.
- Google Sheets rows written `RAW` with formula-character escaping.
- Student email HTML escaping and internal-content guard.
- Logs contain job IDs, Application IDs, stage names, and error messages, but no applicant names, emails, or phone numbers from this codebase. (Error messages returned by Brevo or Google are logged as received.)
- `/health` returns booleans only; secrets are read from environment variables only. `Backend/.gitignore` excludes `.env`, `uploads/`, `tmp/`, and service-account key files.

**Known limitations.**

- No rate limiting, authentication, or CAPTCHA fallback beyond reCAPTCHA and the origin allowlist; non-browser clients can send any `Origin` header.
- Uploads are written to disk before reCAPTCHA is verified, because the token is inside the same multipart body (bounded to 9 × 2 MB and deleted on rejection).
- In-memory queue: accepted submissions can be lost on crash/restart, and a successful API response does not guarantee email or Sheets delivery.
- The frontend does not enforce the backend's 254/2000-character limits or its `<`/`>` restriction; such input is rejected by the server with a field error.
- The success popup states that a confirmation "has been sent", but emails are sent asynchronously after the response and may be delayed or fail.
- Passport expiry and DGCA exam result dates are not checked against today.
- Repository hygiene: `Frontend/.env` is tracked (public values only). The `Backend` git history contains previously committed files under `uploads/` (legacy admission PDFs); ignoring the folder does not remove them from history.

**Known dead code.** `services/convertImageToPdf.js` is fully commented out; `test-converter.js` imports a non-existent path; `pdfGenerator.js` contains an unused `MONTHS` constant; `form.jsx` and `UploadField.jsx` still contain image-dimension branches that never run because no dimension rules are configured.

## Commands

| Directory | Command | Purpose |
| --- | --- | --- |
| `Frontend` | `npm run dev` | Vite development server |
| `Frontend` | `npm run build` | Production build to `Frontend/dist` (requires the production env values) |
| `Frontend` | `npm run preview` | Serve the production build locally |
| `Frontend` | `npm run lint` | ESLint |
| `Frontend` | `node --test "src/*.test.js"` | Frontend unit tests (no npm script is defined) |
| `Backend` | `npm start` | Start the API (`node server.js`) |
| `Backend` | `npm test` | All backend tests (`node --test --test-isolation=none tests/*.test.js`) |
| `Backend` | `node test-pdf.js` | Generate the admin Form PDF, admin Documents PDF and Student Copy for two fictional applicants into `Backend/tmp/pdfs` |
| `Backend` | `node scripts/previewEmails.js` | Testing only, dry run: runs fictional `indian`, `foreign` and `unreadable` applicants (fake IDs `SKY-GS-TEST-0001`…`0003`) through the real queue, PDF and email code with Brevo stubbed; writes `payload.json`, `body.html`, `body.txt` and `attachments/` per recipient to `Backend/tmp/email-preview/<scenario>/`, prints a summary and PASS/FAIL checks (exit code 1 on any FAIL). Never calls the API, reCAPTCHA, Google Sheets or the ID ledger |
| `Backend` | `node scripts/previewEmails.js --smtp-local [--smtp-host localhost] [--smtp-port 1025] [--scenario indian\|foreign\|unreadable\|all]` | Testing only, no Brevo key needed: same run as the dry run (Brevo stubbed, all checks, same `tmp/email-preview` files), then relays each captured email unchanged with nodemailer to a local SMTP catcher such as Mailpit (view at http://localhost:8025). Subject gets a `[LOCAL] ` prefix; recipients are fixed to `admin@preview.local` and `student@preview.local`. Only `localhost`/`127.0.0.1` are accepted; if nothing listens it stops with "Mailpit start karo: http://localhost:8025". Runs all scenarios unless `--scenario` is given |
| `Backend` | `node scripts/previewEmails.js --send --to <test@email> [--scenario indian\|foreign\|unreadable\|all]` | Testing only: same run, but sends through real Brevo (`BREVO_API_KEY`, `MAIL_FROM` from `.env`). Both admin and student messages go only to `--to`, with a `[TEST] ` subject prefix; `ADMIN_EMAIL` and applicant addresses are never used, and `info@skyproaviation.org` is refused. Sends `indian` unless `--scenario` is given |
| `Backend` | `node scripts/applicationIdLock.js status YYYY-MM` | Show a month's allocation lock (uses real `.env` and Google) |
| `Backend` | `node scripts/applicationIdLock.js release YYYY-MM <token> --all-instances-stopped` | Release a stuck lock after stopping every backend instance |

Smoke checks against a running backend:

```powershell
Invoke-RestMethod http://localhost:5000/health
Invoke-RestMethod http://localhost:5000/api/queue-status
```

## Testing

**Backend (`npm test`, 58 tests).** Google Sheets, Brevo, and reCAPTCHA are replaced by in-process fakes or mocks; no email is sent and no spreadsheet is written.

| File | Covers |
| --- | --- |
| `scenarios.test.js` | Cross-stack matrix: imports the real frontend models from `Frontend/src`, builds the multipart payload for each scenario, and runs it through the backend contract, Sheets row, PDF sections, admin Documents PDF, and email builders — nationality switch, computer number Yes/No/Applied, papers Yes/No, eGCA Yes/No, medical Class 1/Class 2/No, Other qualification, all Physics/Mathematics options, Jaipur Yes/No, every emergency source, package/one/multiple subjects, Online/Offline, same/independent address, invalid uploads, missing conditional fields, unchecked declaration, Application ID visibility, and stale hidden fields |
| `contract.test.js` | Backend validation rules and derived values |
| `api.test.js` | Real multipart requests: rejected inputs and uploads with cleanup, reCAPTCHA failures, allocation and queue failures, successful submission without ID in response |
| `origin.test.js` | CORS allowlist, 403 origin rejection, reCAPTCHA hostname check |
| `applicationId.test.js` | Concurrent allocation, restarts, monthly/yearly rollover, lost responses, stuck and released locks, corrupted ledger |
| `pdf.test.js` | Real PDF generation: admin Form PDF without appended pages and with form-only footer totals, Documents PDF cover and document order, page ranges matching between form and cover, unreadable/missing uploads, no Documents PDF when nothing is appendable, unchanged Student Copy, office fields |
| `email.test.js` | Admin/student templates, admin Form + Documents attachments (names and order), Form-only admin email with a note, no internal data and only the Student Copy for the student, per-recipient retry |
| `sheet.test.js` | Column letters, row mapping, formula escaping, tab creation, header verification, duplicate skip |
| `previewEmails.test.js` | Email preview script: dry run of all scenarios with Google, ledger, Sheets, `fetch`, HTTP and sockets stubbed to throw; output files; `--smtp-local` with a mocked nodemailer transport (2 mails per scenario, local recipients, `[LOCAL]` prefix, attachment names/order/type, no Brevo key or Brevo call, Mailpit hint, local-host guard); send mode overriding recipients with the `[TEST]` prefix; argument and `--to` safety |
| `queue.test.js` | Stage retries, regenerating only a missing admin PDF, cleanup of all PDFs on success and exhaustion, public status shape |
| `upload.test.js` | Stale directory purge, MIME/extension rules |

**Frontend (`node --test "src/*.test.js"`, 40 tests).** Model tests for student details (age, phones, addresses, nationality, drafts, upload rules, multipart), contacts, education, enrollment, aviation workflow, declaration, and API error mapping.

**Not automated.** Live Brevo delivery, live Google Sheets writes and ID ledger, live reCAPTCHA verification, and a real browser submission against a running backend. Verify these in staging with test recipients and a test spreadsheet (see [Production deployment](#production-deployment)).

## Production deployment

### Backend environment (API host)

Set these in the hosting dashboard or an uncommitted `.env`; never commit secrets.

| Variable | Production value |
| --- | --- |
| `ALLOWED_ORIGINS` | `https://groundschool.skyproaviation.org` (plus any other frontend origin that must keep working during a transition) |
| `RECAPTCHA_SECRET_KEY` | Secret of the same reCAPTCHA site as the frontend key |
| `RECAPTCHA_ALLOWED_HOSTNAMES` | `groundschool.skyproaviation.org` (recommended) |
| `ADMIN_EMAIL` | `info@skyproaviation.org` |
| `MAIL_FROM`, `BREVO_API_KEY` | Brevo sender and API key |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID` | Service account and production spreadsheet |
| `NODE_ENV`, `PORT` | `production`; port required by the host |

`ALLOWED_ORIGINS` is enforced when set: update it before deploying so the live frontend is not blocked.

### Frontend build environment

| Variable | Production value |
| --- | --- |
| `VITE_API_URL` | `https://<backend host>` (no `/api/submit`) |
| `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA v2 checkbox site key |

### reCAPTCHA

Add `groundschool.skyproaviation.org` to the domain list of the reCAPTCHA site whose key and secret are used. Use a separate site/key for local development.

### Steps

1. Configure the backend environment, then run `npm ci` and `npm start` in `Backend` as a persistent Node service with a writable `uploads/` directory and outbound HTTPS to Google and Brevo.
2. Check `GET /health`: `recaptchaConfigured`, `corsRestricted`, and `recaptchaHostnameCheck` should be `true`.
3. In `Frontend`, with the production variables set, run `npm ci` and `npm run build`.
4. Upload the contents of `Frontend/dist` to the web root for `groundschool.skyproaviation.org`, including the hidden `.htaccess` file when using Apache (requires `mod_rewrite`; other hosts ignore it).
5. Point DNS and HTTPS for the hostname to the static host (outside this repository).
6. Submit a test application with test recipients and confirm: success message without ID, reset form, admin email with `..._Admin_Form.pdf` and `..._Admin_Documents.pdf` (open both; page ranges in the form's Submitted Documents match the Documents PDF cover), student email with only the Student Copy PDF and without internal ID, new row in `Ground School Admissions`, and a reservation in `GroundSchoolApplicationIDs`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `npm run build` fails with "Production build requires …" | Set `VITE_API_URL` (https) and `VITE_RECAPTCHA_SITE_KEY` for the build |
| reCAPTCHA shows an invalid-domain error | Add the hostname to the reCAPTCHA site's domain list; use that site's key and secret |
| "reCAPTCHA verification failed" for every submission | `RECAPTCHA_SECRET_KEY` missing or from another site; `RECAPTCHA_ALLOWED_HOSTNAMES` does not include the page hostname |
| 403 "must be submitted from the SkyPro Ground School website" | Add the exact frontend origin (scheme + host, no path) to `ALLOWED_ORIGINS` |
| Browser cannot reach the API / CORS error | Backend running, `VITE_API_URL` correct and rebuilt, origin in `ALLOWED_ORIGINS`, HTTPS valid |
| Field error "Use plain text, maximum 254 characters" | Remove `<`/`>` or shorten the value (2000 for addresses) |
| Photo or signature rejected | Readable JPG/JPEG with `.jpg`/`.jpeg` extension, at most 2 MB |
| Document rejected | Readable, unencrypted PDF with `.pdf` extension, at most 2 MB |
| Submission returns 503 | Application ID allocation failed: check `SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, service-account editor access, quota, or a stuck lock (`node scripts/applicationIdLock.js status YYYY-MM`) |
| Success message but no email or sheet row | Check server logs for queue failures (3 attempts, then discarded); verify Brevo and Google settings |
| Sheets error naming a mismatched header column | Restore row 1 of `Ground School Admissions` to the documented headers |
| Admin PDF has no header/footer artwork | Ensure `Backend/assets/header.png` and `footer.png` exist |
| Names show `?` in the PDF | Non-Latin characters are not supported by the PDF fonts |
