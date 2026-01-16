import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getLicenseKey,
  setLicenseKey,
  clearLicense,
  validateLicense,
  activateLicense,
  isLicensed
} from '../src/lib/license.js'

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
  it('returns false when no license', () => {
    delete process.env.LK_DEV
    clearLicense()
    expect(isLicensed()).toBe(false)
  })

  it('returns true when license key is set', () => {
    delete process.env.LK_DEV
    setLicenseKey('some-key')
    expect(isLicensed()).toBe(true)
  })

  it('returns true in DEV_MODE regardless of license', () => {
    process.env.LK_DEV = '1'
    clearLicense()
    expect(isLicensed()).toBe(true)
  })
})

describe('validateLicense', () => {
  it('returns invalid when no license key', async () => {
    delete process.env.LK_DEV
    clearLicense()
    const result = await validateLicense()
    expect(result.valid).toBe(false)
    expect(result.error).toBe('No license key')
  })

  it('validates test license instantly in DEV_MODE', async () => {
    process.env.LK_DEV = '1'
    setLicenseKey('lk-test-license')
    const result = await validateLicense()
    expect(result.valid).toBe(true)
    expect(result.dev).toBe(true)
  })

  it('validates dev license instantly in DEV_MODE', async () => {
    process.env.LK_DEV = '1'
    setLicenseKey('lk-dev-license')
    const result = await validateLicense()
    expect(result.valid).toBe(true)
    expect(result.dev).toBe(true)
  })
})

describe('activateLicense', () => {
  it('activates test license without API call in DEV_MODE', async () => {
    process.env.LK_DEV = '1'
    const result = await activateLicense('lk-test-license')
    expect(result.success).toBe(true)
    expect(result.test).toBe(true)
    expect(getLicenseKey()).toBe('lk-test-license')
  })

  it('activates dev license without API call in DEV_MODE', async () => {
    process.env.LK_DEV = '1'
    const result = await activateLicense('lk-dev-license')
    expect(result.success).toBe(true)
    expect(result.test).toBe(true)
    expect(getLicenseKey()).toBe('lk-dev-license')
  })

  it('fails for invalid license format', async () => {
    delete process.env.LK_DEV
    const result = await activateLicense('invalid-key')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid format')
  })
})

describe('License validation caching', () => {
  it('test licenses are always valid without caching concerns in DEV_MODE', async () => {
    process.env.LK_DEV = '1'
    setLicenseKey('lk-test-license')

    const result1 = await validateLicense()
    const result2 = await validateLicense()

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(true)
  })
})
