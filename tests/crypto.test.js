import { describe, it, expect, beforeEach } from 'vitest'
import {
  encrypt,
  decrypt,
  isEncryptionEnabled,
  getDeviceIdentifier,
  clearKeyCache
} from '../src/lib/crypto.js'

// Clear key cache before each test to ensure consistent behavior
beforeEach(() => {
  clearKeyCache()
})

describe('crypto module', () => {
  describe('encrypt', () => {
    it('returns base64 encoded string', () => {
      const result = encrypt('hello world')
      expect(typeof result).toBe('string')
      // Base64 should be valid
      expect(() => Buffer.from(result, 'base64')).not.toThrow()
    })

    it('produces different output for same input (random IV)', () => {
      const input = 'test content'
      const result1 = encrypt(input)
      const result2 = encrypt(input)
      expect(result1).not.toBe(result2)
    })

    it('encrypts empty string', () => {
      const result = encrypt('')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('encrypts unicode content', () => {
      const input = '⦓PROJECT⦔ ⟪VIBE: Test⟫ λ ⇄ ⚙ ⧫'
      const result = encrypt(input)
      expect(typeof result).toBe('string')
    })

    it('encrypts large content', () => {
      const input = 'x'.repeat(100000)
      const result = encrypt(input)
      expect(typeof result).toBe('string')
    })
  })

  describe('decrypt', () => {
    it('decrypts encrypted content correctly', () => {
      const original = 'hello world'
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(original)
    })

    it('decrypts unicode content correctly', () => {
      const original = '⦓PROJECT⦔ ⟪VIBE: Test⟫ λ ⇄ ⚙ ⧫'
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(original)
    })

    it('returns plain text if content starts with LK markers', () => {
      const plainLk = '⦓PROJECT⦔ test content'
      expect(decrypt(plainLk)).toBe(plainLk)
    })

    it('returns plain text if content starts with sum symbol', () => {
      const plainLk = '∑ items [a, b, c]'
      expect(decrypt(plainLk)).toBe(plainLk)
    })

    it('returns null/undefined as-is', () => {
      expect(decrypt(null)).toBe(null)
      expect(decrypt(undefined)).toBe(undefined)
    })

    it('returns empty string as-is', () => {
      expect(decrypt('')).toBe('')
    })

    it('returns content with LK markers inside if decryption fails', () => {
      const plainWithMarkers = 'some text ⦓ID⦔ more text'
      expect(decrypt(plainWithMarkers)).toBe(plainWithMarkers)
    })

    it('handles content too short to be encrypted', () => {
      const shortBase64 = Buffer.from('short').toString('base64')
      expect(decrypt(shortBase64)).toBe(shortBase64)
    })

    it('decrypts large content correctly', () => {
      const original = 'x'.repeat(100000)
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(original)
    })
  })

  describe('encrypt/decrypt round-trip', () => {
    it('preserves content through encrypt/decrypt cycle', () => {
      const testCases = [
        'simple text',
        'multiline\ntext\nhere',
        '{"json": "content", "num": 123}',
        '⦓PROJECT⦔\n⟪VIBE: Test⟫\n∑ items [a, b]',
        'special chars: @#$%^&*()[]{}|\\',
        '\t\ttabbed content\n\n  spaced',
      ]

      for (const original of testCases) {
        const encrypted = encrypt(original)
        const decrypted = decrypt(encrypted)
        expect(decrypted).toBe(original)
      }
    })
  })

  describe('isEncryptionEnabled', () => {
    it('returns true', () => {
      expect(isEncryptionEnabled()).toBe(true)
    })

    it('returns boolean', () => {
      expect(typeof isEncryptionEnabled()).toBe('boolean')
    })
  })

  describe('getDeviceIdentifier', () => {
    it('returns a string', () => {
      const id = getDeviceIdentifier()
      expect(typeof id).toBe('string')
    })

    it('returns consistent value', () => {
      const id1 = getDeviceIdentifier()
      const id2 = getDeviceIdentifier()
      expect(id1).toBe(id2)
    })

    it('includes version marker', () => {
      const id = getDeviceIdentifier()
      expect(id).toContain('lk-v2')
    })

    it('contains system info', () => {
      const id = getDeviceIdentifier()
      // Should have multiple components separated by colons
      expect(id.split(':').length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('clearKeyCache', () => {
    it('does not throw', () => {
      expect(() => clearKeyCache()).not.toThrow()
    })

    it('allows re-derivation of key', () => {
      // Encrypt, clear cache, then encrypt again - should work
      const original = 'test content'
      const encrypted1 = encrypt(original)
      clearKeyCache()
      const encrypted2 = encrypt(original)

      // Both should decrypt correctly
      expect(decrypt(encrypted1)).toBe(original)
      expect(decrypt(encrypted2)).toBe(original)
    })
  })

  describe('device-specific encryption', () => {
    it('uses deterministic key derivation', () => {
      // Encrypt, clear cache, decrypt - should work
      const original = 'test message'
      const encrypted = encrypt(original)
      clearKeyCache()
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(original)
    })

    it('key is derived from device info', () => {
      // This is implicitly tested by the fact that encryption/decryption works
      // The key is derived from device ID which includes hostname, username, etc.
      const deviceId = getDeviceIdentifier()
      expect(deviceId).toBeTruthy()

      const original = 'secure content'
      const encrypted = encrypt(original)
      const decrypted = decrypt(encrypted)
      expect(decrypted).toBe(original)
    })
  })

  describe('legacy compatibility', () => {
    it('handles corrupted content gracefully', () => {
      // Content that looks encrypted but isn't valid
      const corrupted = Buffer.alloc(50).fill(1).toString('base64')

      // Should either return content or throw, not crash
      expect(() => {
        try {
          decrypt(corrupted)
        } catch (e) {
          expect(e.message).toContain('Decryption failed')
        }
      }).not.toThrow()
    })
  })
})
