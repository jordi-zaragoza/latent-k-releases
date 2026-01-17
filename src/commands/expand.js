/**
 * Expand command - transforms user prompts with LK context
 *
 * Usage:
 *   lk expand "user prompt"     - Expand a prompt (JSON output)
 *   echo "prompt" | lk expand   - Read from stdin
 *   lk expand --debug "prompt"  - Show debug info
 */

import { expand } from '../lib/expand.js'
import { exists } from '../lib/context.js'
import { isConfigured } from '../lib/config.js'
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
 * Extract prompt from input
 * Handles both direct text and Claude Code JSON format
 */
function extractPrompt(input) {
  if (!input) return ''

  // Try to parse as JSON (Claude Code format)
  try {
    const parsed = JSON.parse(input)
    if (parsed.prompt) {
      return parsed.prompt
    }
  } catch {
    // Not JSON, treat as plain text
  }

  return input
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

  // Extract prompt from input (handles JSON format from Claude Code)
  const input = extractPrompt(rawInput)

  // Still no input - nothing to expand
  if (!input) {
    if (debug) console.error('[lk expand] No input provided')
    console.log(JSON.stringify({ type: 'passthrough', context: null }))
    return
  }

  // Check if .lk directory exists
  if (!exists(root)) {
    if (debug) console.error('[lk expand] No .lk directory, passing through')
    console.log(JSON.stringify({ type: 'passthrough', context: null }))
    return
  }

  // Check if AI is configured
  if (!isConfigured()) {
    if (debug) console.error('[lk expand] AI not configured, passing through')
    console.log(JSON.stringify({ type: 'passthrough', context: null }))
    return
  }

  // Check license
  try {
    checkAccess()
  } catch (err) {
    if (debug) console.error(`[lk expand] License error: ${err.message}`)
    console.log(JSON.stringify({ type: 'passthrough', context: null }))
    return
  }

  try {
    const result = await expand(root, input)

    if (debug) {
      console.error(`[lk expand] ${result.calls} API call(s), type: ${result.type}`)
    }

    // Output JSON context to stdout
    console.log(JSON.stringify(result))
  } catch (err) {
    // On error, pass through
    if (debug) {
      console.error(`[lk expand] Error: ${err.message}`)
    }
    console.log(JSON.stringify({ type: 'error', error: err.message, context: null }))
  }
}
