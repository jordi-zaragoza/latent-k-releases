import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// Enable DEV mode for tests (bypasses license requirement)
process.env.LK_DEV = '1'
import {
  lkPath, domainsPath, domainPath, syntaxPath, projectPath, exists,
  init, getSyntax, setSyntax, getProject, setProject,
  parseEntry, buildEntry,
  parseDomain, buildDomain, listDomains, loadDomain, saveDomain,
  addEntry, removeEntry, getAllEntries,
  hashContent, getFileHash,
  getUnsyncedFiles, getDeletedFiles,
  buildContext, buildVerboseContext, buildContextForFiles, countTokens,
  getProjectSummary, getDomainIndex,
  inferGroup, inferDomainFromPath, inferSymbolFromPath, VALID_SYMBOLS,
  getFileExtension, isCodeFile, getAllFiles, CODE_EXTENSIONS
} from '../src/lib/context.js'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('Path helpers', () => {
  it('lkPath returns .lk', () => {
    expect(lkPath('/root')).toBe('/root/.lk')
  })

  it('domainsPath returns .lk/domains', () => {
    expect(domainsPath('/root')).toBe('/root/.lk/domains')
  })

  it('domainPath returns correct domain file path', () => {
    expect(domainPath('/root', 'core')).toBe('/root/.lk/domains/core.lk')
  })

  it('syntaxPath returns syntax.lk path', () => {
    expect(syntaxPath('/root')).toBe('/root/.lk/syntax.lk')
  })

  it('projectPath returns project.lk path', () => {
    expect(projectPath('/root')).toBe('/root/.lk/project.lk')
  })

  it('exists returns false for uninitialized', () => {
    expect(exists(tmpDir)).toBe(false)
  })

  it('exists returns true after init', () => {
    init(tmpDir)
    expect(exists(tmpDir)).toBe(true)
  })
})

describe('init', () => {
  it('creates directory structure', () => {
    init(tmpDir)
    expect(fs.existsSync(lkPath(tmpDir))).toBe(true)
    expect(fs.existsSync(domainsPath(tmpDir))).toBe(true)
  })

  it('creates default syntax.lk', () => {
    init(tmpDir)
    expect(fs.existsSync(syntaxPath(tmpDir))).toBe(true)
    const content = getSyntax(tmpDir)
    expect(content).toContain('LK-SYNTAX')
  })

  it('creates default project.lk', () => {
    init(tmpDir)
    expect(fs.existsSync(projectPath(tmpDir))).toBe(true)
    const content = getProject(tmpDir)
    expect(content).toContain('PROJECT')
  })

  it('is idempotent', () => {
    init(tmpDir)
    const firstSyntax = getSyntax(tmpDir)
    init(tmpDir)
    const secondSyntax = getSyntax(tmpDir)
    expect(firstSyntax).toBe(secondSyntax)
  })
})

describe('Syntax and Project getters/setters', () => {
  it('getSyntax returns empty for uninitialized', () => {
    expect(getSyntax(tmpDir)).toBe('')
  })

  it('setSyntax creates and writes content', () => {
    setSyntax(tmpDir, 'test syntax')
    expect(getSyntax(tmpDir)).toBe('test syntax')
  })

  it('getProject returns empty for uninitialized', () => {
    expect(getProject(tmpDir)).toBe('')
  })

  it('setProject creates and writes content', () => {
    setProject(tmpDir, 'test project')
    expect(getProject(tmpDir)).toBe('test project')
  })
})

