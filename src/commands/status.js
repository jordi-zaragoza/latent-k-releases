import fs from 'fs'
import path from 'path'
import { getConfig, isConfigured, getAiProvider, getIgnorePatterns } from '../lib/config.js'
import { isLicensed, validateLicense, getLicenseExpiration, getLicenseKey, isLicenseRevoked, getRevokedReason, forceCheckOnline } from '../lib/license.js'
import { parseLicense } from '../lib/license-gen.js'
import {
  exists, getUnsyncedFiles, getDeletedFiles, getAllEntries, loadIgnore, ignoreExists, isIgnored,
  getAllFiles, validateProjectDirectory, isHomeOrRoot, getProjectPureMode
} from '../lib/context.js'
export async function status() {
  const c = process.cwd()
  console.log('lk status\n')
  if (isHomeOrRoot(c)) {
    console.log('⚠ Cannot run in home/root directory.')
    console.log('Use "lk clean -c" to remove .lk/ if needed.\n')
    return
  }
  const H = exists(c)
  if (!H) {
    const v = validateProjectDirectory(c)
    if (!v.valid) {
      const r = v.reason === 'too_many_files'
        ? `Found ${v.count} code files.`
        : 'No project markers found.'
      console.log(`⚠ ${r}`)
      console.log('Run "lk sync" in a project directory to initialize.\n')
      return
    }
  }
  const l = isLicensed()
  let V = false
  if (l) {
    const R = await validateLicense()
    V = R.valid
  }
  const G = getIgnorePatterns()
  const P = ignoreExists(c) ? loadIgnore(c) : []
  const A = [...G, ...P]
  const F = getAllFiles(c)
  const I = F.filter(o => isIgnored(o, A))
  const S = F.filter(p => !isIgnored(p, A))
  const e = H ? getAllEntries(c) : {}
  const u = H ? getUnsyncedFiles(c, S) : []
  const d = H ? getDeletedFiles(c) : []
  const N = u.filter(q => q.status === 'new')
  const M = u.filter(r => r.status === 'modified')
  let tB=0,tC=0
  for(const f of Object.keys(e)){
    try{
      const j=path.join(c,f)
      const s=fs.statSync(j)
      tB+=s.size
      tC+=fs.readFileSync(j,'utf8').length
    }catch{}
  }
  const tT=Math.ceil(tC/3.5)
  const sS=tB>1024*1024?`${(tB/1024/1024).toFixed(1)}MB`:`${(tB/1024).toFixed(1)}KB`
  console.log('Files:')
  console.log(`  Tracked: ${Object.keys(e).length}`)
  console.log(`  New: ${N.length}`)
  console.log(`  Modified: ${M.length}`)
  console.log(`  Deleted: ${d.length}`)
  console.log(`  Ignored: ${I.length}`)
  console.log(`  Size: ${sS} | ${tC.toLocaleString()} chars | ~${tT.toLocaleString()} tokens`)
  console.log('')
  if (N.length > 0 || M.length > 0 || d.length > 0) {
    if (N.length > 0) {
      console.log('New files:')
      N.slice(0, 10).forEach(s => console.log(`  + ${s.file}`))
      if (N.length > 10) console.log(`  ... and ${N.length - 10} more`)
      console.log('')
    }
    if (M.length > 0) {
      console.log('Modified:')
      M.slice(0, 10).forEach(t => console.log(`  ~ ${t.file}`))
      if (M.length > 10) console.log(`  ... and ${M.length - 10} more`)
      console.log('')
    }
    if (d.length > 0) {
      console.log('Deleted:')
      d.slice(0, 10).forEach(v => console.log(`  - ${v.file}`))
      if (d.length > 10) console.log(`  ... and ${d.length - 10} more`)
      console.log('')
    }
  }
  console.log('License:')
  let L = getLicenseKey()
  let K = !!L
  if (K) {
    await forceCheckOnline()
    L = getLicenseKey()
    K = !!L
  }
  const E = K ? getLicenseExpiration() : null
  const D = K ? parseLicense(L) : null
  const T = D?.type === 'trial'
  const W = isLicenseRevoked()
  const X = getRevokedReason()
  if (W || X) {
    console.log('  Status: REVOKED')
    if (X) {
      console.log(`  Reason: ${X}`)
    }
    console.log('  Contact support for assistance.')
  } else if (K) {
    if (V) {
      if (T) {
        const Y = E?.daysLeft === 1 ? '1 day' : `${E?.daysLeft} days`
        console.log(`  Status: trial license (${Y} remaining)`)
        console.log(`  Get license: https://latent-k.pages.dev/activation`)
      } else if (E && E.expires) {
        if (E.daysLeft <= 7 && E.daysLeft > 0) {
          console.log(`  Status: valid (expires in ${E.daysLeft} day${E.daysLeft === 1 ? '' : 's'})`)
        } else {
          console.log('  Status: valid')
        }
        console.log(`  Expires: ${E.expires.toLocaleDateString()}`)
      } else {
        console.log('  Status: valid (lifetime)')
      }
    } else {
      if (E && E.expired) {
        console.log('  Status: expired')
        console.log(`  Expired: ${E.expires.toLocaleDateString()}`)
        console.log(`  Renew license: https://latent-k.pages.dev/activation`)
      } else {
        console.log('  Status: invalid')
      }
    }
  } else {
    console.log('  Status: not activated')
    console.log('  Run: lk activate')
    console.log('  Get license: https://latent-k.dev')
  }
  console.log('')
  console.log('Config:')
  const p = getAiProvider()
  const Q = p === 'anthropic' ? 'Anthropic' : 'Gemini'
  console.log(`  AI Provider: ${isConfigured() ? `${Q} (configured)` : 'not set'}`)
  console.log(`  Pure Mode: ${getProjectPureMode(c) ? 'ON (project)' : 'OFF'}`)
  console.log('')
  console.log('Ignore:')
  console.log(`  Patterns: ${G.length} global, ${P.length} project`)
  console.log(`  Files ignored: ${I.length}`)
  console.log('')
  if (N.length > 0 || M.length > 0 || d.length > 0) {
    console.log('Run "lk sync" to update context.')
  } else if (!H) {
    console.log('Run "lk sync" to initialize context.')
  } else {
    console.log('✓ All files in sync')
  }
}