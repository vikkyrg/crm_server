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

    // Page Geometry: Standard A4 portrait (595.28 x 841.89 pt), Margins 40pt -> Content Width 515.28pt (515pt)
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${challan.challanNumber}.pdf"`);
    doc.pipe(res);

    const primaryColor = '#1e40af'; // Blue 800
    const primaryDark = '#1d4ed8';
    const textColor = '#1e293b';   // Slate 800
    const textSecondary = '#475569'; // Slate 600
    const mutedColor = '#64748b';    // Slate 500
    const borderColor = '#cbd5e1';   // Slate 300
    const cardBgColor = '#f8fafc';   // Slate 50

    const leftMargin = 40;
    const pageWidth = 515;
    const rightMargin = leftMargin + pageWidth; // 555

    // Exact Table Column Layout: 30 + 265 + 80 + 70 + 70 = 515
    const colSrX = leftMargin;       // 40
    const colSrW = 30;

    const colDescX = colSrX + colSrW; // 70
    const colDescW = 265;

    const colBatchX = colDescX + colDescW; // 335
    const colBatchW = 80;

    const colDispX = colBatchX + colBatchW; // 415
    const colDispW = 70;

    const colDelivX = colDispX + colDispW;  // 485
    const colDelivW = 70;

    // Helper: Render Table Header
    const renderTableHeader = (headerY) => {
      doc.rect(leftMargin, headerY, pageWidth, 20).fill('#2563eb');
      doc.fillColor('#ffffff').fontSize(7.5).font('Helvetica-Bold');

      doc.text('SR', colSrX, headerY + 6, { width: colSrW, align: 'center' });
      doc.text('ITEM CODE & DESCRIPTION', colDescX + 6, headerY + 6, { width: colDescW - 12, align: 'left' });
      doc.text('BATCH / S.NO', colBatchX, headerY + 6, { width: colBatchW, align: 'center' });
      doc.text('DISPATCHED', colDispX, headerY + 6, { width: colDispW - 8, align: 'right' });
      doc.text('DELIVERED', colDelivX, headerY + 6, { width: colDelivW - 8, align: 'right' });

      doc.rect(leftMargin, headerY, pageWidth, 20).strokeColor(primaryDark).lineWidth(0.5).stroke();
      return headerY + 20;
    };

    // Helper: Continuation Header for multi-page overflow
    const renderContinuationHeader = (contY) => {
      doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold')
        .text('DELIVERY CHALLAN (CONTINUED)', leftMargin, contY);
      doc.font('Helvetica').fontSize(8).fillColor(textColor)
        .text(`Challan No: ${challan.challanNumber}   |   Date: ${new Date(challan.challanDate).toLocaleDateString('en-IN')}`, 300, contY + 2, { align: 'right', width: 255 });
      doc.moveTo(leftMargin, contY + 16).lineTo(rightMargin, contY + 16).strokeColor('#e2e8f0').lineWidth(1).stroke();
      return contY + 22;
    };

    // --- PAGE 1: HEADER SECTION ---
    let headerStartY = 36;
    if (companySettings.companyLogo && companySettings.companyLogo.startsWith('data:image')) {
      try {
        const base64Data = companySettings.companyLogo.split(';base64,').pop();
        const imageBuffer = Buffer.from(base64Data, 'base64');
        doc.image(imageBuffer, leftMargin, 34, { height: 32 });
        headerStartY = 70;
      } catch (e) {
        console.error('Failed to render PDF logo:', e.message);
      }
    }

    const companyDetailsX = leftMargin;
    const companyDetailsW = 280;
    let companyY = headerStartY;

    doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold')
      .text(companySettings.companyName || 'Navadurga Electricals', companyDetailsX, companyY, { width: companyDetailsW });
    companyY += 16;

    const companyMeta = [
      companySettings.address,
      companySettings.phone ? `Phone: ${companySettings.phone}` : null,
      companySettings.email ? `Email: ${companySettings.email}` : null,
      `GSTIN: ${companySettings.gstin || 'N/A'}`
    ].filter(Boolean).join(' | ');

    doc.font('Helvetica').fontSize(7.5).fillColor(textSecondary)
      .text(companyMeta, companyDetailsX, companyY, { width: companyDetailsW, lineGap: 1.5 });
    const companyMetaHeight = doc.heightOfString(companyMeta, { width: companyDetailsW, font: 'Helvetica', size: 7.5, lineGap: 1.5 });
    const companyBottomY = companyY + companyMetaHeight;

    // Right Header: Document Title & Metadata
    const metaX = 330;
    const metaW = 225;
    doc.fillColor(primaryColor).fontSize(15).font('Helvetica-Bold').text('DELIVERY CHALLAN', metaX, 34, { align: 'right', width: metaW });
    
    let metaY = 52;
    doc.fillColor(textColor).fontSize(8.5).font('Helvetica-Bold').text(`Challan No: ${challan.challanNumber}`, metaX, metaY, { align: 'right', width: metaW });
    metaY += 12;
    doc.font('Helvetica').fontSize(8).fillColor(textSecondary).text(`Date: ${new Date(challan.challanDate).toLocaleDateString('en-IN')}`, metaX, metaY, { align: 'right', width: metaW });
    metaY += 12;
    doc.text(`Status: ${challan.status || 'Issued'}`, metaX, metaY, { align: 'right', width: metaW });
    metaY += 12;

    // Divider cleanly beneath whichever header column extends further
    const dividerY = Math.max(companyBottomY + 8, metaY + 4, 98);
    doc.moveTo(leftMargin, dividerY).lineTo(rightMargin, dividerY).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // --- CLIENT & DISPATCH INFORMATION PANELS ---
    const client = challan.clientSnapshot || {};
    const cardGap = 11;
    const cardW = 252; // 252 + 11 + 252 = 515
    const cardH = 68;  // Ample vertical space for 4 neat rows without overflow
    const cardY = dividerY + 7;

    // Left Panel: Consignee / Client Details
    doc.rect(leftMargin, cardY, cardW, cardH).fillAndStroke(cardBgColor, borderColor);
    doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('CONSIGNEE / CLIENT DETAILS', leftMargin + 8, cardY + 6);
    
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor);
    let leftLineY = cardY + 20;
    const clientCompany = client.companyName || '-';
    doc.text(`Company: ${clientCompany}`, leftMargin + 8, leftLineY, { width: cardW - 16, lineBreak: false, ellipsis: true });
    leftLineY += 14;
    doc.text(`Phone: ${client.primaryPhone || '-'}`, leftMargin + 8, leftLineY, { width: cardW - 16 });
    leftLineY += 14;
    doc.text(`Client GSTIN: ${client.gstin || '-'}`, leftMargin + 8, leftLineY, { width: cardW - 16 });

    // Right Panel: Destination & Dispatch Info
    const rightCardX = leftMargin + cardW + cardGap; // 40 + 252 + 11 = 303
    doc.rect(rightCardX, cardY, cardW, cardH).fillAndStroke(cardBgColor, borderColor);
    doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('DESTINATION & DISPATCH INFO', rightCardX + 8, cardY + 6);

    let rightLineY = cardY + 18;
    doc.font('Helvetica').fontSize(7.5).fillColor(textColor);
    doc.text(`Delivery Type: ${challan.deliveryType || 'Material Supply'}`, rightCardX + 8, rightLineY, { width: cardW - 16, lineBreak: false, ellipsis: true });
    rightLineY += 12;
    doc.text(`Project/WO: ${challan.projectOrWorkOrder || '-'}`, rightCardX + 8, rightLineY, { width: cardW - 16, lineBreak: false, ellipsis: true });
    rightLineY += 12;
    doc.text(`Vehicle No: ${challan.vehicleNumber || '-'}`, rightCardX + 8, rightLineY, { width: cardW - 16 });
    rightLineY += 12;
    doc.text(`Transporter: ${challan.transporterName || '-'}`, rightCardX + 8, rightLineY, { width: cardW - 16, lineBreak: false, ellipsis: true });

    // Delivery Site Address (Full Width Row)
    const rawAddr = (challan.deliveryAddress || client.shippingAddress || client.billingAddress || '-').trim();
    const addrContent = rawAddr || '-';
    const addrTextW = 380;
    doc.font('Helvetica').fontSize(7.5);
    const addrTextHeight = doc.heightOfString(addrContent, { width: addrTextW, lineGap: 1 });
    const addrCardH = Math.max(20, addrTextHeight + 8);
    const addrCardY = cardY + cardH + 5;

    doc.rect(leftMargin, addrCardY, pageWidth, addrCardH).fillAndStroke('#eff6ff', '#bfdbfe');
    doc.fillColor(primaryColor).fontSize(7.5).font('Helvetica-Bold').text('DELIVERY SITE ADDRESS:', leftMargin + 8, addrCardY + 5);
    doc.font('Helvetica').fillColor(textColor).text(addrContent, leftMargin + 124, addrCardY + 5, { width: addrTextW, lineGap: 1 });

    // --- ITEM TABLE ---
    let tableY = addrCardY + addrCardH + 7;
    tableY = renderTableHeader(tableY);

    (challan.items || []).forEach((item, index) => {
      doc.font('Helvetica').fontSize(7.5);
      const descText = item.description || 'Material Item';
      const descHeight = doc.heightOfString(descText, { width: colDescW - 12 });
      const codeHeight = item.itemCode ? 10 : 0;
      const notesHeight = item.notes ? doc.heightOfString(`Note: ${item.notes}`, { width: colDescW - 12 }) + 2 : 0;
      const contentHeight = descHeight + codeHeight + notesHeight;
      const rowHeight = Math.max(22, contentHeight + 8);

      // Multi-page overflow check (Standard A4 is 841.89pt, 710 max allows footer space on page 1)
      if (tableY + rowHeight > 700) {
        doc.addPage();
        let contY = 36;
        contY = renderContinuationHeader(contY);
        tableY = renderTableHeader(contY);
      }

      const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      doc.rect(leftMargin, tableY, pageWidth, rowHeight).fillAndStroke(rowBg, '#e2e8f0');

      // SR (Centered)
      doc.fillColor(mutedColor).fontSize(7.5).font('Helvetica')
        .text(`${index + 1}`, colSrX, tableY + 6, { width: colSrW, align: 'center' });

      // Item Code & Description (Left aligned with padding)
      let descY = tableY + 5;
      doc.fillColor(textColor).fontSize(7.5).font('Helvetica-Bold')
        .text(descText, colDescX + 6, descY, { width: colDescW - 12 });
      descY += descHeight;

      if (item.itemCode) {
        doc.fillColor(mutedColor).fontSize(6.5).font('Helvetica')
          .text(`Code: ${item.itemCode}`, colDescX + 6, descY, { width: colDescW - 12 });
        descY += 9;
      }
      if (item.notes) {
        doc.fillColor('#475569').fontSize(6.5).font('Helvetica-Oblique')
          .text(`Note: ${item.notes}`, colDescX + 6, descY, { width: colDescW - 12 });
      }

      // Batch / Serial No. (Centered)
      doc.fillColor(textColor).fontSize(7.5).font('Helvetica')
        .text(item.batchOrSerialNo || '-', colBatchX, tableY + 6, { width: colBatchW, align: 'center', lineBreak: false, ellipsis: true });

      // Dispatched Qty (Right aligned)
      doc.fillColor(textColor).fontSize(7.5).font('Helvetica-Bold')
        .text(`${item.quantityDispatched}`, colDispX, tableY + 6, { width: colDispW - 8, align: 'right' });

      // Delivered Qty (Right aligned)
      const delivQty = item.quantityDelivered !== undefined && item.quantityDelivered !== null ? item.quantityDelivered : 0;
      doc.fillColor(delivQty > 0 ? '#15803d' : mutedColor).fontSize(7.5).font('Helvetica-Bold')
        .text(`${delivQty}`, colDelivX, tableY + 6, { width: colDelivW - 8, align: 'right' });

      tableY += rowHeight;
    });

    // Check if Terms & Signature blocks (~90pt) fit on current page
    const footerNeededHeight = 90;
    if (tableY + footerNeededHeight > 745) {
      doc.addPage();
      let contY = 36;
      contY = renderContinuationHeader(contY);
      tableY = contY + 8;
    } else {
      tableY += 8;
    }

    // --- COMPACT TERMS & CONDITIONS ---
    const termsY = tableY;
    const termsText = challan.termsAndConditions || 'Goods once dispatched are subject to physical inspection at destination. Claims regarding transit discrepancy or damage must be notified within 48 hours.';
    doc.font('Helvetica').fontSize(7);
    const termsTextHeight = doc.heightOfString(termsText, { width: pageWidth - 16, lineGap: 1.5 });
    const termsH = Math.max(30, termsTextHeight + 16);

    doc.rect(leftMargin, termsY, pageWidth, termsH).fillAndStroke(cardBgColor, borderColor);
    doc.fillColor(primaryColor).fontSize(7).font('Helvetica-Bold').text('TERMS & DELIVERY CONDITIONS:', leftMargin + 8, termsY + 5);
    doc.font('Helvetica').fontSize(7).fillColor(textSecondary)
      .text(termsText, leftMargin + 8, termsY + 15, { width: pageWidth - 16, lineGap: 1.5 });

    // --- SIGNATURES BLOCK ---
    // Balanced, equal-width (160pt) signature lines aligned with leftMargin (40) and rightMargin (555)
    const sigLineWidth = 160;
    const sigY = termsY + termsH + 28;

    // Authorized Dispatch Signatory (Left)
    doc.moveTo(leftMargin, sigY).lineTo(leftMargin + sigLineWidth, sigY).strokeColor('#94a3b8').lineWidth(0.8).stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(textSecondary).text('Authorized Dispatch Signatory', leftMargin, sigY + 4, { width: sigLineWidth });
    doc.fontSize(7).font('Helvetica').fillColor(mutedColor).text(`For ${companySettings.companyName || 'Navadurga Electricals'}`, leftMargin, sigY + 14, { width: sigLineWidth });

    // Receiver Signature & Site Stamp (Right)
    const sig2X = rightMargin - sigLineWidth; // 555 - 160 = 395
    doc.moveTo(sig2X, sigY).lineTo(rightMargin, sigY).strokeColor('#94a3b8').lineWidth(0.8).stroke();
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(textSecondary).text('Receiver Signature & Site Stamp', sig2X, sigY + 4, { align: 'right', width: sigLineWidth });
    doc.fontSize(7).font('Helvetica').fillColor(mutedColor).text('Received in good order & condition', sig2X, sigY + 14, { align: 'right', width: sigLineWidth });

    // Page Numbering Footer on all pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font('Helvetica').fillColor('#94a3b8')
        .text(`Delivery Challan ${challan.challanNumber}   |   Page ${i + 1} of ${range.count}`, leftMargin, 782, { align: 'center', width: pageWidth, lineBreak: false });
    }

    doc.end();
  } catch (error) {
    next(error);
  }
};
