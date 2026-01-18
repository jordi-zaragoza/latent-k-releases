import { GoogleGenerativeAI } from '@google/generative-ai'
import { getApiKey, log } from './config.js'
import {
  buildAnalyzeFilePrompt,
  buildAnalyzeFilesPrompt,
  buildProjectPrompt,
  buildIgnorePrompt,
  buildClassifyPrompt,
  buildExpandPrompt,
  buildExpandPromptCompact,
  extractJsonFromText,
  generateDefaultResults,
  logLlmCall,
  logLlmResponse,
  recordError,
  DEFAULT_ANALYSIS
} from './ai-prompts.js'

const MODEL = 'gemini-2.5-flash'
let genAI = null
let model = null
let jsonModel = null

function initClient() {
  log('GEMINI', 'Initializing client...')
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('Gemini API key not configured. Run: lk setup')

  genAI = new GoogleGenerativeAI(apiKey)
  model = genAI.getGenerativeModel({ model: MODEL })
  jsonModel = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: 'application/json'
    }
  })
  log('GEMINI', `Client ready (model: ${MODEL})`)
}

/**
 * Validate an API key by making a minimal API call
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateApiKey(apiKey) {
  try {
    const testAI = new GoogleGenerativeAI(apiKey)
    const testModel = testAI.getGenerativeModel({ model: MODEL })
    await testModel.generateContent('Hi')
    return { valid: true }
  } catch (err) {
    const message = err.message || 'Unknown error'
    if (message.includes('API_KEY_INVALID') || message.includes('401') || message.includes('403')) {
      return { valid: false, error: 'Invalid API key' }
    }
    if (message.includes('429') || message.includes('quota') || message.includes('rate')) {
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
  if (!model) initClient()

  try {
    await model.generateContent('.')
    return { ok: true, rateLimited: false }
  } catch (err) {
    const message = err.message || 'Unknown error'
    if (message.includes('429') || message.includes('quota') || message.includes('rate')) {
      return { ok: true, rateLimited: true }
    }
    if (message.includes('API_KEY_INVALID') || message.includes('401') || message.includes('403')) {
      return { ok: false, rateLimited: false, error: 'Invalid API key' }
    }
    return { ok: false, rateLimited: false, error: message }
  }
}

/**
 * Make an API call to Gemini (with JSON mode)
 * @param {string} prompt - The prompt to send
 * @param {string} operationType - Logical operation type for stats tracking
 */
async function callJsonApi(prompt, operationType = null) {
  const tracking = logLlmCall('GEMINI', 'JSON API call', prompt.length, MODEL, operationType)

  try {
    const result = await jsonModel.generateContent(prompt)
    const text = result.response?.text?.()?.trim() || null

    logLlmResponse(tracking, text)
    return text
  } catch (err) {
    recordError({
      provider: 'GEMINI',
      operation: 'JSON API call',
      operationType,
      error: err.message
    })
    throw err
  }
}

/**
 * Make an API call to Gemini (text mode)
 * @param {string} prompt - The prompt to send
 * @param {string} operationType - Logical operation type for stats tracking
 */
async function callTextApi(prompt, operationType = null) {
  const tracking = logLlmCall('GEMINI', 'Text API call', prompt.length, MODEL, operationType)

  try {
    const result = await model.generateContent(prompt)
    const text = result.response?.text?.()?.trim() || null

    logLlmResponse(tracking, text)
    return text
  } catch (err) {
    recordError({
      provider: 'GEMINI',
      operation: 'Text API call',
      operationType,
      error: err.message
    })
    throw err
  }
}

/**
 * Build Gemini-specific analyze file prompt (JSON-focused)
 */
function buildGeminiAnalyzePrompt({ lkContent, file, content, action }) {
  return `You are a JSON-only response bot. Analyze this file for a .lk context file.

File: ${file}
Action: ${action}
${content ? `Content:\n${content.slice(0, 3000)}` : ''}

Current .lk context:
${lkContent}

Symbols (pick ONE):
- "▸": Entry point, main/index
- "⇄": Interface, API, commands, entry points
- "λ": Core logic, utilities, helpers
- "⚙": Config files
- "⧫": Test files
- "⊚": UI Component
- "⟐": Schema, types, models
- "◈": Background jobs, workers, queues
- "⤳": Pipeline, workflow, process
- "⚑": State management (store, reducer)

Domain rules:
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/* → "core"
- src/api/*, src/routes/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, *.test.*, *.spec.* → "test"
- Default: "core"

IMPORTANT: If the file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return {"ignore": true} instead.

Respond with this JSON schema:
{
  "symbol": "string (one of: ▸, ⇄, λ, ⚙, ⧫, ⊚, ⟐, ◈, ⤳, ⚑)",
  "description": "string (3-6 keywords) or null",
  "domain": "string"
}
Or: {"ignore": true}`
}

/**
 * Build Gemini-specific batch analyze prompt
 */
