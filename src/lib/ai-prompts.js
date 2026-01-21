/**
 * Shared AI prompts and utilities for LK providers
 * This module extracts common logic from anthropic.js and gemini.js
 */
import { log } from './config.js'
import { recordCall, recordError, recordParseResult } from './stats.js'
// Re-export for use by providers
export { recordError }
// Available symbols for file classification (matches VALID_SYMBOLS in context.js, except ◇ which is internal)
export const SYMBOLS = {
  ENTRY: '▸',       // Entry point, main file, index
  INTERFACE: '⇄',   // Interface, API, commands, entry points, routes
  LAMBDA: 'λ',      // Core logic, pure functions, utilities, helpers
  CONFIG: '⚙',      // Config files (package.json, .env, tsconfig, etc)
  TEST: '⧫',        // Test files
  COMPONENT: '⊚',   // Component (UI, React, Vue, Svelte)
  SCHEMA: '⟐',      // Schema, types, models, definitions
  BACKGROUND: '◈',  // Background jobs, workers, queues, cron
  PIPELINE: '⤳',    // Pipeline, workflow, process
  STATE: '⚑',       // State management (store, reducer, context)
}
// Symbol descriptions for prompts
export const SYMBOL_DESCRIPTIONS = `
- ▸: Entry point, main file, index
- ⇄: Interface, API, commands, entry points, routes
- λ (lambda): Core logic, pure functions, utilities, helpers
- ⚙: Config files (package.json, .env, tsconfig, etc)
- ⧫: Test files
- ⊚: Component (UI, React, Vue, Svelte)
- ⟐: Schema, types, models, definitions
- ◈: Background jobs, workers, queues, cron
- ⤳: Pipeline, workflow, process
- ⚑: State management (store, reducer, context)`.trim()
// Compact symbol legend (single line, ~60% smaller than SYMBOL_DESCRIPTIONS)
export const SYMBOLS_COMPACT = `▸(entry) ⇄(api) λ(logic) ⚙(config) ⧫(test) ⊚(ui) ⟐(schema) ◈(bg) ⤳(pipe) ⚑(state)`
// Pure mode instructions - machine-to-machine programming style
// These instructions tell the receiving LLM how to write code AND respond
export const PURE_MODE_INSTRUCTIONS = `⟦PURE_MODE⟧
CRITICAL: Apply these rules to ALL code you write. No exceptions.
Style:
- No comments, no docstrings
- Short names: cfg ctx opts fn cb err res req out og i j k
- No defensive checks for internal code
- Terse errors: 'E_AUTH' not 'Authentication failed, please...'
- Inline everything unless reused 3+ times
- No blank lines between related statements
- No TODO/FIXME/XXX
- Density over convention (ignore linting/formatting)
Response:
- Code only, minimal prose
- Skip explanations, show code directly
- No "let me explain" or "here's what this does"
This applies to: production code, tests, examples, snippets, everything.
BAD: // Check if user is authenticated
     if (user && user.isAuthenticated && user.permissions.includes(perm)) {
GOOD: if (user?.isAuthenticated && user.permissions.includes(perm)) {
BAD: let originalValue = config.get('setting')
GOOD: let og = config.get('setting')`
export const PURE_MODE_REMINDER = `⟦PURE_MODE⟧ Max density: no comments, short names, no blank lines, minimal spaces, inline/nested, no explanations.`
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
 * Build prompt for project.lk generation (returns both LK and human-readable versions)
 */
