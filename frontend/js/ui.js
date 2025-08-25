export const $ = (q, el=document) => el.querySelector(q);
export const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));
export const money = n => 'NLe ' + (Number(n||0)).toLocaleString();

let toastTimer;
export function toast(msg){
  const el = document.querySelector('.toast');
  if(!el) return alert(msg);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 1800);
}

// (optional) render a header with cart count—stub here
export function renderHeader(){ /* if you add a nav, update cartCount here */ }
