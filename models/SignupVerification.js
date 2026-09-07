const mongoose = require('mongoose');
const shippingSchema = require('./shipping');

const signupVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    shipping: shippingSchema,
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'signup_verifications'
  }
);

signupVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SignupVerification', signupVerificationSchema);
