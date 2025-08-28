// store.js — localStorage store with smart API integration + graceful fallback

// =======================
// Local keys & constants
// =======================
const KEY_PRODUCTS = 'lwg_products_v1';
const KEY_CART     = 'lwg_cart_v1';
const KEY_ORDERS   = 'lwg_orders_v1';

// Production API base
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
  const url = new URL(path.startsWith('http') ? path : (API.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')));
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const { signal: sig, cancel } = withTimeout(timeout, signal);
  let resp, text = '', json = null;

  try {
    resp = await fetch(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body && typeof body === 'object' && !(body instanceof FormData) ? JSON.stringify(body) : body,
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

// Cache health check so we don’t ping on every call
let _apiHealth = { checkedAt: 0, ok: false, status: 0 };
async function apiReady({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (now - _apiHealth.checkedAt < maxAgeMs) return _apiHealth.ok;

  try {
    // HEAD preferred; 404 is acceptable (service reachable)
    const t0 = performance.now?.() ?? now;
    const r = await apiFetch('/api/health', { method: 'HEAD', timeout: 7000 });
    const ok = r.ok || r.status === 404;
    _apiHealth = { checkedAt: now, ok, status: r.status || 0, latencyMs: Math.round((performance.now?.() ?? now) - t0) };
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

// Seed some demo products if empty (local fallback)
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
  // Initialize storage and optionally warm API status
  async init() {
    seedIfNeeded();
    // fire-and-forget API readiness check; no throw on failure
    try { await apiReady({ maxAgeMs: 0 }); } catch {}
  },

  // -------- PRODUCTS --------
  async products() {
    if (await apiReady()) {
      try {
        // Expected response: { ok: true, products: [...] } or plain array
        const res = await getJSON('/api/products', { timeout: 10000 });
        const list = Array.isArray(res) ? res : (res.products || []);
        if (list.length) return list;
      } catch {
        // fall through to local
      }
    }
    return lsGet(KEY_PRODUCTS, '[]');
  },

  async getProduct(id) {
    if (!id) return null;
    if (await apiReady()) {
      try {
        const res = await getJSON(`/api/products/${encodeURIComponent(id)}`, { timeout: 10000 });
        return res.product || res; // support either shape
      } catch {
        // ignore and fall back to local
      }
    }
    return this.products().then(list => list.find(p => p.id === id) || null);
  },

  // Local admin helpers (keep as-is; API write endpoints may be private)
  saveProducts(list) { lsSet(KEY_PRODUCTS, list); },
  async upsertProduct(p) {
    const list = lsGet(KEY_PRODUCTS, '[]');
    const i = list.findIndex(x => x.id === p.id);
    if (i > -1) list[i] = p; else list.push({...p, id: p.id || crypto.randomUUID()});
    lsSet(KEY_PRODUCTS, list);
    return p.id || list[list.length - 1].id;
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
    it.qty = qty;
    if (it.qty <= 0) c.splice(c.indexOf(it), 1);
    this.saveCart(c);
  },
  clearCart() { this.saveCart([]); },

  // -------- ORDERS --------
  orders() { return lsGet(KEY_ORDERS, '[]'); },
  saveOrders(list) { lsSet(KEY_ORDERS, list); },
  setOrderStatus(id, status) {
    const list = this.orders();
    const i = list.findIndex(o => o.id === id);
    if (i > -1) { list[i].status = status; this.saveOrders(list); }
  },

  /**
   * Place an order.
   * If API is reachable, POSTs to /api/orders with { items:[{productId, qty}], info }.
   * Falls back to local order if API fails/unavailable.
   * Returns the order object (API response or local mock).
   */
  async placeOrder(info) {
    // Build items from cart
    const itemsLocal = this.cart().map(i => ({ id: i.id, qty: i.qty }));
    const itemsForApi = itemsLocal.map(x => ({ productId: x.id, qty: x.qty }));

    // Try API first
    if (await apiReady()) {
      try {
        const res = await getJSON('/api/orders', {
          method: 'POST',
          timeout: 15000,
          body: { items: itemsForApi, info }
        });
        // Success shapes expected: { ok:true, order:{...} } or { id, ...}
        const order = res.order || res;
        // Clear local cart on success
        this.clearCart();
        return order;
      } catch (e) {
        // fall back to local mock if API rejects
        console.warn('Order via API failed, using local fallback:', e?.message || e);
      }
    }

    // Local fallback order
    const fullItems = itemsLocal.map(i => ({
      ...i,
      product: (lsGet(KEY_PRODUCTS, '[]').find(p => p.id === i.id) || { title: 'Item', price: 0 })
    }));
    const total = fullItems.reduce((s, it) => s + (Number(it.product.price || 0) * Number(it.qty || 0)), 0);
    const order = {
      id: 'LWG-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      at: new Date().toISOString(),
      items: fullItems,
      total,
      info,
      status: 'New'
    };
    const list = this.orders(); list.push(order); this.saveOrders(list);
    this.clearCart();
    return order;
  },

  /**
   * Try to fetch an order from the API by ref + identity (email or phone E.164),
   * else look it up in local orders by id.
   */
  async trackOrder({ ref, email, phone }) {
    if (await apiReady()) {
      try {
        const query = { ref };
        if (email) query.email = email;
        if (phone) query.phone = phone;
        const res = await getJSON('/api/orders/track', { query, timeout: 12000 });
        // Expected shape { ok:true, order:{...} }
        if (res && (res.ok === true) && res.order) return res.order;
      } catch {
        // fall through to local
      }
    }
    // local fallback by id
    const o = this.orders().find(o => o.id === ref);
    if (!o) throw new Error('Order not found');
    return o;
  }
};

export default Store;
