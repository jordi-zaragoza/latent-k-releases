import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { log } from './config.js'
const LK_DIR = '.lk'
const STATS_FILE = 'stats.json'
export const PRICING_DATE = '2025-01-18'
export const MODEL_PRICING = {
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
}
export const statsPath = r => path.join(r, LK_DIR, STATS_FILE)
let currentRoot = null
const sessionId = randomBytes(8).toString('hex')
const sessionStart = new Date().toISOString()
let sessionRegistered = false
export function setStatsRoot(r) { currentRoot = r }
function getRoot() { return currentRoot || process.cwd() }
function createEmptyStats() {
  return {
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totals: {
      sessions: 0,
      calls: 0,
      errors: 0,
      charsSent: 0,
      charsReceived: 0,
      tokensSentEstimate: 0,
      tokensReceivedEstimate: 0,
      totalDurationMs: 0,
      costUsd: 0,
      parseSuccess: 0,
      parseFailed: 0
    },
    byOperation: {},
    byOperationType: {},
    byModel: {},
    sessions: [],
    calls: [],
    errors: []
  }
}
export function loadStats(r = null) {
  const rootDir = r || getRoot()
  const p = statsPath(rootDir)
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8')
      return JSON.parse(raw)
    }
  } catch (err) { log('STATS', `E_LOAD: ${err.message}`) }
  return createEmptyStats()
}
function registerSession(s) {
  if (sessionRegistered) return
  sessionRegistered = true
  s.totals.sessions = (s.totals.sessions || 0) + 1
  if (!s.sessions) s.sessions = []
  s.sessions.push({
    id: sessionId,
    start: sessionStart,
    callCount: 0
  })
  if (s.sessions.length > 100) s.sessions = s.sessions.slice(-100)
  log('STATS', `Registered session ${sessionId}`)
}
export function saveStats(s, r = null) {
  const rootDir = r || getRoot()
  const dir = path.join(rootDir, LK_DIR)
  const p = statsPath(rootDir)
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    s.lastUpdated = new Date().toISOString()
    fs.writeFileSync(p, JSON.stringify(s, null, 2))
    log('STATS', `Saved stats to ${p}`)
  } catch (err) { log('STATS', `E_SAVE: ${err.message}`) }
}
function estimateTokens(c) { return Math.ceil(c / 3.5) }
function calculateCost(m, iT, oT) {
  const p = MODEL_PRICING[m]
  if (!p) return 0
  const iC = (iT / 1_000_000) * p.input
  const oC = (oT / 1_000_000) * p.output
  return iC + oC
}
function updateAggregated(agg, k, cD) {
  if (!agg[k]) {
    agg[k] = {
      calls: 0,
      charsSent: 0,
      charsReceived: 0,
      tokensSentEstimate: 0,
      tokensReceivedEstimate: 0,
      totalDurationMs: 0,
      costUsd: 0
    }
  }
  agg[k].calls++
  agg[k].charsSent += cD.charsSent
  agg[k].charsReceived += cD.charsReceived
  agg[k].tokensSentEstimate += cD.tokensSentEstimate
  agg[k].tokensReceivedEstimate += cD.tokensReceivedEstimate
  agg[k].totalDurationMs += cD.durationMs
  agg[k].costUsd = (agg[k].costUsd || 0) + (cD.costUsd || 0)
}
export function recordCall({
  provider,
  operation,
  operationType,
  model,
  charsSent,
  charsReceived,
  durationMs,
  root = null
}) {
  const s = loadStats(root)
  registerSession(s)
  const tSE = estimateTokens(charsSent)
  const tRE = estimateTokens(charsReceived)
  const cU = calculateCost(model, tSE, tRE)
  const cD = {
    timestamp: new Date().toISOString(),
    sessionId,
    provider,
    operation,
    operationType,
    model,
    charsSent,
    charsReceived,
    tokensSentEstimate: tSE,
    tokensReceivedEstimate: tRE,
    costUsd: cU,
    durationMs
  }
  s.totals.calls++
  s.totals.charsSent += charsSent
  s.totals.charsReceived += charsReceived
  s.totals.tokensSentEstimate += tSE
  s.totals.tokensReceivedEstimate += tRE
  s.totals.costUsd = (s.totals.costUsd || 0) + cU
  s.totals.totalDurationMs += durationMs
  updateAggregated(s.byOperation, operation, { ...cD, tokensSentEstimate: tSE, tokensReceivedEstimate: tRE })
  if (operationType) {
    if (!s.byOperationType) s.byOperationType = {}
    updateAggregated(s.byOperationType, operationType, { ...cD, tokensSentEstimate: tSE, tokensReceivedEstimate: tRE })
  }
  updateAggregated(s.byModel, model, { ...cD, tokensSentEstimate: tSE, tokensReceivedEstimate: tRE })
  if (s.sessions && s.sessions.length > 0) {
    const cs = s.sessions.find(ses => ses.id === sessionId)
    if (cs) {
      cs.callCount++
      cs.lastCall = cD.timestamp
    }
  }
  s.calls.push(cD)
  if (s.calls.length > 1000) s.calls = s.calls.slice(-1000)
  saveStats(s, root)
  log('STATS', `Recorded call: ${operation} (${model}) - ${charsSent}→${charsReceived} chars, ${durationMs}ms`)
  return cD
}
export function getStatsSummary(r = null) {
  const s = loadStats(r)
  const tS = s.totals.sessions || 0
  const tE = s.totals.errors || 0
  const pS = s.totals.parseSuccess || 0
  const pF = s.totals.parseFailed || 0
  const tP = pS + pF
  return {
    totalSessions: tS,
    totalCalls: s.totals.calls,
    totalErrors: tE,
    avgCallsPerSession: tS > 0 ? Math.round((s.totals.calls / tS) * 10) / 10 : 0,
    totalCharsSent: s.totals.charsSent,
    totalCharsReceived: s.totals.charsReceived,
    totalTokensEstimate: s.totals.tokensSentEstimate + s.totals.tokensReceivedEstimate,
    totalCostUsd: s.totals.costUsd || 0,
    avgDurationMs: s.totals.calls > 0 ? Math.round(s.totals.totalDurationMs / s.totals.calls) : 0,
    parseSuccessRate: tP > 0 ? Math.round((pS / tP) * 1000) / 10 : 100,
    parseSuccess: pS,
    parseFailed: pF,
    byOperation: s.byOperation,
    byOperationType: s.byOperationType || {},
    byModel: s.byModel,
    recentErrors: (s.errors || []).slice(-5),
    created: s.created,
    lastUpdated: s.lastUpdated
  }
}
export function recordError({
  provider,
  operation,
  operationType,
  error,
  root = null
}) {
  const s = loadStats(root)
  if (!s.totals.errors) s.totals.errors = 0
  if (!s.errors) s.errors = []
  s.totals.errors++
  const eD = {
    timestamp: new Date().toISOString(),
    sessionId,
    provider,
    operation,
    operationType,
    error: String(error).slice(0, 500)
  }
  s.errors.push(eD)
  if (s.errors.length > 100) s.errors = s.errors.slice(-100)
  saveStats(s, root)
  log('STATS', `Recorded error: ${operationType || operation} - ${error}`)
  return eD
}
export function recordParseResult(res, r = null) {
  const s = loadStats(r)
  if (!s.totals.parseSuccess) s.totals.parseSuccess = 0
  if (!s.totals.parseFailed) s.totals.parseFailed = 0
  if (res) s.totals.parseSuccess++
  else s.totals.parseFailed++
  saveStats(s, r)
}
export function resetStats(r = null) {
  const s = createEmptyStats()
  saveStats(s, r)
  log('STATS', 'Stats reset')
  return s
}