// Generates sample Ground School admission PDFs from fictional fixtures into tmp/pdfs.
// Usage: node test-pdf.js
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const generatePDF = require("./services/pdfGenerator");
const { SCENARIOS, sampleAdmission } = require("./tests/pdfFixtures");

async function run() {
  const outputDirectory = path.join(__dirname, "tmp", "pdfs");
  await fs.mkdir(outputDirectory, { recursive: true });
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "skypro-sample-pdf-"));
  try {
    for (const name of Object.keys(SCENARIOS)) {
      const scenarioDirectory = path.join(workDirectory, name);
      await fs.mkdir(scenarioDirectory);
      const { form, files } = await sampleAdmission(name, scenarioDirectory);
      // Admin receives a Form PDF and a Documents PDF; the student receives one combined copy.
      for (const [label, options] of [["admin-form", { copyType: "admin", part: "form" }], ["admin-documents", { copyType: "admin", part: "documents" }], ["student", { copyType: "student" }]]) {
        const source = await generatePDF(form, files, scenarioDirectory, options);
        if (!source) { console.log(`${label.padEnd(15)} ${name}: not generated (no document could be appended)`); continue; }
        const target = path.join(outputDirectory, `${name}-${label}.pdf`);
        await fs.copyFile(source, target);
        const pages = (await PDFDocument.load(await fs.readFile(target))).getPageCount();
        console.log(`${label.padEnd(15)} ${name}: ${pages} pages -> ${path.relative(__dirname, target)}`);
      }
    }
  } finally {
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

run().catch(error => { console.error("Sample PDF generation failed:", error); process.exitCode = 1; });
