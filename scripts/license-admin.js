#!/usr/bin/env node

/**
 * License Administration Tool
 *
 * This script is for generating licenses and should NEVER be included in the distributed binary.
 * Keep it on your local machine or secure server only.
 *
 * Usage:
 *   node scripts/license-admin.js generate [--email user@example.com] [--type pro] [--days 365]
 *   node scripts/license-admin.js batch <count> [--email user@example.com] [--type pro] [--days 365]
 *   node scripts/license-admin.js keys (generate new key pair)
 *   node scripts/license-admin.js verify <license-key>
 */

import { createSign, createVerify, generateKeyPairSync, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const KEYS_DIR = join(homedir(), '.lk-keys')
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'private.pem')
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'public.pem')

// Generate RSA key pair
export function generateKeyPair() {
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 })
  }

  if (existsSync(PRIVATE_KEY_PATH)) {
    console.log('Keys already exist at:', KEYS_DIR)
    return {
      privateKey: readFileSync(PRIVATE_KEY_PATH, 'utf8'),
      publicKey: readFileSync(PUBLIC_KEY_PATH, 'utf8')
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 })
  writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 })

  console.log('Generated new key pair at:', KEYS_DIR)
  console.log('\nIMPORTANT: Keep private.pem safe! Never share it.')
  console.log('Copy public.pem content to src/lib/license-gen.js EMBEDDED_PUBLIC_KEY\n')

  return { privateKey, publicKey }
}

// Get private key (required for generation)
function getPrivateKey() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    throw new Error('No private key found. Run: node scripts/license-admin.js keys')
  }
  return readFileSync(PRIVATE_KEY_PATH, 'utf8')
}

// Get public key (for verification)
function getPublicKey() {
  if (!existsSync(PUBLIC_KEY_PATH)) {
    throw new Error('No public key found. Run: node scripts/license-admin.js keys')
  }
  return readFileSync(PUBLIC_KEY_PATH, 'utf8')
}

// Generate a license key
export function generateLicense(options = {}) {
  const privateKey = getPrivateKey()

  let expires = options.expires || null
  if (options.durationDays && !expires) {
    expires = Date.now() + options.durationDays * 24 * 60 * 60 * 1000
  }

  const data = {
    id: randomBytes(8).toString('hex'),
    type: options.type || 'standard',
    email: options.email || '',
    created: Date.now(),
    expires
  }

  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')

  const sign = createSign('SHA256')
  sign.update(payload)
  const signature = sign.sign(privateKey, 'base64url')

  return `LK-${payload}.${signature}`
}

// Validate a license key
export function validateLicenseOffline(key) {
  try {
    if (!key || !key.startsWith('LK-')) {
      return { valid: false, error: 'Invalid format' }
    }

    const parts = key.slice(3).split('.')
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid format' }
    }

    const [payload, signature] = parts

    const publicKey = getPublicKey()
    const verify = createVerify('SHA256')
    verify.update(payload)

    if (!verify.verify(publicKey, signature, 'base64url')) {
      return { valid: false, error: 'Invalid signature' }
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())

    if (data.expires && Date.now() > data.expires) {
      return { valid: false, error: 'License expired', data }
    }

    return { valid: true, data }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

// Parse license data without validation
export function parseLicense(key) {
  try {
    if (!key || !key.startsWith('LK-')) return null
    const payload = key.slice(3).split('.')[0]
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
}

// Generate multiple licenses
export function generateBatch(count, options = {}) {
  const licenses = []
  for (let i = 0; i < count; i++) {
    licenses.push(generateLicense({
      email: options.email,
      type: options.type,
      durationDays: options.durationDays,
      expires: options.expires
    }))
  }
  return licenses
}

// CLI
function parseArgs(args) {
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) opts.email = args[++i]
    else if (args[i] === '--type' && args[i + 1]) opts.type = args[++i]
    else if (args[i] === '--days' && args[i + 1]) opts.durationDays = parseInt(args[++i], 10)
  }
  return opts
}

function cli() {
  const [,, command, ...args] = process.argv

  switch (command) {
    case 'keys':
      generateKeyPair()
      break

    case 'generate': {
      const opts = parseArgs(args)
      const license = generateLicense(opts)
      console.log('\nGenerated license:')
      console.log(license)
      console.log('\nLicense data:')
      console.log(parseLicense(license))
      break
    }

    case 'batch': {
      const count = parseInt(args[0], 10) || 1
      const opts = parseArgs(args.slice(1))
      const licenses = generateBatch(count, opts)
      console.log(`\nGenerated ${count} licenses:\n`)
      licenses.forEach((l, i) => {
        console.log(`${i + 1}. ${l}`)
      })
      break
    }

    case 'verify': {
      const key = args[0]
      if (!key) {
        console.error('Usage: license-admin.js verify <license-key>')
        process.exit(1)
      }
      const result = validateLicenseOffline(key)
      console.log('\nValidation result:')
      console.log(result)
      break
    }

    default:
      console.log(`
License Administration Tool

Usage:
  node scripts/license-admin.js keys                    Generate RSA key pair
  node scripts/license-admin.js generate [options]      Generate a license
  node scripts/license-admin.js batch <count> [options] Generate multiple licenses
  node scripts/license-admin.js verify <key>            Verify a license

Options:
  --email <email>   Set license email
  --type <type>     Set license type (standard, pro, etc.)
  --days <days>     Set expiration in days from now
`)
  }
}

// Run CLI if executed directly
if (process.argv[1]?.includes('license-admin')) {
  cli()
}
