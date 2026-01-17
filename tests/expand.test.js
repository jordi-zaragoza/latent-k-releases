import { describe, it, expect, vi, beforeEach } from 'vitest'
import { expand } from '../src/lib/expand.js'

// Mock dependencies
vi.mock('../src/lib/config.js', () => ({
  log: vi.fn()
}))

vi.mock('../src/lib/context.js', () => ({
  getProject: vi.fn(),
  loadDomain: vi.fn(),
  listDomains: vi.fn(),
  buildDomain: vi.fn()
}))

vi.mock('../src/lib/ai.js', () => ({
  classifyPrompt: vi.fn(),
  expandPrompt: vi.fn()
}))

vi.mock('../src/lib/parser.js', () => ({
  getFileContext: vi.fn()
}))

import { getProject, loadDomain, listDomains, buildDomain } from '../src/lib/context.js'
import * as ai from '../src/lib/ai.js'
import { getFileContext } from '../src/lib/parser.js'

describe('expand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when no project context exists', () => {
    it('returns passthrough when no project.lk exists', async () => {
      getProject.mockReturnValue('')
      listDomains.mockReturnValue([])

      const result = await expand('/test', 'my prompt')

      expect(result).toEqual({
        type: 'passthrough',
        calls: 0,
        context: null
      })
    })

    it('returns passthrough when project.lk contains TODO', async () => {
      getProject.mockReturnValue('⦓ID: PROJECT⦔\n⟪NAME: TODO⟫')
      listDomains.mockReturnValue([])

      const result = await expand('/test', 'my prompt')

      expect(result).toEqual({
        type: 'passthrough',
        calls: 0,
        context: null
      })
    })
  })

  describe('when project context exists', () => {
    const sampleProjectLk = `⦓ID: PROJECT⦔
⟪NAME: test-project⟫
⟦Δ: Purpose⟧
A test project.`

    beforeEach(() => {
      getProject.mockReturnValue(sampleProjectLk)
      listDomains.mockReturnValue(['core', 'cli'])
    })

    it('handles blocked meta question', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: false,
        direct_answer: null,
        needs_domains: null,
        block_reason: 'meta_question'
      })

      const result = await expand('/test', 'how do you know about my files?')

      expect(result.type).toBe('blocked')
      expect(result.calls).toBe(1)
      expect(result.context).toBeNull()
    })

    it('handles passthrough for non-project questions', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: false,
        direct_answer: null,
        needs_domains: null,
        block_reason: null
      })

      const result = await expand('/test', 'hello how are you today')

      expect(result).toEqual({
        type: 'passthrough',
        calls: 1,
        context: null
      })
    })

    it('handles direct answer from project metadata', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: 'This project is a CLI tool for testing.',
        needs_domains: null,
        block_reason: null
      })

      const result = await expand('/test', 'what does this project do')

      expect(result).toEqual({
        type: 'direct',
        calls: 1,
        context: {
          _instruction: 'use_answer',
          answer: 'This project is a CLI tool for testing.'
        }
      })
    })

    it('handles passthrough when no domains needed', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: [],
        block_reason: null
      })

      const result = await expand('/test', 'some random question here')

      expect(result).toEqual({
        type: 'passthrough',
        calls: 1,
        context: null
      })
    })
  })

  describe('when domain context is needed', () => {
    const sampleProjectLk = `⦓ID: PROJECT⦔
⟪NAME: test-project⟫`

    const sampleDomain = {
      id: 'DOMAIN-CORE',
      domain: 'Core',
      vibe: 'minimal',
      groups: {
        Lib: [
          { symbol: 'λ', file: 'parser.js', hash: 'abc1234', path: 'src/lib/parser.js', desc: 'parses input' }
        ]
      },
      invariants: []
    }

    beforeEach(() => {
      getProject.mockReturnValue(sampleProjectLk)
      listDomains.mockReturnValue(['core', 'cli'])
      loadDomain.mockReturnValue(sampleDomain)
      buildDomain.mockReturnValue('⦓CORE⦔\n∑ Lib [λ parser.js]')
    })

    it('loads domain and returns code context', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core'],
        block_reason: null
      })
      ai.expandPrompt.mockResolvedValue({
        direct_answer: null,
        files: [{ path: 'src/lib/parser.js' }]
      })
      getFileContext.mockReturnValue('export function parse() {}')

      const result = await expand('/test', 'add tests for parser')

      expect(loadDomain).toHaveBeenCalledWith('/test', 'core')
      expect(ai.expandPrompt).toHaveBeenCalled()
      expect(result.type).toBe('code_context')
      expect(result.calls).toBe(2)
      expect(result.context.files['src/lib/parser.js']).toBe('export function parse() {}')
    })

    it('handles direct answer from domain context', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core'],
        block_reason: null
      })
      ai.expandPrompt.mockResolvedValue({
        direct_answer: 'The parser uses regex to extract exports.',
        files: []
      })

      const result = await expand('/test', 'how does the parser work')

      expect(result).toEqual({
        type: 'direct',
        calls: 2,
        context: {
          _instruction: 'use_answer',
          answer: 'The parser uses regex to extract exports.'
        }
      })
    })

    it('returns passthrough when requested domain not found', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['nonexistent'],
        block_reason: null
      })
      listDomains.mockReturnValue(['core'])

      const result = await expand('/test', 'add tests to the project')

      expect(result.type).toBe('passthrough')
      expect(result.calls).toBe(1)
    })

    it('returns passthrough when no files specified', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core'],
        block_reason: null
      })
      ai.expandPrompt.mockResolvedValue({
        direct_answer: null,
        files: []
      })

      const result = await expand('/test', 'my longer test prompt here')

      expect(result.type).toBe('passthrough')
      expect(result.calls).toBe(2)
    })

    it('loads multiple domains when specified', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core', 'cli'],
        block_reason: null
      })
      ai.expandPrompt.mockResolvedValue({
        direct_answer: null,
        files: [{ path: 'src/lib/parser.js' }]
      })
      getFileContext.mockReturnValue('code')

      await expand('/test', 'test the core and cli modules')

      expect(loadDomain).toHaveBeenCalledWith('/test', 'core')
      expect(loadDomain).toHaveBeenCalledWith('/test', 'cli')
    })

    it('extracts specific functions when requested', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core'],
        block_reason: null
      })
      ai.expandPrompt.mockResolvedValue({
        direct_answer: null,
        files: [{ path: 'src/lib/parser.js', functions: ['parse', 'extract'] }]
      })
      getFileContext.mockReturnValue('function code() {}')

      const result = await expand('/test', 'how does parse work')

      // Each function is extracted separately to avoid split issues
      expect(getFileContext).toHaveBeenCalledWith(expect.stringContaining('parser.js'), ['parse'])
      expect(getFileContext).toHaveBeenCalledWith(expect.stringContaining('parser.js'), ['extract'])
      expect(result.type).toBe('code_context')
    })
  })
})
