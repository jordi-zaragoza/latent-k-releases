/**
 * Latent-K Payments Worker
 * Handles Stripe Checkout, license generation, and admin operations
 * Fully serverless on Cloudflare Workers + KV
 */

const PLAN_CONFIG = {
  trial14: { days: 14, name: 'Trial' },
  monthly: { days: 30, name: 'Monthly' },
  yearly: { days: 365, name: 'Yearly' }
};

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Rate limiting configuration
const RATE_LIMIT = {
  login: { maxAttempts: 5, windowSeconds: 300 },    // 5 attempts per 5 minutes
  trial: { maxAttempts: 3, windowSeconds: 3600 },   // 3 attempts per hour
  checkout: { maxAttempts: 10, windowSeconds: 60 }  // 10 attempts per minute
};

// In-memory fallback for rate limiting when KV fails
// Note: In Workers, this persists per isolate (not globally shared)
const memoryRateLimit = new Map();

/**
 * Clean expired entries from memory fallback (prevent memory leak)
 */
function cleanMemoryRateLimit() {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, record] of memoryRateLimit) {
    const action = key.split(':')[1];
    const config = RATE_LIMIT[action];
    if (config && now - record.windowStart >= config.windowSeconds * 2) {
      memoryRateLimit.delete(key);
    }
  }
}

/**
 * Check rate limit for an action
 * Returns { allowed: boolean, remaining: number, resetIn: number }
 */
async function checkRateLimit(env, action, identifier) {
  const config = RATE_LIMIT[action];
  if (!config) return { allowed: true, remaining: 999, resetIn: 0 };

  const key = `ratelimit:${action}:${identifier}`;
  const now = Math.floor(Date.now() / 1000);

  // If KV not configured, use memory fallback
  if (!env.LICENSES) {
    return checkRateLimitMemory(key, config, now);
  }

  try {
    const data = await env.LICENSES.get(key);
    let record = data ? JSON.parse(data) : { count: 0, windowStart: now };

    // Reset window if expired
    if (now - record.windowStart >= config.windowSeconds) {
      record = { count: 0, windowStart: now };
    }

    const remaining = Math.max(0, config.maxAttempts - record.count);
    const resetIn = config.windowSeconds - (now - record.windowStart);

    if (record.count >= config.maxAttempts) {
      return { allowed: false, remaining: 0, resetIn };
    }

    // Increment counter
    record.count++;
    await env.LICENSES.put(key, JSON.stringify(record), {
      expirationTtl: config.windowSeconds
    });

    return { allowed: true, remaining: remaining - 1, resetIn };
  } catch (error) {
    console.error('Rate limit KV error, using memory fallback:', error);
    // Fail CLOSED with memory fallback instead of fail-open
    return checkRateLimitMemory(key, config, now);
  }
}

/**
 * Memory-based rate limiting fallback
 * Less accurate than KV (per-isolate) but secure
 */
function checkRateLimitMemory(key, config, now) {
  // Periodically clean old entries
  if (memoryRateLimit.size > 100) {
    cleanMemoryRateLimit();
  }

  let record = memoryRateLimit.get(key) || { count: 0, windowStart: now };

  // Reset window if expired
  if (now - record.windowStart >= config.windowSeconds) {
    record = { count: 0, windowStart: now };
  }

  const remaining = Math.max(0, config.maxAttempts - record.count);
  const resetIn = config.windowSeconds - (now - record.windowStart);

  if (record.count >= config.maxAttempts) {
    return { allowed: false, remaining: 0, resetIn };
  }

  // Increment counter
  record.count++;
  memoryRateLimit.set(key, record);

  return { allowed: true, remaining: remaining - 1, resetIn };
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Compare against self to maintain constant time even on length mismatch
    b = a;
  }
  let result = a.length === arguments[1].length ? 0 : 1;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Import RSA private key from PEM format
 */
async function importPrivateKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Generate random hex string
 */
function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Base64url encode
 */
function base64urlEncode(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url decode
 */
function base64urlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  return JSON.parse(atob(padded));
}

/**
 * Generate a license key using RSA signature
 */
async function generateLicense(env, options) {
  if (!options.email) {
    throw new Error('Email is required');
  }

  const privateKey = await importPrivateKey(env.LICENSE_PRIVATE_KEY);

  let expires = options.expires || null;
  if (options.durationDays && !expires) {
    expires = Date.now() + options.durationDays * 24 * 60 * 60 * 1000;
  }

  const data = {
    id: randomHex(8),
    type: options.type || 'standard',
    email: options.email.toLowerCase().trim(),
    created: Date.now(),
    expires
  };

  const payload = base64urlEncode(data);
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(payload)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `LK-${payload}.${signature}`;
}

