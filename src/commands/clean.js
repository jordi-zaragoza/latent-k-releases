import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import readline from 'readline'
import { lkPath } from '../lib/context.js'
import { clearLicense } from '../lib/license.js'
import { config } from '../lib/config.js'

const CONFIG_DIR = path.join(homedir(), '.config', 'lk')
const LICENSE_DIR = path.join(homedir(), '.config", "lk-license')
const DEVICE_FILE = path.join(homedir(), '.lk-device')
const LOG_DIR = path.join(homedir(), '.lk')

async function confirm(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise(resolve => {
    rl.question(`${message} (y/N): `, answer => {
      rl.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

function removeDir(dir, label) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log(`  ✓ Removed ${label}`)
    return true
  }
  console.log(`  - ${label} (not found)`)
  return false
}

function removeFile(file, label) {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    console.log(`  ✓ Removed ${label}`)
    return true
  }
  console.log(`  - ${label} (not found)`)
  return false
}

export async function clean(options) {
  const { context, license, cfg, device, logs, all, yes } = options

  // If no flags specified, show help
  if (!context && !license && !cfg && !device && !logs && !all) {
    console.log('lk clean - Remove lk data\n')
    console.log('Usage: lk clean [options]\n')
    console.log('Options:')
    console.log('  -c, --context   Remove project .lk/ folder')
    console.log('  -l, --license   Clear license data')
    console.log('  -C, --config    Clear configuration (API keys, settings)')
    console.log('  -d, --device    Remove device ID')
    console.log('  --logs          Remove debug logs')
    console.log('  -a, --all       Remove everything')
    console.log('  -y, --yes       Skip confirmation')
    return
  }

  const targets = []

  if (all || context) targets.push('Project context (.lk/)')
  if (all || license) targets.push('License data')
  if (all || cfg) targets.push('Configuration')
  if (all || device) targets.push('Device ID')
  if (all || logs) targets.push('Debug logs')

  console.log('Will remove:')
  targets.forEach(t => console.log(`  • ${t}`))
  console.log('')

  if (!yes) {
    const confirmed = await confirm('Continue?')
    if (!confirmed) {
      console.log('Cancelled.')
      return
    }
    console.log('')
  }

  console.log('Cleaning...')

  if (all || context) {
    const cwd = process.cwd()
    const lkDir = lkPath(cwd)
    removeDir(lkDir, 'project context (.lk/)')
  }

  if (all || license) {
    clearLicense()
    removeDir(LICENSE_DIR, 'license store')
  }

  if (all || cfg) {
    config.clear()
    removeDir(CONFIG_DIR, 'config store')
  }

  if (all || device) {
    removeFile(DEVICE_FILE, 'device ID')
  }

  if (all || logs) {
    removeDir(LOG_DIR, 'debug logs')
  }

  console.log('\nDone.')
}
