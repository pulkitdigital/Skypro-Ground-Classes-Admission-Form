const { randomUUID, randomInt } = require("node:crypto");

const LEDGER_TITLE = "GroundSchoolApplicationIDs";
const HEADERS = ["Month", "Sequence", "Application ID", "Allocation token", "Reserved at"];
const LOCK_KEY = "skypro.gs.monthly-allocation-lock";
const API_OPTIONS = { timeout: 15000, retry: false };
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthKey = date => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(date).slice(0, 7);
const formatId = (month, sequence) => `SKY-GS-${month}-${String(sequence).padStart(4, "0")}`;
const lockId = month => 1_000_000_000 + Number(month.replace("-", ""));
// Only delete the lock whose exact owner value this caller holds.
const releaseOwnLock = (metadataId, metadataValue) => ({ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId, metadataKey: LOCK_KEY, metadataValue } } } });
// A received 4xx (except 408) means Sheets rejected the whole atomic batch.
// Timeouts, network errors and 5xx responses remain ambiguous.
const definitelyRejected = error => { const status = Number(error.response?.status ?? error.code); return status >= 400 && status < 500 && status !== 408; };

class AllocationError extends Error {
  constructor(message) { super(message); this.status = 503; }
}

function createApplicationIdService({ sheets, spreadsheetId, serviceAccountEmail, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxAttempts = 8 }) {
  const getSheets = async () => (await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }, API_OPTIONS)).data.sheets || [];
  async function ensureLedger() {
    const find = list => list.find(sheet => sheet.properties.title === LEDGER_TITLE)?.properties;
    let ledger = find(await getSheets());
    if (ledger) return ledger.sheetId;
    if (!serviceAccountEmail) throw new AllocationError("Allocation ledger service-account editor is not configured");
    const sheetId = randomInt(1, 1_000_000_000);
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
        { addSheet: { properties: { sheetId, title: LEDGER_TITLE, gridProperties: { rowCount: 1000, columnCount: 5, frozenRowCount: 1 } } } },
        { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: HEADERS.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
        { addProtectedRange: { protectedRange: { range: { sheetId }, description: "Allocation ledger: never delete, reorder, clear, or manually edit reservations", warningOnly: false, editors: { users: [serviceAccountEmail] } } } },
      ] } }, API_OPTIONS);
      return sheetId;
    } catch (error) {
      // Another process may have created the same tab, or our reply was lost.
      ledger = find(await getSheets());
      if (ledger) return ledger.sheetId;
      throw error;
    }
  }

  async function readLedger() {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${LEDGER_TITLE}'!A:E`, valueRenderOption: "UNFORMATTED_VALUE" }, API_OPTIONS)).data.values || [];
    if (JSON.stringify(rows[0]) !== JSON.stringify(HEADERS)) throw new AllocationError("Allocation ledger header is missing or changed; administrator reconciliation required");
    const ids = new Set();
    const tokens = new Set();
    return rows.slice(1).map(row => {
      const [month, rawSequence, applicationId, token, reservedAt] = row;
      const sequence = Number(rawSequence);
      if (!MONTH_PATTERN.test(month) || !Number.isSafeInteger(sequence) || sequence < 1 || applicationId !== formatId(month, sequence) || !token || !reservedAt || ids.has(applicationId) || tokens.has(token)) {
        throw new AllocationError("Allocation ledger is inconsistent; administrator reconciliation required");
      }
      ids.add(applicationId); tokens.add(token);
      return { month, sequence, applicationId, token };
    });
  }

  async function getLock(metadataId) {
    try { return (await sheets.spreadsheets.developerMetadata.get({ spreadsheetId, metadataId }, API_OPTIONS)).data; }
    catch (error) { if (Number(error.code || error.response?.status) === 404) return null; throw error; }
  }

  async function allocate(now = new Date()) {
    const month = monthKey(now);
    if (!MONTH_PATTERN.test(month)) throw new AllocationError("Invalid allocation month");
    const metadataId = lockId(month);
    const token = randomUUID();
    const metadataValue = JSON.stringify({ month, token, createdAt: now.toISOString() });
    const ledgerSheetId = await ensureLedger();
    let acquired = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ createDeveloperMetadata: { developerMetadata: {
          metadataId, metadataKey: LOCK_KEY, metadataValue, visibility: "DOCUMENT", location: { spreadsheet: true },
        } } }] } }, API_OPTIONS);
        acquired = true; break;
      } catch (error) {
        const lock = await getLock(metadataId);
        if (lock?.metadataKey === LOCK_KEY && lock.metadataValue === metadataValue) { acquired = true; break; }
        if (!lock) throw error;
        if (lock.metadataKey !== LOCK_KEY) throw new AllocationError("Allocation lock ID is occupied by unrelated metadata");
        if (attempt + 1 < maxAttempts) await sleep(500 + randomInt(0, 250));
      }
    }
    if (!acquired) throw new AllocationError("Monthly allocation is busy or locked; retry later or ask an administrator to reconcile the lock");
    const deleteLock = releaseOwnLock(metadataId, metadataValue);
    let commitUncertain = false;
    try {
      const records = await readLedger();
      const sequence = records.filter(row => row.month === month).reduce((max, row) => Math.max(max, row.sequence), 0) + 1;
      if (!Number.isSafeInteger(sequence)) throw new AllocationError("Monthly sequence capacity exceeded");
      const applicationId = formatId(month, sequence);
      const row = [month, String(sequence), applicationId, token, now.toISOString()];
      commitUncertain = true;
      try {
        // The reservation and lock release succeed together or not at all.
        await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [
          { appendCells: { sheetId: ledgerSheetId, rows: [{ values: row.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: "userEnteredValue" } },
          deleteLock,
        ] } }, API_OPTIONS);
      } catch (error) {
        // Never re-append on an ambiguous network outcome. Recover only a
        // confirmed reservation with this backend-generated allocation token.
        const confirmed = (await readLedger()).find(record => record.token === token);
        if (confirmed?.applicationId === applicationId) return applicationId;
        if (definitelyRejected(error)) commitUncertain = false;
        throw error;
      }
      return applicationId;
    } catch (error) {
      if (!commitUncertain) {
        try { await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [deleteLock] } }, API_OPTIONS); }
        catch (releaseError) { console.error(`Application ID lock release failed for ${month}; administrator reconciliation required:`, releaseError.message); }
      }
      // An uncertain commit intentionally retains any remaining lock. Never
      // expire/steal it automatically: a delayed writer could still commit.
      throw new AllocationError(`Application ID allocation stopped: ${error.message}`);
    }
  }

  // Administrator recovery only. Callers must stop all backend instances first.
  async function inspectLock(month) {
    if (!MONTH_PATTERN.test(month)) throw new AllocationError("Month must be YYYY-MM");
    const lock = await getLock(lockId(month));
    if (!lock) return null;
    if (lock.metadataKey !== LOCK_KEY) throw new AllocationError("Allocation lock ID is occupied by unrelated metadata");
    let owner = {};
    try { owner = JSON.parse(lock.metadataValue); } catch { /* Reported as unreadable below. */ }
    const reserved = owner.token ? (await readLedger()).find(record => record.token === owner.token) : undefined;
    return { month, token: owner.token || null, createdAt: owner.createdAt || null, reservedApplicationId: reserved?.applicationId || null, metadataValue: lock.metadataValue };
  }

  async function releaseLock(month, token) {
    const lock = await inspectLock(month);
    if (!lock) throw new AllocationError(`No allocation lock exists for ${month}`);
    if (!token || lock.token !== token) throw new AllocationError("Lock owner token does not match; inspect the lock again before releasing");
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [releaseOwnLock(lockId(month), lock.metadataValue)] } }, API_OPTIONS);
    return lock;
  }
  return { allocate, inspectLock, releaseLock };
}

function defaultService() {
  const { sheets, serviceAccountEmail } = require("./googleService");
  return createApplicationIdService({ sheets, spreadsheetId: process.env.SHEET_ID, serviceAccountEmail });
}
const allocateApplicationId = now => defaultService().allocate(now);
module.exports = { createApplicationIdService, allocateApplicationId, defaultService, AllocationError, LEDGER_TITLE, HEADERS, LOCK_KEY, monthKey, formatId };
