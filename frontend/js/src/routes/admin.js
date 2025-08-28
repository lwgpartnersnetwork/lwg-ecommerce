// routes/admin.js
import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import Order from '../models/Order.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

/* ---------------------------------- consts --------------------------------- */

const ALLOWED_STATUSES = ['New', 'Processing', 'Shipped', 'Completed', 'Cancelled'];

/* --------------------------------- schemas --------------------------------- */

const LoginSchema = z.object({
  password: z.string().min(1),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
  status: z.string().optional(),
  ref: z.string().optional(),
  from: z.string().datetime().optional(), // ISO date
  to: z.string().datetime().optional(),   // ISO date
  q: z.string().optional(),               // free text over name/email/phone
});

const UpdateStatusSchema = z.object({
  status: z.enum(ALLOWED_STATUSES),
});

/* -------------------------------- rate limit ------------------------------- */

const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

/* ---------------------------------- login ---------------------------------- */
/**
 * POST /api/admin/login
 * Body: { password }
 * Returns: { ok:true, token }
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Password is required' });
    }

    const adminPw = process.env.ADMIN_PASSWORD;
    const jwtSecret = process.env.JWT_SECRET;
    if (!adminPw || !jwtSecret) {
      return res.status(500).json({ ok: false, error: 'Server auth not configured' });
    }

    if (parsed.data.password !== adminPw) {
      return res.status(401).json({ ok: false, error: 'Wrong password' });
    }

    const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '2d' });
    return res.json({ ok: true, token });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/* ------------------------------ list all orders ---------------------------- */
/**
 * GET /api/admin/orders
 * Query:
 *  - page (default 1)
 *  - limit (default 50, max 200)
 *  - status (New|Processing|Shipped|Completed|Cancelled)
 *  - ref (exact match)
 *  - from, to (ISO date strings; filters createdAt)
 *  - q (search in info.name/email/phone)
 *
 * Returns: { ok:true, data:[...], page, limit, total, pages }
 */
router.get('/orders', requireAdmin, async (req, res) => {
  try {
    const parsed = ListQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Invalid query params' });
    }
    const { page, limit, status, ref, from, to, q } = parsed.data;

    const filter = {};
    if (status && ALLOWED_STATUSES.includes(status)) filter.status = status;
    if (ref) filter.ref = String(ref).toUpperCase();

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    if (q) {
      const term = String(q).trim();
      // simple case-insensitive search on basic customer fields
      filter.$or = [
        { 'info.name':   { $regex: term, $options: 'i' } },
        { 'info.email':  { $regex: term, $options: 'i' } },
        { 'info.phone':  { $regex: term, $options: 'i' } },
        { ref:           { $regex: term, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      Order.find(filter).sort('-createdAt').skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);

    const pages = Math.max(1, Math.ceil(total / limit));

    return res.json({ ok: true, data, page, limit, total, pages });
  } catch (err) {
    console.error('Admin list orders error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/* ------------------------------- update status ----------------------------- */
/**
 * POST /api/admin/orders/:id/status
 * Body: { status: "New"|"Processing"|"Shipped"|"Completed"|"Cancelled" }
 * Returns: { ok:true, order }
 */
router.post('/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const parsed = UpdateStatusSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: parsed.data.status },
      { new: true }
    );

    if (!order) return res.status(404).json({ ok: false, error: 'Not found' });

    return res.json({ ok: true, order });
  } catch (err) {
    console.error('Admin update status error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

export default router;
