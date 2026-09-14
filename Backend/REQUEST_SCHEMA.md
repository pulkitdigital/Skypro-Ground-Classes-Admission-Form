# Ground School request contract — Phases 9–10

`POST /api/submit`, `multipart/form-data`. Scalar fields occur exactly once as strings. Subject lists are JSON-encoded arrays. The server validates independently, trims text, normalizes phone numbers, removes hidden dependent text, and constructs the queue payload from an allowlist. Unknown/obsolete fields are rejected. An upload supplied for a hidden condition is rejected and cleaned up.

## Student

Required: `fullName`, `dob` (valid YYYY-MM-DD, not in the future), `gender` (`Male` / `Female`), `mobileCountry` (ISO country code), `mobileCountryCode` (matching calling code, e.g. `+91`), `mobile` (possible national phone number), `email`, `nationality` (`Indian National` / `Foreign National`).

Required addresses: `permanentState`, `permanentCity`, `permanentAddress`, `currentState`, `currentCity`, `currentAddress`. The browser synchronizes addresses before submission; no same-address checkbox value is required by the API.

Foreign nationals additionally require `countryOfCitizenship`, `passportNumber`, `passportExpiryDate` (valid YYYY-MM-DD), and the `passport` PDF. `passport` is the final key already used by the frontend, not `passportUpload`.

## Contacts

Both parent groups are required. Expand `P` to `father` and `mother`:

- `PName`, `POccupation`, `PEmail`
- `PMobileCountry`, `PMobileCountryCode`, `PMobile`

`hasJaipurContact`: required `Yes` / `No`. When `Yes`, require `jaipurContactName`, `jaipurContactRelationship`, `jaipurContactAddress`, `jaipurContactMobileCountry`, `jaipurContactMobileCountryCode`, `jaipurContactMobile`.

`emergencyContactSource`: required `Mother`, `Father`, `Jaipur Local Contact`, or `Other`. Jaipur is valid only when a Jaipur contact exists. `Other` requires `emergencyOtherName`, `emergencyOtherRelationship`, `emergencyOtherMobileCountry`, `emergencyOtherMobileCountryCode`, `emergencyOtherMobile`.

The backend reconstructs `emergencyContact` as `{ source, name, relationship, countryCode, mobile }` from the validated selected contact. A browser-supplied summary is not trusted.

## Education

`highestQualification`: required `Class 12 / 10+2`, `Graduate`, `Postgraduate`, or `Other`. `otherQualification` is required only for `Other`.

`physicsMathematicsStatus`: required, one of:

- `Physics and Mathematics Completed`
- `Physics Completed, Mathematics Not Completed`
- `Mathematics Completed, Physics Not Completed`
- `Neither Completed`
- `Currently Studying / Result Awaited`

## Enrollment

`courseSelection`: required `Complete Ground School Package` or `Individual Subject(s)`.

`enrollmentSubjects`: JSON array; at least one approved subject for individual enrollment. The complete package always derives all five subjects on the server. `individualSubjects` is frontend state only and is not an API field.

Approved subjects, shared with cleared DGCA papers:

- `Air Navigation`
- `Aviation Meteorology`
- `Air Regulations`
- `Technical General`
- `Radio Telephony (RTR)`

`modeOfClass`: required `Online` / `Offline`. `heardAboutSkypro`: optional free text.

The existing browser `course` alias is accepted only if it matches `courseSelection`; the queued alias is derived. All old course values are rejected.

## DGCA/eGCA

`previousFlyingExperience`: required `Yes` / `No`, retained from the active frontend.

`hasDgcaComputerNumber`: required `Yes`, `No`, or `Applied for Computer Number`.

- `Yes` requires `dgcaComputerNumber` and `dgcaPapersCleared` (`Yes` / `No`).
- Cleared papers `Yes` requires `dgcaSubjects` (JSON array, at least one approved subject), `dgcaExamResultDate` (valid YYYY-MM-DD), and `dgcaExamResult` PDF.
- Other parent answers remove the entire dependent text branch and disallow its uploads.

