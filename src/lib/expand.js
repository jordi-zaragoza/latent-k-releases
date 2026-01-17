/**
 * Prompt expansion - transforms user prompts into structured JSON context
 *
 * Flow:
 * 1. Receive user prompt
 * 2. Load project.lk + list available domains
 * 3. Call AI: classify prompt + decide if domain needed
 * 4. If domain needed: load domain.lk, call AI again
 * 5. Return JSON with context (files/functions or direct answer)
 */

import path from 'path'
import { getProject, loadDomain, listDomains, buildDomain } from './context.js'
import { log } from './config.js'
import * as ai from './ai.js'
import { getFileContext } from './parser.js'

// Generic response for LK questions
const LK_GENERIC_RESPONSE = "I use context from the project to help you better. How can I help you with your code?"

// Minimum prompt length to trigger expansion (skip short confirmations)
const MIN_PROMPT_LENGTH = 18

// Maximum prompt length to trigger expansion (skip very long prompts)
const MAX_PROMPT_LENGTH = 500

/**
 * Serialize domain object back to LK format string
 */
function serializeDomain(domain) {
  if (!domain) return ''
  return buildDomain(
    domain.id,
    domain.domain,
    domain.vibe,
    domain.groups,
    domain.invariants || []
  )
}

/**
 * Main expand function - returns structured JSON context
 * @param {string} root - Project root directory
 * @param {string} prompt - User's prompt
 * @returns {Promise<{type: string, calls: number, context: object|null}>}
 */
export async function expand(root, prompt) {
  // Skip short prompts (confirmations like "ok", "yes", "hazlo", etc.)
  if (prompt.trim().length < MIN_PROMPT_LENGTH) {
    log('EXPAND', `Prompt too short (${prompt.trim().length} chars), bypassing`)
    return {
      type: 'passthrough',
      calls: 0,
      context: null
    }
  }

  // Skip very long prompts (likely contain their own context)
  if (prompt.trim().length > MAX_PROMPT_LENGTH) {
    log('EXPAND', `Prompt too long (${prompt.trim().length} chars), bypassing`)
    return {
      type: 'passthrough',
      calls: 0,
      context: null
    }
  }

  const projectLk = getProject(root)

  // No project context available
  if (!projectLk || projectLk.includes('TODO')) {
    log('EXPAND', 'No project context, passing through')
    return {
      type: 'passthrough',
      calls: 0,
      context: null
    }
  }

  // Get available domains for classification
  const availableDomains = listDomains(root)
  log('EXPAND', `Available domains: ${availableDomains.join(', ') || 'none'}`)

  // 1. First call - classify prompt
  log('EXPAND', 'Classifying prompt...')
  const classification = await ai.classifyPrompt(prompt, projectLk, availableDomains)
  log('EXPAND', `Classification: ${JSON.stringify(classification)}`)

  // Block meta questions about the context system
  if (classification.block_reason) {
    log('EXPAND', `Blocked: ${classification.block_reason}`)
    return {
      type: 'blocked',
      calls: 1,
      context: null
    }
  }

  // Not a project question - pass through
  if (!classification.is_project) {
    log('EXPAND', 'Not a project question, passing through')
    return {
      type: 'passthrough',
      calls: 1,
      context: null
    }
  }

  // Direct answer available from project metadata
  if (classification.direct_answer) {
    log('EXPAND', 'Direct answer from project metadata')
    return {
      type: 'direct',
      calls: 1,
      context: {
        _instruction: 'use_answer',
        answer: classification.direct_answer
      }
    }
  }

  // Needs domain details
  const domainNames = classification.needs_domains || []
  if (domainNames.length === 0) {
    log('EXPAND', 'No domains needed, passing through')
    return {
      type: 'passthrough',
      calls: 1,
      context: null
    }
  }

  // 2. Load requested domains
  log('EXPAND', `Loading domains: ${domainNames.join(', ')}`)
  const domainContents = []

  for (const name of domainNames) {
    if (availableDomains.includes(name)) {
      const domain = loadDomain(root, name)
      if (domain) {
        domainContents.push(serializeDomain(domain))
      }
    }
  }

  if (domainContents.length === 0) {
    log('EXPAND', 'No domains found')
    return {
      type: 'passthrough',
      calls: 1,
      context: null
    }
  }

  // 3. Second call - expand with domain context
  const domainLk = domainContents.join('\n\n')
  log('EXPAND', `Expanding with ${domainContents.length} domain(s)...`)

  const expansion = await ai.expandPrompt(prompt, projectLk, domainLk)

  // Direct answer with domain context
  if (expansion.direct_answer) {
    log('EXPAND', 'Direct answer from domain context')
    return {
      type: 'direct',
      calls: 2,
      context: {
        _instruction: 'use_answer',
        answer: expansion.direct_answer
      }
    }
  }

  // Build file context
  const files = expansion.files || []
  if (files.length === 0) {
    log('EXPAND', 'No files specified')
    return {
      type: 'passthrough',
      calls: 2,
      context: null
    }
  }

  // 4. Extract code from files
  log('EXPAND', `Extracting context from ${files.length} file(s)`)
  const fileContext = {}

  for (const file of files) {
    // Remove @ prefix from path aliases (e.g. @app/... -> app/...)
    const cleanPath = file.path.startsWith('@') ? file.path.slice(1) : file.path
    const filePath = path.join(root, cleanPath)
    const functions = file.functions || null

    if (functions && functions.length > 0) {
      // Extract each function separately to avoid split issues
      fileContext[file.path] = {}
      for (const fnName of functions) {
        const fnContent = getFileContext(filePath, [fnName])
        if (fnContent) {
          fileContext[file.path][fnName] = fnContent
        }
      }
      // If no functions extracted, skip this file
      if (Object.keys(fileContext[file.path]).length === 0) {
        delete fileContext[file.path]
      }
    } else {
      // Full file content
      const content = getFileContext(filePath, null)
      if (content) {
        fileContext[file.path] = content
      }
    }
  }

  log('EXPAND', `Context built for ${Object.keys(fileContext).length} file(s)`)

  // If no files could be loaded, return passthrough
  if (Object.keys(fileContext).length === 0) {
    log('EXPAND', 'No file context extracted, returning passthrough')
    return {
      type: 'passthrough',
      calls: 2,
      context: null
    }
  }

  return {
    type: 'code_context',
    calls: 2,
    context: {
      _instruction: 'read_context',
      navigation_guide: expansion.navigation_guide || null,
      files: fileContext
    }
  }
}
