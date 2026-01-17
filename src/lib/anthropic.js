import Anthropic from '@anthropic-ai/sdk'
import { getApiKey, log } from './config.js'
import {
  buildAnalyzeFilePrompt,
  buildAnalyzeFilesPrompt,
  buildProjectPrompt,
  buildDescribeLkPrompt,
  buildIgnorePrompt,
  buildClassifyPrompt,
  buildExpandPrompt,
  parseJsonResponse,
  generateDefaultResults,
  logLlmCall,
  logLlmResponse,
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
 * Make an API call to Anthropic
 */
async function callApi(prompt, maxTokens = 256) {
  const startTime = logLlmCall('ANTHROPIC', 'API call', prompt.length)

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  })

  logLlmResponse('ANTHROPIC', startTime)
  return response.content?.[0]?.text?.trim() || null
}

export async function analyzeFile({ lkContent, file, content, action }) {
  if (!client) initClient()

  log('ANTHROPIC', `analyzeFile: ${action} ${file}`)
  log('ANTHROPIC', `Context: ${lkContent.length} chars, Content: ${content?.length || 0} chars`)

  const prompt = buildAnalyzeFilePrompt({ lkContent, file, content, action })
  const text = await callApi(prompt, 256)

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
  const text = await callApi(prompt, 2048)

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
  const text = await callApi(prompt, 1024)

  if (!text) {
    throw new Error('Empty response from API')
  }

  return text.replace(/```[a-z]*\n?/g, '').trim()
}

export async function describeLk({ file, content }) {
  if (!client) initClient()

  log('ANTHROPIC', `describeLk: ${file} (${content.length} chars)`)

  const prompt = buildDescribeLkPrompt({ file, content })
  const text = await callApi(prompt, 256)

  if (!text) {
    throw new Error('Empty response from API')
  }

  log('ANTHROPIC', `Response: ${text}`)
  return text
}

export async function generateIgnore({ files, globalPatterns = [] }) {
  if (!client) initClient()

  log('ANTHROPIC', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`)

  const prompt = buildIgnorePrompt({ files, globalPatterns })
  const text = await callApi(prompt, 1024)

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
 * @returns {Promise<{is_project: boolean, direct_answer: string|null, needs_domains: string[]|null, block_reason: string|null}>}
 */
export async function classifyPrompt(userPrompt, projectLk, availableDomains = []) {
  if (!client) initClient()

  log('ANTHROPIC', `classifyPrompt: ${userPrompt.slice(0, 100)}...`)

  const prompt = buildClassifyPrompt(userPrompt, projectLk, availableDomains)
  const text = await callApi(prompt, 512)

  if (!text) {
    log('ANTHROPIC', 'Empty response - defaulting to passthrough')
    return { is_project: false, direct_answer: null, needs_domains: null, block_reason: null }
  }

  const parsed = parseJsonResponse(text)
  if (parsed) {
    log('ANTHROPIC', `Classification: ${JSON.stringify(parsed)}`)
    return parsed
  }

  log('ANTHROPIC', 'Parse failed - defaulting to passthrough')
  return { is_project: false, direct_answer: null, needs_domains: null, block_reason: null }
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
  const text = await callApi(prompt, 1024)

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
