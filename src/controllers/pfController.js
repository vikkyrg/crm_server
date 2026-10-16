const PFDocument = require('../models/PFDocument');
const Client = require('../models/Client');
const Service = require('../models/Service');
const Invoice = require('../models/Invoice');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');
const { calculateDocumentTotals } = require('../utils/financials');
const { generateDocumentPDF, generateDocumentDocx } = require('../utils/documentGenerator');

// @desc    Get all PF documents with search, date range, client, status filters, and pagination
// @route   GET /api/pf-documents
// @access  Private
exports.getPFDocuments = async (req, res, next) => {
  try {
    const { search, client, status, startDate, endDate, page = 1, limit = 20, sort = '-documentDate' } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { pfNumber: { $regex: search, $options: 'i' } },
        { 'clientSnapshot.companyName': { $regex: search, $options: 'i' } },
        { 'clientSnapshot.contactPerson': { $regex: search, $options: 'i' } }
      ];
    }

    if (client) {
      query.client = client;
    }

    if (status) {
      query.status = status;
    }

    if (startDate || endDate) {
      query.documentDate = {};
      if (startDate) query.documentDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.documentDate.$lte = end;
      }
    }

    const total = await PFDocument.countDocuments(query);
    const documents = await PFDocument.find(query)
      .populate('client', 'companyName clientId')
      .populate('assignedEmployee', 'name email employeeId')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      data: documents
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single PF document
// @route   GET /api/pf-documents/:id
// @access  Private
exports.getPFDocument = async (req, res, next) => {
  try {
    const document = await PFDocument.findById(req.params.id)
      .populate('client')
      .populate('assignedEmployee', 'name email employeeId');

    if (!document) {
      return res.status(404).json({ success: false, message: 'PF Document not found' });
    }

    res.status(200).json({ success: true, data: document });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new PF document
// @route   POST /api/pf-documents
// @access  Private
exports.createPFDocument = async (req, res, next) => {
  try {
    const {
      clientId,
      documentDate,
      validityDate,
      items,
      documentDiscount = 0,
      notes,
      termsAndConditions,
      assignedEmployee
    } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client is required' });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one line item is required' });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const companySettings = await CompanySettings.findOne() || {};

    // Check inter-state vs intra-state supply
    const clientStateCode = (client.stateCode || '').trim();
    const companyStateCode = (companySettings.stateCode || '09').trim();
    const isInterState = Boolean(clientStateCode && companyStateCode && clientStateCode !== companyStateCode);

    // Backend authoritative calculations
    const totals = calculateDocumentTotals(items, documentDiscount, isInterState, companySettings.roundingPolicy !== 'none');

    // Generate atomic sequential PF number
    const prefix = companySettings.pfPrefix || 'PF-2026-';
    let candidatePfNum = '';
    let isUnique = false;
    while (!isUnique) {
      const seq = await getNextSequence('pfNumber');
      candidatePfNum = `${prefix}${String(seq).padStart(5, '0')}`;
      const exists = await PFDocument.findOne({ pfNumber: candidatePfNum });
      if (!exists) {
        isUnique = true;
      }
    }
    const pfNumber = candidatePfNum;

    const newPF = await PFDocument.create({
      pfNumber,
      documentDate: documentDate || new Date(),
      validityDate,
      client: client._id,
      clientSnapshot: {
        companyName: client.companyName,
        contactPerson: client.contactPerson,
        primaryPhone: client.primaryPhone,
        email: client.email,
        gstin: client.gstin,
        pan: client.pan,
        billingAddress: client.billingAddress,
        city: client.city,
        state: client.state,
        stateCode: client.stateCode,
        pincode: client.pincode
      },
      assignedEmployee: assignedEmployee || client.assignedEmployee,
      items: totals.items,
      documentDiscount: totals.documentDiscount,
      subtotal: totals.subtotal,
      totalTaxableAmount: totals.totalTaxableAmount,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      totalTax: totals.totalTax,
      roundOffAdjustment: totals.roundOffAdjustment,
      grandTotal: totals.grandTotal,
      notes: notes || companySettings.defaultNotes,
      termsAndConditions: termsAndConditions || companySettings.defaultPaymentTerms,
      status: 'Draft',
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      data: newPF,
      message: 'PF Document created successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update draft PF document
// @route   PUT /api/pf-documents/:id
// @access  Private
exports.updatePFDocument = async (req, res, next) => {
  try {
    const pf = await PFDocument.findById(req.params.id);
    if (!pf) {
      return res.status(404).json({ success: false, message: 'PF Document not found' });
    }

    if (pf.status === 'Converted to Invoice') {
      // Allow editing notes, terms, validity date, and assigned employee without corrupting the linked invoice lines
      if (req.body.notes !== undefined) pf.notes = req.body.notes;
      if (req.body.termsAndConditions !== undefined) pf.termsAndConditions = req.body.termsAndConditions;
      if (req.body.validityDate !== undefined) pf.validityDate = req.body.validityDate;
      if (req.body.assignedEmployee) pf.assignedEmployee = req.body.assignedEmployee;
      await pf.save();

      return res.status(200).json({
        success: true,
        data: pf,
        message: 'PF Document notes and terms updated (line items locked to match linked Tax Invoice)'
      });
    }

    const {
      documentDate,
      validityDate,
      items,
      documentDiscount,
      notes,
      termsAndConditions,
      status,
      assignedEmployee
    } = req.body;

    const companySettings = await CompanySettings.findOne() || {};
    const clientStateCode = (pf.clientSnapshot?.stateCode || '').trim();
    const companyStateCode = (companySettings.stateCode || '09').trim();
    const isInterState = Boolean(clientStateCode && companyStateCode && clientStateCode !== companyStateCode);

    if (items && items.length > 0) {
      const totals = calculateDocumentTotals(items, documentDiscount !== undefined ? documentDiscount : pf.documentDiscount, isInterState, companySettings.roundingPolicy !== 'none');
      pf.items = totals.items;
      pf.documentDiscount = totals.documentDiscount;
      pf.subtotal = totals.subtotal;
      pf.totalTaxableAmount = totals.totalTaxableAmount;
      pf.cgstTotal = totals.cgstTotal;
      pf.sgstTotal = totals.sgstTotal;
      pf.igstTotal = totals.igstTotal;
      pf.totalTax = totals.totalTax;
      pf.roundOffAdjustment = totals.roundOffAdjustment;
      pf.grandTotal = totals.grandTotal;
    }

    if (documentDate) pf.documentDate = documentDate;
    if (validityDate !== undefined) pf.validityDate = validityDate;
    if (notes !== undefined) pf.notes = notes;
    if (termsAndConditions !== undefined) pf.termsAndConditions = termsAndConditions;
    if (status) pf.status = status;
    if (assignedEmployee) pf.assignedEmployee = assignedEmployee;

    await pf.save();

    res.status(200).json({
      success: true,
      data: pf,
      message: 'PF Document updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Convert accepted PF to official Invoice
// @route   POST /api/pf-documents/:id/convert-to-invoice
// @access  Private
exports.convertPFToInvoice = async (req, res, next) => {
  try {
    const pf = await PFDocument.findById(req.params.id);
    if (!pf) {
      return res.status(404).json({ success: false, message: 'PF Document not found' });
    }

    if (pf.convertedToInvoiceId) {
      return res.status(400).json({
        success: false,
        message: `This PF has already been converted to Invoice ${pf.convertedToInvoiceNumber}`
      });
    }

    const companySettings = await CompanySettings.findOne() || {};
    const prefix = companySettings.invoicePrefix || 'INV-2026-';
    const seq = await getNextSequence('invoiceNumber');
    const invoiceNumber = `${prefix}${String(seq).padStart(5, '0')}`;

    // Due date default: +15 days
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const invoice = await Invoice.create({
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate,
      client: pf.client,
      clientSnapshot: pf.clientSnapshot,
      relatedPFDocument: pf._id,
      relatedPFNumber: pf.pfNumber,
      items: pf.items,
      documentDiscount: pf.documentDiscount,
      subtotal: pf.subtotal,
      totalTaxableAmount: pf.totalTaxableAmount,
      cgstTotal: pf.cgstTotal,
      sgstTotal: pf.sgstTotal,
      igstTotal: pf.igstTotal,
      totalTax: pf.totalTax,
      roundOffAdjustment: pf.roundOffAdjustment,
      grandTotal: pf.grandTotal,
      amountPaid: 0,
      creditAdjustment: 0,
      outstandingBalance: pf.grandTotal,
      status: 'Issued',
      paymentTerms: pf.termsAndConditions || companySettings.defaultPaymentTerms,
      notes: pf.notes || companySettings.defaultNotes,
      createdBy: req.user._id
    });

    pf.status = 'Converted to Invoice';
    pf.convertedToInvoiceId = invoice._id;
    pf.convertedToInvoiceNumber = invoice.invoiceNumber;
    await pf.save();

    res.status(201).json({
      success: true,
      data: invoice,
      message: `PF ${pf.pfNumber} successfully converted to Invoice ${invoice.invoiceNumber}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Download PF Document as PDF
// @route   GET /api/pf-documents/:id/pdf
// @access  Private
exports.downloadPFPDF = async (req, res, next) => {
  try {
    const pf = await PFDocument.findById(req.params.id);
    if (!pf) {
      return res.status(404).json({ success: false, message: 'PF Document not found' });
    }

    const settings = await CompanySettings.findOne() || {};
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pf.pfNumber}.pdf"`);

    generateDocumentPDF(pf, 'PF', settings, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Download PF Document as Word .docx
// @route   GET /api/pf-documents/:id/docx
// @access  Private
exports.downloadPFDocx = async (req, res, next) => {
  try {
    const pf = await PFDocument.findById(req.params.id);
    if (!pf) {
      return res.status(404).json({ success: false, message: 'PF Document not found' });
    }

    const settings = await CompanySettings.findOne() || {};
    const buffer = await generateDocumentDocx(pf, 'PF', settings);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${pf.pfNumber}.docx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

// @desc    Delete PF Document with financial safeguards
// @route   DELETE /api/pf-documents/:id
// @access  Private
exports.deletePFDocument = async (req, res, next) => {
  try {
    const pf = await PFDocument.findById(req.params.id);
    if (!pf) {
      return res.status(404).json({ success: false, message: 'PF Document not found' });
    }

    // Financial safeguard: converted PF documents cannot be deleted if linked to an existing Tax Invoice
    if (pf.convertedToInvoiceId) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete PF Document ${pf.pfNumber}. It has already been converted to Tax Invoice ${pf.convertedToInvoiceNumber || ''}. Deletion is blocked to preserve financial history and audit trail.`
      });
    }

    // Also check if any invoice references this PF
    const linkedInvoice = await Invoice.findOne({ relatedPFDocument: pf._id });
    if (linkedInvoice) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete PF Document ${pf.pfNumber}. It is linked to Tax Invoice ${linkedInvoice.invoiceNumber}.`
      });
    }

    await PFDocument.findByIdAndDelete(pf._id);

    res.status(200).json({
      success: true,
      message: `PF Document ${pf.pfNumber} has been permanently deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

