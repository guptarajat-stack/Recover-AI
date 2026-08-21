const { mdToPdf } = require('md-to-pdf');
const path = require('path');

(async () => {
    try {
        const mdPath = process.argv[2] || path.join(__dirname, 'docs', 'Root_Cause_Classifier_Summary.md');
        const pdfPath = process.argv[3] || path.join(__dirname, 'docs', 'Root_Cause_Classifier_Summary.pdf');
        
        await mdToPdf({ path: mdPath }, { dest: pdfPath });
        console.log("PDF generated successfully!");
    } catch (err) {
        console.error("Error generating PDF:", err);
    }
})();
