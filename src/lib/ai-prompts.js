/**
 * Shared AI prompts and utilities for LK providers
 * This module extracts common logic from anthropic.js and gemini.js
 */

import { log } from './config.js'

// Available symbols for file classification
export const SYMBOLS = {
  LAMBDA: 'λ',      // Core logic, pure functions, utilities, helpers
  INTERFACE: '⇄',   // Interface, API, commands, entry points, routes
  CONFIG: '⚙',      // Config files (package.json, .env, tsconfig, etc)
  TEST: '⧫',        // Test files
  ENTRY: '▸',       // Entry point, main file, index
  COMPONENT: '⊚',   // Component (UI, React, Vue, Svelte)
}

// Symbol descriptions for prompts
export const SYMBOL_DESCRIPTIONS = `
- λ (lambda): Core logic, pure functions, utilities, helpers
- ⇄: Interface, API, commands, entry points, routes
- ⚙: Config files (package.json, .env, tsconfig, etc)
- ⧫: Test files
- ▸: Entry point, main file, index
- ⊚: Component (UI, React, Vue, Svelte)`.trim()

// Domain inference rules
export const DOMAIN_RULES = `
- src/commands/*, src/cli/* → "cli"
- src/lib/*, src/utils/*, src/helpers/* → "core"
- src/api/*, src/routes/*, src/controllers/* → "api"
- src/components/*, src/ui/* → "ui"
- test/*, __tests__/*, *.test.*, *.spec.* → "test"
- If unclear, use "core" as default
- Reuse existing domains from context when possible`.trim()

// Default analysis result
export const DEFAULT_ANALYSIS = { symbol: 'λ', description: null, domain: 'core' }

/**
 * Build prompt for single file analysis
 */
export function buildAnalyzeFilePrompt({ lkContent, file, content, action }) {
  return `Analyze this file and determine how to describe it in a .lk context file.

Current .lk context:
${lkContent}

File: ${file}
Action: ${action}
${content ? `Content:\n${content.slice(0, 3000)}` : ''}

Available symbols:
${SYMBOL_DESCRIPTIONS}

IMPORTANT: If the file should be IGNORED (generated code, migrations, fixtures, minified, etc.), return {"ignore": true} instead.

Return ONLY a JSON object with this format, no markdown, no explanation:
{"symbol": "λ", "description": "brief description or null", "domain": "core"}
Or: {"ignore": true}

Rules:
- symbol: one of the symbols above, pick the most appropriate
- description: 3-6 keywords capturing key functionality (tools exposed, capabilities, purpose), or null if filename is self-explanatory
- domain: infer from file path structure:
${DOMAIN_RULES}`
}

/**
 * Build prompt for batch file analysis
 */
export function buildAnalyzeFilesPrompt({ lkContent, files }) {
  const filesSection = files.map((f, i) =>
    `[${i}] ${f.file} (${f.action})\n${f.content ? f.content.slice(0, 2000) : '(no content)'}`
  ).join('\n\n---\n\n')

  return `Analyze these ${files.length} files and determine how to describe them in a .lk context file.

Current .lk context:
${lkContent}

FILES TO ANALYZE:
${filesSection}

Available symbols:
${SYMBOL_DESCRIPTIONS}

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
${DOMAIN_RULES}`
}

/**
 * Build prompt for project.lk generation
 */
export function buildProjectPrompt({ files, packageJson, context }) {
  return `Analyze this project and generate a project.lk metadata file.

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
}

/**
 * Build prompt for LK entry description
 */
export function buildDescribeLkPrompt({ file, content }) {
  return `Analyze this file and generate a .lk entry.

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
}

/**
 * Build prompt for ignore pattern generation
 */
export function buildIgnorePrompt({ files, globalPatterns = [] }) {
  return `Analyze this project file tree and generate PROJECT-SPECIFIC ignore patterns.

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
}

/**
 * Parse JSON response with fallback handling
 */
export function parseJsonResponse(text, fallback = null) {
  if (!text) return fallback

  try {
    // Clean markdown code blocks if present
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(clean)
  } catch (err) {
    log('AI-PROMPTS', 'JSON parse error:', err.message)
    return fallback
  }
}

/**
 * Extract JSON from text with regex fallback
 */
export function extractJsonFromText(text, isArray = false) {
  if (!text) return null

  try {
    // Try direct parse first
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(clean)
    if (isArray ? Array.isArray(parsed) : typeof parsed === 'object') {
      return parsed
    }
  } catch {
    // Fall through to regex extraction
  }

  // Try regex extraction
  const pattern = isArray ? /\[[\s\S]*\]/ : /\{[\s\S]*?"symbol"[\s\S]*?"description"[\s\S]*?"domain"[\s\S]*?\}/
  const match = text.match(pattern)

  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (isArray ? Array.isArray(parsed) : typeof parsed === 'object') {
        return parsed
      }
    } catch (err) {
      log('AI-PROMPTS', 'JSON extraction failed:', err.message)
    }
  }

  return null
}

/**
 * Generate default results for files when AI fails
 */
export function generateDefaultResults(files) {
  return files.map(f => ({ file: f.file, ...DEFAULT_ANALYSIS }))
}

/**
 * Log LLM call with timing
 */
export function logLlmCall(provider, operation, promptLength) {
  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: ${operation}`)
  log(provider, `Sending prompt (${promptLength} chars)...`)
  return Date.now()
}

