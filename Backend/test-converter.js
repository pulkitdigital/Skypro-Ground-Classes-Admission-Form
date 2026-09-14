const convertImageToPdf = require('./convertImageToPdf');
const path = require('path');

// Test conversion
const testImage = path.join(__dirname, 'uploads', 'document.png');
const outputPdf = path.join(__dirname, 'uploads', 'test-output.pdf');

convertImageToPdf(testImage, outputPdf)
  .then(pdfPath => {
    console.log('✅ SUCCESS! PDF created at:', pdfPath);
  })
  .catch(error => {
    console.error('❌ FAILED:', error.message);
  });