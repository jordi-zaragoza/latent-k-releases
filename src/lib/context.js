import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import { log } from './config.js'
import { encrypt, decrypt } from './crypto.js'
const LK_DIR = '.lk'
/**
 * Safely decrypt content, handling corruption by deleting the file
 * @param {string} content - Encrypted content
 * @param {string} filePath - Path to the file (for deletion on corruption)
 * @returns {string|null} Decrypted content or null if corrupted
 */
function safeDecrypt(content, filePath) {
  try {
    return decrypt(content)
  } catch (err) {
    // Encryption key changed or file corrupted
    log('CONTEXT', `Corrupted file detected: ${filePath} - removing for resync`)
    try {
      fs.unlinkSync(filePath)
    } catch {
      // File may already be gone
    }
    return null
  }
}
const DOMAINS_DIR = 'domains'
const SYNTAX_FILE = 'syntax.lk'
const PROJECT_FILE = 'project.lk'
const PROJECT_HEADER_FILE = 'project_h.lk'
const IGNORE_FILE = 'ignore'
const STATE_FILE = 'state.json'
const VALID_SYMBOLS = ['▸', '⇄', 'λ', '⚙', '⧫', '⊚', '⟐', '◈', '⤳', '⚑', '◇']
// Shared file scanning constants
export const CODE_EXTENSIONS = [
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'go', 'rs', 'rb', 'php',
  'java', 'kt', 'kts', 'c', 'cpp', 'h', 'hpp',
  'cs', 'swift', 'scala', 'vue', 'svelte',
  'html', 'css'
]
export const IGNORE_DIRS = [
  'node_modules', '.git', '.claude', 'dist', 'build',
  '.next', '.nuxt', 'coverage', '__pycache__', '.pytest_cache',
  'vendor', 'target', '.idea', '.vscode',
  'venv', '.venv', 'env', 'tests', 'test', '__tests__'
]
export const IGNORE_FILES = [
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.DS_Store', 'Thumbs.db',
  '__init__.py', 'conftest.py', '__main__.py',
  'mod.rs', 'lib.rs'
]
// File utilities
export function getFileExtension(filePath) {
  const parts = filePath.split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}
export function isCodeFile(filePath) {
  return CODE_EXTENSIONS.includes(getFileExtension(filePath))
}
/**
 * Check if directory is home or root (always invalid)
 */
export function isHomeOrRoot(dir) {
  const home = homedir()
  return dir === home || dir === '/' || dir === home + '/'
}
/**
 * Check if directory looks like a valid project root
 */
