/**
 * Expand command - transforms user prompts with LK context
 *
 * Usage:
 *   lk expand "user prompt"     - Expand a prompt (JSON output)
 *   echo "prompt" | lk expand   - Read from stdin
 *   lk expand --debug "prompt"  - Show debug info
 */

import fs from 'fs'
import crypto from 'crypto'
import readline from 'readline'
import { expand } from '../lib/expand.js'
import { exists } from '../lib/context.js'
import { isConfigured, log } from '../lib/config.js'
import { checkAccess } from '../lib/license.js'
import { getClaudeUserEmail } from '../lib/claude-utils.js'

// Number of previous messages to include as context
const PREV_MESSAGES_COUNT = 3
// Max chars per message to prevent bloat
const MAX_MESSAGE_CHARS = 1500
// Max total chars for all previous messages
const MAX_TOTAL_PREV_CHARS = 3000

const MARKER_PREFIX = 'lk-expanded-'
const MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Get marker file path for a session (based on transcript path hash)
 */
function getMarkerPath(transcriptPath) {
  if (!transcriptPath) return null
  const hash = crypto.createHash('md5').update(transcriptPath).digest('hex').slice(0, 12)
  return `/tmp/${MARKER_PREFIX}${hash}`
}

/**
 * Clean up old marker files (older than 24 hours)
 */
function cleanOldMarkers() {
  try {
    const files = fs.readdirSync('/tmp')
    const now = Date.now()
    for (const file of files) {
      if (!file.startsWith(MARKER_PREFIX)) continue
      const filePath = `/tmp/${file}`
      try {
        const stat = fs.statSync(filePath)
        if (now - stat.mtimeMs > MARKER_MAX_AGE_MS) {
          fs.unlinkSync(filePath)
        }
      } catch {
        // Ignore errors on individual files
      }
    }
  } catch {
    // Ignore errors reading /tmp
  }
}

/**
 * Check if expansion already ran for this session
 */
function wasAlreadyExpanded(transcriptPath) {
  const markerPath = getMarkerPath(transcriptPath)
  if (!markerPath) return false
  return fs.existsSync(markerPath)
}

/**
 * Mark session as expanded
 */
function markAsExpanded(transcriptPath) {
  const markerPath = getMarkerPath(transcriptPath)
  if (!markerPath) return
  try {
    fs.writeFileSync(markerPath, Date.now().toString())
    // Clean old markers periodically (1 in 10 chance to avoid overhead)
    if (Math.random() < 0.1) {
      cleanOldMarkers()
    }
  } catch {
    // Ignore errors creating marker
  }
}

/**
 * Read from stdin with timeout
 * Claude Code passes JSON: {"prompt": "...", ...}
 */
async function readStdin(timeoutMs = 100) {
  return new Promise((resolve) => {
    let data = ''

    // Set timeout - if no data arrives, resolve with empty string
    const timeout = setTimeout(() => {
      process.stdin.removeAllListeners('data')
      process.stdin.removeAllListeners('end')
      resolve('')
    }, timeoutMs)

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => {
      clearTimeout(timeout)
      resolve(data.trim())
    })

    // If stdin is a TTY (interactive), resolve immediately with empty
    if (process.stdin.isTTY) {
      clearTimeout(timeout)
      resolve('')
    }
  })
}

/**
 * Extract prompt and transcript path from input
 * Handles both direct text and Claude Code JSON format
 * @returns {{ prompt: string, transcriptPath: string|null }}
 */
function extractInput(input) {
  if (!input) return { prompt: '', transcriptPath: null }

  // Try to parse as JSON (Claude Code format)
  try {
    const parsed = JSON.parse(input)
    if (parsed.prompt) {
      return {
        prompt: parsed.prompt,
        transcriptPath: parsed.transcript_path || null
      }
    }
  } catch {
    // Not JSON, treat as plain text
  }

  return { prompt: input, transcriptPath: null }
}

/**
 * Extract text content from a message
 * Handles both user messages (string or tool_result array) and assistant messages (content array)
 */
