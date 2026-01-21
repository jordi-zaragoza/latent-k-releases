import { describe, it, expect, vi } from 'vitest'
import {
  DEBUG,
  log,
  validateApiKeyFormat,
  getConfig
} from '../src/lib/config.js'
const VALID_ANTHROPIC_KEY = 'sk-ant-api03-test-key-for-testing-purposes-only-1234567890abcdef1234567890abcdef1234567890abcdef'
const VALID_GEMINI_KEY = 'AIzaSyTestKeyForTestingPurposesOnly12345'
describe('DEBUG flag', () => {
  it('DEBUG is boolean', () => {
    expect(typeof DEBUG).toBe('boolean')
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
