import { loadStats, resetStats, getStatsSummary, statsPath, MODEL_PRICING, PRICING_DATE } from '../lib/stats.js'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
const BENCH = [
  { name: 'latent-k', files: 6596, ratio: 1.38 },
  { name: 'enterprise-docflow', files: 27985, ratio: 1.61 }
]
const SLOPE = (BENCH[1].ratio - BENCH[0].ratio) / (BENCH[1].files - BENCH[0].files)
const INTERCEPT = BENCH[0].ratio - SLOPE * BENCH[0].files
const LK_PRICE = { input: 0.075, output: 0.30 }
const OPUS_PRICE = { input: 5.00, output: 25.00 }
function getEfficiency(files) {
  const r = INTERCEPT + SLOPE * files
  return Math.max(1.1, Math.min(2.5, r))
}
function calcCost(tokIn, tokOut, price) {
  return (tokIn / 1e6) * price.input + (tokOut / 1e6) * price.output
}
export async function stats(options = {}) {
  const a = process.cwd()
  const b = statsPath(a)
  if (!fs.existsSync(b)) {
    console.log('No statistics recorded yet.')
    console.log('Stats will be collected automatically when you run lk commands that use AI.')
    return
  }
  if (options.reset) {
    resetStats(a)
    console.log('Statistics reset.')
    return
  }
  if (options.json) {
    const c = loadStats(a)
    console.log(JSON.stringify(c, null, 2))
    return
  }
  const d = getStatsSummary(a)
  console.log('LLM Usage Statistics\n')
  console.log('─'.repeat(50))
  console.log('\nTotals:')
  console.log(`  Sessions: ${d.totalSessions}`)
  console.log(`  Calls: ${d.totalCalls}${d.totalErrors > 0 ? ` (${d.totalErrors} errors)` : ''}`)
  console.log(`  Avg calls/session: ${d.avgCallsPerSession}`)
  console.log(`  Tokens (estimate): ${fN(d.totalTokensEstimate)}`)
  console.log(`  Cost: ${fC(d.totalCostUsd)}`)
  console.log(`  Parse success rate: ${d.parseSuccessRate}%`)
  console.log(`  Avg duration: ${d.avgDurationMs}ms`)
  const e = Object.keys(d.byOperationType)
  if (e.length > 0) {
    console.log('\nBy Operation Type:')
    for (const f of e.sort()) {
      const g = d.byOperationType[f]
      console.log(`  ${f}:`)
      console.log(`    Calls: ${g.calls}`)
      console.log(`    Tokens sent: ${fN(g.tokensSentEstimate)}`)
      console.log(`    Tokens received: ${fN(g.tokensReceivedEstimate)}`)
    }
  }
  const h = Object.keys(d.byOperation)
  if (h.length > 0) {
    console.log('\nBy API Type:')
    for (const i of h) {
      const j = d.byOperation[i]
      console.log(`  ${i}:`)
      console.log(`    Calls: ${j.calls}`)
      console.log(`    Tokens (estimate): ${fN(j.tokensSentEstimate + j.tokensReceivedEstimate)}`)
    }
  }
  const k = Object.keys(d.byModel)
  if (k.length > 0) {
    console.log('\nBy Model:')
    for (const l of k) {
      const m = d.byModel[l]
      const tIn = m.tokensSentEstimate, tOut = m.tokensReceivedEstimate
      console.log(`  ${l}:`)
      console.log(`    Calls: ${m.calls}, Tokens: ${fN(tIn + tOut)}`)
      console.log(`    Cost: $${fC(m.costUsd || 0)}`)
      console.log(`    Avg: ${Math.round(m.totalDurationMs / m.calls)}ms`)
    }
  }
  const sav = calcSavings(a, d)
  if (sav) {
    console.log('\nSavings (expand operations):')
    console.log(`  Efficiency: ${sav.eff.toFixed(2)}x (${fN(sav.files)} files)`)
    console.log(`  Time saved: ${fT(sav.tSaved)}`)
    console.log(`  Tokens saved: ${fN(sav.tokSaved)}`)
    console.log(`  Cost: $${fC(sav.costUsed)} LK vs $${fC(sav.opusCost)} Opus`)
    console.log(`  Saved: $${fC(sav.costSaved)} (${Math.round((sav.costSaved / sav.opusCost) * 100)}%)`)
  }
  if (d.recentErrors && d.recentErrors.length > 0) {
    console.log('\nRecent Errors:')
    for (const n of d.recentErrors) {
      const o = fD(n.timestamp).split(',')[0]
      console.log(`  [${o}] ${n.operationType || n.operation}: ${n.error.slice(0, 60)}`)
    }
  }
  console.log('\n' + '─'.repeat(50))
  console.log(`First recorded: ${fD(d.created)}`)
  console.log(`Last updated: ${fD(d.lastUpdated)}`)
  const p = Object.keys(d.byModel)
  if (p.length > 0) {
    console.log(`\nCost estimate (prices from ${PRICING_DATE}):`)
    for (const q of p) {
      const r = MODEL_PRICING[q]
      if (r) console.log(`  ${q}: ${r.input}/1M in, ${r.output}/1M out`)
    }
  }
  console.log('')
  console.log('Options:')
  console.log('  lk stats --json    Output raw JSON')
  console.log('  lk stats --reset   Reset statistics')
}
function calcSavings(r, d) {
  const ops = d.byOperationType || {}
  const expKeys = Object.keys(ops).filter(k => k.toLowerCase().includes('expand'))
  if (expKeys.length === 0) return null
  let tokIn = 0, tokOut = 0, tUsed = 0, syncIn = 0, syncOut = 0
  for (const k of expKeys) {
    const o = ops[k]
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
  const tokSaved = Math.round((tokIn + tokOut) * (eff - 1))
  const costUsed = calcCost(tokIn + syncIn, tokOut + syncOut, LK_PRICE)
  const opusTokIn = tokIn * eff, opusTokOut = tokOut * eff
  const opusCost = calcCost(opusTokIn, opusTokOut, OPUS_PRICE)
  const costSaved = opusCost - costUsed
  return { files, eff, tSaved, tokSaved, costUsed, opusCost, costSaved }
}
function fN(n) { return n.toLocaleString() }
function fC(c) {
  if (c < 0.01) return c.toFixed(4)
  if (c < 1) return c.toFixed(3)
  return c.toFixed(2)
}
function fD(iS) {
  try { return new Date(iS).toLocaleString() }
  catch { return iS }
}
function fT(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}
