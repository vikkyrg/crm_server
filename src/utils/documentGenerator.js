const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle } = require('docx');
const { formatINR, numberToWordsINR } = require('./financials');

/**
 * Builds standard PDF stream for Navadurga PF Documents and Invoices
 */
const generateDocumentPDF = (docData, docType = 'INVOICE', companySettings, res) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  // Stream directly to response
  doc.pipe(res);

  const isInvoice = docType === 'INVOICE';
  const docTitle = isInvoice ? 'TAX INVOICE' : 'PROFORMA / PF DOCUMENT';
  const docNumber = isInvoice ? docData.invoiceNumber : docData.pfNumber;
  const docDate = new Date(isInvoice ? docData.invoiceDate : docData.documentDate).toLocaleDateString('en-IN');
  const dueDate = isInvoice && docData.dueDate ? new Date(docData.dueDate).toLocaleDateString('en-IN') : null;

  // Header Colors & Fonts
  const primaryColor = '#1e40af'; // Blue 800
  const textColor = '#1f2937';
  const lightGray = '#f3f4f6';

  // Company Header with Logo if available
  let headerStartY = 40;
  if (companySettings.companyLogo && companySettings.companyLogo.startsWith('data:image')) {
    try {
      const base64Data = companySettings.companyLogo.split(';base64,').pop();
      const imageBuffer = Buffer.from(base64Data, 'base64');
      doc.image(imageBuffer, 40, 35, { height: 35 });
      headerStartY = 75;
    } catch (e) {
      console.error('Failed to render PDF logo:', e.message);
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

  // Document Title & Metadata Block (Right aligned, calculated dynamically)
  const metaBoxX = 330;
  const metaBoxWidth = 225;
  const titleDisplay = isInvoice
    ? (docData.invoiceType === 'Material' ? 'MATERIAL TAX INVOICE' : 'TAX INVOICE')
    : 'PROFORMA INVOICE';
  doc.font('Helvetica-Bold').fontSize(15).fillColor(primaryColor).text(titleDisplay, metaBoxX, 35, { width: metaBoxWidth, align: 'right' });
  
  // Calculate Y after title to ensure zero overlap with document metadata
  const titleHeight = doc.heightOfString(titleDisplay, { width: metaBoxWidth, font: 'Helvetica-Bold', size: 15 });
  let metaY = 35 + titleHeight + 8;

  doc.font('Helvetica').fontSize(9).fillColor(textColor);
  doc.font('Helvetica-Bold').text(`${isInvoice ? 'Invoice No:' : 'PF No:'} ${docNumber}`, metaBoxX, metaY, { width: metaBoxWidth, align: 'right' });
  metaY += 14;
  doc.font('Helvetica').text(`Date: ${docDate}`, metaBoxX, metaY, { width: metaBoxWidth, align: 'right' });
  metaY += 13;
  if (dueDate) {
    doc.text(`Due Date: ${dueDate}`, metaBoxX, metaY, { width: metaBoxWidth, align: 'right' });
    metaY += 13;
  }
  doc.text(`Status: ${docData.status}`, metaBoxX, metaY, { width: metaBoxWidth, align: 'right' });
  metaY += 16;
  if (isInvoice && docData.paymentStatus) {
    doc.text(`Payment: ${docData.paymentStatus}`, metaBoxX, metaY, { width: metaBoxWidth, align: 'right' });
    metaY += 13;
  }

  // Divider placed safely below both company info and metadata block
  const dividerY = Math.max(125, metaY);
  doc.moveTo(40, dividerY).lineTo(555, dividerY).strokeColor('#e5e7eb').lineWidth(1).stroke();

  // Billed To Box
  const client = docData.clientSnapshot || {};
  doc.fillColor(primaryColor).fontSize(11).text('BILLED TO / CLIENT DETAILS', 40, 135, { bold: true });
  doc.fillColor(textColor).fontSize(9);
  doc.text(`Company: ${client.companyName || 'N/A'}`, 40, 150);
  doc.text(`Attention: ${client.contactPerson || 'N/A'}`, 40, 163);
  doc.text(`Phone: ${client.primaryPhone || 'N/A'} | Email: ${client.email || 'N/A'}`, 40, 176);
  doc.text(`Address: ${client.billingAddress || ''}, ${client.city || ''}, ${client.state || ''} - ${client.pincode || ''}`, 40, 189);
  doc.text(`Client GSTIN: ${client.gstin || 'Unregistered / Not Provided'}`, 40, 202);
  if (isInvoice && docData.projectOrWorkOrder) {
    doc.text(`Project / Work Order: ${docData.projectOrWorkOrder}`, 40, 215, { width: 500 });
  }

  // Table Header
  let tableY = isInvoice && docData.projectOrWorkOrder ? 240 : 225;
  doc.rect(40, tableY, 515, 22).fill('#2563eb');
  doc.fillColor('#ffffff').fontSize(8);
  doc.text('SR', 45, tableY + 6, { width: 20 });
  doc.text('SERVICE / ITEM', 70, tableY + 6, { width: 170 });
  doc.text('PRICE', 245, tableY + 6, { width: 45, align: 'right' });
  doc.text('QTY', 295, tableY + 6, { width: 30, align: 'right' });
  doc.text('TAXABLE', 330, tableY + 6, { width: 55, align: 'right' });
  doc.text('GST %', 390, tableY + 6, { width: 35, align: 'right' });
  doc.text('TAX', 430, tableY + 6, { width: 45, align: 'right' });
  doc.text('TOTAL', 480, tableY + 6, { width: 70, align: 'right' });

  tableY += 22;
  doc.fillColor(textColor);

  // Table Items
  (docData.items || []).forEach((item, index) => {
    if (tableY > 680) {
      doc.addPage();
      tableY = 40;
    }

    const rowBg = index % 2 === 0 ? '#ffffff' : '#f9fafb';
    doc.rect(40, tableY, 515, 20).fill(rowBg);
    doc.fillColor(textColor).fontSize(8);

    doc.text(`${index + 1}`, 45, tableY + 5, { width: 20 });
    const itemReference = item.itemCode || item.serviceId;
    doc.text(`${item.description}${itemReference ? ` (${itemReference})` : ''}`, 70, tableY + 5, { width: 170 });
    doc.text(Number(item.unitPrice).toFixed(2), 245, tableY + 5, { width: 45, align: 'right' });
    doc.text(`${item.quantity} ${item.unit || ''}`, 295, tableY + 5, { width: 30, align: 'right' });
    doc.text(Number(item.taxableAmount).toFixed(2), 330, tableY + 5, { width: 55, align: 'right' });
    doc.text(`${item.taxRate}%`, 390, tableY + 5, { width: 35, align: 'right' });
    doc.text(Number(item.totalTax).toFixed(2), 430, tableY + 5, { width: 45, align: 'right' });
    doc.text(Number(item.lineTotal).toFixed(2), 480, tableY + 5, { width: 70, align: 'right' });

    tableY += 20;
  });

  tableY += 10;
  doc.moveTo(40, tableY).lineTo(555, tableY).strokeColor('#e5e7eb').stroke();
  tableY += 10;

  // Amount in words
  const words = numberToWordsINR(docData.grandTotal);
  doc.fontSize(8).fillColor('#4b5563').text('AMOUNT IN WORDS:', 40, tableY, { bold: true });
  doc.fillColor(textColor).text(words, 40, tableY + 12, { width: 300 });

  // Bank Details in a structured, neat table format
  const bankBoxY = tableY + 36;
  const bankBoxWidth = 300;
  const bankBoxHeight = 84;
  
  // Table Card Container
  doc.rect(40, bankBoxY, bankBoxWidth, bankBoxHeight).fillAndStroke('#f8fafc', '#cbd5e1');

  // Table Card Header
  doc.rect(40, bankBoxY, bankBoxWidth, 18).fill('#e2e8f0');
  doc.fontSize(7.5).fillColor(primaryColor).font('Helvetica-Bold')
     .text('BANK DETAILS & PAYMENT INSTRUCTIONS', 48, bankBoxY + 5);

  // Table Content Rows
  const renderBankRow = (label1, val1, label2, val2, yOffset) => {
    const rowY = bankBoxY + yOffset;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#4b5563').text(label1, 48, rowY, { width: 45 });
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor).text(val1 || 'N/A', 95, rowY, { width: 95 });
    if (label2) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#4b5563').text(label2, 192, rowY, { width: 45 });
      doc.font('Helvetica').fontSize(7.5).fillColor(textColor).text(val2 || 'N/A', 238, rowY, { width: 98 });
    }
  };

  renderBankRow('Bank:', companySettings.bankName, 'A/C No:', companySettings.accountNumber, 24);
  renderBankRow('IFSC:', companySettings.ifscCode, 'Branch:', companySettings.branch, 44);
  renderBankRow('UPI ID:', companySettings.upiId, null, null, 64);

  // PDF Currency Formatter: avoid Unicode ₹ symbol which Helvetica renders as superscript ¹
  const formatPDFINR = (val) => {
    const num = Number(val) || 0;
    return 'Rs. ' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Summary Totals Box on Right
  const summaryX = 350;
  let summaryY = tableY;
  const renderSummaryRow = (label, val, bold = false) => {
    doc.fontSize(8.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? primaryColor : textColor).text(label, summaryX, summaryY);
    doc.text(formatPDFINR(val), summaryX + 85, summaryY, { width: 120, align: 'right' });
    summaryY += 15;
  };

  if (isInvoice) {
    // Tax Invoices show complete statutory GST breakdown
    renderSummaryRow('Subtotal (Gross):', docData.subtotal);
    if (docData.totalItemDiscounts > 0) {
      renderSummaryRow('Item Discounts:', -docData.totalItemDiscounts);
    }
    if (docData.documentDiscount > 0) {
      renderSummaryRow('Document Discount:', -docData.documentDiscount);
    }
    renderSummaryRow('Taxable Amount:', docData.totalTaxableAmount);
    if (docData.cgstTotal > 0 || docData.sgstTotal > 0) {
      renderSummaryRow('CGST:', docData.cgstTotal);
      renderSummaryRow('SGST:', docData.sgstTotal);
    }
    if (docData.igstTotal > 0) {
      renderSummaryRow('IGST:', docData.igstTotal);
    }
    if (docData.roundOffAdjustment) {
      renderSummaryRow('Round Off:', docData.roundOffAdjustment);
    }
  } else {
    // For PF (Proforma) Documents: per user requirement, omit Gross Subtotal, Taxable Amount, CGST, SGST
    if (docData.documentDiscount > 0) {
      renderSummaryRow('Document Discount:', -docData.documentDiscount);
    }
  }

  summaryY += 4;
  doc.rect(summaryX - 5, summaryY, 210, 24).fill('#eff6ff');
  doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(isInvoice ? 'Grand Total:' : 'Total Amount:', summaryX, summaryY + 7);
  doc.text(formatPDFINR(docData.grandTotal), summaryX + 80, summaryY + 7, { width: 120, align: 'right' });

  if (isInvoice) {
    summaryY += 28;
    renderSummaryRow('Amount Paid:', docData.amountPaid || 0);
    renderSummaryRow('Outstanding Balance:', docData.outstandingBalance || 0, true);
  }

  // Footer / Signature
  const footerY = 730;
  doc.moveTo(380, footerY).lineTo(540, footerY).strokeColor('#9ca3af').stroke();
  doc.fontSize(8).fillColor('#4b5563').text(`For ${companySettings.companyName || 'Navadurga Electricals'}`, 380, footerY + 5, { align: 'center', width: 160 });
  doc.text('Authorized Signatory', 380, footerY + 18, { align: 'center', width: 160 });

  doc.text('This is a computer generated document.', 40, footerY + 20, { color: '#9ca3af' });

  doc.end();
};

