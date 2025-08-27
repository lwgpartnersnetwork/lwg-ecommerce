// utils.js — small DOM + API helper toolkit for LWG

// -------- DOM helpers --------
export const $  = (q, el = document) => el.querySelector(q);
export const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

// -------- Money / formatting helpers --------
export const money = (n) => 'NLe ' + Number(n || 0).toLocaleString();
export const iso    = (d) => { try { return new Date(d).toLocaleString(); } catch { return d ?? ''; } };
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
export const normalizePhone = (v) => {
  if (!v) return '';
  const digits = String(v).replace(/[^\d+]/g, '').replace(/^\+?/, '');
  return digits ? ('+' + digits) : '';
};

// -------- Toast (with a11y + types) --------
let toastTimer;
export function toast(msg, type = 'info') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    // minimal styles if page hasn’t defined them
    el.style.cssText = `
      position: fixed; inset: auto 16px 16px auto; max-width: 92vw;
      background:#111827;color:#e5e7eb;border:1px solid #374151;
      border-radius:10px;padding:10px 12px;font:14px system-ui,sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,.4); transform:translateY(12px);
      opacity:0; transition:opacity .15s ease, transform .15s ease; z-index:9999;
    `;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    // attach simple “show” class behavior
    const style = document.createElement('style');
    style.textContent = `.toast.show{opacity:1;transform:translateY(0)}.toast.success{border-color:#15803d}.toast.error{border-color:#b91c1c}`;
    document.head.appendChild(style);
  }
  el.textContent = String(msg);
  el.classList.remove('success', 'error');
  if (type === 'success') el.classList.add('success');
  if (type === 'error')   el.classList.add('error');

  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// (optional) render a header with cart count—kept lightweight
export async function renderHeader() {
  // If you add a nav, update cartCount here (example below).
  // const count = await safeCartCount();
  // const badge = $('.cart-badge'); if (badge) badge.textContent = String(count);
}

// -------- API helpers --------

// Base URL for prod API
export const API = 'https://lwg-api.onrender.com';

// Internal: timeout wrapper for fetch
function withTimeout(ms, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), ms);
  const linked = new AbortController();
  // If caller passed a signal, abort ours when theirs aborts
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  // return the controller we actually pass to fetch and a cancel to clear timer
  return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
}

/**
 * Perform a fetch against the LWG API with:
 *  - base URL + path
 *  - optional query params
 *  - timeout (default 15s)
 *  - robust JSON parsing
 * Returns: { resp, json, text, ok, status }
 */
export async function apiFetch(path, {
  method = 'GET',
  query,
  headers,
  body,
  timeout = 15000,
  signal
} = {}) {
  const url = new URL(path.startsWith('http') ? path : (API.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')));
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
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

/**
 * Best-effort API health check. Tolerates 404 (some stacks don’t expose /api/health).
 * Returns an object: { ok, status, latencyMs }
 */
export async function checkApi() {
  const t0 = performance.now();
  try {
    const r = await apiFetch('/api/health', { method: 'HEAD', timeout: 7000 });
    const t1 = performance.now();
    const ok = r.ok || r.status === 404; // consider 404 as “reachable”
    return { ok, status: r.status || 0, latencyMs: Math.round(t1 - t0) };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Math.round(performance.now() - t0) };
  }
}

/**
 * Convenience wrapper that throws on non-2xx and normalizes error messages.
 * Usage: const data = await getJSON('/api/orders/track', { query: { ref, email } });
 */
export async function getJSON(path, options = {}) {
  const r = await apiFetch(path, options);
  if (!r.ok) {
    const serverMsg = (r.json && (r.json.error || r.json.message)) || (r.text && r.text.slice(0, 160)) || ('HTTP ' + r.status);
    const err = new Error(serverMsg);
    err.status = r.status;
    err.response = r.resp;
    err.body = r.text;
    throw err;
  }
  // Some endpoints wrap payloads in { ok, ... }
  if (r.json && r.json.ok === false) {
    const err = new Error(r.json.error || r.json.message || 'Request failed');
    err.status = r.status || 400;
    err.response = r.resp;
    err.body = r.text;
    throw err;
  }
  return r.json;
}

// Example specific helpers (safe to remove if unused)

/** Track an order (expects backend to accept ref + email|phone) */
export async function trackOrder({ ref, email, phone }, { timeout } = {}) {
  const query = { ref };
  if (email) query.email = email;
  if (phone) query.phone = phone;
  return getJSON('/api/orders/track', { query, timeout });
}

/** Build receipt PDF URL for a given identity */
export function receiptUrl({ ref, identity }) {
  const url = new URL(API.replace(/\/+$/, '') + '/api/orders/receipt.pdf');
  url.searchParams.set('ref', ref || '');
  if (isEmail(identity)) url.searchParams.set('email', identity);
  else url.searchParams.set('phone', normalizePhone(identity));
  return url.toString();
}

/** Optional cart count helper (ignore errors quietly) */
async function safeCartCount() {
  try {
    const r = await apiFetch('/api/cart/count', { timeout: 5000 });
    if (r.ok && r.json && typeof r.json.count === 'number') return r.json.count;
  } catch {}
  return 0;
}
