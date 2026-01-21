import fs from 'fs'
import crypto from 'crypto'
import readline from 'readline'
import { expand } from '../lib/expand.js'
import { exists } from '../lib/context.js'
import { isConfigured, log } from '../lib/config.js'
import { getProjectPureMode } from '../lib/context.js'
import { PURE_MODE_REMINDER } from '../lib/ai-prompts.js'
import { checkAccess } from '../lib/license.js'
import { getClaudeUserEmail } from '../lib/claude-utils.js'
import { loadStats, statsPath } from '../lib/stats.js'
const PMC = 3
const MMC = 1500
const MTPC = 3000
const MP = 'lk-expanded-'
const MMAMS = 24 * 60 * 60 * 1000
function getMarkerPath(tP) {
  if (!tP) return null
  const h = crypto.createHash('md5').update(tP).digest('hex').slice(0, 12)
  return `/tmp/${MP}${h}`
}
function cleanOldMarkers() {
  try {
    const fls = fs.readdirSync('/tmp')
    const n = Date.now()
    for (const f of fls) {
      if (!f.startsWith(MP)) continue
      const fP = `/tmp/${f}`
      try {
        const s = fs.statSync(fP)
        if (n - s.mtimeMs > MMAMS) {
          fs.unlinkSync(fP)
        }
      } catch {}
    }
  } catch {}
}
function wasAlreadyExpanded(tP) {
  const mP = getMarkerPath(tP)
  if (!mP) return false
  return fs.existsSync(mP)
}
function markAsExpanded(tP) {
  const mP = getMarkerPath(tP)
  if (!mP) return
  try {
    fs.writeFileSync(mP, Date.now().toString())
    if (Math.random() < 0.1) {
      cleanOldMarkers()
    }
  } catch {}
}
async function readStdin(tM = 100) {
  return new Promise((r) => {
    let d = ''
    const t = setTimeout(() => {
      process.stdin.removeAllListeners('data')
      process.stdin.removeAllListeners('end')
      r('')
    }, tM)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', c => {
      d += c
    })
    process.stdin.on('end', () => {
      clearTimeout(t)
      r(d.trim())
    })
    if (process.stdin.isTTY) {
      clearTimeout(t)
      r('')
    }
  })
}
function extractInput(i) {
  if (!i) return { prompt: '', transcriptPath: null }
  try {
    const p = JSON.parse(i)
    if (p.prompt) {
      return {
        prompt: p.prompt,
        transcriptPath: p.transcript_path || null
      }
    }
  } catch {}
  return { prompt: i, transcriptPath: null }
}
function extractTextFromMessage(m) {
  if (!m || !m.content) return null
  const { role, content } = m
  if (role === 'user') {
    if (typeof content === 'string') {
      return content
    }
    if (Array.isArray(content) && content.some(c => c.type === 'tool_result')) {
      return null
    }
  }
  if (role === 'assistant' && Array.isArray(content)) {
    const tPs = content
      .filter(e => e.type === 'text' && e.text)
      .map(e => e.text)
    if (tPs.length > 0) {
      return tPs.join('\n')
    }
  }
  return null
}
async function readPreviousMessages(tP, c = PMC) {
  if (!tP || !fs.existsSync(tP)) {
    return []
  }
  try {
    const ms = []
    const fS = fs.createReadStream(tP)
    const rL = readline.createInterface({
      input: fS,
      crlfDelay: Infinity
    })
    for await (const l of rL) {
      if (!l.trim()) continue
      try {
        const e = JSON.parse(l)
        if ((e.type === 'user' || e.type === 'assistant') && e.message) {
          const t = extractTextFromMessage(e.message)
          if (t) {
            ms.push({
              role: e.message.role,
              content: t
            })
          }
        }
      } catch {}
    }
    if (ms.length <= 1) return []
    const pMs = ms.slice(-c - 1, -1)
    return pMs
  } catch (e) {
    log('HOOK', `Error reading transcript: ${e.message}`)
    return []
  }
}
function formatPreviousMessages(ms) {
  if (!ms || ms.length === 0) return ''
  let tC = 0
  const f = []
  for (const m of ms) {
    let c = m.content.trim()
    if (c.length > MMC) {
      c = c.slice(0, MMC) + '...[truncated]'
    }
    const p = m.role === 'user' ? 'U: ' : 'A: '
    const l = p + c
    if (tC + l.length > MTPC) {
      const r = MTPC - tC
      if (r > 50) {
        f.push(l.slice(0, r) + '...[truncated]')
      }
      break
    }
    f.push(l)
    tC += l.length + 1
  }
  return f.join('\n')
}
function formatForLLM(r) {
  if (!r.context) return ''
  const { type, context } = r
  if (type === 'blocked') {
    return `<system-reminder>\n${context.message}\n</system-reminder>`
  }
  if (type === 'direct' && context.answer) {
    const p = ['<system-reminder>']
    p.push('⚠️ INSTRUCTION: This answer is complete. DO NOT call Read, Glob, Grep or other tools. Respond directly.')
    p.push('')
    if (context.project_summary) {
      p.push('PROJECT SUMMARY:')
      p.push(context.project_summary)
      p.push('')
    }
    p.push('READY ANSWER:')
    p.push(context.answer)
    p.push('</system-reminder>')
    return p.join('\n')
  }
  if (type === 'code_context' && context.files && Object.keys(context.files).length > 0) {
    const p = ['<system-reminder>']
    p.push('⚠️ INSTRUCTION: Use this code to respond. DO NOT call Read, Glob, or Grep unless explicitly needed.')
    p.push('')
    if (context.navigation_guide) {
      p.push('NAVIGATION GUIDE:')
      p.push(context.navigation_guide)
      p.push('')
    }
    if (context.project_summary) {
      p.push('PROJECT SUMMARY:')
      p.push(context.project_summary)
      p.push('')
    }
    p.push('RELEVANT CODE CONTEXT:', '')
    for (const [fP, c] of Object.entries(context.files)) {
      p.push(`--- ${fP} ---`)
      if (typeof c === 'string') {
        p.push(c)
      } else {
        for (const [fN, fC] of Object.entries(c)) {
          p.push(`// ${fN}`)
          p.push(fC)
        }
      }
      p.push('')
    }
    p.push('</system-reminder>')
    return p.join('\n')
  }
  return ''
}
export async function expandCommand(p, o = {}) {
  const rt = process.cwd()
  const { debug: d } = o
  let rI = p
  if (!rI) {
    rI = await readStdin()
  }
  const { prompt: i, transcriptPath: tP } = extractInput(rI)
  const uE = getClaudeUserEmail()
  log('HOOK', '#### Expand hook started ####')
  log('HOOK', `User email from Claude config: ${uE || 'not found'}`)
  if (!i) {
    if (d) console.error('[lk expand] No input provided')
    return
  }
  const fE = i.toLowerCase().startsWith('lk')
  let pI = i
  if (fE) {
    log('HOOK', 'Force expand triggered (prompt starts with "lk")')
    pI = i.slice(2).trimStart()
  }
  if (!fE && wasAlreadyExpanded(tP)) {
    log('HOOK', 'Already expanded this session, skipping further expansions')
    if (d) console.error('[lk expand] Already expanded this session, skipping')
    console.error('💡 Tip: Start your prompt with "lk" to inject fresh context')
    if (getProjectPureMode(rt)) {
      console.log(`<system-reminder>\n${PURE_MODE_REMINDER}\n</system-reminder>`)
    }
    return
  }
  if (!exists(rt)) {
    if (d) console.error('[lk expand] No .lk directory, passing through')
    return
  }
  if (!isConfigured()) {
    if (d) console.error('[lk expand] AI not configured, passing through')
    return
  }
  try {
    const aR = await checkAccess(uE)
    if (!aR.allowed) {
      if (d) console.error(`[lk expand] License error: ${aR.message}`)
      return
    }
  } catch (e) {
    if (d) console.error(`[lk expand] License error: ${e.message}`)
    return
  }
  try {
    const pM = await readPreviousMessages(tP)
    const pC = formatPreviousMessages(pM)
    if (pC) {
      log('HOOK', `Including ${pM.length} previous message(s) as context (${pC.length} chars)`)
    }
    const eR = await expand(rt, pI, { previousContext: pC })
    if (d) {
      console.error(`[lk expand] ${eR.calls} API call(s), type: ${eR.type}`)
      if (pC) {
        console.error(`[lk expand] Included ${pM.length} previous message(s)`)
      }
    }
    const lO = formatForLLM(eR)
    if (lO) {
      log('EXPAND', `Output to LLM (${lO.length} chars):\n${lO}`)
      console.log(lO)
      markAsExpanded(tP)
    } else if (getProjectPureMode(rt)) {
      console.log(`<system-reminder>\n${PURE_MODE_REMINDER}\n</system-reminder>`)
    }
  } catch (e) {
    if (d) {
      console.error(`[lk expand] Error: ${e.message}`)
    }
    if (getProjectPureMode(rt)) {
      console.log(`<system-reminder>\n${PURE_MODE_REMINDER}\n</system-reminder>`)
    }
  }
}