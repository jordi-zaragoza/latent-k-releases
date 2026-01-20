import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPureMode, setPureMode, config } from '../src/lib/config.js'
import { pure } from '../src/commands/pure.js'
let og
beforeEach(() => { og = config.get('pureMode') })
afterEach(() => { config.set('pureMode', og) })
describe('Config', () => {
  it('get returns bool', () => expect(typeof getPureMode()).toBe('boolean'))
  it('set on', () => { setPureMode(true); expect(getPureMode()).toBe(true) })
  it('set off', () => { setPureMode(false); expect(getPureMode()).toBe(false) })
  it('coerces', () => { setPureMode(1); expect(getPureMode()).toBe(true); setPureMode(0); expect(getPureMode()).toBe(false) })
  it('default false', () => { config.delete('pureMode'); expect(getPureMode()).toBe(false) })
})
describe('Command', () => {
  let out
  beforeEach(() => { out = []; vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' '))) })
  afterEach(() => vi.restoreAllMocks())
  it('status off', () => { setPureMode(false); pure(); expect(out[0]).toContain('OFF') })
  it('status on', () => { setPureMode(true); pure(); expect(out[0]).toContain('ON') })
  it('on', () => { pure('on'); expect(getPureMode()).toBe(true) })
  it('1', () => { setPureMode(false); pure('1'); expect(getPureMode()).toBe(true) })
  it('true', () => { setPureMode(false); pure('true'); expect(getPureMode()).toBe(true) })
  it('off', () => { setPureMode(true); pure('off'); expect(getPureMode()).toBe(false) })
  it('0', () => { setPureMode(true); pure('0'); expect(getPureMode()).toBe(false) })
  it('false', () => { setPureMode(true); pure('false'); expect(getPureMode()).toBe(false) })
  it('invalid', () => { pure('x'); expect(out.some(l => l.includes('Usage'))).toBe(true) })
  it('style info', () => { pure('on'); expect(out.some(l => l.includes('m2m'))).toBe(true) })
})
