#!/usr/bin/env node

/**
 * Local License Server
 * Serves the activation page and generates real licenses
 */

import { createServer } from 'http'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { generateLicense, parseLicense } from '../scripts/license-admin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const LICENSES_FILE = join(__dirname, 'licenses.json')

const PLAN_DAYS = {
  trial1: 1,
  trial7: 7,
  trial14: 14,
  monthly: 30,
  yearly: 365
}

// Admin credentials (change these!)
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS || 'latentk2024'

// Session tokens (persisted to file)
const SESSIONS_FILE = join(__dirname, '.sessions.json')

function loadSessions() {
  if (existsSync(SESSIONS_FILE)) {
    return new Set(JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')))
  }
  return new Set()
}

function saveSessions(sessions) {
  writeFileSync(SESSIONS_FILE, JSON.stringify([...sessions]))
}

const sessions = loadSessions()

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

const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Helper to check auth
  function isAuthenticated() {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) return false
    return sessions.has(auth.slice(7))
  }

  // API: Login
  if (req.method === 'POST' && req.url === '/api/login') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body)

        if (username === ADMIN_USER && password === ADMIN_PASS) {
          const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
          sessions.add(token)
          saveSessions(sessions)
          console.log(`[AUTH] Admin logged in`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ token }))
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid credentials' }))
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid request' }))
      }
    })
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
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
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
            // Show existing active license
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              error: 'You already have an active license',
              existingKey: existingPaid.key
            }))
          } else {
            // Expired paid license - no trial allowed
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
            error: 'Trial already used for this email',
            existingKey: existingTrial.key
          }))
          return
        }

        const durationDays = PLAN_DAYS.trial14
        const key = generateLicense({ email: normalizedEmail, durationDays })
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
        console.error('[TRIAL] Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // API: Generate license (protected - admin only)
  if (req.method === 'POST' && req.url === '/api/generate') {
    if (!isAuthenticated()) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
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

        console.log(`[LICENSE] Generated license for ${normalizedEmail} (${plan || 'yearly'}) expires ${new Date(expires).toISOString()}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          key,
          data,
          extended: existingLicense ? true : false,
          previousExpiry: existingLicense ? existingLicense.expires : null
        }))
      } catch (err) {
        console.error('[LICENSE] Error:', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // API: Delete license (protected)
  if (req.method === 'POST' && req.url === '/api/delete') {
    if (!isAuthenticated()) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
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
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
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

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url
  const fullPath = join(__dirname, filePath)

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
