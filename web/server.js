#!/usr/bin/env node

/**
 * Local License Server
 * Serves the activation page and generates real licenses
 */

import { createServer } from 'http'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { generateLicense, parseLicense } from '../scripts/license-admin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000

const PLAN_DAYS = {
  monthly: 30,
  yearly: 365
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