describe('parseEntry', () => {
  it('parses entry with all fields', () => {
    const line = '  λ context.js [⦗abc1234⦘ "file system context" {init, exists}]'
    const entry = parseEntry(line)
    expect(entry).toEqual({
      symbol: 'λ',
      file: 'context.js',
      hash: 'abc1234',
      path: 'context.js',
      desc: 'file system context',
      exports: ['init', 'exists']
    })
  })

  it('parses entry with groupPath', () => {
    const line = '  ⇄ cli.js [⦗abc1234⦘ "entry point"]'
    const entry = parseEntry(line, 'src')
    expect(entry.path).toBe('src/cli.js')
    expect(entry.file).toBe('cli.js')
  })

  it('parses entry without description', () => {
    const line = '  λ file.js [⦗abc1234⦘ {foo, bar}]'
    const entry = parseEntry(line)
    expect(entry.desc).toBe('')
    expect(entry.exports).toEqual(['foo', 'bar'])
  })

  it('parses entry without exports', () => {
    const line = '  ⚙ config.js [⦗abc1234⦘ "configuration file"]'
    const entry = parseEntry(line)
    expect(entry.desc).toBe('configuration file')
    expect(entry.exports).toEqual([])
  })

  it('parses entry with only hash', () => {
    const line = '  ▸ main.js [⦗abc1234⦘]'
    const entry = parseEntry(line)
    expect(entry.symbol).toBe('▸')
    expect(entry.hash).toBe('abc1234')
    expect(entry.desc).toBe('')
    expect(entry.exports).toEqual([])
  })

  it('returns null for malformed lines', () => {
    expect(parseEntry('random text')).toBeNull()
    expect(parseEntry('')).toBeNull()
    expect(parseEntry('  λ file.js')).toBeNull() // missing brackets
  })

  it('handles all valid symbols', () => {
    for (const symbol of VALID_SYMBOLS) {
      const line = `  ${symbol} test.js [⦗abc1234⦘]`
      const entry = parseEntry(line)
      expect(entry?.symbol).toBe(symbol)
    }
  })
})

describe('buildEntry', () => {
  it('builds entry with all fields', () => {
    const entry = buildEntry('λ', 'file.js', 'abc1234', 'description', ['foo', 'bar'])
    expect(entry).toBe('  λ file.js [⦗abc1234⦘ "description" {foo, bar}]')
  })

  it('builds entry without description', () => {
    const entry = buildEntry('λ', 'file.js', 'abc1234', '', ['foo'])
    expect(entry).toBe('  λ file.js [⦗abc1234⦘ {foo}]')
  })

  it('builds entry without exports', () => {
    const entry = buildEntry('λ', 'file.js', 'abc1234', 'desc', [])
    expect(entry).toBe('  λ file.js [⦗abc1234⦘ "desc"]')
  })

  it('builds minimal entry', () => {
    const entry = buildEntry('λ', 'file.js', 'abc1234', '', [])
    expect(entry).toBe('  λ file.js [⦗abc1234⦘]')
  })

  it('round-trips with parseEntry', () => {
    // Hash must be valid hex (a-f, 0-9)
    const original = buildEntry('⇄', 'test.js', 'abc7890', 'test file', ['a', 'b'])
    const parsed = parseEntry(original)
    expect(parsed).not.toBeNull()
    const rebuilt = buildEntry(parsed.symbol, parsed.file, parsed.hash, parsed.desc, parsed.exports)
    expect(rebuilt).toBe(original)
  })
})

describe('parseDomain', () => {
  it('parses domain file', () => {
    const content = `⦓ID: DOMAIN-CORE⦔
⟦Δ: Domain ⫸ Core⟧
⟪VIBE: test⟫

∑ Lib [
  @src/lib/
  λ context.js [⦗abc1234⦘ "context management" {init}]
]
`
    const domain = parseDomain(content)
    expect(domain.id).toBe('DOMAIN-CORE')
    expect(domain.domain).toBe('Core')
    expect(domain.vibe).toBe('test')
    expect(domain.groups.Lib).toHaveLength(1)
    expect(domain.groups.Lib[0].path).toBe('src/lib/context.js')
  })

  it('parses multiple groups', () => {
    const content = `⦓ID: DOMAIN-CLI⦔
⟦Δ: Domain ⫸ Cli⟧

∑ Src [
  @src/
  ⇄ cli.js [⦗abc1234⦘]
]

∑ Commands [
  @src/commands/
  λ serve.js [⦗def5678⦘]
]
`
    const domain = parseDomain(content)
    expect(domain.groups.Src).toHaveLength(1)
    expect(domain.groups.Commands).toHaveLength(1)
    expect(domain.groups.Src[0].path).toBe('src/cli.js')
    expect(domain.groups.Commands[0].path).toBe('src/commands/serve.js')
  })

  it('parses invariants', () => {
    const content = `⦓ID: TEST⦔
⟦Δ: Domain ⫸ Test⟧

⦗INV: NoSecrets⦘ [Never commit API keys]
`
    const domain = parseDomain(content)
    expect(domain.invariants).toHaveLength(1)
    expect(domain.invariants[0].name).toBe('NoSecrets')
    expect(domain.invariants[0].desc).toBe('Never commit API keys')
  })
})

