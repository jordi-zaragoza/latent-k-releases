import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

// Embedded key for context file obfuscation (32 bytes)
const EMBEDDED_KEY = Buffer.from('cLk9x2Qm7vR4pN8sW1bY6jH3fT5aE0uI', 'utf8')

// Encrypt content (always enabled)
export function encrypt(content) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, EMBEDDED_KEY, iv)

  const encrypted = Buffer.concat([
    cipher.update(content, 'utf8'),
    cipher.final()
  ])

  const authTag = cipher.getAuthTag()

  // Binary format: iv (16) + authTag (16) + encrypted
  const result = Buffer.concat([iv, authTag, encrypted])
  return result.toString('base64')
}

// Decrypt content
export function decrypt(content) {
  // Check if content is encrypted (base64 and starts with valid bytes)
  if (!content || content.startsWith('⦓') || content.startsWith('∑')) {
    return content // Plain text, not encrypted
  }

  try {
    const data = Buffer.from(content, 'base64')

    // Validate minimum length
    if (data.length < 33) return content // Too short to be encrypted

    const iv = data.subarray(0, 16)
    const authTag = data.subarray(16, 32)
    const encrypted = data.subarray(32)

    const decipher = crypto.createDecipheriv(ALGORITHM, EMBEDDED_KEY, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ])

    return decrypted.toString('utf8')
  } catch (e) {
    // If decryption fails, content might be plain text or corrupted
    // Check if it looks like valid LK content (starts with LK markers)
    if (content.includes('⦓') || content.includes('∑') || content.includes('⟦')) {
      return content // Likely plain text LK content
    }
    throw new Error(`Decryption failed: ${e.message}`)
  }
}

// Check if encryption is active (always true except DEV mode)
export function isEncryptionEnabled() {
  return true
}
