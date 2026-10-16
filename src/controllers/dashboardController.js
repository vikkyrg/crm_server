const Client = require('../models/Client');
const Service = require('../models/Service');
const PFDocument = require('../models/PFDocument');
const Invoice = require('../models/Invoice');
const AdvancePayment = require('../models/AdvancePayment');
const Employee = require('../models/Employee');
const PayrollRun = require('../models/PayrollRun');
const EmployeePfRecord = require('../models/EmployeePfRecord');
const DeliveryChallan = require('../models/DeliveryChallan');
const { round2 } = require('../utils/financials');

// @desc    Get dashboard metrics, KPIs, monthly trends, and recent records
// @route   GET /api/dashboard
// @access  Private
exports.getDashboardMetrics = async (req, res, next) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Aggregations
    const [
      totalClients,
      activeClients,
      totalServices,
      totalEmployees,
      activeEmployees,
      pfStats,
      invoiceStats,
      materialInvoiceStats,
      overdueStats,
      advanceStats,
      challanStats,
      pfRemittanceStats,
      latestPayroll,
      recentPFs,
      recentInvoices,
      recentAdvances,
      recentClients,
      recentChallans
    ] = await Promise.all([
      Client.countDocuments(),
      Client.countDocuments({ isActive: true }),
      Service.countDocuments(),
      Employee.countDocuments(),
      Employee.countDocuments({ employmentStatus: 'Active' }),

      // PF Stats
      PFDocument.aggregate([
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalValue: { $sum: '$grandTotal' }
          }
        }
      ]),

      // All Invoice Stats
      Invoice.aggregate([
        {
          $match: { status: { $ne: 'Cancelled' } }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalInvoiced: { $sum: '$grandTotal' },
            totalPaid: { $sum: '$amountPaid' },
            totalOutstanding: { $sum: '$outstandingBalance' }
          }
        }
      ]),

      // Material Invoices specific
      Invoice.aggregate([
        {
          $match: { invoiceType: 'Material', status: { $ne: 'Cancelled' } }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalInvoiced: { $sum: '$grandTotal' },
            totalOutstanding: { $sum: '$outstandingBalance' }
          }
        }
      ]),

      // Overdue Invoices
      Invoice.aggregate([
        {
          $match: {
            status: { $nin: ['Paid', 'Cancelled'] },
            dueDate: { $lt: now },
            outstandingBalance: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalOverdue: { $sum: '$outstandingBalance' }
          }
        }
      ]),

      // Advance Payment Stats
      AdvancePayment.aggregate([
        {
          $match: { status: { $ne: 'Reversed' } }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalReceived: { $sum: '$amount' },
            totalAllocated: { $sum: '$allocatedAmount' },
            totalUnallocated: { $sum: '$unallocatedAmount' }
          }
        }
      ]),

      // Delivery Challans stats
      DeliveryChallan.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Employee PF Remittance stats
      EmployeePfRecord.aggregate([
        {
          $group: {
            _id: '$remittanceStatus',
            count: { $sum: 1 },
            totalAmount: { $sum: '$totalPfAmount' },
            employeeShare: { $sum: '$employeeContribution' },
            employerShare: { $sum: '$employerContribution' }
          }
        }
      ]),

      // Latest Payroll Run
      PayrollRun.findOne({ status: 'Finalized' }).sort({ year: -1, month: -1 }),

      // Recent Records
      PFDocument.find().sort('-createdAt').limit(5).select('pfNumber documentDate clientSnapshot grandTotal status'),
      Invoice.find().sort('-createdAt').limit(5).select('invoiceNumber invoiceType invoiceDate clientSnapshot grandTotal amountPaid outstandingBalance status'),
      AdvancePayment.find().sort('-createdAt').limit(5).select('receiptNumber paymentDate clientSnapshot amount unallocatedAmount paymentMethod status'),
      Client.find().sort('-createdAt').limit(5).select('clientId companyName contactPerson primaryPhone email isActive'),
      DeliveryChallan.find().sort('-createdAt').limit(5).select('challanNumber challanDate clientSnapshot projectOrWorkOrder status items')
    ]);

    // Monthly Trends for past 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [monthlyInvoices, monthlyAdvances] = await Promise.all([
      Invoice.aggregate([
        {
          $match: {
            invoiceDate: { $gte: sixMonthsAgo },
            status: { $ne: 'Cancelled' }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$invoiceDate' },
              month: { $month: '$invoiceDate' }
            },
            invoicedAmount: { $sum: '$grandTotal' },
            paidAmount: { $sum: '$amountPaid' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      AdvancePayment.aggregate([
        {
          $match: {
            paymentDate: { $gte: sixMonthsAgo },
            status: { $ne: 'Reversed' }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$paymentDate' },
              month: { $month: '$paymentDate' }
            },
            advanceReceived: { $sum: '$amount' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ])
    ]);

    // Invoices by status breakdown
    const invoicesByStatus = await Invoice.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          amount: { $sum: '$grandTotal' }
        }
      }
    ]);

    // Format monthly trend output for charts
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const trendMap = {};

    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      trendMap[key] = {
        name: `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`,
        invoiced: 0,
        collected: 0,
        advance: 0
      };
    }

    monthlyInvoices.forEach((item) => {
      const key = `${item._id.year}-${item._id.month}`;
      if (trendMap[key]) {
        trendMap[key].invoiced = round2(item.invoicedAmount);
        trendMap[key].collected = round2(item.paidAmount);
      }
    });

    monthlyAdvances.forEach((item) => {
      const key = `${item._id.year}-${item._id.month}`;
      if (trendMap[key]) {
        trendMap[key].advance = round2(item.advanceReceived);
      }
    });

    const monthlyTrends = Object.values(trendMap);

    // Challan summary by status
    const challanStatusMap = {};
    challanStats.forEach(c => { challanStatusMap[c._id] = c.count; });

    // PF Remittance summary
    let pfPendingRemittanceAmount = 0;
    let pfPendingCount = 0;
    pfRemittanceStats.forEach(p => {
      if (p._id === 'Pending') {
        pfPendingRemittanceAmount = round2(p.totalAmount);
        pfPendingCount = p.count;
      }
    });

    res.status(200).json({
      success: true,
      kpis: {
        totalClients,
        activeClients,
        totalServices,
        totalEmployees,
        activeEmployees,
        pfCount: pfStats[0]?.count || 0,
        totalPFValue: round2(pfStats[0]?.totalValue || 0),
        invoiceCount: invoiceStats[0]?.count || 0,
        totalInvoiced: round2(invoiceStats[0]?.totalInvoiced || 0),
        totalPaymentsCollected: round2(invoiceStats[0]?.totalPaid || 0),
        totalAdvanceReceived: round2(advanceStats[0]?.totalReceived || 0),
        totalAdvanceAllocated: round2(advanceStats[0]?.totalAllocated || 0),
        totalUnallocatedAdvances: round2(advanceStats[0]?.totalUnallocated || 0),
        outstandingBalance: round2(invoiceStats[0]?.totalOutstanding || 0),
        overdueCount: overdueStats[0]?.count || 0,
        overdueAmount: round2(overdueStats[0]?.totalOverdue || 0),

        // ERP specific metrics
        materialInvoiceCount: materialInvoiceStats[0]?.count || 0,
        materialInvoicedAmount: round2(materialInvoiceStats[0]?.totalInvoiced || 0),
        materialOutstandingBalance: round2(materialInvoiceStats[0]?.totalOutstanding || 0),

        challansIssued: (challanStatusMap['Issued'] || 0) + (challanStatusMap['Dispatched'] || 0),
        challansDelivered: challanStatusMap['Delivered'] || 0,
        challansTotal: challanStats.reduce((acc, c) => acc + c.count, 0),

        latestPayrollPeriod: latestPayroll?.periodName || 'None',
        latestPayrollNetPayable: latestPayroll ? latestPayroll.totalNetPayable : 0,
        latestPayrollPending: latestPayroll ? latestPayroll.totalPendingAmount : 0,

        pfPendingRemittanceAmount,
        pfPendingCount
      },
      monthlyTrends,
      invoicesByStatus,
      recentPFs,
      recentInvoices,
      recentAdvances,
      recentClients,
      recentChallans
    });
  } catch (error) {
    next(error);
  }
};
