// store.js — localStorage store with smart API integration + graceful fallback

// =======================
// Local keys & constants
// =======================
const KEY_PRODUCTS = 'lwg_products_v1';
const KEY_CART     = 'lwg_cart_v1';
const KEY_ORDERS   = 'lwg_orders_v1';

// Production API base (Render backend)
const API = 'https://lwg-api.onrender.com';

// =======================
// Small fetch helpers
// =======================
function withTimeout(ms, signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), ms);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

async function apiFetch(path, {
  method = 'GET',
  query,
  headers,
  body,
  timeout = 15000,
  signal
} = {}) {
  const base = API.replace(/\/+$/, '');
  const url = new URL(path.startsWith('http') ? path : (base + '/' + path.replace(/^\/+/, '')));
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const { signal: sig, cancel } = withTimeout(timeout, signal);

  const hdrs = { ...(headers || {}) };
  const isJsonBody = body && typeof body === 'object' && !(body instanceof FormData);
  if (isJsonBody && !hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json';

  let resp, text = '', json = null;
  try {
    resp = await fetch(url.toString(), {
      method,
      headers: hdrs,
      body: isJsonBody ? JSON.stringify(body) : body,
      cache: 'no-store',
      signal: sig
    });
    try { text = await resp.text(); } catch {}
    try { json = text ? JSON.parse(text) : null; } catch {}
  } finally {
    cancel();
  }

  return { resp, json, text, ok: !!(resp && resp.ok), status: resp ? resp.status : 0 };
}

async function getJSON(path, options = {}) {
  const r = await apiFetch(path, options);
  if (!r.ok) {
    const serverMsg = (r.json && (r.json.error || r.json.message)) || (r.text && r.text.slice(0, 160)) || ('HTTP ' + r.status);
    const err = new Error(serverMsg);
    err.status = r.status;
    err.response = r.resp;
    err.body = r.text;
    throw err;
  }
  if (r.json && r.json.ok === false) {
    const err = new Error(r.json.error || r.json.message || 'Request failed');
    err.status = r.status || 400;
    err.response = r.resp;
    err.body = r.text;
    throw err;
  }
  return r.json;
}

// Cache API health so we don’t ping on every call
let _apiHealth = { checkedAt: 0, ok: false, status: 0 };
async function apiReady({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (now - _apiHealth.checkedAt < maxAgeMs) return _apiHealth.ok;
  try {
    const r = await apiFetch('/api/health', { method: 'HEAD', timeout: 7000 });
    const ok = r.ok || r.status === 404; // treat 404 as "reachable"
    _apiHealth = { checkedAt: now, ok, status: r.status || 0 };
    return ok;
  } catch {
    _apiHealth = { checkedAt: now, ok: false, status: 0 };
    return false;
  }
}

// =======================
// Utility format helpers
// =======================
const money = (n) => 'NLe ' + Number(n || 0).toLocaleString();

// =======================
// Local-only primitives
// =======================
function lsGet(key, fb = '[]') {
  try { return JSON.parse(localStorage.getItem(key) || fb); }
  catch { return JSON.parse(fb); }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// Seed demo products if empty (for offline / first-run)
function seedIfNeeded() {
  if (!localStorage.getItem(KEY_PRODUCTS)) {
    const demo = [
      {id:crypto.randomUUID(), title:'LWG Classic Tee', price:180, stock:25, image:'https://picsum.photos/seed/lwg1/600/400', desc:'Soft cotton tee with LWG branding.'},
      {id:crypto.randomUUID(), title:'Express Cap',     price:120, stock:30, image:'https://picsum.photos/seed/lwg2/600/400', desc:'Lightweight cap for sunny days.'},
      {id:crypto.randomUUID(), title:'Premium Hoodie',  price:420, stock:15, image:'https://picsum.photos/seed/lwg3/600/400', desc:'Cozy hoodie in brand colors.'}
    ];
    lsSet(KEY_PRODUCTS, demo);
  }
  if (!localStorage.getItem(KEY_CART))   lsSet(KEY_CART,   []);
  if (!localStorage.getItem(KEY_ORDERS)) lsSet(KEY_ORDERS, []);
}

// =======================
// Public Store API
// =======================
const Store = {
  // Initialize storage and warm API status
  async init() {
    seedIfNeeded();
    try { await apiReady({ maxAgeMs: 0 }); } catch {}
  },

  // -------- PRODUCTS --------
  /**
   * Fetch products. If API works, fill local cache (for offline/cart).
   * Returns an array of products.
   */
  async products({ q = '', page = 1, pageSize = 100 } = {}) {
    if (await apiReady()) {
      try {
        const data = await getJSON('/api/products', { query: { q, page, pageSize }, timeout: 12000 });
        const list = data.products || [];
        if (Array.isArray(list)) {
          // Keep a minimal local cache to support cart & offline
          // Normalize ids to use _id || id || slug
          const cached = list.map(p => ({
            id: p._id || p.id || p.slug || crypto.randomUUID(),
            title: p.title || 'Product',
            price: Number(p.price || 0),
            stock: Number.isFinite(+p.stock) ? +p.stock : 0,
            image: p.image || (Array.isArray(p.images) ? p.images[0] : '') || '',
            desc:  p.desc || ''
          }));
          lsSet(KEY_PRODUCTS, cached);
          return list;
        }
      } catch {
        // fall through to local
      }
    }
    return lsGet(KEY_PRODUCTS, '[]');
  },

  /**
   * Get a single product (id or slug). Falls back to local cache.
   */
  async getProduct(idOrSlug) {
    if (!idOrSlug) return null;
    if (await apiReady()) {
      try {
        const data = await getJSON(`/api/products/${encodeURIComponent(idOrSlug)}`, { timeout: 12000 });
        return data.product || null;
      } catch {
        // ignore and fall back
      }
    }
    const list = lsGet(KEY_PRODUCTS, '[]');
    return list.find(p => p.id === idOrSlug) || null;
  },

  // Local admin helpers (for client-side admin UI only)
  saveProducts(list) { lsSet(KEY_PRODUCTS, list); },
  async upsertProduct(p) {
    const list = lsGet(KEY_PRODUCTS, '[]');
    const id = p.id || crypto.randomUUID();
    const idx = list.findIndex(x => x.id === id);
    const toSave = {
      id,
      title: String(p.title || 'Product'),
      price: Number(p.price || 0),
      stock: Number.isFinite(+p.stock) ? +p.stock : 0,
      image: String(p.image || ''),
      desc:  String(p.desc || '')
    };
    if (idx >= 0) list[idx] = toSave; else list.push(toSave);
    lsSet(KEY_PRODUCTS, list);
    return id;
  },
  async deleteProduct(id) {
    lsSet(KEY_PRODUCTS, lsGet(KEY_PRODUCTS, '[]').filter(p => p.id !== id));
  },

  // -------- CART (local-first) --------
  cart() { return lsGet(KEY_CART, '[]'); },
  saveCart(c) { lsSet(KEY_CART, c); },
  addToCart(productId, qty = 1) {
    const c = this.cart();
    const it = c.find(i => i.id === productId);
    if (it) it.qty += qty; else c.push({ id: productId, qty });
    this.saveCart(c);
  },
  updateQty(productId, qty) {
    const c = this.cart();
    const it = c.find(i => i.id === productId);
    if (!it) return;
    it.qty = Math.max(0, Math.floor(Number(qty || 0)));
    if (it.qty <= 0) c.splice(c.indexOf(it), 1);
    this.saveCart(c);
  },
  clearCart() { this.saveCart([]); },

  // -------- ORDERS (local fallback) --------
  orders() { return lsGet(KEY_ORDERS, '[]'); },
  saveOrders(list) { lsSet(KEY_ORDERS, list); },
  setOrderStatus(id, status) {
    const list = this.orders();
    const i = list.findIndex(o => o.id === id);
    if (i > -1) { list[i].status = status; this.saveOrders(list); }
  },

  /**
   * Place an order (API-first). The backend expects:
   * {
   *   order: {
   *     items: [{ id, qty, product: { title, price, image } }],
   *     total: <number>,
   *     info: { name, phone, email?, payment, address, deliveryZone?, deliveryFee?, subtotal?, grandTotal?, payment_details? }
   *   },
   *   proof?: { filename, mime, base64 }
   * }
   *
   * @param {Object} info - checkout info (see above)
   * @param {Object} [opts] - optional { proof }
   * @returns {Promise<Object>} order response or local fallback order
   */
  async placeOrder(info, opts = {}) {
    // Build items from cart with product details (required by backend)
    const localProducts = lsGet(KEY_PRODUCTS, '[]');
    const cartItems = this.cart();
    const itemsDetailed = cartItems.map(i => {
      const p = localProducts.find(x => x.id === i.id) || {};
      return {
        id: i.id,
        qty: Number(i.qty || 0),
        product: {
          title: p.title || 'Item',
          price: Number(p.price || 0),
          image: p.image || ''
        }
      };
    }).filter(x => x.qty > 0);

    const subtotal = itemsDetailed.reduce((s, it) => s + (Number(it.product.price) * it.qty), 0);

    // Attempt API
    if (await apiReady()) {
      try {
        const payload = {
          order: {
            items: itemsDetailed,
            total: subtotal,
            info: { ...info }
          }
        };
        if (opts.proof) payload.proof = opts.proof;

        const res = await getJSON('/api/orders', {
          method: 'POST',
          timeout: 20000,
          body: payload
        });

        // Expected { ok:true, ref, id?, proofUrl? }
        if (res && res.ok) {
          this.clearCart();
          return res; // pass through (contains ref/id)
        }
      } catch (e) {
        console.warn('Order via API failed, using local fallback:', e?.message || e);
      }
    }

    // Local fallback order (offline mode)
    const order = {
      id: 'LWG-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      at: new Date().toISOString(),
      items: itemsDetailed,
      total: subtotal,
      info,
      status: 'New',
      paymentStatus: 'Pending'
    };
    const list = this.orders(); list.push(order); this.saveOrders(list);
    this.clearCart();
    return order;
  },

  /**
   * Track an order via API; fallback to local (by id) if not reachable.
   * @param {Object} args - { ref, email?, phone? }
   */
  async trackOrder({ ref, email, phone }) {
    if (await apiReady()) {
      try {
        const query = { ref };
        if (email) query.email = email;
        if (phone) query.phone = phone;
        const res = await getJSON('/api/orders/track', { query, timeout: 12000 });
        if (res && res.ok && res.order) return res.order;
      } catch {
        // fall through
      }
    }
    const o = this.orders().find(o => o.id === ref || o.ref === ref);
    if (!o) throw new Error('Order not found');
    return o;
  }
};

export default Store;
