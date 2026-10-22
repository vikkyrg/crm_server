const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const zlib = require('node:zlib');
const { generateDocumentPDF } = require('../src/utils/documentGenerator');

const invoiceData = {
  invoiceNumber: 'INV-TEST',
  pfNumber: 'PF-TEST',
  invoiceDate: '2026-10-22',
  dueDate: '2026-11-06',
  documentDate: '2026-10-22',
  status: 'Partially Paid',
  paymentStatus: 'Partially Paid',
  clientSnapshot: {},
  items: [{
    description: 'Sample Service',
    serviceId: 'SRV-1',
    unitPrice: 100,
    quantity: 1,
    unit: 'Hours',
    taxableAmount: 100,
    taxRate: 18,
    totalTax: 18,
    lineTotal: 118
  }],
  subtotal: 100,
  totalItemDiscounts: 0,
  documentDiscount: 0,
  totalTaxableAmount: 100,
  cgstTotal: 9,
  sgstTotal: 9,
  igstTotal: 0,
  totalTax: 18,
  grandTotal: 118,
  advanceAmount: 20,
  balancePayable: 98,
  amountPaid: 0,
  outstandingBalance: 118
};

const getPdfText = (docType, companySettings = { companyName: 'Test Company' }) => new Promise((resolve, reject) => {
  const response = new PassThrough();
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('error', reject);
  response.on('end', () => {
    const pdf = Buffer.concat(chunks).toString('latin1');
    const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
    const content = streams.map((match) => {
      try {
        return zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      } catch {
        return '';
      }
    }).join('\n');
    const text = [...content.matchAll(/\[((?:.|\r|\n)*?)\]\s*TJ|<([0-9a-f]+)>\s*Tj/gi)]
      .map((match) => {
        const hexStrings = match[1]
          ? [...match[1].matchAll(/<([0-9a-f]+)>/gi)].map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
          : [Buffer.from(match[2], 'hex').toString('latin1')];
        return hexStrings.join('');
      })
      .join('\n');
    resolve({ pdf, text, content });
  });

  generateDocumentPDF(invoiceData, docType, companySettings, response);
});

test('invoice and PF PDFs show concise item columns and separate tax totals', async () => {
  for (const docType of ['INVOICE', 'PF']) {
    const { pdf, text } = await getPdfText(docType);

    assert.ok(pdf.startsWith('%PDF-'));
    const itemHeaders = ['SR', 'SERVICE / ITEM', 'PRICE', 'QTY', 'TOTAL'];
    const headerPositions = itemHeaders.map((header) => text.indexOf(header));
    assert.ok(headerPositions.every((position) => position >= 0), `${docType} PDF is missing an item header`);
    assert.deepEqual(headerPositions, [...headerPositions].sort((a, b) => a - b));
    const summaryLabels = ['Subtotal:', 'CGST @ 9%:', 'SGST @ 9%:', 'Grand Total:'];
    const summaryPositions = summaryLabels.map((label) => text.indexOf(label));
    assert.ok(summaryPositions.every((position) => position >= 0), `${docType} PDF is missing a tax summary row`);
    assert.deepEqual(summaryPositions, [...summaryPositions].sort((a, b) => a - b));
    assert.ok(!text.includes('Total GST:'));
    assert.ok(!text.includes('Taxable Amount:'));
    assert.ok(!text.includes('Total Amount:'));
    assert.ok(!text.includes('Amount Paid:'));
    assert.ok(!text.includes('Outstanding Balance:'));
    if (docType === 'PF') {
      assert.ok(text.includes('Advance Received (as entered):'));
      assert.ok(text.includes('Balance Payable:'));
      assert.ok(text.includes('98.00'));
    }
    assert.ok(!text.includes('Due Date:'));
    assert.ok(!text.includes('Attention:'));
    assert.ok(!text.includes('GST %'));
    assert.ok(!text.includes('1 Hours'));
    assert.ok(!text.includes('Status:'));
    assert.ok(!text.includes('Payment:'));
  }
});

