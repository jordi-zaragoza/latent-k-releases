import Anthropic from '@anthropic-ai/sdk'
import { getApiKey, log } from './config.js'
import {
  buildAnalyzeFilePrompt,
  buildAnalyzeFilesPrompt,
  buildProjectPrompt,
  buildIgnorePrompt,
  buildClassifyPrompt,
  buildExpandPrompt,
  buildExpandPromptCompact,
  buildProjectSummaryPrompt,
  parseJsonResponse,
  generateDefaultResults,
  logLlmCall,
  logLlmResponse,
  recordError,
  DEFAULT_ANALYSIS
} from './ai-prompts.js'

const MODEL = 'claude-3-5-haiku-20241022'
let client = null

function initClient() {
  log('ANTHROPIC', 'Initializing client...')
  const apiKey = getApiKey('anthropic')
  if (!apiKey) throw new Error('Anthropic API key not configured. Run: lk setup')

  client = new Anthropic({ apiKey })
  log('ANTHROPIC', `Client ready (model: ${MODEL})`)
}

/**
 * Validate an API key by making a minimal API call
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateApiKey(apiKey) {
  try {
    const testClient = new Anthropic({ apiKey })
    await testClient.messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }]
    })
    return { valid: true }
  } catch (err) {
    const message = err.message || 'Unknown error'
    if (message.includes('401') || message.includes('invalid_api_key') || message.includes('authentication')) {
      return { valid: false, error: 'Invalid API key' }
    }
    if (message.includes('429') || message.includes('rate')) {
      // Rate limited but key is valid
      return { valid: true }
    }
    return { valid: false, error: message }
  }
}

/**
 * Check if the API is rate limited by making a minimal call
 * @returns {Promise<{ok: boolean, rateLimited: boolean, error?: string}>}
 */
export async function checkRateLimit() {
  if (!client) initClient()

  try {
    await client.messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }]
    })
    return { ok: true, rateLimited: false }
  } catch (err) {
    const message = err.message || 'Unknown error'
    if (message.includes('429') || message.includes('rate')) {
      return { ok: true, rateLimited: true }
    }
    if (message.includes('401') || message.includes('invalid_api_key') || message.includes('authentication')) {
      return { ok: false, rateLimited: false, error: 'Invalid API key' }
    }
    return { ok: false, rateLimited: false, error: message }
  }
}

/**
 * Make an API call to Anthropic
 * @param {string} prompt - The prompt to send
 * @param {number} maxTokens - Maximum tokens in response
 * @param {string} operationType - Logical operation type for stats tracking
 */
async function callApi(prompt, maxTokens = 256, operationType = null) {
  const tracking = logLlmCall('ANTHROPIC', 'API call', prompt.length, MODEL, operationType)

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content?.[0]?.text?.trim() || null
    logLlmResponse(tracking, text)
    return text
  } catch (err) {
    recordError({
      provider: 'ANTHROPIC',
      operation: 'API call',
      operationType,
      error: err.message
    })
    throw err
  }
}

export async function analyzeFile({ lkContent, file, content, action }) {
  if (!client) initClient()

  log('ANTHROPIC', `analyzeFile: ${action} ${file}`)
  log('ANTHROPIC', `Context: ${lkContent.length} chars, Content: ${content?.length || 0} chars`)

  const prompt = buildAnalyzeFilePrompt({ lkContent, file, content, action })
  const text = await callApi(prompt, 256, 'analyzeFile')

  if (!text) {
    log('ANTHROPIC', 'Empty response - using defaults')
    return DEFAULT_ANALYSIS
  }

  log('ANTHROPIC', `Response: ${text}`)
  const parsed = parseJsonResponse(text, DEFAULT_ANALYSIS)
  log('ANTHROPIC', 'Parsed result:', JSON.stringify(parsed))
  return parsed
}

export async function analyzeFiles({ lkContent, files }) {
  if (!client) initClient()

  if (files.length === 0) return []
  if (files.length === 1) {
    const result = await analyzeFile({ lkContent, ...files[0] })
    return [{ file: files[0].file, ...result }]
  }

  log('ANTHROPIC', `analyzeFiles: ${files.length} files`)
  log('ANTHROPIC', `Context: ${lkContent.length} chars`)

  const prompt = buildAnalyzeFilesPrompt({ lkContent, files })
  const text = await callApi(prompt, 2048, 'analyzeFiles')

  if (!text) {
    log('ANTHROPIC', 'Empty batch response - returning defaults')
    return generateDefaultResults(files)
  }

  const parsed = parseJsonResponse(text)
  if (Array.isArray(parsed)) {
    log('ANTHROPIC', `Parsed ${parsed.length} results`)
    return parsed
  }

  log('ANTHROPIC', 'Batch failed, returning defaults')
  return generateDefaultResults(files)
}

export async function generateProject({ files, packageJson, context }) {
  if (!client) initClient()

  log('ANTHROPIC', `generateProject: ${files.length} files, context: ${context?.length || 0} chars`)

  const prompt = buildProjectPrompt({ files, packageJson, context })
  const text = await callApi(prompt, 2048, 'generateProject')

  if (!text) {
    throw new Error('Empty response from API')
  }

  // Parse JSON response with lk and human versions
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    const parsed = JSON.parse(clean)
    if (parsed.lk && parsed.human) {
      return { lk: parsed.lk.trim(), human: parsed.human.trim() }
    }
  } catch (err) {
    log('ANTHROPIC', `Failed to parse project JSON: ${err.message}`)
  }

  // Fallback: treat entire response as lk content (backwards compatibility)
  return { lk: clean, human: null }
}

