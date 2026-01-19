/**
 * Prompt expansion - transforms user prompts into file selection guidance
 *
 * Flow:
 * 1. Receive user prompt
 * 2. Load project.lk + list available domains
 * 3. For small projects: single AI call with all context
 * 4. For large projects: classify first, then expand with selected domains
 * 5. Return file paths + reasons (Claude Code reads them with Read tool)
 */

import path from 'path'
import { getProject, listDomains, getProjectHeader, getDomainIndex } from './context.js'
import { log } from './config.js'
import * as ai from './ai.js'

// Minimum prompt length to trigger expansion (skip short confirmations)
const MIN_PROMPT_LENGTH = 18

// Maximum prompt length to trigger expansion (skip very long prompts)
const MAX_PROMPT_LENGTH = 500

// Threshold for single-call optimization (chars)
const SMALL_CONTEXT_THRESHOLD = 8000

// Module-level cache for project header (cleared on new root)
let cachedHeader = { root: null, content: null }

/**
 * Compact text by removing extra whitespace and joining lines
 */
function compactText(text) {
  if (!text) return ''
  return text.split('\n').map(l => l.trim()).filter(l => l).join(' ')
}

/**
 * Get project header with module-level caching (compacted for context)
 */
function getCachedHeader(root) {
  if (cachedHeader.root !== root) {
    cachedHeader = {
      root,
      content: compactText(getProjectHeader(root))
    }
  }
  return cachedHeader.content
}

/**
 * Build validated file list from expansion result
 */
function buildFileList(root, files) {
  const fileList = []
  for (const file of files) {
    const cleanPath = file.path.startsWith('@') ? file.path.slice(1) : file.path
    const fullPath = path.resolve(root, cleanPath)

    // Security: validate path is within project root
    if (!fullPath.startsWith(root + path.sep) && fullPath !== root) {
      log('EXPAND', `Skipping path outside project: ${file.path}`)
      continue
    }

    fileList.push({
      path: fullPath,
      reason: file.reason || 'Relevant to the task'
    })
  }
  return fileList
}

/**
 * Build success response with file context
 */
function buildCodeContext(calls, projectHeader, expansion, fileList) {
  return {
    type: 'code_context',
    calls,
    context: {
      _instruction: 'read_files',
      project_summary: projectHeader,
      navigation_guide: expansion.navigation_guide || null,
      files: fileList
    }
  }
}

/**
 * Main expand function - returns structured JSON context
 * @param {string} root - Project root directory
 * @param {string} prompt - User's prompt
 * @returns {Promise<{type: string, calls: number, context: object|null}>}
 */