test('invoice and PF PDFs highlight balance payable and render each configured bank detail in its own cell', async () => {
  const branch = 'Sector 62, Noida Branch, Building 14, Near Central Business District, Uttar Pradesh, India, Postal Zone 201309. '.repeat(2);
  const settings = {
    companyName: 'Test Company',
    bankName: 'HDFC Bank',
    accountNumber: '50200012345678',
    ifscCode: 'HDFC0001234',
    branch,
    upiId: 'test@hdfcbank'
  };

  for (const docType of ['INVOICE', 'PF']) {
    const { content, text } = await getPdfText(docType, settings);
    const normalizedText = text.replace(/\s+/g, ' ');

    assert.ok(normalizedText.includes('Bank:'));
    assert.ok(normalizedText.includes('HDFC Bank'));
    assert.ok(normalizedText.includes('A/C No.:'));
    assert.ok(normalizedText.includes('50200012345678'));
    assert.ok(normalizedText.includes('IFSC:'));
    assert.ok(normalizedText.includes('HDFC0001234'));
    assert.ok(normalizedText.includes('Branch:'));
    assert.ok(normalizedText.includes(branch));
    assert.ok(!normalizedText.includes('UPI ID'));

    const bankSectionBoxes = [...content.matchAll(/40 ([\d.]+) 300 ([\d.]+) re/g)]
      .map((match) => ({ y: Number(match[1]), height: Number(match[2]) }));
    assert.ok(bankSectionBoxes.length >= 3, 'compact bank table should have a header, body fill, and a fitted outer border');
    assert.ok(!content.includes('40 ' + bankSectionBoxes.at(-1).y + ' 515'), 'bank table should not span across the totals into empty page width');
    const lastBorder = bankSectionBoxes[bankSectionBoxes.length - 1];
    const rowDividers = [...content.matchAll(/40 ([\d.]+) m\s+340 ([\d.]+) l/g)]
      .map((match) => Number(match[1]));
    const sectionDividers = rowDividers.filter((y) => y > lastBorder.y && y < lastBorder.y + lastBorder.height);
    assert.equal(sectionDividers.length, 4, 'bank header and four detail rows should have continuous horizontal separators');
    assert.ok(lastBorder.height < 130, 'bank table border should end close to its compact rows without excess empty space');
    assert.ok(sectionDividers.every((y, index) => index === 0 || y > sectionDividers[index - 1]));
    if (docType === 'PF') {
      assert.ok(normalizedText.includes('Balance Payable:'));
      assert.ok(content.includes('0.9372549019607843 0.9647058823529412 1 scn'), 'balance payable should use the highlighted blue background');
    }
  }
});

test('invoice and PF PDFs omit the bank details section when no bank information is configured', async () => {
  const { text } = await getPdfText('PF', { companyName: 'Test Company' });
  assert.ok(!text.includes('BANK DETAILS & PAYMENT INSTRUCTIONS'));
});

test('company address wraps within the client-details width and stays above the billed section', async () => {
  const address = 'Navadurga Campus, Plot 22, Sector 62, Noida, Uttar Pradesh, India, Postal Zone 201309. '.repeat(3);
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx3sAAAAASUVORK5CYII=';

  for (const docType of ['INVOICE', 'PF']) {
    for (const companyLogo of [undefined, logo]) {
      const { content, text } = await getPdfText(docType, {
        companyName: 'Navadurga Electricals',
        address,
        phone: '0123456789',
        email: 'billing@example.com',
        gstin: 'GSTIN-12345',
        companyLogo
      });

      assert.ok(text.includes('Navadurga Campus'));
      assert.ok(text.includes('GSTIN-12345'));
      const companyDetailLines = text.split('\n');
      assert.ok(companyDetailLines.some((line) => line.includes('Phone: 0123456789')));
      assert.ok(companyDetailLines.some((line) => line.includes('Email: billing@example.com')));
      assert.ok(companyDetailLines.some((line) => line.includes('GSTIN: GSTIN-12345')));
      assert.ok(!companyDetailLines.some((line) => line.includes('Phone: 0123456789') && line.includes('GSTIN: GSTIN-12345')));

      const billedTitleIndex = content.indexOf('42494c4c4544');
      assert.notEqual(billedTitleIndex, -1, 'billed-to heading should be present in the PDF content');
      const billedTitleTmIndex = content.lastIndexOf('Tm', billedTitleIndex);
      const headerPositions = [...content.slice(0, billedTitleTmIndex).matchAll(/1 0 0 1 40 ([\d.]+) Tm/g)]
        .map((match) => Number(match[1]));
      assert.ok(headerPositions.length >= 4, 'long company address should wrap to another line at the shared left margin');
      const billedTitleLine = content.slice(content.lastIndexOf('\n', billedTitleTmIndex) + 1, billedTitleTmIndex);
      const billedTitleY = Number(billedTitleLine.match(/1 0 0 1 40 ([\d.]+)/)?.[1]);
      assert.ok(Number.isFinite(billedTitleY));
      assert.ok(headerPositions.every((y) => y > billedTitleY), `header text positions ${headerPositions.join(', ')} should be above billed title at ${billedTitleY}`);
    }
  }
});