describe('buildDomain', () => {
  it('builds valid domain file', () => {
    const groups = {
      Lib: [
        { symbol: 'λ', file: 'context.js', hash: 'abc1234', path: 'src/lib/context.js', desc: 'test', exports: ['init'] }
      ]
    }
    const content = buildDomain('DOMAIN-CORE', 'Core', 'test vibe', groups, [])
    expect(content).toContain('⦓ID: DOMAIN-CORE⦔')
    expect(content).toContain('⟦Δ: Domain ⫸ Core⟧')
    expect(content).toContain('⟪VIBE: test vibe⟫')
    expect(content).toContain('∑ Lib [')
    expect(content).toContain('@src/lib/')
    expect(content).toContain('λ context.js [⦗abc1234⦘ "test" {init}]')
  })

  it('builds domain with invariants', () => {
    const content = buildDomain('TEST', 'Test', '', {}, [
      { name: 'TestInv', desc: 'Test invariant' }
    ])
    expect(content).toContain('⦗INV: TestInv⦘ [Test invariant]')
  })

  it('skips empty groups', () => {
    const groups = { Empty: [], HasItems: [{ symbol: 'λ', file: 'a.js', hash: 'x', path: 'a.js', desc: '', exports: [] }] }
    const content = buildDomain('TEST', 'Test', '', groups, [])
    expect(content).not.toContain('∑ Empty')
    expect(content).toContain('∑ HasItems')
  })
})

describe('Domain file management', () => {
  beforeEach(() => init(tmpDir))

  it('listDomains returns empty initially', () => {
    expect(listDomains(tmpDir)).toEqual([])
  })

  it('saveDomain and listDomains', () => {
    saveDomain(tmpDir, 'core', 'test content')
    expect(listDomains(tmpDir)).toEqual(['core'])
  })

  it('saveDomain and loadDomain', () => {
    const content = buildDomain('DOMAIN-CORE', 'Core', '', {}, [])
    saveDomain(tmpDir, 'core', content)
    const loaded = loadDomain(tmpDir, 'core')
    expect(loaded.id).toBe('DOMAIN-CORE')
    expect(loaded.domain).toBe('Core')
  })

  it('loadDomain returns null for missing', () => {
    expect(loadDomain(tmpDir, 'nonexistent')).toBeNull()
  })
})

