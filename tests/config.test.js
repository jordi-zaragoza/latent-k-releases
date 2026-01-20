import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEBUG,
  log,
  getAiProvider,
  setAiProvider,
  getApiKey,
  setApiKey,
  validateApiKeyFormat,
  getConfig,
  isConfigured,
  config
} from '../src/lib/config.js'

// Valid test keys (format only - not real keys)
const VALID_ANTHROPIC_KEY = 'sk-ant-api03-test-key-for-testing-purposes-only-1234567890abcdef1234567890abcdef1234567890abcdef'
const VALID_GEMINI_KEY = 'AIzaSyTestKeyForTestingPurposesOnly12345'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Save original config values to restore after tests
let originalProvider
let originalAnthropicKey
let originalGeminiKey

beforeEach(() => {
  originalProvider = config.get('aiProvider')
  originalAnthropicKey = config.get('anthropicApiKey')
  originalGeminiKey = config.get('geminiApiKey')
})

afterEach(() => {
  // Restore original values
  config.set('aiProvider', originalProvider)
  config.set('anthropicApiKey', originalAnthropicKey)
  config.set('geminiApiKey', originalGeminiKey)
})

describe('DEBUG flag', () => {
  it('DEBUG is boolean', () => {
    expect(typeof DEBUG).toBe('boolean')
  })
})

describe('AI Provider', () => {
  it('setAiProvider and getAiProvider round-trip', () => {
    setAiProvider('anthropic')
    expect(getAiProvider()).toBe('anthropic')

    setAiProvider('gemini')
    expect(getAiProvider()).toBe('gemini')
  })

  it('getAiProvider returns empty string when not set', () => {
    config.set('aiProvider', '')
    expect(getAiProvider()).toBe('')
  })
})

describe('API Key management', () => {
  it('setApiKey stores anthropic key when provider is anthropic', () => {
    setAiProvider('anthropic')
    setApiKey(VALID_ANTHROPIC_KEY)
    expect(config.get('anthropicApiKey')).toBe(VALID_ANTHROPIC_KEY)
  })

  it('setApiKey stores gemini key when provider is gemini', () => {
    setAiProvider('gemini')
    setApiKey(VALID_GEMINI_KEY)
    expect(config.get('geminiApiKey')).toBe(VALID_GEMINI_KEY)
  })

  it('getApiKey returns correct key for current provider', () => {
    setAiProvider('anthropic')
    setApiKey(VALID_ANTHROPIC_KEY, 'anthropic')
    setApiKey(VALID_GEMINI_KEY, 'gemini')

    setAiProvider('anthropic')
    expect(getApiKey()).toBe(VALID_ANTHROPIC_KEY)

    setAiProvider('gemini')
    expect(getApiKey()).toBe(VALID_GEMINI_KEY)
  })

  it('getApiKey with explicit provider parameter', () => {
    setApiKey(VALID_ANTHROPIC_KEY, 'anthropic')
    setApiKey(VALID_GEMINI_KEY, 'gemini')

    expect(getApiKey('anthropic')).toBe(VALID_ANTHROPIC_KEY)
    expect(getApiKey('gemini')).toBe(VALID_GEMINI_KEY)
  })

  it('setApiKey throws on invalid anthropic key format', () => {
    expect(() => setApiKey('invalid-key', 'anthropic')).toThrow('must start with "sk-"')
    expect(() => setApiKey('sk-short', 'anthropic')).toThrow('too short')
  })

  it('setApiKey throws on invalid gemini key format', () => {
    expect(() => setApiKey('short', 'gemini')).toThrow('too short')
    expect(() => setApiKey('invalid key with spaces!!!!!!!!!!!!!!!!', 'gemini')).toThrow('invalid characters')
  })
})

describe('validateApiKeyFormat', () => {
  it('validates anthropic key format', () => {
    expect(validateApiKeyFormat(VALID_ANTHROPIC_KEY, 'anthropic').valid).toBe(true)
    expect(validateApiKeyFormat('invalid', 'anthropic').valid).toBe(false)
    expect(validateApiKeyFormat('sk-short', 'anthropic').valid).toBe(false)
  })

  it('validates gemini key format', () => {
    expect(validateApiKeyFormat(VALID_GEMINI_KEY, 'gemini').valid).toBe(true)
    expect(validateApiKeyFormat('short', 'gemini').valid).toBe(false)
  })

  it('returns error message on invalid key', () => {
    const result = validateApiKeyFormat('bad', 'anthropic')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('getConfig', () => {
  it('returns full configuration object', () => {
    setAiProvider('anthropic')
    setApiKey(VALID_ANTHROPIC_KEY, 'anthropic')

    const cfg = getConfig()
    expect(cfg).toHaveProperty('aiProvider')
    expect(cfg).toHaveProperty('anthropicApiKey')
    expect(cfg).toHaveProperty('geminiApiKey')
    expect(cfg).toHaveProperty('autoSync')
    expect(cfg).toHaveProperty('watchPatterns')
    expect(cfg).toHaveProperty('ignorePatterns')
  })

  it('returns default values for arrays', () => {
    const cfg = getConfig()
    expect(Array.isArray(cfg.watchPatterns)).toBe(true)
    expect(Array.isArray(cfg.ignorePatterns)).toBe(true)
    expect(cfg.watchPatterns.length).toBeGreaterThan(0)
  })
})

describe('isConfigured', () => {
  it('returns false when no provider set', () => {
    config.set('aiProvider', '')
    expect(isConfigured()).toBe(false)
  })

  it('returns false when provider set but no API key', () => {
    setAiProvider('anthropic')
    config.set('anthropicApiKey', '')
    expect(isConfigured()).toBe(false)
  })

  it('returns true when anthropic provider and key set', () => {
    setAiProvider('anthropic')
    setApiKey(VALID_ANTHROPIC_KEY, 'anthropic')
    expect(isConfigured()).toBe(true)
  })

  it('returns true when gemini provider and key set', () => {
    setAiProvider('gemini')
    setApiKey(VALID_GEMINI_KEY, 'gemini')
    expect(isConfigured()).toBe(true)
  })
})

describe('log function', () => {
  it('does not throw when called', () => {
    expect(() => log('TEST', 'message')).not.toThrow()
  })

  it('accepts multiple arguments', () => {
    expect(() => log('TEST', 'arg1', 'arg2', 'arg3')).not.toThrow()
  })
})

describe('config defaults', () => {
  it('autoSync defaults to true', () => {
    // Reset to default by deleting
    const cfg = getConfig()
    expect(cfg.autoSync).toBe(true)
  })

  it('watchPatterns includes common extensions', () => {
    const cfg = getConfig()
    expect(cfg.watchPatterns).toContain('**/*.js')
    expect(cfg.watchPatterns).toContain('**/*.ts')
    expect(cfg.watchPatterns).toContain('**/*.py')
  })

  it('ignorePatterns includes node_modules', () => {
    const cfg = getConfig()
    const hasNodeModules = cfg.ignorePatterns.some(p => p.includes('node_modules'))
    expect(hasNodeModules).toBe(true)
  })
})
