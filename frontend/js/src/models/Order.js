// models/Order.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/* -------------------------------------------------------------------------- */
/*                                 Constants                                  */
/* -------------------------------------------------------------------------- */
const ALLOWED_STATUSES = ['New', 'Processing', 'Shipped', 'Completed', 'Cancelled'];
const PAYMENT_STATES   = ['Pending', 'Paid', 'Failed', 'Refunded'];

/* -------------------------------------------------------------------------- */
/*                                   Items                                    */
/* -------------------------------------------------------------------------- */
const itemSchema = new Schema(
  {
    productId: { type: String, trim: true },                // optional external id
    title:     { type: String, trim: true, required: true },
    price:     { type: Number, min: 0, default: 0 },
    qty:       { type: Number, min: 1, default: 1 },
  },
  { _id: false }
);

/* -------------------------------------------------------------------------- */
/*                                   Orders                                   */
/* -------------------------------------------------------------------------- */
const orderSchema = new Schema(
  {
    ref: { type: String, required: true, unique: true, index: true, trim: true },

    items: {
      type: [itemSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Order must contain at least one item',
      },
    },

    // totals
    subtotal:     { type: Number, min: 0, default: 0 },
    deliveryZone: { type: String, trim: true },
    deliveryFee:  { type: Number, min: 0, default: 0 },
    grandTotal:   { type: Number, min: 0, default: 0 },

    // payment state (admin + tracker)
    paymentStatus: { type: String, enum: PAYMENT_STATES, default: 'Pending' },

    // checkout info
    info: {
      name:    { type: String, trim: true },
      phone:   { type: String, trim: true },
      email:   { type: String, trim: true, lowercase: true },
      address: { type: String, trim: true },
      deliveryZone: { type: String, trim: true },    // duplicate for quick filter
      payment: { type: String, trim: true },         // e.g., "Orange Money"
      payment_details: { type: Schema.Types.Mixed }, // gateway metadata / proof
      note:    { type: String, trim: true },         // optional note from admin/customer
    },

    // lifecycle status
    status: { type: String, enum: ALLOWED_STATUSES, default: 'New', index: true },
  },
  { timestamps: true }
);

/* -------------------------------------------------------------------------- */
/*                               Normalizations                               */
/* -------------------------------------------------------------------------- */
orderSchema.pre('save', function normalizeRef(next) {
  if (this.ref) this.ref = String(this.ref).trim().toUpperCase();
  next();
});

/* -------------------------------------------------------------------------- */
/*                                   Indexes                                  */
/* -------------------------------------------------------------------------- */
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'info.email': 1 });
orderSchema.index({ 'info.phone': 1 });
orderSchema.index({ ref: 1 });

/* -------------------------------------------------------------------------- */
/*                                JSON Cleanup                                */
/* -------------------------------------------------------------------------- */
orderSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export default mongoose.model('Order', orderSchema);
