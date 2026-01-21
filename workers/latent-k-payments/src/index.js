const PLAN_CONFIG = {trial14:{days:14,name:'Trial'},monthly:{days:30,name:'Monthly'},yearly:{days:365,name:'Yearly'}};
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT = {login:{maxAttempts:5,windowSeconds:300},trial:{maxAttempts:3,windowSeconds:3600},checkout:{maxAttempts:10,windowSeconds:60},chat:{maxAttempts:529,windowSeconds:86400},checkLicense:{maxAttempts:30,windowSeconds:60}};
const memoryRateLimit = new Map();
function cleanMemoryRateLimit() {
  const now = Math.floor(Date.now() / 1000);
  for (const [k, rec] of memoryRateLimit) {
    const act = k.split(':')[1];
    const cfg = RATE_LIMIT[act];
    if (cfg && now - rec.windowStart >= cfg.windowSeconds * 2)memoryRateLimit.delete(k);
  }
}
async function checkRateLimit(env, act, id) {
  const cfg = RATE_LIMIT[act];
  if (!cfg) return {allowed:true,remaining:999,resetIn:0};
  const k = `ratelimit:${act}:${id}`;
  const now = Math.floor(Date.now() / 1000);
  if (!env.LICENSES) return checkRateLimitMemory(k, cfg, now);
  try {
    const dt = await env.LICENSES.get(k);
    let rec = dt ? JSON.parse(dt) : {count:0,windowStart:now};
    if (now - rec.windowStart >= cfg.windowSeconds) rec = {count:0,windowStart:now};
    const rem = Math.max(0, cfg.maxAttempts - rec.count);
    const rstIn = cfg.windowSeconds - (now - rec.windowStart);
    if (rec.count >= cfg.maxAttempts) return {allowed:false,remaining:0,resetIn:rstIn};
    rec.count++;
    await env.LICENSES.put(k, JSON.stringify(rec), {expirationTtl:cfg.windowSeconds});
    return {allowed:true,remaining:rem - 1,resetIn:rstIn};
  } catch (err) {
    console.error('Rate limit KV error, using memory fallback:', err);
    return checkRateLimitMemory(k, cfg, now);
  }
}
function checkRateLimitMemory(k, cfg, now) {
  if (memoryRateLimit.size > 100) cleanMemoryRateLimit();
  let rec = memoryRateLimit.get(k) || {count:0,windowStart:now};
  if (now - rec.windowStart >= cfg.windowSeconds) rec = {count:0,windowStart:now};
  const rem = Math.max(0, cfg.maxAttempts - rec.count);
  const rstIn = cfg.windowSeconds - (now - rec.windowStart);
  if (rec.count >= cfg.maxAttempts) return {allowed:false,remaining:0,resetIn:rstIn};
  rec.count++;
  memoryRateLimit.set(k, rec);
  return {allowed:true,remaining:rem - 1,resetIn:rstIn};
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) b = a;
  let res = a.length === arguments[1].length ? 0 : 1;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}
