const PDFDocument = require('pdfkit');

const PAGE_MARGIN = 30;
const FOOTER_HEIGHT = 24;
const TABLE_FONT_SIZE = 7.2;
const LINE_HEIGHT = TABLE_FONT_SIZE * 1.25;
const MAX_COLUMNS_PER_PAGE = 8;
const REPEATED_COLUMNS = 2;

const isCurrencyField = (label) => (
  /amount|total|salary|price|wage|share|outstanding|balance|earnings|deduction|cost|taxable|received|allocated|contribution|pool|employee pf|employer pf|prof tax|\btds\b|take-home|\bctc\b/i.test(label)
  && !/rate|days|quantity|qty/i.test(label)
);

const formatCellValue = (value, label) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('en-IN');
  if (typeof value === 'number' && Number.isFinite(value)) {
    return isCurrencyField(label)
      ? `Rs. ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : value.toLocaleString('en-IN');
  }
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const wrapText = (doc, value, width, fontSize) => {
  doc.font('Helvetica').fontSize(fontSize);
  const lines = [];
  const paragraphs = String(value || '').split(/\r?\n/);

  paragraphs.forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }

    let line = '';
    words.forEach((word) => {
      if (doc.widthOfString(word) > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        let fragment = '';
        for (const character of word) {
          if (fragment && doc.widthOfString(fragment + character) > width) {
            lines.push(fragment);
            fragment = character;
          } else {
            fragment += character;
          }
        }
        line = fragment;
      } else {
        const candidate = line ? `${line} ${word}` : word;
        if (line && doc.widthOfString(candidate) > width) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    });
    if (line) lines.push(line);
  });

  return lines.length ? lines : [''];
};

const getColumnGroups = (fields) => {
  if (fields.length <= MAX_COLUMNS_PER_PAGE) return [fields.map((_, index) => index)];

  const groups = [];
  const remainingCapacity = MAX_COLUMNS_PER_PAGE - REPEATED_COLUMNS;
  const repeated = Array.from({ length: REPEATED_COLUMNS }, (_, index) => index);
  for (let start = REPEATED_COLUMNS; start < fields.length; start += remainingCapacity) {
    groups.push([
      ...repeated,
      ...Array.from(
        { length: Math.min(remainingCapacity, fields.length - start) },
        (_, offset) => start + offset
      )
    ]);
  }
  return groups;
};

const getColumnWidths = (fields, indexes, availableWidth) => {
  const weights = indexes.map((index) => {
    const label = fields[index].label;
    if (/name|client|description|email|notes|transporter|reference|project|vehicle|address/i.test(label)) return 1.55;
    if (/id|date|status|code|rate|days|quantity|qty|unit|uan|gstin/i.test(label)) return 0.85;
    return 1;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (availableWidth * weight) / weightTotal);
};

const drawReportHeader = (doc, { companyName, reportTitle, period, generatedAt, groupNumber, groupCount }) => {
  const width = doc.page.width - PAGE_MARGIN * 2;
  doc.fillColor('#1e40af').font('Helvetica-Bold').fontSize(15)
    .text(companyName, PAGE_MARGIN, PAGE_MARGIN, { width });
  doc.fillColor('#111827').fontSize(10.5)
    .text(reportTitle, PAGE_MARGIN, PAGE_MARGIN + 21, { width });
  doc.fillColor('#4b5563').font('Helvetica').fontSize(7.5)
    .text(`Period: ${period}`, PAGE_MARGIN, PAGE_MARGIN + 39, { width: width / 2 });
  doc.text(`Generated: ${generatedAt}`, PAGE_MARGIN + width / 2, PAGE_MARGIN + 39, {
    width: width / 2,
    align: 'right'
  });
  if (groupCount > 1) {
    doc.fillColor('#64748b').fontSize(7)
      .text(`Columns ${groupNumber} of ${groupCount}`, PAGE_MARGIN, PAGE_MARGIN + 52);
  }
  return PAGE_MARGIN + 66;
};

const drawTableHeader = (doc, fields, indexes, widths, y) => {
  const fontSize = 7.2;
  const padding = 5;
  const wrappedHeaders = indexes.map((index, columnIndex) => (
    wrapText(doc, fields[index].label, widths[columnIndex] - padding * 2, fontSize)
  ));
  const rowHeight = Math.max(22, ...wrappedHeaders.map((lines) => lines.length * LINE_HEIGHT + padding * 2));
  let x = PAGE_MARGIN;

  indexes.forEach((index, columnIndex) => {
    const columnWidth = widths[columnIndex];
    doc.rect(x, y, columnWidth, rowHeight).fillAndStroke('#1e40af', '#ffffff');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(fontSize)
      .text(wrappedHeaders[columnIndex].join('\n'), x + padding, y + padding, {
        width: columnWidth - padding * 2,
        height: rowHeight - padding * 2
      });
    x += columnWidth;
  });

  return y + rowHeight;
};

const generateReportPDF = ({ rows, fields, reportTitle, companyName, period }) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: PAGE_MARGIN,
    bufferPages: true
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks)));

  const generatedAt = new Date().toLocaleString('en-IN');
  const groups = getColumnGroups(fields);
  const pageWidth = doc.page.width - PAGE_MARGIN * 2;
  const contentBottom = doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT;
  let currentY;
  let currentIndexes;
  let currentWidths;
  let rowNumber = 0;

  const startTablePage = (groupIndex, addPage) => {
    if (addPage) doc.addPage({ size: 'A4', layout: 'landscape', margin: PAGE_MARGIN });
    currentIndexes = groups[groupIndex];
    currentWidths = getColumnWidths(fields, currentIndexes, pageWidth);
    currentY = drawReportHeader(doc, {
      companyName,
      reportTitle,
      period,
      generatedAt,
      groupNumber: groupIndex + 1,
      groupCount: groups.length
    });
    currentY = drawTableHeader(doc, fields, currentIndexes, currentWidths, currentY);
  };

  groups.forEach((indexes, groupIndex) => {
    startTablePage(groupIndex, groupIndex > 0);

    if (rows.length === 0) {
      doc.fillColor('#64748b').font('Helvetica').fontSize(9)
        .text('No records matched this report and date range.', PAGE_MARGIN, currentY + 16, {
          width: pageWidth,
          align: 'center'
        });
      return;
    }

    rows.forEach((row) => {
      const cellAlignments = [];
      const cellLines = currentIndexes.map((fieldIndex, columnIndex) => {
        const field = fields[fieldIndex];
        const value = typeof field.value === 'function' ? field.value(row) : row[field.value];
        cellAlignments.push(typeof value === 'number' ? 'right' : 'left');
        const text = formatCellValue(value, field.label);
        return wrapText(doc, text, currentWidths[columnIndex] - 10, TABLE_FONT_SIZE);
      });
      const rowLineCount = Math.max(...cellLines.map((lines) => lines.length));
      let consumedLines = 0;

      while (consumedLines < rowLineCount) {
        let availableLines = Math.floor((contentBottom - currentY - 8) / LINE_HEIGHT);
        if (availableLines < 1) {
          startTablePage(groupIndex, true);
          availableLines = Math.floor((contentBottom - currentY - 8) / LINE_HEIGHT);
        }

        const segmentLineCount = Math.min(availableLines, rowLineCount - consumedLines);
        const rowHeight = segmentLineCount * LINE_HEIGHT + 8;
        const background = rowNumber % 2 === 0 ? '#ffffff' : '#f8fafc';
        let x = PAGE_MARGIN;

        currentIndexes.forEach((_, columnIndex) => {
          const columnWidth = currentWidths[columnIndex];
          doc.rect(x, currentY, columnWidth, rowHeight).fillAndStroke(background, '#dbe3ee');
          const segment = cellLines[columnIndex]
            .slice(consumedLines, consumedLines + segmentLineCount)
            .join('\n');
          doc.fillColor('#1f2937').font('Helvetica').fontSize(TABLE_FONT_SIZE)
            .text(segment, x + 5, currentY + 4, {
              width: columnWidth - 10,
              height: rowHeight - 6,
              align: cellAlignments[columnIndex]
            });
          x += columnWidth;
        });

        currentY += rowHeight;
        consumedLines += segmentLineCount;
        if (consumedLines < rowLineCount) startTablePage(groupIndex, true);
      }
      rowNumber += 1;
    });
  });

  const pageRange = doc.bufferedPageRange();
  for (let index = 0; index < pageRange.count; index += 1) {
    doc.switchToPage(pageRange.start + index);
    const footerY = doc.page.height - PAGE_MARGIN - 10;
    doc.fillColor('#64748b').font('Helvetica').fontSize(7)
      .text(`${reportTitle}  |  Page ${index + 1} of ${pageRange.count}`, PAGE_MARGIN, footerY, {
        width: pageWidth,
        align: 'right'
      });
  }

  doc.end();
});

module.exports = { generateReportPDF };
