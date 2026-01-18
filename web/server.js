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
  monthly: 30,
  yearly: 365
}

// Admin credentials (change these!)
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS || 'latentk2024'

// Simple session tokens (in-memory)
const sessions = new Set()

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
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
    return
  }

  // API: Generate license
  if (req.method === 'POST' && req.url === '/api/generate') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const { email, name, plan } = JSON.parse(body)

        if (!email || !plan) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Email and plan are required' }))
          return
        }

        const days = PLAN_DAYS[plan] || 30
        const key = generateLicense({
          email,
          type: plan,
          durationDays: days
        })

        const data = parseLicense(key)

        // Save license to file
        const licenses = loadLicenses()
        licenses.push({
          key,
          email,
          name: name || '',
          plan,
          expires: data.expires,
          created: data.created,
          revoked: false
        })
        saveLicenses(licenses)

        console.log(`[LICENSE] Generated ${plan} license for ${email}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          key,
          email,
          plan,
          expires: data.expires,
          created: data.created
        }))
      } catch (err) {
        console.error('[ERROR]', err.message)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // API: Revoke license (protected)
  if (req.method === 'POST' && req.url === '/api/revoke') {
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
        const license = licenses.find(l => l.key === key)

        if (!license) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'License not found' }))
          return
        }

        license.revoked = true
        saveLicenses(licenses)

        console.log(`[LICENSE] Revoked license for ${license.email}`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, email: license.email }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  // API: Restore license (protected)
  if (req.method === 'POST' && req.url === '/api/restore') {
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
        const license = licenses.find(l => l.key === key)

        if (!license) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'License not found' }))
          return
        }

        license.revoked = false
        saveLicenses(licenses)

        console.log(`[LICENSE] Restored license for ${license.email}`)

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
