import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
  productId: String,
  title: String,
  price: Number,
  qty: Number
}, {_id:false});

const orderSchema = new mongoose.Schema({
  ref: { type:String, required:true, unique:true },
  items: [itemSchema],
  subtotal: Number,
  deliveryZone: String,
  deliveryFee: Number,
  grandTotal: Number,
  info: {
    name:String,
    phone:String,
    email:String,
    address:String,
    payment:String,
    payment_details: Object
  },
  status: { type:String, enum:['New','Processing','Completed','Cancelled'], default:'New' }
}, { timestamps:true });

export default mongoose.model('Order', orderSchema);
