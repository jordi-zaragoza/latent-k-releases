import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { log } from './config.js'
const LK_DIR = '.lk', STATS_FILE = 'stats.json'
export const PRICING_DATE = '2025-01-18'
export const MODEL_PRICING = {
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.5-flash-lite': { input: 0.01875, output: 0.075 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
}
export const statsPath = root => path.join(root, LK_DIR, STATS_FILE)
let currentRoot = null
const sessionId = randomBytes(8).toString('hex')
const sessionStart = new Date().toISOString()
let sessionRegistered = false
export function setStatsRoot(root) { currentRoot = root }
function getRoot() { return currentRoot || process.cwd() }
export function loadStats(root = null) {
  const r = root || getRoot(), p = statsPath(r)
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) { log('STATS', `Error loading: ${e.message}`) }
  return createEmptyStats()
}
function createEmptyStats() {
  const s = {
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totals: {
      sessions: 0, calls: 0, errors: 0, charsSent: 0, charsReceived: 0,
      tokensSentEstimate: 0, tokensReceivedEstimate: 0, totalDurationMs: 0,
      costUsd: 0, parseSuccess: 0, parseFailed: 0
    },
    byOperation: {}, byOperationType: {}, byModel: {}
  }
  if (!process.pkg) { s.sessions = []; s.calls = []; s.errors = [] }
  return s
}
function registerSession(stats) {
  if (sessionRegistered) return
  sessionRegistered = true
  stats.totals.sessions = (stats.totals.sessions || 0) + 1
  if (process.pkg) return
  if (!stats.sessions) stats.sessions = []
  stats.sessions.push({ id: sessionId, start: sessionStart, callCount: 0 })
  if (stats.sessions.length > 100) stats.sessions = stats.sessions.slice(-100)
  log('STATS', `Registered session ${sessionId}`)
}
export function saveStats(stats, root = null) {
  const r = root || getRoot(), dir = path.join(r, LK_DIR), p = statsPath(r)
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    stats.lastUpdated = new Date().toISOString()
    fs.writeFileSync(p, JSON.stringify(stats, null, 2))
    log('STATS', `Saved stats to ${p}`)
  } catch (e) { log('STATS', `Error saving: ${e.message}`) }
}
const estimateTokens = chars => Math.ceil(chars / 3.5)
function calculateCost(model, tokIn, tokOut) {
  const p = MODEL_PRICING[model]
  return p ? (tokIn / 1e6) * p.input + (tokOut / 1e6) * p.output : 0
}
function updateAggregated(agg, key, d) {
  if (!agg[key]) agg[key] = { calls: 0, charsSent: 0, charsReceived: 0, tokensSentEstimate: 0, tokensReceivedEstimate: 0, totalDurationMs: 0, costUsd: 0 }
  const a = agg[key]
  a.calls++
  a.charsSent += d.charsSent
  a.charsReceived += d.charsReceived
  a.tokensSentEstimate += d.tokensSentEstimate
  a.tokensReceivedEstimate += d.tokensReceivedEstimate
  a.totalDurationMs += d.durationMs
  a.costUsd = (a.costUsd || 0) + (d.costUsd || 0)
}
export function recordCall({ provider, operation, operationType, model, charsSent, charsReceived, durationMs, root = null }) {
  const stats = loadStats(root)
  registerSession(stats)
  const tokIn = estimateTokens(charsSent), tokOut = estimateTokens(charsReceived)
  const costUsd = calculateCost(model, tokIn, tokOut)
  const d = { timestamp: new Date().toISOString(), sessionId, provider, operation, operationType, model, charsSent, charsReceived, tokensSentEstimate: tokIn, tokensReceivedEstimate: tokOut, costUsd, durationMs }
  const t = stats.totals
  t.calls++; t.charsSent += charsSent; t.charsReceived += charsReceived
  t.tokensSentEstimate += tokIn; t.tokensReceivedEstimate += tokOut
  t.costUsd = (t.costUsd || 0) + costUsd; t.totalDurationMs += durationMs
  updateAggregated(stats.byOperation, operation, d)
  if (operationType) {
    if (!stats.byOperationType) stats.byOperationType = {}
    updateAggregated(stats.byOperationType, operationType, d)
  }
  updateAggregated(stats.byModel, model, d)
  if (!process.pkg) {
    if (stats.sessions?.length > 0) {
      const cur = stats.sessions.find(s => s.id === sessionId)
      if (cur) { cur.callCount++; cur.lastCall = d.timestamp }
    }
    if (!stats.calls) stats.calls = []
    stats.calls.push(d)
    if (stats.calls.length > 1000) stats.calls = stats.calls.slice(-1000)
  }
  saveStats(stats, root)
  log('STATS', `Recorded: ${operation} (${model}) - ${charsSent}→${charsReceived} chars, ${durationMs}ms`)
  return d
}
export function getStatsSummary(root = null) {
  const stats = loadStats(root)
  const t = stats.totals, sess = t.sessions || 0, errs = t.errors || 0
  const ps = t.parseSuccess || 0, pf = t.parseFailed || 0, tp = ps + pf
  return {
    totalSessions: sess, totalCalls: t.calls, totalErrors: errs,
    avgCallsPerSession: sess > 0 ? Math.round((t.calls / sess) * 10) / 10 : 0,
    totalCharsSent: t.charsSent, totalCharsReceived: t.charsReceived,
    totalTokensEstimate: t.tokensSentEstimate + t.tokensReceivedEstimate,
    totalCostUsd: t.costUsd || 0,
    avgDurationMs: t.calls > 0 ? Math.round(t.totalDurationMs / t.calls) : 0,
    parseSuccessRate: tp > 0 ? Math.round((ps / tp) * 1000) / 10 : 100,
    parseSuccess: ps, parseFailed: pf,
    byOperation: stats.byOperation, byOperationType: stats.byOperationType || {}, byModel: stats.byModel,
    recentErrors: (stats.errors || []).slice(-5),
    created: stats.created, lastUpdated: stats.lastUpdated
  }
}
export function recordError({ provider, operation, operationType, error, root = null }) {
  const stats = loadStats(root)
  if (!stats.totals.errors) stats.totals.errors = 0
  stats.totals.errors++
  const d = { timestamp: new Date().toISOString(), sessionId, provider, operation, operationType, error: String(error).slice(0, 500) }
  if (!process.pkg) {
    if (!stats.errors) stats.errors = []
    stats.errors.push(d)
    if (stats.errors.length > 100) stats.errors = stats.errors.slice(-100)
  }
  saveStats(stats, root)
  log('STATS', `Recorded error: ${operationType || operation} - ${error}`)
  return d
}
export function recordParseResult(success, root = null) {
  const stats = loadStats(root)
  if (!stats.totals.parseSuccess) stats.totals.parseSuccess = 0
  if (!stats.totals.parseFailed) stats.totals.parseFailed = 0
  success ? stats.totals.parseSuccess++ : stats.totals.parseFailed++
  saveStats(stats, root)
}
export function resetStats(root = null) {
  const stats = createEmptyStats()
  saveStats(stats, root)
  log('STATS', 'Stats reset')
  return stats
}
