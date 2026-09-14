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
      for (const audience of ["admin", "student"]) {
        const target = path.join(outputDirectory, `${name}-${audience}.pdf`);
        await fs.copyFile(await generatePDF(form, files, scenarioDirectory, { audience }), target);
        const pages = (await PDFDocument.load(await fs.readFile(target))).getPageCount();
        console.log(`${audience.padEnd(7)} ${name}: ${pages} pages -> ${path.relative(__dirname, target)}`);
      }
    }
  } finally {
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

run().catch(error => { console.error("Sample PDF generation failed:", error); process.exitCode = 1; });
