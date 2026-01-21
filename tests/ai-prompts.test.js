import { describe, it, expect, vi } from 'vitest'
import {
  SYMBOLS,
  SYMBOL_DESCRIPTIONS,
  SYMBOLS_COMPACT,
  DOMAIN_RULES,
  DEFAULT_ANALYSIS,
  buildAnalyzeFilePrompt,
  buildAnalyzeFilesPrompt,
  buildProjectPrompt,
  buildIgnorePrompt,
  buildClassifyPrompt,
  buildExpandPrompt,
  buildExpandPromptCompact,
  buildProjectSummaryPrompt,
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

  it('SYMBOLS_COMPACT contains all symbols in compact format', () => {
    expect(SYMBOLS_COMPACT).toContain('▸(entry)')
    expect(SYMBOLS_COMPACT).toContain('⇄(api)')
    expect(SYMBOLS_COMPACT).toContain('λ(logic)')
    expect(SYMBOLS_COMPACT).toContain('⚙(config)')
    expect(SYMBOLS_COMPACT).toContain('⧫(test)')
    expect(SYMBOLS_COMPACT).toContain('⊚(ui)')
    expect(SYMBOLS_COMPACT).toContain('⟐(schema)')
    expect(SYMBOLS_COMPACT).toContain('◈(bg)')
    expect(SYMBOLS_COMPACT).toContain('⤳(pipe)')
    expect(SYMBOLS_COMPACT).toContain('⚑(state)')
  })

  it('SYMBOLS_COMPACT is shorter than SYMBOL_DESCRIPTIONS', () => {
    expect(SYMBOLS_COMPACT.length).toBeLessThan(SYMBOL_DESCRIPTIONS.length)
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

  it('sanitizes dangerous keys', () => {
    const result = parseJsonResponse('{"__proto__": {}, "valid": "yes", "prototype": {}}')
    expect(result).toEqual({ valid: 'yes' })
  })

  it('handles deeply nested arrays', () => {
    // Create deeply nested array (25 levels)
    let deep = ['bottom']
    for (let i = 0; i < 25; i++) {
      deep = [deep]
    }
    const json = JSON.stringify(deep)
    const result = parseJsonResponse(json)

    // Should be truncated at depth 20
    let current = result
    for (let i = 0; i < 20; i++) {
      if (Array.isArray(current) && current.length > 0) {
        current = current[0]
      }
    }
    // At depth 20+, should be empty array
    expect(current).toEqual([])
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

  it('blocks dangerous keys (__proto__, constructor, prototype)', () => {
    const dangerous = '{"__proto__": {"polluted": true}, "safe": "value", "constructor": "bad", "prototype": {}}'
    const result = extractJsonFromText(dangerous, false)
    // Only 'safe' key should be present, dangerous keys stripped
    expect(Object.keys(result)).toEqual(['safe'])
    expect(result.safe).toBe('value')
  })

  it('truncates deeply nested JSON beyond max depth', () => {
    // Create deeply nested object (25 levels, beyond MAX_JSON_DEPTH=20)
    let deep = { value: 'bottom' }
    for (let i = 0; i < 25; i++) {
      deep = { nested: deep }
    }
    const json = JSON.stringify(deep)
    const result = extractJsonFromText(json, false)

    // Navigate to depth 20 - should be empty object (truncated)
    let current = result
    for (let i = 0; i < 20; i++) {
      if (current.nested) {
        current = current.nested
      }
    }
    // At depth 20+, content should be truncated to empty object
    expect(current).toEqual({})
  })

  it('preserves JSON within max depth', () => {
    // Create nested object within limits (10 levels)
    let nested = { value: 'found' }
    for (let i = 0; i < 10; i++) {
      nested = { level: nested }
    }
    const json = JSON.stringify(nested)
    const result = extractJsonFromText(json, false)

    // Navigate to the bottom
    let current = result
    for (let i = 0; i < 10; i++) {
      current = current.level
    }
    expect(current.value).toBe('found')
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

describe('buildClassifyPrompt', () => {
  const sampleProjectLk = `⦓ID: PROJECT⦔
⟪VIBE: minimal⟫ ⟪NAME: test-project⟫ ⟪VERSION: 1.0.0⟫
⟦Δ: Purpose⟧
A test project for unit tests.
⟦Δ: Stack⟧
∑ Tech [Runtime⇨node, Type⇨CLI]`

  it('includes user prompt', () => {
    const prompt = buildClassifyPrompt('add tests for parser', sampleProjectLk, ['core', 'cli'])
    expect(prompt).toContain('add tests for parser')
  })

  it('includes project metadata', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, ['core'])
    expect(prompt).toContain('test-project')
    expect(prompt).toContain('⦓ID: PROJECT⦔')
  })

  it('includes available domains', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, ['core', 'cli'])
    expect(prompt).toContain('AVAILABLE DOMAINS')
    expect(prompt).toContain('core, cli')
  })

  it('includes JSON response format', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, ['core'])
    expect(prompt).toContain('"is_project"')
    expect(prompt).toContain('"direct_answer"')
    expect(prompt).toContain('"needs_domains"')
    expect(prompt).toContain('"block_reason"')
  })

  it('shows none when no domains available', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, [])
    expect(prompt).toContain('AVAILABLE DOMAINS: [none]')
  })

  it('includes examples', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, ['core'])
    expect(prompt).toContain('EXAMPLES')
    expect(prompt).toContain('hello')
    expect(prompt).toContain('not_related')
  })

  it('includes is_continuation field in JSON format', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, ['core'])
    expect(prompt).toContain('"is_continuation"')
  })

  it('includes previous context when provided', () => {
    const previousContext = '¿Quieres usar React o Vue para el frontend?'
    const prompt = buildClassifyPrompt('React', sampleProjectLk, ['core'], previousContext)
    expect(prompt).toContain('PREVIOUS ASSISTANT MESSAGE')
    expect(prompt).toContain(previousContext)
  })

  it('does not include previous context section when null', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, ['core'], null)
    expect(prompt).not.toContain('PREVIOUS ASSISTANT MESSAGE')
  })

  it('includes continuation detection instructions', () => {
    const previousContext = 'Should I proceed with the changes?'
    const prompt = buildClassifyPrompt('yes', sampleProjectLk, ['core'], previousContext)
    expect(prompt).toContain('is_continuation')
    expect(prompt).toContain('DIRECT RESPONSE')
  })

  it('includes continuation examples', () => {
    const prompt = buildClassifyPrompt('test', sampleProjectLk, ['core'], 'previous message')
    expect(prompt).toContain('"is_continuation": true')
  })
})

