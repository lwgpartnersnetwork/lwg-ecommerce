// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { z } from 'zod';
import { v2 as cloudinary } from 'cloudinary';
import PDFDocument from 'pdfkit';
import productsRoutes from './routes/products.js';


// ✅ Products route (import ONCE)
import productsRoutes from './routes/products.js';

/* =========================
   Small helpers
   ========================= */
function noStore(_req, res, next){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  next();
}
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const kvBlock = (obj) => Object.entries(obj).map(([k,v]) => `- ${k}: ${v}`).join('\n');
const kvHTML  = (obj) => `<ul style="margin-top:6px">${Object.entries(obj).map(([k,v])=>`<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>`;
function get(obj, path, fallback) {
  try {
    const parts = String(path || '').split('.');
    let cur = obj;
    for (let i=0;i<parts.length;i++){
      if (!cur || typeof cur !== 'object') return fallback;
      cur = cur[parts[i]];
    }
    return (cur == null ? fallback : cur);
  } catch { return fallback; }
}

/* =========================
   ENV + CONFIG
   ========================= */
const {
  PORT = 5001,

  // SMTP
  SMTP_HOST = 'smtp.gmail.com',
  SMTP_PORT = '465',
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  ADMIN_EMAIL,

  // WhatsApp
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  ADMIN_WA,

  // Admin auth
  ADMIN_USER,
  ADMIN_PASS,
  ADMIN_TOKEN,

  // CORS
  ALLOW_ORIGINS = '*',

  // MongoDB
  MONGO_URI,
  MONGO_DB, // optional (db name)

  // Cloudinary
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,

  // WhatsApp templates
  WA_TEMPLATE_NEW_ORDER,
  WA_TEMPLATE_ORDER_CONFIRM,
  WA_LANG = 'en_US'
} = process.env;

const app = express();

/* =========================
   Hardening + essentials
   ========================= */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp());
app.use('/api/products', productsRoutes);


/* =========================
   CORS (with preflight)
   ========================= */
const allowedOrigins = (ALLOW_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* =========================
   Rate limits
   ========================= */
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true });
const orderLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20, standardHeaders: true });
app.use('/api/', apiLimiter);
app.use('/api/orders', orderLimiter);
app.use('/api/notify-order', orderLimiter);

/* =========================
   Cloudinary
   ========================= */
if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
}

/* =========================
   Env sanity log (safe)
   ========================= */
function maskUri(uri){
  if (!uri) return '';
  return uri.replace(/:\/\/([^:]+):([^@]+)@/,'://$1:****@');
}
console.log('[ENV CHECK]',
  'SMTP_USER=', SMTP_USER,
  'SMTP_PASS_LEN=', SMTP_PASS ? SMTP_PASS.length : 0,
  'MAIL_FROM=', MAIL_FROM,
  'ADMIN_EMAIL=', ADMIN_EMAIL,
  'WA_PHONE_ID=', WHATSAPP_PHONE_ID,
  'ADMIN_WA=', ADMIN_WA,
  'TOKEN_SET=', !!WHATSAPP_TOKEN,
  'MONGO_URI=', maskUri(MONGO_URI),
  'MONGO_DB=', MONGO_DB || '(none)',
  'ALLOW_ORIGINS=', ALLOW_ORIGINS
);

/* =========================
   Mongo (Orders)
   ========================= */
if (!MONGO_URI) {
  console.warn('⚠️  MONGO_URI not set. Orders will fail to persist.');
} else {
  const pathDb = (() => {
    try {
      const m = MONGO_URI.match(/mongodb\+srv:\/\/[^/]+\/([^?\/]+)?/i);
      return m && m[1] ? m[1] : '';
    } catch { return ''; }
  })();

  console.log('[Mongo] Connecting…',
    'uri=', maskUri(MONGO_URI),
    'dbFromURI=', pathDb || '(none)',
    'MONGO_DB=', MONGO_DB || '(none)');

  mongoose.set('strictQuery', false);
  mongoose.connect(MONGO_URI, {
    dbName: MONGO_DB || pathDb || undefined,
    serverSelectionTimeoutMS: 20000,
  })
  .then(() => console.log('[Mongo] connected ✅'))
  .catch(err => console.error('[Mongo] connect error →', err?.message || err));
}

mongoose.connection.on('error', (e) => console.error('[Mongo] runtime error →', e?.message || e));
mongoose.connection.on('disconnected', () => console.warn('[Mongo] disconnected'));

/* Quick DB ping route */
app.get('/api/db-ping', async (_req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ ok:false, error:'DB not connected', state: mongoose.connection?.readyState ?? -1 });
    }
    await mongoose.connection.db.admin().command({ ping: 1 });
    res.json({ ok:true, state: mongoose.connection.readyState });
  } catch (e) {
    res.status(500).json({ ok:false, error: e?.message || String(e) });
  }
});

/* =========================
   Mongoose schema/model
   ========================= */
const OrderSchema = new mongoose.Schema({
  ref: String,
  createdAt: { type: Date, default: Date.now },
  info: {
    name: String, phone: String, email: String, payment: String, address: String,
    deliveryZone: String, deliveryFee: Number, subtotal: Number, grandTotal: Number,
    payment_details: Object
  },
  items: [{
    id: String,
    qty: Number,
    product: {
      title: String,
      price: Number,
      image: String
    }
  }],
  proofUrl: String,
  paymentStatus: { type: String, default: 'Pending' }, // Pending | Paid | Failed
  status: { type: String, default: 'New' } // New | Processing | Shipped | Completed | Cancelled
}, { versionKey: false });

const Order = mongoose.models.Order || mongoose.model('Order', OrderSchema);

/* =========================
   Email (Gmail App Password)
   ========================= */
const mailer = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});
mailer.verify((err) => {
  if (err) {
    console.error('SMTP VERIFY FAIL:', (err && err.message) || err);
    console.error('Hint: 2-Step ON + App Password, or run DisplayUnlockCaptcha');
  } else {
    console.log(`SMTP OK (${SMTP_PORT} ${Number(SMTP_PORT) === 465 ? 'SSL' : 'TLS'})`);
  }
});

/* =========================
   WhatsApp helpers
   ========================= */
const WAPI_VERSION = 'v23.0';
async function sendWhatsAppText({ to, text }) {
  if (!to || !WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;
  const phoneId = String(WHATSAPP_PHONE_ID).replace(/[^\d]/g, '');
  const url = `https://graph.facebook.com/${WAPI_VERSION}/${phoneId}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text || '').slice(0, 4096) } })
  });
  if (!r.ok) console.error('WhatsApp TEXT error:', r.status, await r.text().catch(()=> ''));
}
async function sendWhatsAppTemplate({ to, template, lang = WA_LANG, components = [] }) {
  if (!to || !WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !template) return false;
  const phoneId = String(WHATSAPP_PHONE_ID).replace(/[^\d]/g, '');
  const url = `https://graph.facebook.com/${WAPI_VERSION}/${phoneId}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: lang }, components } })
  });
  if (!r.ok) { console.error('WhatsApp TEMPLATE error:', r.status, await r.text().catch(()=> '')); return false; }
  return true;
}

/* =========================
   Constants
   ========================= */
const DELIVERY_ZONES = {
  'Pick-up (No delivery)': 0,
  'Freetown (Urban)': 25,
  'Greater Freetown': 40,
  'Provinces (Major towns)': 80,
  'Provinces (Remote)': 120
};
const feeFromZone = (z) => DELIVERY_ZONES[z] ?? 0;

/* =========================
   PDF builder
   ========================= */
async function buildInvoicePdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ref = order.ref || '';
    const name = get(order, 'info.name', 'Customer');
    const phone = get(order, 'info.phone', '');
    const email = get(order, 'info.email', '');
    const addr = get(order, 'info.address', '');
    const zone = get(order, 'info.deliveryZone', '');
    const subtotal = get(order, 'info.subtotal', 0);
    const deliveryFee = get(order, 'info.deliveryFee', 0);
    const grandTotal = get(order, 'info.grandTotal', subtotal + deliveryFee);

    doc.fontSize(20).text('LWG Partners Network', { align: 'left' });
    doc.moveDown(0.2).fontSize(10).fillColor('#555').text('Creating Impact Globally');
    doc.moveDown(1).fillColor('#000').fontSize(16).text('Invoice / Order Receipt', { align: 'right' });
    doc.fontSize(10).text('Ref: ' + ref, { align: 'right' });
    doc.text('Date: ' + new Date(order.createdAt || Date.now()).toLocaleString(), { align: 'right' });
    doc.moveDown();

    doc.fontSize(12).text('Bill To:');
    doc.fontSize(11).text(name);
    if (phone) doc.text(phone);
    if (email) doc.text(email);
    if (addr)  doc.text(addr);
    if (zone)  doc.text('Delivery: ' + zone);
    doc.moveDown();

    doc.fontSize(12).text('Items', { underline: true });
    doc.moveDown(0.5);
    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach((i) => {
      const title = get(i, 'product.title', 'Item');
      const price = get(i, 'product.price', 0);
      const qty   = i.qty || 0;
      doc.fontSize(11).text(`${title}  ×  ${qty}`, { continued: true }).text(`NLe ${price}`, { align: 'right' });
    });

    doc.moveDown().fontSize(11);
    doc.text('Subtotal', { continued: true }).text(`NLe ${subtotal}`, { align: 'right' });
    doc.text('Delivery', { continued: true }).text(`NLe ${deliveryFee}`, { align: 'right' });
    doc.fontSize(12).text('Total', { continued: true }).text(`NLe ${grandTotal}`, { align: 'right' });
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#555').text('Thank you for your purchase!');
    doc.end();
  });
}

/* =========================
   Zod validation
   ========================= */
const ItemSchema = z.object({
  id: z.string(),
  qty: z.number().int().positive(),
  product: z.object({
    title: z.string(),
    price: z.number().nonnegative(),
    image: z.string().optional()
  })
});
const OrderInfoSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email().optional().or(z.literal('')),
  payment: z.string().min(1),
  address: z.string().min(3),
  deliveryZone: z.string().optional(),
  deliveryFee: z.number().optional(),
  subtotal: z.number().optional(),
  grandTotal: z.number().optional(),
  payment_details: z.record(z.string()).optional()
}).passthrough();
const IncomingOrderSchema = z.object({
  id: z.string().optional(),
  items: z.array(ItemSchema).min(1),
  total: z.number().nonnegative().optional(),
  info: OrderInfoSchema
});
const ProofSchema = z.object({
  filename: z.string().optional(),
  mime: z.string().optional(),
  base64: z.string().optional()
}).optional();

/* =========================
   Health
   ========================= */
app.get('/', (_req, res) => res.json({ ok: true, name: 'LWG Notifier 2.0' }));

app.post('/api/test-email', async (_req, res) => {
  try {
    const to = ADMIN_EMAIL || SMTP_USER;
    const info = await mailer.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to,
      subject: 'LWG Notifier • SMTP test',
      text: 'If you got this, Gmail SMTP with App Password works ✅'
    });
    res.json({ ok: true, messageId: info.messageId });
  } catch (e) {
    console.error('Test email error:', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || 'Email failed' });
  }
});

/* WhatsApp test */
app.post('/api/test-wa', async (req, res) => {
  try {
    const to = (req.body && req.body.to) || ADMIN_WA;
    await sendWhatsAppText({ to, text: 'LWG Notifier • WhatsApp test ✅' });
    res.json({ ok: true, to });
  } catch (e) {
    console.error('Test WA error:', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || 'WA failed' });
  }
});
app.get('/api/test-wa', async (req, res) => {
  try {
    const to = req.query.to || ADMIN_WA;
    await sendWhatsAppText({ to, text: 'LWG Notifier • WhatsApp test ✅ (GET)' });
    res.json({ ok: true, to });
  } catch (e) {
    console.error('Test WA error:', e?.message || e);
    res.status(500).json({ ok: false, error: e?.message || 'WA failed' });
  }
});

/* =========================
   ✅ Mount Products API (ONCE)
   ========================= */
app.use('/api/products', productsRoutes);

/* =========================
   Admin auth + list/update/export
   ========================= */
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}
app.post('/api/admin/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) return res.json({ ok: true, token: ADMIN_TOKEN });
  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

// GET /api/admin/orders?status=&pstatus=&q=&from=&to=&page=&pageSize=
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.json({ ok: true, total: 0, orders: [] });
    }
    const { status, pstatus, q, from, to, page = 1, pageSize = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (pstatus) filter.paymentStatus = pstatus;
    if (q) {
      filter.$or = [
        { ref: new RegExp(q, 'i') },
        { 'info.name': new RegExp(q, 'i') },
        { 'info.phone': new RegExp(q, 'i') },
        { 'info.email': new RegExp(q, 'i') }
      ];
    }
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(to);
    }
    const skip = (Number(page) - 1) * Number(pageSize);
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(pageSize)),
      Order.countDocuments(filter)
    ]);
    res.json({ ok: true, total, orders });
  } catch (e) {
    console.error('Admin orders error:', e);
    res.status(500).json({ ok: false, error: 'Failed to fetch orders' });
  }
});

app.get('/api/admin/orders/export.csv', requireAdmin, async (req, res) => {
  try {
    const { status, pstatus, q, from, to } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (pstatus) filter.paymentStatus = pstatus;
    if (q) {
      filter.$or = [
        { ref: new RegExp(q, 'i') },
        { 'info.name': new RegExp(q, 'i') },
        { 'info.phone': new RegExp(q, 'i') },
        { 'info.email': new RegExp(q, 'i') }
      ];
    }
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to)   filter.createdAt.$lte = new Date(to);
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();

    const rows = [
      ['ref','createdAt','name','phone','email','status','paymentStatus','deliveryZone','subtotal','deliveryFee','grandTotal','items']
    ];
    orders.forEach(o => {
      const items = (o.items||[]).map(i => `${get(i,'product.title','Item')}×${i.qty}`).join('; ');
      rows.push([
        o.ref,
        new Date(o.createdAt).toISOString(),
        get(o,'info.name',''),
        get(o,'info.phone',''),
        get(o,'info.email',''),
        o.status,
        o.paymentStatus,
        get(o,'info.deliveryZone',''),
        get(o,'info.subtotal',0),
        get(o,'info.deliveryFee',0),
        get(o,'info.grandTotal',0),
        items
      ]);
    });

    const csv = rows.map(r => r.map(v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(',')).join('\n');

    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="orders.csv"');
    res.send(csv);
  } catch (e) {
    console.error('Export CSV error:', e);
    res.status(500).send('Failed to export CSV');
  }
});

// PATCH /api/admin/orders/:id
app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, paymentStatus, note } = req.body || {};
    const update = {};
    if (typeof status === 'string') update.status = status;
    if (typeof paymentStatus === 'string') update.paymentStatus = paymentStatus;

    const order = await Order.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

    const changed = [];
    if ('status' in update) changed.push('Status → ' + update.status);
    if ('paymentStatus' in update) changed.push('Payment → ' + update.paymentStatus);

    const customerEmail = get(order, 'info.email', '');
    const customerName  = get(order, 'info.name', 'Customer');
    const ref = order.ref || '';

    if (customerEmail && changed.length) {
      try {
        const pdf = await buildInvoicePdf(order);
        await mailer.sendMail({
          from: MAIL_FROM || SMTP_USER,
          to: customerEmail,
          subject: `Update for your order ${ref} – LWG`,
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
              <h3>Order ${esc(ref)} update</h3>
              <p>Hi ${esc(customerName)},</p>
              <p>We’ve updated your order:</p>
              <ul>${changed.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
              ${note ? `<p><b>Note from us:</b><br>${esc(note)}</p>` : ''}
              <p>Your updated receipt is attached.</p>
            </div>
          `,
          attachments: [{ filename: `Receipt_${ref}.pdf`, content: pdf }]
        });
      } catch (e) {
        console.error('Customer status email failed:', e?.message || e);
      }
    }

    res.json({ ok: true, order });
  } catch (e) {
    console.error('Admin update order error:', e?.message || e);
    res.status(500).json({ ok: false, error: 'Failed to update order' });
  }
});