export async function generateIgnore({ files, globalPatterns = [] }) {
  if (!client) initClient()

  log('ANTHROPIC', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`)

  const prompt = buildIgnorePrompt({ files, globalPatterns })
  const text = await callApi(prompt, 1024, 'generateIgnore')

  if (!text) {
    log('ANTHROPIC', 'Empty response - no project-specific patterns')
    return []
  }

  const lines = text.split('\n').filter(l => l.trim())
  log('ANTHROPIC', `Generated ${lines.length} ignore lines`)

  return lines
}

/**
 * Classify a user prompt for context routing
 * @param {string} userPrompt - The user's prompt
 * @param {string} projectLk - Project metadata in LK format
 * @param {string[]} availableDomains - List of available domain names
 * @param {string|null} previousContext - Last assistant message for continuation detection
 * @returns {Promise<{is_project: boolean, is_continuation: boolean, direct_answer: string|null, needs_domains: string[]|null, block_reason: string|null}>}
 */
export async function classifyPrompt(userPrompt, projectLk, availableDomains = [], previousContext = null) {
  if (!client) initClient()

  log('ANTHROPIC', `classifyPrompt: ${userPrompt.slice(0, 100)}...`)
  if (previousContext) {
    log('ANTHROPIC', `Previous context: ${previousContext.slice(0, 100)}...`)
  }

  const prompt = buildClassifyPrompt(userPrompt, projectLk, availableDomains, previousContext)
  const text = await callApi(prompt, 512, 'classifyPrompt')

  if (!text) {
    log('ANTHROPIC', 'Empty response - defaulting to passthrough')
    return { is_project: false, is_continuation: false, direct_answer: null, needs_domains: null, block_reason: null }
  }

  const parsed = parseJsonResponse(text)
  if (parsed) {
    log('ANTHROPIC', `Classification: ${JSON.stringify(parsed)}`)
    return parsed
  }

  log('ANTHROPIC', 'Parse failed - defaulting to passthrough')
  return { is_project: false, is_continuation: false, direct_answer: null, needs_domains: null, block_reason: null }
}

/**
 * Expand a user prompt with domain context
 * @param {string} userPrompt - The user's prompt
 * @param {string} projectLk - Project metadata in LK format
 * @param {string} domainLk - Domain details in LK format
 * @returns {Promise<{direct_answer: string|null, files: Array<{path: string, functions?: string[]}>}>}
 */
export async function expandPrompt(userPrompt, projectLk, domainLk) {
  if (!client) initClient()

  log('ANTHROPIC', `expandPrompt: ${userPrompt.slice(0, 100)}...`)

  const prompt = buildExpandPrompt(userPrompt, projectLk, domainLk)
  const text = await callApi(prompt, 1024, 'expandPrompt')

  if (!text) {
    log('ANTHROPIC', 'Empty response - returning empty result')
    return { direct_answer: null, files: [] }
  }

  const parsed = parseJsonResponse(text)
  if (parsed) {
    log('ANTHROPIC', `Expansion: ${JSON.stringify(parsed)}`)
    return parsed
  }

  log('ANTHROPIC', 'Parse failed - returning empty result')
  return { direct_answer: null, files: [] }
}

/**
 * Expand a user prompt with compact context (reduced tokens)
 * @param {string} userPrompt - The user's prompt
 * @param {string} projectSummary - Compact project summary (Purpose + Stack + Flows)
 * @param {string} domainIndex - Compact domain index (paths + symbols only)
 * @returns {Promise<{direct_answer: string|null, navigation_guide: string|null, files: Array<{path: string, reason: string}>}>}
 */
export async function expandPromptCompact(userPrompt, projectSummary, domainIndex) {
  if (!client) initClient()

  log('ANTHROPIC', `expandPromptCompact: ${userPrompt.slice(0, 100)}...`)

  const prompt = buildExpandPromptCompact(userPrompt, projectSummary, domainIndex)
  const text = await callApi(prompt, 512, 'expandPromptCompact')

  if (!text) {
    log('ANTHROPIC', 'Empty response - returning empty result')
    return { direct_answer: null, navigation_guide: null, files: [] }
  }

  const parsed = parseJsonResponse(text)
  if (parsed) {
    log('ANTHROPIC', `Expansion: ${JSON.stringify(parsed)}`)
    return parsed
  }

  log('ANTHROPIC', 'Parse failed - returning empty result')
  return { direct_answer: null, navigation_guide: null, files: [] }
}

/**
 * Generate a concise project summary
 * @param {string} projectLk - Full project.lk content
 * @param {string[]} domainNames - List of domain names
 * @returns {Promise<string|null>} Project summary or null on failure
 */
export async function generateProjectSummary(projectLk, domainNames = []) {
  if (!client) initClient()

  log('ANTHROPIC', `generateProjectSummary: ${projectLk.length} chars, ${domainNames.length} domains`)

  const prompt = buildProjectSummaryPrompt(projectLk, domainNames)
  const text = await callApi(prompt, 256, 'generateProjectSummary')

  if (!text) {
    log('ANTHROPIC', 'Empty response - no summary generated')
    return null
  }

  return text.trim()
}
