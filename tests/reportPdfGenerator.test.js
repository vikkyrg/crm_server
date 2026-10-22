const test = require('node:test');
const assert = require('node:assert/strict');
const { generateReportPDF } = require('../src/utils/reportPdfGenerator');

const countPdfPages = (pdfBuffer) => (
  (pdfBuffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length
);

test('generates a landscape PDF and paginates long multi-column report data', async () => {
  const fields = Array.from({ length: 12 }, (_, index) => ({
    label: `Report Column ${index + 1}`,
    value: `column${index + 1}`
  }));
  const rows = Array.from({ length: 40 }, (_, rowIndex) => ({
    ...Object.fromEntries(fields.map((field, columnIndex) => [
      field.value,
      columnIndex === 2
        ? `Detailed report value ${rowIndex + 1} `.repeat(18)
        : `Row ${rowIndex + 1}, column ${columnIndex + 1}`
    ]))
  }));

  const pdf = await generateReportPDF({
    rows,
    fields,
    reportTitle: 'Monthly Payroll Register',
    companyName: 'Navadurga Electricals',
    period: '01/10/2026 to 31/10/2026'
  });
  const pdfText = pdf.toString('latin1');

  assert.equal(pdfText.slice(0, 5), '%PDF-');
  assert.match(pdfText, /\/MediaBox\s+\[0\s+0\s+841\.89\s+595\.28\]/);
  assert.ok(countPdfPages(pdf) > 1, 'long report data should flow onto additional pages');
  assert.ok(pdfText.includes('%%EOF'));
});

test('generates a readable PDF for an empty report', async () => {
  const pdf = await generateReportPDF({
    rows: [],
    fields: [{ label: 'Client ID', value: 'clientId' }],
    reportTitle: 'Client Directory Register',
    companyName: 'Navadurga Electricals',
    period: 'All available dates'
  });

  assert.equal(pdf.toString('latin1').slice(0, 5), '%PDF-');
  assert.equal(countPdfPages(pdf), 1);
});
