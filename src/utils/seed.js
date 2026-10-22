const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');
const Service = require('../models/Service');
const Client = require('../models/Client');
const CompanySettings = require('../models/CompanySettings');
const PFDocument = require('../models/PFDocument');
const Invoice = require('../models/Invoice');
const AdvancePayment = require('../models/AdvancePayment');
const QuantityRecord = require('../models/QuantityRecord');
const { calculateDocumentTotals } = require('../utils/financials');

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/innomatrics_crm');
    console.log('[Seed] Connected to database');

    // Clean current database
    const DeliveryChallan = require('../models/DeliveryChallan');

    await Promise.all([
      User.deleteMany(),
      Service.deleteMany(),
      Client.deleteMany(),
      CompanySettings.deleteMany(),
      PFDocument.deleteMany(),
      Invoice.deleteMany(),
      AdvancePayment.deleteMany(),
      QuantityRecord.deleteMany(),
      DeliveryChallan.deleteMany()
    ]);
    console.log('[Seed] Cleared existing CRM records; preserved employees and payroll history');

    // 1. Company Settings
    const settings = await CompanySettings.create({
      companyName: 'Navadurga Electricals',
      displayName: 'Navadurga Electricals',
      tagline: 'Enterprise Cloud, AI & Digital Transformation Solutions',
      address: 'Suite 402, Alpha Tech Park, Electronic City, Noida, Uttar Pradesh',
      city: 'Noida',
      state: 'Uttar Pradesh',
      stateCode: '09',
      pincode: '201301',
      phone: '+91 98100 23456',
      email: 'billing@innomatrics.com',
      website: 'https://www.innomatrics.com',
      gstin: '09AAACI8899F1ZX',
      pan: 'AAACI8899F',
      bankName: 'HDFC Bank Ltd',
      accountNumber: '50200055443322',
      ifscCode: 'HDFC0001890',
      branch: 'Sector 62 Noida',
      upiId: 'innomatrics@hdfcbank',
      invoicePrefix: 'INV-2026-',
      pfPrefix: 'PF-2026-',
      advancePrefix: 'ADV-2026-',
      clientPrefix: 'INN-CL-',
      servicePrefix: 'INN-SRV-',
      quantityPrefix: 'QTY-2026-',
      defaultPaymentTerms: 'Payment due within 15 days of invoice date. 18% annual interest applies on delayed settlements.',
      defaultNotes: 'Thank you for choosing Navadurga Electricals!'
    });

    // 2. Initial Administrator User (Single Master Admin)
    const adminUser = await User.create({
      name: 'Vikram Sharma',
      email: 'admin@innomatrics.com',
      password: 'AdminPassword123!',
      role: 'Administrator',
      employeeId: 'EMP-001',
      phone: '+91 98111 22233'
    });

    console.log('[Seed] Created Administrator user');

    // 3. Services Catalog
    const services = await Service.insertMany([
      {
        serviceId: 'INN-SRV-000001',
        name: 'Full Stack Web & Cloud Application Development',
        description: 'End-to-end custom SaaS & portal development using modern React, Node.js and AWS cloud infrastructure',
        category: 'Software Engineering',
        unit: 'Sprint',
        defaultUnitPrice: 120000,
        taxRate: 18,
        sacCode: '998314',
        isActive: true
      },
      {
        serviceId: 'INN-SRV-000002',
        name: 'DevOps & Kubernetes Cloud Infrastructure Setup',
        description: 'Automated CI/CD pipelines, container orchestration, microservices deployment and monitoring',
        category: 'Cloud Services',
        unit: 'Project',
        defaultUnitPrice: 85000,
        taxRate: 18,
        sacCode: '998315',
        isActive: true
      },
      {
        serviceId: 'INN-SRV-000003',
        name: 'AI Agent & LLM Workflow Automation',
        description: 'Custom autonomous agent systems, RAG integration, and enterprise CRM workflow automations',
        category: 'Artificial Intelligence',
        unit: 'Module',
        defaultUnitPrice: 150000,
        taxRate: 18,
        sacCode: '998313',
        isActive: true
      },
      {
        serviceId: 'INN-SRV-000004',
        name: 'Dedicated Senior Software Engineer Retainer',
        description: 'Dedicated full-time engineering talent allocation for ongoing architectural and feature support',
        category: 'Staff Augmentation',
        unit: 'Month',
        defaultUnitPrice: 95000,
        taxRate: 18,
        sacCode: '998311',
        isActive: true
      },
      {
        serviceId: 'INN-SRV-000005',
        name: 'Enterprise Cybersecurity & Compliance Audit',
        description: 'Penetration testing, code security analysis, vulnerability remediation and compliance advisory',
        category: 'Security',
        unit: 'Audit',
        defaultUnitPrice: 65000,
        taxRate: 18,
        sacCode: '998316',
        isActive: true
      }
    ]);
    console.log('[Seed] Created services catalog');

    // 4. Clients
    const client1 = await Client.create({
      clientId: 'INN-CL-00001',
      companyName: 'Apex Healthtech Solutions Ltd',
      contactPerson: 'Dr. Rajesh Verma',
      primaryPhone: '+91 98765 11223',
      email: 'rajesh.verma@apexhealth.in',
      gstin: '09ABCDE1234F1Z8', // UP Intra-state
      pan: 'ABCDE1234F',
      billingAddress: 'Tower B, Tech Boulevard, Sector 127',
      city: 'Noida',
      state: 'Uttar Pradesh',
      stateCode: '09',
      pincode: '201304',
      notes: 'Key healthcare client for EHR cloud migration',
      isActive: true
    });

    const client2 = await Client.create({
      clientId: 'INN-CL-00002',
      companyName: 'Zenith Logistics Global Pvt Ltd',
      contactPerson: 'Sunil Rao',
      primaryPhone: '+91 99887 76655',
      email: 'sunil.rao@zenithlogistics.com',
      gstin: '29XYZAB5678C1Z4', // Karnataka Inter-state (IGST)
      pan: 'XYZAB5678C',
      billingAddress: 'Outer Ring Road, Bellandur',
      city: 'Bengaluru',
      state: 'Karnataka',
      stateCode: '29',
      pincode: '560103',
      notes: 'Supply chain automation platform client',
      isActive: true
    });

    const client3 = await Client.create({
      clientId: 'INN-CL-00003',
      companyName: 'Quantum FinTech Capital',
      contactPerson: 'Meera Nambiar',
      primaryPhone: '+91 97112 34567',
      email: 'meera.nambiar@quantumfin.com',
      gstin: '27MNPQR9012D1Z2', // Maharashtra Inter-state
      pan: 'MNPQR9012D',
      billingAddress: 'Bandra Kurla Complex, Bandra East',
      city: 'Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
      pincode: '400051',
      notes: 'Payment gateway and algorithmic engine development',
      isActive: true
    });
    console.log('[Seed] Created clients');

    // 5. Quantity Records
    await QuantityRecord.create({
      recordId: 'QTY-2026-00001',
      client: client1._id,
      clientSnapshot: { companyName: client1.companyName, contactPerson: client1.contactPerson },
      service: services[0]._id,
      serviceId: services[0].serviceId,
      serviceName: services[0].name,
      quantity: 2,
      unit: 'Sprint',
      unitPriceSnapshot: 120000,
      date: new Date(Date.now() - 15 * 86400000),
      notes: 'Completed Sprint 1 & Sprint 2 of EHR portal'
    });

    await QuantityRecord.create({
      recordId: 'QTY-2026-00002',
      client: client2._id,
      clientSnapshot: { companyName: client2.companyName, contactPerson: client2.contactPerson },
      service: services[1]._id,
      serviceId: services[1].serviceId,
      serviceName: services[1].name,
      quantity: 1,
      unit: 'Project',
      unitPriceSnapshot: 85000,
      date: new Date(Date.now() - 8 * 86400000),
      notes: 'Kubernetes cluster deployment on AWS'
    });

    // 6. PF Documents
    const pfItemsClient1 = [
      {
        service: services[0]._id,
        serviceId: services[0].serviceId,
        description: services[0].name,
        unit: 'Sprint',
        unitPrice: 120000,
        quantity: 2,
        discountPercent: 5,
        taxRate: 18
      },
      {
        service: services[1]._id,
        serviceId: services[1].serviceId,
        description: services[1].name,
        unit: 'Project',
        unitPrice: 85000,
        quantity: 1,
        discountPercent: 0,
        taxRate: 18
      }
    ];

    const pfTotals = calculateDocumentTotals(pfItemsClient1, 0, false, true);

    const pf1 = await PFDocument.create({
      pfNumber: 'PF-2026-00001',
      documentDate: new Date(Date.now() - 20 * 86400000),
      validityDate: new Date(Date.now() + 10 * 86400000),
      client: client1._id,
      clientSnapshot: {
        companyName: client1.companyName,
        contactPerson: client1.contactPerson,
        primaryPhone: client1.primaryPhone,
        email: client1.email,
        gstin: client1.gstin,
        pan: client1.pan,
        billingAddress: client1.billingAddress,
        city: client1.city,
        state: client1.state,
        stateCode: client1.stateCode,
        pincode: client1.pincode
      },
      assignedEmployee: adminUser._id,
      assignedEmployeeName: adminUser.name,
      items: pfTotals.items,
      documentDiscount: pfTotals.documentDiscount,
      subtotal: pfTotals.subtotal,
      totalTaxableAmount: pfTotals.totalTaxableAmount,
      cgstTotal: pfTotals.cgstTotal,
      sgstTotal: pfTotals.sgstTotal,
      igstTotal: pfTotals.igstTotal,
      totalTax: pfTotals.totalTax,
      roundOffAdjustment: pfTotals.roundOffAdjustment,
      grandTotal: pfTotals.grandTotal,
      notes: settings.defaultNotes,
      termsAndConditions: settings.defaultPaymentTerms,
      status: 'Accepted',
      createdBy: adminUser._id
    });

    console.log('[Seed] Created PF Document');

    // 7. Invoices
    // Invoice 1 for Client 1 (Intra-state, CGST + SGST)
    const inv1Totals = calculateDocumentTotals(pfItemsClient1, 0, false, true);
    const invoice1 = await Invoice.create({
      invoiceNumber: 'INV-2026-00001',
      invoiceDate: new Date(Date.now() - 14 * 86400000),
      dueDate: new Date(Date.now() + 1 * 86400000),
      client: client1._id,
      clientSnapshot: {
        companyName: client1.companyName,
        contactPerson: client1.contactPerson,
        primaryPhone: client1.primaryPhone,
        email: client1.email,
        gstin: client1.gstin,
        pan: client1.pan,
        billingAddress: client1.billingAddress,
        city: client1.city,
        state: client1.state,
        stateCode: client1.stateCode,
        pincode: client1.pincode
      },
      relatedPFDocument: pf1._id,
      relatedPFNumber: pf1.pfNumber,
      items: inv1Totals.items,
      documentDiscount: 0,
      subtotal: inv1Totals.subtotal,
      totalTaxableAmount: inv1Totals.totalTaxableAmount,
      cgstTotal: inv1Totals.cgstTotal,
      sgstTotal: inv1Totals.sgstTotal,
      igstTotal: inv1Totals.igstTotal,
      totalTax: inv1Totals.totalTax,
      roundOffAdjustment: inv1Totals.roundOffAdjustment,
      grandTotal: inv1Totals.grandTotal,
      amountPaid: 150000,
      creditAdjustment: 0,
      outstandingBalance: inv1Totals.grandTotal - 150000,
      status: 'Partially Paid',
      paymentTerms: settings.defaultPaymentTerms,
      notes: settings.defaultNotes,
      paymentHistory: [
        {
          paymentDate: new Date(Date.now() - 10 * 86400000),
          amount: 150000,
          paymentMethod: 'Bank Transfer',
          reference: 'HDFC-NEFT-991204',
          notes: 'First milestone tranche received'
        }
      ],
      createdBy: adminUser._id
    });

    pf1.status = 'Converted to Invoice';
    pf1.convertedToInvoiceId = invoice1._id;
    pf1.convertedToInvoiceNumber = invoice1.invoiceNumber;
    await pf1.save();

    // Invoice 2 for Client 2 (Inter-state, IGST)
    const inv2Items = [
      {
        service: services[2]._id,
        serviceId: services[2].serviceId,
        description: services[2].name,
        unit: 'Module',
        unitPrice: 150000,
        quantity: 1,
        discountPercent: 0,
        taxRate: 18
      }
    ];
    const inv2Totals = calculateDocumentTotals(inv2Items, 0, true, true);
    await Invoice.create({
      invoiceNumber: 'INV-2026-00002',
      invoiceDate: new Date(Date.now() - 5 * 86400000),
      dueDate: new Date(Date.now() + 10 * 86400000),
      client: client2._id,
      clientSnapshot: {
        companyName: client2.companyName,
        contactPerson: client2.contactPerson,
        primaryPhone: client2.primaryPhone,
        email: client2.email,
        gstin: client2.gstin,
        pan: client2.pan,
        billingAddress: client2.billingAddress,
        city: client2.city,
        state: client2.state,
        stateCode: client2.stateCode,
        pincode: client2.pincode
      },
      items: inv2Totals.items,
      documentDiscount: 0,
      subtotal: inv2Totals.subtotal,
      totalTaxableAmount: inv2Totals.totalTaxableAmount,
      cgstTotal: inv2Totals.cgstTotal,
      sgstTotal: inv2Totals.sgstTotal,
      igstTotal: inv2Totals.igstTotal,
      totalTax: inv2Totals.totalTax,
      roundOffAdjustment: inv2Totals.roundOffAdjustment,
      grandTotal: inv2Totals.grandTotal,
      amountPaid: 0,
      creditAdjustment: 0,
      outstandingBalance: inv2Totals.grandTotal,
      status: 'Issued',
      paymentTerms: settings.defaultPaymentTerms,
      notes: settings.defaultNotes,
      createdBy: adminUser._id
    });

    console.log('[Seed] Created Invoices with verified GST split');

    // 8. Advance Payment
    await AdvancePayment.create({
      receiptNumber: 'ADV-2026-00001',
      client: client3._id,
      clientSnapshot: {
        companyName: client3.companyName,
        contactPerson: client3.contactPerson,
        primaryPhone: client3.primaryPhone,
        email: client3.email,
        city: client3.city,
        state: client3.state
      },
      paymentDate: new Date(Date.now() - 3 * 86400000),
      amount: 100000,
      allocatedAmount: 0,
      unallocatedAmount: 100000,
      paymentMethod: 'Bank Transfer',
      transactionReference: 'UTR-ICICI-881230491',
      bankDetails: 'ICICI Bank Current A/c',
      associatedProject: 'Algorithmic Risk Engine',
      notes: 'Retainer deposit for Phase 1 architecture scoping',
      status: 'Verified',
      createdBy: adminUser._id
    });
    console.log('[Seed] Created Advance Payment');

    // 10. Delivery Challan
    const challan1 = await DeliveryChallan.create({
      challanNumber: 'DC-2026-00001',
      challanDate: new Date(Date.now() - 4 * 86400000),
      client: client1._id,
      clientSnapshot: {
        companyName: client1.companyName,
        contactPerson: client1.contactPerson,
        primaryPhone: client1.primaryPhone,
        email: client1.email,
        billingAddress: client1.billingAddress,
        shippingAddress: client1.billingAddress,
        city: client1.city,
        state: client1.state,
        stateCode: client1.stateCode,
        pincode: client1.pincode,
        gstin: client1.gstin
      },
      deliveryAddress: 'Sector 127 Project Site, Noida, UP',
      deliveryType: 'Material Supply',
      projectOrWorkOrder: 'Apex Hospital IoT Telemetry Deployment',
      items: [
        {
          itemCode: 'MAT-SRV-01',
          description: 'Enterprise Gateway IoT Sensors & Connectivity Hubs',
          quantityDispatched: 10,
          quantityDelivered: 10,
          quantityInvoiced: 10,
          unit: 'Units',
          batchOrSerialNo: 'BAT-2026-904',
          unitPriceEstimate: 4500
        },
        {
          itemCode: 'MAT-RACK-02',
          description: 'Industrial 42U Wall Mount Rack Enclosures with PDUs',
          quantityDispatched: 2,
          quantityDelivered: 2,
          quantityInvoiced: 2,
          unit: 'Units',
          batchOrSerialNo: 'RCK-8812',
          unitPriceEstimate: 22000
        }
      ],
      transporterName: 'BlueDart Logistics',
      vehicleNumber: 'UP 16 BT 9921',
      driverName: 'Ramesh Singh',
      driverPhone: '+91 99100 44332',
      dispatchDate: new Date(Date.now() - 4 * 86400000),
      status: 'Delivered',
      actualDeliveryDate: new Date(Date.now() - 3 * 86400000),
      receivedBy: {
        name: 'Suresh Kumar',
        phone: '+91 98765 11299',
        designation: 'Site Operations Lead',
        receivedAt: new Date(Date.now() - 3 * 86400000),
        remarks: 'All 12 hardware packages received in pristine condition'
      },
      createdBy: adminUser._id
    });
    console.log('[Seed] Created Delivery Challan');

    // 11. Material Invoice (linked to Challan)
    const matItems = [
      {
        serviceId: 'MAT-SRV-01',
        description: 'Enterprise Gateway IoT Sensors & Connectivity Hubs',
        unit: 'Units',
        unitPrice: 4500,
        quantity: 10,
        discountPercent: 0,
        taxRate: 18
      },
      {
        serviceId: 'MAT-RACK-02',
        description: 'Industrial 42U Wall Mount Rack Enclosures with PDUs',
        unit: 'Units',
        unitPrice: 22000,
        quantity: 2,
        discountPercent: 0,
        taxRate: 18
      }
    ];

    const matTotals = calculateDocumentTotals(matItems, 0, false, true); // Intra-state (UP)
    const matInvoice = await Invoice.create({
      invoiceNumber: 'INV-2026-00003',
      invoiceDate: new Date(Date.now() - 2 * 86400000),
      dueDate: new Date(Date.now() + 13 * 86400000),
      client: client1._id,
      clientSnapshot: {
        companyName: client1.companyName,
        contactPerson: client1.contactPerson,
        primaryPhone: client1.primaryPhone,
        email: client1.email,
        gstin: client1.gstin,
        pan: client1.pan,
        billingAddress: client1.billingAddress,
        city: client1.city,
        state: client1.state,
        stateCode: client1.stateCode,
        pincode: client1.pincode
      },
      invoiceType: 'Material',
      projectOrWorkOrder: challan1.projectOrWorkOrder,
      linkedChallans: [challan1._id],
      linkedChallanNumbers: [challan1.challanNumber],
      items: matTotals.items,
      documentDiscount: 0,
      subtotal: matTotals.subtotal,
      totalTaxableAmount: matTotals.totalTaxableAmount,
      cgstTotal: matTotals.cgstTotal,
      sgstTotal: matTotals.sgstTotal,
      igstTotal: matTotals.igstTotal,
      totalTax: matTotals.totalTax,
      roundOffAdjustment: matTotals.roundOffAdjustment,
      grandTotal: matTotals.grandTotal,
      amountPaid: 0,
      creditAdjustment: 0,
      outstandingBalance: matTotals.grandTotal,
      status: 'Issued',
      paymentTerms: settings.defaultPaymentTerms,
      notes: `Material delivery bill against Challan ${challan1.challanNumber}`,
      createdBy: adminUser._id
    });

    challan1.invoices.push(matInvoice._id);
    challan1.status = 'Invoiced';
    await challan1.save();
    console.log('[Seed] Created Material Invoice linked to Challan');

    // 13. Synchronize Sequence Counters
    const { Counter } = require('../models/Counter');
    await Promise.all([
      Counter.findByIdAndUpdate('clientId', { seq: 3 }, { upsert: true }),
      Counter.findByIdAndUpdate('serviceId', { seq: 5 }, { upsert: true }),
      Counter.findByIdAndUpdate('pfNumber', { seq: 2 }, { upsert: true }),
      Counter.findByIdAndUpdate('invoiceNumber', { seq: 3 }, { upsert: true }),
      Counter.findByIdAndUpdate('advanceReceiptNumber', { seq: 1 }, { upsert: true }),
      Counter.findByIdAndUpdate('quantityRecordId', { seq: 3 }, { upsert: true }),
      Counter.findByIdAndUpdate('deliveryChallanNumber', { seq: 1 }, { upsert: true })
    ]);
    console.log('[Seed] Synchronized all Sequence Counters');

    console.log('\n=============================================');
    console.log('SEED DATA INITIALIZATION COMPLETE');
    console.log('Master Admin Account: admin@innomatrics.com / AdminPassword123!');
    console.log('=============================================\n');

    process.exit(0);
  } catch (error) {
    console.error(`[Seed Error] ${error.message}`);
    process.exit(1);
  }
};

seedData();
