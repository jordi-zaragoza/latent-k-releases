import fs from 'fs'
import path from 'path'
import { isConfigured, log, getIgnorePatterns } from '../lib/config.js'
import { checkAccess } from '../lib/license.js'
import { getClaudeUserEmail } from '../lib/claude-utils.js'
import { generateProject, generateIgnore } from '../lib/ai.js'
import {
  init, buildContext, buildContextForFiles, removeEntry,
  getAllEntries, getUnsyncedFiles, getDeletedFiles,
  getProject, setProject, ignoreExists, loadIgnore, saveIgnore, isIgnored,
  loadState, saveState, getAllFiles, exists, validateProjectDirectory, isHomeOrRoot
} from '../lib/context.js'
import { withSpinner } from '../lib/spinner.js'
import {
  MAX_FILES_PER_SYNC,
  prepareBatch, analyzeBatch, processBatchResults, processDeferredFiles
} from '../lib/batch.js'
const DEFAULT_FILE_THRESHOLD = 5
const DEFAULT_DOMAIN_THRESHOLD = 2
const REGEN_INTERVAL = 10
export async function syncProjectOnly() {
  const c = process.cwd()
  log('SYNC', '=== Starting project-only sync ===')
  const uE = getClaudeUserEmail()
  const a = await checkAccess(uE)
  if (!a.allowed) {
    log('SYNC', 'Access denied:', a.message)
    return { synced: false, error: a.message }
  }
  if (!isConfigured()) {
    log('SYNC', 'Not configured')
    return { synced: false, error: 'Not configured' }
  }
  if (!fs.existsSync(path.join(c, '.lk'))) {
    log('SYNC', 'No .lk directory')
    return { synced: false, error: 'No context' }
  }
  const cP = getProject(c)
  const nR = cP.includes('TODO') || cP.trim() === ''
  if (!nR) {
    log('SYNC', 'Project already up to date')
    return { synced: true }
  }
  try {
    const pP = path.join(c, 'package.json')
    const pJ = fs.existsSync(pP) ? fs.readFileSync(pP, 'utf8') : null
    const gP = getIgnorePatterns()
    const prP = loadIgnore(c)
    const iP = [...gP, ...prP]
    const aF = getAllFiles(c).filter(f => !isIgnored(f, iP))
    const fC = buildContext(c)
    log('SYNC', `Regenerating project.lk (${aF.length} files)...`)
    const r = await generateProject({ files: aF, packageJson: pJ, context: fC })
    setProject(c, r.lk, r.human)
    log('SYNC', '=== Project sync complete ===')
    return { synced: true }
  } catch (e) {
    log('SYNC', `Failed to generate project.lk: ${e.message}`)
    return { synced: false, error: e.message }
  }
}
export async function sync(o = {}) {
  log('HOOK', '#### Stop hook started ####')
  const c = process.cwd()
  const {
    regenerateProject: rP = false,
    quiet: q = false,
    fileThreshold: fT = DEFAULT_FILE_THRESHOLD,
    domainThreshold: dT = DEFAULT_DOMAIN_THRESHOLD,
    all: a = false
  } = o
  const p = q ? () => {} : console.log.bind(console)
  const pE = q ? () => {} : console.error.bind(console)
  log('SYNC', '=== Starting sync ===')
  log('SYNC', `Working directory: ${c}`)
  if (isHomeOrRoot(c)) {
    pE('Cannot sync in home/root directory.')
    process.exit(1)
  }
  const uE = getClaudeUserEmail()
  const acc = await checkAccess(uE)
  if (!acc.allowed) {
    log('SYNC', 'Access denied:', acc.message)
    pE(acc.message)
    process.exit(1)
  }
  if (acc.message) p(acc.message)
  log('SYNC', 'Access OK')
  if (!isConfigured()) {
    log('SYNC', 'Not configured')
    pE('Not configured. Run: lk setup')
    process.exit(1)
  }
  log('SYNC', 'Config OK')
  if (!exists(c)) {
    const v = validateProjectDirectory(c)
    if (!v.valid) {
      const rsn = v.reason === 'home_or_root'
        ? 'This looks like your home directory.'
        : v.reason === 'too_many_files'
        ? `Found ${v.count} code files (>500).`
        : 'No project markers found (package.json, .git, etc).'
      p(`⚠ Warning: ${rsn}`)
      p('Press Ctrl+C within 3 seconds to cancel...')
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  init(c)
  const gP = getIgnorePatterns()
  const prP = loadIgnore(c)
  log('SYNC', `Ignore patterns: ${gP.length} global + ${prP.length} project`)
  if (!ignoreExists(c)) {
    await generateProjectIgnore(c, gP, p, pE)
  }
  const iP = [...gP, ...loadIgnore(c)]
  const aFR = getAllFiles(c)
  const aF = aFR.filter(f => !isIgnored(f, iP))
  log('SYNC', `Found ${aFR.length} code files, ${aF.length} after ignore filter`)
  const u = getUnsyncedFiles(c, aF)
  const d = getDeletedFiles(c)
  const nI = findNowIgnoredFiles(c, iP)
  log('SYNC', `Unsynced: ${u.length}, Deleted: ${d.length}, Now ignored: ${nI.length}`)
  if (u.length === 0 && d.length === 0 && nI.length === 0 && !rP) {
    p('✓ Everything is in sync')
    log('SYNC', '=== Sync complete ===')
    return
  }
  const aD = new Set()
  removeFiles(c, d, nI, aD, p)
  const { synced: s, totalDeferred: tD, deferredNew: dN } = await processFiles(
    c, u, a, aD, p, pE
  )
  printSummary(s, tD, d.length, nI.length, p)
  await handleProjectRegeneration(
    c, aF, s, dN.length, d.length, nI.length,
    aD.size, rP, a, fT, dT,
    p, pE
  )
  log('SYNC', '=== Sync complete ===')
}
async function generateProjectIgnore(c, gP, p, pE) {
  log('SYNC', 'No project ignore file found, generating...')
  try {
    const aFI = getAllFiles(c, c, { codeOnly: false })
    const aIP = await withSpinner('Analyzing project for ignore patterns...', () =>
      generateIgnore({ files: aFI, globalPatterns: gP })
    )
    const gS = new Set(gP.map(pat => pat.replace(/^\*\*\//, '').replace(/\/\*\*$/, '')))
    const pO = aIP.filter(pat => {
      if (pat.startsWith('#')) return true
      const n = pat.replace(/^\*\*\//, '').replace(/\/\*\*$/, '')
      return !gS.has(n)
    })
    saveIgnore(c, pO)
    const cnt = pO.filter(pat => !pat.startsWith('#')).length
    p(cnt > 0
      ? `✓ Generated .lk/ignore (${cnt} project-specific patterns)`
      : '✓ Created .lk/ignore (no project-specific patterns)')
  } catch (e) {
    log('SYNC', `Failed to generate ignore: ${e.message}`)
    pE(`✗ Failed to generate ignore: ${e.message}`)
  }
}
function findNowIgnoredFiles(c, iP) {
  const aE = getAllEntries(c)
  return Object.entries(aE)
    .filter(([fP]) => isIgnored(fP, iP))
    .map(([fP, e]) => ({ ...e, file: fP }))
}
function removeFiles(c, del, nI, aD, p) {
  for (const { file: f, domain: dom } of del) {
    log('SYNC', `Removing deleted file: ${f}`)
    removeEntry(c, f)
    if (dom) aD.add(dom)
  }
  for (const { file: f, domain: dom } of nI) {
    log('SYNC', `Removing ignored file: ${f}`)
    removeEntry(c, f)
    p(`⊘ ${f} (removed - now ignored)`)
    if (dom) aD.add(dom)
  }
}
async function processFiles(c, u, a, aD, p, pE) {
  const gM = (f) => {
    try {
      return fs.statSync(path.join(c, f)).mtimeMs
    } catch {
      return 0
    }
  }
  const sBM = (x, y) => gM(y.file) - gM(x.file)
  const mod = u.filter(f => f.status === 'modified').sort(sBM)
  const nF = u.filter(f => f.status === 'new').sort(sBM)
  const aTP = [...mod, ...nF]
  const tB = a ? Math.ceil(aTP.length / MAX_FILES_PER_SYNC) : 1
  const fTD = a ? [] : aTP.slice(MAX_FILES_PER_SYNC)
  if (a && aTP.length > 0) {
    p(`Processing ${aTP.length} files in ${tB} batches...`)
  }
  let s = 0
  for (let b = 0; b < tB; b++) {
    const st = b * MAX_FILES_PER_SYNC
    const fTA = aTP.slice(st, st + MAX_FILES_PER_SYNC)
    if (fTA.length === 0) break
    if (a && tB > 1) p(`\n[Batch ${b + 1}/${tB}]`)
    try {
      const bF = fTA.map(f => f.file)
      const lC = buildContextForFiles(c, bF)
      const { filesForAI: fFAI } = prepareBatch(c, fTA)
      const res = await analyzeBatch(lC, fFAI)
      const aF = fTA.slice(0, fFAI.length)
      const bR = processBatchResults(c, aF, res, p, pE)
      s += bR.synced
      bR.affectedDomains.forEach(dom => aD.add(dom))
    } catch (e) {
      log('SYNC', `AI batch error: ${e.message}`)
      pE(`⚠ AI analysis failed for batch ${b + 1}: ${e.message}`)
      if (!a) fTD.push(...fTA)
    }
  }
  const dN = fTD.filter(f => f.status === 'new')
  const dM = fTD.filter(f => f.status === 'modified')
  const dD = processDeferredFiles(c, dN, p, pE)
  dD.forEach(dom => aD.add(dom))
  if (dM.length > 0) {
    p(`↻ ${dM.length} modified files deferred to next sync`)
    log('SYNC', `↻ Deferred ${dM.length} modified files`)
  }
  return {
    synced: s,
    totalDeferred: dN.length + dM.length,
    deferredNew: dN
  }
}
function printSummary(s, tD, dC, iC, p) {
  const tS = s + (tD > 0 ? tD : 0)
  p(`\nSynced ${tS} files (${s} analyzed` + (tD > 0 ? `, ${tD} deferred` : '') + ')')
  if (dC > 0 || iC > 0) {
    const pts = []
    if (dC > 0) pts.push(`${dC} deleted`)
    if (iC > 0) pts.push(`${iC} ignored`)
    p(`Removed ${pts.join(', ')} files`)
  }
}
async function handleProjectRegeneration(
  c, aF, s, dNC, dC, iC,
  dA, rP, a, fT, dT,
  p, pE
) {
  const st = loadState(c)
  st.syncCount = (st.syncCount || 0) + 1
  const cP = getProject(c)
  const tC = s + dNC + dC + iC
  log('SYNC', `Changes: ${tC} files, ${dA} domains affected`)
  if (tC >= fT || dA >= dT) {
    st.pendingRegen = true
    st.pendingChanges = (st.pendingChanges || 0) + tC
    log('SYNC', `Threshold exceeded, marking pending (${st.pendingChanges} total changes)`)
  }
  const fR = rP || a || cP.includes('TODO')
  const iR = st.pendingRegen && st.syncCount % REGEN_INTERVAL === 0
  const sR = fR || iR
  if (sR) {
    let rsn = '--regenerate-project flag'
    if (!rP) {
      if (a) rsn = '--all flag'
      else if (cP.includes('TODO')) rsn = 'contains TODO'
      else if (iR) rsn = `${st.pendingChanges} changes over ${st.syncCount} syncs`
    }
    log('SYNC', `Generating project.lk (${rsn})...`)
    p('')
    try {
      const pkP = path.join(c, 'package.json')
      const pJ = fs.existsSync(pkP) ? fs.readFileSync(pkP, 'utf8') : null
      const fC = buildContext(c)
      const res = await withSpinner('Regenerating project.lk...', () =>
        generateProject({ files: aF, packageJson: pJ, context: fC })
      )
      setProject(c, res.lk, res.human)
      p(`✓ Regenerated project.lk (${rsn})`)
      st.pendingRegen = false
      st.pendingChanges = 0
    } catch (e) {
      log('SYNC', `Failed to generate project.lk: ${e.message}`)
      pE(`✗ Failed to generate project.lk: ${e.message}`)
    }
  }
  saveState(c, st)
}