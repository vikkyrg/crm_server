const Client = require('../models/Client');
const PFDocument = require('../models/PFDocument');
const Invoice = require('../models/Invoice');
const AdvancePayment = require('../models/AdvancePayment');
const QuantityRecord = require('../models/QuantityRecord');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');

// @desc    Get all clients with search, status filter, and pagination
// @route   GET /api/clients
// @access  Private
exports.getClients = async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 20, sort = '-createdAt' } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { clientId: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { primaryPhone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { gstin: { $regex: search, $options: 'i' } }
      ];
    }

    if (status) {
      query.isActive = status === 'active';
    }

    const total = await Client.countDocuments(query);
    const clients = await Client.find(query)
      .populate('assignedEmployee', 'name email role employeeId')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      data: clients
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single client with complete related financial profile & stats
// @route   GET /api/clients/:id
// @access  Private
exports.getClient = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id).populate('assignedEmployee', 'name email employeeId');
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    // Fetch real related records
    const [pfDocuments, invoices, advancePayments, quantityRecords] = await Promise.all([
      PFDocument.find({ client: client._id }).sort('-createdAt').limit(20),
      Invoice.find({ client: client._id }).sort('-createdAt').limit(20),
      AdvancePayment.find({ client: client._id }).sort('-createdAt').limit(20),
      QuantityRecord.find({ client: client._id }).sort('-createdAt').limit(20)
    ]);

    // Financial summaries
    const totalPFValue = pfDocuments.reduce((acc, doc) => acc + (doc.grandTotal || 0), 0);
    const totalInvoiced = invoices.reduce((acc, inv) => acc + (inv.grandTotal || 0), 0);
    const totalInvoicePaid = invoices.reduce((acc, inv) => acc + (inv.amountPaid || 0), 0);
    const totalOutstanding = invoices.reduce((acc, inv) => acc + (inv.outstandingBalance || 0), 0);

    const totalAdvanceReceived = advancePayments.reduce((acc, adv) => adv.status !== 'Reversed' ? acc + adv.amount : acc, 0);
    const totalAdvanceAllocated = advancePayments.reduce((acc, adv) => adv.status !== 'Reversed' ? acc + adv.allocatedAmount : acc, 0);
    const totalAdvanceUnallocated = advancePayments.reduce((acc, adv) => adv.status !== 'Reversed' ? acc + adv.unallocatedAmount : acc, 0);

    res.status(200).json({
      success: true,
      data: client,
      summary: {
        totalPFValue,
        totalInvoiced,
        totalInvoicePaid,
        totalOutstanding,
        totalAdvanceReceived,
        totalAdvanceAllocated,
        totalAdvanceUnallocated
      },
      pfDocuments,
      invoices,
      advancePayments,
      quantityRecords
    });
  } catch (error) {
    next(error);
  }
};

// Helper mapping of Indian States to 2-digit GST state codes
const STATE_TO_CODE = {
  'JAMMU AND KASHMIR': '01',
  'HIMACHAL PRADESH': '02',
  'PUNJAB': '03',
  'CHANDIGARH': '04',
  'UTTARAKHAND': '05',
  'HARYANA': '06',
  'DELHI': '07',
  'RAJASTHAN': '08',
  'UTTAR PRADESH': '09',
  'BIHAR': '10',
  'SIKKIM': '11',
  'ARUNACHAL PRADESH': '12',
  'NAGALAND': '13',
  'MANIPUR': '14',
  'MIZORAM': '15',
  'TRIPURA': '16',
  'MEGHALAYA': '17',
  'ASSAM': '18',
  'WEST BENGAL': '19',
  'JHARKHAND': '20',
  'ODISHA': '21',
  'CHHATTISGARH': '22',
  'MADHYA PRADESH': '23',
  'GUJARAT': '24',
  'DAMAN AND DIU': '25',
  'DADRA AND NAGAR HAVELI': '26',
  'MAHARASHTRA': '27',
  'ANDHRA PRADESH': '28',
  'KARNATAKA': '29',
  'GOA': '30',
  'LAKSHADWEEP': '31',
  'KERALA': '32',
  'TAMIL NADU': '33',
  'PUDUCHERRY': '34',
  'ANDAMAN AND NICOBAR ISLANDS': '35',
  'TELANGANA': '36',
  'ANDHRA PRADESH (NEW)': '37',
  'LADAKH': '38'
};

const deriveStateCode = (gstin, state) => {
  if (gstin && gstin.trim().length >= 2) {
    const prefix = gstin.trim().substring(0, 2);
    if (!isNaN(prefix)) return prefix;
  }
  if (state) {
    const cleanState = state.trim().toUpperCase();
    if (STATE_TO_CODE[cleanState]) return STATE_TO_CODE[cleanState];
  }
  return '';
};

