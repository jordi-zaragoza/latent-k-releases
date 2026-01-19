import Conf from 'conf'
import { createHash, randomBytes } from 'crypto'
import { hostname, userInfo, networkInterfaces, cpus } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { validateLicenseOffline, parseLicense } from './license-gen.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

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

// Unified access check
export async function checkAccess(userEmail = null) {
  if (isDevMode()) {
    return { allowed: true, message: null }
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
      message: 'License expired. Renew at: https://latent-k.dev'
    }
  }

  return {
    allowed: false,
    message: `License invalid: ${result.error}`
  }
}
