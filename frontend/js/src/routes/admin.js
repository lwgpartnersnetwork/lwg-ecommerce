import express from 'express';
import jwt from 'jsonwebtoken';
import Order from '../models/Order.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Login → returns admin JWT
router.post('/login', async (req,res)=>{
  const { password } = req.body || {};
  if(password !== process.env.ADMIN_PASSWORD) return res.status(401).json({error:'Wrong password'});
  const token = jwt.sign({ role:'admin' }, process.env.JWT_SECRET, { expiresIn:'2d' });
  res.json({ token });
});

// List all orders (admin)
router.get('/orders', requireAdmin, async (req,res)=>{
  const list = await Order.find().sort('-createdAt').lean();
  res.json(list);
});

// Update status
router.post('/orders/:id/status', requireAdmin, async (req,res)=>{
  const { status } = req.body || {};
  if(!['New','Processing','Completed','Cancelled'].includes(status)) {
    return res.status(400).json({error:'Invalid status'});
  }
  const doc = await Order.findByIdAndUpdate(req.params.id, { status }, { new:true });
  if(!doc) return res.status(404).json({error:'Not found'});
  res.json(doc);
});

export default router;