describe('Entry management', () => {
  beforeEach(() => init(tmpDir))

  it('addEntry creates domain if missing', () => {
    addEntry(tmpDir, 'newdomain', 'Files', 'λ', 'abc1234', 'test.js', 'test file', ['foo'])
    expect(listDomains(tmpDir)).toContain('newdomain')
    const domain = loadDomain(tmpDir, 'newdomain')
    expect(domain.groups.Files).toHaveLength(1)
  })

  it('addEntry updates existing entry', () => {
    // Use valid hex hashes (a-f, 0-9 only)
    addEntry(tmpDir, 'core', 'Lib', 'λ', 'abc1234', 'test.js', 'v1', [])
    addEntry(tmpDir, 'core', 'Lib', 'λ', 'def5678', 'test.js', 'v2', ['updated'])

    const domain = loadDomain(tmpDir, 'core')
    expect(domain.groups.Lib).toHaveLength(1)
    expect(domain.groups.Lib[0].hash).toBe('def5678')
    expect(domain.groups.Lib[0].desc).toBe('v2')
  })

  it('addEntry moves file from other domain', () => {
    addEntry(tmpDir, 'old', 'Files', 'λ', 'abc', 'test.js', 'test', [])
    addEntry(tmpDir, 'new', 'Files', 'λ', 'abc', 'test.js', 'test', [])

    const oldDomain = loadDomain(tmpDir, 'old')
    const newDomain = loadDomain(tmpDir, 'new')
    expect(oldDomain.groups.Files || []).toHaveLength(0)
    expect(newDomain.groups.Files).toHaveLength(1)
  })

  it('removeEntry removes from all domains', () => {
    addEntry(tmpDir, 'core', 'Lib', 'λ', 'abc', 'test.js', 'test', [])
    removeEntry(tmpDir, 'test.js')

    const domain = loadDomain(tmpDir, 'core')
    expect(domain.groups.Lib || []).toHaveLength(0)
  })

  it('getAllEntries returns all entries', () => {
    addEntry(tmpDir, 'core', 'Lib', 'λ', 'abc', 'a.js', 'file a', [])
    addEntry(tmpDir, 'cli', 'Commands', '⇄', 'def', 'b.js', 'file b', [])

    const entries = getAllEntries(tmpDir)
    expect(Object.keys(entries)).toHaveLength(2)
    expect(entries['a.js'].domain).toBe('core')
    expect(entries['b.js'].domain).toBe('cli')
  })
})

describe('Hashing', () => {
  it('hashContent returns 7-char hex', () => {
    const hash = hashContent('test content')
    expect(hash).toMatch(/^[a-f0-9]{7}$/)
  })

  it('hashContent is consistent', () => {
    const h1 = hashContent('same content')
    const h2 = hashContent('same content')
    expect(h1).toBe(h2)
  })

  it('hashContent differs for different content', () => {
    // Use more different strings to avoid weak hash collisions
    const h1 = hashContent('completely different content here')
    const h2 = hashContent('another totally unique string value')
    expect(h1).not.toBe(h2)
  })

  it('getFileHash returns hash for existing file', () => {
    const filePath = path.join(tmpDir, 'test.txt')
    fs.writeFileSync(filePath, 'test content')
    const hash = getFileHash(filePath)
    expect(hash).toMatch(/^[a-f0-9]{7}$/)
  })

  it('getFileHash returns null for missing file', () => {
    expect(getFileHash('/nonexistent/file.txt')).toBeNull()
  })
})

describe('File sync tracking', () => {
  beforeEach(() => {
    init(tmpDir)
    // Create a test file
    fs.writeFileSync(path.join(tmpDir, 'existing.js'), 'content')
    addEntry(tmpDir, 'core', 'Files', 'λ', hashContent('content'), 'existing.js', 'test', [])
  })

  it('getUnsyncedFiles identifies new files', () => {
    fs.writeFileSync(path.join(tmpDir, 'new.js'), 'new content')
    const unsynced = getUnsyncedFiles(tmpDir, ['existing.js', 'new.js'])
    expect(unsynced.find(f => f.file === 'new.js')?.status).toBe('new')
  })

  it('getUnsyncedFiles identifies modified files', () => {
    fs.writeFileSync(path.join(tmpDir, 'existing.js'), 'modified content')
    const unsynced = getUnsyncedFiles(tmpDir, ['existing.js'])
    expect(unsynced.find(f => f.file === 'existing.js')?.status).toBe('modified')
  })

  it('getUnsyncedFiles returns empty when all synced', () => {
    const unsynced = getUnsyncedFiles(tmpDir, ['existing.js'])
    expect(unsynced).toHaveLength(0)
  })

  it('getDeletedFiles identifies tracked but missing files', () => {
    fs.unlinkSync(path.join(tmpDir, 'existing.js'))
    const deleted = getDeletedFiles(tmpDir)
    expect(deleted.find(f => f.file === 'existing.js')).toBeDefined()
  })
})

