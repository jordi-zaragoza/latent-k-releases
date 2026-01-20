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
import { expand } from '../lib/expand.js'
import { exists } from '../lib/context.js'
import { isConfigured, log } from '../lib/config.js'
import { checkAccess } from '../lib/license.js'
import { getClaudeUserEmail } from '../lib/claude-utils.js'

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
    const result = await expand(root, processedInput)

    if (debug) {
      console.error(`[lk expand] ${result.calls} API call(s), type: ${result.type}`)
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
