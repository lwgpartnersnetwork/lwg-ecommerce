// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import morgan from 'morgan';

import { connectDB } from './db.js';
import ordersRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';

const app = express();

/* -------------------------- Trust & basic security ------------------------- */
app.set('trust proxy', 1); // needed for rate limit & real IPs behind proxies (Render/NGINX/etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());

/* --------------------------------- Logging -------------------------------- */
app.use(pinoHttp({
  serializers: {
    req (req) {
      return {
        method: req.method,
        url: req.url,
        remoteAddress: req.ip,
        userAgent: req.headers['user-agent']
      };
    },
    res (res) {
      return {
        statusCode: res.statusCode
      };
    }
  },
  autoLogging: {
    ignore: req => req.url === '/api/health' || req.url === '/'
  }
}));

// keep morgan in dev for pretty console logs, pino remains primary
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

/* ---------------------------------- CORS ---------------------------------- */
// CORS_ORIGIN can be a comma-separated list, e.g. "https://foo.com,https://bar.app"
const rawOrigins = process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) || [];
const allowAll = rawOrigins.length === 0 || rawOrigins.includes('*');

const corsOptions = {
  credentials: true,
  origin: allowAll
    ? true
    : (origin, cb) => {
        // allow same-origin/non-browser (like curl/postman) and exact matches
        if (!origin) return cb(null, true);
        if (rawOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS: Origin ${origin} not allowed`));
      }
};

app.use(cors(corsOptions));

/* ----------------------------- Body & parsing ------------------------------ */
app.use(express.json({ limit: '5mb' }));

// guard: JSON syntax errors => 400 instead of 500
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  next(err);
});

/* ------------------------------ Rate limiting ------------------------------ */
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  limit: 120,          // 120 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again later.' }
});
app.use(limiter);

/* --------------------------------- Routes --------------------------------- */

// tiny root
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'LWG Orders API' });
});

// health probe used by frontend & uptime monitors
// HEAD returns quickly; GET can include minimal diagnostics
app.head('/api/health', (_req, res) => res.status(204).end());
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'orders',
    env: process.env.NODE_ENV || 'development',
    time: new Date().toISOString()
  });
});

// Mount feature routes
app.use('/api/orders', ordersRoutes);
app.use('/api/admin', adminRoutes);

/* --------------------------- Not found & errors ---------------------------- */
// 404 handler (after all routes)
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found', path: req.originalUrl });
});

// error handler
app.use((err, req, res, _next) => {
  req.log?.error?.(err); // pino
  const status = err.statusCode || err.status || 500;
  const message = err.expose
    ? err.message
    : (status >= 500 ? 'Server error' : err.message || 'Request error');
  res.status(status).json({ ok: false, error: message });
});

/* --------------------------------- Boot ----------------------------------- */
const PORT = process.env.PORT || 5002;

(async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    app.listen(PORT, () => {
      console.log(`✔ Orders API listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('✖ Failed to start server:', err?.message || err);
    process.exit(1);
  }
})();

export default app;