/* =========================
   Proof upload (Cloudinary)
   ========================= */
async function uploadProofToCloudinary({ base64, mime, filename }) {
  if (!base64 || !mime) return null;
  if (!CLOUDINARY_CLOUD_NAME) return null;
  const dataUri = `data:${mime};base64,${base64}`;
  const res = await cloudinary.uploader.upload(dataUri, {
    folder: 'lwg-orders',
    resource_type: 'auto',
    public_id: filename ? filename.replace(/[^\w.-]+/g, '_') : undefined
  });
  return res.secure_url;
}

/* =========================
   Create Order
   ========================= */
async function handleCreateOrder(req, res) {
  try {
    const incoming = IncomingOrderSchema.parse((req.body && (req.body.order || req.body)) || {});
    const proof = ProofSchema.parse(req.body ? req.body.proof : undefined);

    const ref = incoming.id || ('LWG-' + Math.random().toString(36).slice(2,8).toUpperCase());
    const subtotal = Number.isFinite(Number(incoming.total)) ? Number(incoming.total)
      : (Array.isArray(incoming.items) ? incoming.items.reduce((s,i)=> s + (i.product.price * i.qty), 0) : 0);

    const zone = get(incoming, 'info.deliveryZone', '');
    const deliveryFee = Number.isFinite(Number(get(incoming,'info.deliveryFee', NaN)))
      ? Number(get(incoming,'info.deliveryFee', 0))
      : feeFromZone(zone);
    const grandTotal = Number.isFinite(Number(get(incoming,'info.grandTotal', NaN)))
      ? Number(get(incoming,'info.grandTotal', 0))
      : (subtotal + deliveryFee);

    let proofUrl = null;
    try {
      if (proof && proof.base64 && proof.mime) {
        proofUrl = await uploadProofToCloudinary({
          base64: proof.base64,
          mime: proof.mime,
          filename: proof.filename || ('proof_' + ref)
        });
      }
    } catch (e) { console.error('Cloud upload failed:', e?.message || e); }

    let saved = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      saved = await Order.create({
        ref,
        info: { ...incoming.info, deliveryFee, subtotal, grandTotal },
        items: incoming.items,
        proofUrl,
        paymentStatus: 'Pending',
        status: 'New'
      });
    }

    const name = get(incoming, 'info.name', 'Customer');
    const phone = get(incoming, 'info.phone', '');
    const email = get(incoming, 'info.email', '');
    const pay = get(incoming, 'info.payment', '');
    const addr = String(get(incoming, 'info.address', '')).replace(/\n/g, ' ').trim();
    const payDetails = get(incoming, 'info.payment_details', null);

    const itemsTxt = (incoming.items||[]).map(i => `• ${i.product.title} × ${i.qty} — NLe ${i.product.price}`).join('\n');
    const itemsHtml = (incoming.items||[]).map(i => `<li>${esc(i.product.title)} × ${esc(i.qty)} — NLe ${esc(i.product.price)}</li>`).join('');
    const chargesHTML = `
      ${zone ? `<p><b>Delivery area:</b> ${esc(zone)}</p>` : ''}
      <p><b>Charges:</b></p>
      <ul style="margin-top:6px">
        <li><b>Subtotal:</b> NLe ${esc(subtotal)}</li>
        <li><b>Delivery:</b> NLe ${esc(deliveryFee)}</li>
        <li><b>Total:</b> <b>NLe ${esc(grandTotal)}</b></li>
      </ul>`;
    const payHtml = payDetails ? `<p><b>Payment details:</b></p>${kvHTML(payDetails)}` : '';
    const payTxt  = payDetails ? `\nPayment details:\n${kvBlock(payDetails)}` : '';

    const orderForPdf = saved || {
      ref,
      createdAt: Date.now(),
      info: { ...incoming.info, deliveryFee, subtotal, grandTotal },
      items: incoming.items
    };
    let pdfBuf = null;
    try { pdfBuf = await buildInvoicePdf(orderForPdf); } catch {}

    // Email admin
    try {
      await mailer.sendMail({
        from: MAIL_FROM || SMTP_USER,
        to: ADMIN_EMAIL || SMTP_USER,
        subject: `New Order ${ref} – LWG`,
        html: `
          <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
            <h2>New Order ${esc(ref)}</h2>
            <p><b>Customer:</b> ${esc(name)}</p>
            ${email ? `<p><b>Email:</b> ${esc(email)}</p>` : ''}
            <p><b>Phone:</b> ${esc(phone)}</p>
            <p><b>Payment:</b> ${esc(pay)}</p>
            ${payHtml}
            <p><b>Address:</b> ${esc(addr)}</p>
            ${chargesHTML}
            <p><b>Items:</b></p>
            <ul>${itemsHtml}</ul>
            ${proofUrl ? `<p><b>Payment proof:</b> <a href="${esc(proofUrl)}">${esc(proofUrl)}</a></p>` : ''}
          </div>
        `,
        text:
`New Order ${ref}
Customer: ${name}
${email ? `Email: ${email}\n` : ''}Phone: ${phone}
Payment: ${pay}${payTxt}
${zone ? `Delivery area: ${zone}\n` : ''}Charges:
- Subtotal: NLe ${subtotal}
- Delivery: NLe ${deliveryFee}
- Total:    NLe ${grandTotal}

Items:
${itemsTxt}

${proofUrl ? `Payment proof: ${proofUrl}\n` : ''}`,
        attachments: pdfBuf ? [{ filename: `Receipt_${ref}.pdf`, content: pdfBuf }] : []
      });
    } catch (e) { console.error('Admin email failed:', e?.message || e); }

    // Email customer
    if (email) {
      try {
        await mailer.sendMail({
          from: MAIL_FROM || SMTP_USER,
          to: email,
          subject: `Order Confirmation ${ref} – LWG`,
          html: `
            <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
              <h3>Thank you for your order, ${esc(name)}!</h3>
              <p><b>Reference:</b> ${esc(ref)}</p>
              <p><b>Payment:</b> ${esc(pay)}</p>
              ${payHtml}
              ${chargesHTML}
              <ul>${itemsHtml}</ul>
              <p>Your receipt is attached. We will contact you soon.</p>
            </div>
          `,
          attachments: pdfBuf ? [{ filename: `Receipt_${ref}.pdf`, content: pdfBuf }] : []
        });
      } catch (e) { console.error('Customer email failed:', e?.message || e); }
    }

    // WhatsApp admin
    try {
      let ok = false;
      if (WA_TEMPLATE_NEW_ORDER) {
        ok = await sendWhatsAppTemplate({
          to: ADMIN_WA,
          template: WA_TEMPLATE_NEW_ORDER,
          components: [{ type: 'body', parameters: [
            { type: 'text', text: ref },
            { type: 'text', text: name },
            { type: 'text', text: 'NLe ' + grandTotal }
          ]}]
        });
      }
      if (!ok) {
        await sendWhatsAppText({ to: ADMIN_WA, text:
`🛒 New Order ${ref}
Name: ${name}
Phone: ${phone}
Payment: ${pay}${payTxt}
${zone ? `Delivery area: ${zone}\n` : ''}Charges:
- Subtotal: NLe ${subtotal}
- Delivery: NLe ${deliveryFee}
- Total:    NLe ${grandTotal}

Items:
${itemsTxt}

${proofUrl ? '📎 Proof attached (see admin email).' : ''}` });
      }
    } catch (e) { console.error('Admin WA failed:', e?.message || e); }

    // WhatsApp customer
    if (phone && /^\+\d{8,15}$/.test(phone)) {
      try {
        let ok = false;
        if (WA_TEMPLATE_ORDER_CONFIRM) {
          ok = await sendWhatsAppTemplate({
            to: phone,
            template: WA_TEMPLATE_ORDER_CONFIRM,
            components: [{ type: 'body', parameters: [
              { type: 'text', text: name },
              { type: 'text', text: ref },
              { type: 'text', text: 'NLe ' + grandTotal }
            ]}]
          });
        }
        if (!ok) {
          await sendWhatsAppText({ to: phone, text:
`✅ LWG Order Received (${ref})
Thanks, ${name}!
Payment: ${pay}
${zone ? `Delivery area: ${zone}\n` : ''}Total: NLe ${grandTotal}
We will contact you soon.` });
        }
      } catch (e) { console.error('Customer WA failed:', e?.message || e); }
    }

    return res.json({ ok: true, ref, id: saved?._id || null, proofUrl: proofUrl || null });
  } catch (e) {
    console.error('Create order error:', e?.message || e);
    return res.status(400).json({ ok: false, error: e?.message || 'Invalid order' });
  }
}
app.post('/api/orders', handleCreateOrder);
app.post('/api/notify-order', handleCreateOrder);

