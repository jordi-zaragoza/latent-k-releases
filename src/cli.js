#!/usr/bin/env node

import { program } from 'commander'
import { activate } from './commands/activate.js'
import { setup } from './commands/setup.js'
import { sync } from './commands/sync.js'
import { status } from './commands/status.js'
import { update } from './commands/update.js'
import { dev } from './commands/dev.js'
import { enableHooks, disableHooks } from './commands/hooks.js'
import { clean } from './commands/clean.js'
import { benchmark } from './commands/benchmark.js'
import { expandCommand } from './commands/expand.js'
import { writeFileSync } from 'fs'
import { buildVerboseContext, countTokens, exists, getSyntax, loadIgnore, saveIgnore, ignoreExists } from './lib/context.js'
import { log } from './lib/config.js'
import { VERSION } from './lib/version.js'
import { getLicenseExpiration } from './lib/license.js'

function terminalPrint(message) {
  try {
    writeFileSync('/dev/tty', message + '\n')
  } catch { /* ignore if no tty */ }
}

const DEV_MODE = process.env.LK_DEV === '1'
const INTERNAL_MODE = process.env.LK_INTERNAL === '1'
const IS_BINARY = !!process.pkg  // true when running as compiled binary

// Minify LK context to single line
function minify(text) {
  return text
    .split('\n').map(l => l.trim()).filter(l => l).join(' ')
    .replace(/  +/g, ' ')
    .replace(/⦓ID: DOMAIN-/g, '⦓').replace(/⦓ID: /g, '⦓')
    .replace(/⟦Δ: Domain ⫸ /g, '⟦').replace(/⟦Δ: /g, '⟦')
    .replace(/∑ /g, '∑')
    .replace(/\[\s+/g, '[').replace(/\s+\]/g, ']').replace(/,\s+/g, ',')
    .replace(/\[⦗[a-f0-9]+⦘\s*/g, '[')
    .replace(/\s+\[\]/g, '')
}

// Build syntax-only context (for session start)
function buildSyntaxContext(root, verbose = false) {
  const syntax = getSyntax(root)
  if (!syntax) return ''
  return verbose ? syntax : minify(syntax)
}

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
  .command('benchmark [question]')
  .description('Compare token usage with/without LK context')
  .option('-s, --scenarios', 'Run all predefined scenarios')
  .option('-r, --run', 'Actually call the API (not just estimate)')
  .option('-v, --verbose', 'Show full responses')
  .action((question, options) => benchmark(question, {
    scenarios: options.scenarios,
    run: options.run,
    verbose: options.verbose
  }))

program
  .command('ignore [pattern]')
  .description('Manage ignore patterns')
  .option('-a, --add <pattern>', 'Add pattern to ignore list')
  .option('-r, --remove <pattern>', 'Remove pattern from ignore list')
  .action((pattern, options) => {
    const cwd = process.cwd()

    if (!ignoreExists(cwd)) {
      console.log('No ignore file found. Run "lk sync" first.')
      return
    }

    const patterns = loadIgnore(cwd)

    // Add pattern
    if (options.add) {
      if (patterns.includes(options.add)) {
        console.log(`Pattern already exists: ${options.add}`)
      } else {
        patterns.push(options.add)
        saveIgnore(cwd, patterns)
        console.log(`Added: ${options.add}`)
      }
      return
    }

    // Remove pattern
    if (options.remove) {
      const idx = patterns.indexOf(options.remove)
      if (idx === -1) {
        console.log(`Pattern not found: ${options.remove}`)
      } else {
        patterns.splice(idx, 1)
        saveIgnore(cwd, patterns)
        console.log(`Removed: ${options.remove}`)
      }
      return
    }

    // Show patterns
    if (patterns.length === 0) {
      console.log('No ignore patterns configured.')
    } else {
      console.log('Ignore patterns:\n')
      patterns.forEach(p => console.log(`  ${p}`))
    }
  })

// context command only available when running from source (not compiled binary)
if (!IS_BINARY) {
  program
    .command('context')
    .description('[DEV] Output full .lk context (syntax + project + domains)')
    .option('-t, --tokens', 'Count tokens')
    .action((options) => {
      const cwd = process.cwd()

      if (!exists(cwd)) {
        console.log('[No LK context - run: lk sync]')
        process.exit(0)
      }

      const context = buildVerboseContext(cwd)

      if (options.tokens) {
        const stats = countTokens(context)
        console.log(`Tokens: ~${stats.tokens.toLocaleString()}`)
        console.log(`Chars:  ${stats.chars.toLocaleString()}`)
        console.log(`Lines:  ${stats.lines.toLocaleString()}`)
      } else {
        console.log(context)
      }
    })
}

program
  .command('expand [prompt]')
  .description('Expand prompt with context (JSON output for hooks)')
  .option('--debug', 'Show debug info to stderr')
  .action((prompt, options) => expandCommand(prompt, { debug: options.debug }))

program
  .command('session-info')
  .description('Print session start info with syntax (for hooks)')
  .action(() => {
    const cwd = process.cwd()
    const infoParts = ['[LK context loaded]']

    if (!DEV_MODE) {
      const exp = getLicenseExpiration()
      if (exp) {
        if (exp.inGrace) {
          infoParts.push(`⚠ License expired - grace period: ${exp.graceDaysLeft}d left`)
        } else if (exp.expired) {
          infoParts.push('⚠ License expired')
        } else if (exp.daysLeft !== null && exp.daysLeft <= 30) {
          infoParts.push(`License: ${exp.daysLeft}d remaining`)
        }
      }
    }

    terminalPrint(infoParts.join(' | '))

    // Output syntax to stdout (for hook to inject)
    if (exists(cwd)) {
      const syntax = buildSyntaxContext(cwd)
      if (syntax) console.log(syntax)
    }
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
