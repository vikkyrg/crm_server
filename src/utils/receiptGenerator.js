const PDFDocument = require('pdfkit');
const { formatINR, numberToWordsINR } = require('./financials');

const generateAdvanceReceiptPDF = (advance, companySettings, res) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  const primaryColor = '#1e40af';
  const textColor = '#1f2937';

  // Company Header with Logo if available
  let headerStartY = 40;
  if (companySettings.companyLogo && companySettings.companyLogo.startsWith('data:image')) {
    try {
      const base64Data = companySettings.companyLogo.split(';base64,').pop();
      const imageBuffer = Buffer.from(base64Data, 'base64');
      doc.image(imageBuffer, 40, 35, { height: 35 });
      headerStartY = 75;
    } catch (e) {
      console.error('Failed to render receipt logo:', e.message);
    }
  }

  if (headerStartY === 40) {
    doc.fillColor(primaryColor).fontSize(18).text(companySettings.companyName || 'Navadurga Electricals', 40, headerStartY, { bold: true });
    doc.fillColor('#4b5563').fontSize(8.5).text(companySettings.tagline || 'Leading Edge Software & Cloud Solutions', 40, headerStartY + 22);
    doc.text(companySettings.address || '', 40, headerStartY + 34);
    doc.text(`Phone: ${companySettings.phone || ''} | Email: ${companySettings.email || ''}`, 40, headerStartY + 45);
    doc.text(`GSTIN: ${companySettings.gstin || 'N/A'} | PAN: ${companySettings.pan || 'N/A'}`, 40, headerStartY + 56);
  } else {
    doc.fillColor(primaryColor).fontSize(14).text(companySettings.companyName || 'Navadurga Electricals', 40, headerStartY, { bold: true });
    doc.fillColor('#4b5563').fontSize(8).text(`${companySettings.address || ''} | Phone: ${companySettings.phone || ''} | GSTIN: ${companySettings.gstin || 'N/A'}`, 40, headerStartY + 16, { width: 300 });
  }

  // Receipt Badge
  doc.fillColor(primaryColor).fontSize(16).text('ADVANCE PAYMENT RECEIPT', 350, 40, { align: 'right', bold: true });
  doc.fillColor(textColor).fontSize(10);
  doc.text(`Receipt No: ${advance.receiptNumber}`, 350, 65, { align: 'right' });
  doc.text(`Date: ${new Date(advance.paymentDate).toLocaleDateString('en-IN')}`, 350, 78, { align: 'right' });
  doc.text(`Status: ${advance.status}`, 350, 91, { align: 'right' });

  // Divider
  doc.moveTo(40, 125).lineTo(555, 125).strokeColor('#e5e7eb').lineWidth(1).stroke();

  // Received From Box
  const client = advance.clientSnapshot || {};
  doc.fillColor(primaryColor).fontSize(11).text('RECEIVED WITH THANKS FROM:', 40, 140, { bold: true });
  doc.fillColor(textColor).fontSize(10);
  doc.text(`Client / Company: ${client.companyName || 'N/A'}`, 40, 160);
  doc.text(`Contact Person: ${client.contactPerson || 'N/A'}`, 40, 175);
  doc.text(`Contact Phone: ${client.primaryPhone || 'N/A'}`, 40, 190);
  doc.text(`Email: ${client.email || 'N/A'}`, 40, 205);

  // Format INR for PDF without Unicode symbol corrupting to superscript 1
  const formatPDFINR = (val) => {
    const num = Number(val) || 0;
    return 'Rs. ' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Payment Details Box
  doc.rect(40, 230, 515, 120).fill('#f8fafc');
  doc.rect(40, 230, 515, 120).strokeColor('#cbd5e1').stroke();

  doc.fillColor(primaryColor).fontSize(10).text('PAYMENT DETAILS', 55, 245, { bold: true });
  doc.fillColor(textColor).fontSize(9);
  doc.text(`Amount Received:`, 55, 270);
  doc.fillColor(primaryColor).fontSize(14).text(formatPDFINR(advance.amount), 170, 267, { bold: true });

  doc.fillColor(textColor).fontSize(9);
  doc.text(`Payment Mode:`, 55, 295);
  doc.text(advance.paymentMethod || 'Bank Transfer', 170, 295, { bold: true });

  doc.text(`Transaction Reference / UTR:`, 55, 315);
  doc.text(advance.transactionReference || 'N/A', 220, 315, { bold: true });

  if (advance.associatedProject) {
    doc.text(`Associated Project:`, 55, 332);
    doc.text(advance.associatedProject, 170, 332);
  }

  // Amount in Words
  doc.fillColor('#4b5563').fontSize(9).text('AMOUNT IN WORDS:', 40, 375, { bold: true });
  doc.fillColor(textColor).fontSize(10).text(numberToWordsINR(advance.amount), 40, 390, { width: 500 });

  // Allocation status
  doc.rect(40, 430, 515, 60).fill('#f1f5f9');
  doc.fillColor(primaryColor).fontSize(9).text('ADVANCE UTILIZATION STATUS', 55, 440, { bold: true });
  doc.fillColor(textColor).fontSize(9);
  doc.text(`Total Amount: ${formatPDFINR(advance.amount)}`, 55, 460);
  doc.text(`Allocated to Invoices: ${formatPDFINR(advance.allocatedAmount)}`, 220, 460);
  doc.text(`Remaining Unallocated: ${formatPDFINR(advance.unallocatedAmount)}`, 400, 460, { bold: true });

  // Allocations breakdown if any
  if (advance.allocations && advance.allocations.length > 0) {
    doc.text('Invoice Allocations Breakdown:', 40, 510, { bold: true });
    let allocY = 530;
    advance.allocations.forEach((alloc, idx) => {
      doc.text(`${idx + 1}. Allocated ${formatPDFINR(alloc.allocatedAmount)} to Invoice #${alloc.invoiceNumber} on ${new Date(alloc.allocatedAt).toLocaleDateString('en-IN')}`, 45, allocY);
      allocY += 15;
    });
  }

  // Signatory
  const footerY = 730;
  doc.moveTo(380, footerY).lineTo(540, footerY).strokeColor('#9ca3af').stroke();
  doc.fontSize(8).fillColor('#4b5563').text(`For ${companySettings.companyName || 'Navadurga Electricals'}`, 380, footerY + 5, { align: 'center', width: 160 });
  doc.text('Authorized Signatory', 380, footerY + 18, { align: 'center', width: 160 });

  doc.end();
};

module.exports = { generateAdvanceReceiptPDF };
