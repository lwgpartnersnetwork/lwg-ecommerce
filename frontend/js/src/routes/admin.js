// routes/admin.js
import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import Order from '../models/Order.js';

const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                              Config / Utilities                            */
/* -------------------------------------------------------------------------- */

const ADMIN_USER   = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASS || 'admin123';
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN || '';     // if set, we'll return/expect this exact token
const JWT_SECRET   = process.env.JWT_SECRET || '';      // alternative to ADMIN_TOKEN

const ALLOWED_STATUSES = ['New', 'Processing', 'Shipped', 'Completed', 'Cancelled'];
const ALLOWED_PSTATUS  = ['Pending', 'Paid', 'Failed'];

function issueToken(payload = { role: 'admin' }) {
  // Prefer static ADMIN_TOKEN for simple setups
  if (ADMIN_TOKEN) return ADMIN_TOKEN;
  // else sign a short JWT
  if (!JWT_SECRET) {
    // last resort: ephemeral unsigned-ish token (not recommended for prod)
    return Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString('base64url');
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2d' });
}

function verifyToken(token) {
  if (!token) return false;
  if (ADMIN_TOKEN) return token === ADMIN_TOKEN;
  if (!JWT_SECRET) return !!token; // best-effort if no secret (dev only)
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const hdr = String(req.headers.authorization || '');
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  if (!verifyToken(token)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

/* -------------------------------------------------------------------------- */
/*                                    Zod                                     */
/* -------------------------------------------------------------------------- */

// Login { user, pass }
const LoginSchema = z.object({
  user: z.string().min(1),
  pass: z.string().min(1),
});

// List filters (match admin-orders.html)
const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(200).optional().default(20),
  q: z.string().optional(),          // search ref/name/phone/email
  status: z.string().optional(),     // New|Processing|Shipped|Completed|Cancelled
  pstatus: z.string().optional(),    // Pending|Paid|Failed
  from: z.string().optional(),       // YYYY-MM-DD (date only ok)
  to: z.string().optional(),         // YYYY-MM-DD
});

// Update order (from admin-orders.html -> PATCH body)
const UpdateOrderSchema = z.object({
  status: z.string().optional(),
  paymentStatus: z.string().optional(),
  note: z.string().optional(),
}).refine((v) => {
  if (v.status && !ALLOWED_STATUSES.includes(v.status)) return false;
  if (v.paymentStatus && !ALLOWED_PSTATUS.includes(v.paymentStatus)) return false;
  return true;
}, { message: 'Invalid status or paymentStatus' });

/* -------------------------------------------------------------------------- */
/*                                   Limits                                   */
/* -------------------------------------------------------------------------- */

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many login attempts' },
});

const listLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

/* -------------------------------------------------------------------------- */
/*                                   Routes                                   */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/admin/login
 * Body: { user, pass }
 * Returns: { ok:true, token }
 */
router.post('/login', loginLimiter, (req, res) => {
  const parsed = LoginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: 'Username and password required' });
  }
  const { user, pass } = parsed.data;
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }
  return res.json({ ok: true, token: issueToken() });
});

/**
 * GET /api/admin/orders
 * Query: page, pageSize, q, status, pstatus, from, to
 * Returns: { ok:true, orders, total }
 *
 * NOTE: Matches your admin-orders.html expectations.
 */
