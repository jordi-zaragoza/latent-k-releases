import Anthropic from '@anthropic-ai/sdk'
import { getApiKey, log } from './config.js'

let client = null

function initClient() {
  log('ANTHROPIC', 'Initializing client...')
  const apiKey = getApiKey('anthropic')
  if (!apiKey) throw new Error('Anthropic API key not configured. Run: lk setup')

  client = new Anthropic({ apiKey })
  log('ANTHROPIC', 'Client ready (model: claude-3-5-haiku)')
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
      model: 'claude-3-5-haiku-20241022',
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

export async function analyzeFile({ lkContent, file, content, action }) {
  if (!client) initClient()

  log('ANTHROPIC', `analyzeFile: ${action} ${file}`)
  log('ANTHROPIC', `Context: ${lkContent.length} chars, Content: ${content?.length || 0} chars`)

  const prompt = `Analyze this file and determine how to describe it in a .lk context file.

Current .lk context:
${lkContent}

File: ${file}
Action: ${action}
${content ? `Content:\n${content.slice(0, 3000)}` : ''}

Available symbols:
- λ (lambda): Core logic, pure functions, utilities, helpers
- ⇄: Interface, API, commands, entry points, routes
- ⚙: Config files (package.json, .env, tsconfig, etc)
- ⧫: Test files
- ▸: Entry point, main file, index
- ⊚: Component (UI, React, Vue, Svelte)

IMPORTANT: If the file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return {"ignore": true} instead.

Return ONLY a JSON object with this format, no markdown, no explanation:
{"symbol": "λ", "description": "brief description or null", "domain": "core"}
Or: {"ignore": true}

Rules:
- symbol: one of the symbols above, pick the most appropriate
- description: 3-6 keywords capturing key functionality (tools exposed, capabilities, purpose), or null if filename is self-explanatory
- domain: infer from file path structure:
  - src/commands/*, src/cli/* → "cli"
  - src/lib/*, src/utils/*, src/helpers/* → "core"
  - src/api/*, src/routes/*, src/controllers/* → "api"
  - src/components/*, src/ui/* → "ui"
  - test/*, __tests__/*, *.test.*, *.spec.* → "test"
  - If unclear, use "core" as default
  - Reuse existing domains from context when possible`

  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: analyzeFile(${file})`)
  log('ANTHROPIC', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }]
  })

  const elapsed = Date.now() - startTime

  if (!response.content?.[0]?.text) {
    log('ANTHROPIC', 'Empty response - using defaults')
    return { symbol: 'λ', description: null, domain: 'core' }
  }

  const text = response.content[0].text.trim()
  log('ANTHROPIC', `Response received in ${elapsed}ms: ${text}`)

  try {
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(clean)
    log('ANTHROPIC', 'Parsed result:', JSON.stringify(parsed))
    return parsed
  } catch (err) {
    log('ANTHROPIC', 'JSON parse error:', err.message, '- using defaults')
    return { symbol: 'λ', description: null, domain: 'core' }
  }
}

// Batch analyze multiple files at once
export async function analyzeFiles({ lkContent, files }) {
  if (!client) initClient()

  if (files.length === 0) return []
  if (files.length === 1) {
    const result = await analyzeFile({ lkContent, ...files[0] })
    return [{ file: files[0].file, ...result }]
  }

  log('ANTHROPIC', `analyzeFiles: ${files.length} files`)
  log('ANTHROPIC', `Context: ${lkContent.length} chars`)

  const filesSection = files.map((f, i) =>
    `[${i}] ${f.file} (${f.action})\n${f.content ? f.content.slice(0, 2000) : '(no content)'}`
  ).join('\n\n---\n\n')

  const prompt = `Analyze these ${files.length} files and determine how to describe them in a .lk context file.

Current .lk context:
${lkContent}

FILES TO ANALYZE:
${filesSection}

Available symbols:
- λ (lambda): Core logic, pure functions, utilities, helpers
- ⇄: Interface, API, commands, entry points, routes
- ⚙: Config files (package.json, .env, tsconfig, etc)
- ⧫: Test files
- ▸: Entry point, main file, index
- ⊚: Component (UI, React, Vue, Svelte)

IMPORTANT: If a file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return "ignore": true instead of symbol/domain.

Return ONLY a JSON array with this format, no markdown, no explanation. Each element MUST have "file" matching the input filename:
[
  {"file": "path/to/file1.js", "symbol": "λ", "description": "brief description or null", "domain": "core"},
  {"file": "path/to/file2.js", "ignore": true},
  {"file": "path/to/file3.js", "symbol": "⇄", "description": "brief description or null", "domain": "cli"}
]

Rules:
- symbol: one of the symbols above, pick the most appropriate
- description: 3-6 keywords capturing key functionality, or null if filename is self-explanatory
- domain: infer from file path structure:
  - src/commands/*, src/cli/* → "cli"
  - src/lib/*, src/utils/*, src/helpers/* → "core"
  - src/api/*, src/routes/*, src/controllers/* → "api"
  - src/components/*, src/ui/* → "ui"
  - test/*, __tests__/*, *.test.*, *.spec.* → "test"
  - If unclear, use "core" as default`

  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: analyzeFiles(${files.length} files)`)
  log('ANTHROPIC', `Sending batch prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }]
  })

  const elapsed = Date.now() - startTime
  log('ANTHROPIC', `Batch response received in ${elapsed}ms`)

  if (!response.content?.[0]?.text) {
    log('ANTHROPIC', 'Empty batch response - returning defaults')
    return files.map(f => ({ file: f.file, symbol: 'λ', description: null, domain: 'core' }))
  }

  const text = response.content[0].text.trim()

  try {
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(clean)
    if (Array.isArray(parsed)) {
      log('ANTHROPIC', `Parsed ${parsed.length} results`)
      return parsed
    }
  } catch (err) {
    log('ANTHROPIC', 'Batch JSON parse error:', err.message)
  }

  // Fallback: return defaults for all files
  log('ANTHROPIC', 'Batch failed, returning defaults')
  return files.map(f => ({ file: f.file, symbol: 'λ', description: null, domain: 'core' }))
}

export async function generateProject({ files, packageJson, context }) {
  if (!client) initClient()

  log('ANTHROPIC', `generateProject: ${files.length} files, context: ${context?.length || 0} chars`)

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
  log('ANTHROPIC', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })

  const elapsed = Date.now() - startTime
  log('ANTHROPIC', `Response received in ${elapsed}ms`)

  if (!response.content?.[0]?.text) {
    throw new Error('Empty response from API')
  }

  return response.content[0].text.trim().replace(/```[a-z]*\n?/g, '').trim()
}

export async function describeLk({ file, content }) {
  if (!client) initClient()

  log('ANTHROPIC', `describeLk: ${file} (${content.length} chars)`)

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
  log('ANTHROPIC', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }]
  })

  const elapsed = Date.now() - startTime

  if (!response.content?.[0]?.text) {
    throw new Error('Empty response from API')
  }

  const text = response.content[0].text.trim()
  log('ANTHROPIC', `Response received in ${elapsed}ms: ${text}`)

  return text
}

export async function generateIgnore({ files, globalPatterns = [] }) {
  if (!client) initClient()

  log('ANTHROPIC', `generateIgnore: ${files.length} files, ${globalPatterns.length} global patterns`)

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
  log('ANTHROPIC', `Sending prompt (${prompt.length} chars)...`)
  const startTime = Date.now()

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  })

  const elapsed = Date.now() - startTime

  if (!response.content?.[0]?.text) {
    log('ANTHROPIC', 'Empty response - no project-specific patterns')
    return []
  }

  const text = response.content[0].text.trim()
  log('ANTHROPIC', `Response received in ${elapsed}ms`)

  const lines = text.split('\n').filter(l => l.trim())
  log('ANTHROPIC', `Generated ${lines.length} ignore lines`)

  return lines
}
