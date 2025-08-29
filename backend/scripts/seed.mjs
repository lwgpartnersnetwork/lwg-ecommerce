import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../models/Product.js';

const { MONGO_URI, MONGO_DB } = process.env;
if (!MONGO_URI) { console.error('Missing MONGO_URI in env'); process.exit(1); }

const pathDb = (() => { try { const m = MONGO_URI.match(/mongodb\+srv:\/\/[^/]+\/([^?\/]+)?/i); return m && m[1] ? m[1] : ''; } catch { return ''; }})();
await mongoose.connect(MONGO_URI, { dbName: MONGO_DB || pathDb || undefined });

const demo = [
  { title: 'LWG T‑Shirt', price: 150, image: 'https://via.placeholder.com/600x400?text=T-Shirt', desc: 'Premium cotton tee', category: 'Apparel', tags: ['shirt','cotton'] },
  { title: 'LWG Mug', price: 80, image: 'https://via.placeholder.com/600x400?text=Mug', desc: '11oz ceramic mug', category: 'Merch', tags: ['mug','ceramic'] },
  { title: 'LWG Hoodie', price: 320, image: 'https://via.placeholder.com/600x400?text=Hoodie', desc: 'Cozy fleece hoodie', category: 'Apparel', tags: ['hoodie','fleece'] },
];

await Product.deleteMany({});
await Product.insertMany(demo);
console.log('Seeded products:', demo.length);
await mongoose.disconnect();
process.exit(0);
