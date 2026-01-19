# Configuración Post-Despliegue

Completa estos datos después de desplegar el Worker y configurar Stripe.

## Cloudflare Worker

```
KV_NAMESPACE_ID=
WORKER_URL=https://api.latent-k.dev
```

## Stripe (Dashboard → Products → Prices)

```
STRIPE_PRICE_MONTHLY=price_
STRIPE_PRICE_YEARLY=price_
```

## Node.js Server

```
WORKER_TOKEN=
NODE_SERVER_URL=https://admin.latent-k.dev
```

---

## Comandos de Despliegue

```bash
# 1. Crear KV namespace
cd workers/latent-k-payments
wrangler kv:namespace create "LICENSES"

# 2. Configurar secrets
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_PRICE_MONTHLY
wrangler secret put STRIPE_PRICE_YEARLY
wrangler secret put NODE_SERVER_TOKEN
wrangler secret put NODE_SERVER_URL

# 3. Desplegar
wrangler deploy
```

## Stripe Webhook

- URL: `{WORKER_URL}/api/webhook`
- Evento: `checkout.session.completed`
