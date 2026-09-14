# Internal Ground School Application IDs

Format: `SKY-GS-YYYY-MM-0001`, with at least four sequence digits. Month boundaries use `Asia/Kolkata`; each month starts at 1. The backend reserves IDs only after admission validation, upload checks, and reCAPTCHA succeed.

## Persistence and concurrency

The repository has Google Sheets credentials and `SHEET_ID`, but no database or proven durable single-process deployment. Therefore allocation uses the existing spreadsheet, not local disk or the in-memory queue.

The allocator creates a dedicated `GroundSchoolApplicationIDs` tab with protected columns: Month, Sequence, Application ID, Allocation token, Reserved at. Allocation tokens are backend-generated UUIDs. The ledger is an append-only reservation history, independent of completion of background processing.

Each month has a deterministic Google developer-metadata lock ID, `1000000000 + YYYYMM`. The lock key is `skypro.gs.monthly-allocation-lock`, with a JSON value containing the owner token, month, and creation time. All instances must use the same `SHEET_ID`. Document visibility permits coordination across service instances/projects with access to that spreadsheet.

Creating an existing metadata ID fails. This provides external exclusion across processes/restarts; it is not a read/increment/write race guarded by JavaScript. After acquiring the lock, the allocator reads and validates the ledger, derives the next monthly number, then atomically appends the reservation and deletes the lock in one Sheets batch request.

Google documents [metadata ID uniqueness and duplicate rejection](https://developers.google.com/workspace/sheets/api/guides/metadata) and [atomic batch requests](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate). These guarantees underpin the lock and commit protocol.

## Failure behavior

- Contention uses bounded retries with jitter, then fails with HTTP 503. There is no local or in-memory fallback.
- A lost lock-acquisition response is reconciled by reading the lock and matching its unique owner value.
- A lost commit response is reconciled by finding the exact allocation token in the ledger. The allocator never blindly repeats the append.
- A definite commit rejection (a received HTTP 4xx other than 408, e.g. quota 429) means Sheets applied nothing from the atomic batch, so the allocator releases its own lock and returns 503 without consuming a sequence.
- An uncertain/unconfirmed commit (timeout, network error, 5xx) leaves the lock in place. A crashed lock holder can therefore block that month. Locks are never automatically expired or stolen: a delayed writer could otherwise reuse a number.
- Lock deletion always matches the exact owner value (ID, key and token), so one allocator never removes another owner's lock.
- Failed queue insertion or later processing does not delete/recycle an allocated ID. Gaps are intentional; uniqueness takes precedence over gapless numbering.
- Corrupt headers/records, permissions errors, quota exhaustion, or unavailable Google APIs stop allocation. No success response or queued job is created without a confirmed ID.
- All durable coordination depends on the same spreadsheet and preservation of the allocation ledger. Changing `SHEET_ID` to an empty spreadsheet would start a new numbering history. Do not delete, edit, or copy-reset that history. The protected tab limits ordinary editor access, but spreadsheet owners and privileged API clients can still alter it.

## Recovery of a stuck lock

An administrator must stop/drain **all** backend instances and ensure no allocation request can still complete before manually changing a lock. Inspect the lock owner token and ledger reservation history, reconcile uncertain writes against backups/admin records, and preserve any potentially consumed sequence. Remove only the reconciled month's lock, then restart instances. Never delete a lock solely because it looks old, and never remove reservation rows to close gaps. This requires administrative judgment; no unsafe automatic unlock endpoint is provided.

From `Backend/`, with the production `.env`:

```bash
node scripts/applicationIdLock.js status 2026-09
node scripts/applicationIdLock.js release 2026-09 <token-from-status> --all-instances-stopped
```

`status` prints the lock owner token, creation time, and whether that token already has a ledger reservation. `release` refuses a missing lock or a token that no longer matches the current lock, and deletes only that exact lock.

## Internal visibility

- `formData.applicationId` reaches the queue and admin records.
- The admin PDF explicitly renders the ID; renderer default/student mode omits it.
- The admin email subject/body includes it. The existing student email remains attachment-free and does not include the ID.
- The `Ground School Admissions` sheet stores the ID as plain text (RAW) in column B and uses it to skip duplicate rows on job retries. The allocation ledger records it immediately, even if background work later fails.
- The browser cannot set it. Success/error response content and queue-status responses do not disclose it.

## Deployment and test status

No new service or environment variable is required: existing `GOOGLE_SERVICE_ACCOUNT_JSON` and `SHEET_ID` are used. The service account needs permission to create a sheet, protect it, and manage developer metadata. First real validated submission initializes the ledger; tests do not initialize or mutate the production spreadsheet.

Automated tests model Google uniqueness/atomicity and cover competing allocator instances, restarts, monthly/year rollover, lost acquisition/commit responses, and stuck locks. Actual live multi-instance Google API behavior has not been exercised in this workspace; perform a staging integration check before production rollout.

The background queue remains non-durable. An ID reservation surviving a crash does not imply the associated admission finished processing. A durable queue and complete PDF/Sheets content migration are separate work.