/**
 * Parse license data without validation
 */
function parseLicense(key) {
  try {
    if (!key || !key.startsWith('LK-')) return null;
    const payload = key.slice(3).split('.')[0];
    return base64urlDecode(payload);
  } catch {
    return null;
  }
}

/**
 * Validate admin session
 */
async function isSessionValid(env, token) {
  if (!token || !env.LICENSES) return false;
  const data = await env.LICENSES.get(`session:${token}`);
  if (!data) return false;

  const { createdAt } = JSON.parse(data);
  if (Date.now() - createdAt > SESSION_MAX_AGE_MS) {
    await env.LICENSES.delete(`session:${token}`);
    return false;
  }
  return true;
}

/**
 * Check authentication (session or worker token)
 */
async function checkAuth(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return { authenticated: false };

  const token = auth.slice(7);

  // Check worker token first (timing-safe comparison)
  if (env.NODE_SERVER_TOKEN && timingSafeEqual(token, env.NODE_SERVER_TOKEN)) {
    return { authenticated: true, source: 'worker' };
  }

  // Check session
  if (await isSessionValid(env, token)) {
    return { authenticated: true, source: 'admin' };
  }

  return { authenticated: false };
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://latent-k.dev',
  'https://www.latent-k.dev',
  'https://latent-k.pages.dev',
  'http://localhost:3000' // For local development
];

/**
 * CORS headers for responses - restricted to allowed origins
 */
function corsHeaders(origin) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

/**
 * Create Stripe Checkout Session
 * POST /api/checkout
 * Body: { email, name, plan: 'monthly' | 'yearly' }
 */
async function handleCheckout(request, env) {
  const origin = request.headers.get('Origin');
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Rate limiting
  const rateLimit = await checkRateLimit(env, 'checkout', clientIP);
  if (!rateLimit.allowed) {
    return jsonResponse({
      error: 'Too many requests. Please try again later.',
      retryAfter: rateLimit.resetIn
    }, 429, origin);
  }

  try {
    const { email, name, plan } = await request.json();

    if (!email || !plan) {
      return jsonResponse({ error: 'Email and plan are required' }, 400, origin);
    }

    if (!['monthly', 'yearly'].includes(plan)) {
      return jsonResponse({ error: 'Invalid plan. Must be monthly or yearly' }, 400, origin);
    }

    const priceId = plan === 'monthly' ? env.STRIPE_PRICE_MONTHLY : env.STRIPE_PRICE_YEARLY;

    // Create Stripe Checkout Session
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'payment',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'customer_email': email,
        'success_url': `${env.CORS_ORIGIN}/activation.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${env.CORS_ORIGIN}/activation.html?canceled=true`,
        'metadata[email]': email,
        'metadata[name]': name || '',
        'metadata[plan]': plan,
      }),
    });

    const session = await response.json();

    if (session.error) {
      console.error('Stripe error:', session.error);
      return jsonResponse({ error: 'Failed to create checkout session' }, 500, origin);
    }

    return jsonResponse({ url: session.url, sessionId: session.id }, 200, origin);

  } catch (error) {
    console.error('Checkout error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500, origin);
  }
}

/**
 * Handle Stripe Webhook
 * POST /api/webhook
 * Receives checkout.session.completed events
 */