export function validateProjectDirectory(dir) {
  // Project indicators
  const PROJECT_MARKERS = [
    'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
    'pom.xml', 'build.gradle', 'Makefile', 'CMakeLists.txt',
    '.git', 'composer.json', 'Gemfile', 'requirements.txt'
  ]
  // Check if it's home or root (always invalid)
  if (isHomeOrRoot(dir)) {
    return { valid: false, reason: 'home_or_root' }
  }
  // Check for project markers
  const hasMarker = PROJECT_MARKERS.some(m => fs.existsSync(path.join(dir, m)))
  if (!hasMarker) {
    return { valid: false, reason: 'no_project_markers' }
  }
  // Check file count (quick scan)
  const files = getAllFiles(dir)
  if (files.length > 500) {
    return { valid: false, reason: 'too_many_files', count: files.length }
  }
  return { valid: true }
}
// Maximum directory depth to prevent stack overflow on deeply nested projects
const MAX_DEPTH = 15
export function getAllFiles(dir, root = dir, options = {}, depth = 0) {
  const { codeOnly = true } = options
  const files = []
  // Prevent stack overflow on deeply nested directories
  if (depth >= MAX_DEPTH) {
    log('CONTEXT', `Max depth (${MAX_DEPTH}) reached at ${dir} - skipping deeper directories`)
    return files
  }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (IGNORE_DIRS.includes(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(root, fullPath)
      if (entry.isDirectory()) {
        files.push(...getAllFiles(fullPath, root, options, depth + 1))
      } else if (entry.isFile()) {
        if (IGNORE_FILES.includes(entry.name)) continue
        if (codeOnly && !isCodeFile(entry.name)) continue
        files.push(relativePath)
      }
    }
  } catch (err) {
    log('CONTEXT', `Error reading directory ${dir}: ${err.message}`)
  }
  return files
}
// Paths
export const lkPath = root => path.join(root, LK_DIR)
export const domainsPath = root => path.join(root, LK_DIR, DOMAINS_DIR)
export const domainPath = (root, name) => path.join(domainsPath(root), `${name}.lk`)
export const syntaxPath = root => path.join(root, LK_DIR, SYNTAX_FILE)
export const projectPath = root => path.join(root, LK_DIR, PROJECT_FILE)
export const projectHeaderPath = root => path.join(root, LK_DIR, PROJECT_HEADER_FILE)
export const ignorePath = root => path.join(root, LK_DIR, IGNORE_FILE)
export const exists = root => fs.existsSync(lkPath(root))
export const ignoreExists = root => fs.existsSync(ignorePath(root))
export const statePath = root => path.join(root, LK_DIR, STATE_FILE)
// State tracking for deferred project regeneration
export function loadState(root) {
  try {
    const p = statePath(root)
    const raw = fs.readFileSync(p, 'utf8')
    if (!raw.trim()) return { syncCount: 0, pendingRegen: false, pendingChanges: 0 }
    const content = safeDecrypt(raw, p)
    if (content === null) return { syncCount: 0, pendingRegen: false, pendingChanges: 0 }
    return JSON.parse(content)
  } catch {
    return { syncCount: 0, pendingRegen: false, pendingChanges: 0 }
  }
}
export function saveState(root, state) {
  fs.writeFileSync(statePath(root), encrypt(JSON.stringify(state, null, 2)))
}
// Ignore file handling
export function loadIgnore(root) {
  const p = ignorePath(root)
  if (!fs.existsSync(p)) return []
  const raw = fs.readFileSync(p, 'utf8')
  if (!raw.trim()) return []
  const content = safeDecrypt(raw, p)
  if (content === null) return []
  return content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
}
export function saveIgnore(root, patterns) {
  const dir = lkPath(root)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(ignorePath(root), encrypt(patterns.join('\n') + '\n'))
  log('CONTEXT', `Saved ${patterns.length} ignore patterns`)
}
// Glob pattern matching with LRU cache (prevents memory leak)
const PATTERN_CACHE_MAX = 100
const patternCache = new Map()
function compilePattern(pattern) {
  if (patternCache.has(pattern)) {
    // Move to end (most recently used)
    const cached = patternCache.get(pattern)
    patternCache.delete(pattern)
    patternCache.set(pattern, cached)
    return cached
  }
  let regex = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { regex += '(.*/)?'; i += 3 }
      else if (i > 0 && pattern[i - 1] === '/') { regex += '.*'; i += 2 }
      else { regex += '.*'; i += 2 }
    } else if (c === '*') { regex += '[^/]*'; i++ }
    else if (c === '?') { regex += '.'; i++ }
    else if ('.+^${}()|[]\\'.includes(c)) { regex += '\\' + c; i++ }
    else { regex += c; i++ }
  }
  const compiled = new RegExp(`^${regex}$`)
  // Evict oldest entry if cache is full
  if (patternCache.size >= PATTERN_CACHE_MAX) {
    const oldest = patternCache.keys().next().value
    patternCache.delete(oldest)
  }
  patternCache.set(pattern, compiled)
  return compiled
}
function matchPattern(filePath, pattern) {
  return compilePattern(pattern).test(filePath)
}
export function isIgnored(filePath, patterns) {
  return patterns.some(p => matchPattern(filePath, p))
}
const DEFAULT_PROJECT = `⦓ID: PROJECT⦔
⟪VIBE: TODO⟫ ⟪NAME: TODO⟫ ⟪VERSION: 0.0.0⟫
⟦Δ: Purpose⟧
TODO: Describe what this project does.
⟦Δ: Stack⟧
∑ Tech [Runtime⇨TODO, Type⇨TODO]
⟦Δ: Flows⟧
∑ Flows [TODO]
`
const DEFAULT_SYNTAX = `⦓ID: LK-SYNTAX⦔
⟦Δ: Syntax ⫸ LK_Grammar⟧
⟦Δ: Delimiters⟧
∑ Delimiters [⦓ID⦔ → Identity, ⟦Δ⟧ → Section, ⟪VIBE⟫ → Intent, ∑ → List, ⦗INV⦘ → Invariant]
⟦Δ: Operators⟧
∑ Operators [⫸ → Transform, ⇨ → Assign, @path/ → Directory prefix]
⟦Δ: Symbols⟧
∑ Symbols [▸ → Entry, ⇄ → Interface, λ → Core, ⚙ → Config, ⧫ → Test, ⊚ → Component, ⟐ → Schema, ⤳ → Pipeline, ◈ → Background, ⚑ → State]
⟦Δ: Entry Format⟧
∑ Format [symbol filename [⦗hash⦘ "desc"? {exports}?]]
`
// Initialize .lk structure
export function init(root) {
  const dir = lkPath(root)
  const domains = domainsPath(root)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(domains)) fs.mkdirSync(domains, { recursive: true })
  // Create default syntax.lk if not exists
  const syntaxFile = syntaxPath(root)
  if (!fs.existsSync(syntaxFile)) {
    fs.writeFileSync(syntaxFile, encrypt(DEFAULT_SYNTAX))
    log('CONTEXT', 'Created default syntax.lk')
  }
  // Create default project.lk if not exists
  const projectFile = projectPath(root)
  if (!fs.existsSync(projectFile)) {
    fs.writeFileSync(projectFile, encrypt(DEFAULT_PROJECT))
    log('CONTEXT', 'Created default project.lk')
  }
  log('CONTEXT', `Initialized ${dir}`)
}
// Syntax file (LK grammar reference)
export function getSyntax(root) {
  const p = syntaxPath(root)
  if (!fs.existsSync(p)) return ''
  const raw = fs.readFileSync(p, 'utf8').trim()
  return safeDecrypt(raw, p) || ''
}
export function setSyntax(root, content) {
  init(root)
  fs.writeFileSync(syntaxPath(root), encrypt(content))
}
// Project file (project metadata)
export function getProject(root) {
  const p = projectPath(root)
  if (!fs.existsSync(p)) return ''
  const raw = fs.readFileSync(p, 'utf8').trim()
  return safeDecrypt(raw, p) || ''
}
// Project header (compact summary - pre-generated)
export function getProjectHeader(root) {
  const p = projectHeaderPath(root)
  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, 'utf8').trim()
    const content = safeDecrypt(raw, p)
    if (content !== null) return content
  }
  // Fallback: generate from project.lk if header doesn't exist or corrupted
  const project = getProject(root)
  return buildProjectHeader(project)
}
export function setProject(root, content, humanContent = null) {
  init(root)
  fs.writeFileSync(projectPath(root), encrypt(content))
  // Save project_h.lk - use provided human content or fallback to extracted header
  const header = humanContent || buildProjectHeader(content)
  fs.writeFileSync(projectHeaderPath(root), encrypt(header))
}
/**
 * Build compact project header from full project content
 * Extracts: ID line, VIBE/NAME, Purpose, Stack, Entry, Flows
 */
