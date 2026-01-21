import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', 'src')

describe('Binary path configuration', () => {
  it('hooks.js uses /usr/local/bin/lk', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("/usr/local/bin/lk")
  })

  it('hooks.js configures session-info for SessionStart', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain('session-info')
    expect(content).toContain('SessionStart')
  })

  it('dev.js uses /usr/local/bin/lk', () => {
    const content = readFileSync(join(srcDir, 'commands', 'dev.js'), 'utf8')
    expect(content).toContain("/usr/local/bin/lk")
  })

  it('dev.js getBinaryDir returns /usr/local/bin', () => {
    const content = readFileSync(join(srcDir, 'commands', 'dev.js'), 'utf8')
    expect(content).toContain("'/usr/local/bin'")
  })

  it('update.js uses /usr/local/bin/lk', () => {
    const content = readFileSync(join(srcDir, 'commands', 'update.js'), 'utf8')
    expect(content).toContain("/usr/local/bin/lk")
  })

  it('cli.js has session-info command', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain("'session-info'")
    expect(content).toContain('getLicenseExpiration')
  })
})

describe('Hook command consistency', () => {
  it('hooks.js uses expand command', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain('expand')
  })

  it('hooks.js isLkHook detects both expand and context', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("'expand'")
    expect(content).toContain("'context'")
  })
})

describe('Gemini CLI support', () => {
  it('hooks.js has Gemini CLI configuration', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("'.gemini'")
    expect(content).toContain("'BeforeAgent'")
    expect(content).toContain("'SessionEnd'")
  })

  it('hooks.js has Claude CLI configuration', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("'.claude'")
    expect(content).toContain("'UserPromptSubmit'")
    expect(content).toContain("'Stop'")
  })

  it('hooks.js adds --json flag for Gemini session-info', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("'gemini'")
    expect(content).toContain("--json")
    expect(content).toContain("session-info")
  })

  it('cli.js has getGeminiUserEmail function', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain('getGeminiUserEmail')
    expect(content).toContain("'google_accounts.json'")
  })

  it('cli.js session-info supports --json option', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain("'--json'")
  })

  it('cli.js session-info outputs JSON systemMessage format', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain('systemMessage')
  })

  it('cli.js license validation prioritizes Claude email over Gemini', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain('getClaudeUserEmail')
    expect(content).toContain('getGeminiUserEmail')
  })

  it('cli.js terminalPrint has console.log fallback', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain("/dev/tty")
    expect(content).toContain('console.log')
  })
})
