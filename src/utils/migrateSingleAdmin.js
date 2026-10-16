const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');
const Client = require('../models/Client');
const AdvancePayment = require('../models/AdvancePayment');

const migrateSingleAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/innomatrics_crm');
    console.log('[Migration] Connected to MongoDB');

    // 1. Locate Admin User
    const adminUser = await User.findOne({ role: 'Administrator' });
    if (!adminUser) {
      console.error('[Migration Error] No Administrator account found in database!');
      process.exit(1);
    }
    console.log(`[Migration] Target Administrator: ${adminUser.name} (${adminUser.email}), ID: ${adminUser._id}`);

    // 2. Locate any Finance accounts or finance@innomatrics.com
    const financeUsers = await User.find({
      $or: [
        { role: 'Finance' },
        { email: 'finance@innomatrics.com' }
      ]
    });

    console.log(`[Migration] Found ${financeUsers.length} legacy Finance account(s).`);

    for (const fUser of financeUsers) {
      console.log(`[Migration] Processing account: ${fUser.email} (ID: ${fUser._id})`);

      // Find historical records createdBy this user
      const clientCount = await Client.countDocuments({ createdBy: fUser._id });
      const advanceCount = await AdvancePayment.countDocuments({ createdBy: fUser._id });

      console.log(`[Migration] Account owns ${clientCount} clients and ${advanceCount} advance payments.`);

      // Deactivate account safely instead of breaking foreign keys, set role to Staff and isActive to false
      fUser.isActive = false;
      fUser.role = 'Staff';
      await fUser.save();
      console.log(`[Migration] Successfully deactivated ${fUser.email} (isActive: false, role: 'Staff').`);
    }

    console.log('[Migration] Single Administrator migration completed successfully.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('[Migration Error]:', error);
    process.exit(1);
  }
};

migrateSingleAdmin();
