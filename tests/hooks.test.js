import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', 'src')

describe('Binary path configuration', () => {
  it('hooks.js uses /usr/local/bin/lk', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("const lkBin = '/usr/local/bin/lk'")
  })

  it('hooks.js configures session-info for SessionStart', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain('session-info')
    expect(content).toContain('SessionStart')
  })

  it('dev.js uses /usr/local/bin/lk', () => {
    const content = readFileSync(join(srcDir, 'commands', 'dev.js'), 'utf8')
    expect(content).toContain("const lkBin = '/usr/local/bin/lk'")
  })

  it('dev.js getBinaryDir returns /usr/local/bin', () => {
    const content = readFileSync(join(srcDir, 'commands', 'dev.js'), 'utf8')
    expect(content).toContain("return '/usr/local/bin'")
  })

  it('update.js uses /usr/local/bin/lk', () => {
    const content = readFileSync(join(srcDir, 'commands', 'update.js'), 'utf8')
    expect(content).toContain("const LK_BIN_PATH = '/usr/local/bin/lk'")
  })

  it('cli.js has session-info command', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain("command('session-info')")
    expect(content).toContain('getLicenseExpiration')
  })
})

describe('Hook command consistency', () => {
  it('hooks.js uses expand command (not context)', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain('expand')
    expect(content).toContain('expandCmd')
  })

  it('hooks.js isLkHook detects both expand and context', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("if (type === 'expand')")
    expect(content).toContain("command.includes('expand') || command.includes('context')")
  })
})
