// Financial and GST calculation helper functions

/**
 * Rounds number to 2 decimal places reliably
 */
const round2 = (num) => {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
};

/**
 * Calculates a single line item with tax breakdown (CGST+SGST or IGST)
 */
const calculateLineItem = (item, isInterState = false) => {
  const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const discountPercent = Math.min(100, Math.max(0, Number(item.discountPercent) || 0));

  const grossAmount = round2(unitPrice * quantity);
  const discountAmount = round2((grossAmount * discountPercent) / 100);
  const taxableAmount = Math.max(0, round2(grossAmount - discountAmount));

  const taxRate = Math.max(0, Number(item.taxRate) || 0);

  let cgstRate = 0;
  let cgstAmount = 0;
  let sgstRate = 0;
  let sgstAmount = 0;
  let igstRate = 0;
  let igstAmount = 0;

  if (isInterState) {
    igstRate = taxRate;
    igstAmount = round2((taxableAmount * igstRate) / 100);
  } else {
    cgstRate = round2(taxRate / 2);
    sgstRate = round2(taxRate / 2);
    cgstAmount = round2((taxableAmount * cgstRate) / 100);
    sgstAmount = round2((taxableAmount * sgstRate) / 100);
  }

  const totalTax = round2(cgstAmount + sgstAmount + igstAmount);
  const lineTotal = round2(taxableAmount + totalTax);

  return {
    ...item,
    unitPrice,
    quantity,
    discountPercent,
    discountAmount,
    taxableAmount,
    taxRate,
    isInterState,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    igstRate,
    igstAmount,
    totalTax,
    lineTotal
  };
};

/**
 * Calculates complete document totals from item lines and document discount
 */
const calculateDocumentTotals = (items = [], documentDiscount = 0, isInterState = false, roundToNearest = true) => {
  const calculatedItems = items.map((item) => calculateLineItem(item, isInterState));

  const subtotal = round2(calculatedItems.reduce((acc, curr) => acc + (curr.unitPrice * curr.quantity), 0));
  const totalItemDiscounts = round2(calculatedItems.reduce((acc, curr) => acc + curr.discountAmount, 0));
  
  const rawTaxable = round2(calculatedItems.reduce((acc, curr) => acc + curr.taxableAmount, 0));
  const docDiscount = Math.min(rawTaxable, Math.max(0, Number(documentDiscount) || 0));
  const totalTaxableAmount = round2(rawTaxable - docDiscount);

  const cgstTotal = round2(calculatedItems.reduce((acc, curr) => acc + curr.cgstAmount, 0));
  const sgstTotal = round2(calculatedItems.reduce((acc, curr) => acc + curr.sgstAmount, 0));
  const igstTotal = round2(calculatedItems.reduce((acc, curr) => acc + curr.igstAmount, 0));
  const totalTax = round2(cgstTotal + sgstTotal + igstTotal);

  const rawGrandTotal = round2(totalTaxableAmount + totalTax);
  let grandTotal = rawGrandTotal;
  let roundOffAdjustment = 0;

  if (roundToNearest) {
    grandTotal = Math.round(rawGrandTotal);
    roundOffAdjustment = round2(grandTotal - rawGrandTotal);
  }

  return {
    items: calculatedItems,
    documentDiscount: docDiscount,
    subtotal,
    totalItemDiscounts,
    totalTaxableAmount,
    cgstTotal,
    sgstTotal,
    igstTotal,
    totalTax,
    roundOffAdjustment,
    grandTotal
  };
};

/**
 * Converts a number to Indian Rupee Words format
 */
const numberToWordsINR = (num) => {
  if (num === null || num === undefined || isNaN(num)) return 'Zero Rupees Only';
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ',
    'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const n = ('000000000' + Math.floor(Math.abs(num))).substr(-9);
  const match = n.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!match) return '';

  let str = '';
  str += Number(match[1]) !== 0 ? (a[Number(match[1])] || b[match[1][0]] + ' ' + a[match[1][1]]) + 'Crore ' : '';
  str += Number(match[2]) !== 0 ? (a[Number(match[2])] || b[match[2][0]] + ' ' + a[match[2][1]]) + 'Lakh ' : '';
  str += Number(match[3]) !== 0 ? (a[Number(match[3])] || b[match[3][0]] + ' ' + a[match[3][1]]) + 'Thousand ' : '';
  str += Number(match[4]) !== 0 ? (a[Number(match[4])] || b[match[4][0]] + ' ' + a[match[4][1]]) + 'Hundred ' : '';
  str += Number(match[5]) !== 0 ? ((str !== '') ? 'and ' : '') + (a[Number(match[5])] || b[match[5][0]] + ' ' + a[match[5][1]]) : '';

  if (!str.trim()) {
    str = 'Zero ';
  }

  const paise = Math.round((Math.abs(num) - Math.floor(Math.abs(num))) * 100);
  let paiseStr = '';
  if (paise > 0) {
    paiseStr = ' and ' + (a[paise] || b[Math.floor(paise / 10)] + ' ' + a[paise % 10]) + 'Paise';
  }

  return (num < 0 ? 'Minus ' : '') + str.trim() + ' Rupees' + paiseStr + ' Only';
};

/**
 * Format Indian Currency INR string (e.g. ₹1,50,000.00)
 */
const formatINR = (val) => {
  const num = Number(val) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
};

module.exports = {
  round2,
  calculateLineItem,
  calculateDocumentTotals,
  numberToWordsINR,
  formatINR
};
