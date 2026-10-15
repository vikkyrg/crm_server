const Client = require('../models/Client');
const Service = require('../models/Service');
const PFDocument = require('../models/PFDocument');
const Invoice = require('../models/Invoice');
const AdvancePayment = require('../models/AdvancePayment');
const QuantityRecord = require('../models/QuantityRecord');

// Helper to convert array of objects into standard CSV string
const convertToCSV = (data, fields) => {
  if (!data || !data.length) return '';
  const header = fields.map((f) => `"${f.label}"`).join(',');
  const rows = data.map((row) => {
    return fields.map((f) => {
      let val = typeof f.value === 'function' ? f.value(row) : row[f.value];
      if (val === undefined || val === null) val = '';
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
  });
  return [header, ...rows].join('\r\n');
};

// @desc    Export data report as CSV
// @route   GET /api/reports/export/:type
// @access  Private
exports.exportReportCSV = async (req, res, next) => {
  try {
    const { type } = req.params;
    const { startDate, endDate, client, status } = req.query;

    let csvData = '';
    let filename = `Report_${type}_${Date.now()}.csv`;

    switch (type) {
      case 'clients': {
        const clients = await Client.find({}).sort('-createdAt');
        const fields = [
          { label: 'Client ID', value: 'clientId' },
          { label: 'Company Name', value: 'companyName' },
          { label: 'Contact Person', value: 'contactPerson' },
          { label: 'Phone', value: 'primaryPhone' },
          { label: 'Email', value: 'email' },
          { label: 'GSTIN', value: 'gstin' },
          { label: 'City', value: 'city' },
          { label: 'State', value: 'state' },
          { label: 'Status', value: (row) => (row.isActive ? 'Active' : 'Inactive') }
        ];
        csvData = convertToCSV(clients, fields);
        filename = `Innomatrics_Clients_${Date.now()}.csv`;
        break;
      }

      case 'invoices': {
        const query = {};
        if (startDate || endDate) {
          query.invoiceDate = {};
          if (startDate) query.invoiceDate.$gte = new Date(startDate);
          if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            query.invoiceDate.$lte = end;
          }
        }
        if (client) query.client = client;
        if (status) query.status = status;

        const invoices = await Invoice.find(query).sort('-invoiceDate');
        const fields = [
          { label: 'Invoice Number', value: 'invoiceNumber' },
          { label: 'Date', value: (r) => new Date(r.invoiceDate).toLocaleDateString('en-IN') },
          { label: 'Due Date', value: (r) => new Date(r.dueDate).toLocaleDateString('en-IN') },
          { label: 'Client', value: (r) => r.clientSnapshot?.companyName || '' },
          { label: 'Taxable Amount', value: 'totalTaxableAmount' },
          { label: 'Total Tax', value: 'totalTax' },
          { label: 'Grand Total', value: 'grandTotal' },
          { label: 'Amount Paid', value: 'amountPaid' },
          { label: 'Balance Outstanding', value: 'outstandingBalance' },
          { label: 'Status', value: 'status' }
        ];
        csvData = convertToCSV(invoices, fields);
        filename = `Innomatrics_Invoices_${Date.now()}.csv`;
        break;
      }

      case 'pf-documents': {
        const query = {};
        if (startDate || endDate) {
          query.documentDate = {};
          if (startDate) query.documentDate.$gte = new Date(startDate);
          if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            query.documentDate.$lte = end;
          }
        }
        if (client) query.client = client;
        if (status) query.status = status;

        const pfs = await PFDocument.find(query).sort('-documentDate');
        const fields = [
          { label: 'PF Number', value: 'pfNumber' },
          { label: 'Date', value: (r) => new Date(r.documentDate).toLocaleDateString('en-IN') },
          { label: 'Client', value: (r) => r.clientSnapshot?.companyName || '' },
          { label: 'Taxable Amount', value: 'totalTaxableAmount' },
          { label: 'Total Tax', value: 'totalTax' },
          { label: 'Grand Total', value: 'grandTotal' },
          { label: 'Status', value: 'status' },
          { label: 'Converted Invoice', value: 'convertedToInvoiceNumber' }
        ];
        csvData = convertToCSV(pfs, fields);
        filename = `Innomatrics_PF_Documents_${Date.now()}.csv`;
        break;
      }

      case 'advances': {
        const query = {};
        if (startDate || endDate) {
          query.paymentDate = {};
          if (startDate) query.paymentDate.$gte = new Date(startDate);
          if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            query.paymentDate.$lte = end;
          }
        }
        if (client) query.client = client;
        if (status) query.status = status;

        const advances = await AdvancePayment.find(query).sort('-paymentDate');
        const fields = [
          { label: 'Receipt Number', value: 'receiptNumber' },
          { label: 'Date', value: (r) => new Date(r.paymentDate).toLocaleDateString('en-IN') },
          { label: 'Client', value: (r) => r.clientSnapshot?.companyName || '' },
          { label: 'Amount Received', value: 'amount' },
          { label: 'Allocated Amount', value: 'allocatedAmount' },
          { label: 'Unallocated Remaining', value: 'unallocatedAmount' },
          { label: 'Payment Method', value: 'paymentMethod' },
          { label: 'Reference / UTR', value: 'transactionReference' },
          { label: 'Status', value: 'status' }
        ];
        csvData = convertToCSV(advances, fields);
        filename = `Innomatrics_Advance_Payments_${Date.now()}.csv`;
        break;
      }

      case 'quantities': {
        const query = {};
        if (startDate || endDate) {
          query.date = {};
          if (startDate) query.date.$gte = new Date(startDate);
          if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            query.date.$lte = end;
          }
        }
        if (client) query.client = client;

        const quantities = await QuantityRecord.find(query).sort('-date');
        const fields = [
          { label: 'Record ID', value: 'recordId' },
          { label: 'Date', value: (r) => new Date(r.date).toLocaleDateString('en-IN') },
          { label: 'Client', value: (r) => r.clientSnapshot?.companyName || '' },
          { label: 'Service Name', value: 'serviceName' },
          { label: 'Service ID', value: 'serviceId' },
          { label: 'Quantity', value: 'quantity' },
          { label: 'Unit', value: 'unit' },
          { label: 'Unit Price', value: 'unitPriceSnapshot' },
          { label: 'Related PF', value: 'relatedPFNumber' },
          { label: 'Related Invoice', value: 'relatedInvoiceNumber' },
          { label: 'Notes', value: 'notes' }
        ];
        csvData = convertToCSV(quantities, fields);
        filename = `Innomatrics_Quantity_Register_${Date.now()}.csv`;
        break;
      }

      case 'services': {
        const services = await Service.find({}).sort('serviceId');
        const fields = [
          { label: 'Service ID', value: 'serviceId' },
          { label: 'Name', value: 'name' },
          { label: 'Category', value: 'category' },
          { label: 'Unit', value: 'unit' },
          { label: 'Default Price', value: 'defaultUnitPrice' },
          { label: 'Tax Rate (%)', value: 'taxRate' },
          { label: 'SAC Code', value: 'sacCode' },
          { label: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') }
        ];
        csvData = convertToCSV(services, fields);
        filename = `Innomatrics_Services_Catalog_${Date.now()}.csv`;
        break;
      }

      default:
        return res.status(400).json({ success: false, message: 'Invalid report type' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvData);
  } catch (error) {
    next(error);
  }
};
