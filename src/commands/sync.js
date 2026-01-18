import fs from 'fs'
import path from 'path'
import { isConfigured, log, getIgnorePatterns } from '../lib/config.js'
import { checkAccess } from '../lib/license.js'
import { generateProject, generateIgnore } from '../lib/ai.js'
import {
  init, buildContext, buildContextForFiles, removeEntry,
  getAllEntries, getUnsyncedFiles, getDeletedFiles,
  getProject, setProject, ignoreExists, loadIgnore, saveIgnore, isIgnored,
  loadState, saveState, getAllFiles
} from '../lib/context.js'
import { withSpinner } from '../lib/spinner.js'
import {
  MAX_FILES_PER_SYNC,
  prepareBatch, analyzeBatch, processBatchResults, processDeferredFiles
} from '../lib/batch.js'

// Thresholds for deferred project.lk regeneration
const DEFAULT_FILE_THRESHOLD = 5
const DEFAULT_DOMAIN_THRESHOLD = 2
const REGEN_INTERVAL = 10

export async function sync(options = {}) {
  log('HOOK', '#### Stop hook started ####')

  const cwd = process.cwd()
  const {
    regenerateProject = false,
    quiet = false,
    fileThreshold = DEFAULT_FILE_THRESHOLD,
    domainThreshold = DEFAULT_DOMAIN_THRESHOLD,
    all = false
  } = options
  const print = quiet ? () => {} : console.log.bind(console)
  const printErr = quiet ? () => {} : console.error.bind(console)

  log('SYNC', '=== Starting sync ===')
  log('SYNC', `Working directory: ${cwd}`)

  // Check access (license or trial)
  const access = await checkAccess()
  if (!access.allowed) {
    log('SYNC', 'Access denied:', access.message)
    printErr(access.message)
    process.exit(1)
  }
  if (access.message) print(access.message)
  log('SYNC', 'Access OK')

  if (!isConfigured()) {
    log('SYNC', 'Not configured')
    printErr('Not configured. Run: lk setup')
    process.exit(1)
  }
  log('SYNC', 'Config OK')

  // Initialize .lk if needed
  init(cwd)

  // Load and generate ignore patterns
  const globalPatterns = getIgnorePatterns()
  const projectPatterns = loadIgnore(cwd)
  log('SYNC', `Ignore patterns: ${globalPatterns.length} global + ${projectPatterns.length} project`)

  if (!ignoreExists(cwd)) {
    await generateProjectIgnore(cwd, globalPatterns, print, printErr)
  }

  const ignorePatterns = [...globalPatterns, ...loadIgnore(cwd)]

  // Discover files to sync
  const allFilesRaw = getAllFiles(cwd)
  const allFiles = allFilesRaw.filter(f => !isIgnored(f, ignorePatterns))
  log('SYNC', `Found ${allFilesRaw.length} code files, ${allFiles.length} after ignore filter`)

  const unsynced = getUnsyncedFiles(cwd, allFiles)
  const deleted = getDeletedFiles(cwd)
  const nowIgnored = findNowIgnoredFiles(cwd, ignorePatterns)

  log('SYNC', `Unsynced: ${unsynced.length}, Deleted: ${deleted.length}, Now ignored: ${nowIgnored.length}`)

  if (unsynced.length === 0 && deleted.length === 0 && nowIgnored.length === 0 && !regenerateProject) {
    print('✓ Everything is in sync')
    log('SYNC', '=== Sync complete ===')
    return
  }

  // Remove deleted and now-ignored files
  const affectedDomains = new Set()
  removeFiles(cwd, deleted, nowIgnored, affectedDomains, print)

  // Process files in batches
  const { synced, totalDeferred, deferredNew } = await processFiles(
    cwd, unsynced, all, affectedDomains, print, printErr
  )

  // Print summary
  printSummary(synced, totalDeferred, deleted.length, nowIgnored.length, print)

  // Handle project.lk regeneration
  await handleProjectRegeneration(
    cwd, allFiles, synced, deferredNew.length, deleted.length, nowIgnored.length,
    affectedDomains.size, regenerateProject, all, fileThreshold, domainThreshold,
    print, printErr
  )

  log('SYNC', '=== Sync complete ===')
}