async function handleWebhook(request, env) {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  try {
    const body = await request.text();

    // Verify webhook signature
    const event = await verifyStripeWebhook(body, signature, env.STRIPE_WEBHOOK_SECRET);

    if (!event) {
      return new Response('Invalid signature', { status: 400 });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { email, name, plan } = session.metadata;
      const isTestMode = env.STRIPE_SECRET_KEY?.startsWith('sk_test_');

      console.log(`Processing completed checkout for ${email}, plan: ${plan}${isTestMode ? ' (TEST MODE)' : ''}`);

      // In test mode, return a fake key without storing
      if (isTestMode) {
        const fakeKey = `LK-TEST-${Date.now()}-${plan}`;
        await env.LICENSES.put(
          `checkout:${session.id}`,
          JSON.stringify({
            key: fakeKey,
            email: email.toLowerCase().trim(),
            plan,
            expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            created: new Date().toISOString(),
            test: true
          }),
          { expirationTtl: 86400 }
        );
        console.log(`[TEST] Fake license generated for ${email}: ${fakeKey}`);
        return new Response('OK', { status: 200 });
      }

      // Generate real license for production
      const normalizedEmail = email.toLowerCase().trim();
      const durationDays = PLAN_CONFIG[plan]?.days || 365;
      const durationMs = durationDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      // Check for existing active license to extend
      const existingData = await env.LICENSES.get(`license:paid:${normalizedEmail}`);
      let existingLicense = existingData ? JSON.parse(existingData) : null;

      let expires;
      if (existingLicense && existingLicense.expires && new Date(existingLicense.expires).getTime() > now) {
        expires = new Date(existingLicense.expires).getTime() + durationMs;
        console.log(`[LICENSE] Extending license for ${normalizedEmail}`);
      } else {
        expires = now + durationMs;
      }

      const key = await generateLicense(env, { email: normalizedEmail, expires });
      const data = parseLicense(key);

      const licenseRecord = {
        id: data.id,
        key,
        email: normalizedEmail,
        name: name || '',
        plan: plan || 'yearly',
        created: new Date().toISOString(),
        expires: data.expires ? new Date(data.expires).toISOString() : null
      };

      // Store persistently in KV
      await env.LICENSES.put(`license:paid:${normalizedEmail}`, JSON.stringify(licenseRecord));
      await env.LICENSES.put(`license:id:${data.id}`, JSON.stringify(licenseRecord));

      // Store for checkout session retrieval (TTL 24 hours)
      await env.LICENSES.put(
        `checkout:${session.id}`,
        JSON.stringify({
          key,
          email: normalizedEmail,
          plan,
          expires: licenseRecord.expires,
          created: licenseRecord.created,
        }),
        { expirationTtl: 86400 }
      );

      console.log(`License generated for ${email}: ${key.substring(0, 20)}...`);
      return new Response('OK', { status: 200 });
    }

    // Acknowledge other event types
    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Webhook processing failed', { status: 500 });
  }
}

/**
 * Verify Stripe webhook signature
 * Uses Web Crypto API available in Cloudflare Workers
 */
async function verifyStripeWebhook(payload, signature, secret) {
  try {
    const parts = signature.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=');
      acc[key] = value;
      return acc;
    }, {});

    const timestamp = parts.t;
    const sig = parts.v1;

    if (!timestamp || !sig) {
      return null;
    }

    // Check timestamp (allow 5 minute tolerance)
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
      console.error('Webhook timestamp too old');
      return null;
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signedPayload)
    );

    const expectedSig = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Constant-time comparison
    if (expectedSig.length !== sig.length) {
      return null;
    }

    let result = 0;
    for (let i = 0; i < expectedSig.length; i++) {
      result |= expectedSig.charCodeAt(i) ^ sig.charCodeAt(i);
    }

    if (result !== 0) {
      return null;
    }

    return JSON.parse(payload);

  } catch (error) {
    console.error('Signature verification error:', error);
    return null;
  }
}

/**
 * Handle admin login
 * POST /api/login
 */
async function handleLogin(request, env) {
  const origin = request.headers.get('Origin');
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Rate limiting
  const rateLimit = await checkRateLimit(env, 'login', clientIP);
  if (!rateLimit.allowed) {
    return jsonResponse({
      error: 'Too many login attempts. Please try again later.',
      retryAfter: rateLimit.resetIn
    }, 429, origin);
  }

  try {
    const { username, password } = await request.json();

    if (timingSafeEqual(username, env.ADMIN_USER) && timingSafeEqual(password, env.ADMIN_PASS)) {
      const token = randomHex(32);
      await env.LICENSES.put(
        `session:${token}`,
        JSON.stringify({ createdAt: Date.now() }),
        { expirationTtl: 86400 }
      );
      console.log('[AUTH] Admin logged in');
      return jsonResponse({ token }, 200, origin);
    }

    return jsonResponse({ error: 'Invalid credentials' }, 401, origin);
  } catch (error) {
    console.error('Login error:', error);
    return jsonResponse({ error: 'Invalid request' }, 400, origin);
  }
}

/**
 * Handle admin logout
 * POST /api/logout
 */
async function handleLogout(request, env) {
  const origin = request.headers.get('Origin');
  const auth = request.headers.get('Authorization');

  if (auth && auth.startsWith('Bearer ')) {
    await env.LICENSES.delete(`session:${auth.slice(7)}`);
  }

  return jsonResponse({ success: true }, 200, origin);
}

/**
 * Handle trial license request
 * POST /api/trial
 */
