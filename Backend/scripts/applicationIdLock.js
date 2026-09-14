// Administrator recovery for a stuck monthly Application ID lock.
// See APPLICATION_IDS.md before using "release".
//   node scripts/applicationIdLock.js status YYYY-MM
//   node scripts/applicationIdLock.js release YYYY-MM <token> --all-instances-stopped
require("dotenv").config();
const { defaultService } = require("../services/applicationIdService");

async function main([command, month, token, confirmation]) {
  const service = defaultService();
  if (command === "status" && month) {
    const lock = await service.inspectLock(month);
    console.log(lock ? JSON.stringify(lock, null, 2) : `No allocation lock exists for ${month}`);
    return;
  }
  if (command === "release" && month && token) {
    if (confirmation !== "--all-instances-stopped") throw new Error("Stop and drain every backend instance, then repeat with --all-instances-stopped");
    const lock = await service.releaseLock(month, token);
    console.log(`Released ${month} lock owned by ${lock.token}${lock.reservedApplicationId ? ` (reservation ${lock.reservedApplicationId} already recorded)` : ""}`);
    return;
  }
  throw new Error("Usage: status YYYY-MM | release YYYY-MM <token> --all-instances-stopped");
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
