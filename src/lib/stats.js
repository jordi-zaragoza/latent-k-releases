/**
 * Statistics tracking for LLM interactions
 * Stores per-project stats in .lk/stats.json
 */
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { log } from './config.js'
const LK_DIR = '.lk'
const STATS_FILE = 'stats.json'
// Pricing per 1M tokens
// Source: https://ai.google.dev/pricing, https://www.anthropic.com/pricing
export const PRICING_DATE = '2025-01-18'
export const MODEL_PRICING = {
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },    // $/1M tokens
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
}
// Get stats file path for a project root
export const statsPath = root => path.join(root, LK_DIR, STATS_FILE)
// Current project root (set by init or inferred from cwd)
let currentRoot = null
// Session tracking - unique ID per process, registered on first API call
const sessionId = randomBytes(8).toString('hex')
const sessionStart = new Date().toISOString()
let sessionRegistered = false
/**
 * Set the current project root for stats
 */
export function setStatsRoot(root) {
  currentRoot = root
}
/**
 * Get current project root (defaults to cwd)
 */
function getRoot() {
  return currentRoot || process.cwd()
}
/**
 * Load stats from disk
 */
export function loadStats(root = null) {
  const r = root || getRoot()
  const p = statsPath(r)
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8')
      return JSON.parse(raw)
    }
  } catch (err) {
    log('STATS', `Error loading stats: ${err.message}`)
  }
  // Return default empty stats structure
  return createEmptyStats()
}
/**
 * Create empty stats structure
 */
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
/**
 * Register current session (called on first API call)
 */
function registerSession(stats) {
  if (sessionRegistered) return
  sessionRegistered = true
  stats.totals.sessions = (stats.totals.sessions || 0) + 1
  // Initialize sessions array if not exists (for backwards compatibility)
  if (!stats.sessions) {
    stats.sessions = []
  }
  // Add session entry
  stats.sessions.push({
    id: sessionId,
    start: sessionStart,
    callCount: 0
  })
  // Keep last 100 sessions
  if (stats.sessions.length > 100) {
    stats.sessions = stats.sessions.slice(-100)
  }
  log('STATS', `Registered session ${sessionId}`)
}
/**
 * Save stats to disk
 */
export function saveStats(stats, root = null) {
  const r = root || getRoot()
  const dir = path.join(r, LK_DIR)
  const p = statsPath(r)
  try {
    // Ensure .lk directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    stats.lastUpdated = new Date().toISOString()
    fs.writeFileSync(p, JSON.stringify(stats, null, 2))
    log('STATS', `Saved stats to ${p}`)
  } catch (err) {
    log('STATS', `Error saving stats: ${err.message}`)
  }
}
/**
 * Estimate tokens from character count
 * Using ~3.5 chars per token (accounts for LK syntax special chars)
 */
function estimateTokens(chars) {
  return Math.ceil(chars / 3.5)
}
/**
 * Calculate cost for a call based on model pricing
 * @param {string} model - Model identifier
 * @param {number} inputTokens - Input tokens
 * @param {number} outputTokens - Output tokens
 * @returns {number} Cost in USD
 */
function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return 0
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}
/**
 * Update aggregated stats for a category (byOperation or byModel)
 */
function updateAggregated(aggregated, key, callData) {
  if (!aggregated[key]) {
    aggregated[key] = {
      calls: 0,
      charsSent: 0,
      charsReceived: 0,
      tokensSentEstimate: 0,
      tokensReceivedEstimate: 0,
      totalDurationMs: 0,
      costUsd: 0
    }
  }
  aggregated[key].calls++
  aggregated[key].charsSent += callData.charsSent
  aggregated[key].charsReceived += callData.charsReceived
  aggregated[key].tokensSentEstimate += callData.tokensSentEstimate
  aggregated[key].tokensReceivedEstimate += callData.tokensReceivedEstimate
  aggregated[key].totalDurationMs += callData.durationMs
  aggregated[key].costUsd = (aggregated[key].costUsd || 0) + (callData.costUsd || 0)
}
/**
 * Record a completed LLM call
 * @param {Object} params
 * @param {string} params.provider - Provider name (e.g., 'GEMINI')
 * @param {string} params.operation - Operation type (e.g., 'JSON API call', 'Text API call')
 * @param {string} params.model - Model identifier (e.g., 'gemini-2.5-flash')
 * @param {number} params.charsSent - Characters sent in prompt
 * @param {number} params.charsReceived - Characters received in response
 * @param {number} params.durationMs - Duration of call in milliseconds
 * @param {string} [params.root] - Project root (optional, uses current)
 */
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
  const stats = loadStats(root)
  // Register session on first call
  registerSession(stats)
  const tokensSentEstimate = estimateTokens(charsSent)
  const tokensReceivedEstimate = estimateTokens(charsReceived)
  const costUsd = calculateCost(model, tokensSentEstimate, tokensReceivedEstimate)
  const callData = {
    timestamp: new Date().toISOString(),
    sessionId,
    provider,
    operation,
    operationType,
    model,
    charsSent,
    charsReceived,
    tokensSentEstimate,
    tokensReceivedEstimate,
    costUsd,
    durationMs
  }
  // Update totals
  stats.totals.calls++
  stats.totals.charsSent += charsSent
  stats.totals.charsReceived += charsReceived
  stats.totals.tokensSentEstimate += tokensSentEstimate
  stats.totals.tokensReceivedEstimate += tokensReceivedEstimate
  stats.totals.costUsd = (stats.totals.costUsd || 0) + costUsd
  stats.totals.totalDurationMs += durationMs
  // Update by operation (API type: JSON API call, Text API call, etc.)
  updateAggregated(stats.byOperation, operation, { ...callData, tokensSentEstimate, tokensReceivedEstimate })
  // Update by operation type (logical: analyzeFile, classifyPrompt, etc.)
  if (operationType) {
    if (!stats.byOperationType) stats.byOperationType = {}
    updateAggregated(stats.byOperationType, operationType, { ...callData, tokensSentEstimate, tokensReceivedEstimate })
  }
  // Update by model
  updateAggregated(stats.byModel, model, { ...callData, tokensSentEstimate, tokensReceivedEstimate })
  // Update session call count
  if (stats.sessions && stats.sessions.length > 0) {
    const currentSession = stats.sessions.find(s => s.id === sessionId)
    if (currentSession) {
      currentSession.callCount++
      currentSession.lastCall = callData.timestamp
    }
  }
  // Add to calls array (keep last 1000 calls to avoid huge files)
  stats.calls.push(callData)
  if (stats.calls.length > 1000) {
    stats.calls = stats.calls.slice(-1000)
  }
  saveStats(stats, root)
  log('STATS', `Recorded call: ${operation} (${model}) - ${charsSent}→${charsReceived} chars, ${durationMs}ms`)
  return callData
}
/**
 * Get statistics summary
 */
