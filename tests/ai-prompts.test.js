import { describe, it, expect, vi } from 'vitest'
import {
  SYMBOLS,
  SYMBOL_DESCRIPTIONS,
  DOMAIN_RULES,
  DEFAULT_ANALYSIS,
  buildAnalyzeFilePrompt,
  buildAnalyzeFilesPrompt,
  buildProjectPrompt,
  buildDescribeLkPrompt,
  buildIgnorePrompt,
  parseJsonResponse,
  extractJsonFromText,
  generateDefaultResults
} from '../src/lib/ai-prompts.js'

// Mock config.js
vi.mock('../src/lib/config.js', () => ({
  log: vi.fn()
}))

describe('constants', () => {
  it('SYMBOLS contains expected symbols', () => {
    expect(SYMBOLS.LAMBDA).toBe('λ')
    expect(SYMBOLS.INTERFACE).toBe('⇄')
    expect(SYMBOLS.CONFIG).toBe('⚙')
    expect(SYMBOLS.TEST).toBe('⧫')
    expect(SYMBOLS.ENTRY).toBe('▸')
    expect(SYMBOLS.COMPONENT).toBe('⊚')
  })

  it('SYMBOL_DESCRIPTIONS contains all symbols', () => {
    expect(SYMBOL_DESCRIPTIONS).toContain('λ')
    expect(SYMBOL_DESCRIPTIONS).toContain('⇄')
    expect(SYMBOL_DESCRIPTIONS).toContain('⚙')
    expect(SYMBOL_DESCRIPTIONS).toContain('⧫')
    expect(SYMBOL_DESCRIPTIONS).toContain('▸')
    expect(SYMBOL_DESCRIPTIONS).toContain('⊚')
  })

  it('DOMAIN_RULES contains expected domains', () => {
    expect(DOMAIN_RULES).toContain('cli')
    expect(DOMAIN_RULES).toContain('core')
    expect(DOMAIN_RULES).toContain('api')
    expect(DOMAIN_RULES).toContain('ui')
    expect(DOMAIN_RULES).toContain('test')
  })

  it('DEFAULT_ANALYSIS has correct structure', () => {
    expect(DEFAULT_ANALYSIS).toEqual({
      symbol: 'λ',
      description: null,
      domain: 'core'
    })
  })
})

describe('buildAnalyzeFilePrompt', () => {
  it('includes file information', () => {
    const prompt = buildAnalyzeFilePrompt({
      lkContent: '⦓PROJECT⦔',
      file: 'src/lib/test.js',
      content: 'const x = 1',
      action: 'created'
    })

    expect(prompt).toContain('src/lib/test.js')
    expect(prompt).toContain('created')
    expect(prompt).toContain('const x = 1')
    expect(prompt).toContain('⦓PROJECT⦔')
  })

  it('truncates long content', () => {
    const longContent = 'x'.repeat(5000)
    const prompt = buildAnalyzeFilePrompt({
      lkContent: '',
      file: 'test.js',
      content: longContent,
      action: 'modified'
    })

    expect(prompt.length).toBeLessThan(longContent.length + 1000)
  })

  it('handles missing content', () => {
    const prompt = buildAnalyzeFilePrompt({
      lkContent: '',
      file: 'test.js',
      content: null,
      action: 'created'
    })

    expect(prompt).toContain('test.js')
    expect(prompt).not.toContain('Content:')
  })

  it('includes symbol descriptions', () => {
    const prompt = buildAnalyzeFilePrompt({
      lkContent: '',
      file: 'test.js',
      content: '',
      action: 'created'
    })

    expect(prompt).toContain('λ')
    expect(prompt).toContain('⇄')
  })

  it('includes domain rules', () => {
    const prompt = buildAnalyzeFilePrompt({
      lkContent: '',
      file: 'test.js',
      content: '',
      action: 'created'
    })

    expect(prompt).toContain('src/commands/*')
    expect(prompt).toContain('cli')
  })
})

describe('buildAnalyzeFilesPrompt', () => {
  it('includes all files', () => {
    const prompt = buildAnalyzeFilesPrompt({
      lkContent: '⦓PROJECT⦔',
      files: [
        { file: 'file1.js', content: 'code1', action: 'created' },
        { file: 'file2.js', content: 'code2', action: 'modified' }
      ]
    })

    expect(prompt).toContain('file1.js')
    expect(prompt).toContain('file2.js')
    expect(prompt).toContain('code1')
    expect(prompt).toContain('code2')
  })

  it('includes file count', () => {
    const prompt = buildAnalyzeFilesPrompt({
      lkContent: '',
      files: [
        { file: 'a.js', content: '', action: 'created' },
        { file: 'b.js', content: '', action: 'created' },
        { file: 'c.js', content: '', action: 'created' }
      ]
    })

    expect(prompt).toContain('3 files')
  })

  it('truncates individual file content', () => {
    const longContent = 'x'.repeat(5000)
    const prompt = buildAnalyzeFilesPrompt({
      lkContent: '',
      files: [{ file: 'test.js', content: longContent, action: 'created' }]
    })

    expect(prompt.length).toBeLessThan(longContent.length + 1000)
  })
})

