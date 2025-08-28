// routes/orders.js
import express from 'express';
import rateLimit from 'express-rate-limit';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import Order from '../models/Order.js';

const router = express.Router();

/* ------------------------------ utils/helpers ------------------------------ */

const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || ''));
const normalizePhone = (v) => {
  if (!v) return '';
  const digits = String(v).replace(/[^\d+]/g, '').replace(/^\+?/, '');
  return digits ? `+${digits}` : '';
};

// keep the shape the client expects (avoid leaking internals)
function shapeOrder(o) {
  if (!o) return null;
  return {
    _id: o._id,
    ref: o.ref,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    items: o.items?.map((it) => ({
      product: it.product
        ? {
            id: it.product.id ?? it.product._id ?? undefined,
            title: it.product.title,
            price: it.product.price,
          }
        : undefined,
      qty: it.qty,
      price: it.price, // if you store price at line level
    })),
    subtotal: o.subtotal,
    deliveryZone: o.deliveryZone,
    deliveryFee: o.deliveryFee,
    grandTotal: o.grandTotal,
    paymentStatus: o.paymentStatus,
    info: {
      // only echo back non-sensitive basics for the UI
      name: o.info?.name,
      phone: o.info?.phone,
      email: o.info?.email,
      deliveryZone: o.info?.deliveryZone,
      address: o.info?.address,
    },
  };
}

/* --------------------------------- schemas -------------------------------- */

const LineItemSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  qty: z.number().int().positive(),
});

const OrderCreateSchema = z.object({
  items: z.array(LineItemSchema).min(1),
  subtotal: z.number().nonnegative(),
  deliveryZone: z.string().optional().default(''),
  deliveryFee: z.number().nonnegative().optional().default(0),
  grandTotal: z.number().nonnegative(),
  info: z
    .object({
      name: z.string().min(1).optional().default(''),
      phone: z.string().optional().default(''),
      email: z.string().optional().default(''),
      address: z.string().optional().default(''),
      deliveryZone: z.string().optional().default(''),
      note: z.string().optional().default(''),
    })
    .refine(
      (v) => (v.phone && normalizePhone(v.phone).startsWith('+')) || (v.email && isEmail(v.email)),
      { message: 'Provide a valid E.164 phone (+…) or a valid email' }
    ),
}).refine((data) => Math.round((data.subtotal + (data.deliveryFee || 0)) * 100) === Math.round((data.grandTotal || 0) * 100), {
  message: 'Totals do not add up',
});

/* -------------------------------- rate limit ------------------------------- */

const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests' },
});

/* --------------------------------- routes --------------------------------- */

/**
 * POST /api/orders
 * Body: { items:[{productId,title,price,qty}], subtotal, deliveryZone, deliveryFee, grandTotal, info:{...} }
 * Returns: { ok:true, order }
 */
router.post('/', createLimiter, async (req, res) => {
  try {
    const parsed = OrderCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const msg = parsed.error.issues?.[0]?.message || 'Invalid payload';
      return res.status(400).json({ ok: false, error: msg });
    }
    const { items, subtotal, deliveryZone, deliveryFee, grandTotal, info } = parsed.data;

    const ref = 'LWG-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    const doc = await Order.create({
      ref,
      items,
      subtotal,
      deliveryZone,
      deliveryFee,
      grandTotal,
      info: {
        ...info,
        phone: info.phone ? normalizePhone(info.phone) : '',
        email: info.email?.trim().toLowerCase() || '',
      },
      status: 'New',
    });

    return res.json({ ok: true, order: shapeOrder(doc) });
  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({ ok: false, error: 'Server error creating order' });
  }
});

/**
 * GET /api/orders/track?ref=…&email=… | &phone=…
 * Returns: { ok:true, order }
 * 404 if not found / identity mismatch
 */
