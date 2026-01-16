import { createSign, createVerify, generateKeyPairSync, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const KEYS_DIR = join(homedir(), '.lk-keys')
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'private.pem')
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'public.pem')

// Public key embedded in binary (for validation)
const EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx9GbsLiv2hshCLjPSyaS
9cwh6MWlw9ck916siSPg4rFn+OaExxZXLHGAnaCeq/payXYFDrYOLm94RIgg0Re0
X+NPkWcDK5c3EG42kboRYLS5/uyyQ1kbHcapCqxQ0s4gxhLgiFQNCjLUjNjnl5Yi
Uo9hbrXdZEvFCmwVTigW7o2Mrk5jJLdUn85r/V73mNZ1Lz11muHaDeZRiw4F8v1c
5qXjcdxr8kixAB6Kqd6sP9oXPoRkbfgswpihFzv2XCrBZm+z/9K4NBMFXx/R/y24
R19BlU2aIqUKz1ubdrCxlTLNBiVuXRYLAYoTi+Vb7mOheYHgszddgIFxk8AutXD0
KQIDAQAB
-----END PUBLIC KEY-----`

// Generate RSA key pair (run once, keep private key safe!)
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
  console.log('Copy public.pem content to license.js EMBEDDED_PUBLIC_KEY\n')

  return { privateKey, publicKey }
}

// Get keys (for generation - requires private key)
function getPrivateKey() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    throw new Error('No private key found. Run: lk generate-keys')
  }
  return readFileSync(PRIVATE_KEY_PATH, 'utf8')
}

// Get public key (for validation - uses embedded or file)
export function getPublicKey() {
  // First try embedded key (production)
  if (!EMBEDDED_PUBLIC_KEY.includes('REPLACE_WITH_PUBLIC_KEY')) {
    return EMBEDDED_PUBLIC_KEY
  }
  // Fall back to file (development)
  if (existsSync(PUBLIC_KEY_PATH)) {
    return readFileSync(PUBLIC_KEY_PATH, 'utf8')
  }
  throw new Error('No public key available')
}

// Generate a license key
export function generateLicense(options = {}) {
  const privateKey = getPrivateKey()

  // Calculate expiration from durationDays if provided
  let expires = options.expires || null
  if (options.durationDays && !expires) {
    expires = Date.now() + options.durationDays * 24 * 60 * 60 * 1000
  }

  const data = {
    id: randomBytes(8).toString('hex'),
    type: options.type || 'standard',
    email: options.email || '',
    created: Date.now(),
    expires // null = never expires
  }

  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')

  const sign = createSign('SHA256')
  sign.update(payload)
  const signature = sign.sign(privateKey, 'base64url')

  // Format: LK-{payload}.{signature}
  return `LK-${payload}.${signature}`
}

// Validate a license key (offline, uses public key)
export function validateLicenseOffline(key) {
  try {
    if (!key || !key.startsWith('LK-')) {
      return { valid: false, error: 'Invalid format' }
    }

    const parts = key.slice(4).split('.')
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid format' }
    }

    const [payload, signature] = parts

    // Verify signature
    const publicKey = getPublicKey()
    const verify = createVerify('SHA256')
    verify.update(payload)

    if (!verify.verify(publicKey, signature, 'base64url')) {
      return { valid: false, error: 'Invalid signature' }
    }

    // Decode and check expiration
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())

    if (data.expires && Date.now() > data.expires) {
      return { valid: false, error: 'License expired', data }
    }

    return { valid: true, data }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

// Parse license to see its data (without full validation)
export function parseLicense(key) {
  try {
    if (!key || !key.startsWith('LK-')) return null
    const payload = key.slice(4).split('.')[0]
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
