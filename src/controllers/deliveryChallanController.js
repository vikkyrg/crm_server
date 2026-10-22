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

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one material item is required' });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Selected client not found' });
    }

    const finalDeliveryAddress = (deliveryAddress || client.shippingAddress || client.billingAddress || '').trim();
    if (!finalDeliveryAddress) {
      return res.status(400).json({ success: false, message: 'Delivery address is required' });
    }

    // Validate and sanitize deliveryType against valid enum values
    const validDeliveryTypes = [
      'Supply on Approval',
      'Job Work',
      'Project Site Delivery',
      'Material Supply',
      'Inter-Branch Transfer',
      'Other'
    ];
    let sanitizedDeliveryType = (deliveryType || '').trim();
    if (sanitizedDeliveryType === 'Material Supply to Site') {
      sanitizedDeliveryType = 'Material Supply';
    } else if (!validDeliveryTypes.includes(sanitizedDeliveryType)) {
      sanitizedDeliveryType = 'Material Supply';
    }

    // Validate and format items
    const formattedItems = [];
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const description = (item.description || '').trim();
      if (!description) {
        return res.status(400).json({
          success: false,
          message: `Item #${idx + 1}: Description is required`
        });
      }

      const qty = Number(item.quantityDispatched ?? item.quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: `Item #${idx + 1} (${description}): Dispatched quantity must be greater than 0`
        });
      }

      formattedItems.push({
        itemCode: (item.itemCode || '').trim() || `MAT-${String(idx + 1).padStart(3, '0')}`,
        description,
        quantityDispatched: qty,
        quantityDelivered: 0,
        quantityInvoiced: 0,
        unit: (item.unit || '').trim() || 'Units',
        batchOrSerialNo: (item.batchOrSerialNo || '').trim(),
        unitPriceEstimate: Math.max(0, Number(item.unitPriceEstimate ?? item.unitPrice) || 0),
        notes: (item.notes || item.remarks || '').trim()
      });
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
      deliveryAddress: finalDeliveryAddress,
      deliveryType: sanitizedDeliveryType,
      projectOrWorkOrder: (projectOrWorkOrder || '').trim(),
      items: formattedItems,
      transporterName: (transporterName || '').trim(),
      vehicleNumber: (vehicleNumber || '').trim().toUpperCase(),
      driverName: (driverName || '').trim(),
      driverPhone: (driverPhone || '').trim(),
      lrOrDocketNumber: (lrOrDocketNumber || '').trim(),
      dispatchDate: dispatchDate || (challanDate || new Date()),
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      status: 'Issued',
      termsAndConditions: termsAndConditions || 'Goods once dispatched are subject to physical inspection at destination.',
      notes: (notes || '').trim(),
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

    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${challan.challanNumber}.pdf"`);
    doc.pipe(res);

    const primaryColor = '#1e40af';
    const textColor = '#1f2937';
    const mutedColor = '#64748b';
    const borderColor = '#cbd5e1';

    // Page Geometry
    const leftMargin = 40;
    const pageWidth = 515; // 595.28 - 2 * 40 = 515.28 pt

    // Table Column Definitions
    const colSrX = 40;
    const colSrW = 28;

    const colDescX = 68;
    const colDescW = 237;

    const colBatchX = 305;
    const colBatchW = 80;

    const colDispX = 385;
    const colDispW = 65;

    const colDelivX = 450;
    const colDelivW = 65;

    // Helper: Render Table Header
    const renderTableHeader = (headerY) => {
      doc.rect(leftMargin, headerY, pageWidth, 20).fill('#2563eb');
      doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');

      doc.text('SR', colSrX + 4, headerY + 5, { width: colSrW - 8, align: 'center' });
      doc.text('ITEM CODE & DESCRIPTION', colDescX + 4, headerY + 5, { width: colDescW - 8, align: 'left' });
      doc.text('BATCH / S.NO', colBatchX + 4, headerY + 5, { width: colBatchW - 8, align: 'left' });
      doc.text('DISPATCHED', colDispX + 4, headerY + 5, { width: colDispW - 8, align: 'right' });
      doc.text('DELIVERED', colDelivX + 4, headerY + 5, { width: colDelivW - 8, align: 'right' });

      // Outer border for header
      doc.rect(leftMargin, headerY, pageWidth, 20).strokeColor('#1d4ed8').lineWidth(0.5).stroke();

      return headerY + 20;
    };

    // Helper: Continuation Header for subsequent pages
    const renderContinuationHeader = (contY) => {
      doc.fillColor(primaryColor).fontSize(10.5).font('Helvetica-Bold')
        .text('DELIVERY CHALLAN (CONTINUED)', leftMargin, contY);
      doc.font('Helvetica').fontSize(8).fillColor(textColor)
        .text(`Challan No: ${challan.challanNumber}  |  Date: ${new Date(challan.challanDate).toLocaleDateString('en-IN')}`, 300, contY, { align: 'right', width: 255 });
      doc.moveTo(leftMargin, contY + 14).lineTo(leftMargin + pageWidth, contY + 14).strokeColor('#e2e8f0').lineWidth(1).stroke();
      return contY + 20;
    };

    // --- PAGE 1 TOP HEADER ---
    let headerStartY = 38;
    if (companySettings.companyLogo && companySettings.companyLogo.startsWith('data:image')) {
      try {
        const base64Data = companySettings.companyLogo.split(';base64,').pop();
        const imageBuffer = Buffer.from(base64Data, 'base64');
        doc.image(imageBuffer, 40, 32, { height: 32 });
        headerStartY = 68;
      } catch (e) {
        console.error('Failed to render PDF logo:', e.message);
      }
    }

    if (headerStartY === 38) {
      doc.fillColor(primaryColor).fontSize(15).text(companySettings.companyName || 'Navadurga Electricals', 40, headerStartY, { bold: true });
      doc.fillColor('#4b5563').fontSize(7.5).text(companySettings.tagline || 'Engineering & Logistics Division', 40, headerStartY + 18);
      doc.text(companySettings.address || '', 40, headerStartY + 28, { width: 280, lineBreak: false, ellipsis: true });
      doc.text(`Phone: ${companySettings.phone || ''} | Email: ${companySettings.email || ''}`, 40, headerStartY + 38);
      doc.text(`GSTIN: ${companySettings.gstin || 'N/A'}`, 40, headerStartY + 48);
    } else {
      doc.fillColor(primaryColor).fontSize(12).text(companySettings.companyName || 'Navadurga Electricals', 40, headerStartY, { bold: true });
      doc.fillColor('#4b5563').fontSize(7.5).text(`${companySettings.address || ''} | Phone: ${companySettings.phone || ''} | GSTIN: ${companySettings.gstin || 'N/A'}`, 40, headerStartY + 14, { width: 280 });
    }

    // Document Title & Metadata
    const metaX = 330;
    const metaW = 225;
    doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text('DELIVERY CHALLAN', metaX, 36, { align: 'right', width: metaW });
    doc.fillColor(textColor).fontSize(8.5).font('Helvetica-Bold').text(`Challan No: ${challan.challanNumber}`, metaX, 54, { align: 'right', width: metaW });
    doc.font('Helvetica').fontSize(8).text(`Date: ${new Date(challan.challanDate).toLocaleDateString('en-IN')}`, metaX, 66, { align: 'right', width: metaW });
    doc.text(`Status: ${challan.status || 'Issued'}`, metaX, 78, { align: 'right', width: metaW });

    const dividerY = 96;
    doc.moveTo(leftMargin, dividerY).lineTo(leftMargin + pageWidth, dividerY).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // Client & Consignee Box
    const client = challan.clientSnapshot || {};
    const boxW = 252;
    const boxH = 56;
    const boxY = 102;

    doc.rect(leftMargin, boxY, boxW, boxH).fillAndStroke('#f8fafc', borderColor);
    doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('CONSIGNEE / CLIENT DETAILS', leftMargin + 8, boxY + 6);
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor);
    doc.text(`Company: ${client.companyName || 'N/A'}`, leftMargin + 8, boxY + 18, { width: boxW - 16, lineBreak: false, ellipsis: true });
    doc.text(`Phone: ${client.primaryPhone || 'N/A'}`, leftMargin + 8, boxY + 30, { width: boxW - 16 });
    doc.text(`Client GSTIN: ${client.gstin || 'Unregistered'}`, leftMargin + 8, boxY + 42, { width: boxW - 16 });

    // Destination & Dispatch Box
    const box2X = leftMargin + boxW + 11;
    doc.rect(box2X, boxY, boxW, boxH).fillAndStroke('#f8fafc', borderColor);
    doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('DESTINATION & DISPATCH INFO', box2X + 8, boxY + 6);
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor);
    doc.text(`Delivery Type: ${challan.deliveryType || 'Material Supply'}`, box2X + 8, boxY + 18, { width: boxW - 16, lineBreak: false, ellipsis: true });
    doc.text(`Project/WO: ${challan.projectOrWorkOrder || 'N/A'}`, box2X + 8, boxY + 30, { width: boxW - 16, lineBreak: false, ellipsis: true });
    doc.text(`Vehicle No: ${challan.vehicleNumber || 'N/A'}`, box2X + 8, boxY + 42, { width: boxW - 16 });
    doc.text(`Transporter: ${challan.transporterName || 'Direct Delivery'}`, box2X + 8, boxY + 54, { width: boxW - 16, lineBreak: false, ellipsis: true });

    // Delivery Address Card (dynamic height)
    doc.font('Helvetica').fontSize(7.5);
    const addrContent = (challan.deliveryAddress || client.shippingAddress || client.billingAddress || 'Project Destination').trim();
    const addrTextW = 380;
    const addrTextHeight = doc.heightOfString(addrContent, { width: addrTextW });
    const addrCardH = Math.max(20, addrTextHeight + 8);
    const addrCardY = boxY + boxH + 6;

    doc.rect(leftMargin, addrCardY, pageWidth, addrCardH).fillAndStroke('#eff6ff', '#bfdbfe');
    doc.fillColor(primaryColor).fontSize(7.5).font('Helvetica-Bold').text('DELIVERY SITE ADDRESS:', leftMargin + 8, addrCardY + 5);
    doc.font('Helvetica').fillColor(textColor).text(addrContent, leftMargin + 125, addrCardY + 5, { width: addrTextW });

    // --- ITEM TABLE ---
    let tableY = addrCardY + addrCardH + 8;
    tableY = renderTableHeader(tableY);

    // Render items with dynamic row heights and automatic page wrapping
    (challan.items || []).forEach((item, index) => {
      // Calculate height needed for this row
      doc.font('Helvetica').fontSize(7.5);
      const descHeight = doc.heightOfString(item.description || '', { width: colDescW - 8 });
      const codeHeight = item.itemCode ? 9 : 0;
      const notesHeight = item.notes ? doc.heightOfString(`Note: ${item.notes}`, { width: colDescW - 8 }) + 2 : 0;
      const contentHeight = descHeight + codeHeight + notesHeight;
      const rowHeight = Math.max(20, contentHeight + 8);

      // Check if row exceeds printable page area (max tableY ~ 700)
      if (tableY + rowHeight > 700) {
        doc.addPage();
        let contY = 38;
        contY = renderContinuationHeader(contY);
        tableY = renderTableHeader(contY);
      }

      const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(leftMargin, tableY, pageWidth, rowHeight).fillAndStroke(rowBg, '#e2e8f0');

      // SR
      doc.fillColor(mutedColor).fontSize(7.5).font('Helvetica')
        .text(`${index + 1}`, colSrX + 2, tableY + 5, { width: colSrW - 4, align: 'center' });

      // Description & Code
      let descY = tableY + 5;
      doc.fillColor(textColor).fontSize(7.5).font('Helvetica-Bold')
        .text(item.description || 'Material Item', colDescX + 4, descY, { width: colDescW - 8 });
      descY += descHeight;

      if (item.itemCode) {
        doc.fillColor(mutedColor).fontSize(6.5).font('Helvetica')
          .text(`Code: ${item.itemCode}`, colDescX + 4, descY, { width: colDescW - 8 });
        descY += 9;
      }
      if (item.notes) {
        doc.fillColor('#475569').fontSize(6.5).font('Helvetica-Oblique')
          .text(`Note: ${item.notes}`, colDescX + 4, descY, { width: colDescW - 8 });
      }

      // Batch / Serial No
      doc.fillColor(textColor).fontSize(7.5).font('Helvetica')
        .text(item.batchOrSerialNo || '-', colBatchX + 4, tableY + 5, { width: colBatchW - 8, align: 'left', lineBreak: false, ellipsis: true });

      // Dispatched Qty
      doc.fillColor(textColor).fontSize(7.5).font('Helvetica-Bold')
        .text(`${item.quantityDispatched}`, colDispX + 2, tableY + 5, { width: colDispW - 6, align: 'right' });

      // Delivered Qty
      const delivQty = item.quantityDelivered !== undefined && item.quantityDelivered !== null ? item.quantityDelivered : 0;
      doc.fillColor(delivQty > 0 ? '#15803d' : mutedColor).fontSize(7.5).font('Helvetica-Bold')
        .text(`${delivQty}`, colDelivX + 2, tableY + 5, { width: colDelivW - 6, align: 'right' });

      tableY += rowHeight;
    });

    // Check if footer (Terms + Signatures ~ 85pt) fits on current page
    const footerNeededHeight = 85;
    if (tableY + footerNeededHeight > 750) {
      doc.addPage();
      let contY = 38;
      contY = renderContinuationHeader(contY);
      tableY = contY + 8;
    } else {
      tableY += 8;
    }

    // Terms & Conditions Card
    const termsY = tableY;
    const termsH = 34;
    doc.rect(leftMargin, termsY, pageWidth, termsH).fillAndStroke('#f8fafc', borderColor);
    doc.fillColor(primaryColor).fontSize(7).font('Helvetica-Bold').text('TERMS & DELIVERY CONDITIONS:', leftMargin + 8, termsY + 5);
    doc.font('Helvetica').fontSize(7).fillColor('#475569')
      .text(challan.termsAndConditions || 'Materials received in good condition. Claims regarding discrepancy or transit damage must be notified within 48 hours.', leftMargin + 8, termsY + 16, { width: pageWidth - 16 });

    // Signatures Block
    const sigY = termsY + termsH + 26;
    doc.moveTo(leftMargin, sigY).lineTo(leftMargin + 160, sigY).strokeColor('#94a3b8').lineWidth(0.8).stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#475569').text('Authorized Dispatch Signatory', leftMargin, sigY + 4);
    doc.fontSize(7).font('Helvetica').fillColor(mutedColor).text(`For ${companySettings.companyName || 'Navadurga Electricals'}`, leftMargin, sigY + 14);

    const sig2X = leftMargin + pageWidth - 160;
    doc.moveTo(sig2X, sigY).lineTo(leftMargin + pageWidth, sigY).strokeColor('#94a3b8').lineWidth(0.8).stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#475569').text('Receiver Signature & Site Stamp', sig2X, sigY + 4, { align: 'right', width: 160 });
    doc.fontSize(7).font('Helvetica').fillColor(mutedColor).text('Received in good order & condition', sig2X, sigY + 14, { align: 'right', width: 160 });

    // Page Numbering Footer on all pages (placed safely at Y=780 within bottom margin boundary)
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
        .text(`Delivery Challan ${challan.challanNumber}  |  Page ${i + 1} of ${range.count}`, leftMargin, 782, { align: 'center', width: pageWidth, lineBreak: false });
    }

    doc.end();
  } catch (error) {
    next(error);
  }
};
