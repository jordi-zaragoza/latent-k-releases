import { describe, it, expect, vi, beforeEach } from 'vitest'
import { expand } from '../src/lib/expand.js'

// Mock dependencies
vi.mock('../src/lib/config.js', () => ({
  log: vi.fn()
}))

vi.mock('../src/lib/context.js', () => ({
  getProject: vi.fn(),
  listDomains: vi.fn(),
  getProjectHeader: vi.fn(),
  getDomainIndex: vi.fn()
}))

vi.mock('../src/lib/ai.js', () => ({
  classifyPrompt: vi.fn(),
  expandPromptCompact: vi.fn()
}))

import { getProject, listDomains, getProjectHeader, getDomainIndex } from '../src/lib/context.js'
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
      getProjectHeader.mockReturnValue(sampleProjectLk)
      getDomainIndex.mockReturnValue('⟦Core⟧\nLib:[λsrc/lib/parser.js]')
      // Default expandPromptCompact mock for single call path
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        navigation_guide: null,
        files: []
      })
    })

    it('returns passthrough when no files returned from expansion', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        navigation_guide: null,
        files: []
      })

      const result = await expand('/test', 'hello how are you today')

      expect(result.type).toBe('passthrough')
    })

    it('handles direct answer from expansion', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: 'This project is a CLI tool for testing.',
        navigation_guide: null,
        files: []
      })

      const result = await expand('/test', 'what does this project do')

      expect(result.type).toBe('direct')
      expect(result.context.answer).toBe('This project is a CLI tool for testing.')
    })

    it('returns code_context with files and project header', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        navigation_guide: 'Check parser module',
        files: [{ path: 'src/lib/parser.js', reason: 'Parser logic' }]
      })

      const result = await expand('/test', 'how does the parser work')

      expect(result.type).toBe('code_context')
      expect(result.context.project_summary).toContain('test-project')
      expect(result.context.navigation_guide).toBe('Check parser module')
      expect(result.context.files.length).toBe(1)
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
      getProjectHeader.mockReturnValue(sampleProjectSummary)
      getDomainIndex.mockReturnValue(sampleDomainIndex)
    })

    it('loads domain and returns code context', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        navigation_guide: 'Parser module contains parsing logic',
        files: [{ path: 'src/lib/parser.js', reason: 'Contains parse function to test' }]
      })

      const result = await expand('/test', 'add tests for parser')

      // With small context optimization, all domains are loaded
      expect(getDomainIndex).toHaveBeenCalledWith('/test', ['core', 'cli'])
      expect(ai.expandPromptCompact).toHaveBeenCalled()
      expect(result.type).toBe('code_context')
      expect(result.context._instruction).toBe('read_files')
      expect(result.context.navigation_guide).toBe('Parser module contains parsing logic')
      expect(result.context.files[0].path).toContain('src/lib/parser.js')
      expect(result.context.files[0].reason).toBe('Contains parse function to test')
    })

    it('handles direct answer from domain context', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: 'The parser uses regex to extract exports.',
        files: []
      })

      const result = await expand('/test', 'how does the parser work')

      expect(result.type).toBe('direct')
      expect(result.context._instruction).toBe('use_answer')
      expect(result.context.answer).toBe('The parser uses regex to extract exports.')
    })

    it('returns passthrough when expansion returns no files', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        navigation_guide: null,
        files: []
      })

      const result = await expand('/test', 'add tests to the project')

      expect(result.type).toBe('passthrough')
    })

    it('returns passthrough when no files specified', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        files: []
      })

      const result = await expand('/test', 'my longer test prompt here')

      expect(result.type).toBe('passthrough')
    })

    it('loads all domains with small context optimization', async () => {
      ai.expandPromptCompact.mockResolvedValue({
        direct_answer: null,
        files: [{ path: 'src/lib/parser.js', reason: 'Core parsing' }]
      })

      await expand('/test', 'test the core and cli modules')

      // With small context optimization, all domains are loaded at once
      expect(getDomainIndex).toHaveBeenCalledWith('/test', ['core', 'cli'])
    })

    it('returns file list with reasons for Claude Code to read', async () => {
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