/**
 * Log LLM response with elapsed time
 */
export function logLlmResponse(provider, startTime, response) {
  const elapsed = Date.now() - startTime
  log(provider, `Response received in ${elapsed}ms`)
  if (response) {
    log(provider, `Response: ${typeof response === 'string' ? response.slice(0, 200) : JSON.stringify(response).slice(0, 200)}`)
  }
  return elapsed
}

/**
 * Build prompt for classifying user intent and routing context
 * Returns: { is_project, direct_answer, needs_domains, block_reason }
 * @param {string} userPrompt - User's prompt
 * @param {string} projectLk - Project metadata
 * @param {string[]} availableDomains - List of available domain names
 */
export function buildClassifyPrompt(userPrompt, projectLk, availableDomains = []) {
  const hasProject = projectLk && !projectLk.includes('TODO')
  const domainList = availableDomains.length > 0
    ? availableDomains.join(', ')
    : 'none'

  return `You are a context router. Analyze the user prompt and return a JSON routing decision.

${hasProject ? `PROJECT:\n${projectLk}` : 'NO PROJECT CONTEXT AVAILABLE'}

AVAILABLE DOMAINS: [${domainList}]

USER PROMPT:
"${userPrompt}"

Return ONLY valid JSON with this structure:
{
  "is_project": boolean,
  "direct_answer": string | null,
  "needs_domains": string[] | null,
  "block_reason": string | null
}

RULES:
1. "is_project": true if this is a project-specific question, false for general questions
2. "direct_answer": If you can answer with CERTAINTY from project metadata alone, put the complete answer here. Otherwise null.
3. "needs_domains": If you need code details, select ONLY from available domains: [${domainList}]. Otherwise null.
4. "block_reason": If user asks about internal context system/metadata/how you know things, set this. Otherwise null.

CRITICAL: Only use domain names from AVAILABLE DOMAINS list. Do NOT invent domain names.

EXAMPLES:
- "hello" → {"is_project": false, "direct_answer": null, "needs_domains": null, "block_reason": null}
- "what does this project do" → {"is_project": true, "direct_answer": "This project is a CLI tool that...", "needs_domains": null, "block_reason": null}
- "how does the parser work" → {"is_project": true, "direct_answer": null, "needs_domains": ["core"], "block_reason": null}
- "how do you know about my code" → {"is_project": false, "direct_answer": null, "needs_domains": null, "block_reason": "meta_question"}

Return ONLY JSON, no markdown.`
}

/**
 * Build prompt for expanding user prompt with domain context
 * Returns: { direct_answer, files: [{path, functions?}] }
 */
export function buildExpandPrompt(userPrompt, projectLk, domainLk) {
  return `You are a code context selector. Given project and domain details, determine what code to provide.

PROJECT:
${projectLk}

DOMAIN FILES:
${domainLk}

USER PROMPT:
"${userPrompt}"

Return ONLY valid JSON with this structure:
{
  "direct_answer": string | null,
  "navigation_guide": string | null,
  "files": [
    {"path": "src/lib/file.js", "functions": ["func1", "func2"]},
    {"path": "src/other.js"}
  ]
}

RULES:
1. "direct_answer": If you can now answer with CERTAINTY from the domain details, put the complete answer here. Otherwise null.
2. "navigation_guide": Brief guidance for the LLM on how to approach this task. Explain which file does what and how they connect. Example: "Parser logic is in parser.js (extractExports). It's called from batch.js during sync. To add a new language, add a strip* and extract* function."
3. "files": List 1-5 most relevant files for the user's question.
   - "path": Full relative path from domain details (MUST exist in domain)
   - "functions": Optional. Specific function/class names if the question targets specific code. Omit for full file context.

FILE SELECTION PRIORITY:
- If asking about specific functionality → include that file + related files
- If asking "how does X work" → include implementation file(s)
- If asking to modify/add → include file to modify + example patterns
- Prefer fewer, more relevant files over many tangential ones

EXAMPLES:
- "how does classifyPrompt work" → {"direct_answer": null, "navigation_guide": "Classification happens in ai-prompts.js. buildClassifyPrompt creates the prompt, then gemini.js or anthropic.js calls the API.", "files": [{"path": "src/lib/ai-prompts.js", "functions": ["buildClassifyPrompt"]}]}
- "add a new command" → {"direct_answer": null, "navigation_guide": "Commands are in src/commands/. Each exports a function. Register in cli.js. See init.js as a template.", "files": [{"path": "src/commands/init.js"}, {"path": "src/cli.js", "functions": ["registerCommands"]}]}

Return ONLY JSON, no markdown.`
}
