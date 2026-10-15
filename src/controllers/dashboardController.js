const Client = require('../models/Client');
const Service = require('../models/Service');
const PFDocument = require('../models/PFDocument');
const Invoice = require('../models/Invoice');
const AdvancePayment = require('../models/AdvancePayment');
const { round2 } = require('../utils/financials');

// @desc    Get dashboard metrics, KPIs, monthly trends, and recent records
// @route   GET /api/dashboard
// @access  Private
exports.getDashboardMetrics = async (req, res, next) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();

    // Aggregations
    const [
      totalClients,
      activeClients,
      totalServices,
      pfStats,
      invoiceStats,
      overdueStats,
      advanceStats,
      recentPFs,
      recentInvoices,
      recentAdvances,
      recentClients
    ] = await Promise.all([
      Client.countDocuments(),
      Client.countDocuments({ isActive: true }),
      Service.countDocuments(),

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

      // Invoice Stats (Total Invoiced, Amount Paid, Outstanding)
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

      // Advance Payment Stats (Received, Allocated, Unallocated)
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

      // Recent Records
      PFDocument.find().sort('-createdAt').limit(5).select('pfNumber documentDate clientSnapshot grandTotal status'),
      Invoice.find().sort('-createdAt').limit(5).select('invoiceNumber invoiceDate clientSnapshot grandTotal amountPaid outstandingBalance status'),
      AdvancePayment.find().sort('-createdAt').limit(5).select('receiptNumber paymentDate clientSnapshot amount unallocatedAmount paymentMethod status'),
      Client.find().sort('-createdAt').limit(5).select('clientId companyName contactPerson primaryPhone email isActive')
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

    res.status(200).json({
      success: true,
      kpis: {
        totalClients,
        activeClients,
        totalServices,
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
        overdueAmount: round2(overdueStats[0]?.totalOverdue || 0)
      },
      monthlyTrends,
      invoicesByStatus,
      recentPFs,
      recentInvoices,
      recentAdvances,
      recentClients
    });
  } catch (error) {
    next(error);
  }
};
