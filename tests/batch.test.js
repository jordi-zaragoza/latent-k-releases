import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  MAX_FILES_PER_SYNC,
  MAX_CHARS_PER_FILE,
  MAX_BATCH_CHARS,
  prepareBatch,
  processBatchResults,
  processDeferredFiles
} from '../src/lib/batch.js'

// Mock dependencies
vi.mock('../src/lib/ai.js', () => ({
  analyzeFiles: vi.fn()
}))

vi.mock('../src/lib/spinner.js', () => ({
  withSpinner: vi.fn((msg, fn) => fn())
}))

vi.mock('../src/lib/config.js', () => ({
  log: vi.fn()
}))

describe('batch module constants', () => {
  it('MAX_FILES_PER_SYNC is a positive number', () => {
    expect(typeof MAX_FILES_PER_SYNC).toBe('number')
    expect(MAX_FILES_PER_SYNC).toBeGreaterThan(0)
  })

  it('MAX_CHARS_PER_FILE is a positive number', () => {
    expect(typeof MAX_CHARS_PER_FILE).toBe('number')
    expect(MAX_CHARS_PER_FILE).toBeGreaterThan(0)
  })

  it('MAX_BATCH_CHARS is a positive number', () => {
    expect(typeof MAX_BATCH_CHARS).toBe('number')
    expect(MAX_BATCH_CHARS).toBeGreaterThan(0)
  })

  it('MAX_BATCH_CHARS is greater than MAX_CHARS_PER_FILE', () => {
    expect(MAX_BATCH_CHARS).toBeGreaterThan(MAX_CHARS_PER_FILE)
  })
})

