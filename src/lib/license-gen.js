import { createVerify } from 'crypto'
const PK = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx9GbsLiv2hshCLjPSyaS
9cwh6MWlw9ck916siSPg4rFn+OaExxZXLHGAnaCeq/payXYFDrYOLm94RIgg0Re0
X+NPkWcDK5c3EG42kboRYLS5/uyyQ1kbHcapCqxQ0s4gxhLgiFQNCjLUjNjnl5Yi
Uo9hbrXdZEvFCmwVTigW7o2Mrk5jJLdUn85r/V73mNZ1Lz11muHaDeZRiw4F8v1c
5qXjcdxr8kixAB6Kqd6sP9oXPoRkbfgswpihFzv2XCrBZm+z/9K4NBMFXx/R/y24
R19BlU2aIqUKz1ubdrCxlTLNBiVuXRYLAYoTi+Vb7mOheYHgszddgIFxk8AutXD0
KQIDAQAB
-----END PUBLIC KEY-----`
export function getPublicKey() { return PK }
export function validateLicenseOffline(k) {
  try {
    if (!k || !k.startsWith('LK-')) return { valid: false, error: 'Invalid format' }
    const pts = k.slice(3).split('.')
    if (pts.length !== 2) return { valid: false, error: 'Invalid format' }
    const [pld, sig] = pts
    const vfy = createVerify('SHA256')
    vfy.update(pld)
    if (!vfy.verify(PK, sig, 'base64url')) return { valid: false, error: 'Invalid signature' }
    const d = JSON.parse(Buffer.from(pld, 'base64url').toString())
    if (d.expires && Date.now() > d.expires) return { valid: false, error: 'License expired', data: d }
    return { valid: true, data: d }
  } catch (e) {
    return { valid: false, error: e.message }
  }
}
export function parseLicense(k) {
  try {
    if (!k || !k.startsWith('LK-')) return null
    const pld = k.slice(3).split('.')[0]
    return JSON.parse(Buffer.from(pld, 'base64url').toString())
  } catch {
    return null
  }
}