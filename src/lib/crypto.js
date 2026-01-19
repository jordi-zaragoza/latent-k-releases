import crypto from 'crypto'
import os from 'os'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const SALT_LENGTH = 16
const KEY_LENGTH = 32
const PBKDF2_ITERATIONS = 100000

// Cache derived key to avoid re-computation
let cachedKey = null
let cachedKeyId = null

/**
 * Derive a device-specific encryption key using PBKDF2
 * Key is derived from hostname + username + machine-specific data
 */
function deriveKey() {
  const keyId = getDeviceId()

  // Return cached key if same device
  if (cachedKey && cachedKeyId === keyId) {
    return cachedKey
  }

  // Use a fixed salt derived from the key ID for deterministic key derivation
  // This allows decryption on the same device
  const salt = crypto.createHash('sha256').update(keyId + '-lk-salt-v2').digest().subarray(0, SALT_LENGTH)

  cachedKey = crypto.pbkdf2Sync(keyId, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
  cachedKeyId = keyId

  return cachedKey
}

// Secret salt - makes device ID unguessable even if system info is known
const SECRET_SALT = '_Ic6PUYl3e6umu78QPZE-njsKjIYfQ4W6ihmjKDw_ky_bv9QSD5XwK8PYxDZBaRl'

/**
 * Get a unique device identifier
 * Combines hostname, username, system info and secret salt
 */
function getDeviceId() {
  const hostname = os.hostname()
  const username = os.userInfo().username
  const platform = os.platform()
  const arch = os.arch()

  // Hash with secret salt - cannot be reversed without knowing the salt
  const base = `${hostname}:${username}:${platform}:${arch}:${SECRET_SALT}`
  return crypto.createHash('sha256').update(base).digest('hex')
}

/**
 * Encrypt content using device-specific key derivation
 * Format: salt (16) + iv (16) + authTag (16) + encrypted
 */
export function encrypt(content) {
  const key = deriveKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(content, 'utf8'),
    cipher.final()
  ])

  const authTag = cipher.getAuthTag()

  // Binary format: iv (16) + authTag (16) + encrypted
  const result = Buffer.concat([iv, authTag, encrypted])
  return result.toString('base64')
}

/**
 * Decrypt content using device-specific key derivation
 */
export function decrypt(content) {
  if (!content) {
    throw new Error('No content to decrypt')
  }

  const data = Buffer.from(content, 'base64')

  if (data.length < 33) {
    throw new Error('Invalid encrypted content')
  }

  const iv = data.subarray(0, 16)
  const authTag = data.subarray(16, 32)
  const encrypted = data.subarray(32)

  const key = deriveKey()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ])

  return decrypted.toString('utf8')
}

/**
 * Check if encryption is active (always true)
 */
export function isEncryptionEnabled() {
  return true
}

/**
 * Get the current device ID (for debugging/info)
 */
export function getDeviceIdentifier() {
  return getDeviceId()
}

/**
 * Clear the cached key (useful for testing)
 */
export function clearKeyCache() {
  cachedKey = null
  cachedKeyId = null
}
