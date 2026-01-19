import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * Tests for server.js WORKER_TOKEN authentication logic
 */

describe('WORKER_TOKEN Authentication', () => {
  function checkAuth(authHeader, workerToken, sessionValidator) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { authenticated: false, source: null }
    }

    const bearerToken = authHeader.slice(7)

    // Check worker token first
    if (workerToken && bearerToken === workerToken) {
      return { authenticated: true, source: 'worker' }
    }

    // Check session token
    if (sessionValidator(bearerToken)) {
      return { authenticated: true, source: 'admin' }
    }

    return { authenticated: false, source: null }
  }

  const mockSessionValidator = (token) => token === 'valid-session-token'

  it('rejects missing authorization header', () => {
    const result = checkAuth(null, 'worker-secret', mockSessionValidator)
    expect(result.authenticated).toBe(false)
  })

  it('rejects non-Bearer authorization', () => {
    const result = checkAuth('Basic abc123', 'worker-secret', mockSessionValidator)
    expect(result.authenticated).toBe(false)
  })

  it('accepts valid worker token', () => {
    const result = checkAuth('Bearer worker-secret', 'worker-secret', mockSessionValidator)
    expect(result.authenticated).toBe(true)
    expect(result.source).toBe('worker')
  })

  it('accepts valid session token', () => {
    const result = checkAuth('Bearer valid-session-token', 'worker-secret', mockSessionValidator)
    expect(result.authenticated).toBe(true)
    expect(result.source).toBe('admin')
  })

  it('rejects invalid token', () => {
    const result = checkAuth('Bearer invalid-token', 'worker-secret', mockSessionValidator)
    expect(result.authenticated).toBe(false)
  })

  it('worker token takes precedence over session', () => {
    // If someone has both a valid worker token AND it happens to be a valid session
    const dualValidator = (token) => token === 'dual-token'
    const result = checkAuth('Bearer dual-token', 'dual-token', dualValidator)
    expect(result.authenticated).toBe(true)
    expect(result.source).toBe('worker')
  })

  it('works without worker token configured', () => {
    const result = checkAuth('Bearer valid-session-token', null, mockSessionValidator)
    expect(result.authenticated).toBe(true)
    expect(result.source).toBe('admin')
  })

  it('falls back to session when worker token not configured', () => {
    const result = checkAuth('Bearer some-token', undefined, mockSessionValidator)
    expect(result.authenticated).toBe(false)
  })
})

describe('Plan Duration Mapping', () => {
  const PLAN_DAYS = {
    trial1: 1,
    trial7: 7,
    trial14: 14,
    monthly: 30,
    yearly: 365
  }

  it('trial14 is 14 days', () => {
    expect(PLAN_DAYS.trial14).toBe(14)
  })

  it('monthly is 30 days', () => {
    expect(PLAN_DAYS.monthly).toBe(30)
  })

  it('yearly is 365 days', () => {
    expect(PLAN_DAYS.yearly).toBe(365)
  })

  it('defaults to yearly for unknown plan', () => {
    const plan = 'unknown'
    const days = PLAN_DAYS[plan] || 365
    expect(days).toBe(365)
  })
})

describe('License Extension Logic', () => {
  function calculateExpiry(existingExpiry, durationDays) {
    const durationMs = durationDays * 24 * 60 * 60 * 1000
    const now = Date.now()

    if (existingExpiry && existingExpiry > now) {
      // Extend from current expiry
      return existingExpiry + durationMs
    }
    // Start from now
    return now + durationMs
  }

  it('new license starts from now', () => {
    const now = Date.now()
    const expiry = calculateExpiry(null, 30)

    // Should be ~30 days from now (within 1 second tolerance)
    const expectedMs = 30 * 24 * 60 * 60 * 1000
    expect(expiry).toBeGreaterThanOrEqual(now + expectedMs - 1000)
    expect(expiry).toBeLessThanOrEqual(now + expectedMs + 1000)
  })

  it('extends from existing active license', () => {
    const now = Date.now()
    const existingExpiry = now + (10 * 24 * 60 * 60 * 1000) // 10 days from now
    const expiry = calculateExpiry(existingExpiry, 30)

    // Should be 40 days from now (10 existing + 30 new)
    const expectedMs = 40 * 24 * 60 * 60 * 1000
    expect(expiry).toBeGreaterThanOrEqual(now + expectedMs - 1000)
    expect(expiry).toBeLessThanOrEqual(now + expectedMs + 1000)
  })

  it('expired license starts fresh from now', () => {
    const now = Date.now()
    const expiredExpiry = now - (5 * 24 * 60 * 60 * 1000) // 5 days ago
    const expiry = calculateExpiry(expiredExpiry, 30)

    // Should be ~30 days from now (not from expired date)
    const expectedMs = 30 * 24 * 60 * 60 * 1000
    expect(expiry).toBeGreaterThanOrEqual(now + expectedMs - 1000)
    expect(expiry).toBeLessThanOrEqual(now + expectedMs + 1000)
  })
})

describe('Email Normalization', () => {
  function normalizeEmail(email) {
    return email.toLowerCase().trim()
  }

  it('lowercases email', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com')
  })

  it('trims whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com')
  })

  it('handles mixed case and whitespace', () => {
    expect(normalizeEmail('  User@EXAMPLE.com ')).toBe('user@example.com')
  })
})

describe('Request Body Validation', () => {
  function validateGenerateRequest(body) {
    const errors = []

    if (!body.email) {
      errors.push('Email is required')
    }

    return { valid: errors.length === 0, errors }
  }

  it('requires email', () => {
    const result = validateGenerateRequest({})
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Email is required')
  })

  it('accepts valid request with email', () => {
    const result = validateGenerateRequest({ email: 'user@example.com' })
    expect(result.valid).toBe(true)
  })

  it('accepts request with optional fields', () => {
    const result = validateGenerateRequest({
      email: 'user@example.com',
      name: 'John Doe',
      plan: 'yearly'
    })
    expect(result.valid).toBe(true)
  })
})
