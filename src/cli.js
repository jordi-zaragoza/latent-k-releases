#!/usr/bin/env node

import { program } from 'commander'
import { activate } from './commands/activate.js'
import { setup } from './commands/setup.js'
import { sync } from './commands/sync.js'
import { status } from './commands/status.js'
import { stats } from './commands/stats.js'
import { update } from './commands/update.js'
import { dev } from './commands/dev.js'
import { enableHooks, disableHooks } from './commands/hooks.js'
import { clean } from './commands/clean.js'
import { benchmark } from './commands/benchmark.js'
import { expandCommand } from './commands/expand.js'
import { writeFileSync, existsSync } from 'fs'
import { buildVerboseContext, buildContext, countTokens, exists, loadIgnore, saveIgnore, ignoreExists, getProject, getProjectHeader, getSyntax, loadDomain, listDomains, buildDomain, getAllFiles, isIgnored } from './lib/context.js'
import { VERSION } from './lib/version.js'
import { getLicenseExpiration, getLicenseKey, isLicensed, checkAccess } from './lib/license.js'
import { parseLicense } from './lib/license-gen.js'
import { isConfigured, getAiProvider, getIgnorePatterns } from './lib/config.js'
import { sync as runSync, syncProjectOnly } from './commands/sync.js'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync } from 'fs'

// Pro tips shown randomly at session start
const PRO_TIPS = [
  'Start your prompt with "lk" to inject fresh context anytime',
  'Use "!lk status" to see your current context health',
  'Run "!lk sync" manually after major code changes',
  'Use "!lk clean" to reset context if things get stale',
  'Use "!lk ignore --list" to see excluded paths',
  'Use "!lk stats" to check your API token consumption',
  'Run "!lk update" to get the latest version',
  'Use "!lk pro-tips" to see all tips',
  'LK works with both Claude Code and Gemini CLI',
  'The more you code, the smarter LK context becomes'
]

function getClaudeUserEmail() {
  try {
    const claudeConfigPath = join(homedir(), '.claude.json')
    if (!existsSync(claudeConfigPath)) return null
    const config = JSON.parse(readFileSync(claudeConfigPath, 'utf8'))
    return config.oauthAccount?.emailAddress || null
  } catch {
    return null
  }
}

function getGeminiUserEmail() {
  try {
    const geminiAccountsPath = join(homedir(), '.gemini', 'google_accounts.json')
    if (!existsSync(geminiAccountsPath)) return null
    const accounts = JSON.parse(readFileSync(geminiAccountsPath, 'utf8'))
    return accounts.active || null
  } catch {
    return null
  }
}

function terminalPrint(message) {
  try {
    writeFileSync('/dev/tty', message + '\n')
  } catch {
    // Fallback to stdout if no tty (e.g., Gemini CLI hooks)
    console.log(message)
  }
}

const IS_BINARY = !!process.pkg  // true when running as compiled binary
const DEV_MODE = !IS_BINARY      // dev mode only when running from source

program
  .name('lk')
  .description('Auto-sync context for AI coding assistants')
  .version(VERSION)

program
  .command('activate')
  .description('Activate license key')
  .action(activate)

program
  .command('setup')
  .description('Configure AI provider and API key')
  .action(setup)

program
  .command('sync')
  .description('Sync files with AI')
  .option('-r, --regenerate-project', 'Force regeneration of project.lk')
  .option('-f, --file-threshold <n>', 'Auto-regenerate after N files', parseInt)
  .option('-d, --domain-threshold <n>', 'Auto-regenerate after N domains', parseInt)
  .option('--hash-only', 'Update hashes only (no AI calls)')
  .option('-a, --all', 'Re-sync all files (in batches of 10)')
  .action((options) => sync({
    regenerateProject: options.regenerateProject,
    fileThreshold: options.fileThreshold,
    domainThreshold: options.domainThreshold,
    hashOnly: options.hashOnly,
    all: options.all
  }))

program
  .command('status')
  .description('Show configuration status')
  .action(status)

