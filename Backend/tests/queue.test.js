const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createQueue } = require("../services/queueService");
const { createUploadDirectory } = require("../services/uploadService");

const pdfKey = options => options.part ? `${options.copyType}-${options.part}` : options.copyType;
async function drain(queue) {
  const deadline = Date.now() + 3000;
  while (queue.getQueueStatus().queueLength && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(queue.getQueueStatus().queueLength, 0);
}

test("queue retains uploads across retries and removes original/generated files on success or exhaustion", async () => {
  for (const permanentlyFails of [false, true]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-queue-test-"));
    try {
      const dir = await createUploadDirectory(root);
      const original = path.join(dir, "original.jpg"); await fs.writeFile(original, "test");
      let attempts = 0; let emails = 0; const generated = [];
      const queue = createQueue({
        retryDelay: () => 1,
        generatePDF: async (data, files, directory, options) => { generated.push(pdfKey(options)); await fs.access(original); const pdf = path.join(dir, pdfKey(options) + ".pdf"); await fs.writeFile(pdf, "test"); return pdf; },
        sendAdminEmail: async ({ adminFormPdfPath, adminDocumentsPdfPath, studentPdfPath }) => {
          assert.equal(new Set([adminFormPdfPath, adminDocumentsPdfPath, studentPdfPath]).size, 3);
          for (const pdf of [adminFormPdfPath, adminDocumentsPdfPath, studentPdfPath]) await fs.access(pdf);
          emails++;
        },
        appendAdmissionRow: async () => { attempts++; await fs.access(original); if (permanentlyFails || attempts < 2) throw new Error("Test retry"); },
      });
      const jobId = queue.addJob({ formData: { fullName: "Test Applicant", submittedAt: new Date().toISOString() }, uploadedFiles: [{ fieldname: "photo", path: original }], uploadRoot: root, uploadDir: dir });
      const status = queue.getQueueStatus();
      assert.deepEqual(status, { queueLength: 1, isProcessing: false, statusCounts: { pending: 1 } });
      assert.equal(/Test Applicant|job-/.test(JSON.stringify(status)) || JSON.stringify(status).includes(jobId), false, "public status has no applicant data or job IDs");
      await drain(queue);
      assert.equal(attempts, permanentlyFails ? 3 : 2);
      assert.deepEqual(generated, ["admin-form", "admin-documents", "student"]);
      assert.equal(emails, 1, "a completed email stage is not repeated when Sheets fails");
      assert.deepEqual(await fs.readdir(root), []);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
});

test("a retry regenerates only the missing admin PDF and cleanup removes both admin files", async () => {
  for (const missing of ["admin-form", "admin-documents"]) {
    for (const permanentlyFails of [false, true]) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-admin-retry-test-"));
      try {
        const dir = await createUploadDirectory(root);
        const generated = []; const seen = []; let sends = 0;
        const queue = createQueue({
          retryDelay: () => 1,
          generatePDF: async (data, files, directory, options) => { generated.push(pdfKey(options)); const pdf = path.join(directory, pdfKey(options) + ".pdf"); await fs.writeFile(pdf, "test"); return pdf; },
          sendAdminEmail: async ({ adminFormPdfPath, adminDocumentsPdfPath }) => {
            sends++;
            seen.push(...(await fs.readdir(dir)));
            await fs.access(adminFormPdfPath); await fs.access(adminDocumentsPdfPath);
            if (sends === 1) { await fs.rm(path.join(dir, `${missing}.pdf`)); throw new Error("Brevo unavailable"); }
            if (permanentlyFails) throw new Error("Brevo unavailable");
          },
          appendAdmissionRow: async () => {},
        });
        queue.addJob({ formData: {}, uploadedFiles: [], uploadRoot: root, uploadDir: dir });
        await drain(queue);
        assert.deepEqual(generated.slice(0, 3), ["admin-form", "admin-documents", "student"]);
        assert.deepEqual(generated.slice(3), [missing], "only the missing admin PDF is regenerated");
        assert.ok(seen.includes("admin-form.pdf") && seen.includes("admin-documents.pdf"), "both admin PDFs are written to the job directory");
        assert.equal(sends, permanentlyFails ? 3 : 2);
        assert.deepEqual(await fs.readdir(root), [], "both admin PDFs are cleaned with the job directory");
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    }
  }
});

test("an admin Documents PDF that could not be produced is not retried and is passed to email as null", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-no-documents-test-"));
  try {
    const dir = await createUploadDirectory(root);
    const generated = []; const received = []; let sends = 0;
    const queue = createQueue({
      retryDelay: () => 1,
      generatePDF: async (data, files, directory, options) => {
        generated.push(pdfKey(options));
        if (options.part === "documents") return null;
        const pdf = path.join(directory, pdfKey(options) + ".pdf"); await fs.writeFile(pdf, "test"); return pdf;
      },
      sendAdminEmail: async ({ adminDocumentsPdfPath }) => { received.push(adminDocumentsPdfPath); if (++sends === 1) throw new Error("Brevo unavailable"); },
      appendAdmissionRow: async () => {},
    });
    queue.addJob({ formData: {}, uploadedFiles: [], uploadRoot: root, uploadDir: dir });
    await drain(queue);
    assert.deepEqual(generated, ["admin-form", "admin-documents", "student"]);
    assert.deepEqual(received, [null, null]);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("student PDF failures retain the admin copy and clean partial files on exhaustion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-partial-test-"));
  try {
    const dir = await createUploadDirectory(root);
    const adminCalls = { form: 0, documents: 0 }; let studentCalls = 0; let emails = 0;
    const queue = createQueue({
      retryDelay: () => 1,
      generatePDF: async (data, files, directory, options) => {
        const target = path.join(directory, `${pdfKey(options)}.pdf`);
        await fs.writeFile(target, "partial");
        if (options.copyType === "student") { studentCalls++; throw new Error("Student PDF render failed"); }
        adminCalls[options.part]++; return target;
      },
      sendAdminEmail: async () => { emails++; }, appendAdmissionRow: async () => {},
    });
    queue.addJob({ formData: {}, uploadedFiles: [], uploadRoot: root, uploadDir: dir });
    await drain(queue);
    assert.deepEqual(adminCalls, { form: 1, documents: 1 }); assert.equal(studentCalls, 3); assert.equal(emails, 0);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
