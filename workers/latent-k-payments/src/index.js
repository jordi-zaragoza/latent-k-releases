/**
 * Latent-K Payments Worker
 * Handles Stripe Checkout integration for license payments
 */

const PLAN_CONFIG = {
  monthly: { days: 30, name: 'Monthly' },
  yearly: { days: 365, name: 'Yearly' }
};

/**
 * CORS headers for responses
 */
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

      console.log(`Processing completed checkout for ${email}, plan: ${plan}`);

      // Generate license via Node.js server
      const licenseResponse = await fetch(`${env.NODE_SERVER_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.NODE_SERVER_TOKEN}`,
        },
        body: JSON.stringify({ email, name, plan }),
      });

      if (!licenseResponse.ok) {
        const errorData = await licenseResponse.json();
        console.error('License generation failed:', errorData);
        return new Response('License generation failed', { status: 500 });
      }

      const licenseData = await licenseResponse.json();
      console.log(`License generated for ${email}: ${licenseData.key.substring(0, 20)}...`);

      // Store license in KV for retrieval (TTL 24 hours)
      if (env.LICENSES) {
        await env.LICENSES.put(
          `session:${session.id}`,
          JSON.stringify({
            key: licenseData.key,
            email,
            plan,
            expires: licenseData.data?.expires || null,
            created: new Date().toISOString(),
          }),
          { expirationTtl: 86400 } // 24 hours
        );
      }

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
    const data = await env.LICENSES.get(`session:${sessionId}`);

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

    // Health check
    if (path === '/health' || path === '/') {
      return jsonResponse({ status: 'ok', service: 'latent-k-payments' });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
