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
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { buildContext, buildVerboseContext, countTokens, exists, getSyntax, getProject, domainPath, listDomains } from './lib/context.js'
import { decrypt } from './lib/crypto.js'
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

// Build project-only context (syntax + project.lk, no domains)
function buildProjectContext(root, verbose = false) {
  const parts = []

  const syntax = getSyntax(root)
  if (syntax) parts.push(syntax)

  const project = getProject(root)
  if (project) parts.push(project)

  const domains = listDomains(root)
  const cmd = DEV_MODE ? `LK_DEV=1 node ${process.argv[1]}` : 'lk'
  parts.push(`⟦Nav⟧
⦗INV⦘ Before Read/Grep/Glob, get domain context:
  Bash: ${cmd} context -d <domain>
Domains: ${domains.join(', ')}`)

  const full = parts.join('\n\n')
  return verbose ? full : minify(full)
}

// Build domain-only context (just the domain, no syntax/project)
function buildDomainContext(root, domainName, verbose = false) {
  const parts = []

  const dp = domainPath(root, domainName)
  if (existsSync(dp)) {
    const raw = readFileSync(dp, 'utf8').trim()
    parts.push(decrypt(raw))
  } else {
    parts.push(`[Domain '${domainName}' not found]`)
  }

  parts.push(`⟦Nav⟧
⦗USE⦘ Domain map above.
1. Read @path files directly
2. For project overview: lk context -p`)

  const full = parts.join('\n\n')
  return verbose ? full : minify(full)
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
  .command('context')
  .description('Output .lk context')
  .option('-t, --tokens', 'Count tokens')
  .option('-v, --verbose', 'Verbose output')
  .option('-p, --project', 'Output full project context')
  .option('-d, --domain <name>', 'Output specific domain only')
  .action(async (options) => {
    log('HOOK', '#### UserPromptSubmit hook started ####')

    // Check license (DEV mode bypasses this check inside checkAccess)
    const { checkAccess } = await import('./lib/license.js')
    const access = await checkAccess()
    if (!access.allowed) {
      process.exit(1)
    }

    const cwd = process.cwd()

    if (!exists(cwd)) {
      log('HOOK', '#### No LK context found, exiting ####')
      console.log('[No LK context - run: lk sync]')
      process.exit(0)
    }

    log('SESSION', '')
    log('SESSION', '═'.repeat(70))
    log('SESSION', 'NEW SESSION')
    log('SESSION', '═'.repeat(70))

    const useVerbose = options.verbose || process.env.LK_VERBOSE === '1'
    let context
    let contextType

    if (options.domain) {
      // -d: domain only
      context = buildDomainContext(cwd, options.domain, useVerbose)
      contextType = `domain:${options.domain}`
    } else {
      // Default/-p: project only (syntax + project.lk, no domains)
      context = buildProjectContext(cwd, useVerbose)
      contextType = 'project'
    }

    log('CONTEXT', `Injected: ${contextType} (${context.length} chars)`)

    if (options.tokens) {
      const stats = countTokens(context)
      console.log(`Tokens: ~${stats.tokens.toLocaleString()}`)
      console.log(`Chars:  ${stats.chars.toLocaleString()}`)
      console.log(`Lines:  ${stats.lines.toLocaleString()}`)
    } else {
      console.log(context)
    }

    process.exit(0)
  })

program
  .command('session-info')
  .description('Print session start info (for hooks)')
  .action(() => {
    const parts = ['[LK context loaded]']

    if (!DEV_MODE) {
      const exp = getLicenseExpiration()
      if (exp) {
        if (exp.inGrace) {
          parts.push(`⚠ License expired - grace period: ${exp.graceDaysLeft}d left`)
        } else if (exp.expired) {
          parts.push('⚠ License expired')
        } else if (exp.daysLeft !== null && exp.daysLeft <= 30) {
          parts.push(`License: ${exp.daysLeft}d remaining`)
        }
      }
    }

    terminalPrint(parts.join(' | '))
  })

// Dev-only commands
if (DEV_MODE) {
  program
    .command('dev [action]')
    .description('[DEV] Toggle between source and binary mode (status|toggle|source|binary)')
    .action(dev)

  // License generation commands removed from CLI.
  // Use scripts/license-admin.js directly:
  //   node scripts/license-admin.js keys
  //   node scripts/license-admin.js generate --email user@example.com
  //   node scripts/license-admin.js batch 10 --type pro --days 365
}

program.parse()
