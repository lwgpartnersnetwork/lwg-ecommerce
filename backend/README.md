# LWG API

Production-ready Orders & Products API for **LWG Partners Network**.
Works on Render (backend) and Netlify/any static host (frontend).  
Includes proper **trust proxy**, **rate limiting**, and **CORS** for:
- `https://www.lwgpartnersnetwork.com`
- `https://lwgpartnersnetwork.com`

---

## Features

- ✅ **Products API** (`/api/products`, `/api/products/:idOrSlug`)
- ✅ **Orders API** (place, track, PDF receipt)
- ✅ **Admin API** (JWT protected)
- ✅ **Security**: `helmet`, rate limits, JSON body size limit
- ✅ **Observability**: `pino-http` logs, graceful Mongo connection handling
- ✅ **PDF receipts** via `pdfkit`
- ✅ **Mongoose v8** schemas & indexes
- ✅ CORS + `app.set('trust proxy', 1)` for Render/NGINX

---

## Quick Start

```bash
# 1) Configure environment
cp .env.example .env
# edit .env with your credentials

# 2) Install deps
npm i

# 3) (Optional) Seed demo products
npm run seed

# 4) Run
npm run dev      # dev (nodemon)
# or
npm start        # production
