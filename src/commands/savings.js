import { loadStats, statsPath, MODEL_PRICING } from '../lib/stats.js'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
const BENCH = [
  { name: 'latent-k', files: 6596, ratio: 1.38 },
  { name: 'enterprise-docflow', files: 27985, ratio: 1.61 }
]
const SLOPE = (BENCH[1].ratio - BENCH[0].ratio) / (BENCH[1].files - BENCH[0].files)
const INTERCEPT = BENCH[0].ratio - SLOPE * BENCH[0].files
const FLASH = MODEL_PRICING['gemini-2.5-flash']
const LITE = MODEL_PRICING['gemini-2.5-flash-lite']
const OPUS = MODEL_PRICING['claude-3-opus-20240229']
function getEfficiency(f) { return Math.max(1.1, Math.min(2.5, INTERCEPT + SLOPE * f)) }
function calcCost(i, o, p) { return (i / 1e6) * p.input + (o / 1e6) * p.output }
function getProjName(r) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(r, 'package.json'), 'utf8'))
    return pkg.name || path.basename(r)
  } catch { return path.basename(r) }
}
export async function savings(opts = {}) {
  const r = process.cwd()
  const pName = getProjName(r)
  const p = statsPath(r)
  if (!fs.existsSync(p)) {
    console.log('No data yet. Start using LK to see your savings!')
    return
  }
  const s = loadStats(r)
  const ops = s.byOperationType || {}
  const expKeys = Object.keys(ops).filter(k => k.toLowerCase().includes('expand'))
  if (expKeys.length === 0) {
    console.log('No expand operations yet. Start coding with LK!')
    return
  }
  let calls = 0, tUsed = 0, tokIn = 0, tokOut = 0, syncIn = 0, syncOut = 0
  for (const k of expKeys) {
    const o = ops[k]
    calls += o.calls || 0
    tUsed += o.totalDurationMs || 0
    tokIn += o.tokensSentEstimate || 0
    tokOut += o.tokensReceivedEstimate || 0
  }
  const syncKeys = ['analyzeFile', 'analyzeFiles', 'generateProject', 'generateIgnore']
  for (const k of syncKeys) {
    if (ops[k]) {
      syncIn += ops[k].tokensSentEstimate || 0
      syncOut += ops[k].tokensReceivedEstimate || 0
    }
  }
  let files = 0
  try { files = parseInt(execSync(`find "${r}" -type f 2>/dev/null | wc -l`, { encoding: 'utf8' })) || 0 } catch {}
  const eff = getEfficiency(files)
  const tSaved = tUsed * (eff - 1)
  const mods = s.byModel || {}
  const liteM = mods['gemini-2.5-flash-lite'] || { tokensSentEstimate: 0, tokensReceivedEstimate: 0 }
  const flashM = mods['gemini-2.5-flash'] || { tokensSentEstimate: 0, tokensReceivedEstimate: 0 }
  const liteCost = calcCost(liteM.tokensSentEstimate, liteM.tokensReceivedEstimate, LITE)
  const flashCost = calcCost(flashM.tokensSentEstimate, flashM.tokensReceivedEstimate, FLASH)
  const costUsed = liteCost + flashCost
  const opusCost = calcCost(tokIn * eff, tokOut * eff, OPUS)
  const costSaved = opusCost - costUsed
  const pct = Math.round((costSaved / opusCost) * 100)
  const g = '\x1b[32m', cy = '\x1b[36m', y = '\x1b[33m', b = '\x1b[1m', rst = '\x1b[0m'
  const W = 50
  const ln = (txt) => {
    const clean = txt.replace(/\x1b\[[0-9;]*m/g, '')
    return `${cy}║${rst} ${txt}${' '.repeat(Math.max(0, W - 1 - clean.length))}${cy}║${rst}`
  }
  console.log('')
  console.log(`${cy}╔${'═'.repeat(W)}╗${rst}`)
  console.log(ln(`${b}LK SAVINGS REPORT${rst}`))
  console.log(ln(pName))
  console.log(`${cy}╠${'═'.repeat(W)}╣${rst}`)
  console.log(ln(''))
  console.log(ln(`  ${g}${b}$${fC(costSaved)}${rst} saved vs Opus`))
  console.log(ln(`  ${y}${fT(tSaved)}${rst} of time saved`))
  console.log(ln(`  ${b}${eff.toFixed(2)}x${rst} faster`))
  console.log(ln(''))
  console.log(`${cy}╠${'═'.repeat(W)}╣${rst}`)
  console.log(ln(`${calls} ctxt injections  •  ${pct}% cost reduction`))
  console.log(`${cy}╚${'═'.repeat(W)}╝${rst}`)
  console.log('')
}
function fC(c) {
  if (c < 1) return c.toFixed(2)
  if (c < 100) return c.toFixed(2)
  return Math.round(c).toLocaleString()
}
function fT(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}min`
  return `${(ms / 3600000).toFixed(1)}h`
}