`hasEgcaId`: required `Yes` / `No`.

- `Yes` requires `egcaId` and `hasDgcaMedical` (`Yes` / `No`).
- Medical `Yes` requires `dgcaMedicalClass` (`DGCA Class-1 Medical` / `DGCA Class-2 Medical`) and `dgcaMedicalAssessment` PDF.
- `No` removes dependent text and disallows dependent uploads.

## Declaration and security

`declarationAccepted` must be the literal string `true`. `recaptchaToken` is required and verified with Google; it is never queued or stored.

Browser summaries `age`, `declarationStudentName`, `declarationDate`, and `emergencyContact` are accepted for frontend compatibility but ignored. The backend derives these values. Dates and monthly ID boundaries use `Asia/Kolkata`. `submittedAt` is a server-generated ISO timestamp.

**`applicationId` must never be sent by the browser.** It is generated internally only after text/file validation and successful reCAPTCHA. No Application ID appears in the response, popup, or student email.

## Uploads

Exactly one file per applicable field, nonempty and at most **2 × 1024 × 1024 bytes**:

| Key | Format | Required when |
| --- | --- | --- |
| `photo` | JPG/JPEG | Always |
| `signature` | JPG/JPEG | Always |
| `parentSignature` | JPG/JPEG | Always |
| `marksheet10` | PDF | Always |
| `marksheet12` | PDF | Always |
| `aadhar` | PDF | Indian National |
| `passport` | PDF | Foreign National |
| `dgcaExamResult` | PDF | Computer number Yes and papers cleared Yes |
| `dgcaMedicalAssessment` | PDF | eGCA Yes and medical Yes |

Multer checks MIME, extension, size, counts, and multipart limits. Content validation parses unencrypted PDFs and decodes JPEG images independently. `image/jpg` is accepted for compatibility and normalized to `image/jpeg`; documents accept only `application/pdf`. Empty/corrupt files are rejected. JPEG decoding has a 40-million-pixel resource limit, not the obsolete signature/photo dimension requirement.

## Removed request fields

`feesPaid`, `installment`, `paymentMode`, `transactionId`, `paymentDate`, `paymentReceipt`, `parentName`, `relationship`, `parentMobile`, `occupation`, `school`, `classYear`, `class12Stream`, `board`, and old `dgca`/`egca`/`medical` aliases are unsupported. Unknown fields are rejected rather than copied into the job.

## Queue, cleanup and responses

The job contains `{ formData, uploadedFiles, files, uploadDir, uploadRoot }`; `formData` is normalized structured data, `files` is keyed by canonical upload name, and `uploadedFiles` preserves the existing renderer interface. Both reference server-created Multer descriptors. Each request has a unique directory. Only successful queue insertion transfers file ownership to the queue.

Rejected validation, upload parsing, reCAPTCHA, ID allocation, or queue insertion cleans the request directory before responding. Queue retries retain uploads and generated files; success or the third failed attempt cleans the entire job directory. Completed email/Sheets stages are not repeated on ordinary downstream retries. Ambiguous external delivery timeouts can still duplicate delivery.

Success preserves `{ success: true, message, jobId, info }`. Rejections return `{ error, fields? }` with HTTP 400; ID allocation unavailability returns 503; other server failures return 500. The Application ID is absent from all response payloads.

The queue is still in memory. A process crash can lose queued work and leave temporary files; no unsafe startup purge or durable queue was added. The admin PDF uses the Ground School layout (Phase 11: structured sections, Office Use, ordered document attachments). Sheets rows use the Ground School schema (Phase 13) in the `Ground School Admissions` tab, with the internal Application ID as plain text in column B; see the README for the header row. The dedicated ID ledger has its own explicit headers.

## Verification

Run `npm test` in Backend (Node 24 used for verification), backend `node --check` checks, and `npm run build` in Frontend. Tests use real multipart requests and parsers with mocked reCAPTCHA, queue/external services, and Sheets allocation operations. They never submit to live Brevo/Sheets.
