const mongoose = require('mongoose');
const shippingSchema = require('./shipping');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, default: 'customer', enum: ['customer', 'admin'] },
    emailVerified: { type: Boolean, default: false },
    shipping: shippingSchema
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'users'
  }
);

module.exports = mongoose.model('User', userSchema);