function extractTextFromMessage(message) {
  if (!message || !message.content) return null

  const { role, content } = message

  // User message - can be string or array of tool_results
  if (role === 'user') {
    if (typeof content === 'string') {
      return content
    }
    // Array of tool_results - skip these (not useful context)
    if (Array.isArray(content) && content.some(c => c.type === 'tool_result')) {
      return null
    }
  }

  // Assistant message - array of content blocks
  if (role === 'assistant' && Array.isArray(content)) {
    const textParts = content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)

    if (textParts.length > 0) {
      return textParts.join('\n')
    }
  }

  return null
}

/**
 * Read the last N messages from Claude Code transcript
 * @param {string} transcriptPath - Path to the .jsonl transcript file
 * @param {number} count - Number of messages to retrieve
 * @returns {Promise<Array<{role: string, content: string}>>}
 */
async function readPreviousMessages(transcriptPath, count = PREV_MESSAGES_COUNT) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return []
  }

  try {
    const messages = []
    const fileStream = fs.createReadStream(transcriptPath)
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    })

    for await (const line of rl) {
      if (!line.trim()) continue

      try {
        const entry = JSON.parse(line)

        // Only process user and assistant message entries
        if ((entry.type === 'user' || entry.type === 'assistant') && entry.message) {
          const text = extractTextFromMessage(entry.message)
          if (text) {
            messages.push({
              role: entry.message.role,
              content: text
            })
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Get last N messages (excluding the current prompt which is the very last user message)
    // We want the context BEFORE the current message
    if (messages.length <= 1) return []

    const prevMessages = messages.slice(-count - 1, -1)
    return prevMessages
  } catch (err) {
    log('HOOK', `Error reading transcript: ${err.message}`)
    return []
  }
}

/**
 * Format previous messages as compact context string
 * @param {Array<{role: string, content: string}>} messages
 * @returns {string}
 */
function formatPreviousMessages(messages) {
  if (!messages || messages.length === 0) return ''

  let totalChars = 0
  const formatted = []

  for (const msg of messages) {
    let content = msg.content.trim()

    // Truncate individual message if too long
    if (content.length > MAX_MESSAGE_CHARS) {
      content = content.slice(0, MAX_MESSAGE_CHARS) + '...[truncated]'
    }

    // Check if adding this would exceed total limit
    const prefix = msg.role === 'user' ? 'U: ' : 'A: '
    const line = prefix + content

    if (totalChars + line.length > MAX_TOTAL_PREV_CHARS) {
      // Truncate to fit
      const remaining = MAX_TOTAL_PREV_CHARS - totalChars
      if (remaining > 50) {
        formatted.push(line.slice(0, remaining) + '...[truncated]')
      }
      break
    }

    formatted.push(line)
    totalChars += line.length + 1 // +1 for newline
  }

  return formatted.join('\n')
}


/**
 * Format result as system-reminder for LLM consumption
 * LLMs respond better to imperative instructions than JSON data
 */
function formatForLLM(result) {
  if (!result.context) return ''

  const { type, context } = result

  // Blocked - generic response instruction
  if (type === 'blocked') {
    return `<system-reminder>
${context.message}
</system-reminder>`
  }

  // Direct answer - instruct LLM to use it
  if (type === 'direct' && context.answer) {
    const parts = ['<system-reminder>']
    parts.push('⚠️ INSTRUCTION: This answer is complete. DO NOT call Read, Glob, Grep or other tools. Respond directly.')
    parts.push('')

    // Add project summary if present
    if (context.project_summary) {
      parts.push('PROJECT SUMMARY:')
      parts.push(context.project_summary)
      parts.push('')
    }

    parts.push('READY ANSWER:')
    parts.push(context.answer)
    parts.push('</system-reminder>')

    return parts.join('\n')
  }

  // Code context - provide files with instruction
  // Check that files object has content (not just exists)
  if (type === 'code_context' && context.files && Object.keys(context.files).length > 0) {
    const parts = ['<system-reminder>']

    // Instruction FIRST - so LLM sees it before code
    parts.push('⚠️ INSTRUCTION: Use this code to respond. DO NOT call Read, Glob, or Grep unless explicitly needed.')
    parts.push('')

    // Add navigation guide if present
    if (context.navigation_guide) {
      parts.push('NAVIGATION GUIDE:')
      parts.push(context.navigation_guide)
      parts.push('')
    }

    // Add project summary if present
    if (context.project_summary) {
      parts.push('PROJECT SUMMARY:')
      parts.push(context.project_summary)
      parts.push('')
    }

    parts.push('RELEVANT CODE CONTEXT:', '')

    for (const [filePath, content] of Object.entries(context.files)) {
      parts.push(`--- ${filePath} ---`)
      if (typeof content === 'string') {
        parts.push(content)
      } else {
        // Object with function names as keys
        for (const [fnName, fnCode] of Object.entries(content)) {
          parts.push(`// ${fnName}`)
          parts.push(fnCode)
        }
      }
      parts.push('')
    }

    parts.push('</system-reminder>')

    return parts.join('\n')
  }

  return ''
}

/**
 * Main expand command
 */
export async function expandCommand(prompt, options = {}) {
  const root = process.cwd()
  const { debug } = options

  // If no prompt provided, try reading from stdin
  let rawInput = prompt
  if (!rawInput) {
    rawInput = await readStdin()
  }

  // Extract prompt and transcript path from input (handles JSON format from Claude Code)
  const { prompt: input, transcriptPath } = extractInput(rawInput)

  // Get user email from Claude config
  const userEmail = getClaudeUserEmail()

  log('HOOK', '#### Expand hook started ####')
  log('HOOK', `User email from Claude config: ${userEmail || 'not found'}`)

  // Still no input - nothing to expand
  if (!input) {
    if (debug) console.error('[lk expand] No input provided')
    return
  }

  // Check if prompt starts with "lk" - force expand bypass
  const forceExpand = input.toLowerCase().startsWith('lk')
  let processedInput = input
  if (forceExpand) {
    log('HOOK', 'Force expand triggered (prompt starts with "lk")')
    // Strip "lk" prefix from prompt for processing
    processedInput = input.slice(2).trimStart()
  }

  // Skip if already expanded for this session (unless forced)
  if (!forceExpand && wasAlreadyExpanded(transcriptPath)) {
    log('HOOK', 'Already expanded this session, skipping further expansions')
    if (debug) console.error('[lk expand] Already expanded this session, skipping')
    // Show hint to user (stderr doesn't affect LLM output)
    console.error('💡 Tip: Start your prompt with "lk" to inject fresh context')
    return
  }

  // Check if .lk directory exists
  if (!exists(root)) {
    if (debug) console.error('[lk expand] No .lk directory, passing through')
    return
  }

  // Check if AI is configured
  if (!isConfigured()) {
    if (debug) console.error('[lk expand] AI not configured, passing through')
    return
  }

  // Check license (verify email matches if provided by Claude Code)
  try {
    const access = await checkAccess(userEmail)
    if (!access.allowed) {
      if (debug) console.error(`[lk expand] License error: ${access.message}`)
      return
    }
  } catch (err) {
    if (debug) console.error(`[lk expand] License error: ${err.message}`)
    return
  }

  try {
    // Read previous messages from transcript for context
    const prevMessages = await readPreviousMessages(transcriptPath)
    const prevContext = formatPreviousMessages(prevMessages)

    if (prevContext) {
      log('HOOK', `Including ${prevMessages.length} previous message(s) as context (${prevContext.length} chars)`)
    }

    const result = await expand(root, processedInput, { previousContext: prevContext })

    if (debug) {
      console.error(`[lk expand] ${result.calls} API call(s), type: ${result.type}`)
      if (prevContext) {
        console.error(`[lk expand] Included ${prevMessages.length} previous message(s)`)
      }
    }

    // Format as system-reminder for LLM consumption
    const output = formatForLLM(result)
    if (output) {
      log('EXPAND', `Output to LLM (${output.length} chars):\n${output}`)
      console.log(output)
      // Mark as expanded only if we actually provided context (not passthrough)
      markAsExpanded(transcriptPath)
    }
  } catch (err) {
    if (debug) {
      console.error(`[lk expand] Error: ${err.message}`)
    }
    // On error, output nothing (passthrough)
  }
}
