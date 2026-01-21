#!/usr/bin/env node
/**
 * Local License Server
 * Serves the activation page and generates real licenses
 */
import { createServer } from 'http'
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'
import { generateLicense, parseLicense } from '../scripts/license-admin.js'
const __dirname = dirname(fileURLToPath(import.meta.url))
/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const lenA = a.length
  const lenB = b.length
  // Compare against self to maintain constant time on length mismatch
  const compareB = lenA === lenB ? b : a
  let result = lenA === lenB ? 0 : 1
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ compareB.charCodeAt(i)
  }
  return result === 0
}
const PORT = process.env.PORT || 3000
const LICENSES_FILE = join(__dirname, 'licenses.json')
const PLAN_DAYS = {
  trial1: 1,
  trial7: 7,
  trial14: 14,
  monthly: 30,
  yearly: 365
}
// Admin credentials - MUST be set via environment variables
const ADMIN_USER = process.env.ADMIN_USER
const ADMIN_PASS = process.env.ADMIN_PASS
// Worker token for programmatic access from Cloudflare Worker (optional)
const WORKER_TOKEN = process.env.WORKER_TOKEN
// Load Gemini API key from lk_viewer/.env if not set
function loadGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  const envPath = join(__dirname, '..', 'lk_viewer', '.env')
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8')
    const match = content.match(/GEMINI_API_KEY=(.+)/)
    if (match) return match[1].trim()
  }
  return null
}
const GEMINI_API_KEY = loadGeminiKey()
if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('ERROR: ADMIN_USER and ADMIN_PASS environment variables are required')
  console.error('Example: ADMIN_USER=admin ADMIN_PASS=your-secure-password node web/server.js')
  process.exit(1)
}
// Session tokens (persisted to file) with expiration
const SESSIONS_FILE = join(__dirname, '.sessions.json')
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours
// Rate limiting configuration
const RATE_LIMIT = {
  login: { maxAttempts: 5, windowSeconds: 300 },    // 5 attempts per 5 minutes
  trial: { maxAttempts: 3, windowSeconds: 3600 }    // 3 attempts per hour
}
// In-memory rate limiting store
const rateLimitStore = new Map()
/**
 * Check rate limit for an action
 * @param {string} action - 'login' or 'trial'
 * @param {string} identifier - IP address or other identifier
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
function checkRateLimit(action, identifier) {
  const config = RATE_LIMIT[action]
  if (!config) return { allowed: true, remaining: 999, resetIn: 0 }
  const key = `${action}:${identifier}`
  const now = Math.floor(Date.now() / 1000)
  let record = rateLimitStore.get(key) || { count: 0, windowStart: now }
  // Reset window if expired
  if (now - record.windowStart >= config.windowSeconds) {
    record = { count: 0, windowStart: now }
  }
  const remaining = Math.max(0, config.maxAttempts - record.count)
  const resetIn = config.windowSeconds - (now - record.windowStart)
  if (record.count >= config.maxAttempts) {
    return { allowed: false, remaining: 0, resetIn }
  }
  // Increment counter
  record.count++
  rateLimitStore.set(key, record)
  // Clean old entries periodically (every 100 entries)
  if (rateLimitStore.size > 100) {
    for (const [k, v] of rateLimitStore) {
      const a = k.split(':')[0]
      const c = RATE_LIMIT[a]
      if (c && now - v.windowStart >= c.windowSeconds * 2) {
        rateLimitStore.delete(k)
      }
    }
  }
  return { allowed: true, remaining: remaining - 1, resetIn }
}
/**
 * Get client IP from request
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket?.remoteAddress ||
         'unknown'
}
function loadSessions() {
  if (existsSync(SESSIONS_FILE)) {
    try {
      const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'))
      // Handle both old format (array of tokens) and new format (object with expiry)
      if (Array.isArray(data)) {
        // Migrate old format: convert to new format with current timestamp
        const now = Date.now()
        const migrated = new Map(data.map(token => [token, now]))
        return migrated
      }
      return new Map(Object.entries(data))
    } catch {
      return new Map()
    }
  }
  return new Map()
}
function saveSessions(sessions) {
  writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions)))
}
function cleanExpiredSessions(sessions) {
  const now = Date.now()
  let cleaned = false
  for (const [token, createdAt] of sessions) {
    if (now - createdAt > SESSION_MAX_AGE_MS) {
      sessions.delete(token)
      cleaned = true
    }
  }
  if (cleaned) {
    saveSessions(sessions)
  }
}
function isSessionValid(sessions, token) {
  if (!sessions.has(token)) return false
  const createdAt = sessions.get(token)
  if (Date.now() - createdAt > SESSION_MAX_AGE_MS) {
    sessions.delete(token)
    saveSessions(sessions)
    return false
  }
  return true
}
const sessions = loadSessions()
// Clean expired sessions on startup
cleanExpiredSessions(sessions)
// Load existing licenses or create empty array
function loadLicenses() {
  if (existsSync(LICENSES_FILE)) {
    return JSON.parse(readFileSync(LICENSES_FILE, 'utf8'))
  }
  return []
}
// Save licenses to file
function saveLicenses(licenses) {
  writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2))
}
// Maximum request body size (16KB - sufficient for license operations)
const MAX_BODY_SIZE = 16 * 1024
/**
 * Read request body with size limit
 * @returns {Promise<string>} Body content
 * @throws {Error} If body exceeds MAX_BODY_SIZE
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        req.destroy()
        reject(new Error('BODY_TOO_LARGE'))
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}
// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://latent-k.dev',
  'https://www.latent-k.dev',
  'https://latent-k.pages.dev',
  'http://localhost:3000' // For local development
]
const server = createServer(async (req, res) => {
  // CORS headers - restrict to allowed origins
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  // Helper to check auth
  function isAuthenticated() {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) return false
    return isSessionValid(sessions, auth.slice(7))
  }
  // API: Login
  if (req.method === 'POST' && req.url === '/api/login') {
    const clientIP = getClientIP(req)
    const rateLimit = checkRateLimit('login', clientIP)
    if (!rateLimit.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: 'Too many login attempts. Please try again later.',
        retryAfter: rateLimit.resetIn
      }))
      return
    }
    try {
      const body = await readBody(req)
      const { username, password } = JSON.parse(body)
      if (timingSafeEqual(username, ADMIN_USER) && timingSafeEqual(password, ADMIN_PASS)) {
        const token = randomBytes(32).toString('hex')
        sessions.set(token, Date.now())
        saveSessions(sessions)
        console.log(`[AUTH] Admin logged in`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ token }))
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid credentials' }))
      }
    } catch (err) {
      if (err.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid request' }))
      }
    }
    return
  }
  // API: Logout
  if (req.method === 'POST' && req.url === '/api/logout') {
    const auth = req.headers.authorization
    if (auth && auth.startsWith('Bearer ')) {
      sessions.delete(auth.slice(7))
      saveSessions(sessions)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    return
  }
  // API: Request trial (public - one per email)
  if (req.method === 'POST' && req.url === '/api/trial') {
    const clientIP = getClientIP(req)
    const rateLimit = checkRateLimit('trial', clientIP)
    if (!rateLimit.allowed) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: 'Too many trial requests. Please try again later.',
        retryAfter: rateLimit.resetIn
      }))
      return
    }
    try {
      const body = await readBody(req)
      const { email, name } = JSON.parse(body)
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Email is required' }))
        return
      }
      const normalizedEmail = email.toLowerCase().trim()
      const licenses = loadLicenses()
      // Check if this email already has a paid license
      const now = Date.now()
      const existingPaid = licenses.find(l =>
        l.email.toLowerCase().trim() === normalizedEmail &&
        (l.plan === 'monthly' || l.plan === 'yearly')
      )
      if (existingPaid) {
        const isActive = existingPaid.expires && new Date(existingPaid.expires).getTime() > now
        if (isActive) {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: 'You already have an active license for this email.'
          }))
        } else {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            error: 'Trial not available for existing customers. Renew at: https://latent-k.dev'
          }))
        }
        return
      }
      // Check if this email already has a trial
      const existingTrial = licenses.find(l =>
        l.email.toLowerCase().trim() === normalizedEmail &&
        l.plan === 'trial14'
      )
      if (existingTrial) {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          error: 'Trial already used for this email.'
        }))
        return
      }
      const durationDays = PLAN_DAYS.trial14
      const key = generateLicense({ email: normalizedEmail, durationDays, type: 'trial' })
      const data = parseLicense(key)
      licenses.push({
        key,
        email: normalizedEmail,
        name: name || '',
        plan: 'trial14',
        created: new Date().toISOString(),
        expires: data.expires ? new Date(data.expires).toISOString() : null
      })
      saveLicenses(licenses)
      console.log(`[TRIAL] Generated 14-day trial for ${normalizedEmail}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        key,
        email: normalizedEmail,
        expires: data.expires ? new Date(data.expires).toISOString() : null,
        daysLeft: durationDays
      }))
    } catch (err) {
      if (err.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      } else {
        console.error('[TRIAL] Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    }
    return
  }
  // API: Generate license (protected - admin or worker token)
  if (req.method === 'POST' && req.url === '/api/generate') {
    // Check for worker token OR session authentication
    const auth = req.headers.authorization
    const bearerToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    // Use timing-safe comparison for worker token
    const isWorkerAuth = WORKER_TOKEN && bearerToken && timingSafeEqual(bearerToken, WORKER_TOKEN)
    const isSessionAuth = isAuthenticated()
    if (!isWorkerAuth && !isSessionAuth) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    try {
      const body = await readBody(req)
      const { email, name, plan } = JSON.parse(body)
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Email is required' }))
        return
      }
      const normalizedEmail = email.toLowerCase().trim()
      const licenses = loadLicenses()
      const durationDays = PLAN_DAYS[plan] || 365
      const durationMs = durationDays * 24 * 60 * 60 * 1000
      // Find existing active license for this email (non-trial, not expired)
      const now = Date.now()
      const existingLicense = licenses.find(l =>
        l.email.toLowerCase().trim() === normalizedEmail &&
        !l.plan.startsWith('trial') &&
        l.expires &&
        new Date(l.expires).getTime() > now
      )
      // Calculate expiration: extend from current expiry or start from now
      let expires
      if (existingLicense) {
        const currentExpiry = new Date(existingLicense.expires).getTime()
        expires = currentExpiry + durationMs
        console.log(`[LICENSE] Extending license for ${normalizedEmail} from ${existingLicense.expires}`)
      } else {
        expires = now + durationMs
      }
      const key = generateLicense({ email: normalizedEmail, expires })
      const data = parseLicense(key)
      licenses.push({
        key,
        email: normalizedEmail,
        name: name || '',
        plan: plan || 'yearly',
        created: new Date().toISOString(),
        expires: data.expires ? new Date(data.expires).toISOString() : null,
        extended: !!existingLicense
      })
      saveLicenses(licenses)
      const source = isWorkerAuth ? 'worker' : 'admin'
      console.log(`[LICENSE] Generated license for ${normalizedEmail} (${plan || 'yearly'}) via ${source}, expires ${new Date(expires).toISOString()}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        key,
        data,
        extended: existingLicense ? true : false,
        previousExpiry: existingLicense ? existingLicense.expires : null
      }))
    } catch (err) {
      if (err.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      } else {
        console.error('[LICENSE] Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    }
    return
  }
  // API: Delete license (protected)
  if (req.method === 'POST' && req.url === '/api/delete') {
    if (!isAuthenticated()) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    try {
      const body = await readBody(req)
      const { key } = JSON.parse(body)
      const licenses = loadLicenses()
      const index = licenses.findIndex(l => l.key === key)
      if (index === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'License not found' }))
        return
      }
      const license = licenses[index]
      licenses.splice(index, 1)
      saveLicenses(licenses)
      console.log(`[LICENSE] Deleted license for ${license.email}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, email: license.email }))
    } catch (err) {
      if (err.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    }
    return
  }
  // API: List all licenses (protected)
  if (req.method === 'GET' && req.url === '/api/licenses') {
    if (!isAuthenticated()) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    const licenses = loadLicenses()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(licenses))
    return
  }
  // API: Chatbot (public - uses Gemini API)
  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const body = await readBody(req)
      const { message } = JSON.parse(body)
      if (!message || typeof message !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Message is required' }))
        return
      }
      if (!GEMINI_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Chatbot not configured' }))
        return
      }
      const systemPrompt = `You are the LATENT-K assistant, a helpful chatbot on the LATENT-K website.
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
Use bullet points for lists. Never invent features that don't exist.`
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: message }] }],
            generationConfig: {
              maxOutputTokens: 512,
              temperature: 0.7
            }
          })
        }
      )
      if (!geminiRes.ok) {
        const errText = await geminiRes.text()
        console.error('[CHAT] Gemini API error:', errText)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'AI service error' }))
        return
      }
      const geminiData = await geminiRes.json()
      const reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ reply }))
    } catch (err) {
      if (err.message === 'BODY_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Message too large' }))
      } else {
        console.error('[CHAT] Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal error' }))
      }
    }
    return
  }
  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url
  // Remove query strings and decode URI
  filePath = decodeURIComponent(filePath.split('?')[0])
  // Resolve to absolute path and verify it's within __dirname (prevent path traversal)
  const fullPath = resolve(__dirname, '.' + filePath)
  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    res.end('Forbidden')
    return
  }
  try {
    const content = readFileSync(fullPath)
    const ext = filePath.split('.').pop()
    const contentTypes = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json'
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' })
    res.end(content)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
})
server.listen(PORT, () => {
  console.log(`
⦓ LATENT-K ⦔ License Server
  Local:   http://localhost:${PORT}
  API:     http://localhost:${PORT}/api/generate
  Press Ctrl+C to stop
`)
})