/* =========================
   Customer endpoints
   ========================= */
app.get('/api/orders/track', noStore, async (req, res) => {
  try {
    const { ref, phone, email } = req.query;
    if (!ref || (!phone && !email)) return res.status(400).json({ ok:false, error:'Provide ref and phone or email' });
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ ok:false, error:'Orders database unavailable' });
    }
    const filter = { ref };
    if (phone) filter['info.phone'] = phone;
    if (email) filter['info.email'] = email;
    const order = await Order.findOne(filter).lean();
    if (!order) return res.status(404).json({ ok:false, error:'Order not found' });

    const o = {
      ref: order.ref,
      createdAt: order.createdAt,
      status: order.status,
      paymentStatus: order.paymentStatus,
      info: {
        name: get(order, 'info.name', ''),
        phone: get(order, 'info.phone', ''),
        email: get(order, 'info.email', ''),
        deliveryZone: get(order, 'info.deliveryZone', ''),
        deliveryFee: get(order, 'info.deliveryFee', 0),
        subtotal: get(order, 'info.subtotal', 0),
        grandTotal: get(order, 'info.grandTotal', 0),
        address: get(order, 'info.address', '')
      },
      items: (order.items||[]).map(x => ({
        qty: x.qty,
        product: {
          title: get(x, 'product.title', ''),
          price: get(x, 'product.price', 0),
          image: get(x, 'product.image', '')
        }
      }))
    };
    res.json({ ok:true, order: o });
  } catch (e) {
    console.error('Track error:', e?.message || e);
    res.status(500).json({ ok:false, error:'Failed to track order' });
  }
});

