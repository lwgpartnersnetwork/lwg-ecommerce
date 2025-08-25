// Simple store using localStorage
const KEY_PRODUCTS = 'lwg_products_v1';
const KEY_CART     = 'lwg_cart_v1';
const KEY_ORDERS   = 'lwg_orders_v1';

const Store = {
  // Seed demo products if empty
  init(){
    if(!localStorage.getItem(KEY_PRODUCTS)){
      const demo = [
        {id:crypto.randomUUID(), title:'LWG Classic Tee', price:180, stock:25, image:'https://picsum.photos/seed/lwg1/600/400', desc:'Soft cotton tee with LWG branding.'},
        {id:crypto.randomUUID(), title:'Express Cap',     price:120, stock:30, image:'https://picsum.photos/seed/lwg2/600/400', desc:'Lightweight cap for sunny days.'},
        {id:crypto.randomUUID(), title:'Premium Hoodie',  price:420, stock:15, image:'https://picsum.photos/seed/lwg3/600/400', desc:'Cozy hoodie in brand colors.'}
      ];
      localStorage.setItem(KEY_PRODUCTS, JSON.stringify(demo));
    }
    if(!localStorage.getItem(KEY_CART))   localStorage.setItem(KEY_CART,   JSON.stringify([]));
    if(!localStorage.getItem(KEY_ORDERS)) localStorage.setItem(KEY_ORDERS, JSON.stringify([]));
  },

  // PRODUCTS
  products(){ return JSON.parse(localStorage.getItem(KEY_PRODUCTS) || '[]'); },
  saveProducts(list){ localStorage.setItem(KEY_PRODUCTS, JSON.stringify(list)); },
  getProduct(id){ return this.products().find(p => p.id === id); },
  upsertProduct(p){
    const list = this.products();
    const i = list.findIndex(x => x.id === p.id);
    if(i > -1) list[i] = p; else list.push({...p, id: crypto.randomUUID()});
    this.saveProducts(list); return p.id;
  },
  deleteProduct(id){ this.saveProducts(this.products().filter(p => p.id !== id)); },

  // CART
  cart(){ return JSON.parse(localStorage.getItem(KEY_CART) || '[]'); },
  saveCart(c){ localStorage.setItem(KEY_CART, JSON.stringify(c)); },
  addToCart(productId, qty=1){
    const c=this.cart();
    const it=c.find(i=>i.id===productId);
    if(it) it.qty+=qty; else c.push({id:productId, qty});
    this.saveCart(c);
  },
  updateQty(productId, qty){
    const c=this.cart();
    const it=c.find(i=>i.id===productId);
    if(!it) return; it.qty=qty; if(it.qty<=0) c.splice(c.indexOf(it),1); this.saveCart(c);
  },
  clearCart(){ this.saveCart([]); },

  // ORDERS
  orders(){ return JSON.parse(localStorage.getItem(KEY_ORDERS) || '[]'); },
  saveOrders(list){ localStorage.setItem(KEY_ORDERS, JSON.stringify(list)); },
  setOrderStatus(id, status){
    const list = this.orders();
    const i = list.findIndex(o => o.id === id);
    if(i > -1){ list[i].status = status; this.saveOrders(list); }
  },
  placeOrder(info){
    const items = this.cart().map(i => ({
      ...i,
      product: this.getProduct(i.id)
    }));
    const total = items.reduce((s,i)=> s + i.product.price*i.qty, 0);
    const order = {
      id: 'LWG-' + Math.random().toString(36).slice(2,8).toUpperCase(),
      at: new Date().toISOString(),
      items, total, info,
      status: 'New'
    };
    const list = this.orders(); list.push(order); this.saveOrders(list);
    this.clearCart();
    return order;
  }
};

export default Store;
