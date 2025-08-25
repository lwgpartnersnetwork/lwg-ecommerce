import express from 'express';
import Order from '../models/Order.js';

const router = express.Router();

// Public: create order
router.post('/', async (req,res)=>{
  // Expect: { items:[{productId,title,price,qty}], subtotal, deliveryZone, deliveryFee, grandTotal, info:{...} }
  const { items, subtotal, deliveryZone, deliveryFee, grandTotal, info } = req.body || {};
  if(!Array.isArray(items) || items.length===0) return res.status(400).json({error:'No items'});
  const ref = 'LWG-' + Math.random().toString(36).slice(2,8).toUpperCase();

  const order = await Order.create({
    ref, items, subtotal, deliveryZone, deliveryFee, grandTotal, info
  });
  res.json(order);
});

export default router;
