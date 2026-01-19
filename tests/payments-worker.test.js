import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for the Stripe webhook signature verification logic
 * (extracted and tested independently since Workers run in a different runtime)
 */

describe('Stripe Webhook Signature Parsing', () => {
  function parseSignature(signature) {
    if (!signature) return null
    return signature.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=')
      acc[key] = value
      return acc
    }, {})
  }

  it('parses valid signature header', () => {
    const sig = 't=1234567890,v1=abc123def456,v0=legacy'
    const parsed = parseSignature(sig)

    expect(parsed.t).toBe('1234567890')
    expect(parsed.v1).toBe('abc123def456')
    expect(parsed.v0).toBe('legacy')
  })

  it('returns null for missing signature', () => {
    expect(parseSignature(null)).toBeNull()
    expect(parseSignature(undefined)).toBeNull()
  })

  it('handles signature with only timestamp and v1', () => {
    const sig = 't=9999,v1=signature'
    const parsed = parseSignature(sig)

    expect(parsed.t).toBe('9999')
    expect(parsed.v1).toBe('signature')
  })
})

describe('Timestamp Validation', () => {
  function isTimestampValid(timestamp, toleranceSeconds = 300) {
    const currentTime = Math.floor(Date.now() / 1000)
    return Math.abs(currentTime - parseInt(timestamp)) <= toleranceSeconds
  }

  it('accepts recent timestamp', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTimestampValid(now.toString())).toBe(true)
  })

  it('accepts timestamp within tolerance', () => {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 290
    expect(isTimestampValid(fiveMinutesAgo.toString())).toBe(true)
  })

  it('rejects old timestamp', () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600
    expect(isTimestampValid(tenMinutesAgo.toString())).toBe(false)
  })

  it('rejects future timestamp beyond tolerance', () => {
    const tenMinutesFromNow = Math.floor(Date.now() / 1000) + 600
    expect(isTimestampValid(tenMinutesFromNow.toString())).toBe(false)
  })
})

describe('Plan Configuration', () => {
  const PLAN_CONFIG = {
    monthly: { days: 30, name: 'Monthly' },
    yearly: { days: 365, name: 'Yearly' }
  }

  it('monthly plan has correct days', () => {
    expect(PLAN_CONFIG.monthly.days).toBe(30)
  })

  it('yearly plan has correct days', () => {
    expect(PLAN_CONFIG.yearly.days).toBe(365)
  })

  it('validates plan names', () => {
    const validPlans = ['monthly', 'yearly']
    expect(validPlans.includes('monthly')).toBe(true)
    expect(validPlans.includes('yearly')).toBe(true)
    expect(validPlans.includes('trial14')).toBe(false)
  })
})

describe('CORS Headers', () => {
  function corsHeaders(origin) {
    return {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  }

  it('returns wildcard when no origin', () => {
    const headers = corsHeaders(null)
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('returns specific origin when provided', () => {
    const headers = corsHeaders('https://latent-k.dev')
    expect(headers['Access-Control-Allow-Origin']).toBe('https://latent-k.dev')
  })

  it('includes required CORS headers', () => {
    const headers = corsHeaders('https://example.com')
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS')
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type')
  })
})

describe('Request Validation', () => {
  function validateCheckoutRequest(body) {
    const errors = []

    if (!body.email) {
      errors.push('Email is required')
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      errors.push('Invalid email format')
    }

    if (!body.plan) {
      errors.push('Plan is required')
    } else if (!['monthly', 'yearly'].includes(body.plan)) {
      errors.push('Invalid plan. Must be monthly or yearly')
    }

    return errors
  }

  it('validates missing email', () => {
    const errors = validateCheckoutRequest({ plan: 'monthly' })
    expect(errors).toContain('Email is required')
  })

  it('validates missing plan', () => {
    const errors = validateCheckoutRequest({ email: 'test@example.com' })
    expect(errors).toContain('Plan is required')
  })

  it('validates invalid plan', () => {
    const errors = validateCheckoutRequest({ email: 'test@example.com', plan: 'trial14' })
    expect(errors).toContain('Invalid plan. Must be monthly or yearly')
  })

  it('accepts valid request', () => {
    const errors = validateCheckoutRequest({ email: 'test@example.com', plan: 'monthly' })
    expect(errors).toHaveLength(0)
  })

  it('accepts yearly plan', () => {
    const errors = validateCheckoutRequest({ email: 'user@domain.com', plan: 'yearly' })
    expect(errors).toHaveLength(0)
  })
})

describe('Session ID Validation', () => {
  function validateSessionId(sessionId) {
    if (!sessionId) return false
    // Stripe session IDs start with cs_
    if (!sessionId.startsWith('cs_')) return false
    // Minimum length check
    if (sessionId.length < 10) return false
    return true
  }

  it('rejects empty session ID', () => {
    expect(validateSessionId('')).toBe(false)
    expect(validateSessionId(null)).toBe(false)
    expect(validateSessionId(undefined)).toBe(false)
  })

  it('rejects invalid prefix', () => {
    expect(validateSessionId('invalid_session')).toBe(false)
    expect(validateSessionId('pi_123456789')).toBe(false)
  })

  it('accepts valid Stripe session ID', () => {
    expect(validateSessionId('cs_test_a1b2c3d4e5f6g7h8')).toBe(true)
    expect(validateSessionId('cs_live_abcdefghijklmnop')).toBe(true)
  })
})

describe('License KV Key Format', () => {
  function getLicenseKey(sessionId) {
    return `session:${sessionId}`
  }

  it('formats KV key correctly', () => {
    expect(getLicenseKey('cs_test_123')).toBe('session:cs_test_123')
  })

  it('handles various session IDs', () => {
    expect(getLicenseKey('cs_live_abc')).toBe('session:cs_live_abc')
    expect(getLicenseKey('cs_test_xyz789')).toBe('session:cs_test_xyz789')
  })
})
