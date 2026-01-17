import { GoogleGenerativeAI } from '@google/generative-ai'
import { getApiKey, log } from './config.js'
import {
  buildAnalyzeFilePrompt,
  buildAnalyzeFilesPrompt,
  buildProjectPrompt,
  buildDescribeLkPrompt,
  buildIgnorePrompt,
  extractJsonFromText,
  generateDefaultResults,
  logLlmCall,
  logLlmResponse,
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
 * Make an API call to Gemini (with JSON mode)
 */
async function callJsonApi(prompt) {
  const startTime = logLlmCall('GEMINI', 'JSON API call', prompt.length)

  const result = await jsonModel.generateContent(prompt)
  const text = result.response?.text?.()?.trim() || null

  logLlmResponse('GEMINI', startTime)
  return text
}

/**
 * Make an API call to Gemini (text mode)
 */
async function callTextApi(prompt) {
  const startTime = logLlmCall('GEMINI', 'Text API call', prompt.length)

  const result = await model.generateContent(prompt)
  const text = result.response?.text?.()?.trim() || null

  logLlmResponse('GEMINI', startTime)
  return text
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
- "λ": Core logic, utilities, helpers
- "⇄": Interface, API, commands, entry points
- "⚙": Config files
- "⧫": Test files
- "▸": Entry point, main/index
- "⊚": UI Component

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
  "symbol": "string (one of: λ, ⇄, ⚙, ⧫, ▸, ⊚)",
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
- "λ": Core logic, utilities, helpers
- "⇄": Interface, API, commands, entry points
- "⚙": Config files
- "⧫": Test files
- "▸": Entry point, main/index
- "⊚": UI Component

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
  const text = await callJsonApi(prompt)

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
  const text = await callJsonApi(prompt)

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
  const text = await callTextApi(prompt)

  if (!text) {
    throw new Error('Empty response from API')
  }

  return text.replace(/```[a-z]*\n?/g, '').trim()
}

export async function describeLk({ file, content }) {
  if (!model) initClient()

  log('GEMINI', `describeLk: ${file} (${content.length} chars)`)

  const prompt = buildDescribeLkPrompt({ file, content })
  const text = await callTextApi(prompt)

  if (!text) {
    throw new Error('Empty response from API')
  }

  log('GEMINI', `Response: ${text}`)
  return text
}

export async function generateIgnore({ files, globalPatterns = [] }) {
  if (!model) initClient()

  log('GEMINI', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`)

  const prompt = buildIgnorePrompt({ files, globalPatterns })
  const text = await callTextApi(prompt)

  if (!text) {
    log('GEMINI', 'Empty response - no project-specific patterns')
    return []
  }

  const lines = text.split('\n').filter(l => l.trim())
  log('GEMINI', `Generated ${lines.length} ignore lines`)

  return lines
}
