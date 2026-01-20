import { getPureMode, setPureMode } from '../lib/config.js'

export function pure(action) {
  const current = getPureMode()

  if (!action) {
    console.log(`Pure mode: ${current ? 'ON' : 'OFF'}`)
    console.log('')
    console.log('Usage:')
    console.log('  lk pure on   - Enable m2m coding style')
    console.log('  lk pure off  - Disable (human-readable)')
    return
  }

  const enable = action === 'on' || action === '1' || action === 'true'
  const disable = action === 'off' || action === '0' || action === 'false'

  if (!enable && !disable) {
    console.log('Usage: lk pure [on|off]')
    return
  }

  setPureMode(enable)
  console.log(`Pure mode: ${enable ? 'ON' : 'OFF'}`)

  if (enable) {
    console.log('')
    console.log('Style: m2m, austere, dense')
    console.log('- No unnecessary comments')
    console.log('- Concise naming')
    console.log('- Minimal error messages')
    console.log('- No defensive coding for impossible states')
  }
}
