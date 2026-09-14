const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { cleanupUploadDirectory } = require("./uploadService");
const { admissionRow } = require("./admissionSheet");

function createQueue({ generatePDF, sendAdminEmail, appendAdmissionRow, cleanup = cleanupUploadDirectory, retryDelay = attempt => attempt * 5000 }) {
  const jobs = [];
  let isProcessing = false;

  async function processJob(job) {
    const { formData, uploadedFiles, uploadDir } = job.data;
    for (const copyType of ["admin", "student"]) {
      const key = `${copyType}PdfPath`;
      if (!job[key] || !fs.existsSync(job[key])) {
        job[key] = await generatePDF(formData, uploadedFiles, uploadDir, { copyType });
        if (!job[key] || !fs.existsSync(job[key])) throw new Error(`${copyType} PDF generation failed - file not created`);
      }
    }
    // Retain completed stages during retries (an ambiguous external timeout may
    // still duplicate delivery; durable idempotency is outside this memory queue).
    if (!job.emailSent) {
      await sendAdminEmail({ formData, adminPdfPath: job.adminPdfPath, studentPdfPath: job.studentPdfPath, delivered: (job.emailDelivered ||= {}) });
      job.emailSent = true;
    }
    if (!job.sheetWritten) {
      await appendAdmissionRow(admissionRow(formData, uploadedFiles));
      job.sheetWritten = true;
    }
  }

  async function finish(job) {
    try { await cleanup(job.data.uploadRoot, job.data.uploadDir); }
    catch (error) { console.error(`Cleanup failed for ${job.id}:`, error.message); }
  }

  async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;
    try {
      while (jobs.length) {
        const job = jobs[0];
        job.status = "processing";
        job.attempts++;
        try {
          await processJob(job);
          job.status = "completed";
          await finish(job);
          jobs.shift();
        } catch (error) {
          console.error(`Failed ${job.id} (attempt ${job.attempts}):`, error.message);
          if (job.attempts < 3) {
            job.status = "retrying";
            jobs.push(jobs.shift());
            await new Promise(resolve => setTimeout(resolve, retryDelay(job.attempts)));
          } else {
            job.status = "failed";
            await finish(job);
            jobs.shift();
          }
        }
      }
    } finally { isProcessing = false; }
  }

  function addJob(data) {
    if (!data.formData || !Array.isArray(data.uploadedFiles) || !data.uploadDir || !data.uploadRoot) throw new Error("Invalid queue job");
    const id = `job-${randomUUID()}`;
    jobs.push({ id, data, status: "pending", createdAt: new Date(), attempts: 0 });
    setImmediate(processQueue);
    return id;
  }

  // Served by an unauthenticated endpoint: aggregate counts only, never applicant data or job IDs.
  function getQueueStatus() {
    const statusCounts = {};
    jobs.forEach(job => { statusCounts[job.status] = (statusCounts[job.status] || 0) + 1; });
    return { queueLength: jobs.length, isProcessing, statusCounts };
  }
  return { addJob, getQueueStatus };
}

let queue;
function defaultQueue() {
  if (!queue) queue = createQueue({
    generatePDF: require("./pdfGenerator"),
    sendAdminEmail: require("./emailService"),
    appendAdmissionRow: require("./admissionSheet").appendAdmissionRow,
  });
  return queue;
}
module.exports = { createQueue, addJob: data => defaultQueue().addJob(data), getQueueStatus: () => queue ? queue.getQueueStatus() : { queueLength: 0, isProcessing: false, statusCounts: {} } };