describe('Context building', () => {
  beforeEach(() => {
    init(tmpDir)
    addEntry(tmpDir, 'core', 'Lib', 'λ', 'abc1234', 'src/lib/context.js', 'context management', ['init', 'exists'])
  })

  it('buildVerboseContext includes all parts', () => {
    const context = buildVerboseContext(tmpDir)
    expect(context).toContain('LK-SYNTAX')
    expect(context).toContain('PROJECT')
    expect(context).toContain('DOMAIN-CORE')
    expect(context).toContain('context.js')
  })

  it('buildContext returns minified version', () => {
    const verbose = buildVerboseContext(tmpDir)
    const minified = buildContext(tmpDir)
    expect(minified.length).toBeLessThan(verbose.length)
    // Should still contain essential info
    expect(minified).toContain('context.js')
  })

  it('buildContext removes hashes', () => {
    const context = buildContext(tmpDir)
    expect(context).not.toMatch(/⦗[a-f0-9]{7}⦘/)
  })

  it('buildContext shortens IDs', () => {
    const context = buildContext(tmpDir)
    expect(context).not.toContain('ID: DOMAIN-')
    // Should shorten PROJECT and LK-SYNTAX IDs
    expect(context).toContain('⦓PROJECT⦔')
    expect(context).toContain('⦓LK-SYNTAX⦔')
  })
})

describe('countTokens', () => {
  it('returns token estimate', () => {
    const stats = countTokens('hello world test')
    expect(stats.tokens).toBeGreaterThan(0)
    expect(stats.chars).toBe(16)
    expect(stats.lines).toBe(1)
  })

  it('counts lines correctly', () => {
    const stats = countTokens('line1\nline2\nline3')
    expect(stats.lines).toBe(3)
  })
})

describe('inferGroup', () => {
  it('returns Files for root level', () => {
    expect(inferGroup('file.js')).toBe('Files')
    expect(inferGroup('./file.js')).toBe('Files')
  })

  it('capitalizes directory name', () => {
    expect(inferGroup('src/lib/file.js')).toBe('Lib')
    expect(inferGroup('src/commands/cmd.js')).toBe('Commands')
  })
})

describe('VALID_SYMBOLS', () => {
  it('contains expected symbols', () => {
    expect(VALID_SYMBOLS).toContain('▸')
    expect(VALID_SYMBOLS).toContain('⇄')
    expect(VALID_SYMBOLS).toContain('λ')
    expect(VALID_SYMBOLS).toContain('⚙')
    expect(VALID_SYMBOLS).toContain('⧫')
    expect(VALID_SYMBOLS).toContain('⊚')
  })
})

describe('inferDomainFromPath', () => {
  it('returns test for test directories', () => {
    expect(inferDomainFromPath('tests/foo.js')).toBe('test')
    expect(inferDomainFromPath('test/bar.js')).toBe('test')
    expect(inferDomainFromPath('src/__tests__/baz.js')).toBe('test')
  })

  it('returns api for api directories', () => {
    expect(inferDomainFromPath('src/api/routes.js')).toBe('api')
  })

  it('returns core for lib directories', () => {
    expect(inferDomainFromPath('src/lib/utils.js')).toBe('core')
  })

  it('returns cli for commands directories', () => {
    expect(inferDomainFromPath('src/commands/sync.js')).toBe('cli')
    expect(inferDomainFromPath('cmd/main.js')).toBe('cli')
  })

  it('returns components for components directories', () => {
    expect(inferDomainFromPath('src/components/Button.tsx')).toBe('components')
  })

  it('returns first directory after src for unknown patterns', () => {
    expect(inferDomainFromPath('src/custom/file.js')).toBe('custom')
  })

  it('returns null for root files', () => {
    expect(inferDomainFromPath('file.js')).toBeNull()
  })
})