async function handleTrial(request, env) {
  const origin = request.headers.get('Origin');
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Rate limiting
  const rateLimit = await checkRateLimit(env, 'trial', clientIP);
  if (!rateLimit.allowed) {
    return jsonResponse({
      error: 'Too many trial requests. Please try again later.',
      retryAfter: rateLimit.resetIn
    }, 429, origin);
  }

  try {
    const { email, name } = await request.json();

    if (!email) {
      return jsonResponse({ error: 'Email is required' }, 400, origin);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if this IP already generated a trial (prevent abuse with multiple emails)
    const existingTrialIP = await env.LICENSES.get(`trial:ip:${clientIP}`);
    if (existingTrialIP) {
      return jsonResponse({
        error: 'Trial already claimed from this network.'
      }, 409, origin);
    }

    // Check if email already has a paid license
    const existingPaid = await env.LICENSES.get(`license:paid:${normalizedEmail}`);
    if (existingPaid) {
      const license = JSON.parse(existingPaid);
      const isActive = license.expires && new Date(license.expires).getTime() > Date.now();
      if (isActive) {
        return jsonResponse({
          error: 'You already have an active license for this email.'
        }, 409, origin);
      } else {
        return jsonResponse({
          error: 'Trial not available for existing customers. Renew at: https://latent-k.dev'
        }, 409, origin);
      }
    }

    // Check if email already has a trial
    const existingTrial = await env.LICENSES.get(`license:trial:${normalizedEmail}`);
    if (existingTrial) {
      return jsonResponse({
        error: 'Trial already used for this email.'
      }, 409, origin);
    }

    // Generate trial license
    const durationDays = PLAN_CONFIG.trial14.days;
    const key = await generateLicense(env, {
      email: normalizedEmail,
      durationDays,
      type: 'trial'
    });
    const data = parseLicense(key);

    const licenseData = {
      id: data.id,
      key,
      email: normalizedEmail,
      name: name || '',
      plan: 'trial14',
      created: new Date().toISOString(),
      expires: data.expires ? new Date(data.expires).toISOString() : null
    };

    // Store in KV
    await env.LICENSES.put(`license:trial:${normalizedEmail}`, JSON.stringify(licenseData));
    await env.LICENSES.put(`license:id:${data.id}`, JSON.stringify(licenseData));
    // Mark IP as used for trial (no expiration - permanent)
    await env.LICENSES.put(`trial:ip:${clientIP}`, JSON.stringify({
      email: normalizedEmail,
      created: new Date().toISOString()
    }));

    console.log(`[TRIAL] Generated 14-day trial for ${normalizedEmail} from IP ${clientIP}`);
    return jsonResponse({
      key,
      email: normalizedEmail,
      expires: licenseData.expires,
      daysLeft: durationDays
    }, 200, origin);

  } catch (error) {
    console.error('Trial error:', error);
    return jsonResponse({ error: error.message || 'Failed to process trial request' }, 500, origin);
  }
}

/**
 * Handle license generation (protected)
 * POST /api/generate
 */
async function handleGenerate(request, env) {
  const origin = request.headers.get('Origin');
  const auth = await checkAuth(request, env);

  if (!auth.authenticated) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }

  try {
    const { email, name, plan } = await request.json();

    if (!email) {
      return jsonResponse({ error: 'Email is required' }, 400, origin);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const durationDays = PLAN_CONFIG[plan]?.days || 365;
    const durationMs = durationDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Check for existing active paid license
    const existingData = await env.LICENSES.get(`license:paid:${normalizedEmail}`);
    let existingLicense = existingData ? JSON.parse(existingData) : null;
    let extended = false;

    // Calculate expiration
    let expires;
    if (existingLicense && existingLicense.expires && new Date(existingLicense.expires).getTime() > now) {
      expires = new Date(existingLicense.expires).getTime() + durationMs;
      extended = true;
      console.log(`[LICENSE] Extending license for ${normalizedEmail} from ${existingLicense.expires}`);
    } else {
      expires = now + durationMs;
    }

    const key = await generateLicense(env, { email: normalizedEmail, expires });
    const data = parseLicense(key);

    const licenseData = {
      id: data.id,
      key,
      email: normalizedEmail,
      name: name || '',
      plan: plan || 'yearly',
      created: new Date().toISOString(),
      expires: data.expires ? new Date(data.expires).toISOString() : null,
      extended
    };

    // Store in KV
    await env.LICENSES.put(`license:paid:${normalizedEmail}`, JSON.stringify(licenseData));
    await env.LICENSES.put(`license:id:${data.id}`, JSON.stringify(licenseData));

    console.log(`[LICENSE] Generated license for ${normalizedEmail} (${plan || 'yearly'}) via ${auth.source}, expires ${new Date(expires).toISOString()}`);

    return jsonResponse({
      key,
      data,
      extended,
      previousExpiry: extended ? existingLicense.expires : null
    }, 200, origin);

  } catch (error) {
    console.error('Generate error:', error);
    return jsonResponse({ error: error.message || 'Failed to generate license' }, 500, origin);
  }
}

/**
 * Handle license deletion (protected)
 * POST /api/delete
 */
async function handleDelete(request, env) {
  const origin = request.headers.get('Origin');
  const auth = await checkAuth(request, env);

  if (!auth.authenticated || auth.source !== 'admin') {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }

  try {
    const { key } = await request.json();
    const parsed = parseLicense(key);

    if (!parsed || !parsed.id) {
      return jsonResponse({ error: 'Invalid license key' }, 400, origin);
    }

    const licenseData = await env.LICENSES.get(`license:id:${parsed.id}`);

    if (!licenseData) {
      return jsonResponse({ error: 'License not found' }, 404, origin);
    }

    const license = JSON.parse(licenseData);
    const email = license.email;

    // Delete all related keys
    await env.LICENSES.delete(`license:id:${parsed.id}`);
    if (license.plan === 'trial14') {
      await env.LICENSES.delete(`license:trial:${email}`);
    } else {
      await env.LICENSES.delete(`license:paid:${email}`);
    }

    console.log(`[LICENSE] Deleted license for ${email}`);
    return jsonResponse({ success: true, email }, 200, origin);

  } catch (error) {
    console.error('Delete error:', error);
    return jsonResponse({ error: error.message }, 500, origin);
  }
}

/**
 * List all licenses (protected)
 * GET /api/licenses
 */
async function handleListLicenses(request, env) {
  const origin = request.headers.get('Origin');
  const auth = await checkAuth(request, env);

  if (!auth.authenticated || auth.source !== 'admin') {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin);
  }

  try {
    const licenses = [];
    const list = await env.LICENSES.list({ prefix: 'license:id:' });

    for (const key of list.keys) {
      const data = await env.LICENSES.get(key.name);
      if (data) {
        licenses.push(JSON.parse(data));
      }
    }

    // Sort by created date descending
    licenses.sort((a, b) => new Date(b.created) - new Date(a.created));

    return jsonResponse(licenses, 200, origin);
  } catch (error) {
    console.error('List error:', error);
    return jsonResponse({ error: error.message }, 500, origin);
  }
}