async function importPrivateKey(pem) {
  const pemCts = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binK = Uint8Array.from(atob(pemCts), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', binK, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
}
function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
function base64urlEncode(dt) {
  const str = typeof dt === 'string' ? dt : JSON.stringify(dt);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  const pd = pad ? b64 + '='.repeat(4 - pad) : b64;
  return JSON.parse(atob(pd));
}
async function generateLicense(env, opts) {
  if (!opts.email) throw new Error('E_EML_REQ');
  const privK = await importPrivateKey(env.LICENSE_PRIVATE_KEY);
  let exp = opts.expires || null;
  if (opts.durationDays && !exp) exp = Date.now() + opts.durationDays * 24 * 60 * 60 * 1000;
  const dt = {id:randomHex(8),type:opts.type || 'standard',email:opts.email.toLowerCase().trim(),created:Date.now(),expires:exp};
  const pl = base64urlEncode(dt);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privK, new TextEncoder().encode(pl));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `LK-${pl}.${sig}`;
}
function parseLicense(k) {
  try {
    if (!k || !k.startsWith('LK-')) return null;
    const pl = k.slice(3).split('.')[0];
    return base64urlDecode(pl);
  } catch {
    return null;
  }
}
async function isSessionValid(env, tkn) {
  if (!tkn || !env.LICENSES) return false;
  const dt = await env.LICENSES.get(`session:${tkn}`);
  if (!dt) return false;
  const {createdAt:crtAt} = JSON.parse(dt);
  if (Date.now() - crtAt > SESSION_MAX_AGE_MS) {
    await env.LICENSES.delete(`session:${tkn}`);
    return false;
  }
  return true;
}
async function checkAuth(req, env) {
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return {authenticated:false};
  const tkn = auth.slice(7);
  if (env.NODE_SERVER_TOKEN && timingSafeEqual(tkn, env.NODE_SERVER_TOKEN)) return {authenticated:true,source:'worker'};
  if (await isSessionValid(env, tkn)) return {authenticated:true,source:'admin'};
  return {authenticated:false};
}
const ALLOWED_ORIGINS = ['https://latent-k.dev','https://www.latent-k.dev','https://latent-k.pages.dev','http://localhost:3000'];
function isOriginAllowed(o) {
  if (!o) return false;
  if (ALLOWED_ORIGINS.includes(o)) return true;
  if (/^https:\/\/[a-z0-9]+\.latent-k\.pages\.dev$/.test(o)) return true;
  return false;
}
function corsHeaders(o) {
  const alo = o && isOriginAllowed(o) ? o : ALLOWED_ORIGINS[0];
  return {'Access-Control-Allow-Origin':alo,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Credentials':'true',};
}
function jsonResponse(dt, sts = 200, o) {
  return new Response(JSON.stringify(dt), {status:sts,headers:{'Content-Type':'application/json',...corsHeaders(o)}});
}
async function handleCheckout(req, env) {
  const o = req.headers.get('Origin');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env, 'checkout', ip);
  if (!rl.allowed) return jsonResponse({error:'E_MANY_REQ',retryAfter:rl.resetIn}, 429, o);
  try {
    const {email:eml,name:nm,plan:pln} = await req.json();
    if (!eml || !pln) return jsonResponse({error:'E_REQ_EML_PLAN'}, 400, o);
    if (!['monthly','yearly'].includes(pln)) return jsonResponse({error:'E_INV_PLAN'}, 400, o);
    const priceId = pln === 'monthly' ? env.STRIPE_PRICE_MONTHLY : env.STRIPE_PRICE_YEARLY;
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:'POST',headers:{'Authorization':`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded',},
      body:new URLSearchParams({'mode':'payment','line_items[0][price]':priceId,'line_items[0][quantity]':'1','customer_email':eml,'success_url':`${env.CORS_ORIGIN}/activation.html?success=true&session_id={CHECKOUT_SESSION_ID}`,'cancel_url':`${env.CORS_ORIGIN}/activation.html?canceled=true`,'metadata[email]':eml,'metadata[name]':nm || '','metadata[plan]':pln}),
    });
    const sess = await res.json();
    if (sess.error) {console.error('Stripe error:', sess.error);return jsonResponse({error:'E_STRIPE'}, 500, o);}
    return jsonResponse({url:sess.url,sessionId:sess.id}, 200, o);
  } catch (err) {console.error('Checkout error:', err);return jsonResponse({error:'E_INT'}, 500, o);}
}
async function handleWebhook(req, env) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('E_MISS_SIG', {status:400});
  try {
    const body = await req.text();
    const evt = await verifyStripeWebhook(body, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!evt) return new Response('E_INV_SIG', {status:400});
    if (evt.type === 'checkout.session.completed') {
      const sess = evt.data.object;
      const {email:eml,name:nm,plan:pln} = sess.metadata;
      const isTest = env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
      console.log(`Processing completed checkout for ${eml}, plan: ${pln}${isTest ? ' (TEST MODE)' : ''}`);
      if (isTest) {
        const fakeK = `LK-TEST-${Date.now()}-${pln}`;
        await env.LICENSES.put(`checkout:${sess.id}`,JSON.stringify({key:fakeK,email:eml.toLowerCase().trim(),plan:pln,expires:new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),created:new Date().toISOString(),test:true}),{expirationTtl:86400});
        console.log(`[TEST] Fake license generated for ${eml}: ${fakeK}`);
        return new Response('OK', {status:200});
      }
      const normEml = eml.toLowerCase().trim();
      const durDays = PLAN_CONFIG[pln]?.days || 365;
      const durMs = durDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const existingDt = await env.LICENSES.get(`license:paid:${normEml}`);
      let existingLic = existingDt ? JSON.parse(existingDt) : null;
      let exp;
      if (existingLic && existingLic.expires && new Date(existingLic.expires).getTime() > now) {
        exp = new Date(existingLic.expires).getTime() + durMs;
        console.log(`[LICENSE] Extending license for ${normEml}`);
      } else exp = now + durMs;
      const k = await generateLicense(env, {email:normEml,expires:exp});
      const dt = parseLicense(k);
      const licRec = {id:dt.id,key:k,email:normEml,name:nm || '',plan:pln || 'yearly',created:new Date().toISOString(),expires:dt.expires ? new Date(dt.expires).toISOString() : null};
      await env.LICENSES.put(`license:paid:${normEml}`, JSON.stringify(licRec));
      await env.LICENSES.put(`license:id:${dt.id}`, JSON.stringify(licRec));
      await env.LICENSES.put(`checkout:${sess.id}`,JSON.stringify({key:k,email:normEml,plan:pln,expires:licRec.expires,created:licRec.created}),{expirationTtl:86400});
      console.log(`License generated for ${eml}: ${k.substring(0, 20)}...`);
      return new Response('OK', {status:200});
    }
    return new Response('OK', {status:200});
  } catch (err) {console.error('Webhook error:', err);return new Response('E_WEBHOOK', {status:500});}
}
async function verifyStripeWebhook(pl, sig, sec) {
  try {
    const pts = sig.split(',').reduce((acc, pt) => {
      const [k, v] = pt.split('=');
      acc[k] = v;
      return acc;
    }, {});
    const t = pts.t;
    const s = pts.v1;
    if (!t || !s) return null;
    const curT = Math.floor(Date.now() / 1000);
    if (Math.abs(curT - parseInt(t)) > 300) {console.error('Webhook timestamp too old');return null;}
    const sPl = `${t}.${pl}`;
    const k = await crypto.subtle.importKey('raw',new TextEncoder().encode(sec),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(sPl));
    const expSig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (expSig.length !== s.length) return null;
    let res = 0;
    for (let i = 0; i < expSig.length; i++) res |= expSig.charCodeAt(i) ^ s.charCodeAt(i);
    if (res !== 0) return null;
    return JSON.parse(pl);
  } catch (err) {console.error('Signature verification error:', err);return null;}
}
async function handleLogin(req, env) {
  const o = req.headers.get('Origin');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env, 'login', ip);
  if (!rl.allowed) return jsonResponse({error:'E_MANY_ATTEMPTS',retryAfter:rl.resetIn}, 429, o);
  try {
    const {username:usr,password:pass} = await req.json();
    if (timingSafeEqual(usr, env.ADMIN_USER) && timingSafeEqual(pass, env.ADMIN_PASS)) {
      const tkn = randomHex(32);
      await env.LICENSES.put(`session:${tkn}`,JSON.stringify({createdAt:Date.now()}),{expirationTtl:86400});
      console.log('[AUTH] Admin logged in');
      return jsonResponse({token:tkn}, 200, o);
    }
    return jsonResponse({error:'E_INV_CREDS'}, 401, o);
  } catch (err) {console.error('Login error:', err);return jsonResponse({error:'E_INV_REQ'}, 400, o);}
}
async function handleLogout(req, env) {
  const o = req.headers.get('Origin');
  const auth = req.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) await env.LICENSES.delete(`session:${auth.slice(7)}`);
  return jsonResponse({success:true}, 200, o);
}
async function handleTrial(req, env) {
  const o = req.headers.get('Origin');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env, 'trial', ip);
  if (!rl.allowed) return jsonResponse({error:'E_MANY_REQ',retryAfter:rl.resetIn}, 429, o);
  try {
    const {email:eml,name:nm} = await req.json();
    if (!eml) return jsonResponse({error:'E_EML_REQ'}, 400, o);
    const normEml = eml.toLowerCase().trim();
    const existingTrialIP = await env.LICENSES.get(`trial:ip:${ip}`);
    if (existingTrialIP) return jsonResponse({error:'E_TRIAL_CLAIMED'}, 409, o);
    const existingPaid = await env.LICENSES.get(`license:paid:${normEml}`);
    if (existingPaid) {
      const lic = JSON.parse(existingPaid);
      const isActive = lic.expires && new Date(lic.expires).getTime() > Date.now();
      if (isActive) return jsonResponse({error:'E_LIC_EXISTS'}, 409, o);
      else return jsonResponse({error:'E_TRIAL_NA'}, 409, o);
    }
    const existingTrial = await env.LICENSES.get(`license:trial:${normEml}`);
    if (existingTrial) return jsonResponse({error:'E_TRIAL_USED'}, 409, o);
    const durDays = PLAN_CONFIG.trial14.days;
    const k = await generateLicense(env, {email:normEml,durationDays:durDays,type:'trial'});
    const dt = parseLicense(k);
    const licDt = {id:dt.id,key:k,email:normEml,name:nm || '',plan:'trial14',created:new Date().toISOString(),expires:dt.expires ? new Date(dt.expires).toISOString() : null};
    await env.LICENSES.put(`license:trial:${normEml}`, JSON.stringify(licDt));
    await env.LICENSES.put(`license:id:${dt.id}`, JSON.stringify(licDt));
    await env.LICENSES.put(`trial:ip:${ip}`, JSON.stringify({email:normEml,created:new Date().toISOString()}));
    console.log(`[TRIAL] Generated 14-day trial for ${normEml} from IP ${ip}`);
    return jsonResponse({key:k,email:normEml,expires:licDt.expires,daysLeft:durDays}, 200, o);
  } catch (err) {console.error('Trial error:', err);return jsonResponse({error:err.message || 'E_FAILED_TRIAL'}, 500, o);}
}
async function handleGenerate(req, env) {
  const o = req.headers.get('Origin');
  const auth = await checkAuth(req, env);
  if (!auth.authenticated) return jsonResponse({error:'E_UNAUTH'}, 401, o);
  try {
    const {email:eml,name:nm,plan:pln} = await req.json();
    if (!eml) return jsonResponse({error:'E_EML_REQ'}, 400, o);
    const normEml = eml.toLowerCase().trim();
    const durDays = PLAN_CONFIG[pln]?.days || 365;
    const durMs = durDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const existingDt = await env.LICENSES.get(`license:paid:${normEml}`);
    let existingLic = existingDt ? JSON.parse(existingDt) : null;
    let ext = false;
    let exp;
    if (existingLic && existingLic.expires && new Date(existingLic.expires).getTime() > now) {
      exp = new Date(existingLic.expires).getTime() + durMs;
      ext = true;
      console.log(`[LICENSE] Extending license for ${normEml} from ${existingLic.expires}`);
    } else exp = now + durMs;
    const k = await generateLicense(env, {email:normEml,expires:exp});
    const dt = parseLicense(k);
    const licDt = {id:dt.id,key:k,email:normEml,name:nm || '',plan:pln || 'yearly',created:new Date().toISOString(),expires:dt.expires ? new Date(dt.expires).toISOString() : null,extended:ext};
    await env.LICENSES.put(`license:paid:${normEml}`, JSON.stringify(licDt));
    await env.LICENSES.put(`license:id:${dt.id}`, JSON.stringify(licDt));
    console.log(`[LICENSE] Generated license for ${normEml} (${pln || 'yearly'}) via ${auth.source}, expires ${new Date(exp).toISOString()}`);
    return jsonResponse({key:k,data:dt,extended:ext,previousExpiry:ext ? existingLic.expires : null}, 200, o);
  } catch (err) {console.error('Generate error:', err);return jsonResponse({error:err.message || 'E_GEN_FAIL'}, 500, o);}
}
async function handleDelete(req, env) {
  const o = req.headers.get('Origin');
  const auth = await checkAuth(req, env);
  if (!auth.authenticated || auth.source !== 'admin') return jsonResponse({error:'E_UNAUTH'}, 401, o);
  try {
    const {key:k} = await req.json();
    const parsed = parseLicense(k);
    if (!parsed || !parsed.id) return jsonResponse({error:'E_INV_KEY'}, 400, o);
    const licDt = await env.LICENSES.get(`license:id:${parsed.id}`);
    if (!licDt) return jsonResponse({error:'E_LIC_NF'}, 404, o);
    const lic = JSON.parse(licDt);
    const eml = lic.email;
    await env.LICENSES.delete(`license:id:${parsed.id}`);
    if (lic.plan === 'trial14') await env.LICENSES.delete(`license:trial:${eml}`);
    else await env.LICENSES.delete(`license:paid:${eml}`);
    console.log(`[LICENSE] Deleted license for ${eml}`);
    return jsonResponse({success:true,email:eml}, 200, o);
  } catch (err) {console.error('Delete error:', err);return jsonResponse({error:err.message}, 500, o);}
}
async function handleListLicenses(req, env) {
  const o = req.headers.get('Origin');
  const auth = await checkAuth(req, env);
  if (!auth.authenticated || auth.source !== 'admin') return jsonResponse({error:'E_UNAUTH'}, 401, o);
  try {
    const lics = [];
    const lst = await env.LICENSES.list({prefix:'license:id:'});
    for (const k of lst.keys) {
      const dt = await env.LICENSES.get(k.name);
      if (dt) lics.push(JSON.parse(dt));
    }
    lics.sort((a, b) => new Date(b.created) - new Date(a.created));
    return jsonResponse(lics, 200, o);
  } catch (err) {console.error('List error:', err);return jsonResponse({error:err.message}, 500, o);}
}
async function handleCheckLicense(req, env) {
  const o = req.headers.get('Origin');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env, 'checkLicense', ip);
  if (!rl.allowed) return jsonResponse({error:'E_MANY_REQ',retryAfter:rl.resetIn}, 429, o);
  const uri = new URL(req.url);
  const eml = uri.searchParams.get('email');
  if (!eml) return jsonResponse({error:'E_EML_REQ'}, 400, o);
  const normEml = eml.toLowerCase().trim();
  try {
    let licDt = await env.LICENSES.get(`license:paid:${normEml}`);
    if (!licDt) licDt = await env.LICENSES.get(`license:trial:${normEml}`);
    if (!licDt) return jsonResponse({valid:false,error:'E_LIC_NF'}, 404, o);
    const lic = JSON.parse(licDt);
    const now = Date.now();
    const exp = lic.expires ? new Date(lic.expires).getTime() : null;
    const expired = exp ? now > exp : false;
    const daysL = exp ? Math.ceil((exp - now) / (24 * 60 * 60 * 1000)) : null;
    return jsonResponse({valid:!lic.revoked && !expired,revoked:!!lic.revoked,revokedAt:lic.revokedAt || null,revokeReason:lic.revokeReason || null,expired:expired,expires:lic.expires,daysLeft:daysL,plan:lic.plan}, 200, o);
  } catch (err) {console.error('Check license error:', err);return jsonResponse({error:'E_CHK_FAIL'}, 500, o);}
}
async function handleRevoke(req, env) {
  const o = req.headers.get('Origin');
  const auth = await checkAuth(req, env);
  if (!auth.authenticated || auth.source !== 'admin') return jsonResponse({error:'E_UNAUTH'}, 401, o);
  try {
    const {email:eml,reason:rsn} = await req.json();
    if (!eml) return jsonResponse({error:'E_EML_REQ'}, 400, o);
    const normEml = eml.toLowerCase().trim();
    let licK = `license:paid:${normEml}`;
    let licDt = await env.LICENSES.get(licK);
    if (!licDt) {licK = `license:trial:${normEml}`;licDt = await env.LICENSES.get(licK);}
    if (!licDt) return jsonResponse({error:'E_LIC_NF'}, 404, o);
    const lic = JSON.parse(licDt);
    if (lic.revoked) return jsonResponse({error:'E_LIC_REVOKED'}, 409, o);
    lic.revoked = true;
    lic.revokedAt = new Date().toISOString();
    lic.revokeReason = rsn || 'Revoked by admin';
    await env.LICENSES.put(licK, JSON.stringify(lic));
    if (lic.id) await env.LICENSES.put(`license:id:${lic.id}`, JSON.stringify(lic));
    console.log(`[LICENSE] Revoked license for ${normEml}: ${rsn || 'No reason'}`);
    return jsonResponse({success:true,email:normEml,revokedAt:lic.revokedAt}, 200, o);
  } catch (err) {console.error('Revoke error:', err);return jsonResponse({error:err.message || 'E_REVOKE_FAIL'}, 500, o);}
}
async function handleUnrevoke(req, env) {
  const o = req.headers.get('Origin');
  const auth = await checkAuth(req, env);
  if (!auth.authenticated || auth.source !== 'admin') return jsonResponse({error:'E_UNAUTH'}, 401, o);
  try {
    const {email:eml} = await req.json();
    if (!eml) return jsonResponse({error:'E_EML_REQ'}, 400, o);
    const normEml = eml.toLowerCase().trim();
    let licK = `license:paid:${normEml}`;
    let licDt = await env.LICENSES.get(licK);
    if (!licDt) {licK = `license:trial:${normEml}`;licDt = await env.LICENSES.get(licK);}
    if (!licDt) return jsonResponse({error:'E_LIC_NF'}, 404, o);
    const lic = JSON.parse(licDt);
    if (!lic.revoked) return jsonResponse({error:'E_LIC_NOT_REVOKED'}, 409, o);
    delete lic.revoked;
    delete lic.revokedAt;
    delete lic.revokeReason;
    await env.LICENSES.put(licK, JSON.stringify(lic));
    if (lic.id) await env.LICENSES.put(`license:id:${lic.id}`, JSON.stringify(lic));
    console.log(`[LICENSE] Unrevoked license for ${normEml}`);
    return jsonResponse({success:true,email:normEml}, 200, o);
  } catch (err) {console.error('Unrevoke error:', err);return jsonResponse({error:err.message || 'E_UNREVOKE_FAIL'}, 500, o);}
}
async function handleGetLicense(req, env) {
  const o = req.headers.get('Origin');
  const uri = new URL(req.url);
  const sessId = uri.searchParams.get('session_id');
  if (!sessId) return jsonResponse({error:'E_SESS_ID_REQ'}, 400, o);
  if (!env.LICENSES) return jsonResponse({error:'E_LIC_STORAGE_CFG'}, 500, o);
  try {
    const dt = await env.LICENSES.get(`checkout:${sessId}`);
    if (!dt) return jsonResponse({error:'E_LIC_NF'}, 404, o);
    const lic = JSON.parse(dt);
    return jsonResponse(lic, 200, o);
  } catch (err) {console.error('Get license error:', err);return jsonResponse({error:'E_GET_LIC_FAIL'}, 500, o);}
}
async function handleChat(req, env) {
  const o = req.headers.get('Origin');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await checkRateLimit(env, 'chat', ip);
  if (!rl.allowed) return jsonResponse({error:'E_CHAT_LIMIT',retryAfter:rl.resetIn}, 429, o);
  try {
    const {message:msg} = await req.json();
    if (!msg || typeof msg !== 'string') return jsonResponse({error:'E_MSG_REQ'}, 400, o);
    if (!env.GEMINI_API_KEY) return jsonResponse({error:'E_CHAT_NOT_CFG'}, 500, o);
    const sysP = `You are the LATENT-K assistant, a helpful chatbot on the LATENT-K website.
## WHAT IS LATENT-K
LATENT-K is a CLI tool that automatically injects relevant code context into AI coding assistants like Claude Code and Gemini CLI. It analyzes your prompt and injects only the relevant code, provides instant answers to simple questions, and auto-syncs at session start and end.
## BENCHMARK RESULTS
Small Project (6,596 files): 1.38x faster overall, saved 4 min 2 sec
- High complexity: 1.45x faster
- Trivial questions: 1.63x faster
Large Project (27,985 files): 1.61x faster overall, saved 5 min 46 sec
- High complexity: 2.1x faster
- Low complexity: 2.1x faster
LK won 73% of test questions in both projects.
## PRICING
- Free Trial: 14 days, all features, no credit card
- Monthly: $9/month
- Yearly: $79/year (best value, 2 months free)
## QUICK START
1. Download binary from latent-k.dev
2. lk activate (enter license key)
3. lk setup (configure AI provider: Anthropic or Gemini)
4. lk enable (enable hooks for Claude/Gemini)
5. lk sync (initial sync)
Then just run "claude" or "gemini" normally - context is injected automatically!
## ALL COMMANDS
- lk activate: Enter license key
- lk setup: Configure AI provider (Anthropic Claude Haiku or Gemini free)
- lk sync: Sync project files. Options: -r (regenerate), -a (all files), --hash-only
- lk status: Show project status, files tracked, license info
- lk stats: Show LLM usage, costs, token usage. Options: --json, --reset
- lk enable: Enable hooks for Claude Code and/or Gemini CLI. Options: -t claude, -t gemini
- lk disable: Disable hooks
- lk ignore [pattern]: Manage ignore patterns. Options: -a (add), -r (remove)
- lk update: Update to latest version (auto-detects platform)
- lk clean: Remove lk data. Options: -c (context), -l (license), -C (config), -a (all)
## HOW IT WORKS
1. Session Start: Context banner shown, auto-sync runs
2. During Session: Prompts are analyzed and relevant context injected
3. Session End: Modified files auto-synced
## SUPPORTED INTEGRATIONS
- Claude Code: Full support (SessionStart, UserPromptSubmit, Stop hooks)
- Gemini CLI: Full support (SessionStart, BeforeAgent, SessionEnd hooks)
## AI PROVIDERS FOR SYNC
- Anthropic (Claude Haiku): Requires API key from console.anthropic.com
- Gemini: Free option, key from aistudio.google.com
## FILES & LOCATIONS
- Project context stored in .lk/ folder
- Config at ~/.config/lk/
- License at ~/.config/lk-license/
## INSTRUCTIONS
Be concise and friendly. Answer questions about LATENT-K features, commands, pricing, and setup.
If asked something unrelated, politely redirect to LATENT-K topics.
Keep responses short (2-3 sentences) unless more detail is requested.
Use bullet points for lists. Never invent features that don't exist.`;
    const gemRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system_instruction:{parts:[{text:sysP}]},contents:[{parts:[{text:msg}]}],generationConfig:{maxOutputTokens:512,temperature:0.7}})});
    if (!gemRes.ok) {const et = await gemRes.text();console.error('[CHAT] Gemini API error:', et);return jsonResponse({error:'E_AI_SRVC'}, 500, o);}
    const gemDt = await gemRes.json();
    const rpl = gemDt.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
    return jsonResponse({reply:rpl}, 200, o);
  } catch (err) {console.error('Chat error:', err);return jsonResponse({error:'E_INT'}, 500, o);}
}
export default {
  async fetch(req, env) {
    const uri = new URL(req.url);
    const p = uri.pathname;
    const m = req.method;
    if (m === 'OPTIONS') return new Response(null, {status:204,headers:corsHeaders(req.headers.get('Origin'))});
    if (p === '/api/checkout' && m === 'POST') return handleCheckout(req, env);
    if (p === '/api/webhook' && m === 'POST') return handleWebhook(req, env);
    if (p === '/api/license' && m === 'GET') return handleGetLicense(req, env);
    if (p === '/api/check-license' && m === 'GET') return handleCheckLicense(req, env);
    if (p === '/api/revoke' && m === 'POST') return handleRevoke(req, env);
    if (p === '/api/unrevoke' && m === 'POST') return handleUnrevoke(req, env);
    if (p === '/api/trial' && m === 'POST') return handleTrial(req, env);
    if (p === '/api/chat' && m === 'POST') return handleChat(req, env);
    if (p === '/api/login' && m === 'POST') return handleLogin(req, env);
    if (p === '/api/logout' && m === 'POST') return handleLogout(req, env);
    if (p === '/api/generate' && m === 'POST') return handleGenerate(req, env);
    if (p === '/api/delete' && m === 'POST') return handleDelete(req, env);
    if (p === '/api/licenses' && m === 'GET') return handleListLicenses(req, env);
    if (p === '/health' || p === '/') return jsonResponse({status:'ok',service:'latent-k-payments'});
    return jsonResponse({error:'E_NF'}, 404);
  },
};