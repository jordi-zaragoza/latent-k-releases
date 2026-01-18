import { describe, it, expect, vi, beforeEach } from 'vitest'
import { expand } from '../src/lib/expand.js'

// Mock dependencies
vi.mock('../src/lib/config.js', () => ({
  log: vi.fn()
}))

vi.mock('../src/lib/context.js', () => ({
  getProject: vi.fn(),
  listDomains: vi.fn(),
  getProjectSummary: vi.fn(),
  getDomainIndex: vi.fn()
}))

vi.mock('../src/lib/ai.js', () => ({
  classifyPrompt: vi.fn(),
  expandPromptCompact: vi.fn()
}))

import { getProject, listDomains, getProjectSummary, getDomainIndex } from '../src/lib/context.js'
import * as ai from '../src/lib/ai.js'

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

    const sampleProjectSummary = `⦓ID: PROJECT⦔
⟪NAME: test-project⟫`

    const sampleDomainIndex = `⟦Core⟧
Lib:[λsrc/lib/parser.js]`

    beforeEach(() => {
      getProject.mockReturnValue(sampleProjectLk)
      listDomains.mockReturnValue(['core', 'cli'])
      getProjectSummary.mockReturnValue(sampleProjectSummary)
      getDomainIndex.mockReturnValue(sampleDomainIndex)
    })

    it('loads domain and returns code context', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core'],
        block_reason: null
      })
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        navigation_guide: 'Parser module contains parsing logic',
        files: [{ path: 'src/lib/parser.js', reason: 'Contains parse function to test' }]
      })

      const result = await expand('/test', 'add tests for parser')

      expect(getDomainIndex).toHaveBeenCalledWith('/test', ['core'])
      expect(ai.expandPromptCompact).toHaveBeenCalled()
      expect(result.type).toBe('code_context')
      expect(result.calls).toBe(2)
      expect(result.context._instruction).toBe('read_files')
      expect(result.context.navigation_guide).toBe('Parser module contains parsing logic')
      expect(result.context.files[0].path).toContain('src/lib/parser.js')
      expect(result.context.files[0].reason).toBe('Contains parse function to test')
    })

    it('handles direct answer from domain context', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core'],
        block_reason: null
      })
      ai.expandPromptCompact.mockResolvedValue({
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
      ai.expandPromptCompact.mockResolvedValue({
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
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        files: [{ path: 'src/lib/parser.js', reason: 'Core parsing' }]
      })

      await expand('/test', 'test the core and cli modules')

      expect(getDomainIndex).toHaveBeenCalledWith('/test', ['core', 'cli'])
    })

    it('returns file list with reasons for Claude Code to read', async () => {
      ai.classifyPrompt.mockResolvedValue({
        is_project: true,
        direct_answer: null,
        needs_domains: ['core'],
        block_reason: null
      })
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        navigation_guide: 'Check the parser module',
        files: [
          { path: 'src/lib/parser.js', reason: 'Contains parse function' },
          { path: 'src/lib/utils.js', reason: 'Helper utilities' }
        ]
      })

      const result = await expand('/test', 'how does parse work')

      expect(result.type).toBe('code_context')
      expect(result.context._instruction).toBe('read_files')
      expect(result.context.files).toHaveLength(2)
      expect(result.context.files[0].reason).toBe('Contains parse function')
      expect(result.context.files[1].reason).toBe('Helper utilities')
    })
  })

})