router.get('/orders', requireAdmin, listLimiter, async (req, res) => {
  try {
    const parsed = ListQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: 'Invalid query' });
    }
    const { page, pageSize, q, status, pstatus, from, to } = parsed.data;

    const filter = {};

    // status filter
    if (status && ALLOWED_STATUSES.includes(status)) {
      filter.status = status;
    }

    // payment status filter
    if (pstatus && ALLOWED_PSTATUS.includes(pstatus)) {
      filter.paymentStatus = pstatus;
    }

    // date range
    if (from || to) {
      const start = from ? new Date(from) : null; // treat as local midnight
      const end   = to   ? new Date(to)   : null;

      // Normalize to full-day ranges if date without time
      const createdAt = {};
      if (start) { createdAt.$gte = new Date(start.setHours(0,0,0,0)); }
      if (end)   { createdAt.$lte = new Date(new Date(end.setHours(0,0,0,0)).getTime() + 24*60*60*1000 - 1); }
      filter.createdAt = createdAt;
    }

    // search
    if (q && q.trim()) {
      const term = String(q).trim();
      filter.$or = [
        { ref: { $regex: term, $options: 'i' } },
        { 'info.name':  { $regex: term, $options: 'i' } },
        { 'info.email': { $regex: term, $options: 'i' } },
        { 'info.phone': { $regex: term, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * pageSize;
    const [orders, total] = await Promise.all([
      Order.find(filter).sort('-createdAt').skip(skip).limit(pageSize).lean(),
      Order.countDocuments(filter),
    ]);

    return res.json({ ok: true, orders, total, page, pageSize });
  } catch (err) {
    console.error('Admin list orders error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/**
 * PATCH /api/admin/orders/:id
 * Body: { status?, paymentStatus?, note? }
 * Returns: { ok:true, order }
 *
 * NOTE: Matches your admin-orders.html Update button.
 */
router.patch('/orders/:id', requireAdmin, async (req, res) => {
  try {
    const parsed = UpdateOrderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.issues?.[0]?.message || 'Invalid payload' });
    }

    const update = {};
    if (parsed.data.status)        update.status = parsed.data.status;
    if (parsed.data.paymentStatus) update.paymentStatus = parsed.data.paymentStatus;
    if (parsed.data.note)          update.note = parsed.data.note;

    const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!order) return res.status(404).json({ ok: false, error: 'Not found' });

    return res.json({ ok: true, order });
  } catch (err) {
    console.error('Admin update order error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/**
 * GET /api/admin/orders/export.csv
 * Same filters as /api/admin/orders
 * Returns text/csv
 */
router.get('/orders/export.csv', requireAdmin, listLimiter, async (req, res) => {
  try {
    const parsed = ListQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).send('Invalid query');
    }
    const { q, status, pstatus, from, to } = parsed.data;

    const filter = {};
    if (status && ALLOWED_STATUSES.includes(status)) filter.status = status;
    if (pstatus && ALLOWED_PSTATUS.includes(pstatus)) filter.paymentStatus = pstatus;

    if (from || to) {
      const start = from ? new Date(from) : null;
      const end   = to   ? new Date(to)   : null;
      const createdAt = {};
      if (start) { createdAt.$gte = new Date(start.setHours(0,0,0,0)); }
      if (end)   { createdAt.$lte = new Date(new Date(end.setHours(0,0,0,0)).getTime() + 24*60*60*1000 - 1); }
      filter.createdAt = createdAt;
    }

    if (q && q.trim()) {
      const term = String(q).trim();
      filter.$or = [
        { ref: { $regex: term, $options: 'i' } },
        { 'info.name':  { $regex: term, $options: 'i' } },
        { 'info.email': { $regex: term, $options: 'i' } },
        { 'info.phone': { $regex: term, $options: 'i' } },
      ];
    }

    const orders = await Order.find(filter).sort('-createdAt').lean();

    // Build CSV
    const esc = (s = '') => {
      const v = String(s ?? '');
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };

    const lines = [
      [
        'ref','date','status','paymentStatus','name','phone','email',
        'deliveryZone','address','subtotal','deliveryFee','grandTotal','items'
      ].join(','),
      ...orders.map(o => {
        const items = (o.items || [])
          .map(it => `${(it.product && it.product.title) || 'Item'} × ${it.qty}`)
          .join('; ');
        return [
          esc(o.ref),
          esc(new Date(o.createdAt).toISOString()),
          esc(o.status || ''),
          esc(o.paymentStatus || ''),
          esc(o.info?.name || ''),
          esc(o.info?.phone || ''),
          esc(o.info?.email || ''),
          esc(o.info?.deliveryZone || ''),
          esc(o.info?.address || ''),
          String(o.subtotal ?? o.info?.subtotal ?? 0),
          String(o.deliveryFee ?? o.info?.deliveryFee ?? 0),
          String(o.grandTotal ?? o.info?.grandTotal ?? 0),
          esc(items)
        ].join(',');
      })
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return res.send(lines);
  } catch (err) {
    console.error('Admin export CSV error:', err);
    return res.status(500).send('Server error');
  }
});

export default router;
