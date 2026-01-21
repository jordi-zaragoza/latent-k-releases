import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
process.env.LK_DEV = '1'
import { getProjectPureMode, setProjectPureMode, init, loadState, saveState } from '../src/lib/context.js'
import { pure } from '../src/commands/pure.js'
let tmpDir, ogCwd
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-pure-test-'))
  init(tmpDir)
  ogCwd = process.cwd()
  process.chdir(tmpDir)
})
afterEach(() => {
  process.chdir(ogCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
describe('Project Pure Mode', () => {
  it('get returns bool', () => expect(typeof getProjectPureMode(tmpDir)).toBe('boolean'))
  it('default false', () => expect(getProjectPureMode(tmpDir)).toBe(false))
  it('set on', () => { setProjectPureMode(tmpDir, true); expect(getProjectPureMode(tmpDir)).toBe(true) })
  it('set off', () => { setProjectPureMode(tmpDir, true); setProjectPureMode(tmpDir, false); expect(getProjectPureMode(tmpDir)).toBe(false) })
  it('coerces', () => { setProjectPureMode(tmpDir, 1); expect(getProjectPureMode(tmpDir)).toBe(true); setProjectPureMode(tmpDir, 0); expect(getProjectPureMode(tmpDir)).toBe(false) })
  it('persists in state.json', () => {
    setProjectPureMode(tmpDir, true)
    const s = loadState(tmpDir)
    expect(s.pureMode).toBe(true)
  })
  it('isolated per project', () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-pure-test2-'))
    init(tmp2)
    setProjectPureMode(tmpDir, true)
    setProjectPureMode(tmp2, false)
    expect(getProjectPureMode(tmpDir)).toBe(true)
    expect(getProjectPureMode(tmp2)).toBe(false)
    fs.rmSync(tmp2, { recursive: true, force: true })
  })
})
describe('Pure Command', () => {
  let out
  beforeEach(() => { out = []; vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' '))) })
  afterEach(() => vi.restoreAllMocks())
  it('status off', () => { setProjectPureMode(tmpDir, false); pure(); expect(out[0]).toContain('OFF') })
  it('status on', () => { setProjectPureMode(tmpDir, true); pure(); expect(out[0]).toContain('ON') })
  it('shows project-level', () => { pure(); expect(out[0]).toContain('project-level') })
  it('on', () => { pure('on'); expect(getProjectPureMode(tmpDir)).toBe(true) })
  it('1', () => { setProjectPureMode(tmpDir, false); pure('1'); expect(getProjectPureMode(tmpDir)).toBe(true) })
  it('true', () => { setProjectPureMode(tmpDir, false); pure('true'); expect(getProjectPureMode(tmpDir)).toBe(true) })
  it('off', () => { setProjectPureMode(tmpDir, true); pure('off'); expect(getProjectPureMode(tmpDir)).toBe(false) })
  it('0', () => { setProjectPureMode(tmpDir, true); pure('0'); expect(getProjectPureMode(tmpDir)).toBe(false) })
  it('false', () => { setProjectPureMode(tmpDir, true); pure('false'); expect(getProjectPureMode(tmpDir)).toBe(false) })
  it('invalid', () => { pure('x'); expect(out.some(l => l.includes('Usage'))).toBe(true) })
  it('style info', () => { pure('on'); expect(out.some(l => l.includes('m2m'))).toBe(true) })
})