async function generateProjectIgnore(cwd, globalPatterns, print, printErr) {
  log('SYNC', 'No project ignore file found, generating...')
  try {
    const allFilesForIgnore = getAllFiles(cwd, cwd, { codeOnly: false })
    const aiPatterns = await withSpinner('Analyzing project for ignore patterns...', () =>
      generateIgnore({ files: allFilesForIgnore, globalPatterns })
    )
    const globalSet = new Set(globalPatterns.map(p => p.replace(/^\*\*\//, '').replace(/\/\*\*$/, '')))
    const projectOnly = aiPatterns.filter(p => {
      if (p.startsWith('#')) return true
      const normalized = p.replace(/^\*\*\//, '').replace(/\/\*\*$/, '')
      return !globalSet.has(normalized)
    })
    saveIgnore(cwd, projectOnly)
    const count = projectOnly.filter(p => !p.startsWith('#')).length
    print(count > 0
      ? `✓ Generated .lk/ignore (${count} project-specific patterns)`
      : '✓ Created .lk/ignore (no project-specific patterns)')
  } catch (err) {
    log('SYNC', `Failed to generate ignore: ${err.message}`)
    printErr(`✗ Failed to generate ignore: ${err.message}`)
  }
}

function findNowIgnoredFiles(cwd, ignorePatterns) {
  const allEntries = getAllEntries(cwd)
  return Object.entries(allEntries)
    .filter(([filePath]) => isIgnored(filePath, ignorePatterns))
    .map(([filePath, entry]) => ({ ...entry, file: filePath }))
}

function removeFiles(cwd, deleted, nowIgnored, affectedDomains, print) {
  for (const { file, domain } of deleted) {
    log('SYNC', `Removing deleted file: ${file}`)
    removeEntry(cwd, file)
    if (domain) affectedDomains.add(domain)
  }
  for (const { file, domain } of nowIgnored) {
    log('SYNC', `Removing ignored file: ${file}`)
    removeEntry(cwd, file)
    print(`⊘ ${file} (removed - now ignored)`)
    if (domain) affectedDomains.add(domain)
  }
}

async function processFiles(cwd, unsynced, all, affectedDomains, print, printErr) {
  // Sort: modified first (by mtime), then new files
  // Uses try/catch to handle files that may have been deleted between discovery and sort
  const getMtime = (file) => {
    try {
      return fs.statSync(path.join(cwd, file)).mtimeMs
    } catch {
      return 0  // Deleted files sort to end
    }
  }
  const sortByMtime = (a, b) => getMtime(b.file) - getMtime(a.file)
  const modified = unsynced.filter(f => f.status === 'modified').sort(sortByMtime)
  const newFiles = unsynced.filter(f => f.status === 'new').sort(sortByMtime)
  const allToProcess = [...modified, ...newFiles]

  const totalBatches = all ? Math.ceil(allToProcess.length / MAX_FILES_PER_SYNC) : 1
  const filesToDefer = all ? [] : allToProcess.slice(MAX_FILES_PER_SYNC)

  if (all && allToProcess.length > 0) {
    print(`Processing ${allToProcess.length} files in ${totalBatches} batches...`)
  }

  let synced = 0

  // Process batches
  for (let batch = 0; batch < totalBatches; batch++) {
    const start = batch * MAX_FILES_PER_SYNC
    const filesToAnalyze = allToProcess.slice(start, start + MAX_FILES_PER_SYNC)
    if (filesToAnalyze.length === 0) break

    if (all && totalBatches > 1) print(`\n[Batch ${batch + 1}/${totalBatches}]`)

    try {
      // Build context filtered for this batch's files (reduces tokens ~50%)
      const batchFiles = filesToAnalyze.map(f => f.file)
      const lkContent = buildContextForFiles(cwd, batchFiles)

      const { filesForAI } = prepareBatch(cwd, filesToAnalyze)
      const results = await analyzeBatch(lkContent, filesForAI)
      const analyzedFiles = filesToAnalyze.slice(0, filesForAI.length)
      const batchResult = processBatchResults(cwd, analyzedFiles, results, print, printErr)

      synced += batchResult.synced
      batchResult.affectedDomains.forEach(d => affectedDomains.add(d))
    } catch (err) {
      log('SYNC', `AI batch error: ${err.message}`)
      printErr(`⚠ AI analysis failed for batch ${batch + 1}: ${err.message}`)
      if (!all) filesToDefer.push(...filesToAnalyze)
    }
  }

  // Process deferred files
  const deferredNew = filesToDefer.filter(f => f.status === 'new')
  const deferredModified = filesToDefer.filter(f => f.status === 'modified')

  const deferredDomains = processDeferredFiles(cwd, deferredNew, print, printErr)
  deferredDomains.forEach(d => affectedDomains.add(d))

  if (deferredModified.length > 0) {
    print(`↻ ${deferredModified.length} modified files deferred to next sync`)
    log('SYNC', `↻ Deferred ${deferredModified.length} modified files`)
  }

  return {
    synced,
    totalDeferred: deferredNew.length + deferredModified.length,
    deferredNew
  }
}

function printSummary(synced, totalDeferred, deletedCount, ignoredCount, print) {
  const totalSynced = synced + (totalDeferred > 0 ? totalDeferred : 0)
  print(`\nSynced ${totalSynced} files (${synced} analyzed` + (totalDeferred > 0 ? `, ${totalDeferred} deferred` : '') + ')')

  if (deletedCount > 0 || ignoredCount > 0) {
    const parts = []
    if (deletedCount > 0) parts.push(`${deletedCount} deleted`)
    if (ignoredCount > 0) parts.push(`${ignoredCount} ignored`)
    print(`Removed ${parts.join(', ')} files`)
  }
}

async function handleProjectRegeneration(
  cwd, allFiles, synced, deferredNewCount, deletedCount, ignoredCount,
  domainsAffected, regenerateProject, all, fileThreshold, domainThreshold,
  print, printErr
) {
  const state = loadState(cwd)
  state.syncCount = (state.syncCount || 0) + 1

  const currentProject = getProject(cwd)
  const totalChanges = synced + deferredNewCount + deletedCount + ignoredCount

  log('SYNC', `Changes: ${totalChanges} files, ${domainsAffected} domains affected`)

  // Check if threshold exceeded
  if (totalChanges >= fileThreshold || domainsAffected >= domainThreshold) {
    state.pendingRegen = true
    state.pendingChanges = (state.pendingChanges || 0) + totalChanges
    log('SYNC', `Threshold exceeded, marking pending (${state.pendingChanges} total changes)`)
  }

  // Decide if we should regenerate now
  const forceRegen = regenerateProject || all || currentProject.includes('TODO')
  const intervalRegen = state.pendingRegen && state.syncCount % REGEN_INTERVAL === 0
  const shouldRegenerate = forceRegen || intervalRegen

  if (shouldRegenerate) {
    let reason = '--regenerate-project flag'
    if (!regenerateProject) {
      if (all) reason = '--all flag'
      else if (currentProject.includes('TODO')) reason = 'contains TODO'
      else if (intervalRegen) reason = `${state.pendingChanges} changes over ${state.syncCount} syncs`
    }

    log('SYNC', `Generating project.lk (${reason})...`)
    print('')

    try {
      const pkgPath = path.join(cwd, 'package.json')
      const packageJson = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf8') : null
      const fullContext = buildContext(cwd)
      const projectContent = await withSpinner('Regenerating project.lk...', () =>
        generateProject({ files: allFiles, packageJson, context: fullContext })
      )
      setProject(cwd, projectContent)
      print(`✓ Regenerated project.lk (${reason})`)
      state.pendingRegen = false
      state.pendingChanges = 0
    } catch (err) {
      log('SYNC', `Failed to generate project.lk: ${err.message}`)
      printErr(`✗ Failed to generate project.lk: ${err.message}`)
    }
  }

  saveState(cwd, state)
}
