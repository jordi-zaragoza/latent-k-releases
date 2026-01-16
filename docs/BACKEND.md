# lk Backend API Spec

Backend necesario para validar licencias y gestionar suscripciones.

## Endpoints

### POST /v1/license/validate

Valida una licencia existente.

**Request:**
```json
{
  "key": "LK-XXXX-XXXX-XXXX",
  "device": "a1b2c3d4e5f6"
}
```

**Response (success):**
```json
{
  "valid": true,
  "plan": "pro",
  "expires": "2025-12-31T23:59:59Z"
}
```

**Response (error):**
```json
{
  "valid": false,
  "error": "License expired"
}
```

### POST /v1/license/activate

Activa una licencia en un nuevo dispositivo.

**Request:**
```json
{
  "key": "LK-XXXX-XXXX-XXXX",
  "device": "a1b2c3d4e5f6"
}
```

**Response (success):**
```json
{
  "success": true,
  "plan": "pro",
  "expires": "2025-12-31T23:59:59Z"
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "Device limit reached"
}
```

## Database Schema

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Licenses
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  user_id TEXT REFERENCES users(id),
  plan TEXT NOT NULL,  -- 'pro', 'team'
  status TEXT NOT NULL,  -- 'active', 'cancelled', 'expired'
  expires_at TIMESTAMP,
  max_devices INTEGER DEFAULT 2,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Devices
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  license_id TEXT REFERENCES licenses(id),
  device_hash TEXT NOT NULL,
  last_seen TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(license_id, device_hash)
);

-- Stripe integration
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  license_id TEXT REFERENCES licenses(id),
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Tech Stack Sugerido

- **Runtime**: Cloudflare Workers o Vercel Edge Functions
- **Database**: Turso (SQLite edge) o Supabase
- **Payments**: Stripe
- **Auth**: Stripe Customer Portal (sin auth propio)

## Flujo de Pago

```
1. Usuario va a latent-k.dev
2. Elige plan y paga con Stripe
3. Stripe webhook crea license en DB
4. Usuario recibe license key por email
5. Usuario ejecuta: lk activate
6. Backend valida y activa en device
```

## Seguridad

- License keys: formato `LK-XXXX-XXXX-XXXX` (UUID-based)
- Device hash: SHA256 de hostname (no PII)
- Rate limiting: 10 req/min por IP
- Cache: validación cacheada 24h en cliente

## Variables de Entorno

```
DATABASE_URL=libsql://...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
