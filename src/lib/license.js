import Conf from 'conf'
import { createHash, randomBytes } from 'crypto'
import { hostname, userInfo, networkInterfaces, cpus } from 'os'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { validateLicenseOffline, parseLicense } from './license-gen.js'

const GRACE_PERIOD_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

function isDevMode() {
  return process.env.LK_DEV === '1'
}

const TEST_LICENSES = new Set([
  'lk-test-license',
  'lk-dev-license'
])

function isTestLicense(key) {
  return isDevMode() && TEST_LICENSES.has(key)
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

  if (isTestLicense(key)) {
    return { valid: true, test: true }
  }

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

  if (result.error === 'License expired' && result.data) {
    const expiration = getLicenseExpiration()
    if (expiration && expiration.inGrace) {
      // Also verify email for grace period
      if (userEmail && result.data.email) {
        const normalizedUserEmail = userEmail.toLowerCase().trim()
        const normalizedLicenseEmail = result.data.email.toLowerCase().trim()
        if (normalizedUserEmail !== normalizedLicenseEmail) {
          return { valid: false, error: 'License email mismatch', expectedEmail: result.data.email }
        }
      }
      return { valid: true, data: result.data, expiration, inGrace: true }
    }
  }

  return { valid: false, error: result.error || 'Invalid license' }
}

export async function activateLicense(key, userEmail = null) {
  if (isTestLicense(key)) {
    setLicenseKey(key)
    store.set('licenseValid', true)
    store.set('licenseExpires', Date.now() + 365 * MS_PER_DAY)
    return { success: true, test: true }
  }

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

  if (isTestLicense(key)) {
    return { expires: null, daysLeft: null, inGrace: false }
  }

  const data = parseLicense(key)
  if (!data || !data.expires) {
    return { expires: null, daysLeft: null, inGrace: false }
  }

  const now = Date.now()
  const expires = data.expires
  const daysLeft = Math.ceil((expires - now) / MS_PER_DAY)
  const graceEnd = expires + GRACE_PERIOD_DAYS * MS_PER_DAY
  const inGrace = now > expires && now <= graceEnd
  const graceDaysLeft = inGrace ? Math.ceil((graceEnd - now) / MS_PER_DAY) : 0

  return {
    expires: new Date(expires),
    daysLeft,
    expired: now > expires,
    inGrace,
    graceDaysLeft,
    fullyExpired: now > graceEnd
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

  if (isTestLicense(key)) {
    return { allowed: true, message: null }
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

  if (result.error === 'License expired' && result.data) {
    // Verify email matches even for expired licenses
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
    if (expiration && expiration.inGrace) {
      return {
        allowed: true,
        message: `License expired. Grace period: ${expiration.graceDaysLeft} day${expiration.graceDaysLeft === 1 ? '' : 's'} left`
      }
    }
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
