import { writeFile, readFile, mkdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Max settings file size (1MB) to prevent DoS from corrupted files
const MAX_SETTINGS_SIZE = 1024 * 1024

// CLI-specific configurations
const CLI_CONFIG = {
  claude: {
    dir: join(homedir(), '.claude'),
    stopEvent: 'Stop',
    name: 'Claude Code'
  },
  gemini: {
    dir: join(homedir(), '.gemini'),
    stopEvent: 'SessionEnd',
    name: 'Gemini CLI'
  }
}

const ALL_CLIS = Object.keys(CLI_CONFIG)

function getConfig(cli) {
  return CLI_CONFIG[cli] || CLI_CONFIG.claude
}

function getSourcePath() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  return join(__dirname, '..', 'cli.js')
}

async function loadSettings(cli) {
  const { dir } = getConfig(cli)
  const settingsPath = join(dir, 'settings.json')
  try {
    // Check file size before reading to prevent DoS
    const stats = await stat(settingsPath)
    if (stats.size > MAX_SETTINGS_SIZE) {
      console.error(`Warning: ${settingsPath} exceeds size limit, using empty settings`)
      return {}
    }
    const content = await readFile(settingsPath, 'utf8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

async function saveSettings(cli, settings) {
  const { dir } = getConfig(cli)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'settings.json'), JSON.stringify(settings, null, 2))
}

function isLkHook(command, type) {
  if (!command) return false
  // Match lk command but not other commands containing 'lk'
  const isLk = /\blk\b/.test(command) || command.includes('cli.js')
  // 'expand' also matches legacy 'context' hooks
  if (type === 'expand') {
    return isLk && (command.includes('expand') || command.includes('context'))
  }
  return isLk && command.includes(type)
}

function hasLkHook(hooks, type) {
  return hooks?.some(h => h.hooks?.some(hh => isLkHook(hh.command, type)))
}

function removeLkHooks(hooks, type) {
  if (!hooks) return []
  return hooks
    .map(h => ({
      ...h,
      hooks: h.hooks?.filter(hh => !isLkHook(hh.command, type))
    }))
    .filter(h => h.hooks && h.hooks.length > 0)
}

async function enableSingleCli(cli, silent = false) {
  const { dir, stopEvent, name } = getConfig(cli)

  // Skip if CLI config dir doesn't exist (CLI not installed)
  if (!existsSync(dir)) {
    if (!silent) console.log(`Skipped ${name} (not installed)`)
    return { skipped: true }
  }

  try {
    const settings = await loadSettings(cli)
    settings.hooks = settings.hooks || {}

    let expandCmd, syncCmd, sessionCmd
    const lkBin = '/usr/local/bin/lk'
    const jsonFlag = cli === 'gemini' ? ' --json' : ''
    if (!process.pkg) {
      const sourcePath = getSourcePath()
      expandCmd = `node ${sourcePath} expand || true`
      syncCmd = `node ${sourcePath} sync`
      sessionCmd = `node ${sourcePath} session-info${jsonFlag} || true`
    } else {
      expandCmd = `${lkBin} expand || true`
      syncCmd = `${lkBin} sync`
      sessionCmd = `${lkBin} session-info${jsonFlag} || true`
    }

    let added = false

    settings.hooks.SessionStart = settings.hooks.SessionStart || []
    const hasSessionHook = settings.hooks.SessionStart.some(h => h.hooks?.some(hh =>
      hh.command?.includes('session-info') || hh.command?.includes('LK context loaded')
    ))
    if (!hasSessionHook) {
      settings.hooks.SessionStart.push({
        matcher: '',
        hooks: [{ type: 'command', command: sessionCmd }]
      })
      added = true
    }

    // UserPromptSubmit hook (expand prompt with context)
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || []
    if (!hasLkHook(settings.hooks.UserPromptSubmit, 'expand') && !hasLkHook(settings.hooks.UserPromptSubmit, 'context')) {
      settings.hooks.UserPromptSubmit.push({
        matcher: '',
        hooks: [{ type: 'command', command: expandCmd }]
      })
      added = true
    }

    // Stop/SessionEnd hook
    settings.hooks[stopEvent] = settings.hooks[stopEvent] || []
    if (!hasLkHook(settings.hooks[stopEvent], 'sync')) {
      settings.hooks[stopEvent].push({
        matcher: '',
        hooks: [{ type: 'command', command: syncCmd }]
      })
      added = true
    }

    // Remove legacy hooks
    if (settings.hooks.Start) delete settings.hooks.Start
    // Migrate from SessionStart to UserPromptSubmit (remove old context hooks)
    if (hasLkHook(settings.hooks.SessionStart, 'context')) {
      settings.hooks.SessionStart = removeLkHooks(settings.hooks.SessionStart, 'context')
      if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart
    }
    // Migrate from old context to new expand in UserPromptSubmit
    if (hasLkHook(settings.hooks.UserPromptSubmit, 'context') && !settings.hooks.UserPromptSubmit.some(h => h.hooks?.some(hh => hh.command?.includes('expand')))) {
      settings.hooks.UserPromptSubmit = removeLkHooks(settings.hooks.UserPromptSubmit, 'context')
      settings.hooks.UserPromptSubmit.push({
        matcher: '',
        hooks: [{ type: 'command', command: expandCmd }]
      })
      added = true
    }

    await saveSettings(cli, settings)

    if (!silent) {
      if (added) {
        console.log(`✓ ${name}`)
      } else {
        console.log(`✓ ${name} (already enabled)`)
      }
    }

    return { added }
  } catch (err) {
    if (!silent) console.log(`✗ ${name}: ${err.message}`)
    return { error: err.message }
  }
}

async function disableSingleCli(cli, silent = false) {
  const { dir, stopEvent, name } = getConfig(cli)

  if (!existsSync(dir)) {
    if (!silent) console.log(`Skipped ${name} (not installed)`)
    return { skipped: true }
  }

  try {
    const settings = await loadSettings(cli)

    if (!settings.hooks) {
      if (!silent) console.log(`✓ ${name} (no hooks)`)
      return { removed: false }
    }

    let removed = false

    // Remove all LK hooks from UserPromptSubmit (both expand and legacy context)
    if (hasLkHook(settings.hooks.UserPromptSubmit, 'expand') || hasLkHook(settings.hooks.UserPromptSubmit, 'context')) {
      settings.hooks.UserPromptSubmit = removeLkHooks(settings.hooks.UserPromptSubmit, 'expand')
      settings.hooks.UserPromptSubmit = removeLkHooks(settings.hooks.UserPromptSubmit, 'context')
      if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit
      removed = true
    }

    // Remove all LK hooks from SessionStart (session-info, context, LK context)
    if (settings.hooks.SessionStart) {
      settings.hooks.SessionStart = settings.hooks.SessionStart.filter(h =>
        !h.hooks?.some(hh =>
          hh.command?.includes('session-info') ||
          hh.command?.includes('LK context') ||
          isLkHook(hh.command, 'context')
        )
      )
      if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart
      removed = true
    }

    // Remove sync hooks from Stop/SessionEnd
    if (hasLkHook(settings.hooks[stopEvent], 'sync')) {
      settings.hooks[stopEvent] = removeLkHooks(settings.hooks[stopEvent], 'sync')
      if (settings.hooks[stopEvent].length === 0) delete settings.hooks[stopEvent]
      removed = true
    }

    if (Object.keys(settings.hooks).length === 0) delete settings.hooks

    await saveSettings(cli, settings)

    if (!silent) {
      console.log(removed ? `✓ ${name} disabled` : `✓ ${name} (already disabled)`)
    }

    return { removed }
  } catch (err) {
    if (!silent) console.log(`✗ ${name}: ${err.message}`)
    return { error: err.message }
  }
}

// Enable hooks - if no target, enable for all installed CLIs
export async function enableHooks(target = null, silent = false) {
  const clis = target ? [target] : ALL_CLIS

  if (!target && !silent) {
    console.log(`Enabling hooks (${!process.pkg ? 'source' : 'binary'} mode)...\n`)
  }

  for (const cli of clis) {
    if (!CLI_CONFIG[cli]) {
      console.error(`Unknown CLI: ${cli}. Use: claude, gemini`)
      process.exit(1)
    }
    await enableSingleCli(cli, silent)
  }

  if (!target && !silent) {
    console.log('\nHooks inject .lk context at session start and sync on end.')
  }
}

// Disable hooks - if no target, disable for all CLIs
export async function disableHooks(target = null) {
  const clis = target ? [target] : ALL_CLIS

  if (!target) console.log('Disabling hooks...\n')

  for (const cli of clis) {
    if (!CLI_CONFIG[cli]) {
      console.error(`Unknown CLI: ${cli}. Use: claude, gemini`)
      process.exit(1)
    }
    await disableSingleCli(cli)
  }

  if (!target) console.log('\nRun "lk enable" to re-enable.')
}