router.get('/track', trackLimiter, async (req, res) => {
  try {
    const ref = String(req.query.ref || '').trim().toUpperCase();
    const email = (req.query.email ? String(req.query.email) : '').trim().toLowerCase();
    const phoneRaw = (req.query.phone ? String(req.query.phone) : '').trim();
    const phone = phoneRaw ? normalizePhone(phoneRaw) : '';

    if (!ref) return res.status(400).json({ ok: false, error: 'Missing ref' });
    if (!email && !phone) return res.status(400).json({ ok: false, error: 'Provide phone or email' });

    const order = await Order.findOne({ ref }).lean();
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

    // identity check
    const matchEmail = email && order.info?.email && order.info.email.toLowerCase() === email;
    const matchPhone = phone && order.info?.phone && normalizePhone(order.info.phone) === phone;

    if (!matchEmail && !matchPhone) {
      return res.status(404).json({ ok: false, error: 'No order matches that contact' });
    }

    return res.json({ ok: true, order: shapeOrder(order) });
  } catch (err) {
    console.error('Track error:', err);
    // If your database layer may throw specific availability errors, you could translate to 503 here.
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/**
 * GET /api/orders/receipt.pdf?ref=…&email=… | &phone=…
 * Streams a simple PDF receipt (identity must match).
 */
router.get('/receipt.pdf', trackLimiter, async (req, res) => {
  try {
    const ref = String(req.query.ref || '').trim().toUpperCase();
    const email = (req.query.email ? String(req.query.email) : '').trim().toLowerCase();
    const phoneRaw = (req.query.phone ? String(req.query.phone) : '').trim();
    const phone = phoneRaw ? normalizePhone(phoneRaw) : '';

    if (!ref) return res.status(400).json({ ok: false, error: 'Missing ref' });
    if (!email && !phone) return res.status(400).json({ ok: false, error: 'Provide phone or email' });

    const order = await Order.findOne({ ref }).lean();
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

    const matchEmail = email && order.info?.email && order.info.email.toLowerCase() === email;
    const matchPhone = phone && order.info?.phone && normalizePhone(order.info.phone) === phone;
    if (!matchEmail && !matchPhone) {
      return res.status(404).json({ ok: false, error: 'No order matches that contact' });
    }

    // Build PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ref}-receipt.pdf"`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(18).text('LWG — Order Receipt', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Reference: ${order.ref}`);
    doc.text(`Date: ${new Date(order.createdAt || Date.now()).toLocaleString()}`);
    doc.text(`Status: ${order.status || 'New'}`);
    doc.moveDown();

    doc.text(`Customer: ${order.info?.name || ''}`);
    if (order.info?.phone) doc.text(`Phone: ${order.info.phone}`);
    if (order.info?.email) doc.text(`Email: ${order.info.email}`);
    if (order.info?.address) doc.text(`Address: ${order.info.address}`);
    doc.moveDown();

    doc.fontSize(14).text('Items');
    doc.moveDown(0.5);
    doc.fontSize(12);

    const money = (n) => 'NLe ' + Number(n || 0).toLocaleString();

    (order.items || []).forEach((it) => {
      const title = it?.product?.title ?? 'Item';
      const unit = it?.product?.price ?? it?.price ?? 0;
      const qty = it?.qty ?? 0;
      doc.text(`${title} × ${qty} — ${money(unit)}`);
    });

    doc.moveDown();
    doc.text(`Subtotal: ${money(order.subtotal)}`);
    if (order.deliveryFee) doc.text(`Delivery: ${money(order.deliveryFee)}`);
    doc.font('Helvetica-Bold').text(`Total: ${money(order.grandTotal)}`);
    doc.font('Helvetica').moveDown();

    doc.text('Thank you for your order!', { align: 'left' });

    doc.end();
  } catch (err) {
    console.error('Receipt PDF error:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Could not generate receipt' });
    } else {
      // If streaming started, just destroy the socket on error
      res.end();
    }
  }
});

export default router;