describe('inferSymbolFromPath', () => {
  it('returns ⧫ for test files', () => {
    expect(inferSymbolFromPath('src/foo.test.js')).toBe('⧫')
    expect(inferSymbolFromPath('src/bar.spec.ts')).toBe('⧫')
    expect(inferSymbolFromPath('utils_test.js')).toBe('⧫')
  })

  it('returns ⚙ for config files', () => {
    expect(inferSymbolFromPath('src/config.js')).toBe('⚙')
    expect(inferSymbolFromPath('settings.ts')).toBe('⚙')
    expect(inferSymbolFromPath('setup.js')).toBe('⚙')
  })

  it('returns ⇄ for interface/api files', () => {
    expect(inferSymbolFromPath('src/api.js')).toBe('⇄')
    expect(inferSymbolFromPath('routes.ts')).toBe('⇄')
    expect(inferSymbolFromPath('handler.js')).toBe('⇄')
    expect(inferSymbolFromPath('controller.ts')).toBe('⇄')
  })

  it('returns ⟐ for schema/type files', () => {
    expect(inferSymbolFromPath('schema.js')).toBe('⟐')
    expect(inferSymbolFromPath('types.ts')).toBe('⟐')
    expect(inferSymbolFromPath('model.js')).toBe('⟐')
    expect(inferSymbolFromPath('foo.d.ts')).toBe('⟐')
  })

  it('returns ⊚ for component files', () => {
    expect(inferSymbolFromPath('Button.tsx')).toBe('⊚')
    expect(inferSymbolFromPath('Header.jsx')).toBe('⊚')
    expect(inferSymbolFromPath('App.vue')).toBe('⊚')
    expect(inferSymbolFromPath('Modal.svelte')).toBe('⊚')
  })

  it('returns ◈ for background/worker files', () => {
    expect(inferSymbolFromPath('worker.js')).toBe('◈')
    expect(inferSymbolFromPath('job.ts')).toBe('◈')
    expect(inferSymbolFromPath('queue.js')).toBe('◈')
  })

  it('returns ⚑ for state files', () => {
    expect(inferSymbolFromPath('store.js')).toBe('⚑')
    expect(inferSymbolFromPath('reducer.ts')).toBe('⚑')
    expect(inferSymbolFromPath('context.js')).toBe('⚑')
  })

  it('returns ⤳ for pipeline files', () => {
    expect(inferSymbolFromPath('pipeline.js')).toBe('⤳')
    expect(inferSymbolFromPath('workflow.ts')).toBe('⤳')
  })

  it('returns λ for generic files', () => {
    expect(inferSymbolFromPath('utils.js')).toBe('λ')
    expect(inferSymbolFromPath('helpers.ts')).toBe('λ')
    expect(inferSymbolFromPath('index.js')).toBe('λ')
  })
})

describe('getFileExtension', () => {
  it('returns lowercase extension', () => {
    expect(getFileExtension('file.js')).toBe('js')
    expect(getFileExtension('file.JS')).toBe('js')
    expect(getFileExtension('file.TsX')).toBe('tsx')
  })

  it('returns last extension for multiple dots', () => {
    expect(getFileExtension('file.test.js')).toBe('js')
    expect(getFileExtension('my.component.tsx')).toBe('tsx')
  })

  it('returns empty string for no extension', () => {
    expect(getFileExtension('Makefile')).toBe('')
    expect(getFileExtension('README')).toBe('')
  })

  it('handles paths with directories', () => {
    expect(getFileExtension('src/lib/file.ts')).toBe('ts')
    expect(getFileExtension('/absolute/path/file.py')).toBe('py')
  })
})

describe('isCodeFile', () => {
  it('returns true for code files', () => {
    expect(isCodeFile('file.js')).toBe(true)
    expect(isCodeFile('file.ts')).toBe(true)
    expect(isCodeFile('file.py')).toBe(true)
    expect(isCodeFile('file.go')).toBe(true)
    expect(isCodeFile('file.rs')).toBe(true)
  })

  it('returns false for non-code files', () => {
    expect(isCodeFile('file.md')).toBe(false)
    expect(isCodeFile('file.txt')).toBe(false)
    expect(isCodeFile('file.json')).toBe(false)
    expect(isCodeFile('file.yaml')).toBe(false)
  })

  it('is case insensitive', () => {
    expect(isCodeFile('file.JS')).toBe(true)
    expect(isCodeFile('file.PY')).toBe(true)
  })

  it('handles all CODE_EXTENSIONS', () => {
    for (const ext of CODE_EXTENSIONS) {
      expect(isCodeFile(`test.${ext}`)).toBe(true)
    }
  })
})

