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
    items: (o.items || []).map((it) => ({
      product: it.product
        ? {
            id: it.product.id ?? it.product._id ?? undefined,
            title: it.product.title,
            price: it.product.price,
            image: it.product.image,
          }
        : undefined,
      qty: it.qty,
      price: it.price, // if stored at line level
    })),
    subtotal: o.subtotal,
    deliveryZone: o.deliveryZone ?? o.info?.deliveryZone,
    deliveryFee: o.deliveryFee ?? o.info?.deliveryFee,
    grandTotal: o.grandTotal ?? o.info?.grandTotal ?? o.info?.subtotal,
    paymentStatus: o.paymentStatus || 'Pending',
    proofUrl: o.proofUrl,
    info: {
      // only echo back non-sensitive basics for the UI
      name: o.info?.name,
      phone: o.info?.phone,
      email: o.info?.email,
      deliveryZone: o.info?.deliveryZone,
      address: o.info?.address,
      payment: o.info?.payment,
      subtotal: o.info?.subtotal,
      deliveryFee: o.info?.deliveryFee,
      grandTotal: o.info?.grandTotal,
    },
  };
}

/* --------------------------------- schemas -------------------------------- */
/** Shape A (your checkout.html sends): { order:{ items:[{id,qty,product:{title,price,image}}], info:{...}, total/subtotals... }, proof? } */
const FrontLineItemSchema = z.object({
  id: z.string().min(1),
  qty: z.number().int().positive(),
  product: z
    .object({
      title: z.string().min(1),
      price: z.number().nonnegative(),
      image: z.string().optional().default(''),
    })
    .partial({ image: true }),
});

const FrontOrderSchema = z.object({
  items: z.array(FrontLineItemSchema).min(1),
  total: z.number().nonnegative().optional(), // legacy field from older pages
  info: z
    .object({
      name: z.string().min(1),
      phone: z.string().optional().default(''),
      email: z.string().optional().default(''),
      payment: z.string().optional().default(''),
      address: z.string().optional().default(''),
      deliveryZone: z.string().optional().default(''),
      deliveryFee: z.number().nonnegative().optional().default(0),
      subtotal: z.number().nonnegative().optional().default(0),
      grandTotal: z.number().nonnegative().optional(),
      payment_details: z.record(z.string()).optional(), // any payment snapshot strings
    })
    .refine(
      (v) => (v.phone && normalizePhone(v.phone).startsWith('+')) || (v.email && isEmail(v.email)),
      { message: 'Provide a valid E.164 phone (+…) or a valid email' }
    ),
});

const ProofSchema = z
  .object({
    filename: z.string().optional(),
    mime: z.string().optional(),
    base64: z.string().optional(),
  })
  .partial()
  .optional();

/** Shape B (alternative flat API): { items:[{productId,title,price,qty}], subtotal, deliveryFee, grandTotal, info:{...} } */
const FlatLineItemSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  qty: z.number().int().positive(),
});

const FlatOrderSchema = z
  .object({
    items: z.array(FlatLineItemSchema).min(1),
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
        (v) =>
          (v.phone && normalizePhone(v.phone).startsWith('+')) ||
          (v.email && isEmail(v.email)),
        { message: 'Provide a valid E.164 phone (+…) or a valid email' }
      ),
  })
  .refine(
    (data) =>
      Math.round((data.subtotal + (data.deliveryFee || 0)) * 100) ===
      Math.round((data.grandTotal || 0) * 100),
    { message: 'Totals do not add up' }
  );

/* -------------------------------- rate limits ------------------------------ */

const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many order attempts, slow down.' },
});

const trackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests' },
});

/* ---------------------------- normalization utils -------------------------- */

function computeTotalsFromFront(front) {
  const subtotal =
    front.info?.subtotal ??
    front.items.reduce((s, it) => s + Number(it.product?.price || 0) * Number(it.qty || 0), 0);
  const deliveryFee = Number(front.info?.deliveryFee || 0);
  const grandTotal =
    front.info?.grandTotal ??
    front.total /* legacy */ ??
    subtotal + deliveryFee;

  return { subtotal, deliveryFee, grandTotal };
}