export function buildProjectPrompt({ files, packageJson, context }) {
  return `Analyze this project and generate project metadata in TWO formats.
${context ? `Current context (with file descriptions):\n${context}\n` : `Files in project:\n${files.join('\n')}\n`}
${packageJson ? `package.json:\n${packageJson}` : ''}
Return a JSON object with two keys: "lk" and "human".
1. "lk" - The project.lk file with this EXACT format:
⦓ID: PROJECT⦔
⟪VIBE: [1-3 adjectives describing the project style]⟫ ⟪NAME: [project name]⟫ ⟪VERSION: [version or 0.1.0]⟫
⟦Δ: Purpose⟧
[1-2 sentences describing what the project does]
⟦Δ: Stack⟧
∑ Tech [Runtime⇨[node/python/go/etc], Type⇨[CLI/API/Web/Library]]
∑ Deps [list 3-6 KEY dependencies only: frameworks, ORMs, AI SDKs, etc. Skip trivial utils]
⟦Δ: Entry⟧
∑ Run [how to run: "npm start", "python main.py", etc.]
∑ Commands [if CLI: list main commands. If API: list main endpoints. If library: list main exports]
⟦Δ: Flows⟧
∑ Flows [
  [flow1: input → process → output],
  [flow2: trigger → action → result]
]
2. "human" - A plain text summary WITHOUT any symbols (no ⦓, ⟪, ⟦, ∑, ⇨, →). Format:
PROJECT: [name] v[version]
Style: [vibe adjectives]
Purpose:
[1-2 sentences describing what the project does]
Stack:
- Runtime: [node/python/go/etc]
- Type: [CLI/API/Web/Library]
- Dependencies: [list 3-6 key dependencies]
Entry:
- Run: [how to run]
- Commands: [main commands/endpoints/exports]
Flows:
- [flow1 description in plain text]
- [flow2 description in plain text]
Return ONLY valid JSON with "lk" and "human" keys, no markdown code blocks.`
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
// Maximum nesting depth to prevent DoS via deeply nested JSON
const MAX_JSON_DEPTH = 20
/**
 * Sanitize parsed JSON to prevent prototype pollution attacks and DoS
 * Removes dangerous keys like __proto__, constructor, prototype
 * Limits nesting depth to prevent stack overflow
 * @param {*} obj - Object to sanitize
 * @param {number} depth - Current nesting depth
 * @returns {*} Sanitized object
 */
function sanitizeJson(obj, depth = 0) {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  // Prevent DoS via deeply nested payloads
  if (depth >= MAX_JSON_DEPTH) {
    log('AI-PROMPTS', `Max JSON depth (${MAX_JSON_DEPTH}) exceeded - truncating`)
    return Array.isArray(obj) ? [] : {}
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeJson(item, depth + 1))
  }
  const dangerous = ['__proto__', 'constructor', 'prototype']
  const sanitized = {}
  for (const key of Object.keys(obj)) {
    if (dangerous.includes(key)) {
      log('AI-PROMPTS', `Blocked dangerous JSON key: ${key}`)
      continue
    }
    sanitized[key] = sanitizeJson(obj[key], depth + 1)
  }
  return sanitized
}
/**
 * Parse JSON response with fallback handling
 * @param {string} text - Text to parse
 * @param {*} fallback - Fallback value if parsing fails
 * @param {boolean} trackStats - Whether to record parse result in stats
 */
export function parseJsonResponse(text, fallback = null, trackStats = true) {
  if (!text) {
    if (trackStats) recordParseResult(false)
    return fallback
  }
  try {
    // Clean markdown code blocks if present
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const result = JSON.parse(clean)
    // Sanitize to prevent prototype pollution
    const sanitized = sanitizeJson(result)
    if (trackStats) recordParseResult(true)
    return sanitized
  } catch (err) {
    log('AI-PROMPTS', 'JSON parse error:', err.message)
    if (trackStats) recordParseResult(false)
    return fallback
  }
}
/**
 * Extract JSON from text with regex fallback
 * @param {string} text - Text to extract JSON from
 * @param {boolean} isArray - Whether to expect an array
 * @param {boolean} trackStats - Whether to record parse result in stats
 */
export function extractJsonFromText(text, isArray = false, trackStats = true) {
  if (!text) {
    if (trackStats) recordParseResult(false)
    return null
  }
  try {
    // Try direct parse first
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(clean)
    if (isArray ? Array.isArray(parsed) : typeof parsed === 'object') {
      // Sanitize to prevent prototype pollution
      const sanitized = sanitizeJson(parsed)
      if (trackStats) recordParseResult(true)
      return sanitized
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
        // Sanitize to prevent prototype pollution
        const sanitized = sanitizeJson(parsed)
        if (trackStats) recordParseResult(true)
        return sanitized
      }
    } catch (err) {
      log('AI-PROMPTS', 'JSON extraction failed:', err.message)
    }
  }
  if (trackStats) recordParseResult(false)
  return null
}
/**
 * Generate default results for files when AI fails
 */
export function generateDefaultResults(files) {
  return files.map(f => ({ file: f.file, ...DEFAULT_ANALYSIS }))
}
/**
 * Log LLM call with timing - returns tracking object for stats
 * @param {string} provider - Provider name (e.g., 'GEMINI')
 * @param {string} operation - Operation type (e.g., 'JSON API call')
 * @param {number} promptLength - Length of prompt in characters
 * @param {string} model - Model identifier (e.g., 'gemini-2.5-flash')
 * @param {string} operationType - Logical operation type (e.g., 'analyzeFile', 'classifyPrompt')
 * @returns {Object} Tracking object to pass to logLlmResponse
 */
