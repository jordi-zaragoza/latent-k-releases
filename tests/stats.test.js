import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}))
vi.mock('fs', () => ({ default: mockFs, ...mockFs }))
vi.mock('../src/lib/config.js', () => ({ log: vi.fn() }))
describe('stats - source mode', () => {
  let stats
  beforeEach(async () => {
    vi.resetModules()
    delete process.pkg
    mockFs.existsSync.mockReturnValue(false)
    mockFs.writeFileSync.mockClear()
    stats = await import('../src/lib/stats.js')
  })
  it('createEmptyStats includes arrays in source mode', () => {
    const s = stats.loadStats('/tmp/test')
    expect(s).toHaveProperty('sessions')
    expect(s).toHaveProperty('calls')
    expect(s).toHaveProperty('errors')
    expect(Array.isArray(s.sessions)).toBe(true)
    expect(Array.isArray(s.calls)).toBe(true)
    expect(Array.isArray(s.errors)).toBe(true)
  })
  it('loadStats returns empty stats when file missing', () => {
    const s = stats.loadStats('/tmp/test')
    expect(s.totals.calls).toBe(0)
    expect(s.totals.sessions).toBe(0)
  })
  it('getStatsSummary returns correct structure', () => {
    const sum = stats.getStatsSummary('/tmp/test')
    expect(sum).toHaveProperty('totalSessions')
    expect(sum).toHaveProperty('totalCalls')
    expect(sum).toHaveProperty('byOperation')
    expect(sum).toHaveProperty('byModel')
  })
})
describe('stats - binary mode', () => {
  let stats
  beforeEach(async () => {
    vi.resetModules()
    process.pkg = { entrypoint: '/test' }
    mockFs.existsSync.mockReturnValue(false)
    mockFs.writeFileSync.mockClear()
    stats = await import('../src/lib/stats.js')
  })
  afterEach(() => { delete process.pkg })
  it('createEmptyStats excludes arrays in binary mode', () => {
    const s = stats.loadStats('/tmp/test')
    expect(s).not.toHaveProperty('sessions')
    expect(s).not.toHaveProperty('calls')
    expect(s).not.toHaveProperty('errors')
  })
  it('still has totals and aggregates in binary mode', () => {
    const s = stats.loadStats('/tmp/test')
    expect(s).toHaveProperty('totals')
    expect(s).toHaveProperty('byOperation')
    expect(s).toHaveProperty('byOperationType')
    expect(s).toHaveProperty('byModel')
  })
})
describe('stats - recordCall behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.writeFileSync.mockClear()
  })
  afterEach(() => { delete process.pkg })
  it('source mode: recordCall saves to calls array', async () => {
    delete process.pkg
    const stats = await import('../src/lib/stats.js')
    let saved = null
    mockFs.writeFileSync.mockImplementation((p, data) => { saved = JSON.parse(data) })
    stats.recordCall({
      provider: 'TEST', operation: 'test', operationType: 'testOp',
      model: 'test-model', charsSent: 100, charsReceived: 50, durationMs: 1000
    })
    expect(saved).not.toBeNull()
    expect(saved.calls).toBeDefined()
    expect(saved.calls.length).toBeGreaterThan(0)
  })
  it('binary mode: recordCall does not save calls array', async () => {
    process.pkg = { entrypoint: '/test' }
    const stats = await import('../src/lib/stats.js')
    let saved = null
    mockFs.writeFileSync.mockImplementation((p, data) => { saved = JSON.parse(data) })
    stats.recordCall({
      provider: 'TEST', operation: 'test', operationType: 'testOp',
      model: 'test-model', charsSent: 100, charsReceived: 50, durationMs: 1000
    })
    expect(saved).not.toBeNull()
    expect(saved.calls).toBeUndefined()
    expect(saved.totals.calls).toBe(1)
    expect(saved.byOperation.test.calls).toBe(1)
  })
})
describe('stats - recordError behavior', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.writeFileSync.mockClear()
  })
  afterEach(() => { delete process.pkg })
  it('source mode: recordError saves to errors array', async () => {
    delete process.pkg
    const stats = await import('../src/lib/stats.js')
    let saved = null
    mockFs.writeFileSync.mockImplementation((p, data) => { saved = JSON.parse(data) })
    stats.recordError({ provider: 'TEST', operation: 'test', error: 'fail' })
    expect(saved.errors).toBeDefined()
    expect(saved.errors.length).toBe(1)
  })
  it('binary mode: recordError increments count but no array', async () => {
    process.pkg = { entrypoint: '/test' }
    const stats = await import('../src/lib/stats.js')
    let saved = null
    mockFs.writeFileSync.mockImplementation((p, data) => { saved = JSON.parse(data) })
    stats.recordError({ provider: 'TEST', operation: 'test', error: 'fail' })
    expect(saved.errors).toBeUndefined()
    expect(saved.totals.errors).toBe(1)
  })
})
describe('stats - pricing', () => {
  it('MODEL_PRICING has expected models', async () => {
    const { MODEL_PRICING } = await import('../src/lib/stats.js')
    expect(MODEL_PRICING['gemini-2.5-flash']).toBeDefined()
    expect(MODEL_PRICING['gemini-2.5-flash-lite']).toBeDefined()
    expect(MODEL_PRICING['claude-3-5-haiku-20241022']).toBeDefined()
  })
})
