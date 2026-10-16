const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const AdvancePayment = require('../models/AdvancePayment');
const PFDocument = require('../models/PFDocument');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');
const { calculateDocumentTotals, round2 } = require('../utils/financials');
const { generateDocumentPDF, generateDocumentDocx } = require('../utils/documentGenerator');

// @desc    Get all invoices with filtering, status, date range, client, and pagination
// @route   GET /api/invoices
// @access  Private
exports.getInvoices = async (req, res, next) => {
  try {
    const { search, client, status, startDate, endDate, overdueOnly, page = 1, limit = 20, sort = '-invoiceDate' } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
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

    if (req.query.invoiceType) {
      query.invoiceType = req.query.invoiceType;
    }

    if (overdueOnly === 'true') {
      query.dueDate = { $lt: new Date() };
      query.outstandingBalance = { $gt: 0 };
      query.status = { $nin: ['Paid', 'Cancelled'] };
    }

    if (startDate || endDate) {
      query.invoiceDate = {};
      if (startDate) query.invoiceDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.invoiceDate.$lte = end;
      }
    }

    const total = await Invoice.countDocuments(query);
    const invoices = await Invoice.find(query)
      .populate('client', 'companyName clientId')
      .populate('relatedPFDocument', 'pfNumber')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      data: invoices
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single invoice with real payment history
// @route   GET /api/invoices/:id
// @access  Private
exports.getInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('client')
      .populate('relatedPFDocument', 'pfNumber documentDate status');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new invoice with authoritative calculations
// @route   POST /api/invoices
// @access  Private
exports.createInvoice = async (req, res, next) => {
  try {
    const {
      clientId,
      invoiceDate,
      dueDate,
      items,
      documentDiscount = 0,
      notes,
      paymentTerms,
      relatedPFDocument,
      advanceAllocations, // Optional array of { advanceId, amount } to apply at creation
      invoiceType,
      projectOrWorkOrder,
      linkedChallans,
      linkedChallanNumbers
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

    // Safeguard: If converting a PF Document, ensure it has not already been converted
    let pfDoc = null;
    if (relatedPFDocument) {
      const PFDocument = require('../models/PFDocument');
      pfDoc = await PFDocument.findById(relatedPFDocument);
      if (!pfDoc) {
        return res.status(404).json({ success: false, message: 'Associated PF Document not found' });
      }
      if (pfDoc.convertedToInvoiceId) {
        return res.status(400).json({
          success: false,
          message: `This PF Document (${pfDoc.pfNumber}) has already been converted to Invoice ${pfDoc.convertedToInvoiceNumber}`
        });
      }
    }

    const companySettings = await CompanySettings.findOne() || {};

    const clientStateCode = (client.stateCode || '').trim();
    const companyStateCode = (companySettings.stateCode || '09').trim();
    const isInterState = Boolean(clientStateCode && companyStateCode && clientStateCode !== companyStateCode);

    // Backend authoritative calculations
    const totals = calculateDocumentTotals(items, documentDiscount, isInterState, companySettings.roundingPolicy !== 'none');

    // Generate atomic sequential invoice number
    const prefix = companySettings.invoicePrefix || 'INV-2026-';
    let candidateInvoiceNum = '';
    let isUnique = false;
    while (!isUnique) {
      const seq = await getNextSequence('invoiceNumber');
      candidateInvoiceNum = `${prefix}${String(seq).padStart(5, '0')}`;
      const exists = await Invoice.findOne({ invoiceNumber: candidateInvoiceNum });
      if (!exists) {
        isUnique = true;
      }
    }
    const invoiceNumber = candidateInvoiceNum;

    // Due date fallback
    let finalDueDate = dueDate;
    if (!finalDueDate) {
      finalDueDate = new Date();
      finalDueDate.setDate(finalDueDate.getDate() + 15);
    }

    // Validate advance allocations or direct advanceAmount if provided
    let totalAdvanceApplied = 0;
    const validatedAllocations = [];
    const directAdvanceNum = round2(Number(req.body.advanceAmount || 0));

    if (directAdvanceNum < 0) {
      return res.status(400).json({
        success: false,
        message: 'Advance amount cannot be negative'
      });
    }

    if (directAdvanceNum > totals.grandTotal) {
      return res.status(400).json({
        success: false,
        message: `Advance amount (₹${directAdvanceNum}) cannot exceed invoice total (₹${totals.grandTotal})`
      });
    }

    if (Array.isArray(advanceAllocations) && advanceAllocations.length > 0) {
      for (const alloc of advanceAllocations) {
        const allocAmt = round2(Number(alloc.amount));
        if (allocAmt > 0 && alloc.advanceId) {
          const adv = await AdvancePayment.findById(alloc.advanceId);
          if (!adv) {
            return res.status(404).json({ success: false, message: `Advance payment ${alloc.advanceId} not found` });
          }
          if (adv.client.toString() !== client._id.toString()) {
            return res.status(400).json({ success: false, message: `Advance ${adv.receiptNumber} does not belong to client ${client.companyName}` });
          }
          if (adv.status === 'Reversed') {
            return res.status(400).json({ success: false, message: `Advance ${adv.receiptNumber} is Reversed and cannot be applied` });
          }
          if (allocAmt > adv.unallocatedAmount) {
            return res.status(400).json({
              success: false,
              message: `Advance ${adv.receiptNumber} only has ₹${adv.unallocatedAmount} available, cannot apply ₹${allocAmt}`
            });
          }
          totalAdvanceApplied = round2(totalAdvanceApplied + allocAmt);
          validatedAllocations.push({ adv, allocAmt });
        }
      }

      if (totalAdvanceApplied > totals.grandTotal) {
        return res.status(400).json({
          success: false,
          message: `Total advance applied (₹${totalAdvanceApplied}) cannot exceed invoice total (₹${totals.grandTotal})`
        });
      }
    } else if (directAdvanceNum > 0) {
      // Automatic allocation from client's existing verified advances (FIFO)
      let remainingToApply = directAdvanceNum;
      const clientAdvances = await AdvancePayment.find({
        client: client._id,
        status: 'Verified',
        unallocatedAmount: { $gt: 0 }
      }).sort('paymentDate');

      for (const adv of clientAdvances) {
        if (remainingToApply <= 0) break;
        const allocAmt = round2(Math.min(adv.unallocatedAmount, remainingToApply));
        if (allocAmt > 0) {
          validatedAllocations.push({ adv, allocAmt });
          totalAdvanceApplied = round2(totalAdvanceApplied + allocAmt);
          remainingToApply = round2(remainingToApply - allocAmt);
        }
      }

      // If the client does not have enough existing advance to cover directAdvanceNum,
      // create a formal AdvancePayment record for the remainder to ensure accounting integrity (real payment persistence)
      if (remainingToApply > 0) {
        const prefixAdv = companySettings.advancePrefix || 'ADV-2026-';
        const seqAdv = await getNextSequence('advanceReceiptNumber');
        const receiptNumberAdv = `${prefixAdv}${String(seqAdv).padStart(5, '0')}`;

        const newAdv = await AdvancePayment.create({
          receiptNumber: receiptNumberAdv,
          client: client._id,
          clientSnapshot: {
            companyName: client.companyName,
            contactPerson: client.contactPerson,
            primaryPhone: client.primaryPhone,
            email: client.email,
            city: client.city,
            state: client.state
          },
          paymentDate: invoiceDate || new Date(),
          amount: remainingToApply,
          allocatedAmount: 0,
          unallocatedAmount: remainingToApply,
          paymentMethod: req.body.advancePaymentMethod || 'Bank Transfer',
          transactionReference: req.body.advanceTransactionReference || `DIRECT-ADV-${receiptNumberAdv}`,
          notes: req.body.advanceNotes || `Advance recorded directly on Invoice Creation`,
          status: 'Verified',
          createdBy: req.user._id
        });

        validatedAllocations.push({ adv: newAdv, allocAmt: remainingToApply });
        totalAdvanceApplied = round2(totalAdvanceApplied + remainingToApply);
        remainingToApply = 0;
      }
    }

    const initialPaid = totalAdvanceApplied;
    const initialBalance = round2(totals.grandTotal - initialPaid);
    let initialStatus = 'Issued';
    if (initialBalance <= 0) {
      initialStatus = 'Paid';
    } else if (initialPaid > 0) {
      initialStatus = 'Partially Paid';
    }

    const invoice = await Invoice.create({
      invoiceNumber,
      invoiceDate: invoiceDate || new Date(),
      dueDate: finalDueDate,
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
      relatedPFDocument: pfDoc ? pfDoc._id : (relatedPFDocument || null),
      relatedPFNumber: pfDoc ? pfDoc.pfNumber : null,
      invoiceType: invoiceType || 'Service',
      projectOrWorkOrder: projectOrWorkOrder || '',
      linkedChallans: linkedChallans || [],
      linkedChallanNumbers: linkedChallanNumbers || [],
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
      advanceAmount: totalAdvanceApplied,
      amountPaid: initialPaid,
      creditAdjustment: 0,
      outstandingBalance: initialBalance,
      status: initialStatus,
      paymentTerms: paymentTerms || companySettings.defaultPaymentTerms,
      notes: notes || companySettings.defaultNotes,
      createdBy: req.user._id
    });

    // If linked to Delivery Challan(s), update Challan linkage and status
    if (linkedChallans && Array.isArray(linkedChallans) && linkedChallans.length > 0) {
      const DeliveryChallan = require('../models/DeliveryChallan');
      for (const chId of linkedChallans) {
        await DeliveryChallan.findByIdAndUpdate(chId, {
          $addToSet: { invoices: invoice._id },
          status: 'Invoiced'
        });
      }
    }

    // Process advance records and persist allocations
    for (const { adv, allocAmt } of validatedAllocations) {
      adv.allocatedAmount = round2(adv.allocatedAmount + allocAmt);
      adv.unallocatedAmount = round2(adv.amount - adv.allocatedAmount);
      adv.allocations.push({
        invoice: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        allocatedAmount: allocAmt,
        allocatedAt: new Date(),
        allocatedBy: req.user._id,
        notes: `Applied on Invoice Creation (${invoice.invoiceNumber})`
      });
      await adv.save();

      invoice.paymentHistory.push({
        paymentDate: new Date(),
        amount: allocAmt,
        paymentMethod: 'Advance Allocation',
        reference: adv.receiptNumber,
        advancePaymentId: adv._id,
        notes: `Settled via Advance Receipt ${adv.receiptNumber}`,
        recordedBy: req.user._id,
        recordedAt: new Date()
      });
    }

    if (validatedAllocations.length > 0) {
      await invoice.save();
    }

    // Mark PF document as converted if applicable
    if (pfDoc) {
      pfDoc.status = 'Converted to Invoice';
      pfDoc.convertedToInvoiceId = invoice._id;
      pfDoc.convertedToInvoiceNumber = invoice.invoiceNumber;
      await pfDoc.save();
    }

    res.status(201).json({
      success: true,
      data: invoice,
      message: pfDoc
        ? `PF ${pfDoc.pfNumber} successfully converted to Invoice ${invoice.invoiceNumber}`
        : 'Invoice created successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update draft invoice
// @route   PUT /api/invoices/:id
// @access  Private
exports.updateInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Only Draft invoices or non-financial fields on Issued invoices can be edited
    if (invoice.status === 'Paid' || invoice.amountPaid > 0) {
      // Allow only notes/terms updating to preserve financial integrity
      invoice.notes = req.body.notes !== undefined ? req.body.notes : invoice.notes;
      invoice.paymentTerms = req.body.paymentTerms !== undefined ? req.body.paymentTerms : invoice.paymentTerms;
      if (req.body.dueDate) invoice.dueDate = req.body.dueDate;
      await invoice.save();

      return res.status(200).json({
        success: true,
        data: invoice,
        message: 'Invoice terms and notes updated (financial lines locked due to payments)'
      });
    }

    const {
      invoiceDate,
      dueDate,
      items,
      documentDiscount,
      notes,
      paymentTerms,
      status
    } = req.body;

    const companySettings = await CompanySettings.findOne() || {};
    const clientStateCode = (invoice.clientSnapshot?.stateCode || '').trim();
    const companyStateCode = (companySettings.stateCode || '09').trim();
    const isInterState = Boolean(clientStateCode && companyStateCode && clientStateCode !== companyStateCode);

    if (items && items.length > 0) {
      const totals = calculateDocumentTotals(items, documentDiscount !== undefined ? documentDiscount : invoice.documentDiscount, isInterState, companySettings.roundingPolicy !== 'none');
      invoice.items = totals.items;
      invoice.documentDiscount = totals.documentDiscount;
      invoice.subtotal = totals.subtotal;
      invoice.totalTaxableAmount = totals.totalTaxableAmount;
      invoice.cgstTotal = totals.cgstTotal;
      invoice.sgstTotal = totals.sgstTotal;
      invoice.igstTotal = totals.igstTotal;
      invoice.totalTax = totals.totalTax;
      invoice.roundOffAdjustment = totals.roundOffAdjustment;
      invoice.grandTotal = totals.grandTotal;
      invoice.outstandingBalance = round2(totals.grandTotal - (invoice.amountPaid || 0) - (invoice.creditAdjustment || 0));
    }

    if (invoiceDate) invoice.invoiceDate = invoiceDate;
    if (dueDate) invoice.dueDate = dueDate;
    if (notes !== undefined) invoice.notes = notes;
    if (paymentTerms !== undefined) invoice.paymentTerms = paymentTerms;
    if (status) invoice.status = status;

    await invoice.save();

    res.status(200).json({
      success: true,
      data: invoice,
      message: 'Invoice updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Record manual invoice direct payment
// @route   POST /api/invoices/:id/payments
// @access  Private
exports.recordInvoicePayment = async (req, res, next) => {
  try {
    const { amount, paymentDate, paymentMethod, reference, notes } = req.body;
    const paymentAmount = round2(Number(amount));

    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (paymentAmount > invoice.outstandingBalance) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (₹${paymentAmount}) cannot exceed outstanding balance (₹${invoice.outstandingBalance})`
      });
    }

    // Add to payment history
    invoice.paymentHistory.push({
      paymentDate: paymentDate || new Date(),
      amount: paymentAmount,
      paymentMethod: paymentMethod || 'Bank Transfer',
      reference,
      notes,
      recordedBy: req.user._id,
      recordedAt: new Date()
    });

    invoice.amountPaid = round2(invoice.amountPaid + paymentAmount);
    invoice.outstandingBalance = round2(invoice.grandTotal - invoice.amountPaid - invoice.creditAdjustment);

    if (invoice.outstandingBalance <= 0) {
      invoice.status = 'Paid';
    } else {
      invoice.status = 'Partially Paid';
    }

    await invoice.save();

    res.status(200).json({
      success: true,
      data: invoice,
      message: `Payment of ₹${paymentAmount} recorded successfully against ${invoice.invoiceNumber}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Download Invoice as PDF
// @route   GET /api/invoices/:id/pdf
// @access  Private
exports.downloadInvoicePDF = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const settings = await CompanySettings.findOne() || {};
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);

    generateDocumentPDF(invoice, 'INVOICE', settings, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Download Invoice as Word .docx
// @route   GET /api/invoices/:id/docx
// @access  Private
exports.downloadInvoiceDocx = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const settings = await CompanySettings.findOne() || {};
    const buffer = await generateDocumentDocx(invoice, 'INVOICE', settings);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.docx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

// @desc    Delete Invoice with strict financial safeguards
// @route   DELETE /api/invoices/:id
// @access  Private
exports.deleteInvoice = async (req, res, next) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // 1. Safeguard: Check recorded payments
    if ((invoice.amountPaid && invoice.amountPaid > 0) || (invoice.paymentHistory && invoice.paymentHistory.length > 0)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Invoice ${invoice.invoiceNumber}. Payments totalling ₹${invoice.amountPaid || 0} have been recorded against this invoice. To protect audit integrity and balance consistency, permanent deletion of paid or partially paid invoices is restricted.`
      });
    }

    // 2. Safeguard: Check if any Advance Payment has allocations against this invoice
    const linkedAdvances = await AdvancePayment.find({
      'allocations.invoice': invoice._id
    });

    if (linkedAdvances && linkedAdvances.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Invoice ${invoice.invoiceNumber}. It has advance allocations linked to receipt(s) ${linkedAdvances.map(a => a.receiptNumber).join(', ')}. Please deallocate advances first before attempting deletion.`
      });
    }

    // 3. Safeguard: If invoice was created from a PF document, preserve or safely reset the PF document
    if (invoice.relatedPFDocument) {
      const pf = await PFDocument.findById(invoice.relatedPFDocument);
      if (pf) {
        // Reset PF document conversion state back to Accepted so client history is preserved cleanly
        pf.status = 'Accepted';
        pf.convertedToInvoiceId = null;
        pf.convertedToInvoiceNumber = null;
        await pf.save();
      }
    }

    // 4. Safeguard: If invoice is linked to Delivery Challan(s), unlink and update their status
    if (invoice.linkedChallans && invoice.linkedChallans.length > 0) {
      const DeliveryChallan = require('../models/DeliveryChallan');
      for (const chId of invoice.linkedChallans) {
        const challan = await DeliveryChallan.findById(chId);
        if (challan) {
          challan.invoices = challan.invoices.filter(invId => invId.toString() !== invoice._id.toString());
          if (challan.invoices.length === 0) {
            // Restore status based on delivery progress
            challan.status = challan.actualDeliveryDate || challan.receivedBy?.name ? 'Delivered' : 'Issued';
          }
          await challan.save();
        }
      }
    }

    // 5. Delete invoice record safely
    await Invoice.findByIdAndDelete(invoice._id);

    res.status(200).json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} has been permanently deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

