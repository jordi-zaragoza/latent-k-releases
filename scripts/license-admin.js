#!/usr/bin/env node
import {createSign,createVerify,generateKeyPairSync,randomBytes} from 'crypto'
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'fs'
import {join} from 'path'
import {homedir} from 'os'
const KEYS_DIR = join(homedir(), '.lk-keys')
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'private.pem')
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'public.pem')
export function generateKeyPair() {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 })
  if (existsSync(PRIVATE_KEY_PATH)) {
    console.log('E_KEYS_EXIST:', KEYS_DIR)
    return { privateKey: readFileSync(PRIVATE_KEY_PATH, 'utf8'), publicKey: readFileSync(PUBLIC_KEY_PATH, 'utf8') }
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 })
  writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 })
  console.log('KEYS_GENNED:', KEYS_DIR)
  console.log('PK_SAVE_SECURELY. PUBK_EMBED_SRC.')
  return { privateKey, publicKey }
}
function getPrivateKey() {
  if (!existsSync(PRIVATE_KEY_PATH)) throw new Error('E_NO_PK_FOUND')
  return readFileSync(PRIVATE_KEY_PATH, 'utf8')
}
function getPublicKey() {
  if (!existsSync(PUBLIC_KEY_PATH)) throw new Error('E_NO_PUBK_FOUND')
  return readFileSync(PUBLIC_KEY_PATH, 'utf8')
}
export function generateLicense(opts = {}) {
  if (!opts.email) throw new Error('E_EMAIL_REQ')
  const pk = getPrivateKey()
  let exp = opts.expires || null
  if (opts.durationDays && !exp) exp = Date.now() + opts.durationDays * 24 * 60 * 60 * 1000
  const d = {
    id: randomBytes(8).toString('hex'),
    type: opts.type || 'standard',
    email: opts.email.toLowerCase().trim(),
    created: Date.now(),
    expires: exp
  }
  const p = Buffer.from(JSON.stringify(d)).toString('base64url')
  const s = createSign('SHA256')
  s.update(p)
  const sig = s.sign(pk, 'base64url')
  return `LK-${p}.${sig}`
}
export function validateLicenseOffline(k) {
  try {
    if (!k || !k.startsWith('LK-')) return { valid: false, error: 'E_INV_FMT' }
    const ps = k.slice(3).split('.')
    if (ps.length !== 2) return { valid: false, error: 'E_INV_FMT' }
    const [p, sig] = ps
    const pubk = getPublicKey()
    const v = createVerify('SHA256')
    v.update(p)
    if (!v.verify(pubk, sig, 'base64url')) return { valid: false, error: 'E_INV_SIG' }
    const d = JSON.parse(Buffer.from(p, 'base64url').toString())
    if (d.expires && Date.now() > d.expires) return { valid: false, error: 'E_EXPIRED', data: d }
    return { valid: true, data: d }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}
export function parseLicense(k) {
  try {
    if (!k || !k.startsWith('LK-')) return null
    const p = k.slice(3).split('.')[0]
    return JSON.parse(Buffer.from(p, 'base64url').toString())
  } catch {
    return null
  }
}
export function generateBatch(cnt, opts = {}) {
  const ls = []
  for (let i = 0; i < cnt; i++) ls.push(generateLicense(opts))
  return ls
}
function parseArgs(a) {
  const opts = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--email' && a[i + 1]) opts.email = a[++i]
    else if (a[i] === '--type' && a[i + 1]) opts.type = a[++i]
    else if (a[i] === '--days' && a[i + 1]) opts.durationDays = parseInt(a[++i], 10)
  }
  return opts
}
function cli() {
  const [,, cmd, ...a] = process.argv
  switch (cmd) {
    case 'keys': generateKeyPair(); break
    case 'generate': {
      const opts = parseArgs(a)
      const l = generateLicense(opts)
      console.log('\nLICENSE:', l, '\nDATA:', parseLicense(l))
      break
    }
    case 'batch': {
      const cnt = parseInt(a[0], 10) || 1
      const opts = parseArgs(a.slice(1))
      const ls = generateBatch(cnt, opts)
      console.log(`\nGENNED_${cnt}_LICENSES:\n`)
      ls.forEach((l, i) => console.log(`${i + 1}. ${l}`))
      break
    }
    case 'verify': {
      const k = a[0]
      if (!k) {
        console.error('Usage: license-admin.js verify <license-key>')
        process.exit(1)
      }
      const res = validateLicenseOffline(k)
      console.log('\nVERIFY_RES:', res)
      break
    }
    default:
      console.log(`
License Administration Tool
Usage:
  node scripts/license-admin.js keys
  node scripts/license-admin.js generate [options]
  node scripts/license-admin.js batch <count> [options]
  node scripts/license-admin.js verify <key>
Options:
  --email <email>
  --type <type>
  --days <days>
`)
  }
}
if (process.argv[1]?.includes('license-admin')) cli()