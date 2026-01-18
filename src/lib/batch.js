import fs from 'fs'
import path from 'path'
import { log } from './config.js'
import { addEntry, inferGroup, loadIgnore, saveIgnore, inferDomainFromPath, inferSymbolFromPath, VALID_SYMBOLS } from './context.js'
import { extractExports } from './parser.js'
import { analyzeFiles } from './ai.js'
import { withSpinner } from './spinner.js'

// Default symbol when AI returns invalid symbol
const DEFAULT_SYMBOL = 'λ'

// Batch processing limits
export const MAX_FILES_PER_SYNC = 5
export const MAX_CHARS_PER_FILE = 8000
export const MAX_BATCH_CHARS = 100000
export const MAX_LINES_PER_FILE = 150
export const MAX_FILE_SIZE = 1024 * 1024  // 1MB max file size to read

/**
 * Extract distributed sections from a file
 * Dynamically calculates number of sections based on file size
 * @param {string} content - File content
 * @param {number} maxLines - Maximum lines to include
 * @returns {{content: string, truncated: boolean}}
 */
export function extractDistributedSections(content, maxLines = MAX_LINES_PER_FILE) {
  const lines = content.split('\n')

  if (lines.length <= maxLines) {
    return { content, truncated: false }
  }

  // Calculate number of sections based on file size
  // Larger files get more sections for better coverage
  const ratio = lines.length / maxLines
  let numSections
  if (ratio <= 2) numSections = 3       // up to 2x: start, middle, end
  else if (ratio <= 4) numSections = 5  // up to 4x: 5 sections
  else if (ratio <= 8) numSections = 7  // up to 8x: 7 sections
  else numSections = 9                  // very large: 9 sections

  const linesPerSection = Math.floor(maxLines / numSections)
  const resultParts = []

  for (let i = 0; i < numSections; i++) {
    // Calculate where this section should start in the original file
    // Evenly distribute sections across the file
    const sectionStart = Math.floor((i / (numSections - 1)) * (lines.length - linesPerSection))
    const sectionEnd = Math.min(sectionStart + linesPerSection, lines.length)
    const section = lines.slice(sectionStart, sectionEnd)

    if (i > 0) {
      // Calculate omitted lines between previous section end and this section start
      const prevEnd = Math.floor(((i - 1) / (numSections - 1)) * (lines.length - linesPerSection)) + linesPerSection
      const omitted = sectionStart - prevEnd
      if (omitted > 0) {
        resultParts.push(`\n// ... (${omitted} lines omitted) ...\n`)
      }
    }

    resultParts.push(...section)
  }

  return { content: resultParts.join('\n'), truncated: true }
}

/**
 * Prepare files for AI batch analysis
 * Reads content, truncates large files, respects batch size limits
 * Validates files are regular files with reasonable size
 */
export function prepareBatch(cwd, filesToAnalyze) {
  const filesForAI = []
  let totalChars = 0

  for (const { file, status } of filesToAnalyze) {
    const fullPath = path.join(cwd, file)

    // Validate file before reading
    try {
      const stats = fs.lstatSync(fullPath)  // lstat doesn't follow symlinks

      // Skip symlinks to prevent reading arbitrary files
      if (stats.isSymbolicLink()) {
        log('BATCH', `Skipping symlink: ${file}`)
        continue
      }

      // Skip if not a regular file
      if (!stats.isFile()) {
        log('BATCH', `Skipping non-file: ${file}`)
        continue
      }

      // Skip files that are too large
      if (stats.size > MAX_FILE_SIZE) {
        log('BATCH', `Skipping large file (${stats.size} bytes): ${file}`)
        continue
      }
    } catch (err) {
      log('BATCH', `Error checking file ${file}: ${err.message}`)
      continue
    }

    const rawContent = fs.readFileSync(fullPath, 'utf8')
    const originalLength = rawContent.length
    const originalLines = rawContent.split('\n').length

    // Extract distributed sections if file is too large (by lines or chars)
    let fileContent = rawContent
    let truncated = false

    if (originalLines > MAX_LINES_PER_FILE) {
      const result = extractDistributedSections(rawContent, MAX_LINES_PER_FILE)
      fileContent = result.content
      truncated = result.truncated
    }

    // Additional char limit as safety net
    if (fileContent.length > MAX_CHARS_PER_FILE) {
      fileContent = fileContent.slice(0, MAX_CHARS_PER_FILE) + '\n// ... truncated'
      truncated = true
    }

    if (truncated) {
      log('BATCH', `Extracted sections from ${file}: ${originalLines} lines → ${MAX_LINES_PER_FILE} lines (${originalLength} → ${fileContent.length} chars)`)
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

      // Validate symbol from AI response - use default if invalid
      let symbol = analysis.symbol || DEFAULT_SYMBOL
      if (!VALID_SYMBOLS.includes(symbol)) {
        log('BATCH', `Invalid symbol "${symbol}" for ${file}, using default`)
        symbol = DEFAULT_SYMBOL
      }

      addEntry(
        cwd,
        domain,
        group,
        symbol,
        hash,
        file,
        analysis.description || '',
        exports
      )

      affectedDomains.add(domain)
      synced++
      print(`✓ ${symbol} ${file} → ${domain}`)
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
