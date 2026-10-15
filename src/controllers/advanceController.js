const AdvancePayment = require('../models/AdvancePayment');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');
const { round2 } = require('../utils/financials');
const { generateAdvanceReceiptPDF } = require('../utils/receiptGenerator');

// @desc    Get all advance payments
// @route   GET /api/advances
// @access  Private
exports.getAdvances = async (req, res, next) => {
  try {
    const { search, client, status, paymentMethod, startDate, endDate, page = 1, limit = 20, sort = '-paymentDate' } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { receiptNumber: { $regex: search, $options: 'i' } },
        { 'clientSnapshot.companyName': { $regex: search, $options: 'i' } },
        { transactionReference: { $regex: search, $options: 'i' } }
      ];
    }

    if (client) query.client = client;
    if (status) query.status = status;
    if (paymentMethod) query.paymentMethod = paymentMethod;

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) query.paymentDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.paymentDate.$lte = end;
      }
    }

    const total = await AdvancePayment.countDocuments(query);
    const advances = await AdvancePayment.find(query)
      .populate('client', 'companyName clientId')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      data: advances
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single advance payment
// @route   GET /api/advances/:id
// @access  Private
exports.getAdvance = async (req, res, next) => {
  try {
    const advance = await AdvancePayment.findById(req.params.id)
      .populate('client')
      .populate('allocations.invoice', 'invoiceNumber grandTotal outstandingBalance status');

    if (!advance) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    res.status(200).json({ success: true, data: advance });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new advance payment
// @route   POST /api/advances
// @access  Private
exports.createAdvance = async (req, res, next) => {
  try {
    const { clientId, amount, paymentDate, paymentMethod, transactionReference, bankDetails, associatedProject, notes } = req.body;

    const parsedAmount = round2(Number(amount));
    if (!clientId || !parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Client and a positive amount are required' });
    }

    const selectedMethod = paymentMethod || 'Bank Transfer';
    const trimmedRef = transactionReference ? String(transactionReference).trim() : '';

    // Enforce reference for non-cash payment methods (Bank Transfer, NEFT/RTGS, UPI, Cheque)
    if (['Bank Transfer', 'NEFT/RTGS', 'UPI', 'Cheque'].includes(selectedMethod) && !trimmedRef) {
      return res.status(400).json({
        success: false,
        message: `Transaction reference / UTR / Cheque number is required for ${selectedMethod}`
      });
    }

    // Prevent duplicate transaction references across active (non-reversed) advances
    if (trimmedRef) {
      const existingRef = await AdvancePayment.findOne({
        transactionReference: { $regex: new RegExp(`^${trimmedRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        status: { $ne: 'Reversed' }
      });
      if (existingRef) {
        return res.status(400).json({
          success: false,
          message: `An active advance payment (${existingRef.receiptNumber}) already exists with transaction reference '${trimmedRef}'`
        });
      }
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const companySettings = await CompanySettings.findOne() || {};
    const prefix = companySettings.advancePrefix || 'ADV-2026-';
    const seq = await getNextSequence('advanceReceiptNumber');
    const receiptNumber = `${prefix}${String(seq).padStart(5, '0')}`;

    const advance = await AdvancePayment.create({
      receiptNumber,
      client: client._id,
      clientSnapshot: {
        companyName: client.companyName,
        contactPerson: client.contactPerson,
        primaryPhone: client.primaryPhone,
        email: client.email,
        city: client.city,
        state: client.state
      },
      paymentDate: paymentDate || new Date(),
      amount: parsedAmount,
      allocatedAmount: 0,
      unallocatedAmount: parsedAmount,
      paymentMethod: selectedMethod,
      transactionReference: trimmedRef || undefined,
      bankDetails,
      associatedProject,
      notes,
      status: 'Verified',
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      data: advance,
      message: `Advance payment receipt ${receiptNumber} generated successfully`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Allocate advance to an invoice safely
// @route   POST /api/advances/:id/allocate
// @access  Private
exports.allocateAdvance = async (req, res, next) => {
  try {
    const { invoiceId, amount, notes } = req.body;
    const allocAmount = round2(Number(amount));

    if (!invoiceId || !allocAmount || allocAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invoice ID and a positive allocation amount are required' });
    }

    const advance = await AdvancePayment.findById(req.params.id);
    if (!advance) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    if (advance.status === 'Reversed') {
      return res.status(400).json({ success: false, message: 'Cannot allocate from a reversed advance payment' });
    }

    if (allocAmount > advance.unallocatedAmount) {
      return res.status(400).json({
        success: false,
        message: `Allocation amount (₹${allocAmount}) exceeds available unallocated advance (₹${advance.unallocatedAmount})`
      });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Target invoice not found' });
    }

    // Verify invoice belongs to the same client
    if (invoice.client.toString() !== advance.client.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Advance payment client does not match target invoice client'
      });
    }

    if (allocAmount > invoice.outstandingBalance) {
      return res.status(400).json({
        success: false,
        message: `Allocation amount (₹${allocAmount}) exceeds invoice outstanding balance (₹${invoice.outstandingBalance})`
      });
    }

    // Perform atomic updates
    advance.allocatedAmount = round2(advance.allocatedAmount + allocAmount);
    advance.unallocatedAmount = round2(advance.amount - advance.allocatedAmount);
    advance.allocations.push({
      invoice: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      allocatedAmount: allocAmount,
      allocatedAt: new Date(),
      allocatedBy: req.user._id,
      notes: notes || `Allocated from Advance ${advance.receiptNumber}`
    });

    // Post to invoice payment history
    invoice.paymentHistory.push({
      paymentDate: new Date(),
      amount: allocAmount,
      paymentMethod: 'Advance Allocation',
      reference: advance.receiptNumber,
      advancePaymentId: advance._id,
      notes: notes || `Settled via Advance Receipt ${advance.receiptNumber}`,
      recordedBy: req.user._id,
      recordedAt: new Date()
    });

    invoice.amountPaid = round2(invoice.amountPaid + allocAmount);
    invoice.outstandingBalance = round2(invoice.grandTotal - invoice.amountPaid - invoice.creditAdjustment);

    if (invoice.outstandingBalance <= 0) {
      invoice.status = 'Paid';
    } else {
      invoice.status = 'Partially Paid';
    }

    await advance.save();
    await invoice.save();

    res.status(200).json({
      success: true,
      message: `Successfully allocated ₹${allocAmount} from Advance ${advance.receiptNumber} to Invoice ${invoice.invoiceNumber}`,
      data: {
        advance,
        invoice
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update advance payment (only unallocated/non-reversed details, or notes/refs)
// @route   PUT /api/advances/:id
// @access  Private (Administrator, Finance)
exports.updateAdvance = async (req, res, next) => {
  try {
    const advance = await AdvancePayment.findById(req.params.id);
    if (!advance) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    if (advance.status === 'Reversed') {
      // Allow editing notes, references, or restoring to Verified
      if (req.body.status === 'Verified') {
        advance.status = 'Verified';
        advance.unallocatedAmount = advance.amount - advance.allocatedAmount;
      }
      if (req.body.notes !== undefined) advance.notes = req.body.notes;
      if (req.body.transactionReference !== undefined) advance.transactionReference = req.body.transactionReference;
      if (req.body.bankDetails !== undefined) advance.bankDetails = req.body.bankDetails;
      if (req.body.associatedProject !== undefined) advance.associatedProject = req.body.associatedProject;

      await advance.save();
      return res.status(200).json({
        success: true,
        data: advance,
        message: 'Advance record updated'
      });
    }

    const { amount, paymentDate, paymentMethod, transactionReference, bankDetails, associatedProject, notes } = req.body;

    const newMethod = paymentMethod || advance.paymentMethod;
    const newRef = transactionReference !== undefined ? String(transactionReference).trim() : (advance.transactionReference || '');

    if (['Bank Transfer', 'NEFT/RTGS', 'UPI', 'Cheque'].includes(newMethod) && !newRef) {
      return res.status(400).json({
        success: false,
        message: `Transaction reference / UTR / Cheque number is required for ${newMethod}`
      });
    }

    if (newRef) {
      const existingRef = await AdvancePayment.findOne({
        _id: { $ne: advance._id },
        transactionReference: { $regex: new RegExp(`^${newRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        status: { $ne: 'Reversed' }
      });
      if (existingRef) {
        return res.status(400).json({
          success: false,
          message: `An active advance payment (${existingRef.receiptNumber}) already exists with transaction reference '${newRef}'`
        });
      }
    }

    // If amount is being changed, ensure it's not less than already allocated amount
    if (amount !== undefined) {
      const parsedAmount = round2(Number(amount));
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
      }

      if (parsedAmount < advance.allocatedAmount) {
        return res.status(400).json({
          success: false,
          message: `Cannot reduce advance amount below already allocated amount (₹${advance.allocatedAmount})`
        });
      }

      advance.amount = parsedAmount;
      advance.unallocatedAmount = round2(parsedAmount - advance.allocatedAmount);
    }

    if (paymentDate) advance.paymentDate = paymentDate;
    if (paymentMethod) advance.paymentMethod = paymentMethod;
    if (transactionReference !== undefined) advance.transactionReference = newRef || undefined;
    if (bankDetails !== undefined) advance.bankDetails = bankDetails;
    if (associatedProject !== undefined) advance.associatedProject = associatedProject;
    if (notes !== undefined) advance.notes = notes;

    await advance.save();

    res.status(200).json({
      success: true,
      data: advance,
      message: 'Advance payment updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reverse an advance payment with audit protection
// @route   POST /api/advances/:id/reverse
// @access  Private (Administrator, Finance)
exports.reverseAdvance = async (req, res, next) => {
  try {
    const advance = await AdvancePayment.findById(req.params.id);
    if (!advance) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    if (advance.allocatedAmount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot reverse advance because ₹${advance.allocatedAmount} has already been allocated to invoices. Deallocate or adjust invoices first.`
      });
    }

    advance.status = 'Reversed';
    advance.notes = `${advance.notes || ''} [Reversed by ${req.user.name} on ${new Date().toISOString()}]`;
    advance.unallocatedAmount = 0;
    await advance.save();

    res.status(200).json({
      success: true,
      data: advance,
      message: `Advance ${advance.receiptNumber} reversed successfully`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Deallocate an advance from an invoice (Reverses an allocation)
// @route   POST /api/advances/:id/deallocate
// @access  Private (Administrator, Finance)
exports.deallocateAdvance = async (req, res, next) => {
  try {
    const { allocationId } = req.body;
    if (!allocationId) {
      return res.status(400).json({ success: false, message: 'allocationId is required' });
    }

    const advance = await AdvancePayment.findById(req.params.id);
    if (!advance) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    const allocIndex = advance.allocations.findIndex((a) => a._id.toString() === allocationId);
    if (allocIndex === -1) {
      return res.status(404).json({ success: false, message: 'Allocation record not found on this advance' });
    }

    const allocation = advance.allocations[allocIndex];
    const deallocAmount = round2(allocation.allocatedAmount);

    const invoice = await Invoice.findById(allocation.invoice);
    if (invoice) {
      // Remove payment record or update amounts
      invoice.paymentHistory = invoice.paymentHistory.filter(
        (p) => !(p.advancePaymentId && p.advancePaymentId.toString() === advance._id.toString() && Math.abs(p.amount - deallocAmount) < 0.01)
      );
      invoice.amountPaid = Math.max(0, round2(invoice.amountPaid - deallocAmount));
      invoice.outstandingBalance = round2(invoice.grandTotal - invoice.amountPaid - (invoice.creditAdjustment || 0));
      if (invoice.outstandingBalance >= invoice.grandTotal) {
        invoice.status = 'Issued';
      } else if (invoice.outstandingBalance > 0) {
        invoice.status = 'Partially Paid';
      } else {
        invoice.status = 'Paid';
      }
      await invoice.save();
    }

    // Restore advance balances
    advance.allocatedAmount = Math.max(0, round2(advance.allocatedAmount - deallocAmount));
    advance.unallocatedAmount = round2(advance.amount - advance.allocatedAmount);
    advance.allocations.splice(allocIndex, 1);
    await advance.save();

    res.status(200).json({
      success: true,
      message: `Successfully deallocated ₹${deallocAmount} from Invoice and restored advance balance`,
      data: advance
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete advance payment (only unallocated)
// @route   DELETE /api/advances/:id
// @access  Private (Administrator, Finance)
exports.deleteAdvance = async (req, res, next) => {
  try {
    const advance = await AdvancePayment.findById(req.params.id);
    if (!advance) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    if (advance.allocatedAmount > 0 || (advance.allocations && advance.allocations.length > 0)) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete advance ${advance.receiptNumber} because ₹${advance.allocatedAmount} has already been allocated to invoices. Deallocate first to protect invoice financial integrity.`
      });
    }

    await AdvancePayment.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: `Advance payment ${advance.receiptNumber} deleted successfully`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Download advance payment receipt PDF
// @route   GET /api/advances/:id/pdf
// @access  Private
exports.downloadAdvanceReceiptPDF = async (req, res, next) => {
  try {
    const advance = await AdvancePayment.findById(req.params.id);
    if (!advance) {
      return res.status(404).json({ success: false, message: 'Advance record not found' });
    }

    const settings = await CompanySettings.findOne() || {};
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${advance.receiptNumber}.pdf"`);

    generateAdvanceReceiptPDF(advance, settings, res);
  } catch (error) {
    next(error);
  }
};