describe('getAllFiles', () => {
  beforeEach(() => {
    // Create test directory structure
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'src/lib'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true })

    // Create test files
    fs.writeFileSync(path.join(tmpDir, 'src/index.js'), 'code')
    fs.writeFileSync(path.join(tmpDir, 'src/lib/utils.ts'), 'code')
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'docs')
    fs.writeFileSync(path.join(tmpDir, 'node_modules/pkg.js'), 'dep')
    fs.writeFileSync(path.join(tmpDir, '.git/config'), 'git')
  })

  it('finds code files by default', () => {
    const files = getAllFiles(tmpDir)
    expect(files).toContain('src/index.js')
    expect(files).toContain('src/lib/utils.ts')
  })

  it('excludes non-code files by default', () => {
    const files = getAllFiles(tmpDir)
    expect(files).not.toContain('README.md')
  })

  it('excludes IGNORE_DIRS', () => {
    const files = getAllFiles(tmpDir)
    expect(files).not.toContain('node_modules/pkg.js')
    expect(files).not.toContain('.git/config')
  })

  it('excludes dotfiles/directories', () => {
    fs.mkdirSync(path.join(tmpDir, '.hidden'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, '.hidden/secret.js'), 'code')
    const files = getAllFiles(tmpDir)
    expect(files).not.toContain('.hidden/secret.js')
  })

  it('includes non-code files with codeOnly: false', () => {
    const files = getAllFiles(tmpDir, tmpDir, { codeOnly: false })
    expect(files).toContain('README.md')
    expect(files).toContain('src/index.js')
  })

  it('returns empty array for non-existent directory', () => {
    const files = getAllFiles(path.join(tmpDir, 'nonexistent'))
    expect(files).toEqual([])
  })

  it('excludes IGNORE_FILES', () => {
    fs.writeFileSync(path.join(tmpDir, 'src/package-lock.json'), '{}')
    fs.writeFileSync(path.join(tmpDir, 'src/__init__.py'), '')
    const files = getAllFiles(tmpDir, tmpDir, { codeOnly: false })
    expect(files).not.toContain('src/package-lock.json')
    expect(files).not.toContain('src/__init__.py')
  })
})

describe('getProjectSummary', () => {
  beforeEach(() => {
    init(tmpDir)
  })

  it('returns empty string for no project', () => {
    fs.unlinkSync(projectPath(tmpDir))
    expect(getProjectSummary(tmpDir)).toBe('')
  })

  it('extracts Purpose, Stack, and Flows sections', () => {
    const projectContent = `⦓ID: PROJECT⦔
⟪VIBE: minimal⟫ ⟪NAME: TestProject⟫ ⟪VERSION: 1.0.0⟫

⟦Δ: Purpose⟧
A test project for unit testing.

⟦Δ: Stack⟧
∑ Tech [Runtime⇨node, Type⇨CLI]

⟦Δ: Flows⟧
∑ Flows [CLI → parse → execute]

⟦Δ: Architecture⟧
Some architecture info.`
    setProject(tmpDir, projectContent)

    const summary = getProjectSummary(tmpDir)
    expect(summary).toContain('⦓ID: PROJECT⦔')
    expect(summary).toContain('⟪NAME: TestProject⟫')
    expect(summary).toContain('Purpose')
    expect(summary).toContain('A test project')
    expect(summary).toContain('Stack')
    expect(summary).toContain('Flows')
    // Architecture should not be included
    expect(summary).not.toContain('Architecture')
  })

  it('handles project with only header', () => {
    const projectContent = `⦓ID: PROJECT⦔
⟪NAME: MinimalProject⟫`
    setProject(tmpDir, projectContent)

    const summary = getProjectSummary(tmpDir)
    expect(summary).toContain('⦓ID: PROJECT⦔')
    expect(summary).toContain('⟪NAME: MinimalProject⟫')
  })
})

