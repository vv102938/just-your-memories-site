const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true },
    imageUrl: { type: String, default: null }
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true, uppercase: true },
    zip: { type: String, required: true }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, uppercase: true },
    status: {
      type: String,
      default: 'awaiting_confirmation',
      enum: ['awaiting_confirmation', 'pending', 'printing', 'shipped', 'completed', 'cancelled']
    },
    emailConfirmed: { type: Boolean, default: false },
    confirmationToken: { type: String, sparse: true },
    customer: { type: customerSchema, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    shipping: { type: Number, required: true },
    total: { type: Number, required: true },
    confirmedAt: { type: Date, default: null }
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: 'orders'
  }
);

orderSchema.index({ confirmationToken: 1 }, { sparse: true });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'customer.email': 1 });

module.exports = mongoose.model('Order', orderSchema);
