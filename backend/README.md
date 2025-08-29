# LWG API (fixed for Render + Netlify)
Exposes `/api/products` with correct **trust proxy** and **CORS** for Render/Netlify.
- Sets `app.set('trust proxy', 1)` before rate-limits.
- CORS allows: `https://www.lwgpartnersnetwork.com, https://lwgpartnersnetwork.com`.

## Run
```bash
cp .env.example .env
npm i
npm run seed   # optional demo data
npm run dev
```