describe('buildExpandPrompt', () => {
  const sampleProjectLk = `⦓ID: PROJECT⦔
⟪NAME: test-project⟫
⟦Δ: Purpose⟧
A CLI tool for testing.`

  const sampleDomainLk = `⦓ID: CORE⦔
⟦Δ: Domain ⫸ Core⟧
∑ Lib [
  @src/lib/
  λ parser.js [⦗abc1234⦘ "parses input" {parse, validate}]
  λ utils.js [⦗def5678⦘ "helper functions" {format, clean}]
]`

  it('includes user prompt', () => {
    const prompt = buildExpandPrompt('add tests', sampleProjectLk, sampleDomainLk)
    expect(prompt).toContain('add tests')
  })

  it('includes project section', () => {
    const prompt = buildExpandPrompt('test', sampleProjectLk, sampleDomainLk)
    expect(prompt).toContain('test-project')
    expect(prompt).toContain('PROJECT:')
  })

  it('includes domain files section', () => {
    const prompt = buildExpandPrompt('test', sampleProjectLk, sampleDomainLk)
    expect(prompt).toContain('DOMAIN FILES:')
    expect(prompt).toContain('parser.js')
    expect(prompt).toContain('utils.js')
  })

  it('includes JSON response format', () => {
    const prompt = buildExpandPrompt('test', sampleProjectLk, sampleDomainLk)
    expect(prompt).toContain('"direct_answer"')
    expect(prompt).toContain('"files"')
    expect(prompt).toContain('"path"')
    expect(prompt).toContain('"reason"')
  })

  it('includes file selection rules', () => {
    const prompt = buildExpandPrompt('test', sampleProjectLk, sampleDomainLk)
    expect(prompt).toContain('FILE SELECTION PRIORITY')
    expect(prompt).toContain('specific functionality')
    expect(prompt).toContain('implementation file')
  })

  it('includes examples', () => {
    const prompt = buildExpandPrompt('test', sampleProjectLk, sampleDomainLk)
    expect(prompt).toContain('EXAMPLES')
    expect(prompt).toContain('classifyPrompt')
    expect(prompt).toContain('add a new command')
  })

  it('instructs to return only JSON', () => {
    const prompt = buildExpandPrompt('test', sampleProjectLk, sampleDomainLk)
    expect(prompt).toContain('Return ONLY JSON')
  })
})

