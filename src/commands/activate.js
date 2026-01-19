import { createInterface } from 'readline'
import { activateLicense, isLicensed, clearLicense } from '../lib/license.js'
import { getClaudeUserEmail } from '../lib/claude-utils.js'

let rl = null

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve))
}

export async function activate() {
  rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('lk activation\n')

  if (isLicensed()) {
    const overwrite = await question('Already activated. Re-activate? (y/N): ')
    if (overwrite.toLowerCase() !== 'y') {
      rl.close()
      return
    }
    clearLicense()
  }

  console.log('Get your license key at: https://latent-k.dev\n')

  const key = await question('Enter license key: ')

  if (!key.trim()) {
    console.log('No key provided. Cancelled.')
    rl.close()
    return
  }

  console.log('\nActivating...')
  const userEmail = getClaudeUserEmail()
  const result = await activateLicense(key.trim(), userEmail)

  if (result.success) {
    console.log('License activated successfully!')
    console.log('\nNext: run "lk setup" to configure.')
  } else {
    console.log(`Activation failed: ${result.error}`)
  }

  rl.close()
}