// @desc    Create new client
// @route   POST /api/clients
// @access  Private
exports.createClient = async (req, res, next) => {
  try {
    let clientId = req.body.clientId;
    if (!clientId || clientId.trim() === '') {
      const settings = await CompanySettings.findOne();
      const prefix = settings?.clientPrefix || 'INN-CL-';
      let candidateId = '';
      let isUnique = false;
      while (!isUnique) {
        const seq = await getNextSequence('clientId');
        candidateId = `${prefix}${String(seq).padStart(5, '0')}`;
        const exists = await Client.findOne({ clientId: candidateId });
        if (!exists) {
          isUnique = true;
        }
      }
      clientId = candidateId;
    } else {
      const exists = await Client.findOne({ clientId: clientId.trim() });
      if (exists) {
        return res.status(400).json({ success: false, message: `Client ID "${clientId}" already exists. Please choose a different ID or leave blank to auto-generate.` });
      }
    }

    const clientData = { ...req.body };
    if (!clientData.assignedEmployee || clientData.assignedEmployee === '') {
      delete clientData.assignedEmployee;
    }

    const stateCode = clientData.stateCode || deriveStateCode(clientData.gstin, clientData.state);

    const client = await Client.create({
      ...clientData,
      clientId,
      stateCode
    });

    res.status(201).json({
      success: true,
      data: client,
      message: 'Client created successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update client
// @route   PUT /api/clients/:id
// @access  Private
exports.updateClient = async (req, res, next) => {
  try {
    const updatePayload = { ...req.body };
    if (!updatePayload.assignedEmployee || updatePayload.assignedEmployee === '') {
      updatePayload.assignedEmployee = null;
    }
    if (!updatePayload.stateCode) {
      const derived = deriveStateCode(updatePayload.gstin, updatePayload.state);
      if (derived) updatePayload.stateCode = derived;
    }

    const client = await Client.findByIdAndUpdate(req.params.id, updatePayload, {
      new: true,
      runValidators: true
    }).populate('assignedEmployee', 'name email employeeId');

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    res.status(200).json({
      success: true,
      data: client,
      message: 'Client updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle client active status / archive
// @route   PATCH /api/clients/:id/toggle-status
// @access  Private
exports.toggleClientStatus = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    client.isActive = !client.isActive;
    await client.save();

    res.status(200).json({
      success: true,
      data: client,
      message: `Client marked as ${client.isActive ? 'Active' : 'Archived/Inactive'}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get dependency summary before permanent client deletion
// @route   GET /api/clients/:id/deletion-summary
// @access  Private (Administrator)
exports.getClientDeletionSummary = async (req, res, next) => {
  try {
    const clientId = req.params.id;
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const [invoices, pfDocuments, advances, quantities] = await Promise.all([
      Invoice.find({ client: clientId }).select('invoiceNumber grandTotal amountPaid outstandingBalance paymentHistory'),
      PFDocument.find({ client: clientId }).select('pfNumber grandTotal status'),
      AdvancePayment.find({ client: clientId }).select('receiptNumber amount allocatedAmount unallocatedAmount status allocations'),
      QuantityRecord.find({ client: clientId }).select('recordId quantity serviceName')
    ]);

    // Calculate advance allocations and payments
    const advanceAllocationsCount = advances.reduce((acc, a) => acc + (a.allocations?.length || 0), 0);
    const invoicePaymentsCount = invoices.reduce((acc, inv) => acc + (inv.paymentHistory?.length || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        client: {
          _id: client._id,
          clientId: client.clientId,
          companyName: client.companyName,
          contactPerson: client.contactPerson,
          email: client.email
        },
        counts: {
          invoices: invoices.length,
          pfDocuments: pfDocuments.length,
          advancePayments: advances.length,
          advanceAllocations: advanceAllocationsCount,
          invoicePayments: invoicePaymentsCount,
          quantityRecords: quantities.length
        },
        financialSummary: {
          totalInvoiced: invoices.reduce((acc, i) => acc + (i.grandTotal || 0), 0),
          totalPaid: invoices.reduce((acc, i) => acc + (i.amountPaid || 0), 0),
          totalOutstanding: invoices.reduce((acc, i) => acc + (i.outstandingBalance || 0), 0),
          totalAdvances: advances.reduce((acc, a) => acc + (a.amount || 0), 0)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Permanently delete client and all exclusively owned client records
// @route   DELETE /api/clients/:id/permanent
// @access  Private (Administrator)
exports.permanentDeleteClient = async (req, res, next) => {
  const session = await Client.startSession().catch(() => null);
  let useTransaction = false;

  try {
    const clientId = req.params.id;
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    if (session) {
      try {
        session.startTransaction();
        useTransaction = true;
      } catch (txErr) {
        useTransaction = false;
      }
    }

    const opts = useTransaction ? { session } : {};

    // 1. Delete all Quantity Records belonging to this client
    const quantityResult = await QuantityRecord.deleteMany({ client: clientId }, opts);

    // 2. Delete all PF Documents belonging to this client
    const pfResult = await PFDocument.deleteMany({ client: clientId }, opts);

    // 3. Delete all Advance Payments belonging to this client
    const advanceResult = await AdvancePayment.deleteMany({ client: clientId }, opts);

    // 4. Delete all Invoices belonging to this client
    const invoiceResult = await Invoice.deleteMany({ client: clientId }, opts);

    // 5. Delete the Client itself
    await Client.findByIdAndDelete(clientId, opts);

    if (useTransaction) {
      await session.commitTransaction();
      session.endSession();
    }

    console.log(`[Permanent Deletion] Client ${client.clientId} (${client.companyName}) permanently deleted by ${req.user?.email || 'admin'}: ${invoiceResult.deletedCount} Invoices, ${pfResult.deletedCount} PFs, ${advanceResult.deletedCount} Advances, ${quantityResult.deletedCount} Quantities removed.`);

    res.status(200).json({
      success: true,
      message: `Client ${client.companyName} (${client.clientId}) and all linked records permanently deleted.`,
      deletionSummary: {
        clientDeleted: true,
        clientId: client.clientId,
        companyName: client.companyName,
        deletedRecords: {
          invoices: invoiceResult.deletedCount || 0,
          pfDocuments: pfResult.deletedCount || 0,
          advancePayments: advanceResult.deletedCount || 0,
          quantityRecords: quantityResult.deletedCount || 0
        }
      }
    });
  } catch (error) {
    if (useTransaction && session) {
      await session.abortTransaction().catch(() => {});
      session.endSession();
    }
    next(error);
  }
};