export function logLlmCall(provider, operation, promptLength, model = 'unknown', operationType = null) {
  log('LLM', '─'.repeat(50))
  log('LLM', `CALL: ${operation}${operationType ? ` (${operationType})` : ''}`)
  log(provider, `Sending prompt (${promptLength} chars) to ${model}...`)
  return {
    startTime: Date.now(),
    provider,
    operation,
    operationType,
    promptLength,
    model
  }
}
/**
 * Log LLM response with elapsed time and record stats
 * @param {Object} tracking - Tracking object from logLlmCall
 * @param {string|null} response - Response text (for logging and measuring)
 * @returns {number} Elapsed time in milliseconds
 */
export function logLlmResponse(tracking, response) {
  const elapsed = Date.now() - tracking.startTime
  const responseLength = response ? response.length : 0
  log(tracking.provider, `Response received in ${elapsed}ms (${responseLength} chars)`)
  if (response) {
    log(tracking.provider, `Response: ${typeof response === 'string' ? response.slice(0, 200) : JSON.stringify(response).slice(0, 200)}`)
  }
  // Record statistics
  recordCall({
    provider: tracking.provider,
    operation: tracking.operation,
    operationType: tracking.operationType,
    model: tracking.model,
    charsSent: tracking.promptLength,
    charsReceived: responseLength,
    durationMs: elapsed
  })
  return elapsed
}
/**
 * Build prompt for classifying user intent and routing context
 * Returns: { is_project, is_continuation, direct_answer, needs_domains, block_reason }
 * @param {string} userPrompt - User's prompt
 * @param {string} projectLk - Project metadata
 * @param {string[]} availableDomains - List of available domain names
 * @param {string|null} previousContext - Last assistant message for continuation detection
 */
export function buildClassifyPrompt(userPrompt, projectLk, availableDomains = [], previousContext = null) {
  const hasProject = projectLk && !projectLk.includes('TODO')
  const domainList = availableDomains.length > 0
    ? availableDomains.join(', ')
    : 'none'
  const previousSection = previousContext
    ? `PREVIOUS ASSISTANT MESSAGE:
"""
${previousContext}
"""
`
    : ''
  return `You are a ROUTER for an AI coding assistant (Claude Code).
The user sent this prompt TO CLAUDE CODE (not to you):
"${userPrompt}"
${previousSection}Your job: Classify this prompt and decide what project context Claude Code needs.
You do NOT execute anything. You only route and provide context.
${hasProject ? `PROJECT:\n${projectLk}` : 'NO PROJECT CONTEXT AVAILABLE'}
AVAILABLE DOMAINS: [${domainList}]
Return ONLY valid JSON with this structure:
{
  "not_related": boolean,
  "is_project": boolean,
  "is_continuation": boolean,
  "direct_answer": string | null,
  "needs_domains": string[] | null,
  "block_reason": string | null
}
RULES:
1. "not_related": true if task does NOT need codebase context. Examples:
   - General questions: "explain recursion", "what is a monad"
   - Git/shell tasks: "show git log", "run tests", "check git status", "commit changes"
   - Confirmations: "yes", "ok", "hazlo", "go ahead"
   - Greetings: "hello", "thanks"
   When true, other fields can be null (passthrough).
2. "is_continuation": true if user's prompt is a DIRECT RESPONSE to previous assistant message.
   If true, other fields can be null (passthrough).
3. "is_project": true if project-specific question OR action, false for general questions
4. "direct_answer": ONLY for info questions answerable from project metadata. For ACTIONs → null
5. "needs_domains": If Claude Code needs code context, select from: [${domainList}]. Otherwise null.
6. "block_reason": If user asks about internal context system/metadata. Otherwise null.
CRITICAL: Only use domain names from AVAILABLE DOMAINS list.
EXAMPLES:
- "show git diff" → {"not_related": true, "is_project": false, "is_continuation": false, "direct_answer": null, "needs_domains": null, "block_reason": null}
- "run the tests" → {"not_related": true, "is_project": false, "is_continuation": false, "direct_answer": null, "needs_domains": null, "block_reason": null}
- "hello" → {"not_related": true, "is_project": false, "is_continuation": false, "direct_answer": null, "needs_domains": null, "block_reason": null}
- Previous: "React or Vue?" User: "React" → {"not_related": false, "is_project": false, "is_continuation": true, "direct_answer": null, "needs_domains": null, "block_reason": null}
- "what does this project do" → {"not_related": false, "is_project": true, "is_continuation": false, "direct_answer": "This project is...", "needs_domains": null, "block_reason": null}
- "fix the bug in auth" → {"not_related": false, "is_project": true, "is_continuation": false, "direct_answer": null, "needs_domains": ["core"], "block_reason": null}
Return ONLY JSON, no markdown.`
}
/**
 * Build prompt for expanding user prompt with domain context
 * Returns: { direct_answer, navigation_guide, files: [{path, reason}] }
 */
