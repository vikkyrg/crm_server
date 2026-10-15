const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateLineItem, calculateDocumentTotals, numberToWordsINR, round2 } = require('../src/utils/financials');

test('Financials: Intra-state supply splits tax into equal CGST and SGST', () => {
  const item = {
    unitPrice: 1000,
    quantity: 2,
    discountPercent: 10, // 2000 - 200 = 1800 taxable
    taxRate: 18
  };

  const calculated = calculateLineItem(item, false); // Intra-state
  assert.equal(calculated.taxableAmount, 1800);
  assert.equal(calculated.cgstRate, 9);
  assert.equal(calculated.sgstRate, 9);
  assert.equal(calculated.igstRate, 0);
  assert.equal(calculated.cgstAmount, 162);
  assert.equal(calculated.sgstAmount, 162);
  assert.equal(calculated.igstAmount, 0);
  assert.equal(calculated.totalTax, 324);
  assert.equal(calculated.lineTotal, 2124);
});

test('Financials: Inter-state supply applies only IGST', () => {
  const item = {
    unitPrice: 5000,
    quantity: 1,
    discountPercent: 0,
    taxRate: 18
  };

  const calculated = calculateLineItem(item, true); // Inter-state
  assert.equal(calculated.taxableAmount, 5000);
  assert.equal(calculated.cgstRate, 0);
  assert.equal(calculated.sgstRate, 0);
  assert.equal(calculated.igstRate, 18);
  assert.equal(calculated.igstAmount, 900);
  assert.equal(calculated.totalTax, 900);
  assert.equal(calculated.lineTotal, 5900);
});

test('Financials: Multi-line document totals and rounding calculation', () => {
  const items = [
    { unitPrice: 120000, quantity: 1, discountPercent: 5, taxRate: 18 }, // 114,000 taxable + 20,520 tax = 134,520
    { unitPrice: 85000, quantity: 1, discountPercent: 0, taxRate: 18 }   // 85,000 taxable + 15,300 tax = 100,300
  ];

  const totals = calculateDocumentTotals(items, 0, false, true);
  assert.equal(totals.subtotal, 205000);
  assert.equal(totals.totalItemDiscounts, 6000);
  assert.equal(totals.totalTaxableAmount, 199000);
  assert.equal(totals.cgstTotal, 17910);
  assert.equal(totals.sgstTotal, 17910);
  assert.equal(totals.igstTotal, 0);
  assert.equal(totals.totalTax, 35820);
  assert.equal(totals.grandTotal, 234820);
});

test('Financials: Number to INR words conversion', () => {
  const words = numberToWordsINR(150000);
  assert.match(words, /One Lakh Fifty Thousand Rupees/i);
});
