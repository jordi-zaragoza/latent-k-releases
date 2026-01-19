import { createInterface } from 'readline'
import { execFile } from 'child_process'
import { setApiKey, setAiProvider, isConfigured, getAiProvider } from '../lib/config.js'
import { checkAccess } from '../lib/license.js'
import { enableHooks } from './hooks.js'
import { validateApiKey } from '../lib/ai.js'
import { withSpinner } from '../lib/spinner.js'
import { platform } from 'os'
import { getClaudeUserEmail } from '../lib/claude-utils.js'

const ANTHROPIC_KEY_URL = 'https://console.anthropic.com/settings/keys'
const GEMINI_KEY_URL = 'https://aistudio.google.com/app/apikey'

function openBrowser(url) {
  const cmd = platform() === 'darwin' ? 'open' :
              platform() === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform() === 'win32' ? ['/c', 'start', '', url] : [url]
  execFile(cmd, args, { shell: false })
}

let rl = null

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve))
}


export async function setup() {
  rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('lk setup\n')

  // Check access (license or trial, verify email)
  const userEmail = getClaudeUserEmail()
  const access = await checkAccess(userEmail)
  if (!access.allowed) {
    console.log(access.message)
    rl.close()
    return
  }
  if (access.message) {
    console.log(access.message)
    console.log('')
  }

  if (isConfigured()) {
    const currentProvider = getAiProvider()
    const providerName = currentProvider === 'anthropic' ? 'Anthropic' : 'Gemini'
    const overwrite = await question(`Already configured (${providerName}). Overwrite? (y/N): `)
    if (overwrite.toLowerCase() !== 'y') {
      rl.close()
      return
    }
  }

  console.log('\nSelect AI provider for auto-describe:')
  console.log('  1. Anthropic (Claude Haiku)')
  console.log('  2. Gemini (free)')
  const providerChoice = await question('\nChoice (1/2): ')

  const provider = providerChoice.trim() === '1' ? 'anthropic' : 'gemini'
  setAiProvider(provider)

  if (provider === 'anthropic') {
    console.log('\nOpening Anthropic Console to get your API key...')
    openBrowser(ANTHROPIC_KEY_URL)
    console.log('(If browser did not open, go to: ' + ANTHROPIC_KEY_URL + ')\n')

    const apiKey = await question('Paste your Anthropic API key here: ')
    if (!apiKey.trim()) {
      console.log('No API key provided. Setup cancelled.')
      rl.close()
      return
    }

    // Validate the API key
    const validation = await withSpinner('Validating API key...', () =>
      validateApiKey('anthropic', apiKey.trim())
    )
    if (!validation.valid) {
      console.log(`✗ ${validation.error || 'Invalid API key'}`)
      console.log('Setup cancelled.')
      rl.close()
      return
    }
    console.log('✓ API key valid\n')

    setApiKey(apiKey.trim(), 'anthropic')
  } else {
    console.log('\nOpening Google AI Studio to get your API key...')
    openBrowser(GEMINI_KEY_URL)
    console.log('(If browser did not open, go to: ' + GEMINI_KEY_URL + ')\n')

    const apiKey = await question('Paste your Gemini API key here: ')
    if (!apiKey.trim()) {
      console.log('No API key provided. Setup cancelled.')
      rl.close()
      return
    }

    // Validate the API key
    const validation = await withSpinner('Validating API key...', () =>
      validateApiKey('gemini', apiKey.trim())
    )
    if (!validation.valid) {
      console.log(`✗ ${validation.error || 'Invalid API key'}`)
      console.log('Setup cancelled.')
      rl.close()
      return
    }
    console.log('✓ API key valid\n')

    setApiKey(apiKey.trim(), 'gemini')
  }

  console.log('API key saved.\n')

  const setupHooks = await question('Configure CLI integrations (Claude Code, Gemini CLI)? (Y/n): ')
  if (setupHooks.toLowerCase() !== 'n') {
    await enableHooks(null, true)
    console.log('Global settings configured (SessionStart/Stop hooks).')
  }

  console.log('\nSetup complete!')
  console.log('Auto-sync enabled: .lk updates after each AI response.')
  console.log('\nNext steps:')
  console.log('  lk sync      # Initialize project context')
  console.log('  claude       # or: gemini')

  rl.close()
}
