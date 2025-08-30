import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    desc: { type: String, default: '' },

    // Images
    image: { type: String, default: '' },   // cover image
    images: [{ type: String }],             // gallery of images

    // Categorization
    category: { type: String, default: '' },
    tags: [{ type: String }],

    // SEO / slug
    slug: { type: String, unique: true, sparse: true },

    // Stock
    stock: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* ----------------------------- Indexes & hooks ----------------------------- */
// Ensure slug is lowercase if present
ProductSchema.pre('save', function (next) {
  if (this.slug) this.slug = this.slug.trim().toLowerCase();
  next();
});

// Add useful indexes
ProductSchema.index({ title: 'text', desc: 'text', tags: 1, category: 1 });

/* ---------------------------- Clean JSON output ---------------------------- */
ProductSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

/* ----------------------------- Export Model ----------------------------- */
export default mongoose.models.Product || mongoose.model('Product', ProductSchema);
