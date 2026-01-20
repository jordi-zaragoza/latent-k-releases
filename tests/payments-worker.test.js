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

describe('Rate Limiting', () => {
  // Replicate rate limit logic for testing
  const RATE_LIMIT = {
    login: { maxAttempts: 5, windowSeconds: 300 },
    trial: { maxAttempts: 3, windowSeconds: 3600 },
    checkout: { maxAttempts: 10, windowSeconds: 60 }
  }

  // In-memory fallback (simulates worker behavior)
  let memoryRateLimit

  beforeEach(() => {
    memoryRateLimit = new Map()
  })

  function cleanMemoryRateLimit(now) {
    for (const [key, record] of memoryRateLimit) {
      const action = key.split(':')[1]
      const config = RATE_LIMIT[action]
      if (config && now - record.windowStart >= config.windowSeconds * 2) {
        memoryRateLimit.delete(key)
      }
    }
  }

  function checkRateLimitMemory(key, config, now) {
    if (memoryRateLimit.size > 100) {
      cleanMemoryRateLimit(now)
    }

    let record = memoryRateLimit.get(key) || { count: 0, windowStart: now }

    if (now - record.windowStart >= config.windowSeconds) {
      record = { count: 0, windowStart: now }
    }

    const remaining = Math.max(0, config.maxAttempts - record.count)
    const resetIn = config.windowSeconds - (now - record.windowStart)

    if (record.count >= config.maxAttempts) {
      return { allowed: false, remaining: 0, resetIn }
    }

    record.count++
    memoryRateLimit.set(key, record)

    return { allowed: true, remaining: remaining - 1, resetIn }
  }

  async function checkRateLimit(env, action, identifier) {
    const config = RATE_LIMIT[action]
    if (!config) return { allowed: true, remaining: 999, resetIn: 0 }

    const key = `ratelimit:${action}:${identifier}`
    const now = Math.floor(Date.now() / 1000)

    if (!env.LICENSES) {
      return checkRateLimitMemory(key, config, now)
    }

    try {
      const data = await env.LICENSES.get(key)
      let record = data ? JSON.parse(data) : { count: 0, windowStart: now }

      if (now - record.windowStart >= config.windowSeconds) {
        record = { count: 0, windowStart: now }
      }

      const remaining = Math.max(0, config.maxAttempts - record.count)
      const resetIn = config.windowSeconds - (now - record.windowStart)

      if (record.count >= config.maxAttempts) {
        return { allowed: false, remaining: 0, resetIn }
      }

      record.count++
      await env.LICENSES.put(key, JSON.stringify(record), {
        expirationTtl: config.windowSeconds
      })

      return { allowed: true, remaining: remaining - 1, resetIn }
    } catch (error) {
      // Fail CLOSED with memory fallback
      return checkRateLimitMemory(key, config, now)
    }
  }

  describe('with KV available', () => {
    it('allows requests under limit', async () => {
      const kvStore = new Map()
      const env = {
        LICENSES: {
          get: async (key) => kvStore.get(key) || null,
          put: async (key, value) => kvStore.set(key, value)
        }
      }

      const result = await checkRateLimit(env, 'login', '192.168.1.1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4) // 5 max - 1 used
    })

    it('blocks after exceeding limit', async () => {
      const kvStore = new Map()
      const env = {
        LICENSES: {
          get: async (key) => kvStore.get(key) || null,
          put: async (key, value) => kvStore.set(key, value)
        }
      }

      // Exhaust login limit (5 attempts)
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(env, 'login', '192.168.1.1')
      }

      const result = await checkRateLimit(env, 'login', '192.168.1.1')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('tracks different IPs separately', async () => {
      const kvStore = new Map()
      const env = {
        LICENSES: {
          get: async (key) => kvStore.get(key) || null,
          put: async (key, value) => kvStore.set(key, value)
        }
      }

      // Exhaust limit for IP1
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(env, 'login', '192.168.1.1')
      }

      // IP2 should still be allowed
      const result = await checkRateLimit(env, 'login', '192.168.1.2')
      expect(result.allowed).toBe(true)
    })
  })

  describe('with KV unavailable (fallback)', () => {
    it('uses memory fallback when KV is null', async () => {
      const env = { LICENSES: null }

      const result = await checkRateLimit(env, 'login', '192.168.1.1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4)
    })

    it('blocks after exceeding limit in memory fallback', async () => {
      const env = { LICENSES: null }

      // Exhaust login limit (5 attempts)
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(env, 'login', '192.168.1.1')
      }

      const result = await checkRateLimit(env, 'login', '192.168.1.1')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })

  describe('with KV errors (fail-closed)', () => {
    it('falls back to memory when KV throws', async () => {
      const env = {
        LICENSES: {
          get: async () => { throw new Error('KV unavailable') },
          put: async () => { throw new Error('KV unavailable') }
        }
      }

      const result = await checkRateLimit(env, 'login', '192.168.1.1')
      expect(result.allowed).toBe(true) // First request allowed
      expect(result.remaining).toBe(4)
    })

    it('does NOT fail-open when KV errors', async () => {
      const env = {
        LICENSES: {
          get: async () => { throw new Error('KV unavailable') },
          put: async () => { throw new Error('KV unavailable') }
        }
      }

      // Exhaust limit (should use memory fallback)
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(env, 'login', '192.168.1.1')
      }

      const result = await checkRateLimit(env, 'login', '192.168.1.1')
      expect(result.allowed).toBe(false) // BLOCKED, not fail-open
      expect(result.remaining).toBe(0)
    })
  })

  describe('memory cleanup', () => {
    it('cleans expired entries when map exceeds 100 entries', () => {
      const now = Math.floor(Date.now() / 1000)
      const config = RATE_LIMIT.login

      // Add 101 entries with old timestamps
      for (let i = 0; i < 101; i++) {
        memoryRateLimit.set(`ratelimit:login:ip${i}`, {
          count: 1,
          windowStart: now - (config.windowSeconds * 3) // Expired
        })
      }

      expect(memoryRateLimit.size).toBe(101)

      // Trigger cleanup via new request
      checkRateLimitMemory('ratelimit:login:newip', config, now)

      // Old entries should be cleaned
      expect(memoryRateLimit.size).toBeLessThan(101)
    })
  })

  describe('unknown actions', () => {
    it('allows unknown actions without rate limiting', async () => {
      const env = { LICENSES: null }

      const result = await checkRateLimit(env, 'unknown_action', '192.168.1.1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(999)
    })
  })

  describe('window reset', () => {
    it('resets count after window expires', () => {
      const config = RATE_LIMIT.login
      const now = Math.floor(Date.now() / 1000)
      const key = 'ratelimit:login:192.168.1.1'

      // Simulate old record that should be reset
      memoryRateLimit.set(key, {
        count: 5,
        windowStart: now - config.windowSeconds - 1
      })

      const result = checkRateLimitMemory(key, config, now)
      expect(result.allowed).toBe(true) // Reset, so allowed again
      expect(result.remaining).toBe(4)
    })
  })
})
