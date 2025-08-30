/* =======================
   Frontend helper
   ======================= */
const PROD_API = 'https://lwg-api.onrender.com';
const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : PROD_API;

/**
 * Fetch a paginated list of products
 * @param {Object} params
 * @param {string} params.q        search query
 * @param {string} params.category product category
 * @param {number} params.min      min price
 * @param {number} params.max      max price
 * @param {number} params.page     page number
 * @param {number} params.pageSize number per page
 */
export async function fetchProducts({ q='', category='', min, max, page=1, pageSize=12 } = {}) {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (category) qs.set('category', category);
  if (min) qs.set('min', min);
  if (max) qs.set('max', max);
  qs.set('page', page);
  qs.set('pageSize', pageSize);

  const url = `${API_BASE}/api/products?${qs.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch products');

  return data; // { ok:true, total, products:[...] }
}


/* =======================
   Backend Express router
   ======================= */
import express from 'express';
import Product from '../models/Product.js';

const router = express.Router();

/**
 * GET /api/products
 * Query: q, category, min, max, page, pageSize
 */
router.get('/', async (req, res) => {
  try {
    const {
      q = '',
      category = '',
      min,
      max,
      page = 1,
      pageSize = 50,
    } = req.query;

    const filter = {};
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { desc: { $regex: q, $options: 'i' } },
        { tags: { $regex: q, $options: 'i' } },
      ];
    }
    if (category) filter.category = category;
    if (min || max) {
      filter.price = {};
      if (min) filter.price.$gte = Number(min);
      if (max) filter.price.$lte = Number(max);
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort('-createdAt')
        .skip(skip)
        .limit(Number(pageSize))
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.json({ ok: true, total, products });
  } catch (e) {
    console.error('GET /api/products error:', e);
    res.status(500).json({ ok: false, error: 'Failed to fetch products' });
  }
});

/**
 * GET /api/products/:idOrSlug
 */
router.get('/:idOrSlug', async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);
    const product = await (isObjectId
      ? Product.findById(idOrSlug).lean()
      : Product.findOne({ slug: idOrSlug }).lean());

    if (!product) {
      return res.status(404).json({ ok: false, error: 'Product not found' });
    }
    res.json({ ok: true, product });
  } catch (e) {
    console.error('GET /api/products/:idOrSlug error:', e);
    res.status(500).json({ ok: false, error: 'Failed to fetch product' });
  }
});

export default router;
