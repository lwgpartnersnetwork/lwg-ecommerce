// models/Product.js
import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema({
  title:     { type: String, required: true, trim: true },
  price:     { type: Number, required: true, min: 0 },
  image:     { type: String, default: '' },
  desc:      { type: String, default: '' },
  stock:     { type: Number, default: 0, min: 0 },
  // optional helpers for SEO / filtering
  slug:      { type: String, unique: true, sparse: true },
  category:  { type: String, default: '' },
  tags:      { type: [String], default: [] },
}, { timestamps: true });

export default mongoose.models.Product || mongoose.model('Product', ProductSchema);
