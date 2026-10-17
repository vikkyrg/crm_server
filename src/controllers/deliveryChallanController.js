const DeliveryChallan = require('../models/DeliveryChallan');
const Client = require('../models/Client');
const CompanySettings = require('../models/CompanySettings');
const { getNextSequence } = require('../models/Counter');
const PDFDocument = require('pdfkit');

// @desc    Get all delivery challans with filtering, status, and search
// @route   GET /api/delivery-challans
// @access  Private
exports.getChallans = async (req, res, next) => {
  try {
    const { search, client, status, page = 1, limit = 20, sort = '-challanDate' } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { challanNumber: { $regex: search, $options: 'i' } },
        { projectOrWorkOrder: { $regex: search, $options: 'i' } },
        { 'clientSnapshot.companyName': { $regex: search, $options: 'i' } },
        { vehicleNumber: { $regex: search, $options: 'i' } },
        { transporterName: { $regex: search, $options: 'i' } }
      ];
    }

    if (client) query.client = client;
    if (status) query.status = status;

    const total = await DeliveryChallan.countDocuments(query);
    const challans = await DeliveryChallan.find(query)
      .populate('client', 'companyName clientId')
      .populate('invoices', 'invoiceNumber grandTotal status')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      totalCount: total,
      page: Number(page),
      currentPage: Number(page),
      totalPages: Math.ceil(total / limit),
      data: challans,
      challans
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single delivery challan details
// @route   GET /api/delivery-challans/:id
// @access  Private
exports.getChallan = async (req, res, next) => {
  try {
    const challan = await DeliveryChallan.findById(req.params.id)
      .populate('client')
      .populate('invoices', 'invoiceNumber grandTotal amountPaid status');

    if (!challan) {
      return res.status(404).json({ success: false, message: 'Delivery challan not found' });
    }

    res.status(200).json({
      success: true,
      data: challan
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new delivery challan
// @route   POST /api/delivery-challans
// @access  Private
exports.createChallan = async (req, res, next) => {
  try {
    const {
      clientId,
      challanDate,
      deliveryAddress,
      deliveryType,
      projectOrWorkOrder,
      items,
      transporterName,
      vehicleNumber,
      driverName,
      driverPhone,
      lrOrDocketNumber,
      dispatchDate,
      expectedDeliveryDate,
      termsAndConditions,
      notes
    } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client selection is required' });
    }

    if (!items || !items.length) {
      return res.status(400).json({ success: false, message: 'At least one material item is required' });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const settings = await CompanySettings.findOne() || {};
    const prefix = settings?.challanPrefix || 'DC-2026-';
    let candidateNumber = '';
    let isUnique = false;
    while (!isUnique) {
      const seq = await getNextSequence('challanNumber');
      candidateNumber = `${prefix}${String(seq).padStart(5, '0')}`;
      const exists = await DeliveryChallan.findOne({ challanNumber: candidateNumber });
      if (!exists) {
        isUnique = true;
      }
    }
    const challanNumber = candidateNumber;

    // Format items with validation
    const formattedItems = items.map((item, idx) => ({
      itemCode: item.itemCode || `MAT-${String(idx + 1).padStart(3, '0')}`,
      description: item.description || 'Material / Hardware Unit',
      quantityDispatched: Math.max(0.01, Number(item.quantityDispatched || item.quantity) || 1),
      quantityDelivered: 0,
      quantityInvoiced: 0,
      unit: item.unit || 'Units',
      batchOrSerialNo: item.batchOrSerialNo || '',
      unitPriceEstimate: Math.max(0, Number(item.unitPriceEstimate || item.unitPrice) || 0),
      notes: item.notes || ''
    }));

    const challan = await DeliveryChallan.create({
      challanNumber,
      challanDate: challanDate || new Date(),
      client: client._id,
      clientSnapshot: {
        companyName: client.companyName,
        contactPerson: client.contactPerson,
        primaryPhone: client.primaryPhone,
        email: client.email,
        billingAddress: client.billingAddress,
        shippingAddress: client.shippingAddress || client.billingAddress,
        city: client.city,
        state: client.state,
        stateCode: client.stateCode,
        pincode: client.pincode,
        gstin: client.gstin
      },
      deliveryAddress: deliveryAddress || client.shippingAddress || client.billingAddress,
      deliveryType: deliveryType || 'Material Supply',
      projectOrWorkOrder,
      items: formattedItems,
      transporterName,
      vehicleNumber,
      driverName,
      driverPhone,
      lrOrDocketNumber,
      dispatchDate: dispatchDate || (challanDate || new Date()),
      expectedDeliveryDate,
      status: 'Issued',
      termsAndConditions: termsAndConditions || 'Goods once dispatched are subject to physical inspection at destination.',
      notes,
      createdBy: req.user._id
    });

    res.status(201).json({
      success: true,
      data: challan,
      message: `Delivery Challan ${challanNumber} issued successfully`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update delivery challan
// @route   PUT /api/delivery-challans/:id
// @access  Private
exports.updateChallan = async (req, res, next) => {
  try {
    const challan = await DeliveryChallan.findById(req.params.id);
    if (!challan) {
      return res.status(404).json({ success: false, message: 'Challan not found' });
    }

    if (challan.status === 'Cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot edit a cancelled delivery challan' });
    }

    Object.assign(challan, req.body);
    await challan.save();

    res.status(200).json({
      success: true,
      data: challan,
      message: 'Delivery challan updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Record delivery status and receiver acknowledgment
// @route   PATCH /api/delivery-challans/:id/delivery-status
// @access  Private
exports.updateDeliveryStatus = async (req, res, next) => {
  try {
    const { status, actualDeliveryDate, receivedBy, itemsDelivered, receiverName, receiverPhone, receiverDesignation, remarks, deliveryNotes } = req.body;
    const challan = await DeliveryChallan.findById(req.params.id);
    if (!challan) {
      return res.status(404).json({ success: false, message: 'Challan not found' });
    }

    if (status) challan.status = status;
    if (actualDeliveryDate) challan.actualDeliveryDate = actualDeliveryDate;

    const rName = (receivedBy && receivedBy.name) || receiverName;
    const rPhone = (receivedBy && receivedBy.phone) || receiverPhone;
    const rDesig = (receivedBy && receivedBy.designation) || receiverDesignation;
    const rRemarks = (receivedBy && receivedBy.remarks) || remarks || deliveryNotes;

    if (rName || rPhone || rDesig || rRemarks) {
      challan.receivedBy = {
        name: rName || challan.receivedBy?.name || '',
        phone: rPhone || challan.receivedBy?.phone || '',
        designation: rDesig || challan.receivedBy?.designation || '',
        receivedAt: (receivedBy && receivedBy.receivedAt) || challan.receivedBy?.receivedAt || new Date(),
        remarks: rRemarks || challan.receivedBy?.remarks || ''
      };
    }

    // Update individual line item delivered quantities if provided
    if (itemsDelivered && Array.isArray(itemsDelivered)) {
      itemsDelivered.forEach(delItem => {
        const itm = challan.items.id(delItem._id);
        if (itm) {
          itm.quantityDelivered = Math.min(itm.quantityDispatched, Number(delItem.quantityDelivered) || itm.quantityDispatched);
        }
      });
    } else if (status === 'Delivered') {
      // Auto-mark all dispatched as delivered if not partial
      challan.items.forEach(itm => {
        itm.quantityDelivered = itm.quantityDispatched;
      });
    }

    await challan.save();

    res.status(200).json({
      success: true,
      data: challan,
      message: `Delivery status updated to ${challan.status}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel delivery challan safely
// @route   PATCH /api/delivery-challans/:id/cancel
// @access  Private
exports.cancelChallan = async (req, res, next) => {
  try {
    const challan = await DeliveryChallan.findById(req.params.id);
    if (!challan) {
      return res.status(404).json({ success: false, message: 'Challan not found' });
    }

    if (challan.invoices && challan.invoices.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel Challan ${challan.challanNumber}. Material Invoices have already been generated against it.`
      });
    }

    challan.status = 'Cancelled';
    challan.notes = `${challan.notes || ''} [Cancelled by ${req.user.name} on ${new Date().toISOString()}]`;
    await challan.save();

    res.status(200).json({
      success: true,
      data: challan,
      message: `Delivery Challan ${challan.challanNumber} has been marked as Cancelled`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Permanently delete delivery challan safely
// @route   DELETE /api/delivery-challans/:id
// @access  Private
exports.deleteChallan = async (req, res, next) => {
  try {
    const challan = await DeliveryChallan.findById(req.params.id);
    if (!challan) {
      return res.status(404).json({ success: false, message: 'Challan not found' });
    }

    if (challan.invoices && challan.invoices.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete Challan ${challan.challanNumber}. Material Invoices have already been generated against it.`
      });
    }

    await DeliveryChallan.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: `Delivery Challan ${challan.challanNumber} has been deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Download Delivery Challan PDF
// @route   GET /api/delivery-challans/:id/pdf
// @access  Private
exports.downloadChallanPDF = async (req, res, next) => {
  try {
    const challan = await DeliveryChallan.findById(req.params.id);
    if (!challan) {
      return res.status(404).json({ success: false, message: 'Challan not found' });
    }

    const companySettings = await CompanySettings.findOne() || {};

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${challan.challanNumber}.pdf"`);
    doc.pipe(res);

    const primaryColor = '#1e40af';
    const textColor = '#1f2937';

    // Header
    doc.fillColor(primaryColor).fontSize(18).text(companySettings.companyName || 'Innomatrics Technologies', 40, 40, { bold: true });
    doc.fillColor('#4b5563').fontSize(8.5).text(companySettings.tagline || 'Engineering & Logistics Division', 40, 62);
    doc.text(`${companySettings.address || ''} | Phone: ${companySettings.phone || ''}`, 40, 74);
    doc.text(`GSTIN: ${companySettings.gstin || 'N/A'}`, 40, 86);

    doc.fillColor(primaryColor).fontSize(14).text('DELIVERY CHALLAN', 380, 40, { align: 'right', bold: true });
    doc.fillColor(textColor).fontSize(9.5).text(`Challan No: ${challan.challanNumber}`, 380, 58, { align: 'right' });
    doc.text(`Date: ${new Date(challan.challanDate).toLocaleDateString('en-IN')}`, 380, 72, { align: 'right' });
    doc.text(`Status: ${challan.status}`, 380, 86, { align: 'right' });

    doc.moveTo(40, 102).lineTo(555, 102).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // Client & Consignee Box
    const client = challan.clientSnapshot || {};
    doc.rect(40, 110, 250, 80).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('CONSIGNEE / CLIENT DETAILS', 48, 116);
    doc.font('Helvetica').fontSize(8).fillColor(textColor);
    doc.text(`Company: ${client.companyName || 'N/A'}`, 48, 130);
    doc.text(`Attention: ${client.contactPerson || 'N/A'}`, 48, 142);
    doc.text(`Phone: ${client.primaryPhone || 'N/A'}`, 48, 154);
    doc.text(`Client GSTIN: ${client.gstin || 'Unregistered'}`, 48, 166);

    // Delivery & Transit Box
    doc.rect(305, 110, 250, 80).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('DESTINATION & DISPATCH INFO', 313, 116);
    doc.font('Helvetica').fontSize(8).fillColor(textColor);
    doc.text(`Delivery Type: ${challan.deliveryType || 'Material Supply'}`, 313, 130);
    doc.text(`Project/WO: ${challan.projectOrWorkOrder || 'N/A'}`, 313, 142);
    doc.text(`Vehicle No: ${challan.vehicleNumber || 'N/A'}`, 313, 154);
    doc.text(`Transporter: ${challan.transporterName || 'Direct Delivery'}`, 313, 166);

    // Delivery Address
    doc.rect(40, 196, 515, 24).fill('#eff6ff');
    doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('DELIVERY SITE ADDRESS:', 48, 203);
    doc.font('Helvetica').fillColor(textColor).text(challan.deliveryAddress || 'Project Destination', 170, 203, { width: 380 });

    // Table Header
    let tableY = 228;
    doc.rect(40, tableY, 515, 20).fill('#2563eb');
    doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
    doc.text('SR', 48, tableY + 5, { width: 25 });
    doc.text('ITEM CODE & DESCRIPTION', 78, tableY + 5, { width: 230 });
    doc.text('BATCH / S.NO', 315, tableY + 5, { width: 90 });
    doc.text('QTY DISPATCHED', 415, tableY + 5, { width: 65, align: 'right' });
    doc.text('QTY DELIVERED', 485, tableY + 5, { width: 65, align: 'right' });

    tableY += 20;

    // Table Items
    challan.items.forEach((item, index) => {
      const rowBg = index % 2 === 0 ? '#ffffff' : '#f9fafb';
      doc.rect(40, tableY, 515, 20).fill(rowBg);
      doc.fillColor(textColor).fontSize(8).font('Helvetica');

      doc.text(`${index + 1}`, 48, tableY + 5, { width: 25 });
      doc.text(`${item.description} (${item.itemCode})`, 78, tableY + 5, { width: 230 });
      doc.text(item.batchOrSerialNo || '-', 315, tableY + 5, { width: 90 });
      doc.text(`${item.quantityDispatched} ${item.unit || ''}`, 415, tableY + 5, { width: 65, align: 'right' });
      doc.text(`${item.quantityDelivered || 0} ${item.unit || ''}`, 485, tableY + 5, { width: 65, align: 'right' });

      tableY += 20;
    });

    // Terms & Acknowledgment
    tableY += 15;
    doc.rect(40, tableY, 515, 45).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('TERMS & DELIVERY CONDITIONS:', 48, tableY + 7);
    doc.font('Helvetica').fontSize(7.5).fillColor('#4b5563')
      .text(challan.termsAndConditions || 'Materials received in good condition. Claims regarding discrepancy must be notified within 48 hours.', 48, tableY + 18, { width: 500 });

    // Signatures
    const sigY = 700;
    doc.moveTo(40, sigY).lineTo(180, sigY).strokeColor('#9ca3af').stroke();
    doc.fontSize(8).fillColor('#64748b').text('Authorized Dispatch Signatory', 40, sigY + 5);

    doc.moveTo(375, sigY).lineTo(555, sigY).strokeColor('#9ca3af').stroke();
    doc.fontSize(8).text('Receiver Signature & Site Stamp', 375, sigY + 5, { align: 'right' });

    doc.end();
  } catch (error) {
    next(error);
  }
};
