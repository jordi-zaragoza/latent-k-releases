import Anthropic from '@anthropic-ai/sdk'
import { getApiKey, log } from './config.js'
import {
  buildProjectPrompt,
  buildIgnorePrompt,
  buildClassifyPrompt,
  buildExpandPrompt,
  buildExpandPromptCompact,
  buildProjectSummaryPrompt,
  extractJsonFromText,
  generateDefaultResults,
  logLlmCall,
  logLlmResponse,
  recordError,
  DEFAULT_ANALYSIS
} from './ai-prompts.js'
const MODEL = 'claude-3-5-haiku-20241022'
const MODEL_LITE = 'claude-3-5-haiku-20241022'
let client = null
let curKey = null
function initClient() {
  const apiKey = getApiKey('anthropic')
  if (!apiKey) throw new Error('Anthropic API key not configured. Run: lk setup')
  if (client && curKey === apiKey) return
  log('ANTHROPIC', 'Initializing client...')
  client = new Anthropic({ apiKey })
  curKey = apiKey
  log('ANTHROPIC', `Client ready (models: ${MODEL}, ${MODEL_LITE})`)
}
function buildAnthropicAnalyzePrompt({ lkContent, file, content, action }) {
  return `You are a JSON-only response bot. Analyze this file for a .lk context file.
File: ${file}
Action: ${action}
${content ? `Content:\n${content.slice(0, 3000)}` : ''}
Current .lk context:
${lkContent}
Symbols (pick ONE based on PRIMARY purpose):
- "▸": Entry point - main.js, index.js, app bootstrap, server start
- "⇄": Interface - CLI commands, API routes, HTTP handlers, external contracts
- "λ": Logic - utilities, helpers, pure functions, business logic, algorithms
- "⚙": Config - settings, env, constants, feature flags
- "⧫": Test - unit tests, integration tests, e2e tests, fixtures
- "⊚": UI - React/Vue/Svelte components, templates, views
- "⟐": Schema - types, interfaces, models, DB schemas, validation
- "◈": Background - workers, queues, cron jobs, async processors
- "⤳": Pipeline - ETL, build scripts, data transforms, workflows
- "⚑": State - Redux stores, Vuex, Zustand, state machines
Domain rules:
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/* → "core"
- src/api/*, src/routes/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, *.test.*, *.spec.* → "test"
- Default: "core"
IMPORTANT: If the file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return {"ignore": true} instead.
Respond JSON. description = concise docstring (1 line, ~10 words max):
{"symbol": "▸|⇄|λ|⚙|⧫|⊚|⟐|◈|⤳|⚑", "description": "Syncs project context with AI", "domain": "string"}
Or: {"ignore": true}`
}
function buildAnthropicBatchPrompt({ lkContent, files }) {
  const filesSection = files.map((f, i) =>
    `[${i}] ${f.file} (${f.action})\n${f.content ? f.content.slice(0, 2000) : '(no content)'}`
  ).join('\n\n---\n\n')
  return `You are a JSON-only response bot. Analyze these ${files.length} files for a .lk context file.
FILES TO ANALYZE:
${filesSection}
Current .lk context:
${lkContent}
Symbols (pick ONE per file based on PRIMARY purpose):
- "▸": Entry point - main.js, index.js, app bootstrap, server start
- "⇄": Interface - CLI commands, API routes, HTTP handlers, external contracts
- "λ": Logic - utilities, helpers, pure functions, business logic, algorithms
- "⚙": Config - settings, env, constants, feature flags
- "⧫": Test - unit tests, integration tests, e2e tests, fixtures
- "⊚": UI - React/Vue/Svelte components, templates, views
- "⟐": Schema - types, interfaces, models, DB schemas, validation
- "◈": Background - workers, queues, cron jobs, async processors
- "⤳": Pipeline - ETL, build scripts, data transforms, workflows
- "⚑": State - Redux stores, Vuex, Zustand, state machines
Domain rules:
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/* → "core"
- src/api/*, src/routes/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, *.test.*, *.spec.* → "test"
- Default: "core"
IMPORTANT: If a file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return "ignore": true instead.
Respond JSON array. description = concise docstring (1 line, ~10 words max):
[
  { "file": "path/to/file1.js", "symbol": "λ", "description": "Parses source files into AST tokens", "domain": "core" },
  { "file": "path/to/file2.js", "ignore": true },
  { "file": "path/to/file3.js", "symbol": "⇄", "description": "Syncs project context with AI backend", "domain": "cli" }
]`
}
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
    if (message.includes('429') || message.includes('rate')) return { valid: true }
    return { valid: false, error: message }
  }
}
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
async function callApi(prompt, maxTokens = 256, operationType = null, lite = false) {
  const m = lite ? MODEL_LITE : MODEL
  const tracking = logLlmCall('ANTHROPIC', 'API call', prompt.length, m, operationType)
  try {
    const response = await client.messages.create({
      model: m,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
    const text = response.content?.[0]?.text?.trim() || null
    logLlmResponse(tracking, text)
    return text
  } catch (err) {
    recordError({ provider: 'ANTHROPIC', operation: 'API call', operationType, error: err.message })
    throw err
  }
}
export async function analyzeFile({ lkContent, file, content, action }) {
  if (!client) initClient()
  log('ANTHROPIC', `analyzeFile: ${action} ${file}`)
  log('ANTHROPIC', `Context: ${lkContent.length} chars, Content: ${content?.length || 0} chars`)
  const prompt = buildAnthropicAnalyzePrompt({ lkContent, file, content, action })
  const text = await callApi(prompt, 256, 'analyzeFile', true)
  if (!text) {
    log('ANTHROPIC', 'Empty response - using defaults')
    return DEFAULT_ANALYSIS
  }
  log('ANTHROPIC', `Response: ${text}`)
  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('ANTHROPIC', 'Parsed result:', JSON.stringify(parsed))
    return parsed
  }
  log('ANTHROPIC', 'Parse failed - using defaults')
  return DEFAULT_ANALYSIS
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
  const prompt = buildAnthropicBatchPrompt({ lkContent, files })
  const text = await callApi(prompt, 2048, 'analyzeFiles', true)
  if (!text) {
    log('ANTHROPIC', 'Empty batch response - returning defaults')
    return generateDefaultResults(files)
  }
  const parsed = extractJsonFromText(text, true)
  if (parsed) {
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
  if (!text) throw new Error('Empty response from API')
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try {
    const parsed = JSON.parse(clean)
    if (parsed.lk && parsed.human) return { lk: parsed.lk.trim(), human: parsed.human.trim() }
  } catch (err) {
    log('ANTHROPIC', `Failed to parse project JSON: ${err.message}`)
  }
  return { lk: clean, human: null }
}
export async function generateIgnore({ files, globalPatterns = [] }) {
  if (!client) initClient()
  log('ANTHROPIC', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`)
  const prompt = buildIgnorePrompt({ files, globalPatterns })
  const text = await callApi(prompt, 1024, 'generateIgnore', true)
  if (!text) {
    log('ANTHROPIC', 'Empty response - no project-specific patterns')
    return []
  }
  const lines = text.split('\n').filter(l => l.trim())
  log('ANTHROPIC', `Generated ${lines.length} ignore lines`)
  return lines
}
export async function classifyPrompt(userPrompt, projectLk, availableDomains = [], previousContext = null) {
  if (!client) initClient()
  log('ANTHROPIC', `classifyPrompt: ${userPrompt.slice(0, 100)}...`)
  if (previousContext) log('ANTHROPIC', `Previous context: ${previousContext.slice(0, 100)}...`)
  const prompt = buildClassifyPrompt(userPrompt, projectLk, availableDomains, previousContext)
  const text = await callApi(prompt, 512, 'classifyPrompt', true)
  if (!text) {
    log('ANTHROPIC', 'Empty response - defaulting to passthrough')
    return { is_project: false, is_continuation: false, direct_answer: null, needs_domains: null, block_reason: null }
  }
  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('ANTHROPIC', `Classification: ${JSON.stringify(parsed)}`)
    return parsed
  }
  log('ANTHROPIC', 'Parse failed - defaulting to passthrough')
  return { is_project: false, is_continuation: false, direct_answer: null, needs_domains: null, block_reason: null }
}
export async function expandPrompt(userPrompt, projectLk, domainLk) {
  if (!client) initClient()
  log('ANTHROPIC', `expandPrompt: ${userPrompt.slice(0, 100)}...`)
  const prompt = buildExpandPrompt(userPrompt, projectLk, domainLk)
  const text = await callApi(prompt, 1024, 'expandPrompt')
  if (!text) {
    log('ANTHROPIC', 'Empty response - returning empty result')
    return { direct_answer: null, files: [] }
  }
  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('ANTHROPIC', `Expansion: ${JSON.stringify(parsed)}`)
    return parsed
  }
  log('ANTHROPIC', 'Parse failed - returning empty result')
  return { direct_answer: null, files: [] }
}
export async function expandPromptCompact(userPrompt, projectSummary, domainIndex, previousContext = null) {
  if (!client) initClient()
  log('ANTHROPIC', `expandPromptCompact: ${userPrompt.slice(0, 100)}...`)
  if (previousContext) log('ANTHROPIC', `Including previous context: ${previousContext.length} chars`)
  const prompt = buildExpandPromptCompact(userPrompt, projectSummary, domainIndex, previousContext)
  const text = await callApi(prompt, 512, 'expandPromptCompact')
  if (!text) {
    log('ANTHROPIC', 'Empty response - returning empty result')
    return { direct_answer: null, navigation_guide: null, files: [] }
  }
  const parsed = extractJsonFromText(text, false)
  if (parsed) {
    log('ANTHROPIC', `Expansion: ${JSON.stringify(parsed)}`)
    return parsed
  }
  log('ANTHROPIC', 'Parse failed - returning empty result')
  return { direct_answer: null, navigation_guide: null, files: [] }
}
export async function generateProjectSummary(projectLk, domainNames = []) {
  if (!client) initClient()
  log('ANTHROPIC', `generateProjectSummary: ${projectLk.length} chars, ${domainNames.length} domains`)
  const prompt = buildProjectSummaryPrompt(projectLk, domainNames)
  const text = await callApi(prompt, 256, 'generateProjectSummary', true)
  if (!text) {
    log('ANTHROPIC', 'Empty response - no summary generated')
    return null
  }
  return text.trim()
}