function buildProjectHeader(content) {
  if (!content) return ''
  const lines = content.split('\n')
  const result = []
  let inSection = false
  const sectionsToInclude = ['Purpose', 'Stack', 'Entry', 'Flows']
  for (const line of lines) {
    // Include header line
    if (line.includes('⦓ID: PROJECT⦔')) {
      result.push(line.trim())
      continue
    }
    // Include VIBE/NAME/VERSION line
    if (line.includes('⟪VIBE:') || line.includes('⟪NAME:')) {
      result.push(line.trim())
      continue
    }
    // Track sections we want
    const isTargetSection = sectionsToInclude.some(s =>
      line.includes(`⟦Δ: ${s}⟧`) || line.includes(`⟦${s}⟧`)
    )
    if (isTargetSection) {
      inSection = true
      result.push(line.trim())
      continue
    }
    // End section on new section marker
    if (line.includes('⟦Δ:') || (line.includes('⟦') && line.includes('⟧'))) {
      if (inSection && !sectionsToInclude.some(s => line.includes(s))) {
        inSection = false
      }
    }
    // Include content while in relevant sections
    if (inSection && line.trim()) {
      result.push(line.trim())
    }
  }
  return result.join('\n')
}
// Parse entry: symbol filename [⦗hash⦘ •? "desc"? {exports}?]
export function parseEntry(line, groupPath = '') {
  const m = line.match(/^\s*([▸⇄λ⚙⧫⊚⟐◈⤳⚑◇])\s+(.+?)\s*\[⦗([a-f0-9]+)⦘\s*(.*)?\]/)
  if (!m) return null
  const file = m[2]
  const fullPath = groupPath ? path.join(groupPath, file) : file
  let extra = (m[4] || '').trim()
  const compacted = extra.startsWith('•')||extra.startsWith('-c')
  if (compacted) extra = extra.replace(/^(•|-c)\s*/,'').trim()
  const descMatch = extra.match(/^"([^"]*)"/)
  const desc = descMatch ? descMatch[1] : ''
  const rest = descMatch ? extra.slice(descMatch[0].length).trim() : extra
  const exportsMatch = rest.match(/^\{([^}]*)\}/)
  if (exportsMatch) {
    const exports = exportsMatch[1] ? exportsMatch[1].split(/,\s*/) : []
    return { symbol: m[1], file, hash: m[3], path: fullPath, desc, exports, compacted }
  }
  return { symbol: m[1], file, hash: m[3], path: fullPath, desc: desc || rest, exports: [], compacted }
}
// Build entry line: • = compacted
export function buildEntry(symbol, file, hash, desc, exports = [], compacted = false) {
  const c = compacted ? '•' : ''
  const d = desc?.trim() ? `"${desc.trim()}"` : ''
  const e = exports.length ? `{${exports.join(',')}}` : ''
  const extra = [c, d, e].filter(Boolean).join(' ').trim()
  return extra ? `  ${symbol} ${file} [⦗${hash}⦘ ${extra}]` : `  ${symbol} ${file} [⦗${hash}⦘]`
}
// Parse domain file
export function parseDomain(content) {
  const result = { id: '', domain: '', vibe: '', groups: {}, invariants: [] }
  const lines = content.split('\n')
  let currentGroup = null
  let currentPath = ''
  for (const line of lines) {
    const idMatch = line.match(/⦓ID:\s*([^⦔]+)⦔/)
    if (idMatch) result.id = idMatch[1].trim()
    const domainMatch = line.match(/⟦Δ:\s*Domain\s*⫸\s*([^⟧]+)⟧/)
    if (domainMatch) result.domain = domainMatch[1].trim()
    const vibeMatch = line.match(/⟪VIBE:\s*([^⟫]+)⟫/)
    if (vibeMatch) result.vibe = vibeMatch[1].trim()
    const groupMatch = line.match(/^∑\s*(.+?)\s*\[/)
    if (groupMatch) {
      currentGroup = groupMatch[1]
      currentPath = ''
      result.groups[currentGroup] = []
    }
    if (currentGroup) {
      const pathMatch = line.match(/^\s*@(.+?)\/?$/)
      if (pathMatch) { currentPath = pathMatch[1].replace(/\/$/, ''); continue }
      const entry = parseEntry(line, currentPath)
      if (entry) result.groups[currentGroup].push(entry)
      if (line.trim() === ']') currentGroup = null
    }
    const invMatch = line.match(/⦗INV:\s*([^⦘]+)⦘\s*\[([^\]]+)\]/)
    if (invMatch) result.invariants.push({ name: invMatch[1], desc: invMatch[2] })
  }
  return result
}
// Build domain file content
export function buildDomain(id, domain, vibe, groups, invariants = []) {
  let out = `⦓ID: ${id}⦔\n`
  out += `⟦Δ: Domain ⫸ ${domain}⟧\n`
  if (vibe) out += `⟪VIBE: ${vibe}⟫\n`
  out += '\n'
  for (const [name, entries] of Object.entries(groups).filter(([, e]) => e.length > 0)) {
    out += `∑ ${name} [\n`
    const byDir = {}
    for (const e of entries) {
      const dir = path.dirname(e.path)
      const d = (dir === '.') ? '' : dir
      if (!byDir[d]) byDir[d] = []
      byDir[d].push(e)
    }
    const dirs = Object.keys(byDir).sort()
    let allEntries = []
    for (const dir of dirs) {
      if (dir) allEntries.push({ type: 'path', dir })
      for (const e of byDir[dir]) allEntries.push({ type: 'entry', e, dir })
    }
    for (let i = 0; i < allEntries.length; i++) {
      const item = allEntries[i]
      if (item.type === 'path') {
        out += `  @${item.dir}/\n`
      } else {
        const file = path.basename(item.e.path)
        out += buildEntry(item.e.symbol, file, item.e.hash, item.e.desc, item.e.exports || [], item.e.compacted === true)
        const isLast = i === allEntries.length - 1 || allEntries.slice(i + 1).every(x => x.type === 'path')
        if (!isLast) out += ','
        out += '\n'
      }
    }
    out += `]\n\n`
  }
  for (const inv of invariants) {
    out += `⦗INV: ${inv.name}⦘ [${inv.desc}]\n`
  }
  return out.trim() + '\n'
}
// List all domain files
export function listDomains(root) {
  const dir = domainsPath(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith('.lk')).map(f => f.replace('.lk', ''))
}
// Load domain
export function loadDomain(root, name) {
  const p = domainPath(root, name)
  if (!fs.existsSync(p)) return null
  const raw = fs.readFileSync(p, 'utf8')
  const content = safeDecrypt(raw, p)
  if (content === null) return null
  return parseDomain(content)
}
// Save domain
export function saveDomain(root, name, content) {
  const dir = domainsPath(root)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(domainPath(root, name), encrypt(content))
}
// Get all entries from all domains
export function getAllEntries(root) {
  const domains = listDomains(root)
  const entries = {}
  for (const domainName of domains) {
    const domain = loadDomain(root, domainName)
    if (!domain) continue
    for (const [group, items] of Object.entries(domain.groups)) {
      for (const e of items) {
        entries[e.path] = { domain: domainName, group, symbol: e.symbol, file: e.file, hash: e.hash, desc: e.desc }
      }
    }
  }
  return entries
}
// Add/update entry in domain
export function addEntry(root, domainName, group, symbol, hash, filePath, desc, exports = [], compacted = false) {
  init(root)
  // Remove from any other domain first
  const allDomains = listDomains(root)
  for (const d of allDomains) {
    if (d === domainName) continue
    const dp = domainPath(root, d)
    const rawDom = fs.readFileSync(dp, 'utf8')
    const decryptedDom = safeDecrypt(rawDom, dp)
    if (decryptedDom === null) continue
    const dom = parseDomain(decryptedDom)
    let modified = false
    for (const [g, items] of Object.entries(dom.groups)) {
      const idx = items.findIndex(e => e.path === filePath)
      if (idx >= 0) { items.splice(idx, 1); modified = true }
    }
    if (modified) saveDomain(root, d, buildDomain(dom.id, dom.domain, dom.vibe, dom.groups, dom.invariants))
  }
  const p = domainPath(root, domainName)
  let domain
  if (fs.existsSync(p)) {
    const rawContent = fs.readFileSync(p, 'utf8')
    const decryptedContent = safeDecrypt(rawContent, p)
    domain = decryptedContent ? parseDomain(decryptedContent) : null
  }
  // Create new domain if doesn't exist or was corrupted
  if (!domain) {
    domain = {
      id: `DOMAIN-${domainName.toUpperCase()}`,
      domain: domainName.charAt(0).toUpperCase() + domainName.slice(1),
      vibe: '',
      groups: {},
      invariants: []
    }
  }
  let existingGroup = null
  for (const [g, items] of Object.entries(domain.groups)) {
    if (items.find(e => e.path === filePath)) { existingGroup = g; break }
  }
  const targetGroup = existingGroup || group
  if (!domain.groups[targetGroup]) domain.groups[targetGroup] = []
  const existing = domain.groups[targetGroup].findIndex(e => e.path === filePath)
  const file = path.basename(filePath)
  const entry = { symbol, file, hash, path: filePath, desc, exports, compacted }
  if (existing >= 0) {
    domain.groups[targetGroup][existing] = entry
  } else {
    domain.groups[targetGroup].push(entry)
  }
  saveDomain(root, domainName, buildDomain(domain.id, domain.domain, domain.vibe, domain.groups, domain.invariants))
  log('CONTEXT', `Added ${symbol} ${filePath} to ${domainName}/${targetGroup}`)
}
// Mark file as compacted (add -c flag)
export function markCompacted(root, filePath) {
  const allDomains = listDomains(root)
  for (const d of allDomains) {
    const dom = loadDomain(root, d)
    if (!dom) continue
    for (const [g, items] of Object.entries(dom.groups)) {
      const entry = items.find(e => e.path === filePath)
      if (entry) {
        entry.compacted = true
        saveDomain(root, d, buildDomain(dom.id, dom.domain, dom.vibe, dom.groups, dom.invariants))
        log('CONTEXT', `Marked ${filePath} as compacted`)
        return true
      }
    }
  }
  return false
}
export function unmarkCompacted(root, filePath) {
  const allDomains = listDomains(root)
  for (const d of allDomains) {
    const dom = loadDomain(root, d)
    if (!dom) continue
    for (const [g, items] of Object.entries(dom.groups)) {
      const entry = items.find(e => e.path === filePath)
      if (entry && entry.compacted) {
        entry.compacted = false
        saveDomain(root, d, buildDomain(dom.id, dom.domain, dom.vibe, dom.groups, dom.invariants))
        return true
      }
    }
  }
  return false
}
// Remove entry from all domains
export function removeEntry(root, filePath) {
  const allDomains = listDomains(root)
  for (const d of allDomains) {
    const dp = domainPath(root, d)
    const rawDom = fs.readFileSync(dp, 'utf8')
    const decryptedDom = safeDecrypt(rawDom, dp)
    if (decryptedDom === null) continue
    const dom = parseDomain(decryptedDom)
    let modified = false
    for (const [g, items] of Object.entries(dom.groups)) {
      const idx = items.findIndex(e => e.path === filePath)
      if (idx >= 0) { items.splice(idx, 1); modified = true }
    }
    if (modified) {
      saveDomain(root, d, buildDomain(dom.id, dom.domain, dom.vibe, dom.groups, dom.invariants))
      log('CONTEXT', `Removed ${filePath} from ${d}`)
    }
  }
}
// Infer group from path
export function inferGroup(filePath) {
  const dir = path.dirname(filePath)
  if (dir === '.' || dir === '') return 'Files'
  const parts = dir.split('/')
  const last = parts[parts.length - 1]
  return last.charAt(0).toUpperCase() + last.slice(1)
}
// Compute SHA-256 hash of file content (first 7 hex chars)
export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 7)
}
// Get hash for a file
export function getFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null
  const content = fs.readFileSync(filePath, 'utf8')
  return hashContent(content)
}
// Build verbose context: syntax + project + domains (full formatting)
export function buildVerboseContext(root) {
  try {
    const parts = []
    // 1. Syntax (LK grammar reference)
    const syntax = getSyntax(root)
    if (syntax) parts.push(syntax)
    // 2. Project metadata
    const project = getProject(root)
    if (project) parts.push(project)
    // 3. All domain files (skip empty domains)
    const domains = listDomains(root)
    for (const name of domains.sort()) {
      const domain = loadDomain(root, name)
      if (!domain) continue
      // Check if domain has any entries
      const hasEntries = Object.values(domain.groups).some(g => g.length > 0)
      if (!hasEntries) continue
      const p = domainPath(root, name)
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8').trim()
        const content = safeDecrypt(raw, p)
        if (content) parts.push(content)
      }
    }
    return parts.join('\n\n')
  } catch (e) {
    if (e.message.includes('No license key')) {
      return '[License required - run: lk activate]'
    }
    throw e
  }
}
// Get files that need sync (new or modified)
export function getUnsyncedFiles(root, allFiles) {
  const entries = getAllEntries(root)
  const unsynced = []
  for (const file of allFiles) {
    const fullPath = path.join(root, file)
    if (!fs.existsSync(fullPath)) continue
    const currentHash = getFileHash(fullPath)
    const entry = entries[file]
    if (!entry) {
      unsynced.push({ file, status: 'new', hash: currentHash })
    } else if (entry.hash !== currentHash) {
      unsynced.push({ file, status: 'modified', hash: currentHash, oldHash: entry.hash })
    }
  }
  return unsynced
}
// Get files that were deleted
export function getDeletedFiles(root) {
  const entries = getAllEntries(root)
  const deleted = []
  for (const [filePath, entry] of Object.entries(entries)) {
    const fullPath = path.join(root, filePath)
    if (!fs.existsSync(fullPath)) {
      deleted.push({ ...entry, file: filePath })
    }
  }
  return deleted
}
// Estimate token count (rough approximation: ~4 chars per token for mixed content)
export function countTokens(text) {
  const chars = text.length
  const lines = text.split('\n').length
  // LK syntax has many special chars, estimate ~3.5 chars per token
  const tokens = Math.ceil(chars / 3.5)
  return { tokens, chars, lines }
}
// Minify LK context string
export function minifyContext(text) {
  if (!text) return ''
  return text
    .split('\n').map(l => l.trim()).filter(l => l).join('')
    .replace(/⦓ID: DOMAIN-/g, '⦓').replace(/⦓ID: /g, '⦓')
    .replace(/⟦Δ: Domain ⫸ /g, '⟦').replace(/⟦Δ: /g, '⟦')
    .replace(/∑ /g, '∑')
    .replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').replace(/,\s+/g, ',')
    .replace(/\[⦗[a-f0-9]+⦘\s*/g, '[').replace(/\s+\[\]/g, '')
    .replace(/ → /g, '→').replace(/→ /g, '→')
    .replace(/⟧ ⟦/g, '⟧⟦').replace(/⟫ ⟪/g, '⟫⟪').replace(/⦔ ⟪/g, '⦔⟪').replace(/⫸ /g, '⫸')
    .replace(/VIBE: /g, 'VIBE:').replace(/NAME: /g, 'NAME:').replace(/VERSION: /g, 'VERSION:')
    .replace(/([▸⇄λ⚙⧫⊚⟐◈⤳⚑◇]) /g, '$1').replace(/@([^/]+)\/ /g, '@$1/')
    .replace(/ \[/g, '[').replace(/\[ /g, '[').replace(/• /g, '•').replace(/ \{/g, '{').replace(/ ⫸/g, '⫸').replace(/ \(/g, '(')
}
// Build context (default, minified)
export function buildContext(root) {
  const full = buildVerboseContext(root)
  if (!full) return ''
  if (full.startsWith('[License required')) return full
  return minifyContext(full)
}
// Infer domain from file path (e.g., src/api/* → 'api', tests/* → 'test')
export function inferDomainFromPath(filePath) {
  const parts = filePath.split('/')
  // Check for common patterns
  if (parts.includes('tests') || parts.includes('test') || parts.includes('__tests__')) {
    return 'test'
  }
  if (parts.includes('api')) return 'api'
  if (parts.includes('lib')) return 'core'
  if (parts.includes('commands') || parts.includes('cmd')) return 'cli'
  if (parts.includes('components')) return 'components'
  if (parts.includes('utils') || parts.includes('helpers')) return 'core'
  if (parts.includes('scripts')) return 'core'
  if (parts.includes('models') || parts.includes('schemas')) return 'data'
  if (parts.includes('routes') || parts.includes('handlers')) return 'api'
  if (parts.includes('middleware')) return 'api'
  if (parts.includes('config') || parts.includes('configs')) return 'core'
  // Default: use first meaningful directory after src/
  const srcIdx = parts.indexOf('src')
  if (srcIdx >= 0 && parts.length > srcIdx + 1) {
    return parts[srcIdx + 1]
  }
  return null
}
// Infer symbol from file path/name (e.g., *.test.* → ⧫, *config* → ⚙)
export function inferSymbolFromPath(filePath) {
  const basename = path.basename(filePath).toLowerCase()
  // Test files
  if (basename.includes('.test.') || basename.includes('.spec.') ||
      basename.includes('_test.') || basename.endsWith('_test.js') ||
      basename.endsWith('_test.ts')) {
    return '⧫'
  }
  // Config files
  if (basename.includes('config') || basename.includes('settings') ||
      basename.includes('.conf') || basename === 'setup.js' || basename === 'setup.ts') {
    return '⚙'
  }
  // Interface/API files
  if (basename.includes('interface') || basename.includes('api') ||
      basename.includes('route') || basename.includes('handler') ||
      basename.includes('controller')) {
    return '⇄'
  }
  // Schema/type files
  if (basename.includes('schema') || basename.includes('type') ||
      basename.includes('model') || basename.endsWith('.d.ts')) {
    return '⟐'
  }
  // Component files
  if (basename.includes('component') || basename.endsWith('.vue') ||
      basename.endsWith('.svelte') || basename.endsWith('.tsx') ||
      basename.endsWith('.jsx')) {
    return '⊚'
  }
  // Background/worker files
  if (basename.includes('worker') || basename.includes('job') ||
      basename.includes('queue') || basename.includes('cron')) {
    return '◈'
  }
  // State management
  if (basename.includes('store') || basename.includes('state') ||
      basename.includes('reducer') || basename.includes('context')) {
    return '⚑'
  }
  // Pipeline/flow files
  if (basename.includes('pipeline') || basename.includes('workflow') ||
      basename.includes('process')) {
    return '⤳'
  }
  // Default: core lambda
  return 'λ'
}
/**
 * Get project summary: extracts Purpose + Stack + Flows from project.lk
 * @param {string} root - Project root directory
 * @returns {string} Compact project summary
 * @deprecated Use getProjectHeader instead (reads pre-generated file)
 */
export function getProjectSummary(root) {
  return getProjectHeader(root)
}
/**
 * Get project flows: extracts only the Flows section from project.lk
 * @param {string} root - Project root directory
 * @returns {string} Flows section content
 */
export function getProjectFlows(root) {
  const project = getProject(root)
  if (!project) return ''
  const lines = project.split('\n')
  const result = []
  let inFlows = false
  for (const line of lines) {
    if (line.includes('⟦Δ: Flows⟧') || line.includes('⟦Flows⟧')) {
      inFlows = true
      continue
    }
    // End section on new section marker
    if (inFlows && (line.includes('⟦Δ:') || (line.includes('⟦') && line.includes('⟧')))) {
      break
    }
    if (inFlows && line.trim()) {
      result.push(line.trim())
    }
  }
  return result.join('\n')
}
/**
 * Get domain index: returns compressed index with paths + symbols only (no descriptions)
 * @param {string} root - Project root directory
 * @param {string[]} domainNames - List of domain names to include
 * @returns {string} Compact domain index
 */
export function getDomainIndex(root, domainNames) {
  const result = []
  for (const name of domainNames) {
    const domain = loadDomain(root, name)
    if (!domain) continue
    // Compact header: just domain name
    result.push(`⟦${domain.domain || name}⟧`)
    // Collect all entries with just symbol + path
    for (const [groupName, entries] of Object.entries(domain.groups)) {
      if (entries.length === 0) continue
      const paths = entries.map(e => `${e.symbol}${e.path}`).join(',')
      result.push(`${groupName}:[${paths}]`)
    }
  }
  return result.join('\n')
}
/**
 * Build context filtered for specific files based on their domains
 * @param {string} root - Project root directory
 * @param {string[]} files - List of file paths to build context for
 * @returns {string} Filtered and minified context
 */
export function buildContextForFiles(root, files) {
  const parts = []
  // 1. Always include syntax (LK grammar reference)
  const syntax = getSyntax(root)
  if (syntax) parts.push(syntax)
  // 2. Always include project metadata
  const project = getProject(root)
  if (project) parts.push(project)
  // 3. Infer domains from file paths
  const inferredDomains = new Set()
  for (const file of files) {
    const domain = inferDomainFromPath(file)
    if (domain) inferredDomains.add(domain)
  }
  // 4. Always include 'core' as fallback
  inferredDomains.add('core')
  // 5. Load only relevant domains
  const allDomains = listDomains(root)
  const relevantDomains = allDomains.filter(d =>
    inferredDomains.has(d.toLowerCase()) ||
    [...inferredDomains].some(inf => d.toLowerCase().includes(inf))
  )
  for (const name of relevantDomains) {
    const p = domainPath(root, name)
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim()
      const content = safeDecrypt(raw, p)
      if (content) parts.push(content)
    }
  }
  // 6. Apply same minification as buildContext()
  const full = parts.join('\n\n')
  if (!full) return ''
  return full
    .split('\n')
    .map(l => l.trim())
    .filter(l => l)
    .join('\n')
    .replace(/  +/g, ' ')
    .replace(/⦓ID: DOMAIN-/g, '⦓')
    .replace(/⦓ID: /g, '⦓')
    .replace(/⟦Δ: Domain ⫸ /g, '⟦')
    .replace(/⟦Δ: /g, '⟦')
    .replace(/∑ /g, '∑')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .replace(/,\s+/g, ',')
    .replace(/\[⦗[a-f0-9]+⦘\s*/g, '[')
    .replace(/\s+\[\]/g, '')
    // Remove spaces around arrows and between delimiters
    .replace(/ → /g, '→')
    .replace(/⟧ ⟦/g, '⟧⟦')
    .replace(/⟫ ⟪/g, '⟫⟪')
    .replace(/⦔ ⟪/g, '⦔⟪')
    .replace(/⫸ /g, '⫸')
}
export { VALID_SYMBOLS }