import fs from 'fs'
import path from 'path'
import { getConfig, isConfigured, getAiProvider, getIgnorePatterns } from '../lib/config.js'
import { isLicensed, validateLicense, getLicenseExpiration, getLicenseKey } from '../lib/license.js'
import { parseLicense } from '../lib/license-gen.js'
import {
  exists, getUnsyncedFiles, getDeletedFiles, getAllEntries, loadIgnore, ignoreExists, isIgnored,
  getAllFiles
} from '../lib/context.js'

export async function status() {
  const cwd = process.cwd()
  console.log('lk status\n')

  const config = getConfig()
  const hasContext = exists(cwd)
  const licensed = isLicensed()
  let licenseValid = false

  if (licensed) {
    const result = await validateLicense()
    licenseValid = result.valid
  }

  // Ignore patterns
  const globalPatterns = getIgnorePatterns()
  const projectPatterns = ignoreExists(cwd) ? loadIgnore(cwd) : []
  const allIgnorePatterns = [...globalPatterns, ...projectPatterns]

  // Files status
  const allFilesRaw = getAllFiles(cwd)
  const ignoredFiles = allFilesRaw.filter(f => isIgnored(f, allIgnorePatterns))
  const allFiles = allFilesRaw.filter(f => !isIgnored(f, allIgnorePatterns))
  const entries = hasContext ? getAllEntries(cwd) : {}
  const unsynced = hasContext ? getUnsyncedFiles(cwd, allFiles) : []
  const deleted = hasContext ? getDeletedFiles(cwd) : []

  const newFiles = unsynced.filter(f => f.status === 'new')
  const modified = unsynced.filter(f => f.status === 'modified')

  console.log('Files:')
  console.log(`  Tracked: ${Object.keys(entries).length}`)
  console.log(`  New: ${newFiles.length}`)
  console.log(`  Modified: ${modified.length}`)
  console.log(`  Deleted: ${deleted.length}`)
  console.log(`  Ignored: ${ignoredFiles.length}`)
  console.log('')

  if (newFiles.length > 0 || modified.length > 0 || deleted.length > 0) {
    if (newFiles.length > 0) {
      console.log('New files:')
      newFiles.slice(0, 10).forEach(f => console.log(`  + ${f.file}`))
      if (newFiles.length > 10) console.log(`  ... and ${newFiles.length - 10} more`)
      console.log('')
    }
    if (modified.length > 0) {
      console.log('Modified:')
      modified.slice(0, 10).forEach(f => console.log(`  ~ ${f.file}`))
      if (modified.length > 10) console.log(`  ... and ${modified.length - 10} more`)
      console.log('')
    }
    if (deleted.length > 0) {
      console.log('Deleted:')
      deleted.slice(0, 10).forEach(f => console.log(`  - ${f.file}`))
      if (deleted.length > 10) console.log(`  ... and ${deleted.length - 10} more`)
      console.log('')
    }
  }

  // License status
  console.log('License:')
  const licenseKey = getLicenseKey()
  const hasKey = !!licenseKey
  const expiration = hasKey ? getLicenseExpiration() : null
  const licenseData = hasKey ? parseLicense(licenseKey) : null
  const isTrial = licenseData?.type === 'trial'

  if (hasKey) {
    if (licenseValid) {
      if (isTrial) {
        const daysText = expiration?.daysLeft === 1 ? '1 day' : `${expiration?.daysLeft} days`
        console.log(`  Status: trial license (${daysText} remaining)`)
        console.log(`  Get license: https://latent-k.pages.dev/activation`)
      } else if (expiration && expiration.expires) {
        if (expiration.daysLeft <= 7 && expiration.daysLeft > 0) {
          console.log(`  Status: valid (expires in ${expiration.daysLeft} day${expiration.daysLeft === 1 ? '' : 's'})`)
        } else {
          console.log('  Status: valid')
        }
        console.log(`  Expires: ${expiration.expires.toLocaleDateString()}`)
      } else {
        console.log('  Status: valid (lifetime)')
      }
    } else {
      if (expiration && expiration.expired) {
        console.log('  Status: expired')
        console.log(`  Expired: ${expiration.expires.toLocaleDateString()}`)
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
  const provider = getAiProvider()
  const providerName = provider === 'anthropic' ? 'Anthropic' : 'Gemini'
  console.log(`  AI Provider: ${isConfigured() ? `${providerName} (configured)` : 'not set'}`)
  console.log('')

  console.log('Ignore:')
  console.log(`  Patterns: ${globalPatterns.length} global, ${projectPatterns.length} project`)
  console.log(`  Files ignored: ${ignoredFiles.length}`)
  console.log('')

  if (newFiles.length > 0 || modified.length > 0 || deleted.length > 0) {
    console.log('Run "lk sync" to update context.')
  } else if (!hasContext) {
    console.log('Run "lk sync" to initialize context.')
  } else {
    console.log('✓ All files in sync')
  }
}
