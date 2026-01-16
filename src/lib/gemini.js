import { GoogleGenerativeAI } from '@google/generative-ai'
import { getApiKey, log } from './config.js'

let genAI = null
let model = null
let jsonModel = null

function initClient() {
  log('GEMINI', 'Initializing client...')
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('Gemini API key not configured. Run: lk setup')

  genAI = new GoogleGenerativeAI(apiKey)
  model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  jsonModel = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json'
    }
  })
  log('GEMINI', 'Client ready (model: gemini-2.5-flash)')
}

/**
 * Validate an API key by making a minimal API call
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateApiKey(apiKey) {
  try {
    const testAI = new GoogleGenerativeAI(apiKey)
    const testModel = testAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
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

export async function analyzeFile({ lkContent, file, content, action }) {
  if (!model) initClient()

  log('GEMINI', `analyzeFile: ${action} ${file}`)
  log('GEMINI', `Context: ${lkContent.length} chars, Content: ${content?.length || 0} chars`)

  const prompt = `You are a JSON-only response bot. Analyze this file for a .lk context file.

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

  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: analyzeFile(${file})`)
  log('GEMINI', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const result = await jsonModel.generateContent(prompt)
  const elapsed = Date.now() - startTime

  const responseText = result.response?.text?.()
  if (!responseText) {
    log('GEMINI', 'Empty response - using defaults')
    return { symbol: 'λ', description: null, domain: 'core' }
  }

  const text = responseText.trim()
  log('GEMINI', `Response received in ${elapsed}ms: ${text}`)

  try {
    const parsed = JSON.parse(text)
    log('GEMINI', 'Parsed result:', JSON.stringify(parsed))
    return parsed
  } catch (err) {
    // Fallback: try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*?"symbol"[\s\S]*?"description"[\s\S]*?"domain"[\s\S]*?\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        log('GEMINI', 'Extracted JSON:', JSON.stringify(parsed))
        return parsed
      } catch (extractErr) {
        log('GEMINI', 'JSON extraction failed:', extractErr.message)
      }
    }
    log('GEMINI', 'JSON parse error:', err.message, '- using defaults')
    return { symbol: 'λ', description: null, domain: 'core' }
  }
}

// Batch analyze multiple files at once
export async function analyzeFiles({ lkContent, files }) {
  if (!model) initClient()

  if (files.length === 0) return []
  if (files.length === 1) {
    const result = await analyzeFile({ lkContent, ...files[0] })
    return [{ file: files[0].file, ...result }]
  }

  log('GEMINI', `analyzeFiles: ${files.length} files`)
  log('GEMINI', `Context: ${lkContent.length} chars`)

  const filesSection = files.map((f, i) =>
    `[${i}] ${f.file} (${f.action})\n${f.content ? f.content.slice(0, 2000) : '(no content)'}`
  ).join('\n\n---\n\n')

  const prompt = `You are a JSON-only response bot. Analyze these ${files.length} files for a .lk context file.

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

  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: analyzeFiles(${files.length} files)`)
  log('GEMINI', `Sending batch prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const result = await jsonModel.generateContent(prompt)
  const elapsed = Date.now() - startTime
  log('GEMINI', `Batch response received in ${elapsed}ms`)

  const responseText = result.response?.text?.()
  if (!responseText) {
    log('GEMINI', 'Empty batch response - returning defaults')
    return files.map(f => ({ file: f.file, symbol: 'λ', description: null, domain: 'core' }))
  }

  const text = responseText.trim()

  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) {
      log('GEMINI', `Parsed ${parsed.length} results`)
      return parsed
    }
  } catch (err) {
    // Fallback: try to extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          log('GEMINI', `Extracted ${parsed.length} results`)
          return parsed
        }
      } catch (extractErr) {
        log('GEMINI', 'Batch JSON extraction failed:', extractErr.message)
      }
    }
    log('GEMINI', 'Batch JSON parse error:', err.message)
  }

  // Fallback: return defaults for all files
  log('GEMINI', 'Batch failed, returning defaults')
  return files.map(f => ({ file: f.file, symbol: 'λ', description: null, domain: 'core' }))
}

export async function generateProject({ files, packageJson, context }) {
  if (!model) initClient()

  log('GEMINI', `generateProject: ${files.length} files, context: ${context?.length || 0} chars`)

  const prompt = `Analyze this project and generate a project.lk metadata file.

${context ? `Current context (with file descriptions):\n${context}\n` : `Files in project:\n${files.join('\n')}\n`}
${packageJson ? `package.json:\n${packageJson}` : ''}

Generate a project.lk file with this EXACT format (fill in the values):

⦓ID: PROJECT⦔
⟪VIBE: [1-3 adjectives describing the project style]⟫ ⟪NAME: [project name]⟫ ⟪VERSION: [version or 0.1.0]⟫

⟦Δ: Purpose⟧
[1-2 sentences describing what the project does]

⟦Δ: Stack⟧
∑ Tech [Runtime⇨[node/python/go/etc], Type⇨[CLI/API/Web/Library]]

⟦Δ: Flows⟧
∑ Flows [
  [flow1: input → process → output],
  [flow2: trigger → action → result]
]
(List main data/control flows using → arrows. Examples: CLI[cmd] → parse → execute → output, HTTP[req] → router → handler → response)

Return ONLY the project.lk content, no markdown, no explanation.`

  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: generateProject`)
  log('GEMINI', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const result = await model.generateContent(prompt)
  const elapsed = Date.now() - startTime
  log('GEMINI', `Response received in ${elapsed}ms`)

  const responseText = result.response?.text?.()
  if (!responseText) {
    throw new Error('Empty response from API')
  }

  // Clean markdown if present
  return responseText.trim().replace(/```[a-z]*\n?/g, '').trim()
}

export async function describeLk({ file, content }) {
  if (!model) initClient()

  log('GEMINI', `describeLk: ${file} (${content.length} chars)`)

  const prompt = `Analyze this file and generate a .lk entry.

File: ${file}
Content:
${content}

Generate a single .lk entry line with:
- Appropriate symbol (λ for core logic, ⇄ for interface/API, ⚙ for config, ⧫ for test, etc.)
- Filename
- Brief description in quotes if not obvious from name
- Exports in {braces} if applicable

Return ONLY the entry line, nothing else.
Example: λ auth.js "handles JWT tokens" {login, logout, refresh}`

  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: describeLk(${file})`)
  log('GEMINI', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const result = await model.generateContent(prompt)
  const elapsed = Date.now() - startTime

  const responseText = result.response?.text?.()
  if (!responseText) {
    throw new Error('Empty response from API')
  }

  const text = responseText.trim()
  log('GEMINI', `Response received in ${elapsed}ms: ${text}`)

  return text
}

export async function generateIgnore({ files, globalPatterns = [] }) {
  if (!model) initClient()

  log('GEMINI', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`)

  const prompt = `Analyze this project file tree and generate PROJECT-SPECIFIC ignore patterns.

FILE TREE:
${files.join('\n')}

ALREADY IGNORED (global config - DO NOT include these):
${globalPatterns.join('\n')}

Generate patterns for files that should be ignored, such as:
- Virtual environments (venv, .venv, env, .env directories)
- Generated files specific to this project
- Data/fixture files that are large or not useful
- Project-specific build artifacts not covered by global patterns

Rules:
- Check the ALREADY IGNORED list above - only add patterns NOT already covered
- ONLY include patterns for things that ACTUALLY EXIST in the tree
- ALWAYS include virtual environment directories if present and not already ignored
- Return empty if nothing needs ignoring

Return ONLY project-specific patterns, one per line. Empty response is OK.`

  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: generateIgnore`)
  log('GEMINI', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const result = await model.generateContent(prompt)
  const elapsed = Date.now() - startTime

  const responseText = result.response?.text?.()
  if (!responseText) {
    log('GEMINI', 'Empty response - no project-specific patterns')
    return []
  }

  const text = responseText.trim()
  log('GEMINI', `Response received in ${elapsed}ms`)

  // Parse response into array of patterns (keeping comments)
  const lines = text.split('\n').filter(l => l.trim())
  log('GEMINI', `Generated ${lines.length} ignore lines`)

  return lines
}
