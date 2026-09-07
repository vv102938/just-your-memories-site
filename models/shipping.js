const mongoose = require('mongoose');

const shippingSchema = new mongoose.Schema(
  {
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true, uppercase: true },
    zip: { type: String, trim: true }
  },
  { _id: false }
);

module.exports = shippingSchema;
