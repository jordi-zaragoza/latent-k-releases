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
function openBrowser(U){const K=platform()==='darwin'?'open':platform()==='win32'?'cmd':'xdg-open';const R=platform()==='win32'?['/c','start','',U]:[U];execFile(K,R,{shell:false})}
let R = null
function question(P){return new Promise(C=>R.question(P,C))}
export async function setup(){
  R = createInterface({
    input: process.stdin,
    output: process.stdout
  })
  console.log('lk setup\n')
  const E = getClaudeUserEmail()
  const A = await checkAccess(E)
  if(!A.allowed){
    console.log(A.message)
    R.close()
    return
  }
  if(A.message){
    console.log(A.message)
    console.log('')
  }
  if(isConfigured()){
    const P = getAiProvider()
    const N = P === 'anthropic' ? 'Anthropic' : 'Gemini'
    const O = await question(`Already configured (${N}). Overwrite? (y/N): `)
    if(O.toLowerCase() !== 'y'){
      R.close()
      return
    }
  }
  console.log('\nSelect AI provider for auto-describe:')
  console.log('  1. Anthropic (Claude Haiku)')
  console.log('  2. Gemini (free)')
  const C = await question('\nChoice (1/2): ')
  const Pr = C.trim() === '1' ? 'anthropic' : 'gemini'
  setAiProvider(Pr)
  if(Pr === 'anthropic'){
    console.log('\nOpening Anthropic Console to get your API key...')
    openBrowser(ANTHROPIC_KEY_URL)
    console.log('(If browser did not open, go to: ' + ANTHROPIC_KEY_URL + ')\n')
    const K = await question('Paste your Anthropic API key here: ')
    if(!K.trim()){
      console.log('No API key provided. Setup cancelled.')
      R.close()
      return
    }
    const V = await withSpinner('Validating API key...', ()=>
      validateApiKey('anthropic', K.trim())
    )
    if(!V.valid){
      console.log(`✗ ${V.error || 'Invalid API key'}`)
      console.log('Setup cancelled.')
      R.close()
      return
    }
    console.log('✓ API key valid\n')
    setApiKey(K.trim(), 'anthropic')
  } else {
    console.log('\nOpening Google AI Studio to get your API key...')
    openBrowser(GEMINI_KEY_URL)
    console.log('(If browser did not open, go to: ' + GEMINI_KEY_URL + ')\n')
    const K = await question('Paste your Gemini API key here: ')
    if(!K.trim()){
      console.log('No API key provided. Setup cancelled.')
      R.close()
      return
    }
    const V = await withSpinner('Validating API key...', ()=>
      validateApiKey('gemini', K.trim())
    )
    if(!V.valid){
      console.log(`✗ ${V.error || 'Invalid API key'}`)
      console.log('Setup cancelled.')
      R.close()
      return
    }
    console.log('✓ API key valid\n')
    setApiKey(K.trim(), 'gemini')
  }
  console.log('API key saved.\n')
  const H = await question('Configure CLI integrations (Claude Code, Gemini CLI)? (Y/n): ')
  if(H.toLowerCase() !== 'n'){
    await enableHooks(null, true)
    console.log('Global settings configured (SessionStart/Stop hooks).')
  }
  console.log('\nSetup complete!')
  console.log('Auto-sync enabled: .lk updates after each AI response.')
  console.log('\nNext steps:')
  console.log('  lk sync      # Initialize project context')
  console.log('  claude       # or: gemini')
  R.close()
}