import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { generateLicense, validateLicenseOffline, parseLicense, generateBatch } from '../src/lib/license-gen.js'

const PRIVATE_KEY_PATH = join(homedir(), '.lk-keys', 'private.pem')
const hasPrivateKey = existsSync(PRIVATE_KEY_PATH)

describe.skipIf(!hasPrivateKey)('license-gen', () => {
  describe('generateLicense', () => {
    it('should generate a valid license key', () => {
      const license = generateLicense()
      expect(license).toMatch(/^LK-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    })

    it('should include email in license data', () => {
      const license = generateLicense({ email: 'test@example.com' })
      const data = parseLicense(license)
      expect(data.email).toBe('test@example.com')
    })

    it('should include type in license data', () => {
      const license = generateLicense({ type: 'pro' })
      const data = parseLicense(license)
      expect(data.type).toBe('pro')
    })
  })

  describe('validateLicenseOffline', () => {
    it('should validate a valid license', () => {
      const license = generateLicense()
      const result = validateLicenseOffline(license)
      expect(result.valid).toBe(true)
    })

    it('should reject invalid format', () => {
      const result = validateLicenseOffline('invalid-key')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid format')
    })

    it('should reject tampered license', () => {
      const license = generateLicense()
      const tampered = license.slice(0, -5) + 'XXXXX'
      const result = validateLicenseOffline(tampered)
      expect(result.valid).toBe(false)
    })

    it('should reject expired license', () => {
      const license = generateLicense({ expires: Date.now() - 1000 })
      const result = validateLicenseOffline(license)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('License expired')
    })
  })

  describe('parseLicense', () => {
    it('should parse license data', () => {
      const license = generateLicense({ email: 'user@test.com', type: 'standard' })
      const data = parseLicense(license)
      expect(data).toHaveProperty('id')
      expect(data).toHaveProperty('email', 'user@test.com')
      expect(data).toHaveProperty('type', 'standard')
      expect(data).toHaveProperty('created')
    })

    it('should return null for invalid license', () => {
      expect(parseLicense('invalid')).toBeNull()
      expect(parseLicense(null)).toBeNull()
    })
  })

  describe('generateBatch', () => {
    it('should generate multiple unique licenses', () => {
      const licenses = generateBatch(5)
      expect(licenses).toHaveLength(5)
      const unique = new Set(licenses)
      expect(unique.size).toBe(5)
    })

    it('should apply options to all licenses', () => {
      const licenses = generateBatch(3, { type: 'pro' })
      for (const license of licenses) {
        const data = parseLicense(license)
        expect(data.type).toBe('pro')
      }
    })
  })
})