describe('getDomainIndex', () => {
  beforeEach(() => {
    init(tmpDir)
    addEntry(tmpDir, 'core', 'Lib', 'λ', 'abc1234', 'src/lib/parser.js', 'parsing utilities', [])
    addEntry(tmpDir, 'core', 'Lib', '⇄', 'def5678', 'src/lib/api.js', 'api interface', [])
    addEntry(tmpDir, 'cli', 'Commands', '⇄', 'ghi9012', 'src/commands/sync.js', 'sync command', [])
  })

  it('returns empty string for empty domain list', () => {
    expect(getDomainIndex(tmpDir, [])).toBe('')
  })

  it('returns compact index for single domain', () => {
    const index = getDomainIndex(tmpDir, ['core'])
    expect(index).toContain('⟦Core⟧')
    expect(index).toContain('λsrc/lib/parser.js')
    expect(index).toContain('⇄src/lib/api.js')
    // Should not contain descriptions
    expect(index).not.toContain('parsing utilities')
  })

  it('returns compact index for multiple domains', () => {
    // getDomainIndex includes domains that exist, even if groups are empty after parse
    const index = getDomainIndex(tmpDir, ['core', 'cli'])
    expect(index).toContain('⟦Core⟧')
    expect(index).toContain('⟦Cli⟧')
    expect(index).toContain('parser.js')
  })

  it('skips non-existent domains', () => {
    const index = getDomainIndex(tmpDir, ['nonexistent', 'core'])
    expect(index).toContain('⟦Core⟧')
    expect(index).not.toContain('nonexistent')
  })
})

describe('buildContextForFiles', () => {
  beforeEach(() => {
    init(tmpDir)
    addEntry(tmpDir, 'core', 'Lib', 'λ', 'abc1234', 'src/lib/parser.js', 'parsing', [])
    addEntry(tmpDir, 'cli', 'Commands', '⇄', 'def5678', 'src/commands/sync.js', 'sync', [])
    addEntry(tmpDir, 'api', 'Routes', '⇄', 'ghi9012', 'src/api/routes.js', 'routes', [])
  })

  it('includes syntax and project for any files', () => {
    const context = buildContextForFiles(tmpDir, ['src/lib/parser.js'])
    expect(context).toContain('LK-SYNTAX')
    expect(context).toContain('PROJECT')
  })

  it('includes only relevant domains based on file paths', () => {
    const context = buildContextForFiles(tmpDir, ['src/lib/parser.js'])
    // Should include core domain (inferred from src/lib/)
    expect(context).toContain('Core')
    // Should NOT include cli or api domains
    expect(context).not.toContain('⟦Cli⟧')
  })

  it('always includes core as fallback', () => {
    const context = buildContextForFiles(tmpDir, ['src/unknown/file.js'])
    // Core should be included as fallback
    expect(context).toContain('parser.js')
  })

  it('includes multiple domains when files span them', () => {
    const context = buildContextForFiles(tmpDir, [
      'src/lib/parser.js',
      'src/commands/sync.js'
    ])
    expect(context).toContain('Core')
    expect(context).toContain('Cli')
  })

  it('applies same minification as buildContext', () => {
    const context = buildContextForFiles(tmpDir, ['src/lib/parser.js'])
    // Should not contain full ID prefixes
    expect(context).not.toContain('ID: DOMAIN-')
    // Should not contain hashes
    expect(context).not.toMatch(/⦗[a-f0-9]{7}⦘/)
  })

  it('returns empty string for empty file list', () => {
    const context = buildContextForFiles(tmpDir, [])
    // Should still include syntax and project
    expect(context).toContain('LK-SYNTAX')
    expect(context).toContain('PROJECT')
  })
})
