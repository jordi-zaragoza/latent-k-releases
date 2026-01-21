#!/usr/bin/env node
import { createServer } from 'http'
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'
import { generateLicense, parseLicense } from '../scripts/license-admin.js'
const __dirname = dirname(fileURLToPath(import.meta.url));
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const la = a.length; const lb = b.length;
  const cb = la === lb ? b : a;
  let r = la === lb ? 0 : 1;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ cb.charCodeAt(i);
  return r === 0
}
const PORT = process.env.PORT || 3000;
const LICENSES_FILE = join(__dirname, 'licenses.json');
const PLAN_DAYS = { trial1: 1, trial7: 7, trial14: 14, monthly: 30, yearly: 365 };
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const WORKER_TOKEN = process.env.WORKER_TOKEN;
function loadGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const ep = join(__dirname, '..', 'lk_viewer', '.env');
  if (existsSync(ep)) {
    const c = readFileSync(ep, 'utf8');
    const m = c.match(/GEMINI_API_KEY=(.+)/);
    if (m) return m[1].trim();
  }
  return null
}
const GEMINI_API_KEY = loadGeminiKey();
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('ERROR: ADMIN_USER and ADMIN_PASS environment variables are required');
  console.error('Example: ADMIN_USER=admin ADMIN_PASS=your-secure-password node web/server.js');
  process.exit(1)
}
const SESSIONS_FILE = join(__dirname, '.sessions.json');
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT = { login: { maxAttempts: 5, windowSeconds: 300 }, trial: { maxAttempts: 3, windowSeconds: 3600 } };
const rateLimitStore = new Map();
function checkRateLimit(action, identifier) {
  const cfg = RATE_LIMIT[action];
  if (!cfg) return { allowed: true, remaining: 999, resetIn: 0 };
  const k = `${action}:${identifier}`;
  const now = Math.floor(Date.now() / 1000);
  let rec = rateLimitStore.get(k) || { count: 0, windowStart: now };
  if (now - rec.windowStart >= cfg.windowSeconds) rec = { count: 0, windowStart: now };
  const rem = Math.max(0, cfg.maxAttempts - rec.count);
  const ri = cfg.windowSeconds - (now - rec.windowStart);
  if (rec.count >= cfg.maxAttempts) return { allowed: false, remaining: 0, resetIn: ri };
  rec.count++;
  rateLimitStore.set(k, rec);
  if (rateLimitStore.size > 100) {
    for (const [rk, rv] of rateLimitStore) {
      const a = rk.split(':')[0];
      const c = RATE_LIMIT[a];
      if (c && now - rv.windowStart >= c.windowSeconds * 2) rateLimitStore.delete(rk)
    }
  }
  return { allowed: true, remaining: rem - 1, resetIn: ri }
}
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
}
function loadSessions() {
  if (existsSync(SESSIONS_FILE)) {
    try {
      const d = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
      if (Array.isArray(d)) {
        const now = Date.now();
        const m = new Map(d.map(t => [t, now]));
        return m
      }
      return new Map(Object.entries(d))
    } catch { return new Map() }
  }
  return new Map()
}
function saveSessions(s) { writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(s))) }
function cleanExpiredSessions(s) {
  const now = Date.now();
  let c = false;
  for (const [t, ca] of s) {
    if (now - ca > SESSION_MAX_AGE_MS) {
      s.delete(t);
      c = true
    }
  }
  if (c) saveSessions(s)
}
function isSessionValid(s, t) {
  if (!s.has(t)) return false;
  const ca = s.get(t);
  if (Date.now() - ca > SESSION_MAX_AGE_MS) {
    s.delete(t);
    saveSessions(s);
    return false
  }
  return true
}
const sessions = loadSessions();
cleanExpiredSessions(sessions);
function loadLicenses() {
  if (existsSync(LICENSES_FILE)) return JSON.parse(readFileSync(LICENSES_FILE, 'utf8'));
  return []
}
function saveLicenses(ls) { writeFileSync(LICENSES_FILE, JSON.stringify(ls, null, 2)) }
const MAX_BODY_SIZE = 16 * 1024;
function readBody(req) {
  return new Promise((res, rej) => {
    let b = ''; let s = 0;
    req.on('data', c => {
      s += c.length;
      if (s > MAX_BODY_SIZE) { req.destroy(); rej(new Error('BODY_TOO_LARGE')); return }
      b += c
    });
    req.on('end', () => res(b));
    req.on('error', rej)
  })
}
const ALLOWED_ORIGINS = [
  'https://latent-k.dev',
  'https://www.latent-k.dev',
  'https://latent-k.pages.dev',
  'http://localhost:3000'
];
const server = createServer(async (req, res) => {
  const og = req.headers.origin;
  if (og && ALLOWED_ORIGINS.includes(og)) {
    res.setHeader('Access-Control-Allow-Origin', og);
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  function isAuthenticated() {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return false;
    return isSessionValid(sessions, auth.slice(7))
  }
  if (req.method === 'POST' && req.url === '/api/login') {
    const ip = getClientIP(req);
    const rl = checkRateLimit('login', ip);
    if (!rl.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'E_LOGIN_RATE_LIMIT', retryAfter: rl.resetIn }));
      return
    }
    try {
      const b = await readBody(req);
      const { username: u, password: p } = JSON.parse(b);
      if (timingSafeEqual(u, ADMIN_USER) && timingSafeEqual(p, ADMIN_PASS)) {
        const t = randomBytes(32).toString('hex');
        sessions.set(t, Date.now());
        saveSessions(sessions);
        console.log(`[AUTH] Admin logged in`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: t }))
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_AUTH_INVALID' }))
      }
    } catch (e) {
      if (e.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_BODY_TOO_LARGE' }))
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_BAD_REQUEST' }))
      }
    }
    return
  }
  if (req.method === 'POST' && req.url === '/api/logout') {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      sessions.delete(auth.slice(7));
      saveSessions(sessions)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return
  }
  if (req.method === 'POST' && req.url === '/api/trial') {
    const ip = getClientIP(req);
    const rl = checkRateLimit('trial', ip);
    if (!rl.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'E_TRIAL_RATE_LIMIT', retryAfter: rl.resetIn }));
      return
    }
    try {
      const b = await readBody(req);
      const { email: em, name: n } = JSON.parse(b);
      if (!em) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_EMAIL_REQUIRED' }));
        return
      }
      const nem = em.toLowerCase().trim();
      const ls = loadLicenses();
      const now = Date.now();
      const ep = ls.find(l => l.email.toLowerCase().trim() === nem && (l.plan === 'monthly' || l.plan === 'yearly'));
      if (ep) {
        const ia = ep.expires && new Date(ep.expires).getTime() > now;
        if (ia) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'E_ACTIVE_PAID_LICENSE' }))
        } else {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'E_EXPIRED_PAID_LICENSE' }))
        }
        return
      }
      const et = ls.find(l => l.email.toLowerCase().trim() === nem && l.plan === 'trial14');
      if (et) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_TRIAL_ALREADY_USED' }));
        return
      }
      const dd = PLAN_DAYS.trial14;
      const k = generateLicense({ email: nem, durationDays: dd, type: 'trial' });
      const d = parseLicense(k);
      ls.push({ key: k, email: nem, name: n || '', plan: 'trial14', created: new Date().toISOString(), expires: d.expires ? new Date(d.expires).toISOString() : null });
      saveLicenses(ls);
      console.log(`[TRIAL] Generated 14-day trial for ${nem}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key: k, email: nem, expires: d.expires ? new Date(d.expires).toISOString() : null, daysLeft: dd }))
    } catch (e) {
      if (e.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_BODY_TOO_LARGE' }))
      } else {
        console.error('[TRIAL] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_SERVER_ERROR' }))
      }
    }
    return
  }
  if (req.method === 'POST' && req.url === '/api/generate') {
    const auth = req.headers.authorization;
    const bt = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const iwa = WORKER_TOKEN && bt && timingSafeEqual(bt, WORKER_TOKEN);
    const isa = isAuthenticated();
    if (!iwa && !isa) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'E_UNAUTHORIZED' }));
      return
    }
    try {
      const b = await readBody(req);
      const { email: em, name: n, plan: p } = JSON.parse(b);
      if (!em) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_EMAIL_REQUIRED' }));
        return
      }
      const nem = em.toLowerCase().trim();
      const ls = loadLicenses();
      const dd = PLAN_DAYS[p] || 365;
      const dm = dd * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const el = ls.find(l => l.email.toLowerCase().trim() === nem && !l.plan.startsWith('trial') && l.expires && new Date(l.expires).getTime() > now);
      let exp;
      if (el) {
        const ce = new Date(el.expires).getTime();
        exp = ce + dm;
        console.log(`[LICENSE] Extending license for ${nem} from ${el.expires}`)
      } else { exp = now + dm }
      const k = generateLicense({ email: nem, expires: exp });
      const d = parseLicense(k);
      ls.push({ key: k, email: nem, name: n || '', plan: p || 'yearly', created: new Date().toISOString(), expires: d.expires ? new Date(d.expires).toISOString() : null, extended: !!el });
      saveLicenses(ls);
      const src = iwa ? 'worker' : 'admin';
      console.log(`[LICENSE] Generated license for ${nem} (${p || 'yearly'}) via ${src}, expires ${new Date(exp).toISOString()}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key: k, data: d, extended: !!el, previousExpiry: el ? el.expires : null }))
    } catch (e) {
      if (e.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_BODY_TOO_LARGE' }))
      } else {
        console.error('[LICENSE] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_SERVER_ERROR' }))
      }
    }
    return
  }
  if (req.method === 'POST' && req.url === '/api/delete') {
    if (!isAuthenticated()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'E_UNAUTHORIZED' }));
      return
    }
    try {
      const b = await readBody(req);
      const { key: k } = JSON.parse(b);
      const ls = loadLicenses();
      const idx = ls.findIndex(l => l.key === k);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_LICENSE_NOT_FOUND' }));
        return
      }
      const l = ls[idx];
      ls.splice(idx, 1);
      saveLicenses(ls);
      console.log(`[LICENSE] Deleted license for ${l.email}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, email: l.email }))
    } catch (e) {
      if (e.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_BODY_TOO_LARGE' }))
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_SERVER_ERROR' }))
      }
    }
    return
  }
  if (req.method === 'GET' && req.url === '/api/licenses') {
    if (!isAuthenticated()) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'E_UNAUTHORIZED' }));
      return
    }
    const ls = loadLicenses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ls));
    return
  }
  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const b = await readBody(req);
      const { message: msg } = JSON.parse(b);
      if (!msg || typeof msg !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_MESSAGE_REQUIRED' }));
        return
      }
      if (!GEMINI_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_CHATBOT_CONFIG_MISSING' }));
        return
      }
      const sp = `You are the LATENT-K assistant, a helpful chatbot on the LATENT-K website.
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
      const gr = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system_instruction: { parts: [{ text: sp }] }, contents: [{ parts: [{ text: msg }] }], generationConfig: { maxOutputTokens: 512, temperature: 0.7 } }) }
      );
      if (!gr.ok) {
        const et = await gr.text();
        console.error('[CHAT] Gemini API error:', et);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_AI_SERVICE_ERROR' }));
        return
      }
      const gd = await gr.json();
      const rp = gd.candidates?.[0]?.content?.parts?.[0]?.text || 'E_CHAT_NO_RESPONSE';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply: rp }))
    } catch (e) {
      if (e.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_BODY_TOO_LARGE' }))
      } else {
        console.error('[CHAT] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'E_SERVER_ERROR' }))
      }
    }
    return
  }
  let fp = req.url === '/' ? '/index.html' : req.url;
  fp = decodeURIComponent(fp.split('?')[0]);
  const p = resolve(__dirname, '.' + fp);
  if (!p.startsWith(__dirname)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Forbidden'); return }
  try {
    const c = readFileSync(p);
    const e = fp.split('.').pop();
    const cts = { html: 'text/html', css: 'text/css', js: 'application/javascript', json: 'application/json' };
    res.writeHead(200, { 'Content-Type': cts[e] || 'text/plain' });
    res.end(c)
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found') }
});
server.listen(PORT, () => {
  console.log(`
⦓ LATENT-K ⦔ License Server
  Local:   http://localhost:${PORT}
  API:     http://localhost:${PORT}/api/generate
  Press Ctrl+C to stop
`)
});