describe('buildProjectPrompt', () => {
  it('includes files list', () => {
    const prompt = buildProjectPrompt({
      files: ['src/index.js', 'src/lib/utils.js'],
      packageJson: null,
      context: null
    })

    expect(prompt).toContain('src/index.js')
    expect(prompt).toContain('src/lib/utils.js')
  })

  it('includes package.json when provided', () => {
    const prompt = buildProjectPrompt({
      files: ['index.js'],
      packageJson: '{"name": "test-project"}',
      context: null
    })

    expect(prompt).toContain('test-project')
    expect(prompt).toContain('package.json')
  })

  it('uses context instead of files when provided', () => {
    const prompt = buildProjectPrompt({
      files: ['will-be-ignored.js'],
      packageJson: null,
      context: '⦓CORE⦔ λ utils.js'
    })

    expect(prompt).toContain('⦓CORE⦔')
    expect(prompt).not.toContain('will-be-ignored.js')
  })

  it('includes project.lk format template', () => {
    const prompt = buildProjectPrompt({
      files: [],
      packageJson: null,
      context: null
    })

    expect(prompt).toContain('⦓ID: PROJECT⦔')
    expect(prompt).toContain('⟪VIBE:')
    expect(prompt).toContain('⟦Δ: Purpose⟧')
  })
})

describe('buildDescribeLkPrompt', () => {
  it('includes file and content', () => {
    const prompt = buildDescribeLkPrompt({
      file: 'src/auth.js',
      content: 'export function login() {}'
    })

    expect(prompt).toContain('src/auth.js')
    expect(prompt).toContain('export function login')
  })

  it('includes example format', () => {
    const prompt = buildDescribeLkPrompt({
      file: 'test.js',
      content: 'code'
    })

    expect(prompt).toContain('λ auth.js')
    expect(prompt).toContain('{login, logout, refresh}')
  })
})

describe('buildIgnorePrompt', () => {
  it('includes file tree', () => {
    const prompt = buildIgnorePrompt({
      files: ['src/index.js', 'node_modules/pkg/index.js', 'dist/bundle.js'],
      globalPatterns: []
    })

    expect(prompt).toContain('src/index.js')
    expect(prompt).toContain('node_modules/pkg/index.js')
    expect(prompt).toContain('dist/bundle.js')
  })

  it('includes global patterns', () => {
    const prompt = buildIgnorePrompt({
      files: [],
      globalPatterns: ['**/node_modules/**', '**/dist/**']
    })

    expect(prompt).toContain('node_modules')
    expect(prompt).toContain('dist')
    expect(prompt).toContain('ALREADY IGNORED')
  })
})

describe('parseJsonResponse', () => {
  it('parses valid JSON', () => {
    const result = parseJsonResponse('{"symbol": "λ", "domain": "core"}')
    expect(result).toEqual({ symbol: 'λ', domain: 'core' })
  })

  it('strips markdown code blocks', () => {
    const result = parseJsonResponse('```json\n{"key": "value"}\n```')
    expect(result).toEqual({ key: 'value' })
  })

  it('returns fallback for invalid JSON', () => {
    const result = parseJsonResponse('not json', { default: true })
    expect(result).toEqual({ default: true })
  })

  it('returns fallback for null/undefined', () => {
    expect(parseJsonResponse(null, 'fallback')).toBe('fallback')
    expect(parseJsonResponse(undefined, 'fallback')).toBe('fallback')
  })

  it('returns null fallback by default', () => {
    expect(parseJsonResponse('invalid')).toBe(null)
  })
})

describe('extractJsonFromText', () => {
  it('extracts object from text', () => {
    const result = extractJsonFromText(
      'Some text {"symbol": "λ", "description": "test", "domain": "core"} more text',
      false
    )
    expect(result).toEqual({ symbol: 'λ', description: 'test', domain: 'core' })
  })

  it('extracts array from text', () => {
    const result = extractJsonFromText(
      'Response: [{"file": "a.js"}, {"file": "b.js"}]',
      true
    )
    expect(result).toHaveLength(2)
    expect(result[0].file).toBe('a.js')
  })

  it('handles markdown code blocks', () => {
    const result = extractJsonFromText(
      '```json\n{"symbol": "λ", "description": null, "domain": "core"}\n```',
      false
    )
    expect(result).toEqual({ symbol: 'λ', description: null, domain: 'core' })
  })

  it('returns null for non-matching text', () => {
    expect(extractJsonFromText('no json here', false)).toBe(null)
    expect(extractJsonFromText('no array here', true)).toBe(null)
  })

  it('returns null for empty input', () => {
    expect(extractJsonFromText(null, false)).toBe(null)
    expect(extractJsonFromText('', true)).toBe(null)
  })
})

describe('generateDefaultResults', () => {
  it('generates defaults for all files', () => {
    const files = [
      { file: 'a.js' },
      { file: 'b.js' },
      { file: 'c.js' }
    ]

    const results = generateDefaultResults(files)

    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ file: 'a.js', ...DEFAULT_ANALYSIS })
    expect(results[1]).toEqual({ file: 'b.js', ...DEFAULT_ANALYSIS })
    expect(results[2]).toEqual({ file: 'c.js', ...DEFAULT_ANALYSIS })
  })

  it('returns empty array for empty input', () => {
    expect(generateDefaultResults([])).toEqual([])
  })
})
