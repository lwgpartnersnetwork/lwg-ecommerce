import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';

import productsRoutes from './routes/products.js';

function noStore(_req, res, next){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  next();
}

const {
  PORT = 5001,
  ALLOW_ORIGINS = 'https://www.lwgpartnersnetwork.com,https://lwgpartnersnetwork.com',
  MONGO_URI,
  MONGO_DB,
} = process.env;

const app = express();

// Fix Render proxy + express-rate-limit
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp());

const allowedOrigins = (ALLOW_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
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

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true });
app.use('/api/', apiLimiter);

function maskUri(uri){ return uri ? uri.replace(/:\/\/([^:]+):([^@]+)@/,'://$1:****@') : ''; }
console.log('[ENV] ALLOW_ORIGINS=', ALLOW_ORIGINS, 'MONGO_URI=', maskUri(MONGO_URI));

if (!MONGO_URI) {
  console.warn('⚠️  MONGO_URI not set. Products will not persist.');
} else {
  const pathDb = (() => { try { const m = MONGO_URI.match(/mongodb\+srv:\/\/[^/]+\/([^?\/]+)?/i); return m && m[1] ? m[1] : ''; } catch { return ''; }})();
  mongoose.set('strictQuery', false);
  mongoose.connect(MONGO_URI, { dbName: MONGO_DB || pathDb || undefined, serverSelectionTimeoutMS: 20000 })
    .then(() => console.log('[Mongo] connected ✅'))
    .catch(err => console.error('[Mongo] connect error →', err?.message || err));
}

app.get('/', (_req, res) => res.json({ ok: true, name: 'LWG API', time: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/products', productsRoutes);

const port = Number(process.env.PORT || PORT || 5001);
app.listen(port, () => console.log('✔ API running on port ' + port));
