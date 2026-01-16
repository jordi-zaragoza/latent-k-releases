/**
 * License Validation (client-side only)
 *
 * This module contains ONLY validation functions that are safe to include in the binary.
 * Generation functions are in scripts/license-admin.js (never compiled into binary).
 */

import { createVerify } from 'crypto'

// Public key embedded in binary (for validation only)
const EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx9GbsLiv2hshCLjPSyaS
9cwh6MWlw9ck916siSPg4rFn+OaExxZXLHGAnaCeq/payXYFDrYOLm94RIgg0Re0
X+NPkWcDK5c3EG42kboRYLS5/uyyQ1kbHcapCqxQ0s4gxhLgiFQNCjLUjNjnl5Yi
Uo9hbrXdZEvFCmwVTigW7o2Mrk5jJLdUn85r/V73mNZ1Lz11muHaDeZRiw4F8v1c
5qXjcdxr8kixAB6Kqd6sP9oXPoRkbfgswpihFzv2XCrBZm+z/9K4NBMFXx/R/y24
R19BlU2aIqUKz1ubdrCxlTLNBiVuXRYLAYoTi+Vb7mOheYHgszddgIFxk8AutXD0
KQIDAQAB
-----END PUBLIC KEY-----`

// Get public key for validation
export function getPublicKey() {
  return EMBEDDED_PUBLIC_KEY
}

// Validate a license key (offline, uses embedded public key)
export function validateLicenseOffline(key) {
  try {
    if (!key || !key.startsWith('LK-')) {
      return { valid: false, error: 'Invalid format' }
    }

    const parts = key.slice(3).split('.')
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid format' }
    }

    const [payload, signature] = parts

    const verify = createVerify('SHA256')
    verify.update(payload)

    if (!verify.verify(EMBEDDED_PUBLIC_KEY, signature, 'base64url')) {
      return { valid: false, error: 'Invalid signature' }
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())

    if (data.expires && Date.now() > data.expires) {
      return { valid: false, error: 'License expired', data }
    }

    return { valid: true, data }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

// Parse license to see its data (without full validation)
export function parseLicense(key) {
  try {
    if (!key || !key.startsWith('LK-')) return null
    const payload = key.slice(3).split('.')[0]
    return JSON.parse(Buffer.from(payload, 'base64url').toString())
  } catch {
    return null
  }
}
