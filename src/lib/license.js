import Conf from 'conf'
import { createHash, randomBytes } from 'crypto'
import { hostname, userInfo, networkInterfaces, cpus } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { validateLicenseOffline, parseLicense } from './license-gen.js'
const MS_PER_DAY = 24 * 60 * 60 * 1000
const ONLINE_CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
const LICENSE_API_URL = 'https://latent-k-payments.latent-k.workers.dev/api/check-license'
// Dev mode only when running from source (not compiled binary)
// This cannot be bypassed via environment variables
function isDevMode() {
  return !process.pkg
}
function deriveEncryptionKey(salt) {
  const h = hostname()
  const u = userInfo().username
  return createHash('sha256').update(`${h}:${u}:${salt}`).digest('hex')
}
function getDeviceId() {
  const deviceIdPath = join(homedir(), '.lk-device')
  if (existsSync(deviceIdPath)) {
    try {
      const stored = readFileSync(deviceIdPath, 'utf8').trim()
      if (stored.length === 32) return stored
    } catch {}
  }
  const h = hostname()
  const u = userInfo().username
  const cpuInfo = cpus()[0]?.model || ''
  const nics = networkInterfaces()
  const macs = Object.values(nics)
    .flat()
    .filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
    .map(n => n.mac)
    .sort()
    .join(',')
  const salt = randomBytes(8).toString('hex')
  const deviceId = createHash('sha256')
    .update(`${h}:${u}:${cpuInfo}:${macs}:${salt}`)
    .digest('hex')
    .slice(0, 32)
  try {
    writeFileSync(deviceIdPath, deviceId, { mode: 0o600 })
  } catch {}
  return deviceId
}
const store = new Conf({
  projectName: 'lk-license',
  encryptionKey: deriveEncryptionKey('license-v1')
})
export function getLicenseKey() {
  return store.get('licenseKey')
}
export function setLicenseKey(key) {
  store.set('licenseKey', key)
  // Clear any previous revocation state when setting a new license
  store.delete('revokedReason')
  store.delete('lastOnlineResult')
  store.delete('lastOnlineCheck')
}
export function clearLicense() {
  store.delete('licenseKey')
  store.delete('licenseValid')
  store.delete('licenseExpires')
}
export async function validateLicense(userEmail = null) {
  if (isDevMode()) return { valid: true, dev: true }
  const key = getLicenseKey()
  if (!key) return { valid: false, error: 'No license key' }
  const result = validateLicenseOffline(key)
  if (result.valid) {
    // Verify email matches if provided
    if (userEmail && result.data.email) {
      const normalizedUserEmail = userEmail.toLowerCase().trim()
      const normalizedLicenseEmail = result.data.email.toLowerCase().trim()
      if (normalizedUserEmail !== normalizedLicenseEmail) {
        return { valid: false, error: 'License email mismatch', expectedEmail: result.data.email }
      }
    }
    const expiration = getLicenseExpiration()
    return { valid: true, data: result.data, expiration }
  }
  return { valid: false, error: result.error || 'Invalid license' }
}
export async function activateLicense(key, userEmail = null) {
  const result = validateLicenseOffline(key)
  if (result.valid) {
    // Verify email matches if provided
    if (userEmail && result.data.email) {
      const normalizedUserEmail = userEmail.toLowerCase().trim()
      const normalizedLicenseEmail = result.data.email.toLowerCase().trim()
      if (normalizedUserEmail !== normalizedLicenseEmail) {
        return {
          success: false,
          error: `License registered to different email (${result.data.email})`
        }
      }
    }
    setLicenseKey(key)
    store.set('licenseValid', true)
    if (result.data.expires) {
      store.set('licenseExpires', result.data.expires)
    }
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error || 'Invalid license key' }
}
export function isLicensed() {
  if (isDevMode()) return true
  return !!getLicenseKey()
}
export function getLicenseExpiration() {
  const key = getLicenseKey()
  if (!key) return null
  const data = parseLicense(key)
  if (!data || !data.expires) {
    return { expires: null, daysLeft: null }
  }
  const now = Date.now()
  const expires = data.expires
  const daysLeft = Math.ceil((expires - now) / MS_PER_DAY)
  return {
    expires: new Date(expires),
    daysLeft,
    expired: now > expires
  }
}
/**
 * Check license status online (non-blocking)
 * Updates local cache and clears license if revoked
 */
async function checkOnline(email) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000) // 5s timeout
    const res = await fetch(`${LICENSE_API_URL}?email=${encodeURIComponent(email)}`, {
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!res.ok) {
      store.set('lastOnlineCheck', Date.now())
      return null
    }
    const data = await res.json()
    store.set('lastOnlineCheck', Date.now())
    store.set('lastOnlineResult', data)
    // Update local revocation state based on server response
    if (data.revoked) {
      store.set('revokedReason', data.revokeReason || 'License revoked')
    } else {
      // Clear revocation state if server says not revoked (unrevoke case)
      store.delete('revokedReason')
    }
    return data
  } catch (err) {
    // Network error - ignore, will retry next time
    // Still update timestamp to avoid hammering on network issues
    store.set('lastOnlineCheck', Date.now())
    return null
  }
}
/**
 * Force an online check and wait for result (blocking)
 * Use this when you need immediate status (e.g., lk status command)
 */
export async function forceCheckOnline() {
  const key = getLicenseKey()
  if (!key) return null
  const data = parseLicense(key)
  if (!data?.email) return null
  return checkOnline(data.email)
}
/**
 * Check if license was revoked (from cached online check)
 */
export function isLicenseRevoked() {
  const result = store.get('lastOnlineResult')
  return result?.revoked || false
}
/**
 * Get revocation reason if license was revoked
 */
export function getRevokedReason() {
  return store.get('revokedReason') || null
}
// Unified access check
export async function checkAccess(userEmail = null) {
  if (isDevMode()) {
    return { allowed: true, message: null }
  }
  // Check if license was previously revoked
  const revokedReason = getRevokedReason()
  if (revokedReason && !getLicenseKey()) {
    return {
      allowed: false,
      message: `License revoked: ${revokedReason}. Contact support.`
    }
  }
  const key = getLicenseKey()
  if (!key) {
    return {
      allowed: false,
      message: 'License required. Run: lk activate'
    }
  }
  const result = validateLicenseOffline(key)
  if (result.valid) {
    // Verify email matches if provided
    if (userEmail && result.data.email) {
      const normalizedUserEmail = userEmail.toLowerCase().trim()
      const normalizedLicenseEmail = result.data.email.toLowerCase().trim()
      if (normalizedUserEmail !== normalizedLicenseEmail) {
        return {
          allowed: false,
          message: `License registered to different email (${result.data.email})`
        }
      }
    }
    // Trigger online check if interval has passed (non-blocking)
    const lastCheck = store.get('lastOnlineCheck') || 0
    const now = Date.now()
    if (now - lastCheck > ONLINE_CHECK_INTERVAL && result.data.email) {
      // Fire and forget - don't block on network
      checkOnline(result.data.email).catch(() => {})
    }
    const expiration = getLicenseExpiration()
    if (expiration && expiration.daysLeft !== null && expiration.daysLeft <= 7 && expiration.daysLeft > 0) {
      return {
        allowed: true,
        message: `License expires in ${expiration.daysLeft} day${expiration.daysLeft === 1 ? '' : 's'}`
      }
    }
    return { allowed: true, message: null }
  }
  if (result.error === 'License expired') {
    return {
      allowed: false,
      message: 'License expired. Renew at: https://latent-k.pages.dev/activation'
    }
  }
  return {
    allowed: false,
    message: `License invalid: ${result.error}`
  }
}