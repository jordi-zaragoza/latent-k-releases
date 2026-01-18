/**
 * Expand command - transforms user prompts with LK context
 *
 * Usage:
 *   lk expand "user prompt"     - Expand a prompt (JSON output)
 *   echo "prompt" | lk expand   - Read from stdin
 *   lk expand --debug "prompt"  - Show debug info
 */

import fs from 'fs'
import readline from 'readline'
import { expand } from '../lib/expand.js'
import { exists } from '../lib/context.js'
import { isConfigured, log } from '../lib/config.js'
import { checkAccess } from '../lib/license.js'

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
 * Get the last assistant message from a transcript file
 * @param {string} transcriptPath - Path to the JSONL transcript file
 * @returns {Promise<string|null>} - Last assistant message (truncated if long)
 */
async function getLastAssistantMessage(transcriptPath) {
  if (!transcriptPath) return null

  try {
    if (!fs.existsSync(transcriptPath)) {
      return null
    }

    const fileStream = fs.createReadStream(transcriptPath)
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    })

    let lastAssistantMessage = null

    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry.role === 'assistant' && entry.message) {
          lastAssistantMessage = entry.message
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    if (!lastAssistantMessage) return null

    // Truncate if too long: head + ... + tail (final part often has the question)
    const maxLen = 600
    const headLen = 300
    const tailLen = 300

    if (lastAssistantMessage.length > maxLen) {
      const head = lastAssistantMessage.slice(0, headLen)
      const tail = lastAssistantMessage.slice(-tailLen)
      return `${head}\n...[truncated]...\n${tail}`
    }

    return lastAssistantMessage
  } catch (err) {
    log('EXPAND', `Error reading transcript: ${err.message}`)
    return null
  }
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
    return `<system-reminder>
⚠️ INSTRUCTION: This answer is complete. DO NOT call Read, Glob, Grep or other tools. Respond directly.

READY ANSWER:
${context.answer}
</system-reminder>`
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

  // Still no input - nothing to expand
  if (!input) {
    if (debug) console.error('[lk expand] No input provided')
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

  // Check license
  try {
    checkAccess()
  } catch (err) {
    if (debug) console.error(`[lk expand] License error: ${err.message}`)
    return
  }

  try {
    // Get previous assistant message for context (if available)
    const previousContext = await getLastAssistantMessage(transcriptPath)
    if (debug && previousContext) {
      console.error(`[lk expand] Previous context available (${previousContext.length} chars)`)
    }

    const result = await expand(root, input, previousContext)

    if (debug) {
      console.error(`[lk expand] ${result.calls} API call(s), type: ${result.type}`)
    }

    // Format as system-reminder for LLM consumption
    const output = formatForLLM(result)
    if (output) {
      log('EXPAND', `Output to LLM (${output.length} chars):\n${output}`)
      console.log(output)
    }
  } catch (err) {
    if (debug) {
      console.error(`[lk expand] Error: ${err.message}`)
    }
    // On error, output nothing (passthrough)
  }
}
