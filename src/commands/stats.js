import { loadStats, resetStats, getStatsSummary, statsPath } from '../lib/stats.js'
import fs from 'fs'

/**
 * Display LLM usage statistics for the current project
 */
export async function stats(options = {}) {
  const cwd = process.cwd()
  const statsFile = statsPath(cwd)

  // Check if stats file exists
  if (!fs.existsSync(statsFile)) {
    console.log('No statistics recorded yet.')
    console.log('Stats will be collected automatically when you run lk commands that use AI.')
    return
  }

  // Handle reset option
  if (options.reset) {
    resetStats(cwd)
    console.log('Statistics reset.')
    return
  }

  // Handle raw JSON output
  if (options.json) {
    const stats = loadStats(cwd)
    console.log(JSON.stringify(stats, null, 2))
    return
  }

  // Display summary
  const summary = getStatsSummary(cwd)

  console.log('LLM Usage Statistics\n')
  console.log('─'.repeat(50))

  console.log('\nTotals:')
  console.log(`  Sessions: ${summary.totalSessions}`)
  console.log(`  Calls: ${summary.totalCalls}`)
  console.log(`  Avg calls/session: ${summary.avgCallsPerSession}`)
  console.log(`  Characters sent: ${formatNumber(summary.totalCharsSent)}`)
  console.log(`  Characters received: ${formatNumber(summary.totalCharsReceived)}`)
  console.log(`  Tokens (estimate): ${formatNumber(summary.totalTokensEstimate)}`)
  console.log(`  Avg duration: ${summary.avgDurationMs}ms`)

  // By operation type (logical operations like analyzeFile, classifyPrompt)
  const operationTypes = Object.keys(summary.byOperationType)
  if (operationTypes.length > 0) {
    console.log('\nBy Operation Type:')
    for (const opType of operationTypes.sort()) {
      const data = summary.byOperationType[opType]
      console.log(`  ${opType}:`)
      console.log(`    Calls: ${data.calls}`)
      console.log(`    Tokens sent: ${formatNumber(data.tokensSentEstimate)}`)
      console.log(`    Tokens received: ${formatNumber(data.tokensReceivedEstimate)}`)
    }
  }

  // By API operation (JSON API call, Text API call)
  const operations = Object.keys(summary.byOperation)
  if (operations.length > 0) {
    console.log('\nBy API Type:')
    for (const op of operations) {
      const data = summary.byOperation[op]
      console.log(`  ${op}:`)
      console.log(`    Calls: ${data.calls}`)
      console.log(`    Tokens (estimate): ${formatNumber(data.tokensSentEstimate + data.tokensReceivedEstimate)}`)
    }
  }

  // By model
  const models = Object.keys(summary.byModel)
  if (models.length > 0) {
    console.log('\nBy Model:')
    for (const model of models) {
      const data = summary.byModel[model]
      console.log(`  ${model}:`)
      console.log(`    Calls: ${data.calls}`)
      console.log(`    Tokens sent: ${formatNumber(data.tokensSentEstimate)}`)
      console.log(`    Tokens received: ${formatNumber(data.tokensReceivedEstimate)}`)
      console.log(`    Avg duration: ${Math.round(data.totalDurationMs / data.calls)}ms`)
    }
  }

  console.log('\n' + '─'.repeat(50))
  console.log(`First recorded: ${formatDate(summary.created)}`)
  console.log(`Last updated: ${formatDate(summary.lastUpdated)}`)
  console.log('')
  console.log('Options:')
  console.log('  lk stats --json    Output raw JSON')
  console.log('  lk stats --reset   Reset statistics')
}

function formatNumber(n) {
  return n.toLocaleString()
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleString()
  } catch {
    return isoString
  }
}