export function getStatsSummary(root = null) {
  const stats = loadStats(root)
  const totalSessions = stats.totals.sessions || 0
  const totalErrors = stats.totals.errors || 0
  const parseSuccess = stats.totals.parseSuccess || 0
  const parseFailed = stats.totals.parseFailed || 0
  const totalParses = parseSuccess + parseFailed
  return {
    totalSessions,
    totalCalls: stats.totals.calls,
    totalErrors,
    avgCallsPerSession: totalSessions > 0
      ? Math.round((stats.totals.calls / totalSessions) * 10) / 10
      : 0,
    totalCharsSent: stats.totals.charsSent,
    totalCharsReceived: stats.totals.charsReceived,
    totalTokensEstimate: stats.totals.tokensSentEstimate + stats.totals.tokensReceivedEstimate,
    totalCostUsd: stats.totals.costUsd || 0,
    avgDurationMs: stats.totals.calls > 0
      ? Math.round(stats.totals.totalDurationMs / stats.totals.calls)
      : 0,
    parseSuccessRate: totalParses > 0
      ? Math.round((parseSuccess / totalParses) * 1000) / 10
      : 100,
    parseSuccess,
    parseFailed,
    byOperation: stats.byOperation,
    byOperationType: stats.byOperationType || {},
    byModel: stats.byModel,
    recentErrors: (stats.errors || []).slice(-5),
    created: stats.created,
    lastUpdated: stats.lastUpdated
  }
}
/**
 * Record an error
 * @param {Object} params
 * @param {string} params.provider - Provider name
 * @param {string} params.operation - Operation that failed
 * @param {string} params.operationType - Logical operation type
 * @param {string} params.error - Error message
 * @param {string} [params.root] - Project root
 */
export function recordError({
  provider,
  operation,
  operationType,
  error,
  root = null
}) {
  const stats = loadStats(root)
  // Initialize if needed (backwards compatibility)
  if (!stats.totals.errors) stats.totals.errors = 0
  if (!stats.errors) stats.errors = []
  stats.totals.errors++
  const errorData = {
    timestamp: new Date().toISOString(),
    sessionId,
    provider,
    operation,
    operationType,
    error: String(error).slice(0, 500) // Limit error message length
  }
  stats.errors.push(errorData)
  // Keep last 100 errors
  if (stats.errors.length > 100) {
    stats.errors = stats.errors.slice(-100)
  }
  saveStats(stats, root)
  log('STATS', `Recorded error: ${operationType || operation} - ${error}`)
  return errorData
}
/**
 * Record a parse result (success or failure)
 * @param {boolean} success - Whether parsing succeeded
 * @param {string} [root] - Project root
 */
export function recordParseResult(success, root = null) {
  const stats = loadStats(root)
  // Initialize if needed (backwards compatibility)
  if (!stats.totals.parseSuccess) stats.totals.parseSuccess = 0
  if (!stats.totals.parseFailed) stats.totals.parseFailed = 0
  if (success) {
    stats.totals.parseSuccess++
  } else {
    stats.totals.parseFailed++
  }
  saveStats(stats, root)
}
/**
 * Reset stats for a project
 */
export function resetStats(root = null) {
  const stats = createEmptyStats()
  saveStats(stats, root)
  log('STATS', 'Stats reset')
  return stats
}