const { mdToPdf } = require('md-to-pdf');
const path = require('path');

(async () => {
    try {
        const mdPath = path.join(__dirname, 'docs', 'Webhook_Listener_Summary.md');
        const pdfPath = path.join(__dirname, 'docs', 'Webhook_Listener_Summary.pdf');
        
        await mdToPdf({ path: mdPath }, { dest: pdfPath });
        console.log("PDF generated successfully!");
    } catch (err) {
        console.error("Error generating PDF:", err);
    }
})();
