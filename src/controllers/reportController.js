const Client = require('../models/Client');
const Service = require('../models/Service');
const PFDocument = require('../models/PFDocument');
const Invoice = require('../models/Invoice');
const AdvancePayment = require('../models/AdvancePayment');
const QuantityRecord = require('../models/QuantityRecord');
const CompanySettings = require('../models/CompanySettings');
const { generateReportPDF } = require('../utils/reportPdfGenerator');

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
    let reportRows = [];
    let reportFields = [];

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
        reportRows = clients;
        reportFields = fields;
        csvData = convertToCSV(clients, fields);
        filename = `Navadurga_Clients_${Date.now()}.csv`;
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
        if (req.query.invoiceType) query.invoiceType = req.query.invoiceType;

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
        reportRows = invoices;
        reportFields = fields;
        csvData = convertToCSV(invoices, fields);
        filename = `Navadurga_Invoices_${Date.now()}.csv`;
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
        reportRows = pfs;
        reportFields = fields;
        csvData = convertToCSV(pfs, fields);
        filename = `Navadurga_PF_Documents_${Date.now()}.csv`;
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
        reportRows = advances;
        reportFields = fields;
        csvData = convertToCSV(advances, fields);
        filename = `Navadurga_Advance_Payments_${Date.now()}.csv`;
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
        reportRows = quantities;
        reportFields = fields;
        csvData = convertToCSV(quantities, fields);
        filename = `Navadurga_Quantity_Register_${Date.now()}.csv`;
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
        reportRows = services;
        reportFields = fields;
        csvData = convertToCSV(services, fields);
        filename = `Navadurga_Services_Catalog_${Date.now()}.csv`;
        break;
      }

      case 'employees': {
        const Employee = require('../models/Employee');
        const employees = await Employee.find({}).sort('employeeId');
        const fields = [
          { label: 'Employee ID', value: 'employeeId' },
          { label: 'Full Name', value: 'fullName' },
          { label: 'Email', value: 'email' },
          { label: 'Phone', value: 'phone' },
          { label: 'Department', value: 'department' },
          { label: 'Designation', value: 'designation' },
          { label: 'Employment Status', value: 'employmentStatus' },
          { label: 'Employment Type', value: 'employmentType' },
          { label: 'Joining Date', value: (r) => r.joiningDate ? new Date(r.joiningDate).toLocaleDateString('en-IN') : '' },
          { label: 'Gross Monthly Salary', value: (r) => r.salaryStructure?.grossSalary || 0 },
          { label: 'UAN', value: (r) => r.statutoryInfo?.uan || '' },
          { label: 'PF Account No', value: (r) => r.statutoryInfo?.pfAccountNumber || '' }
        ];
        reportRows = employees;
        reportFields = fields;
        csvData = convertToCSV(employees, fields);
        filename = `Navadurga_Employees_Directory_${Date.now()}.csv`;
        break;
      }

      case 'payroll': {
        const PayrollRun = require('../models/PayrollRun');
        const runs = await PayrollRun.find({}).sort({ year: -1, month: -1 });
        const rows = [];
        runs.forEach(run => {
          (run.items || []).forEach(item => {
            rows.push({
              payrollCode: run.payrollCode,
              periodName: run.periodName,
              runStatus: run.status,
              employeeId: item.employeeId,
              employeeName: item.employeeName,
              department: item.department,
              designation: item.designation,
              workingDays: item.totalWorkingDays,
              paidDays: item.paidDays,
              grossEarnings: item.grossEarnings,
              employeePf: item.employeePfContribution,
              employeeEsi: item.employeeEsiContribution || 0,
              professionalTax: item.professionalTax,
              tds: item.tdsDeduction,
              otherDeductions: item.otherDeductions || 0,
              totalDeductions: item.totalEmployeeDeductions,
              netSalaryPayable: item.netSalaryPayable,
              employerPf: item.employerPfContribution,
              employerEsi: item.employerEsiContribution || 0,
              employerCostTotal: item.employerCostTotal,
              paymentStatus: item.paymentStatus,
              paymentReference: item.paymentReference || ''
            });
          });
        });
        const fields = [
          { label: 'Payroll Code', value: 'payrollCode' },
          { label: 'Period', value: 'periodName' },
          { label: 'Payroll Status', value: 'runStatus' },
          { label: 'Employee ID', value: 'employeeId' },
          { label: 'Employee Name', value: 'employeeName' },
          { label: 'Department', value: 'department' },
          { label: 'Designation', value: 'designation' },
          { label: 'Working Days', value: 'workingDays' },
          { label: 'Paid Days', value: 'paidDays' },
          { label: 'Gross Earnings', value: 'grossEarnings' },
          { label: 'Employee PF', value: 'employeePf' },
          { label: 'Employee ESI', value: 'employeeEsi' },
          { label: 'Prof Tax', value: 'professionalTax' },
          { label: 'TDS', value: 'tds' },
          { label: 'Other Deductions', value: 'otherDeductions' },
          { label: 'Total Deductions', value: 'totalDeductions' },
          { label: 'Net Take-Home', value: 'netSalaryPayable' },
          { label: 'Employer PF', value: 'employerPf' },
          { label: 'Employer ESI', value: 'employerEsi' },
          { label: 'Employer CTC', value: 'employerCostTotal' },
          { label: 'Payment Status', value: 'paymentStatus' },
          { label: 'Payment Ref', value: 'paymentReference' }
        ];
        reportRows = rows;
        reportFields = fields;
        csvData = convertToCSV(rows, fields);
        filename = `Navadurga_Monthly_Payroll_Register_${Date.now()}.csv`;
        break;
      }

      case 'employee-pf': {
        const EmployeePfRecord = require('../models/EmployeePfRecord');
        const pfRecords = await EmployeePfRecord.find({}).sort({ year: -1, month: -1 });
        const fields = [
          { label: 'Record Code', value: 'recordCode' },
          { label: 'Period', value: 'periodName' },
          { label: 'Employee ID', value: 'employeeId' },
          { label: 'Employee Name', value: 'employeeName' },
          { label: 'UAN', value: 'uan' },
          { label: 'PF Account No', value: 'pfAccountNumber' },
          { label: 'PF Wage Base (Rs)', value: 'pfWageBase' },
          { label: 'Employee Share (12%)', value: 'employeeContribution' },
          { label: 'Employer Share (12%)', value: 'employerContribution' },
          { label: 'Total PF Pool', value: 'totalPfAmount' },
          { label: 'Remittance Status', value: 'remittanceStatus' },
          { label: 'Challan TRRN / Ref', value: 'challanNumber' },
          { label: 'Remittance Date', value: (r) => r.remittanceDate ? new Date(r.remittanceDate).toLocaleDateString('en-IN') : '' }
        ];
        reportRows = pfRecords;
        reportFields = fields;
        csvData = convertToCSV(pfRecords, fields);
        filename = `Navadurga_Employee_PF_Statutory_Register_${Date.now()}.csv`;
        break;
      }

      case 'delivery-challans': {
        const DeliveryChallan = require('../models/DeliveryChallan');
        const challans = await DeliveryChallan.find({}).sort('-challanDate');
        const rows = [];
        challans.forEach(ch => {
          (ch.items || []).forEach(itm => {
            rows.push({
              challanNumber: ch.challanNumber,
              challanDate: new Date(ch.challanDate).toLocaleDateString('en-IN'),
              client: ch.clientSnapshot?.companyName || '',
              deliveryType: ch.deliveryType,
              projectOrWorkOrder: ch.projectOrWorkOrder || '',
              status: ch.status,
              itemCode: itm.itemCode,
              description: itm.description,
              quantityDispatched: itm.quantityDispatched,
              quantityDelivered: itm.quantityDelivered,
              unit: itm.unit,
              batchOrSerialNo: itm.batchOrSerialNo || '',
              transporter: ch.transporterName || '',
              vehicleNumber: ch.vehicleNumber || ''
            });
          });
        });
        const fields = [
          { label: 'Challan Number', value: 'challanNumber' },
          { label: 'Challan Date', value: 'challanDate' },
          { label: 'Client', value: 'client' },
          { label: 'Delivery Type', value: 'deliveryType' },
          { label: 'Project / WO', value: 'projectOrWorkOrder' },
          { label: 'Challan Status', value: 'status' },
          { label: 'Item Code', value: 'itemCode' },
          { label: 'Item Description', value: 'description' },
          { label: 'Qty Dispatched', value: 'quantityDispatched' },
          { label: 'Qty Delivered', value: 'quantityDelivered' },
          { label: 'Unit', value: 'unit' },
          { label: 'Batch / S.No', value: 'batchOrSerialNo' },
          { label: 'Transporter', value: 'transporter' },
          { label: 'Vehicle Number', value: 'vehicleNumber' }
        ];
        reportRows = rows;
        reportFields = fields;
        csvData = convertToCSV(rows, fields);
        filename = `Navadurga_Delivery_Challans_Register_${Date.now()}.csv`;
        break;
      }

      case 'material-invoices': {
        const Invoice = require('../models/Invoice');
        const matInvoices = await Invoice.find({ invoiceType: 'Material' }).sort('-invoiceDate');
        const fields = [
          { label: 'Invoice Number', value: 'invoiceNumber' },
          { label: 'Invoice Date', value: (r) => new Date(r.invoiceDate).toLocaleDateString('en-IN') },
          { label: 'Due Date', value: (r) => new Date(r.dueDate).toLocaleDateString('en-IN') },
          { label: 'Client', value: (r) => r.clientSnapshot?.companyName || '' },
          { label: 'Project / WO', value: 'projectOrWorkOrder' },
          { label: 'Linked Challans', value: (r) => (r.linkedChallanNumbers || []).join('; ') },
          { label: 'Taxable Value', value: 'totalTaxableAmount' },
          { label: 'Total Tax', value: 'totalTax' },
          { label: 'Grand Total', value: 'grandTotal' },
          { label: 'Amount Paid', value: 'amountPaid' },
          { label: 'Outstanding Balance', value: 'outstandingBalance' },
          { label: 'Status', value: 'status' }
        ];
        reportRows = matInvoices;
        reportFields = fields;
        csvData = convertToCSV(matInvoices, fields);
        filename = `Navadurga_Material_Invoices_${Date.now()}.csv`;
        break;
      }

      default:
        return res.status(400).json({ success: false, message: 'Invalid report type' });
    }

    if (req.query.format === 'pdf') {
      const reportTitles = {
        clients: 'Client Directory Register',
        invoices: 'Tax Invoices Master Register',
        'material-invoices': 'Material Invoices Register',
        'delivery-challans': 'Delivery Challans Register',
        employees: 'Employee Directory & Salary Register',
        payroll: 'Monthly Payroll Register',
        'employee-pf': 'EPFO Statutory PF Register',
        'pf-documents': 'PF Documents & Quotations Register',
        advances: 'Advance Receipts & Retainer Ledger',
        quantities: 'Quantity Deliverables Register',
        services: 'Services & Rate Catalog Report'
      };
      const settings = await CompanySettings.findOne().lean();
      const supportsDateRange = ['invoices', 'pf-documents', 'advances', 'quantities'].includes(type);
      const period = supportsDateRange && (startDate || endDate)
        ? `${startDate || 'Start'} to ${endDate || 'Present'}`
        : 'All available dates';
      const pdfBuffer = await generateReportPDF({
        rows: reportRows,
        fields: reportFields,
        reportTitle: reportTitles[type],
        companyName: settings?.companyName || 'Navadurga Electricals',
        period
      });

      filename = filename.replace(/\.csv$/i, '.pdf');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Report-Empty', String(reportRows.length === 0));
      return res.status(200).send(pdfBuffer);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvData);
  } catch (error) {
    next(error);
  }
};
