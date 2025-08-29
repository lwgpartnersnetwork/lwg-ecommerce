const PROD_API = 'https://lwg-api.onrender.com';
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
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
async function fetchProducts({ q='', category='', min, max, page=1, pageSize=12 } = {}){
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (category) qs.set('category', category);
  if (min) qs.set('min', min);
  if (max) qs.set('max', max);
  qs.set('page', page);
  qs.set('pageSize', pageSize);

  const url = `${API_BASE}/api/products?${qs.toString()}`;
  const res = await fetch(url, { headers: { 'Accept':'application/json' }});
  if (!res.ok) throw new Error('HTTP '+res.status);

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Failed to fetch products');

  return data; // { ok:true, total, products:[...] }
}
