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

/**
 * Get a unique device identifier
 * Combines hostname, username, and other system info
 */
function getDeviceId() {
  const hostname = os.hostname()
  const username = os.userInfo().username
  const platform = os.platform()
  const arch = os.arch()

  // Combine system identifiers
  return `${hostname}:${username}:${platform}:${arch}:lk-v2`
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
  // Check if content is plain text (not encrypted)
  if (!content || content.startsWith('⦓') || content.startsWith('∑')) {
    return content // Plain text, not encrypted
  }

  try {
    const data = Buffer.from(content, 'base64')

    // Validate minimum length: iv (16) + authTag (16) + at least 1 byte
    if (data.length < 33) return content // Too short to be encrypted

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
  } catch (e) {
    // If decryption fails, content might be plain text or from another device
    // Check if it looks like valid LK content (starts with LK markers)
    if (content.includes('⦓') || content.includes('∑') || content.includes('⟦')) {
      return content // Likely plain text LK content
    }

    // Try legacy decryption with embedded key for backwards compatibility
    try {
      return decryptLegacy(content)
    } catch {
      throw new Error(`Decryption failed: ${e.message}`)
    }
  }
}

/**
 * Legacy decryption for backwards compatibility with v1 encrypted content
 * Uses the old embedded key approach
 */
function decryptLegacy(content) {
  const LEGACY_KEY = Buffer.from('cLk9x2Qm7vR4pN8sW1bY6jH3fT5aE0uI', 'utf8')

  const data = Buffer.from(content, 'base64')

  if (data.length < 33) {
    throw new Error('Content too short for legacy decryption')
  }

  const iv = data.subarray(0, 16)
  const authTag = data.subarray(16, 32)
  const encrypted = data.subarray(32)

  const decipher = crypto.createDecipheriv(ALGORITHM, LEGACY_KEY, iv)
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
