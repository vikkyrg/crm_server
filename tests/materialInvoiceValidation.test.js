const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateInvoiceItems,
  validateDocumentDiscount,
  refreshInvoiceStatuses
} = require('../src/controllers/invoiceController');
const { calculateDocumentTotals } = require('../src/utils/financials');

const validMaterialItems = [
  { itemCode: 'MAT-001', description: 'Network switch', unit: 'Nos', quantity: 2, unitPrice: 1250.5, discountPercent: 0, taxRate: 18 },
  { itemCode: 'MAT-002', description: 'Patch cable', unit: 'Pack', quantity: 3, unitPrice: 200, discountPercent: 5, taxRate: 5 }
];

test('validates material item code, description, unit, quantities, prices, discounts, and GST', () => {
  assert.equal(validateInvoiceItems(validMaterialItems, 'Material'), null);
  assert.match(validateInvoiceItems([{ ...validMaterialItems[0], quantity: 0 }], 'Material'), /quantity/i);
  assert.match(validateInvoiceItems([{ ...validMaterialItems[0], unitPrice: -1 }], 'Material'), /unit price/i);
  assert.match(validateInvoiceItems([{ ...validMaterialItems[0], itemCode: '' }], 'Material'), /item code/i);
  assert.match(validateInvoiceItems([{ ...validMaterialItems[0], unit: '' }], 'Material'), /unit/i);
  assert.match(validateInvoiceItems([{ ...validMaterialItems[0], taxRate: 101 }], 'Material'), /GST rate/i);
  assert.match(validateInvoiceItems([{ ...validMaterialItems[0], description: '' }], 'Material'), /description/i);
});

test('calculates material subtotals and interstate/intrastate GST consistently', () => {
  const totals = calculateDocumentTotals(validMaterialItems, 0, false, false);
  assert.equal(totals.subtotal, 3101);
  assert.equal(totals.totalTaxableAmount, 3071);
  assert.equal(totals.cgstTotal, 239.34);
  assert.equal(totals.sgstTotal, 239.34);
  assert.equal(totals.igstTotal, 0);
  assert.equal(totals.grandTotal, 3549.68);
  assert.equal(validateDocumentDiscount(3092, validMaterialItems), 'Document discount cannot exceed the taxable subtotal');
});

test('derives invoice and payment status from the actual settled balance', () => {
  const invoice = {
    grandTotal: 1000,
    amountPaid: 400,
    creditAdjustment: 0,
    outstandingBalance: 600,
    dueDate: new Date(Date.now() + 86400000),
    status: 'Issued'
  };
  refreshInvoiceStatuses(invoice);
  assert.equal(invoice.status, 'Partially Paid');
  assert.equal(invoice.paymentStatus, 'Partially Paid');
  assert.equal(invoice.outstandingBalance, 600);

  invoice.amountPaid = 1000;
  refreshInvoiceStatuses(invoice);
  assert.equal(invoice.status, 'Paid');
  assert.equal(invoice.paymentStatus, 'Paid');
  assert.equal(invoice.outstandingBalance, 0);
});
