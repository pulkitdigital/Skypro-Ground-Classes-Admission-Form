const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createQueue } = require("../services/queueService");
const { createUploadDirectory } = require("../services/uploadService");

test("queue retains uploads across retries and removes original/generated files on success or exhaustion", async () => {
  for (const permanentlyFails of [false, true]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-queue-test-"));
    try {
      const dir = await createUploadDirectory(root);
      const original = path.join(dir, "original.jpg"); await fs.writeFile(original, "test");
      let attempts = 0; let emails = 0;
      const queue = createQueue({
        retryDelay: () => 1,
        generatePDF: async (data, files, directory, options) => { await fs.access(original); const pdf = path.join(dir, options.audience + ".pdf"); await fs.writeFile(pdf, "test"); return pdf; },
        sendAdminEmail: async () => { emails++; },
        appendAdmissionRow: async () => { attempts++; await fs.access(original); if (permanentlyFails || attempts < 2) throw new Error("Test retry"); },
      });
      const jobId = queue.addJob({ formData: { fullName: "Test Applicant", submittedAt: new Date().toISOString() }, uploadedFiles: [{ fieldname: "photo", path: original }], uploadRoot: root, uploadDir: dir });
      const status = queue.getQueueStatus();
      assert.deepEqual(status, { queueLength: 1, isProcessing: false, statusCounts: { pending: 1 } });
      assert.equal(/Test Applicant|job-/.test(JSON.stringify(status)) || JSON.stringify(status).includes(jobId), false, "public status has no applicant data or job IDs");
      const deadline = Date.now() + 3000;
      while (queue.getQueueStatus().queueLength && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(queue.getQueueStatus().queueLength, 0);
      assert.equal(attempts, permanentlyFails ? 3 : 2);
      assert.equal(emails, 1, "a completed email stage is not repeated when Sheets fails");
      assert.deepEqual(await fs.readdir(root), []);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
});
