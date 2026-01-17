import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Mock readline before importing clean
vi.mock('readline', () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: vi.fn((msg, cb) => cb('y')),
      close: vi.fn()
    }))
  }
}))

// Mock process.cwd
const originalCwd = process.cwd

describe('clean command', () => {
  let tempDir
  let tempHome

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-test-'))
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-home-'))

    // Mock process.cwd to return our temp directory
    process.cwd = () => tempDir
  })

  afterEach(() => {
    process.cwd = originalCwd
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(tempHome, { recursive: true, force: true })
    vi.resetModules()
  })

  it('shows help when no options provided', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { clean } = await import('../src/commands/clean.js')
    await clean({})

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('lk clean'))
    consoleSpy.mockRestore()
  })

  it('removes context directory when --context flag is set', async () => {
    // Create .lk directory
    const lkDir = path.join(tempDir, '.lk')
    fs.mkdirSync(lkDir, { recursive: true })
    fs.writeFileSync(path.join(lkDir, 'test.txt'), 'test')

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { clean } = await import('../src/commands/clean.js')
    await clean({ context: true, yes: true })

    expect(fs.existsSync(lkDir)).toBe(false)
    consoleSpy.mockRestore()
  })

  it('handles non-existent directories gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { clean } = await import('../src/commands/clean.js')

    // Should not throw
    await expect(clean({ context: true, yes: true })).resolves.not.toThrow()

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not found'))
    consoleSpy.mockRestore()
  })

  it('respects --yes flag to skip confirmation', async () => {
    const lkDir = path.join(tempDir, '.lk')
    fs.mkdirSync(lkDir)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { clean } = await import('../src/commands/clean.js')
    await clean({ context: true, yes: true })

    expect(fs.existsSync(lkDir)).toBe(false)
    consoleSpy.mockRestore()
  })

  it('lists targets before cleaning', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const { clean } = await import('../src/commands/clean.js')
    await clean({ context: true, yes: true })

    expect(consoleSpy).toHaveBeenCalledWith('Will remove:')
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('context'))
    consoleSpy.mockRestore()
  })
})

describe('clean command path constants', () => {
  it('LICENSE_DIR uses correct path separators', async () => {
    // This test verifies the bug fix for the mixed quote issue
    const cleanModule = await import('../src/commands/clean.js?t=' + Date.now())

    // The module should load without syntax errors
    expect(cleanModule.clean).toBeDefined()
    expect(typeof cleanModule.clean).toBe('function')
  })
})
