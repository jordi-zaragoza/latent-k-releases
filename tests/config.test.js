import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEBUG,
  log,
  getAiProvider,
  setAiProvider,
  getApiKey,
  setApiKey,
  getConfig,
  isConfigured,
  config
} from '../src/lib/config.js'
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
    setApiKey('test-anthropic-key')
    expect(config.get('anthropicApiKey')).toBe('test-anthropic-key')
  })

  it('setApiKey stores gemini key when provider is gemini', () => {
    setAiProvider('gemini')
    setApiKey('test-gemini-key')
    expect(config.get('geminiApiKey')).toBe('test-gemini-key')
  })

  it('getApiKey returns correct key for current provider', () => {
    setAiProvider('anthropic')
    setApiKey('anthro-key', 'anthropic')
    setApiKey('gem-key', 'gemini')

    setAiProvider('anthropic')
    expect(getApiKey()).toBe('anthro-key')

    setAiProvider('gemini')
    expect(getApiKey()).toBe('gem-key')
  })

  it('getApiKey with explicit provider parameter', () => {
    setApiKey('anthro-key', 'anthropic')
    setApiKey('gem-key', 'gemini')

    expect(getApiKey('anthropic')).toBe('anthro-key')
    expect(getApiKey('gemini')).toBe('gem-key')
  })
})

describe('getConfig', () => {
  it('returns full configuration object', () => {
    setAiProvider('anthropic')
    setApiKey('test-key', 'anthropic')

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
    setApiKey('valid-key', 'anthropic')
    expect(isConfigured()).toBe(true)
  })

  it('returns true when gemini provider and key set', () => {
    setAiProvider('gemini')
    setApiKey('valid-key', 'gemini')
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
