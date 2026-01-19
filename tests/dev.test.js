import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', 'src')

describe('dev.js hook commands', () => {
  const devContent = readFileSync(join(srcDir, 'commands', 'dev.js'), 'utf8')

  describe('getHookCommands', () => {
    it('uses expand instead of context', () => {
      expect(devContent).toContain('expand || true')
      expect(devContent).not.toMatch(/const contextCmd/)
      expect(devContent).toMatch(/const expandCmd/)
    })

    it('returns expandCmd not contextCmd', () => {
      expect(devContent).toContain('return { expandCmd, syncCmd, sessionCmd }')
    })

    it('generates correct source mode expand command', () => {
      expect(devContent).toContain('node ${sourcePath} expand || true')
    })

    it('generates correct binary mode expand command', () => {
      expect(devContent).toContain('${lkBin} expand || true')
    })
  })

  describe('isLkExpandHook', () => {
    it('function exists', () => {
      expect(devContent).toContain('function isLkExpandHook(command)')
    })

    it('detects expand hooks', () => {
      expect(devContent).toContain("command.includes('expand')")
    })

    it('detects legacy context hooks for migration', () => {
      expect(devContent).toContain("command.includes('context')")
    })

    it('checks for lk binary or cli.js', () => {
      expect(devContent).toContain("/\\blk\\b/.test(command)")
      expect(devContent).toContain("command.includes('cli.js')")
    })
  })

  describe('updateHooksInSettings', () => {
    it('receives expandCmd parameter', () => {
      expect(devContent).toContain('function updateHooksInSettings(settings, stopEvent, expandCmd, syncCmd, sessionCmd)')
    })

    it('uses isLkExpandHook to find hooks', () => {
      expect(devContent).toContain('isLkExpandHook(hh.command)')
    })

    it('updates hooks with expandCmd', () => {
      expect(devContent).toContain('return { ...hh, command: expandCmd }')
    })
  })

  describe('updateClaudeHooks', () => {
    it('destructures expandCmd from getHookCommands', () => {
      expect(devContent).toContain('const { expandCmd, syncCmd, sessionCmd } = getHookCommands(mode)')
    })

    it('passes expandCmd to updateHooksInSettings', () => {
      expect(devContent).toContain("updateHooksInSettings(settings, 'Stop', expandCmd, syncCmd, sessionCmd)")
    })
  })

  describe('updateGeminiHooks', () => {
    it('passes expandCmd to updateHooksInSettings for SessionEnd', () => {
      expect(devContent).toContain("updateHooksInSettings(settings, 'SessionEnd', expandCmd, syncCmd, sessionCmd)")
    })
  })
})

describe('hooks.js consistency with dev.js', () => {
  const hooksContent = readFileSync(join(srcDir, 'commands', 'hooks.js'), 'utf8')
  const devContent = readFileSync(join(srcDir, 'commands', 'dev.js'), 'utf8')

  it('both use expand command', () => {
    expect(hooksContent).toContain('expand')
    expect(devContent).toContain('expand')
  })

  it('both use same binary path', () => {
    expect(hooksContent).toContain("const lkBin = '/usr/local/bin/lk'")
    expect(devContent).toContain("const lkBin = '/usr/local/bin/lk'")
  })

  it('hooks.js uses expand not context', () => {
    expect(hooksContent).toContain('expandCmd')
    expect(hooksContent).not.toMatch(/contextCmd\s*=/)
  })

  it('dev.js uses expand not context', () => {
    expect(devContent).toContain('expandCmd')
    expect(devContent).not.toMatch(/contextCmd\s*=/)
  })
})