/**
 * Get license by session ID
 * GET /api/license?session_id=xxx
 */
async function handleGetLicense(request, env) {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) {
    return jsonResponse({ error: 'session_id is required' }, 400, origin);
  }

  if (!env.LICENSES) {
    return jsonResponse({ error: 'License storage not configured' }, 500, origin);
  }

  try {
    const data = await env.LICENSES.get(`checkout:${sessionId}`);

    if (!data) {
      return jsonResponse({ error: 'License not found. Payment may still be processing.' }, 404, origin);
    }

    const license = JSON.parse(data);
    return jsonResponse(license, 200, origin);

  } catch (error) {
    console.error('Get license error:', error);
    return jsonResponse({ error: 'Failed to retrieve license' }, 500, origin);
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request.headers.get('Origin')),
      });
    }

    // Route requests
    if (path === '/api/checkout' && method === 'POST') {
      return handleCheckout(request, env);
    }

    if (path === '/api/webhook' && method === 'POST') {
      return handleWebhook(request, env);
    }

    if (path === '/api/license' && method === 'GET') {
      return handleGetLicense(request, env);
    }

    if (path === '/api/trial' && method === 'POST') {
      return handleTrial(request, env);
    }

    // Admin endpoints
    if (path === '/api/login' && method === 'POST') {
      return handleLogin(request, env);
    }

    if (path === '/api/logout' && method === 'POST') {
      return handleLogout(request, env);
    }

    if (path === '/api/generate' && method === 'POST') {
      return handleGenerate(request, env);
    }

    if (path === '/api/delete' && method === 'POST') {
      return handleDelete(request, env);
    }

    if (path === '/api/licenses' && method === 'GET') {
      return handleListLicenses(request, env);
    }

    // Health check
    if (path === '/health' || path === '/') {
      return jsonResponse({ status: 'ok', service: 'latent-k-payments' });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
