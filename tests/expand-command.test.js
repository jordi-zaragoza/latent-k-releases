import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock dependencies before importing
vi.mock('../src/lib/config.js', () => ({
  log: vi.fn(),
  isConfigured: vi.fn()
}))

vi.mock('../src/lib/license.js', () => ({
  checkAccess: vi.fn()
}))

vi.mock('../src/lib/expand.js', () => ({
  expand: vi.fn()
}))

vi.mock('../src/lib/context.js', () => ({
  exists: vi.fn()
}))

import { isConfigured } from '../src/lib/config.js'
import { checkAccess } from '../src/lib/license.js'
import { expand } from '../src/lib/expand.js'
import { exists } from '../src/lib/context.js'

// Store original process.cwd
const originalCwd = process.cwd

describe('expand command', () => {
  let tempDir
  let consoleSpy
  let consoleErrorSpy

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expand-test-'))
    process.cwd = () => tempDir
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.cwd = originalCwd
    fs.rmSync(tempDir, { recursive: true, force: true })
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.resetModules()
  })

  describe('extractPrompt helper', () => {
    it('extracts prompt from Claude Code JSON format', async () => {
      exists.mockReturnValue(true)
      isConfigured.mockReturnValue(true)
      checkAccess.mockReturnValue({ allowed: true })
      expand.mockResolvedValue({ type: 'passthrough', calls: 1, context: null })

      const { expandCommand } = await import('../src/commands/expand.js')

      // Simulate JSON input that would come from stdin
      // We pass it directly as argument for testing
      await expandCommand('{"prompt": "test from json"}', {})

      // The expand function should receive the extracted prompt
      expect(expand).toHaveBeenCalledWith(tempDir, 'test from json')
    })

    it('handles plain text input', async () => {
      exists.mockReturnValue(true)
      isConfigured.mockReturnValue(true)
      checkAccess.mockReturnValue({ allowed: true })
      expand.mockResolvedValue({ type: 'passthrough', calls: 1, context: null })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('plain text prompt', {})

      expect(expand).toHaveBeenCalledWith(tempDir, 'plain text prompt')
    })

    it('handles JSON without prompt field', async () => {
      exists.mockReturnValue(true)
      isConfigured.mockReturnValue(true)
      checkAccess.mockReturnValue({ allowed: true })
      expand.mockResolvedValue({ type: 'passthrough', calls: 1, context: null })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('{"other": "field"}', {})

      // Should treat entire JSON string as the prompt
      expect(expand).toHaveBeenCalledWith(tempDir, '{"other": "field"}')
    })
  })

  describe('passthrough conditions (silent - no output)', () => {
    it('outputs nothing when no .lk directory exists', async () => {
      exists.mockReturnValue(false)

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('my prompt', {})

      expect(consoleSpy).not.toHaveBeenCalled()
      expect(expand).not.toHaveBeenCalled()
    })

    it('outputs nothing when AI not configured', async () => {
      exists.mockReturnValue(true)
      isConfigured.mockReturnValue(false)

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('my prompt', {})

      expect(consoleSpy).not.toHaveBeenCalled()
      expect(expand).not.toHaveBeenCalled()
    })

    it('outputs nothing when license check fails', async () => {
      exists.mockReturnValue(true)
      isConfigured.mockReturnValue(true)
      checkAccess.mockImplementation(() => {
        throw new Error('License expired')
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('my prompt', {})

      expect(consoleSpy).not.toHaveBeenCalled()
      expect(expand).not.toHaveBeenCalled()
    })

    it('outputs nothing on expand error', async () => {
      exists.mockReturnValue(true)
      isConfigured.mockReturnValue(true)
      checkAccess.mockReturnValue({ allowed: true })
      expand.mockRejectedValue(new Error('API error'))

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('my prompt', {})

      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('successful expansion', () => {
    beforeEach(() => {
      exists.mockReturnValue(true)
      isConfigured.mockReturnValue(true)
      checkAccess.mockReturnValue({ allowed: true })
    })

    it('outputs system-reminder with direct answer', async () => {
      expand.mockResolvedValue({
        type: 'direct',
        calls: 1,
        context: {
          _instruction: 'use_answer',
          answer: 'This is the answer'
        }
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('original prompt', {})

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('<system-reminder>'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('This is the answer'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('READY ANSWER'))
    })

    it('outputs system-reminder with code context', async () => {
      expand.mockResolvedValue({
        type: 'code_context',
        calls: 2,
        context: {
          files: {
            'src/test.js': 'function test() { return 1 }'
          }
        }
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('test', {})

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('<system-reminder>'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('RELEVANT CODE CONTEXT'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('src/test.js'))
    })

    it('includes project_summary in code context output', async () => {
      expand.mockResolvedValue({
        type: 'code_context',
        calls: 1,
        context: {
          project_summary: 'CLI tool for project context management',
          files: {
            'src/main.js': 'export function main() {}'
          }
        }
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('test prompt', {})

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PROJECT SUMMARY:'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CLI tool for project context management'))
    })

    it('omits project_summary section when not present', async () => {
      expand.mockResolvedValue({
        type: 'code_context',
        calls: 1,
        context: {
          files: {
            'src/main.js': 'export function main() {}'
          }
        }
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('test prompt', {})

      expect(consoleSpy).toHaveBeenCalledWith(expect.not.stringContaining('PROJECT SUMMARY:'))
    })

    it('outputs system-reminder for blocked questions', async () => {
      expand.mockResolvedValue({
        type: 'blocked',
        calls: 1,
        context: {
          message: 'I use context from the project.'
        }
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('what is lk', {})

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('<system-reminder>'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('I use context from the project'))
    })

    it('outputs nothing for passthrough result', async () => {
      expand.mockResolvedValue({
        type: 'passthrough',
        calls: 1,
        context: null
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('test', {})

      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('shows debug info when debug flag is set', async () => {
      expand.mockResolvedValue({
        type: 'code_context',
        calls: 2,
        context: { files: { 'a.js': 'code' } }
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('test', { debug: true })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('2 API call(s)')
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('code_context')
      )
    })

    it('does not show debug info by default', async () => {
      expand.mockResolvedValue({
        type: 'passthrough',
        calls: 1,
        context: null
      })

      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand('test', {})

      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
  })

  describe('empty input handling', () => {
    it('outputs nothing when no input provided', async () => {
      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand(undefined, {})

      expect(consoleSpy).not.toHaveBeenCalled()
      expect(expand).not.toHaveBeenCalled()
    })

    it('shows debug message for empty input when debug enabled', async () => {
      const { expandCommand } = await import('../src/commands/expand.js')
      await expandCommand(undefined, { debug: true })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No input provided')
      )
    })
  })
})
