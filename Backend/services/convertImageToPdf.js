// // Backend/services/convertImageToPdf.js
// const PDFDocument = require("pdfkit");
// const fs = require("fs");
// const path = require("path");

// /**
//  * Convert multiple images to ONE PDF
//  */
// function convertImagesToSinglePdf(imageFiles, outputPath) {
//   return new Promise((resolve, reject) => {
//     try {
//       const doc = new PDFDocument({ autoFirstPage: false });
//       const stream = fs.createWriteStream(outputPath);

//       doc.pipe(stream);

//       imageFiles.forEach(file => {
//         if (!fs.existsSync(file.path)) return;

//         const img = doc.openImage(file.path);

//         doc.addPage({
//           size: [img.width, img.height],
//           margins: { top: 0, bottom: 0, left: 0, right: 0 }
//         });

//         doc.image(img, 0, 0, {
//           width: img.width,
//           height: img.height
//         });
//       });

//       doc.end();

//       stream.on("finish", () => resolve(outputPath));
//       stream.on("error", reject);

//     } catch (err) {
//       reject(err);
//     }
//   });
// }

// module.exports = convertImagesToSinglePdf;
