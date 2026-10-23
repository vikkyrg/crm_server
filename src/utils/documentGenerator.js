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
  const contentX = 40;
  const contentWidth = 515;

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
  } else {
    doc.fillColor(primaryColor).fontSize(14).text(companySettings.companyName || 'Navadurga Electricals', 40, headerStartY, { bold: true });
  }

  const companyDetailsLines = [
    companySettings.address,
    companySettings.phone && `Phone: ${companySettings.phone}`,
    companySettings.email && `Email: ${companySettings.email}`,
    `GSTIN: ${companySettings.gstin || 'N/A'}`,
    companySettings.pan && `PAN: ${companySettings.pan}`
  ].filter(Boolean);
  const companyDetailsY = headerStartY === 40 ? 94 : headerStartY + 20;
  doc.font('Helvetica').fontSize(9).fillColor('#4b5563');
  let companyDetailsHeight = 0;
  companyDetailsLines.forEach((line, index) => {
    const lineHeight = doc.heightOfString(line, { width: contentWidth, font: 'Helvetica', size: 9 });
    doc.text(line, contentX, companyDetailsY + companyDetailsHeight, { width: contentWidth });
    companyDetailsHeight += lineHeight + (index < companyDetailsLines.length - 1 ? 2 : 0);
  });

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
  // Divider placed safely below both company info and metadata block
  const dividerY = Math.max(125, metaY, companyDetailsY + companyDetailsHeight + 8);
  doc.moveTo(40, dividerY).lineTo(555, dividerY).strokeColor('#e5e7eb').lineWidth(1).stroke();

  // Billed To Box
  const client = docData.clientSnapshot || {};
  const billedTitleY = dividerY + 10;
  doc.fillColor(primaryColor).fontSize(11).text('BILLED TO / CLIENT DETAILS', contentX, billedTitleY, { bold: true });
  doc.fillColor(textColor).font('Helvetica').fontSize(9);
  let clientDetailsY = billedTitleY + 15;
  const renderClientLine = (line) => {
    const height = doc.heightOfString(line, { width: contentWidth, font: 'Helvetica', size: 9 });
    doc.text(line, contentX, clientDetailsY, { width: contentWidth });
    clientDetailsY += height + 2;
  };
  renderClientLine(`Company: ${client.companyName || 'N/A'}`);
  renderClientLine(`Phone: ${client.primaryPhone || 'N/A'} | Email: ${client.email || 'N/A'}`);
  renderClientLine(`Address: ${client.billingAddress || ''}, ${client.city || ''}, ${client.state || ''} - ${client.pincode || ''}`);
  renderClientLine(`Client GSTIN: ${client.gstin || 'Unregistered / Not Provided'}`);
  if (isInvoice && docData.projectOrWorkOrder) {
    renderClientLine(`Project / Work Order: ${docData.projectOrWorkOrder}`);
  }

  // Table Header
  let tableY = clientDetailsY + 8;
  doc.rect(40, tableY, 515, 22).fill('#2563eb');
  doc.fillColor('#ffffff').fontSize(8);
  doc.text('SR', 45, tableY + 6, { width: 20 });
  doc.text('SERVICE / ITEM', 70, tableY + 6, { width: 220 });
  doc.text('PRICE', 300, tableY + 6, { width: 55, align: 'right' });
  doc.text('QTY', 365, tableY + 6, { width: 40, align: 'right' });
  doc.text('TOTAL', 420, tableY + 6, { width: 125, align: 'right' });

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
    doc.text(`${item.description}${itemReference ? ` (${itemReference})` : ''}`, 70, tableY + 5, { width: 220 });
    doc.text(Number(item.unitPrice).toFixed(2), 300, tableY + 5, { width: 55, align: 'right' });
    doc.text(`${item.quantity}`, 365, tableY + 5, { width: 40, align: 'right' });
    doc.text(Number(item.lineTotal).toFixed(2), 420, tableY + 5, { width: 125, align: 'right' });

    tableY += 20;
  });

  tableY += 10;
  doc.moveTo(40, tableY).lineTo(555, tableY).strokeColor('#e5e7eb').stroke();
  tableY += 10;

  // Amount in words
  const words = numberToWordsINR(docData.grandTotal);
  doc.fontSize(8).fillColor('#4b5563').text('AMOUNT IN WORDS:', 40, tableY, { bold: true });
  doc.fillColor(textColor).text(words, 40, tableY + 12, { width: 300 });

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

  renderSummaryRow('Subtotal:', docData.totalTaxableAmount ?? docData.subtotal);
  const taxRates = [...new Set((docData.items || [])
    .map((item) => Number(item.taxRate))
    .filter((rate) => Number.isFinite(rate) && rate > 0))];
  const formatRates = (rates) => rates.map((rate) => `${rate}%`).join(' / ');
  const cgstTotal = Number(docData.cgstTotal || 0);
  const sgstTotal = Number(docData.sgstTotal || 0);
  const igstTotal = Number(docData.igstTotal || 0);

  if (igstTotal > 0) {
    const igstRates = formatRates(taxRates);
    renderSummaryRow(`IGST${igstRates ? ` @ ${igstRates}` : ''}:`, igstTotal);
  } else if (cgstTotal > 0 || sgstTotal > 0) {
    const halfRates = formatRates(taxRates.map((rate) => rate / 2));
    const rateSuffix = halfRates ? ` @ ${halfRates}` : '';
    renderSummaryRow(`CGST${rateSuffix}:`, cgstTotal);
    renderSummaryRow(`SGST${rateSuffix}:`, sgstTotal);
  }

  summaryY += 4;
  doc.rect(summaryX - 5, summaryY, 210, 24).fill('#eff6ff');
  doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text('Grand Total:', summaryX, summaryY + 7);
  doc.text(formatPDFINR(docData.grandTotal), summaryX + 80, summaryY + 7, { width: 120, align: 'right' });
  if (!isInvoice) {
    summaryY += 28;
    renderSummaryRow('Advance Received (as entered):', docData.advanceAmount || 0);
    summaryY += 2;
    doc.rect(summaryX - 5, summaryY, 210, 26).fill('#eff6ff');
    doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold')
      .text('Balance Payable:', summaryX, summaryY + 7);
    doc.text(
      formatPDFINR(docData.balancePayable ?? Math.max(0, docData.grandTotal - (docData.advanceAmount || 0))),
      summaryX + 80,
      summaryY + 7,
      { width: 120, align: 'right' }
    );
  }

  const bankDetails = [
    ['Bank', companySettings.bankName],
    ['A/C No.', companySettings.accountNumber],
    ['IFSC', companySettings.ifscCode],
    ['Branch', companySettings.branch]
  ].filter(([, value]) => String(value || '').trim());

  if (bankDetails.length > 0) {
    const bankBoxX = 40;
    const bankBoxWidth = 300;
    const bankHeaderHeight = 17;
    const bankFontSize = 7.5;
    const bankLabelWidth = 50;
    const bankCellPadding = 4;
    const bankValueWidth = bankBoxWidth - bankCellPadding * 2 - bankLabelWidth;

    doc.font('Helvetica').fontSize(bankFontSize);
    const rows = bankDetails.map(([label, value]) => {
      const text = String(value).trim();
      const valueHeight = doc.heightOfString(text, {
        width: bankValueWidth,
        font: 'Helvetica',
        size: bankFontSize
      });
      return { label, value: text, height: Math.max(17, valueHeight + bankCellPadding * 2) };
    });

    const bankSectionHeight = bankHeaderHeight + rows.reduce((height, row) => height + row.height, 0);
    const amountWordsHeight = doc.heightOfString(words, { width: 300, font: 'Helvetica', size: 8 });
    let bankBoxY = tableY + 12 + amountWordsHeight + 8;
    if (bankBoxY + bankSectionHeight > 710) {
      doc.addPage();
      bankBoxY = 40;
    }

    doc.rect(bankBoxX, bankBoxY, bankBoxWidth, bankSectionHeight).fill('#f8fafc');
    doc.rect(bankBoxX, bankBoxY, bankBoxWidth, bankHeaderHeight).fill('#e2e8f0');
    doc.fontSize(7.5).fillColor(primaryColor).font('Helvetica-Bold')
      .text('BANK DETAILS & PAYMENT INSTRUCTIONS', bankBoxX + 7, bankBoxY + 5);

    let rowY = bankBoxY + bankHeaderHeight;
    rows.forEach(({ label, value, height }) => {
      doc.moveTo(bankBoxX, rowY).lineTo(bankBoxX + bankBoxWidth, rowY)
        .strokeColor('#cbd5e1').lineWidth(0.6).stroke();
      doc.font('Helvetica-Bold').fontSize(bankFontSize).fillColor('#4b5563')
        .text(`${label}:`, bankBoxX + bankCellPadding, rowY + bankCellPadding, {
          width: bankLabelWidth - bankCellPadding,
          lineBreak: false
        });
      doc.font('Helvetica').fontSize(bankFontSize).fillColor(textColor)
        .text(value, bankBoxX + bankCellPadding + bankLabelWidth, rowY + bankCellPadding, {
          width: bankValueWidth
        });
      rowY += height;
    });
    doc.rect(bankBoxX, bankBoxY, bankBoxWidth, bankSectionHeight)
      .strokeColor('#cbd5e1').lineWidth(0.6).stroke();
  }

  // --- NOTES / REMARKS & TERMS AND CONDITIONS ---
  // Safely retrieve notes and terms from docData
  const notesText = (docData.notes || '').trim();
  const termsText = (docData.termsAndConditions || docData.paymentTerms || '').trim();

  // Determine starting Y after the financial summary and bank details
  const amountWordsHeight = doc.heightOfString(words, { width: 300, font: 'Helvetica', size: 8 });
  const bankSectionTotalH = bankDetails.length > 0 ? (17 + bankDetails.length * 17) : 0;
  const leftColBottom = tableY + 12 + amountWordsHeight + 8 + bankSectionTotalH;
  const rightColBottom = summaryY + (isInvoice ? 0 : 4);
  let notesTermsStartY = Math.max(leftColBottom, rightColBottom) + 12;

  const boxPadding = 6;
  const innerTextWidth = contentWidth - boxPadding * 2;

  // Helper to render a formatted card for Notes or Terms with automatic pagination
  const renderInfoCard = (title, text) => {
    if (!text) return;

    doc.font('Helvetica').fontSize(7.5);
    const textHeight = doc.heightOfString(text, { width: innerTextWidth, lineGap: 1.5 });
    const headerH = 14;
    const cardHeight = headerH + textHeight + boxPadding * 2;

    // Check if card exceeds available page height before signature (signature at ~730, footer margin ~710)
    if (notesTermsStartY + cardHeight > 700) {
      doc.addPage();
      notesTermsStartY = 40;
    }

    // Card background and border
    doc.rect(40, notesTermsStartY, contentWidth, cardHeight).fillAndStroke('#f8fafc', '#cbd5e1');

    // Section title
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(primaryColor)
      .text(title, 40 + boxPadding, notesTermsStartY + 5);

    // Section text content
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor)
      .text(text, 40 + boxPadding, notesTermsStartY + headerH + 3, { width: innerTextWidth, lineGap: 1.5 });

    notesTermsStartY += cardHeight + 8;
  };

  if (notesText) {
    renderInfoCard('NOTES / REMARKS:', notesText);
  }

  if (termsText) {
    renderInfoCard('TERMS & CONDITIONS:', termsText);
  }

  // Footer / Signature
  let footerY = 730;
  if (notesTermsStartY > 710) {
    doc.addPage();
    footerY = 730;
  } else if (notesTermsStartY > footerY - 50) {
    footerY = Math.min(780, notesTermsStartY + 25);
  }

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
              new TextRun({ text: `\nDate: ${docDate}`, size: 18 })
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
              !isInvoice ? new TextRun({ text: `Advance Received (as entered): ${formatINR(docData.advanceAmount || 0)}\nBalance Payable: ${formatINR(docData.balancePayable ?? Math.max(0, docData.grandTotal - (docData.advanceAmount || 0)))}\n\n`, bold: true }) : new TextRun({ text: '' }),
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
          ...(docData.notes ? [
            new Paragraph({ text: '\n' }),
            new Paragraph({
              children: [
                new TextRun({ text: 'Notes / Remarks:\n', bold: true, color: '1E40AF' }),
                new TextRun({ text: `${docData.notes}\n` })
              ]
            })
          ] : []),
          ...((docData.termsAndConditions || docData.paymentTerms) ? [
            new Paragraph({ text: '\n' }),
            new Paragraph({
              children: [
                new TextRun({ text: 'Terms & Conditions:\n', bold: true, color: '1E40AF' }),
                new TextRun({ text: `${docData.termsAndConditions || docData.paymentTerms}\n` })
              ]
            })
          ] : []),
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
