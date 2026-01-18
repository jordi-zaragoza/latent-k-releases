import fs from 'fs'
import path from 'path'
import { log } from './config.js'
import { addEntry, inferGroup, loadIgnore, saveIgnore, inferDomainFromPath, inferSymbolFromPath } from './context.js'
import { extractExports } from './parser.js'
import { analyzeFiles } from './ai.js'
import { withSpinner } from './spinner.js'

// Batch processing limits
export const MAX_FILES_PER_SYNC = 5
export const MAX_CHARS_PER_FILE = 8000
export const MAX_BATCH_CHARS = 100000

/**
 * Prepare files for AI batch analysis
 * Reads content, truncates large files, respects batch size limits
 */
export function prepareBatch(cwd, filesToAnalyze) {
  const filesForAI = []
  let totalChars = 0

  for (const { file, status } of filesToAnalyze) {
    const fullPath = path.join(cwd, file)
    let fileContent = fs.readFileSync(fullPath, 'utf8')

    // Truncate large files
    if (fileContent.length > MAX_CHARS_PER_FILE) {
      fileContent = fileContent.slice(0, MAX_CHARS_PER_FILE) + '\n// ... truncated'
      log('BATCH', `Truncated ${file} from ${fileContent.length} to ${MAX_CHARS_PER_FILE} chars`)
    }

    // Check if adding this file would exceed batch limit
    if (totalChars + fileContent.length > MAX_BATCH_CHARS && filesForAI.length > 0) {
      log('BATCH', 'Batch size limit reached')
      break
    }

    filesForAI.push({
      file,
      content: fileContent,
      action: status === 'new' ? 'created' : 'modified'
    })
    totalChars += fileContent.length
  }

  return { filesForAI, totalChars }
}

/**
 * Analyze a batch of files with AI
 */
export async function analyzeBatch(lkContent, filesForAI) {
  log('BATCH', `Analyzing ${filesForAI.length} files...`)
  const spinnerMsg = filesForAI.length === 1
    ? `Analyzing ${filesForAI[0].file}...`
    : `Analyzing ${filesForAI.length} files...`

  return withSpinner(spinnerMsg, () =>
    analyzeFiles({ lkContent, files: filesForAI })
  )
}

/**
 * Process AI analysis results and update context
 * Returns { synced, newIgnorePatterns, affectedDomains }
 */
export function processBatchResults(cwd, analyzedFiles, results, print, printErr) {
  const resultsMap = new Map(results.map(r => [r.file, r]))
  const newIgnorePatterns = []
  const affectedDomains = new Set()
  let synced = 0

  for (const { file, hash } of analyzedFiles) {
    try {
      const analysis = resultsMap.get(file) || { symbol: 'λ', description: null, domain: 'core' }
      log('BATCH', `Analysis for ${file}:`, JSON.stringify(analysis))

      // Handle ignore response
      if (analysis.ignore) {
        const pattern = `**/${path.basename(file)}`
        newIgnorePatterns.push(pattern)
        print(`⊘ ${file} → ignored`)
        log('BATCH', `⊘ Ignored: ${file}`)
        continue
      }

      const fullPath = path.join(cwd, file)
      const exports = extractExports(fullPath)
      const group = inferGroup(file)
      // Normalize domain to lowercase to avoid case-sensitive duplicates (Data.lk vs data.lk)
      const domain = (analysis.domain || 'core').toLowerCase()

      addEntry(
        cwd,
        domain,
        group,
        analysis.symbol || 'λ',
        hash,
        file,
        analysis.description || '',
        exports
      )

      affectedDomains.add(domain)
      synced++
      print(`✓ ${analysis.symbol || 'λ'} ${file} → ${domain}`)
      log('BATCH', `✓ Synced: ${file}`)
    } catch (err) {
      log('BATCH', `Error processing ${file}: ${err.message}`)
      printErr(`✗ ${file}: ${err.message}`)
    }
  }

  // Save new ignore patterns if any
  if (newIgnorePatterns.length > 0) {
    const currentPatterns = loadIgnore(cwd)
    const updatedPatterns = [...currentPatterns, '# Auto-detected', ...newIgnorePatterns]
    saveIgnore(cwd, updatedPatterns)
    log('BATCH', `Added ${newIgnorePatterns.length} new ignore patterns`)
  }

  return { synced, affectedDomains }
}

/**
 * Process deferred new files (add with placeholder hash)
 * Returns affected domains
 */
export function processDeferredFiles(cwd, deferredNew, print, printErr) {
  const affectedDomains = new Set()

  for (const { file } of deferredNew) {
    try {
      const fullPath = path.join(cwd, file)
      const exports = extractExports(fullPath)
      const group = inferGroup(file)
      // Normalize domain to lowercase for consistency
      const domain = (inferDomainFromPath(file) || 'core').toLowerCase()
      const symbol = inferSymbolFromPath(file) || 'λ'
      // Placeholder hash so it reappears as "modified" for AI analysis next sync
      addEntry(cwd, domain, group, symbol, '0000000', file, '', exports)
      affectedDomains.add(domain)
      print(`◇ ${file} → ${domain} (deferred)`)
      log('BATCH', `◇ Deferred new: ${file}`)
    } catch (err) {
      log('BATCH', `Error processing deferred ${file}: ${err.message}`)
      printErr(`✗ ${file}: ${err.message}`)
    }
  }

  return affectedDomains
}
