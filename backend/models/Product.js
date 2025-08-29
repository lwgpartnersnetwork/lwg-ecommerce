import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema({
  title: { type: String, required: true },
  slug:  { type: String, unique: true, index: true },
  price: { type: Number, required: true, min: 0 },
  image: { type: String },
  images: [{ type: String }],
  desc:   { type: String, default: '' },
  category: { type: String, index: true },
  tags:   [{ type: String, index: true }],
}, { timestamps: true, versionKey: false });

ProductSchema.pre('save', function(next){
  if (!this.slug && this.title) {
    this.slug = this.title.toLowerCase()
      .replace(/[^a-z0-9]+/g,'-')
      .replace(/(^-|-$)/g,'');
  }
  next();
});

const Product = mongoose.models.Product || mongoose.model('Product', ProductSchema);
export default Product;