app.get('/api/orders/by-contact', async (req, res) => {
  try {
    const { phone, email, page = 1, pageSize = 20 } = req.query;
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ ok:false, error:'Orders database unavailable' });
    }
    if (!phone && !email) return res.status(400).json({ ok:false, error:'Provide phone or email' });
    const filter = {};
    if (phone) filter['info.phone'] = phone;
    if (email) filter['info.email'] = email;
    const skip = (Number(page) - 1) * Number(pageSize);
    const [ordersRaw, total] = await Promise.all([
      Order.find(filter).sort({ createdAt:-1 }).skip(skip).limit(Number(pageSize)).lean(),
      Order.countDocuments(filter)
    ]);

    const orders = (ordersRaw||[]).map(order => ({
      ref: order.ref,
      createdAt: order.createdAt,
      status: order.status,
      paymentStatus: order.paymentStatus,
      info: {
        name: get(order, 'info.name', ''),
        phone: get(order, 'info.phone', ''),
        email: get(order, 'info.email', ''),
        deliveryZone: get(order, 'info.deliveryZone', ''),
        deliveryFee: get(order, 'info.deliveryFee', 0),
        subtotal: get(order, 'info.subtotal', 0),
        grandTotal: get(order, 'info.grandTotal', 0),
        address: get(order, 'info.address', '')
      },
      items: (order.items||[]).map(x => ({
        qty: x.qty,
        product: {
          title: get(x, 'product.title', ''),
          price: get(x, 'product.price', 0),
          image: get(x, 'product.image', '')
        }
      }))
    }));

    res.json({ ok:true, total, orders });
  } catch (e) {
    console.error('By-contact error:', e?.message || e);
    res.status(500).json({ ok:false, error:'Failed to fetch orders' });
  }
});

// PUBLIC RECEIPT PDF
app.get('/api/orders/receipt.pdf', noStore, async (req, res) => {
  try {
    const { ref, phone, email } = req.query;
    if (!ref || (!phone && !email)) return res.status(400).send('Missing ref/identity');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).send('DB unavailable');
    }
    const filter = { ref };
    if (phone) filter['info.phone'] = phone;
    if (email) filter['info.email'] = email;
    const order = await Order.findOne(filter).lean();
    if (!order) return res.status(404).send('Not found');

    const pdf = await buildInvoicePdf(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Receipt_${ref}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error('Receipt PDF error:', e?.message || e);
    res.status(500).send('Failed to generate receipt');
  }
});

/* =========================
   Start
   ========================= */
const port = process.env.PORT || PORT || 5001;
app.listen(port, () => {
  console.log('✔ API running on port ' + port);
});
