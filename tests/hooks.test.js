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

describe('Gemini CLI support', () => {
  it('hooks.js has Gemini CLI configuration', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("gemini: {")
    expect(content).toContain("dir: join(homedir(), '.gemini')")
    expect(content).toContain("stopEvent: 'SessionEnd'")
  })

  it('hooks.js adds --json flag for Gemini session-info', () => {
    const content = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
    expect(content).toContain("const jsonFlag = cli === 'gemini' ? ' --json' : ''")
    expect(content).toContain('session-info${jsonFlag}')
  })

  it('cli.js has getGeminiUserEmail function', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain('function getGeminiUserEmail()')
    expect(content).toContain("'.gemini', 'google_accounts.json'")
    expect(content).toContain('accounts.active')
  })

  it('cli.js session-info supports --json option', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain(".option('--json'")
    expect(content).toContain('const jsonMode = options.json')
  })

  it('cli.js session-info outputs JSON systemMessage format', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain('JSON.stringify({ systemMessage:')
  })

  it('cli.js license validation prioritizes Claude email over Gemini', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain('getClaudeUserEmail() || getGeminiUserEmail()')
  })

  it('cli.js terminalPrint has console.log fallback', () => {
    const content = readFileSync(join(srcDir, 'cli.js'), 'utf8')
    expect(content).toContain("writeFileSync('/dev/tty'")
    expect(content).toContain('console.log(message)')
  })
})