export function buildExpandPrompt(userPrompt, projectLk, domainLk) {
  return `You are a code context selector for an AI coding assistant (Claude Code).
The user sent this prompt TO CLAUDE CODE (not to you):
"${userPrompt}"
Your job: Select relevant code files that Claude Code should READ to complete this task.
You do NOT execute anything. You only select which files Claude Code needs to read.
PROJECT:
${projectLk}
DOMAIN FILES:
${domainLk}
Return ONLY valid JSON with this structure:
{
  "direct_answer": string | null,
  "navigation_guide": string | null,
  "files": [
    {"path": "src/lib/file.js", "reason": "why Claude Code should read this file"}
  ]
}
RULES:
1. "direct_answer": ONLY for informational questions where the answer is fully contained in domain details.
   - For ACTION commands (create, update, modify, fix, add, delete, refactor, etc.) → ALWAYS null
   - Claude Code executes actions, not you. Your job is only to select relevant files.
2. "navigation_guide": Brief guidance for Claude Code on how to approach this task. Explain which file does what and how they connect.
3. "files": List 1-5 most relevant files for the task.
   - "path": Full relative path from domain details (MUST exist in domain)
   - "reason": Why Claude Code should read this file (what it contains, what to look for)
FILE SELECTION PRIORITY:
- If asking about specific functionality → include that file + related files
- If asking "how does X work" → include implementation file(s)
- If asking to modify/add → include file to modify + example patterns
- Prefer fewer, more relevant files over many tangential ones
EXAMPLES:
- "how does classifyPrompt work" → {"direct_answer": null, "navigation_guide": "Classification logic is in ai-prompts.js", "files": [{"path": "src/lib/ai-prompts.js", "reason": "Contains buildClassifyPrompt function"}]}
- "update the readme" → {"direct_answer": null, "navigation_guide": "README.md is at project root", "files": [{"path": "README.md", "reason": "File to update"}]}
- "add a new command" → {"direct_answer": null, "navigation_guide": "Commands are in src/commands/", "files": [{"path": "src/commands/init.js", "reason": "Template for new commands"}, {"path": "src/cli.js", "reason": "Register new command here"}]}
Return ONLY JSON, no markdown.`
}
/**
 * Build prompt for generating a concise project summary for Claude Code
 * @param {string} projectLk - Full project.lk content
 * @param {string[]} domainNames - List of domain names
 * @returns {string} Prompt for generating summary
 */
export function buildProjectSummaryPrompt(projectLk, domainNames = []) {
  const domainList = domainNames.length > 0 ? domainNames.join(', ') : 'none'
  return `Generate a concise project summary for an AI coding assistant.
PROJECT METADATA:
${projectLk}
DOMAINS: [${domainList}]
Write a brief summary with this format:
1. First line: 1-2 sentences explaining what this project does and what type it is (CLI, API, library, etc.)
2. Second line: "Domains: ${domainList}" (list the available code domains)
Do NOT include flows or data pipelines - those will be shown separately.
Return ONLY the summary text, no markdown.`
}
/**
 * Build compact prompt for expanding user prompt with minimal context
 * Uses projectSummary + domainIndex instead of full content (~60-70% smaller)
 * Returns: { direct_answer, navigation_guide, files: [{path, reason}] }
 */
export function buildExpandPromptCompact(userPrompt, projectSummary, domainIndex, previousContext = null) {
  const contextSection = previousContext
    ? `\nRECENT CONVERSATION:\n${previousContext}\n`
    : ''
  return `Code context selector for Claude Code.
User prompt: "${userPrompt}"
${contextSection}
Select files Claude Code should READ.
PROJECT:
${projectSummary}
SYMBOLS: ${SYMBOLS_COMPACT}
FILES:
${domainIndex}
Return JSON:
{
  "not_related": boolean,
  "direct_answer": string|null,
  "navigation_guide": string|null,
  "files": [{"path": "src/file.js", "reason": "why"}]
}
RULES:
1. not_related: true if task does NOT need codebase context from lk. Examples:
   - General questions: "explain recursion", "what is a monad"
   - Git/shell tasks: "show git log", "run tests", "check git status"
   - Confirmations: "yes", "ok", "hazlo", "go ahead"
   - Greetings: "hello", "thanks"
   When true, other fields can be null/empty.
2. direct_answer: ONLY for info questions answerable from context. For ACTIONs → null
3. navigation_guide: Brief guidance on approach
4. files: 1-5 relevant files from FILES list above
5. Use RECENT CONVERSATION to understand context
Return ONLY JSON.`
}