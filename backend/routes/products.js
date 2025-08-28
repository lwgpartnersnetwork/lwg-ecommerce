// routes/products.js
import express from 'express';
import Product from '../models/Product.js';

const router = express.Router();

/**
 * GET /api/products
 * Query params:
 *   q=search , category= , min= , max= , page= , pageSize=
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
        { title: new RegExp(q, 'i') },
        { desc: new RegExp(q, 'i') },
        { tags: new RegExp(q, 'i') },
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
      Product.find(filter).sort('-createdAt').skip(skip).limit(Number(pageSize)).lean(),
      Product.countDocuments(filter),
    ]);

    res.json({ ok: true, total, products });
  } catch (e) {
    console.error('GET /products error:', e);
    res.status(500).json({ ok: false, error: 'Failed to fetch products' });
  }
});

/**
 * GET /api/products/:idOrSlug
 */
router.get('/:idOrSlug', async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    const isObjectId = idOrSlug.match(/^[0-9a-fA-F]{24}$/);
    const product = await (isObjectId
      ? Product.findById(idOrSlug).lean()
      : Product.findOne({ slug: idOrSlug }).lean());

    if (!product) return res.status(404).json({ ok: false, error: 'Product not found' });
    res.json({ ok: true, product });
  } catch (e) {
    console.error('GET /products/:id error:', e);
    res.status(500).json({ ok: false, error: 'Failed to fetch product' });
  }
});

export default router;