function buildGeminiBatchPrompt({ lkContent, files }) {
  const filesSection = files.map((f, i) =>
    `[${i}] ${f.file} (${f.action})\n${f.content ? f.content.slice(0, 2000) : '(no content)'}`
  ).join('\n\n---\n\n')

  return `You are a JSON-only response bot. Analyze these ${files.length} files for a .lk context file.

FILES TO ANALYZE:
${filesSection}

Current .lk context:
${lkContent}

Symbols (pick ONE per file):
- "▸": Entry point, main/index
- "⇄": Interface, API, commands, entry points
- "λ": Core logic, utilities, helpers
- "⚙": Config files
- "⧫": Test files
- "⊚": UI Component
- "⟐": Schema, types, models
- "◈": Background jobs, workers, queues
- "⤳": Pipeline, workflow, process
- "⚑": State management (store, reducer)

Domain rules:
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/* → "core"
- src/api/*, src/routes/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, *.test.*, *.spec.* → "test"
- Default: "core"

IMPORTANT: If a file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return "ignore": true instead of symbol/domain.

Respond with a JSON array. Each element MUST have "file" matching the input filename:
[
  { "file": "path/to/file1.js", "symbol": "λ", "description": "keywords", "domain": "core" },
  { "file": "path/to/file2.js", "ignore": true },
  { "file": "path/to/file3.js", "symbol": "⇄", "description": "keywords", "domain": "cli" }
]`
}

export async function analyzeFile({ lkContent, file, content, action }) {
  if (!model) initClient()

  log('GEMINI', `analyzeFile: ${action} ${file}`)
  log('GEMINI', `Context: ${lkContent.length} chars, Content: ${content?.length || 0} chars`)

  const prompt = buildGeminiAnalyzePrompt({ lkContent, file, content, action })
  const text = await callJsonApi(prompt, 'analyzeFile')

  if (!text) {
    log('GEMINI', 'Empty response - using defaults')
    return DEFAULT_ANALYSIS
  }

  log('GEMINI', `Response: ${text}`)

  // Try direct parse, then fallback to extraction
  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('GEMINI', 'Parsed result:', JSON.stringify(parsed))
    return parsed
  }

  log('GEMINI', 'Parse failed - using defaults')
  return DEFAULT_ANALYSIS
}

export async function analyzeFiles({ lkContent, files }) {
  if (!model) initClient()

  if (files.length === 0) return []
  if (files.length === 1) {
    const result = await analyzeFile({ lkContent, ...files[0] })
    return [{ file: files[0].file, ...result }]
  }

  log('GEMINI', `analyzeFiles: ${files.length} files`)
  log('GEMINI', `Context: ${lkContent.length} chars`)

  const prompt = buildGeminiBatchPrompt({ lkContent, files })
  const text = await callJsonApi(prompt, 'analyzeFiles')

  if (!text) {
    log('GEMINI', 'Empty batch response - returning defaults')
    return generateDefaultResults(files)
  }

  const parsed = extractJsonFromText(text, true)
  if (parsed) {
    log('GEMINI', `Parsed ${parsed.length} results`)
    return parsed
  }

  log('GEMINI', 'Batch failed, returning defaults')
  return generateDefaultResults(files)
}

export async function generateProject({ files, packageJson, context }) {
  if (!model) initClient()

  log('GEMINI', `generateProject: ${files.length} files, context: ${context?.length || 0} chars`)

  const prompt = buildProjectPrompt({ files, packageJson, context })
  const text = await callTextApi(prompt, 'generateProject')

  if (!text) {
    throw new Error('Empty response from API')
  }

  return text.replace(/```[a-z]*\n?/g, '').trim()
}

export async function generateIgnore({ files, globalPatterns = [] }) {
  if (!model) initClient()

  log('GEMINI', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`)

  const prompt = buildIgnorePrompt({ files, globalPatterns })
  const text = await callTextApi(prompt, 'generateIgnore')

  if (!text) {
    log('GEMINI', 'Empty response - no project-specific patterns')
    return []
  }

  const lines = text.split('\n').filter(l => l.trim())
  log('GEMINI', `Generated ${lines.length} ignore lines`)

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
  if (!model) initClient()

  log('GEMINI', `classifyPrompt: ${userPrompt.slice(0, 100)}...`)
  if (previousContext) {
    log('GEMINI', `Previous context: ${previousContext.slice(0, 100)}...`)
  }

  const prompt = buildClassifyPrompt(userPrompt, projectLk, availableDomains, previousContext)
  const text = await callJsonApi(prompt, 'classifyPrompt')

  if (!text) {
    log('GEMINI', 'Empty response - defaulting to passthrough')
    return { is_project: false, is_continuation: false, direct_answer: null, needs_domains: null, block_reason: null }
  }

  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('GEMINI', `Classification: ${JSON.stringify(parsed)}`)
    return parsed
  }

  log('GEMINI', 'Parse failed - defaulting to passthrough')
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
  if (!model) initClient()

  log('GEMINI', `expandPrompt: ${userPrompt.slice(0, 100)}...`)

  const prompt = buildExpandPrompt(userPrompt, projectLk, domainLk)
  const text = await callJsonApi(prompt, 'expandPrompt')

  if (!text) {
    log('GEMINI', 'Empty response - returning empty result')
    return { direct_answer: null, files: [] }
  }

  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('GEMINI', `Expansion: ${JSON.stringify(parsed)}`)
    return parsed
  }

  log('GEMINI', 'Parse failed - returning empty result')
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
  if (!model) initClient()

  log('GEMINI', `expandPromptCompact: ${userPrompt.slice(0, 100)}...`)

  const prompt = buildExpandPromptCompact(userPrompt, projectSummary, domainIndex)
  const text = await callJsonApi(prompt, 'expandPromptCompact')

  if (!text) {
    log('GEMINI', 'Empty response - returning empty result')
    return { direct_answer: null, navigation_guide: null, files: [] }
  }

  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('GEMINI', `Expansion: ${JSON.stringify(parsed)}`)
    return parsed
  }

  log('GEMINI', 'Parse failed - returning empty result')
  return { direct_answer: null, navigation_guide: null, files: [] }
}