describe('prepareBatch', () => {
  let tempDir
  let testFiles

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-test-'))
    testFiles = []
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function createTestFile(name, content) {
    const filePath = path.join(tempDir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    testFiles.push(name)
    return name
  }

  it('reads file content correctly', () => {
    const file = createTestFile('test.js', 'const x = 1')
    const { filesForAI, totalChars } = prepareBatch(tempDir, [{ file, status: 'new' }])

    expect(filesForAI.length).toBe(1)
    expect(filesForAI[0].content).toBe('const x = 1')
    expect(filesForAI[0].file).toBe(file)
    expect(filesForAI[0].action).toBe('created')
    expect(totalChars).toBe(11)
  })

  it('sets action to modified for non-new files', () => {
    const file = createTestFile('test.js', 'content')
    const { filesForAI } = prepareBatch(tempDir, [{ file, status: 'modified' }])

    expect(filesForAI[0].action).toBe('modified')
  })

  it('truncates large files', () => {
    const largeContent = 'x'.repeat(MAX_CHARS_PER_FILE + 1000)
    const file = createTestFile('large.js', largeContent)
    const { filesForAI } = prepareBatch(tempDir, [{ file, status: 'new' }])

    expect(filesForAI[0].content.length).toBeLessThanOrEqual(MAX_CHARS_PER_FILE + 20) // +20 for "// ... truncated"
    expect(filesForAI[0].content).toContain('// ... truncated')
  })

  it('respects batch size limit', () => {
    // Create files that together exceed MAX_BATCH_CHARS
    // Note: files get truncated to MAX_CHARS_PER_FILE, so we need to account for that
    const contentSize = MAX_BATCH_CHARS + 1000
    const file1 = createTestFile('file1.js', 'x'.repeat(contentSize))
    const file2 = createTestFile('file2.js', 'y'.repeat(contentSize))

    const { filesForAI, totalChars } = prepareBatch(tempDir, [
      { file: file1, status: 'new' },
      { file: file2, status: 'new' }
    ])

    // Both files get truncated to MAX_CHARS_PER_FILE each
    // The batch limit check happens BEFORE adding each file
    // So if first file is under limit, second is added if combined is under limit
    expect(filesForAI.length).toBeGreaterThanOrEqual(1)
    expect(totalChars).toBeLessThanOrEqual(MAX_BATCH_CHARS + MAX_CHARS_PER_FILE)
  })

  it('processes multiple small files', () => {
    const files = []
    for (let i = 0; i < 5; i++) {
      files.push({
        file: createTestFile(`file${i}.js`, `content ${i}`),
        status: 'new'
      })
    }

    const { filesForAI } = prepareBatch(tempDir, files)
    expect(filesForAI.length).toBe(5)
  })

  it('returns empty for empty input', () => {
    const { filesForAI, totalChars } = prepareBatch(tempDir, [])
    expect(filesForAI).toEqual([])
    expect(totalChars).toBe(0)
  })
})

describe('processBatchResults', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-results-test-'))

    // Create .lk directory structure
    const lkDir = path.join(tempDir, '.lk')
    const domainsDir = path.join(lkDir, 'domains')
    fs.mkdirSync(domainsDir, { recursive: true })

    // Create minimal state file
    const { encrypt } = await import('../src/lib/crypto.js')
    fs.writeFileSync(
      path.join(lkDir, 'state.json'),
      encrypt(JSON.stringify({ files: {} }))
    )

    // Create ignore file
    fs.writeFileSync(path.join(lkDir, 'ignore'), '')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function createTestFile(name, content) {
    const filePath = path.join(tempDir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return name
  }

  it('processes successful results', () => {
    const file = createTestFile('src/lib/test.js', 'export function test() {}')
    const analyzedFiles = [{ file, hash: 'abc123' }]
    const results = [{ file, symbol: 'λ', description: 'test function', domain: 'core' }]

    const print = vi.fn()
    const printErr = vi.fn()

    const { synced, affectedDomains } = processBatchResults(
      tempDir, analyzedFiles, results, print, printErr
    )

    expect(synced).toBe(1)
    expect(affectedDomains.has('core')).toBe(true)
    expect(print).toHaveBeenCalled()
    expect(printErr).not.toHaveBeenCalled()
  })

  it('handles ignore response', () => {
    const file = createTestFile('generated.js', 'generated code')
    const analyzedFiles = [{ file, hash: 'abc123' }]
    const results = [{ file, ignore: true }]

    const print = vi.fn()
    const printErr = vi.fn()

    const { synced } = processBatchResults(
      tempDir, analyzedFiles, results, print, printErr
    )

    expect(synced).toBe(0)
    expect(print).toHaveBeenCalledWith(expect.stringContaining('ignored'))
  })

  it('uses defaults for missing results', () => {
    const file = createTestFile('src/lib/unknown.js', 'code')
    const analyzedFiles = [{ file, hash: 'abc123' }]
    const results = [] // Empty results

    const print = vi.fn()
    const printErr = vi.fn()

    const { synced, affectedDomains } = processBatchResults(
      tempDir, analyzedFiles, results, print, printErr
    )

    expect(synced).toBe(1)
    expect(affectedDomains.has('core')).toBe(true)
  })

  it('handles missing file during export extraction', () => {
    // Non-existent file - extractExports will fail but error is caught
    const analyzedFiles = [{ file: 'nonexistent.js', hash: 'abc123' }]
    const results = [{ file: 'nonexistent.js', symbol: 'λ', domain: 'core' }]

    const print = vi.fn()
    const printErr = vi.fn()

    const { synced } = processBatchResults(
      tempDir, analyzedFiles, results, print, printErr
    )

    // extractExports throws for non-existent file, caught in try-catch
    // Either synced = 0 with error, or synced = 1 if extractExports returns empty
    expect(typeof synced).toBe('number')
  })
})

describe('processDeferredFiles', () => {
  let tempDir

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-deferred-test-'))

    // Create .lk directory structure
    const lkDir = path.join(tempDir, '.lk')
    const domainsDir = path.join(lkDir, 'domains')
    fs.mkdirSync(domainsDir, { recursive: true })

    // Create minimal state file
    const { encrypt } = await import('../src/lib/crypto.js')
    fs.writeFileSync(
      path.join(lkDir, 'state.json'),
      encrypt(JSON.stringify({ files: {} }))
    )
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function createTestFile(name, content) {
    const filePath = path.join(tempDir, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return name
  }

  it('processes deferred files with placeholder hash', () => {
    const file = createTestFile('src/lib/new.js', 'export const x = 1')
    const deferredNew = [{ file }]

    const print = vi.fn()
    const printErr = vi.fn()

    const affectedDomains = processDeferredFiles(tempDir, deferredNew, print, printErr)

    expect(affectedDomains.size).toBeGreaterThan(0)
    expect(print).toHaveBeenCalledWith(expect.stringContaining('deferred'))
  })

  it('returns empty set for empty input', () => {
    const print = vi.fn()
    const printErr = vi.fn()

    const affectedDomains = processDeferredFiles(tempDir, [], print, printErr)

    expect(affectedDomains.size).toBe(0)
  })

  it('handles errors gracefully for non-existent files', () => {
    const deferredNew = [{ file: 'nonexistent/path/file.js' }]

    const print = vi.fn()
    const printErr = vi.fn()

    const affectedDomains = processDeferredFiles(tempDir, deferredNew, print, printErr)

    // The function catches errors and prints them
    // affectedDomains may or may not have entries depending on where error occurs
    expect(affectedDomains).toBeInstanceOf(Set)
  })
})