/**
 * Builds downloadable Word .docx document for PF & Invoices
 */
const generateDocumentDocx = async (docData, docType = 'INVOICE', companySettings) => {
  const isInvoice = docType === 'INVOICE';
  const docTitle = isInvoice ? 'TAX INVOICE' : 'PROFORMA / PF DOCUMENT';
  const docNumber = isInvoice ? docData.invoiceNumber : docData.pfNumber;
  const docDate = new Date(isInvoice ? docData.invoiceDate : docData.documentDate).toLocaleDateString('en-IN');
  const client = docData.clientSnapshot || {};

  // Table rows
  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: 'Sr', bold: true })], width: { size: 5, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: 'Service / Item', bold: true })], width: { size: 35, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: 'Price (₹)', bold: true })], width: { size: 12, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: 'Qty', bold: true })], width: { size: 10, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: 'Taxable (₹)', bold: true })], width: { size: 13, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: 'GST %', bold: true })], width: { size: 10, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ text: 'Total (₹)', bold: true })], width: { size: 15, type: WidthType.PERCENTAGE } })
      ]
    })
  ];

  (docData.items || []).forEach((item, index) => {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(`${index + 1}`)] }),
          new TableCell({ children: [new Paragraph(`${item.description}${item.itemCode || item.serviceId ? ` (${item.itemCode || item.serviceId})` : ''}`)] }),
          new TableCell({ children: [new Paragraph(`${item.unitPrice.toFixed(2)}`)] }),
          new TableCell({ children: [new Paragraph(`${item.quantity} ${item.unit || ''}`)] }),
          new TableCell({ children: [new Paragraph(`${item.taxableAmount.toFixed(2)}`)] }),
          new TableCell({ children: [new Paragraph(`${item.taxRate}%`)] }),
          new TableCell({ children: [new Paragraph(`${item.lineTotal.toFixed(2)}`)] })
        ]
      })
    );
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: companySettings.companyName || 'Navadurga Electricals', bold: true, size: 32, color: '1E40AF' }),
              new TextRun({ text: `\n${companySettings.tagline || ''}`, size: 18, color: '4B5563' }),
              new TextRun({ text: `\nAddress: ${companySettings.address || ''}`, size: 18 }),
              new TextRun({ text: `\nGSTIN: ${companySettings.gstin || 'N/A'} | PAN: ${companySettings.pan || 'N/A'}`, size: 18 })
            ]
          }),
          new Paragraph({ text: '\n' }),
          new Paragraph({
            children: [
              new TextRun({ text: `${docTitle}`, bold: true, size: 26, color: '1E40AF' }),
              new TextRun({ text: `\nDocument No: ${docNumber}`, bold: true, size: 20 }),
              new TextRun({ text: `\nDate: ${docDate}`, size: 18 }),
              new TextRun({ text: `\nStatus: ${docData.status}`, size: 18 })
            ]
          }),
          new Paragraph({ text: '\n' }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Billed To:', bold: true, size: 22, color: '1E40AF' }),
              new TextRun({ text: `\nCompany: ${client.companyName || 'N/A'}`, bold: true, size: 20 }),
              new TextRun({ text: `\nContact Person: ${client.contactPerson || 'N/A'}`, size: 18 }),
              new TextRun({ text: `\nAddress: ${client.billingAddress || ''}, ${client.city || ''}, ${client.state || ''} - ${client.pincode || ''}`, size: 18 }),
              new TextRun({ text: `\nPhone: ${client.primaryPhone || 'N/A'} | Email: ${client.email || 'N/A'}`, size: 18 }),
              new TextRun({ text: `\nGSTIN: ${client.gstin || 'Unregistered'}`, size: 18 })
            ]
          }),
          new Paragraph({ text: '\n' }),
          new Table({
            rows: tableRows,
            width: { size: 100, type: WidthType.PERCENTAGE }
          }),
          new Paragraph({ text: '\n' }),
          new Paragraph({
            children: [
              new TextRun({ text: `Subtotal: ${formatINR(docData.subtotal)}\n` }),
              new TextRun({ text: `Taxable Amount: ${formatINR(docData.totalTaxableAmount)}\n` }),
              new TextRun({ text: `Total Tax: ${formatINR(docData.totalTax)}\n` }),
              new TextRun({ text: `Grand Total: ${formatINR(docData.grandTotal)}\n`, bold: true, size: 24, color: '1E40AF' }),
              new TextRun({ text: `Amount in Words: ${numberToWordsINR(docData.grandTotal)}\n\n`, italics: true }),
              isInvoice ? new TextRun({ text: `Amount Paid: ${formatINR(docData.amountPaid || 0)}\nOutstanding Balance: ${formatINR(docData.outstandingBalance || 0)}\n\n`, bold: true }) : new TextRun({ text: '' })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Bank Details:\n', bold: true }),
              new TextRun({ text: `Bank: ${companySettings.bankName || 'N/A'}\n` }),
              new TextRun({ text: `Account Number: ${companySettings.accountNumber || 'N/A'}\n` }),
              new TextRun({ text: `IFSC Code: ${companySettings.ifscCode || 'N/A'}\n` }),
              new TextRun({ text: `UPI ID: ${companySettings.upiId || 'N/A'}\n` })
            ]
          }),
          new Paragraph({ text: '\n\n' }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: `For ${companySettings.companyName || 'Navadurga Electricals'}\n\n\n\n` }),
              new TextRun({ text: 'Authorized Signatory', bold: true })
            ]
          })
        ]
      }
    ]
  });

  return await Packer.toBuffer(doc);
};

module.exports = {
  generateDocumentPDF,
  generateDocumentDocx
};
