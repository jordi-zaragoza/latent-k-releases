import Conf from 'conf'
import { createHash, randomBytes } from 'crypto'
import { hostname, userInfo, networkInterfaces, cpus, homedir } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { validateLicenseOffline, parseLicense } from './license-gen.js'
const MS_PER_DAY = 24 * 60 * 60 * 1000
const ONLINE_CHECK_INTERVAL = 24 * 60 * 60 * 1000
const LICENSE_API_URL = 'https://latent-k-payments.latent-k.workers.dev/api/check-license'
function isDevMode() { return !process.pkg }
function deriveEncryptionKey(s) {
  const h = hostname()
  const u = userInfo().username
  return createHash('sha256').update(`${h}:${u}:${s}`).digest('hex')
}
function getDeviceId() {
  const dp = join(homedir(), '.lk-device')
  if (existsSync(dp)) {
    try {
      const s = readFileSync(dp, 'utf8').trim()
      if (s.length === 32) return s
    } catch (e) {}
  }
  const h = hostname()
  const u = userInfo().username
  const cpu = cpus()[0]?.model || ''
  const nics = networkInterfaces()
  const macs = Object.values(nics)
    .flat()
    .filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
    .map(n => n.mac)
    .sort()
    .join(',')
  const s = randomBytes(8).toString('hex')
  const di = createHash('sha256')
    .update(`${h}:${u}:${cpu}:${macs}:${s}`)
    .digest('hex')
    .slice(0, 32)
  try {
    writeFileSync(dp, di, { mode: 0o600 })
  } catch (e) {}
  return di
}
const store = new Conf({
  projectName: 'lk-license',
  encryptionKey: deriveEncryptionKey('license-v1')
})
export function getLicenseKey() { return store.get('licenseKey') }
export function setLicenseKey(k) {
  store.set('licenseKey', k)
  store.delete('revokedReason')
  store.delete('lastOnlineResult')
  store.delete('lastOnlineCheck')
}
export function clearLicense() {
  store.delete('licenseKey')
  store.delete('licenseValid')
  store.delete('licenseExpires')
}
export async function validateLicense(em = null) {
  if (isDevMode()) return { valid: true, dev: true }
  const k = getLicenseKey()
  if (!k) return { valid: false, error: 'No license key' }
  const res = validateLicenseOffline(k)
  if (res.valid) {
    if (em && res.data.email) {
      const uem = em.toLowerCase().trim()
      const lem = res.data.email.toLowerCase().trim()
      if (uem !== lem) return { valid: false, error: 'License email mismatch', expectedEmail: res.data.email }
    }
    const exp = getLicenseExpiration()
    return { valid: true, data: res.data, expiration: exp }
  }
  return { valid: false, error: res.error || 'Invalid license' }
}
export async function activateLicense(k, em = null) {
  const res = validateLicenseOffline(k)
  if (res.valid) {
    if (em && res.data.email) {
      const uem = em.toLowerCase().trim()
      const lem = res.data.email.toLowerCase().trim()
      if (uem !== lem) return { success: false, error: `License registered to different email (${res.data.email})` }
    }
    setLicenseKey(k)
    store.set('licenseValid', true)
    if (res.data.expires) store.set('licenseExpires', res.data.expires)
    return { success: true, data: res.data }
  }
  return { success: false, error: res.error || 'Invalid license key' }
}
export function isLicensed() {
  if (isDevMode()) return true
  return !!getLicenseKey()
}
export function getLicenseExpiration() {
  const k = getLicenseKey()
  if (!k) return null
  const d = parseLicense(k)
  if (!d || !d.expires) return { expires: null, daysLeft: null }
  const now = Date.now()
  const expT = d.expires
  const dl = Math.ceil((expT - now) / MS_PER_DAY)
  return { expires: new Date(expT), daysLeft: dl, expired: now > expT }
}
async function checkOnline(em) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(`${LICENSE_API_URL}?email=${encodeURIComponent(em)}`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) {
      store.set('lastOnlineCheck', Date.now())
      return null
    }
    const d = await res.json()
    store.set('lastOnlineCheck', Date.now())
    store.set('lastOnlineResult', d)
    if (d.revoked) store.set('revokedReason', d.revokeReason || 'License revoked')
    else store.delete('revokedReason')
    return d
  } catch (e) {
    store.set('lastOnlineCheck', Date.now())
    return null
  }
}
export async function forceCheckOnline() {
  const k = getLicenseKey()
  if (!k) return null
  const d = parseLicense(k)
  if (!d?.email) return null
  return checkOnline(d.email)
}
export function isLicenseRevoked() {
  const res = store.get('lastOnlineResult')
  return res?.revoked || false
}
export function getRevokedReason() { return store.get('revokedReason') || null }
export async function checkAccess(em = null) {
  if (isDevMode()) return { allowed: true, message: null }
  const rr = getRevokedReason()
  if (rr && !getLicenseKey()) return { allowed: false, message: `License revoked: ${rr}. Contact support.` }
  const k = getLicenseKey()
  if (!k) return { allowed: false, message: 'License required. Run: lk activate' }
  const res = validateLicenseOffline(k)
  if (res.valid) {
    if (em && res.data.email) {
      const uem = em.toLowerCase().trim()
      const lem = res.data.email.toLowerCase().trim()
      if (uem !== lem) return { allowed: false, message: `License registered to different email (${res.data.email})` }
    }
    const lc = store.get('lastOnlineCheck') || 0
    const now = Date.now()
    if (now - lc > ONLINE_CHECK_INTERVAL && res.data.email) checkOnline(res.data.email).catch(() => {})
    const exp = getLicenseExpiration()
    if (exp && exp.daysLeft !== null && exp.daysLeft <= 7 && exp.daysLeft > 0) {
      return { allowed: true, message: `License expires in ${exp.daysLeft} day${exp.daysLeft === 1 ? '' : 's'}` }
    }
    return { allowed: true, message: null }
  }
  if (res.error === 'License expired') return { allowed: false, message: 'License expired. Renew at: https://latent-k.pages.dev/activation' }
  return { allowed: false, message: `License invalid: ${res.error}` }
}