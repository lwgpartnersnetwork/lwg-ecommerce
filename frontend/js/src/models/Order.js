// models/Order.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const ALLOWED_STATUSES = ['New', 'Processing', 'Shipped', 'Completed', 'Cancelled'];
const PAYMENT_STATES   = ['Pending', 'Paid', 'Failed', 'Refunded'];

const itemSchema = new Schema(
  {
    productId: { type: String, trim: true },
    title:     { type: String, trim: true, required: true },
    price:     { type: Number, min: 0, default: 0 },
    qty:       { type: Number, min: 1, default: 1 },
  },
  { _id: false }
);

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

    // money fields
    subtotal:     { type: Number, min: 0, default: 0 },
    deliveryZone: { type: String, trim: true },
    deliveryFee:  { type: Number, min: 0, default: 0 },
    grandTotal:   { type: Number, min: 0, default: 0 },

    // payment state used by the tracker UI
    paymentStatus: { type: String, enum: PAYMENT_STATES, default: 'Pending' },

    // customer / checkout info
    info: {
      name:    { type: String, trim: true },
      phone:   { type: String, trim: true },
      email:   { type: String, trim: true, lowercase: true },
      address: { type: String, trim: true },
      payment: { type: String, trim: true },       // e.g., "cash", "orange", etc.
      payment_details: { type: Schema.Types.Mixed } // gateway metadata, refs, etc.
    },

    // lifecycle status (includes "Shipped" to match UI)
    status: { type: String, enum: ALLOWED_STATUSES, default: 'New', index: true },
  },
  { timestamps: true }
);

/* ------------------------------- normalizers ------------------------------- */
orderSchema.pre('save', function normalizeRef(next) {
  if (this.ref) this.ref = String(this.ref).trim().toUpperCase();
  next();
});

/* --------------------------------- indexes -------------------------------- */
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'info.email': 1 });
orderSchema.index({ 'info.phone': 1 });

/* ----------------------------- clean JSON shape ---------------------------- */
orderSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    // expose id (string) and keep _id hidden for a clean API
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export default mongoose.model('Order', orderSchema);