program
  .command('stats')
  .description('Show LLM usage statistics')
  .option('--json', 'Output raw JSON')
  .option('--reset', 'Reset statistics')
  .action((options) => stats({
    json: options.json,
    reset: options.reset
  }))

program
  .command('update')
  .description('Update lk to latest version')
  .action(update)

program
  .command('enable')
  .description('Enable CLI hooks (all CLIs by default)')
  .option('-t, --target <cli>', 'Target specific CLI: claude or gemini')
  .action((options) => enableHooks(options.target || null))

program
  .command('disable')
  .description('Disable CLI hooks (all CLIs by default)')
  .option('-t, --target <cli>', 'Target specific CLI: claude or gemini')
  .action((options) => disableHooks(options.target || null))

program
  .command('clean')
  .description('Remove lk data (context, license, config)')
  .option('-c, --context', 'Remove project .lk/ folder')
  .option('-l, --license', 'Clear license data')
  .option('-C, --config', 'Clear configuration')
  .option('-d, --device', 'Remove device ID')
  .option('--logs', 'Remove debug logs')
  .option('-a, --all', 'Remove everything')
  .option('-y, --yes', 'Skip confirmation')
  .action((options) => clean({
    context: options.context,
    license: options.license,
    cfg: options.config,
    device: options.device,
    logs: options.logs,
    all: options.all,
    yes: options.yes
  }))

program
  .command('ignore [pattern]')
  .description('Manage ignore patterns')
  .option('-a, --add <pattern>', 'Add pattern to ignore list')
  .option('-r, --remove <pattern>', 'Remove pattern from ignore list')
  .option('-l, --list', 'List all ignored files')
  .action((pattern, options) => {
    const cwd = process.cwd()

    if (!ignoreExists(cwd)) {
      console.log('No ignore file found. Run "lk sync" first.')
      return
    }

    const projectPatterns = loadIgnore(cwd)

    // Add pattern
    if (options.add) {
      if (projectPatterns.includes(options.add)) {
        console.log(`Pattern already exists: ${options.add}`)
      } else {
        projectPatterns.push(options.add)
        saveIgnore(cwd, projectPatterns)
        console.log(`Added: ${options.add}`)
      }
      return
    }

    // Remove pattern
    if (options.remove) {
      const idx = projectPatterns.indexOf(options.remove)
      if (idx === -1) {
        console.log(`Pattern not found: ${options.remove}`)
      } else {
        projectPatterns.splice(idx, 1)
        saveIgnore(cwd, projectPatterns)
        console.log(`Removed: ${options.remove}`)
      }
      return
    }

    // Calculate ignored files for both views
    const globalPatterns = getIgnorePatterns()
    const allPatterns = [...globalPatterns, ...projectPatterns]
    const allFiles = getAllFiles(cwd)
    const ignoredByGlobal = allFiles.filter(f => isIgnored(f, globalPatterns))
    const ignoredByProject = allFiles.filter(f => isIgnored(f, projectPatterns))
    const ignoredFiles = allFiles.filter(f => isIgnored(f, allPatterns))

    // List ignored files
    if (options.list) {
      console.log(`Ignored files: ${ignoredByGlobal.length} global, ${ignoredByProject.length} project\n`)
      if (ignoredFiles.length === 0) {
        console.log('No files are being ignored.')
      } else {
        ignoredFiles.forEach(f => console.log(`  ${f}`))
      }
      return
    }

    // Show patterns
    console.log(`Global patterns (${globalPatterns.length}): ${ignoredByGlobal.length} files`)
    if (globalPatterns.length > 0) {
      globalPatterns.forEach(p => console.log(`  ${p}`))
    }
    console.log('')

    console.log(`Project patterns (${projectPatterns.length}): ${ignoredByProject.length} files`)
    if (projectPatterns.length > 0) {
      projectPatterns.forEach(p => console.log(`  ${p}`))
    }
  })

