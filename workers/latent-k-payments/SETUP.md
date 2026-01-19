# Configuración Stripe Payments

## Estado Actual ✅

| Servicio | URL | Estado |
|----------|-----|--------|
| **Web (Pages)** | https://latent-k.pages.dev | ✅ Online |
| **API (Worker)** | https://latent-k-payments.latent-k.workers.dev | ✅ Online |
| **Backend (local)** | Tunnel temporal | ⚠️ Requiere server local |

## Credenciales Configuradas

### Stripe (Test Mode)
```
STRIPE_SECRET_KEY=sk_test_51SrGBK...
STRIPE_PRICE_MONTHLY=price_1SrHm5HMGFk3NIgDNhISpHN7
STRIPE_PRICE_YEARLY=price_1SrHmIHMGFk3NIgDVj4I1JTV
STRIPE_WEBHOOK_SECRET=whsec_Do1YUtPgFHDL94RHsMjYNXgcEHu7BiKA
```

### Stripe (Live Mode) - Para producción
```
STRIPE_SECRET_KEY=rk_live_51SrGBK...
STRIPE_PRICE_MONTHLY=price_1SrH47HMGFk3NIgDgeo3nheN
STRIPE_PRICE_YEARLY=price_1SrH4eHMGFk3NIgDUPw6RxLo
STRIPE_WEBHOOK_SECRET=whsec_rg908wIag8vQiNSpkh8c6UdWqWDeusho
```

### Worker
```
NODE_SERVER_TOKEN=lk_worker_a7f3x9k2m5p8q1w4
NODE_SERVER_URL=<URL del tunnel - cambia cada reinicio>
CORS_ORIGIN=https://latent-k.pages.dev
```

## Levantar el Sistema (Local)

```bash
# Terminal 1: Servidor Node.js
cd /home/jordi/projects/personal/latent_k
ADMIN_USER=admin ADMIN_PASS=<tu-pass> WORKER_TOKEN=lk_worker_a7f3x9k2m5p8q1w4 node web/server.js

# Terminal 2: Tunnel
cloudflared tunnel --url http://localhost:3000

# Terminal 3: Actualizar URL del tunnel en Worker
cd workers/latent-k-payments
npx wrangler secret put NODE_SERVER_URL
# Pegar la URL del tunnel (https://xxx.trycloudflare.com)
```

## Actualizar Web (Pages)

```bash
cd /home/jordi/projects/personal/latent_k/web
zip -j ../latent-k-pages.zip activation.html index.html
# Subir latent-k-pages.zip a Cloudflare Pages dashboard
```

## Cambiar a Producción (Live)

```bash
cd workers/latent-k-payments
npx wrangler secret put STRIPE_SECRET_KEY      # rk_live_...
npx wrangler secret put STRIPE_PRICE_MONTHLY   # price_1SrH47...
npx wrangler secret put STRIPE_PRICE_YEARLY    # price_1SrH4e...
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_rg908w...
```

---

## Next Steps: Backend Persistente

Para no depender del servidor local, opciones:

### Opción 1: Migrar a Cloudflare KV (Gratis)
- Mover `licenses.json` a KV storage
- Todo en Workers, sin servidor Node.js
- Requiere reescribir lógica de licencias

### Opción 2: VPS Barato (~$5/mes)
- DigitalOcean, Hetzner, Vultr
- Server Node.js siempre online
- Sin cambios de código

### Opción 3: Cloudflare Tunnel Persistente (Gratis)
- Requiere PC siempre encendida
- Tunnel con nombre fijo (no cambia URL)
- `cloudflared service install`

### Opción 4: Railway/Render (Gratis con límites)
- Necesita DB externa para `licenses.json`
- Se apaga tras inactividad en free tier
