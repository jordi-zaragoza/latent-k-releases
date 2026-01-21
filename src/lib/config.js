import Conf from 'conf'
import { createHash, randomBytes } from 'crypto'
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir, hostname, userInfo } from 'os'
import { join, basename } from 'path'
// Cache installation salt
let cachedInstallationSalt = null
/**
 * Get or create a unique installation salt
 * Shared with crypto.js for consistent encryption
 */
function getInstallationSalt() {
  if (cachedInstallationSalt) {
    return cachedInstallationSalt
  }
  const lkDir = join(homedir(), '.lk')
  const saltPath = join(lkDir, '.salt')
  if (existsSync(saltPath)) {
    try {
      const salt = readFileSync(saltPath, 'utf8').trim()
      if (salt.length >= 64) {
        cachedInstallationSalt = salt
        return salt
      }
    } catch {
      // Fall through to generate new salt
    }
  }
  // Generate new salt (64 bytes = 128 hex chars)
  const newSalt = randomBytes(64).toString('hex')
  try {
    mkdirSync(lkDir, { recursive: true, mode: 0o700 })
    writeFileSync(saltPath, newSalt, { mode: 0o600 })
  } catch {
    // If we can't write, use ephemeral salt
  }
  cachedInstallationSalt = newSalt
  return newSalt
}
function deriveEncryptionKey(salt) {
  const h = hostname()
  const u = userInfo().username
  // Use installation-specific salt for added security
  const installationSalt = getInstallationSalt()
  return createHash('sha256').update(`${h}:${u}:${salt}:${installationSalt}`).digest('hex')
}
export const DEBUG = process.env.LK_DEBUG === '1'
const LOG_DIR = join(homedir(), '.lk')
const LOG_FILE = join(LOG_DIR, 'debug.log')
// Buffered logging configuration
const LOG_BUFFER_SIZE = 50        // Flush after this many messages
const LOG_FLUSH_INTERVAL_MS = 5000 // Or flush after this many ms
let logBuffer = []
let logDirCreated = false
let flushTimer = null
function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}
function ensureLogDir() {
  if (logDirCreated) return
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    logDirCreated = true
  } catch {}
}
/**
 * Flush buffered logs to disk
 */
function flushLogs() {
  if (logBuffer.length === 0) return
  ensureLogDir()
  try {
    appendFileSync(LOG_FILE, logBuffer.join(''))
  } catch {}
  logBuffer = []
  // Clear timer if exists
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}
// Flush on process exit
process.on('exit', flushLogs)
process.on('SIGINT', () => { flushLogs(); process.exit(0) })
process.on('SIGTERM', () => { flushLogs(); process.exit(0) })
export function log(category, ...args) {
  // Only log when running from source (not compiled binary)
  if (process.pkg) return
  const project = basename(process.cwd())
  const msg = `[${timestamp()}] [${project}] [${category}] ${args.join(' ')}\n`
  logBuffer.push(msg)
  // Flush if buffer is full
  if (logBuffer.length >= LOG_BUFFER_SIZE) {
    flushLogs()
    return
  }
  // Schedule flush if not already scheduled
  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, LOG_FLUSH_INTERVAL_MS)
  }
}
/**
 * Create Conf instance with auto-recovery from corrupted config
 * If encryption key changed, the old config can't be decrypted - delete and start fresh
 */
function createConfig() {
  const confOptions = {
    projectName: 'lk',
    encryptionKey: deriveEncryptionKey('config-v1'),
    schema: {
      aiProvider: { type: 'string', default: '' }, // 'anthropic' | 'gemini'
      anthropicApiKey: { type: 'string', default: '' },
      geminiApiKey: { type: 'string', default: '' },
      autoSync: { type: 'boolean', default: true },
      watchPatterns: {
        type: 'array',
        default: ['**/*.js', '**/*.ts', '**/*.py', '**/*.go', '**/*.rs', '**/*.java', '**/*.php', '**/*.rb']
      },
      ignorePatterns: {
        type: 'array',
        default: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/*.lock', '**/package-lock.json', '**/venv/**', '**/.venv/**', '**/__pycache__/**']
      },
      pureMode: { type: 'boolean', default: false }
    }
  }
  try {
    return new Conf(confOptions)
  } catch (err) {
    // Config file corrupted (encryption key changed) - delete and retry
    if (err.message?.includes('JSON') || err.message?.includes('Unexpected token')) {
      const configDir = join(homedir(), '.config', 'lk-nodejs')
      const configFile = join(configDir, 'config.json')
      try {
        if (existsSync(configFile)) {
          unlinkSync(configFile)
          console.error('[lk] Config file corrupted (encryption key changed) - reset to defaults')
        }
      } catch {
        // Ignore deletion errors
      }
      // Retry after deletion
      return new Conf(confOptions)
    }
    throw err
  }
}
const config = createConfig()
export function getAiProvider() {
  return config.get('aiProvider')
}
export function setAiProvider(provider) {
  config.set('aiProvider', provider)
}
export function getApiKey(provider = null) {
  const p = provider || config.get('aiProvider')
  return p === 'anthropic' ? config.get('anthropicApiKey') : config.get('geminiApiKey')
}
/**
 * Validate API key format before storing
 * @param {string} key - API key to validate
 * @param {string} provider - 'anthropic' or 'gemini'
 * @returns {{valid: boolean, error?: string}}
 */
export function validateApiKeyFormat(key, provider) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'API key is required' }
  }
  const trimmed = key.trim()
  if (provider === 'anthropic') {
    // Anthropic keys: sk-ant-api03-... (108 chars) or sk-... format
    if (!trimmed.startsWith('sk-')) {
      return { valid: false, error: 'Anthropic API key must start with "sk-"' }
    }
    if (trimmed.length < 40) {
      return { valid: false, error: 'Anthropic API key is too short (expected 40+ characters)' }
    }
  } else if (provider === 'gemini') {
    // Gemini keys: typically 39 alphanumeric characters
    if (trimmed.length < 30) {
      return { valid: false, error: 'Gemini API key is too short (expected 30+ characters)' }
    }
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      return { valid: false, error: 'Gemini API key contains invalid characters' }
    }
  }
  return { valid: true }
}
export function setApiKey(key, provider = null) {
  const p = provider || config.get('aiProvider')
  const validation = validateApiKeyFormat(key, p)
  if (!validation.valid) {
    throw new Error(validation.error)
  }
  if (p === 'anthropic') {
    config.set('anthropicApiKey', key.trim())
  } else {
    config.set('geminiApiKey', key.trim())
  }
}
export function getConfig() {
  return {
    aiProvider: config.get('aiProvider'),
    anthropicApiKey: config.get('anthropicApiKey'),
    geminiApiKey: config.get('geminiApiKey'),
    autoSync: config.get('autoSync'),
    watchPatterns: config.get('watchPatterns'),
    ignorePatterns: config.get('ignorePatterns'),
    pureMode: config.get('pureMode')
  }
}
export function getPureMode() {
  if (process.pkg) return false
  return config.get('pureMode')
}
export function setPureMode(enabled) {
  config.set('pureMode', !!enabled)
}
export function getIgnorePatterns() {
  return config.get('ignorePatterns')
}
export function isConfigured() {
  const provider = config.get('aiProvider')
  if (!provider) return false
  return provider === 'anthropic'
    ? !!config.get('anthropicApiKey')
    : !!config.get('geminiApiKey')
}
export { config }