const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const bcrypt = require('bcryptjs');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/User');

test('Authentication & Single-Admin Authorization Suite', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI);

  let adminUser = await User.findOne({ role: 'Administrator', email: 'admin@innomatrics.com' });
  if (!adminUser) {
    adminUser = await User.create({
      name: 'Vikram Sharma',
      email: 'admin@innomatrics.com',
      password: 'AdminPassword123!',
      role: 'Administrator',
      employeeId: 'EMP-001',
      phone: '+91 98111 22233'
    });
  }

  await t.test('1. Master Administrator exists and is active', async () => {
    const admin = await User.findOne({ email: 'admin@innomatrics.com' });
    assert.ok(admin, 'Admin should exist');
    assert.equal(admin.role, 'Administrator');
    assert.equal(admin.isActive, true);
  });

  await t.test('2. Admin password match works correctly', async () => {
    const admin = await User.findOne({ email: 'admin@innomatrics.com' }).select('+password');
    const isCorrect = await admin.matchPassword('AdminPassword123!');
    assert.equal(isCorrect, true, 'Valid password must match');

    const isWrong = await admin.matchPassword('WrongPassword999!');
    assert.equal(isWrong, false, 'Invalid password must fail');
  });

  await t.test('3. Legacy Finance Lead account is deactivated', async () => {
    const financeUser = await User.findOne({ email: 'finance@innomatrics.com' });
    if (financeUser) {
      assert.equal(financeUser.isActive, false, 'Finance lead must be inactive');
      assert.notEqual(financeUser.role, 'Finance', 'Finance role must be deprecated');
    }
  });

  await t.test('4. Role enumeration restricts Finance role creation', async () => {
    const validRoles = User.schema.path('role').enumValues;
    assert.ok(validRoles.includes('Administrator'));
    assert.ok(validRoles.includes('Staff'));
    assert.ok(!validRoles.includes('Finance'), 'Finance role must not be permitted in User model enum');
  });

  await t.test('5. Password hashing on save', async () => {
    const tempUser = new User({
      name: 'Temp Admin Test',
      email: `test.${Date.now()}@innomatrics.test`,
      password: 'PlainPassword123!',
      role: 'Staff'
    });
    await tempUser.save();

    assert.notEqual(tempUser.password, 'PlainPassword123!', 'Password must be hashed on save');
    assert.ok(tempUser.password.startsWith('$2'), 'Must be bcrypt hash');

    const isMatch = await tempUser.matchPassword('PlainPassword123!');
    assert.equal(isMatch, true);

    await User.deleteOne({ _id: tempUser._id });
  });

  await mongoose.disconnect();
});
