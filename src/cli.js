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
import { writeFileSync } from 'fs'
import { buildContext, buildVerboseContext, countTokens, exists } from './lib/context.js'
import { log } from './lib/config.js'
import { VERSION } from './lib/version.js'

function terminalPrint(message) {
  try {
    writeFileSync('/dev/tty', message + '\n')
  } catch { /* ignore if no tty */ }
}

const DEV_MODE = process.env.LK_DEV === '1'
const INTERNAL_MODE = process.env.LK_INTERNAL === '1'

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
  .action(async (options) => {
    log('HOOK', '#### UserPromptSubmit hook started ####')

    if (!DEV_MODE && !INTERNAL_MODE) {
      console.log("error: unknown command 'context'")
      process.exit(1)
    }

    // Check license (DEV mode bypasses this check inside checkAccess)
    const { checkAccess } = await import('./lib/license.js')
    const access = await checkAccess()
    if (!access.allowed) {
      terminalPrint(`[LK: ${access.message}]`)
      process.exit(1)
    }
    if (access.message) {
      terminalPrint(`[LK: ${access.message}]`)
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
    log('CONTEXT', 'Context loaded and injected')
    terminalPrint('[LK context loaded]')

    const useVerbose = options.verbose || process.env.LK_VERBOSE === '1'
    const context = useVerbose ? buildVerboseContext(cwd) : buildContext(cwd)

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

// Dev-only commands (license generation)
if (DEV_MODE) {
  program
    .command('dev [action]')
    .description('[DEV] Toggle between source and binary mode (status|toggle|source|binary)')
    .action(dev)
  program
    .command('generate-keys')
    .description('[DEV] Generate RSA key pair for license signing')
    .action(async () => {
      const { generateKeyPair } = await import('./lib/license-gen.js')
      const keys = generateKeyPair()
      console.log('\nPublic key (embed in license.js):')
      console.log(keys.publicKey)
    })

  program
    .command('generate-license')
    .description('[DEV] Generate a license key')
    .option('-e, --email <email>', 'Customer email')
    .option('-t, --type <type>', 'License type (standard/pro)', 'standard')
    .option('-n, --count <n>', 'Generate multiple licenses', parseInt)
    .option('-d, --days <n>', 'License duration in days', parseInt)
    .option('-m, --monthly', 'Generate 30-day license')
    .action(async (options) => {
      const { generateKeyPair, generateLicense, generateBatch, parseLicense } = await import('./lib/license-gen.js')
      try {
        // Determine duration: --monthly takes precedence, then --days
        const durationDays = options.monthly ? 30 : options.days || null

        if (options.count && options.count > 1) {
          const licenses = generateBatch(options.count, {
            email: options.email,
            type: options.type,
            durationDays
          })
          console.log(`Generated ${licenses.length} licenses${durationDays ? ` (${durationDays} days)` : ' (lifetime)'}:\n`)
          licenses.forEach(l => console.log(l))
        } else {
          const license = generateLicense({
            email: options.email,
            type: options.type,
            durationDays
          })
          console.log(`Generated license${durationDays ? ` (${durationDays} days)` : ' (lifetime)'}:\n`)
          console.log(license)
          console.log('\nLicense data:')
          console.log(parseLicense(license))
        }
      } catch (err) {
        console.error(`✗ ${err.message}`)
        console.log('\nRun first: lk generate-keys')
      }
    })
}

program.parse()
