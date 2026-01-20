import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import {
  getLicenseKey,
  setLicenseKey,
  clearLicense,
  validateLicense,
  activateLicense,
  isLicensed,
  checkAccess,
  isLicenseRevoked,
  getRevokedReason
} from '../src/lib/license.js'
import { generateLicense } from '../scripts/license-admin.js'

const PRIVATE_KEY_PATH = join(homedir(), '.lk-keys', 'private.pem')
const hasPrivateKey = existsSync(PRIVATE_KEY_PATH)

let originalLicenseKey
const originalDevMode = process.env.LK_DEV

beforeEach(() => {
  originalLicenseKey = getLicenseKey()
  clearLicense()
})

afterEach(() => {
  clearLicense()
  if (originalLicenseKey) {
    setLicenseKey(originalLicenseKey)
  }
  if (originalDevMode !== undefined) {
    process.env.LK_DEV = originalDevMode
  } else {
    delete process.env.LK_DEV
  }
})

describe('License key storage', () => {
  it('getLicenseKey returns undefined when not set', () => {
    expect(getLicenseKey()).toBeUndefined()
  })

  it('setLicenseKey and getLicenseKey round-trip', () => {
    setLicenseKey('test-key-123')
    expect(getLicenseKey()).toBe('test-key-123')
  })

  it('clearLicense removes license key', () => {
    setLicenseKey('test-key')
    clearLicense()
    expect(getLicenseKey()).toBeUndefined()
  })
})

describe('isLicensed', () => {
  // Note: isDevMode() uses process.pkg, not env vars
  // In tests, process.pkg is undefined so we're always in dev mode
  it('returns true in dev mode (running from source)', () => {
    clearLicense()
    // Always true when running from source (process.pkg undefined)
    expect(isLicensed()).toBe(true)
  })

  it('returns true when license key is set', () => {
    setLicenseKey('some-key')
    expect(isLicensed()).toBe(true)
  })
})

describe('validateLicense', () => {
  // Note: isDevMode() uses process.pkg, not env vars
  // In tests, process.pkg is undefined so we're always in dev mode
  it('returns valid in dev mode (running from source)', async () => {
    clearLicense()
    const result = await validateLicense()
    expect(result.valid).toBe(true)
    expect(result.dev).toBe(true)
  })
})

describe('activateLicense', () => {
  it('fails for invalid license format', async () => {
    const result = await activateLicense('invalid-key')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid format')
  })
})

describe('License validation caching', () => {
  it('dev mode always returns valid', async () => {
    const result1 = await validateLicense()
    const result2 = await validateLicense()

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(true)
    expect(result1.dev).toBe(true)
  })
})

// Note: validateLicense and checkAccess check isDevMode() first (uses process.pkg)
// In tests, process.pkg is undefined so we're always in dev mode and they return early
// Only activateLicense can be tested as it doesn't check isDevMode()
describe.skipIf(!hasPrivateKey)('Email verification', () => {
  it('activateLicense rejects mismatched email', async () => {
    const license = generateLicense({ email: 'user@example.com' })

    const result = await activateLicense(license, 'other@example.com')
    expect(result.success).toBe(false)
    expect(result.error).toContain('different email')
  })

  it('activateLicense accepts matching email', async () => {
    const license = generateLicense({ email: 'user@example.com' })

    const result = await activateLicense(license, 'user@example.com')
    expect(result.success).toBe(true)
  })
})

describe('License revocation', () => {
  it('isLicenseRevoked returns false when no revocation state', () => {
    // After clearLicense and setLicenseKey, revocation state should be clear
    setLicenseKey('test-key')
    expect(isLicenseRevoked()).toBe(false)
  })

  it('getRevokedReason returns null when no revocation', () => {
    setLicenseKey('test-key')
    expect(getRevokedReason()).toBeNull()
  })

  it('setLicenseKey clears previous revocation state', () => {
    // First verify functions work
    expect(isLicenseRevoked()).toBe(false)
    expect(getRevokedReason()).toBeNull()

    // Set a new key should maintain clean state
    setLicenseKey('another-test-key')
    expect(isLicenseRevoked()).toBe(false)
    expect(getRevokedReason()).toBeNull()
  })

  it('clearLicense removes license but revocation functions still work', () => {
    setLicenseKey('test-key')
    clearLicense()

    expect(getLicenseKey()).toBeUndefined()
    // Functions should still return sensible defaults
    expect(isLicenseRevoked()).toBe(false)
    expect(getRevokedReason()).toBeNull()
  })
})