describe('buildExpandPromptCompact', () => {
  const sampleProjectSummary = `⦓ID: PROJECT⦔
⟪NAME: test-project⟫
⟦Purpose⟧
A CLI tool for testing.`

  const sampleDomainIndex = `⟦Core⟧
Lib:[λsrc/lib/parser.js,λsrc/lib/utils.js]`

  it('includes user prompt', () => {
    const prompt = buildExpandPromptCompact('add tests', sampleProjectSummary, sampleDomainIndex)
    expect(prompt).toContain('add tests')
  })

  it('includes project section', () => {
    const prompt = buildExpandPromptCompact('test', sampleProjectSummary, sampleDomainIndex)
    expect(prompt).toContain('test-project')
    expect(prompt).toContain('PROJECT:')
  })

  it('includes compact symbols legend', () => {
    const prompt = buildExpandPromptCompact('test', sampleProjectSummary, sampleDomainIndex)
    expect(prompt).toContain('SYMBOLS:')
    expect(prompt).toContain('▸(entry)')
    expect(prompt).toContain('λ(logic)')
  })

  it('includes domain index as FILES section', () => {
    const prompt = buildExpandPromptCompact('test', sampleProjectSummary, sampleDomainIndex)
    expect(prompt).toContain('FILES:')
    expect(prompt).toContain('⟦Core⟧')
    expect(prompt).toContain('parser.js')
  })

  it('includes JSON response format', () => {
    const prompt = buildExpandPromptCompact('test', sampleProjectSummary, sampleDomainIndex)
    expect(prompt).toContain('"direct_answer"')
    expect(prompt).toContain('"files"')
    expect(prompt).toContain('"path"')
    expect(prompt).toContain('"reason"')
  })

  it('instructs to return only JSON', () => {
    const prompt = buildExpandPromptCompact('test', sampleProjectSummary, sampleDomainIndex)
    expect(prompt).toContain('Return ONLY JSON')
  })

  it('is shorter than buildExpandPrompt for same content', () => {
    const fullPrompt = buildExpandPrompt('test', sampleProjectSummary, sampleDomainIndex)
    const compactPrompt = buildExpandPromptCompact('test', sampleProjectSummary, sampleDomainIndex)
    expect(compactPrompt.length).toBeLessThan(fullPrompt.length)
  })
})

describe('buildProjectSummaryPrompt', () => {
  const sampleProjectLk = `⦓ID: PROJECT⦔
⟪VIBE: minimal⟫ ⟪NAME: test-project⟫ ⟪VERSION: 1.0.0⟫
⟦Δ: Purpose⟧
A test project for unit tests.
⟦Δ: Stack⟧
∑ Tech [Runtime⇨node, Type⇨CLI]
⟦Δ: Flows⟧
∑ Flows [CLI → parse → execute]`

  it('includes project metadata', () => {
    const prompt = buildProjectSummaryPrompt(sampleProjectLk, ['core', 'cli'])
    expect(prompt).toContain('test-project')
    expect(prompt).toContain('⦓ID: PROJECT⦔')
  })

  it('includes domain list', () => {
    const prompt = buildProjectSummaryPrompt(sampleProjectLk, ['core', 'cli', 'api'])
    expect(prompt).toContain('DOMAINS:')
    expect(prompt).toContain('core, cli, api')
  })

  it('shows none when no domains', () => {
    const prompt = buildProjectSummaryPrompt(sampleProjectLk, [])
    expect(prompt).toContain('DOMAINS: [none]')
  })

  it('asks for summary format', () => {
    const prompt = buildProjectSummaryPrompt(sampleProjectLk, ['core'])
    expect(prompt).toContain('1-2 sentence')
    expect(prompt).toContain('Domains:')
  })

  it('instructs to exclude flows', () => {
    const prompt = buildProjectSummaryPrompt(sampleProjectLk, ['core'])
    expect(prompt).toContain('NOT include flows')
  })

  it('instructs to return only text', () => {
    const prompt = buildProjectSummaryPrompt(sampleProjectLk, ['core'])
    expect(prompt).toContain('ONLY the summary text')
    expect(prompt).toContain('no markdown')
  })
})

describe('buildProjectPrompt with new sections', () => {
  it('includes Deps section in template', () => {
    const prompt = buildProjectPrompt({
      files: ['src/index.js'],
      packageJson: null,
      context: null
    })
    expect(prompt).toContain('∑ Deps')
    expect(prompt).toContain('KEY dependencies')
  })

  it('includes Entry section in template', () => {
    const prompt = buildProjectPrompt({
      files: ['src/index.js'],
      packageJson: null,
      context: null
    })
    expect(prompt).toContain('⟦Δ: Entry⟧')
    expect(prompt).toContain('∑ Run')
    expect(prompt).toContain('∑ Commands')
  })
})