function toDbOrderFromFront(front) {
  const { subtotal, deliveryFee, grandTotal } = computeTotalsFromFront(front);

  return {
    items: front.items.map((it) => ({
      product: {
        id: it.id,
        title: it.product?.title || 'Item',
        price: Number(it.product?.price || 0),
        image: it.product?.image || '',
      },
      qty: it.qty,
      price: Number(it.product?.price || 0),
    })),
    subtotal,
    deliveryZone: front.info?.deliveryZone || '',
    deliveryFee,
    grandTotal,
    info: {
      name: front.info?.name || '',
      phone: front.info?.phone ? normalizePhone(front.info.phone) : '',
      email: (front.info?.email || '').trim().toLowerCase(),
      payment: front.info?.payment || '',
      address: front.info?.address || '',
      deliveryZone: front.info?.deliveryZone || '',
      deliveryFee,
      subtotal,
      grandTotal,
      // keep any string-only snapshot fields
      ...(front.info?.payment_details || {}),
    },
  };
}

function toDbOrderFromFlat(flat) {
  return {
    items: flat.items.map((it) => ({
      product: {
        id: it.productId,
        title: it.title,
        price: Number(it.price || 0),
      },
      qty: it.qty,
      price: Number(it.price || 0),
    })),
    subtotal: flat.subtotal,
    deliveryZone: flat.deliveryZone || '',
    deliveryFee: Number(flat.deliveryFee || 0),
    grandTotal: flat.grandTotal,
    info: {
      ...(flat.info || {}),
      phone: flat.info?.phone ? normalizePhone(flat.info.phone) : '',
      email: (flat.info?.email || '').trim().toLowerCase(),
    },
  };
}

/* --------------------------------- routes --------------------------------- */
/**
 * POST /api/orders
 * Accepts either:
 *  A) { order:{ items:[{id,qty,product:{title,price,image}}], info:{...}, ... }, proof? }
 *  B) { items:[{productId,title,price,qty}], subtotal, deliveryFee, grandTotal, info:{...} }
 * Returns: { ok:true, ref, order }
 */
router.post('/', createLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    // Try Shape A (frontend "order" wrapper)
    let parsedFront = null;
    if (body.order && typeof body.order === 'object') {
      parsedFront = FrontOrderSchema.safeParse(body.order);
      if (!parsedFront.success) {
        const msg = parsedFront.error.issues?.[0]?.message || 'Invalid order payload';
        return res.status(400).json({ ok: false, error: msg });
      }
    }

    // Else try Shape B (flat)
    let parsedFlat = null;
    if (!parsedFront) {
      parsedFlat = FlatOrderSchema.safeParse(body);
      if (!parsedFlat.success) {
        const msg = parsedFlat.error.issues?.[0]?.message || 'Invalid payload';
        return res.status(400).json({ ok: false, error: msg });
      }
    }

    // Optional proof (ignored for now; could be stored to S3/Cloudinary)
    const proof = ProofSchema.safeParse(body.proof || null).success ? body.proof : null;

    const normalized =
      parsedFront ? toDbOrderFromFront(parsedFront.data) : toDbOrderFromFlat(parsedFlat.data);

    const ref = 'LWG-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    const doc = await Order.create({
      ref,
      ...normalized,
      status: 'New',
      paymentStatus: 'Pending',
      // If you later store proof to storage, keep the URL here:
      ...(proof ? { proofUrl: '' } : {}),
    });

    return res.json({ ok: true, ref: doc.ref, order: shapeOrder(doc) });
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

    // PDF response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ref}-receipt.pdf"`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    const money = (n) => 'NLe ' + Number(n || 0).toLocaleString();

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

    (order.items || []).forEach((it) => {
      const title = it?.product?.title ?? 'Item';
      const unit = it?.product?.price ?? it?.price ?? 0;
      const qty = it?.qty ?? 0;
      doc.text(`${title} × ${qty} — ${money(unit)}`);
    });

    doc.moveDown();
    const subtotal = order.subtotal ?? order.info?.subtotal ?? 0;
    const fee = order.deliveryFee ?? order.info?.deliveryFee ?? 0;
    const total = order.grandTotal ?? order.info?.grandTotal ?? subtotal + fee;

    doc.text(`Subtotal: ${money(subtotal)}`);
    if (fee) doc.text(`Delivery: ${money(fee)}`);
    doc.font('Helvetica-Bold').text(`Total: ${money(total)}`);
    doc.font('Helvetica').moveDown();

    doc.text('Thank you for your order!', { align: 'left' });

    doc.end();
  } catch (err) {
    console.error('Receipt PDF error:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Could not generate receipt' });
    } else {
      res.end();
    }
  }
});

export default router;
