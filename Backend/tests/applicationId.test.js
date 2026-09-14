const test = require("node:test");
const assert = require("node:assert/strict");
const { createApplicationIdService, HEADERS, LEDGER_TITLE, formatId, monthKey } = require("../services/applicationIdService");

// Models Sheets' external unique-metadata constraint and atomic batch commit.
// No Google credentials or network writes are used by these tests.
function fakeSheets() {
  const state = { sheets: [], rows: [], locks: new Map(), failCommit: false, loseReply: false, loseAcquireReply: false };
  const api = { spreadsheets: {
    get: async () => ({ data: { sheets: structuredClone(state.sheets) } }),
    values: { get: async () => ({ data: { values: structuredClone(state.rows) } }) },
    developerMetadata: { get: async ({ metadataId }) => {
      if (!state.locks.has(metadataId)) throw Object.assign(new Error("not found"), { code: 404 });
      return { data: structuredClone(state.locks.get(metadataId)) };
    } },
    batchUpdate: async ({ requestBody: { requests } }) => {
      await new Promise(resolve => setImmediate(resolve));
      const next = structuredClone(state);
      let commit = false; let acquire = false;
      for (const request of requests) {
        if (request.addSheet) {
          if (next.sheets.some(sheet => sheet.properties.title === request.addSheet.properties.title)) throw new Error("Sheet already exists");
          next.sheets.push({ properties: request.addSheet.properties });
        }
        if (request.updateCells) next.rows = request.updateCells.rows.map(row => row.values.map(cell => cell.userEnteredValue.stringValue));
        if (request.createDeveloperMetadata) {
          const metadata = request.createDeveloperMetadata.developerMetadata;
          if (next.locks.has(metadata.metadataId)) throw new Error("Metadata ID already exists");
          next.locks.set(metadata.metadataId, metadata); acquire = true;
        }
        if (request.appendCells) { commit = true; next.rows.push(...request.appendCells.rows.map(row => row.values.map(cell => cell.userEnteredValue.stringValue))); }
        if (request.deleteDeveloperMetadata) {
          // Lookup fields must all match; a non-matching filter deletes nothing.
          const lookup = request.deleteDeveloperMetadata.dataFilter.developerMetadataLookup;
          const lock = next.locks.get(lookup.metadataId);
          if (lock && (!lookup.metadataKey || lookup.metadataKey === lock.metadataKey) && (!lookup.metadataValue || lookup.metadataValue === lock.metadataValue)) next.locks.delete(lookup.metadataId);
        }
      }
      if (commit && state.failCommit) throw Object.assign(new Error("Commit unavailable"), state.failCommitStatus ? { response: { status: state.failCommitStatus } } : {});
      Object.assign(state, next);
      if (commit && state.loseReply) { state.loseReply = false; throw new Error("Lost commit response"); }
      if (acquire && state.loseAcquireReply) { state.loseAcquireReply = false; throw new Error("Lost acquisition response"); }
      return { data: {} };
    },
  } };
  const service = () => createApplicationIdService({ sheets: api, spreadsheetId: "test", serviceAccountEmail: "service@example.com", sleep: () => new Promise(resolve => setImmediate(resolve)), maxAttempts: 20 });
  return { state, service };
}

test("concurrent processes allocate unique sequential IDs and new instances continue after restart", async () => {
  const { state, service } = fakeSheets();
  const date = new Date("2026-09-14T12:00:00Z");
  const ids = await Promise.all(Array.from({ length: 8 }, () => service().allocate(date)));
  assert.deepEqual([...ids].sort(), Array.from({ length: 8 }, (_, i) => formatId("2026-09", i + 1)));
  assert.equal(await service().allocate(date), "SKY-GS-2026-09-0009");
  assert.equal(state.locks.size, 0);
  assert.equal(state.sheets.length, 1);
  assert.equal(state.sheets[0].properties.title, LEDGER_TITLE);
  assert.deepEqual(state.rows[0], HEADERS);
});

test("month reset uses India time, handles year rollover and allows more than four digits", async () => {
  const { service } = fakeSheets();
  assert.equal(await service().allocate(new Date("2026-09-30T18:29:59Z")), "SKY-GS-2026-09-0001");
  assert.equal(await service().allocate(new Date("2026-09-30T18:30:00Z")), "SKY-GS-2026-10-0001");
  assert.equal(await service().allocate(new Date("2026-12-31T18:30:00Z")), "SKY-GS-2027-01-0001");
  assert.equal(monthKey(new Date("2026-09-14T00:00:00Z")), "2026-09");
  assert.equal(formatId("2026-09", 10000), "SKY-GS-2026-09-10000");
});

test("lost success responses recover the same reservation without allocating twice", async () => {
  const { state, service } = fakeSheets();
  state.loseAcquireReply = true; state.loseReply = true;
  const now = new Date("2026-09-14T00:00:00Z");
  assert.equal(await service().allocate(now), "SKY-GS-2026-09-0001");
  assert.equal(state.rows.length, 2);
  assert.equal(await service().allocate(now), "SKY-GS-2026-09-0002");
});

test("unconfirmed commits retain the durable lock and a restart cannot steal it", async () => {
  const { state, service } = fakeSheets();
  state.failCommit = true;
  const now = new Date("2026-09-14T00:00:00Z");
  await assert.rejects(service().allocate(now), error => error.status === 503);
  assert.equal(state.locks.size, 1);
  state.failCommit = false;
  await assert.rejects(service().allocate(now), /busy or locked/);
  assert.equal(state.rows.length, 1);
});

test("corrupted ledger fails closed before allocation", async () => {
  const { state, service } = fakeSheets();
  const now = new Date("2026-09-14T00:00:00Z");
  await service().allocate(now);
  state.rows[1][2] = "corrupted-id";
  await assert.rejects(service().allocate(now), /inconsistent/);
  assert.equal(state.locks.size, 0);
});

test("a definite 4xx commit rejection releases the lock without consuming a sequence", async () => {
  const { state, service } = fakeSheets();
  const now = new Date("2026-09-14T00:00:00Z");
  state.failCommit = true; state.failCommitStatus = 429;
  await assert.rejects(service().allocate(now), error => error.status === 503);
  assert.equal(state.locks.size, 0);
  state.failCommit = false;
  assert.equal(await service().allocate(now), "SKY-GS-2026-09-0001");
});

test("administrator release requires the current owner token and allocation then continues", async () => {
  const { state, service } = fakeSheets();
  const now = new Date("2026-09-14T00:00:00Z");
  assert.equal(await service().allocate(now), "SKY-GS-2026-09-0001");
  state.failCommit = true;
  await assert.rejects(service().allocate(now));
  state.failCommit = false;
  const admin = service();
  const lock = await admin.inspectLock("2026-09");
  assert.equal(lock.reservedApplicationId, null);
  assert.equal(await admin.inspectLock("2026-10"), null);
  await assert.rejects(admin.releaseLock("2026-09", "wrong-token"), /does not match/);
  assert.equal(state.locks.size, 1);
  await admin.releaseLock("2026-09", lock.token);
  assert.equal(state.locks.size, 0);
  assert.equal(await service().allocate(now), "SKY-GS-2026-09-0002");
});
