import Conf from 'conf'
import { createHash } from 'crypto'
import { appendFileSync, mkdirSync } from 'fs'
import { homedir, hostname, userInfo } from 'os'
import { join, basename } from 'path'

function deriveEncryptionKey(salt) {
  const h = hostname()
  const u = userInfo().username
  return createHash('sha256').update(`${h}:${u}:${salt}`).digest('hex')
}

export const DEBUG = process.env.LK_DEBUG === '1'
const LOG_DIR = join(homedir(), '.lk')
const LOG_FILE = join(LOG_DIR, 'debug.log')

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

function ensureLogDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
  } catch {}
}

export function log(category, ...args) {
  if (process.env.LK_DEV !== '1') return

  const project = basename(process.cwd())
  const msg = `[${timestamp()}] [${project}] [${category}] ${args.join(' ')}\n`

  ensureLogDir()
  appendFileSync(LOG_FILE, msg)
}

const config = new Conf({
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
    }
  }
})

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

export function setApiKey(key, provider = null) {
  const p = provider || config.get('aiProvider')
  if (p === 'anthropic') {
    config.set('anthropicApiKey', key)
  } else {
    config.set('geminiApiKey', key)
  }
}

export function getConfig() {
  return {
    aiProvider: config.get('aiProvider'),
    anthropicApiKey: config.get('anthropicApiKey'),
    geminiApiKey: config.get('geminiApiKey'),
    autoSync: config.get('autoSync'),
    watchPatterns: config.get('watchPatterns'),
    ignorePatterns: config.get('ignorePatterns')
  }
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