// Expand command - available in binary (used by hooks)
program
  .command('expand [prompt]')
  .description('Expand prompt with context (for hooks)')
  .option('--debug', 'Show debug info to stderr')
  .action((prompt, options) => expandCommand(prompt, { debug: options.debug }))

// Dev commands only available when running from source (not compiled binary)
if (!IS_BINARY) {
  program
    .command('context')
    .description('[DEV] Output full .lk context (syntax + project + domains)')
    .option('-v, --verbose', 'Verbose output (human readable)')
    .option('-t, --tokens', 'Count tokens')
    .option('-s, --syntax', 'Only syntax.lk')
    .option('-p, --project', 'Only project.lk')
    .option('-H, --header', 'Only project_h.lk (project summary)')
    .option('-d, --domain <name>', 'Filter by domain')
    .action((options) => {
      const cwd = process.cwd()

      if (!exists(cwd)) {
        console.log('[No LK context - run: lk sync]')
        process.exit(0)
      }

      let context = ''

      // Get raw content
      if (options.syntax) {
        // -s: Only syntax.lk
        context = getSyntax(cwd)
      } else if (options.project) {
        // -p: Only project.lk
        context = getProject(cwd)
      } else if (options.header) {
        // -H: Only project_h.lk (project summary)
        context = getProjectHeader(cwd)
      } else if (options.domain) {
        // -d: Filter by domain
        const domain = loadDomain(cwd, options.domain)
        if (!domain) {
          console.log(`Domain not found: ${options.domain}`)
          console.log(`Available domains: ${listDomains(cwd).join(', ')}`)
          process.exit(1)
        }
        context = buildDomain(domain.id, domain.domain, domain.vibe, domain.groups, domain.invariants)
      } else {
        // Full context
        context = buildVerboseContext(cwd)
      }

      // Minify unless verbose
      if (!options.verbose) {
        context = context
          .split('\n').map(l => l.trim()).filter(l => l).join(' ')
          .replace(/  +/g, ' ')
          .replace(/⦓ID: DOMAIN-/g, '⦓').replace(/⦓ID: /g, '⦓')
          .replace(/⟦Δ: Domain ⫸ /g, '⟦').replace(/⟦Δ: /g, '⟦')
          .replace(/∑ /g, '∑')
          .replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').replace(/,\s+/g, ',')
          .replace(/\[⦗[a-f0-9]+⦘\s*/g, '[').replace(/\s+\[\]/g, '')
      }

      if (options.tokens) {
        const stats = countTokens(context)
        console.log(`Tokens: ~${stats.tokens.toLocaleString()}`)
        console.log(`Chars:  ${stats.chars.toLocaleString()}`)
        console.log(`Lines:  ${stats.lines.toLocaleString()}`)
      } else {
        console.log(context)
      }
    })

  program
    .command('benchmark [question]')
    .description('[DEV] Compare token usage with/without LK context')
    .option('-s, --scenarios', 'Run all predefined scenarios')
    .option('-r, --run', 'Actually call the API (not just estimate)')
    .option('-v, --verbose', 'Show full responses')
    .action((question, options) => benchmark(question, {
      scenarios: options.scenarios,
      run: options.run,
      verbose: options.verbose
    }))
}

program
  .command('session-info')
  .description('Print session start info (for hooks)')
  .option('--json', 'Output JSON for Gemini CLI hooks')
  .action(async (options) => {
    const jsonMode = options.json

    // Helper to output message (JSON for Gemini, text for Claude)
    const output = (msg, isError = false) => {
      if (jsonMode) {
        console.log(JSON.stringify({ systemMessage: msg }))
      } else {
        terminalPrint(msg)
      }
    }

    const green = '\x1b[32m'
    const yellow = '\x1b[33m'
    const red = '\x1b[31m'
    const reset = '\x1b[0m'

    // Check for true color support
    const supportsTrueColor = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit'
    const cyan = '\x1b[36m'

    // Diagonal gradient function (cyan #00d4ff to purple #a855f7)
    const gradientChar = (char, row, col, rows, cols) => {
      const t = (row / rows) * 0.1 + (col / cols) * 0.9
      const r = Math.round(0 + t * 168)
      const g = Math.round(212 - t * 127)
      const b = Math.round(255 - t * 8)
      return `\x1b[38;2;${r};${g};${b}m${char}`
    }

    // ASCII banner (only for Claude/tty mode)
    if (!jsonMode) {
      const banner = [
        '╔═══════════════════════════════════╗',
        '║       ⦓  L A T E N T - K  ⦔       ║',
        '╚═══════════════════════════════════╝'
      ]
      terminalPrint('')
      if (supportsTrueColor) {
        const rows = banner.length - 1
        const cols = banner[0].length - 1
        banner.forEach((line, row) => {
          const coloredLine = [...line].map((char, col) => gradientChar(char, row, col, rows, cols)).join('')
          terminalPrint(coloredLine + reset)
        })
      } else {
        banner.forEach(line => terminalPrint(`${cyan}${line}${reset}`))
      }
    }

    // Check license with email verification (skip in dev mode)
    // Priority: Claude email first, fallback to Gemini if no Claude
    if (!DEV_MODE) {
      const userEmail = getClaudeUserEmail() || getGeminiUserEmail()
      const access = await checkAccess(userEmail)
      if (!access.allowed) {
        output(jsonMode ? `❌ ${access.message}` : `${red}${access.message}${reset}`, true)
        return
      }
      // Show license warning if present
      if (access.message && !jsonMode) {
        terminalPrint(`${yellow}${access.message}${reset}`)
      }
    }

    // Check API key configuration
    if (!isConfigured()) {
      output(jsonMode ? '❌ No API key - run: lk setup' : `${red}No API key - Stop Claude and run: lk setup${reset}`, true)
      return
    }

    // Sync context: full sync if no .lk, project-only if exists
    const provider = getAiProvider()
    let syncResult

    if (!existsSync('.lk')) {
      // No context yet - do full sync
      if (!jsonMode) terminalPrint(`${yellow}Initializing context...${reset}`)
      await runSync({ quiet: true })
      syncResult = { synced: true }
    } else {
      // Context exists - only sync project.lk if needed
      syncResult = await syncProjectOnly()
    }

    // Build info line
    const infoParts = ['⦓ LK']
    if (syncResult.synced) {
      infoParts.push(`${provider} ready`)
    } else if (syncResult.error) {
      infoParts.push(`⚠ ${syncResult.error}`)
    }

    // Add trial license info
    const licenseKey = getLicenseKey()
    if (licenseKey) {
      const licenseData = parseLicense(licenseKey)
      if (licenseData?.type === 'trial') {
        const expiration = getLicenseExpiration()
        const daysText = expiration?.daysLeft === 1 ? '1 day' : `${expiration?.daysLeft} days`
        if (jsonMode) {
          infoParts.push(`trial (${daysText})`)
        } else {
          infoParts.push(`${yellow}trial (${daysText})${reset}`)
        }
      }
    }

    // Show random pro tip
    const tip = PRO_TIPS[Math.floor(Math.random() * PRO_TIPS.length)]

    output(jsonMode ? infoParts.join(' | ') : infoParts.join(' | ').replace('⦓ LK', 'Context loaded'))
    if (!jsonMode) {
      terminalPrint(`${cyan}✦ ${tip} ✦${reset}`)
    }
  })

program
  .command('pro-tips')
  .description('Show all LK pro tips')
  .action(() => {
    const cyan = '\x1b[36m'
    const reset = '\x1b[0m'
    console.log('')
    PRO_TIPS.forEach(tip => {
      console.log(`${cyan}✦ ${tip} ✦${reset}`)
    })
    console.log('')
  })

// Dev-only commands (only from source, never in compiled binary)
if (!IS_BINARY) {
  program
    .command('dev [action]')
    .description('[DEV] Toggle between source and binary mode (status|toggle|source|binary)')
    .action(dev)

  // License generation: use scripts/license-admin.js directly (external to binary)
}

program.parse()
