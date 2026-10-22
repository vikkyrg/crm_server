const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middleware/error');

// Route imports
const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const pfRoutes = require('./routes/pfRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const advanceRoutes = require('./routes/advanceRoutes');
const quantityRoutes = require('./routes/quantityRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const reportRoutes = require('./routes/reportRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const payrollRoutes = require('./routes/payrollRoutes');
const employeePfRoutes = require('./routes/employeePfRoutes');
const deliveryChallanRoutes = require('./routes/deliveryChallanRoutes');

const app = express();

// Security and utility middleware
app.use(helmet({
  contentSecurityPolicy: false // Allows documents/downloads without strict header blocks in dev
}));

const configuredOrigins = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map(s => s.trim()) : [];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (
      configuredOrigins.includes('*') ||
      configuredOrigins.includes(origin) ||
      /^http:\/\/localhost:(3000|3001|5173)$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:(3000|3001|5173)$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Navadurga CRM API is operational' });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/pf-documents', pfRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/advances', advanceRoutes);
app.use('/api/quantities', quantityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/employee-pf', employeePfRoutes);
app.use('/api/delivery-challans', deliveryChallanRoutes);

// Central Error Handler
app.use(errorHandler);

module.exports = app;
