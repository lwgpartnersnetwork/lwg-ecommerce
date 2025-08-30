// api-base.js — resolve the correct API base for LWG

export const API_BASE =
  window.__LWG_API__ ||
  ((location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : 'https://lwg-api.onrender.com');