export async function expand(root, prompt) {
  const trimmedPrompt = prompt.trim()

  // Early exit: prompt length checks
  if (trimmedPrompt.length < MIN_PROMPT_LENGTH) {
    log('EXPAND', `Prompt too short (${trimmedPrompt.length} chars), bypassing`)
    return { type: 'passthrough', calls: 0, context: null }
  }

  if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
    log('EXPAND', `Prompt too long (${trimmedPrompt.length} chars), bypassing`)
    return { type: 'passthrough', calls: 0, context: null }
  }

  const projectLk = getProject(root)

  // Early exit: no project context
  if (!projectLk || projectLk.includes('TODO')) {
    log('EXPAND', 'No project context, passing through')
    return { type: 'passthrough', calls: 0, context: null }
  }

  const availableDomains = listDomains(root)
  log('EXPAND', `Available domains: ${availableDomains.join(', ') || 'none'}`)

  // Early exit: no domains
  if (availableDomains.length === 0) {
    log('EXPAND', 'No domains available, passing through')
    return { type: 'passthrough', calls: 0, context: null }
  }

  // Get cached project header (includes Purpose, Stack, Entry, Flows)
  const projectHeader = getCachedHeader(root)

  // Determine if we can use single-call optimization
  let domainIndex = null
  let useSingleCall = false

  if (availableDomains.length === 1) {
    // Single domain: nothing to classify
    log('EXPAND', 'Single domain, skipping classification')
    domainIndex = getDomainIndex(root, availableDomains)
    useSingleCall = true
  } else {
    // Multiple domains: check total context size
    const fullDomainIndex = getDomainIndex(root, availableDomains)
    const totalSize = projectHeader.length + fullDomainIndex.length

    if (totalSize <= SMALL_CONTEXT_THRESHOLD) {
      log('EXPAND', `Small context (${totalSize} chars), skipping classification`)
      domainIndex = fullDomainIndex
      useSingleCall = true
    }
  }

  // === SINGLE CALL PATH ===
  if (useSingleCall) {
    log('EXPAND', 'Expanding with single call...')
    const expansion = await ai.expandPromptCompact(prompt, projectHeader, domainIndex)

    if (expansion.direct_answer) {
      log('EXPAND', 'Direct answer from context')
      return {
        type: 'direct',
        calls: 1,
        context: {
          _instruction: 'use_answer',
          project_summary: projectHeader,
          answer: expansion.direct_answer
        }
      }
    }

    const files = expansion.files || []
    if (files.length === 0) {
      log('EXPAND', 'No files specified')
      return { type: 'passthrough', calls: 1, context: null }
    }

    log('EXPAND', `Selected ${files.length} file(s) for Claude Code to read`)
    const fileList = buildFileList(root, files)

    return buildCodeContext(1, projectHeader, expansion, fileList)
  }

  // === DUAL CALL PATH ===
  // 1. First call - classify prompt
  log('EXPAND', 'Classifying prompt...')
  const classification = await ai.classifyPrompt(prompt, projectLk, availableDomains)
  log('EXPAND', `Classification: ${JSON.stringify(classification)}`)

  if (classification.block_reason) {
    log('EXPAND', `Blocked: ${classification.block_reason}`)
    return { type: 'blocked', calls: 1, context: null }
  }

  if (!classification.is_project) {
    log('EXPAND', 'Not a project question, passing through')
    return { type: 'passthrough', calls: 1, context: null }
  }

  if (classification.direct_answer) {
    log('EXPAND', 'Direct answer from project metadata')
    return {
      type: 'direct',
      calls: 1,
      context: {
        _instruction: 'use_answer',
        project_summary: projectHeader,
        answer: classification.direct_answer
      }
    }
  }

  // Resolve requested domains
  const domainNames = classification.needs_domains || []
  if (domainNames.length === 0) {
    log('EXPAND', 'No domains needed, passing through')
    return { type: 'passthrough', calls: 1, context: null }
  }

  log('EXPAND', `Loading domains: ${domainNames.join(', ')}`)
  const availableLower = availableDomains.map(d => d.toLowerCase())
  const resolvedDomains = domainNames
    .map(name => {
      const idx = availableLower.indexOf(name.toLowerCase())
      return idx >= 0 ? availableDomains[idx] : null
    })
    .filter(Boolean)

  if (resolvedDomains.length === 0) {
    log('EXPAND', 'No domains found')
    return { type: 'passthrough', calls: 1, context: null }
  }

  // 2. Second call - expand with selected domains
  domainIndex = getDomainIndex(root, resolvedDomains)
  log('EXPAND', `Expanding with compact context (${projectHeader.length + domainIndex.length} chars)...`)

  const expansion = await ai.expandPromptCompact(prompt, projectHeader, domainIndex)

  if (expansion.direct_answer) {
    log('EXPAND', 'Direct answer from domain context')
    return {
      type: 'direct',
      calls: 2,
      context: {
        _instruction: 'use_answer',
        project_summary: projectHeader,
        answer: expansion.direct_answer
      }
    }
  }

  const files = expansion.files || []
  if (files.length === 0) {
    log('EXPAND', 'No files specified')
    return { type: 'passthrough', calls: 2, context: null }
  }

  log('EXPAND', `Selected ${files.length} file(s) for Claude Code to read`)
  const fileList = buildFileList(root, files)

  return buildCodeContext(2, projectHeader, expansion, fileList)
}
