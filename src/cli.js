#!/usr/bin/env node
import { program } from 'commander'
import { activate } from './commands/activate.js'
import { setup } from './commands/setup.js'
import { sync } from './commands/sync.js'
import { status } from './commands/status.js'
import { stats } from './commands/stats.js'
import { loadStats, statsPath } from './lib/stats.js'
import { savings } from './commands/savings.js'
import { update, checkMinVersion } from './commands/update.js'
import { dev } from './commands/dev.js'
import { enableHooks, disableHooks } from './commands/hooks.js'
import { clean } from './commands/clean.js'
import { benchmark } from './commands/benchmark.js'
import { expandCommand } from './commands/expand.js'
import { pure } from './commands/pure.js'
import { writeFileSync, existsSync } from 'fs'
import { buildVerboseContext, buildContext, minifyContext, countTokens, exists, loadIgnore, saveIgnore, ignoreExists, getProject, getProjectHeader, getSyntax, loadDomain, listDomains, buildDomain, getAllFiles, isIgnored, validateProjectDirectory, isHomeOrRoot, getProjectPureMode } from './lib/context.js'
import { VERSION } from './lib/version.js'
import { getLicenseExpiration, getLicenseKey, isLicensed, checkAccess } from './lib/license.js'
import { parseLicense } from './lib/license-gen.js'
import { isConfigured, getAiProvider, getIgnorePatterns } from './lib/config.js'
import { PURE_MODE_INSTRUCTIONS } from './lib/ai-prompts.js'
import { sync as runSync, syncProjectOnly } from './commands/sync.js'
import { join } from 'path'
import { homedir } from 'os'
import { readFileSync } from 'fs'
const PRO_TIPS = [
  'Start your prompt with "lk" to inject fresh context anytime',
  'Use "!lk status" to see your current context health',
  'Run "!lk sync -a" to re-sync all files after major changes',
  'Use "!lk clean" to reset context if things get stale',
  'Use "!lk ignore --list" to see excluded paths',
  'Use "!lk savings" to see your time and cost savings',
  'Run "!lk update" to get the latest version',
  'Use "!lk pro-tips" to see all tips',
  'LK works with both Claude Code and Gemini CLI',
  'The more you code, the smarter LK context becomes'
]
function getClaudeUserEmail() {
  try {
    const cCPath = join(homedir(), '.claude.json')
    if (!existsSync(cCPath)) return null
    const cfg = JSON.parse(readFileSync(cCPath, 'utf8'))
    return cfg.oauthAccount?.emailAddress || null
  } catch {
    return null
  }
}
function getGeminiUserEmail() {
  try {
    const gAPath = join(homedir(), '.gemini', 'google_accounts.json')
    if (!existsSync(gAPath)) return null
    const accts = JSON.parse(readFileSync(gAPath, 'utf8'))
    return accts.active || null
  } catch {
    return null
  }
}
function terminalPrint(msg) {
  try {
    writeFileSync('/dev/tty', msg + '\n')
  } catch {
    console.log(msg)
  }
}
const IS_BINARY = !!process.pkg
const DEV_MODE = !IS_BINARY
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
  .action((opts) => sync({
    regenerateProject: opts.regenerateProject,
    fileThreshold: opts.fileThreshold,
    domainThreshold: opts.domainThreshold,
    hashOnly: opts.hashOnly,
    all: opts.all
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
  .action((opts) => stats({
    json: opts.json,
    reset: opts.reset
  }))
program
  .command('savings')
  .description('Show estimated time/token savings from expand')
  .option('--json', 'Output raw JSON')
  .action((opts) => savings({ json: opts.json }))
program
  .command('pure [action]')
  .description('Toggle pure mode (m2m coding style)')
  .option('-l, --list','List all files in status')
  .action((a,opts)=>pure(a,{list:opts.list}))
program
  .command('update')
  .description('Update lk to latest version')
  .option('-f, --force', 'Force update even if already on latest version')
  .action((opts) => update({ force: opts.force }))
program
  .command('enable')
  .description('Enable CLI hooks (all CLIs by default)')
  .option('-t, --target <cli>', 'Target specific CLI: claude or gemini')
  .action((opts) => enableHooks(opts.target || null))
program
  .command('disable')
  .description('Disable CLI hooks (all CLIs by default)')
  .option('-t, --target <cli>', 'Target specific CLI: claude or gemini')
  .action((opts) => disableHooks(opts.target || null))
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
  .action((opts) => clean({
    context: opts.context,
    license: opts.license,
    cfg: opts.config,
    device: opts.device,
    logs: opts.logs,
    all: opts.all,
    yes: opts.yes
  }))
program
  .command('ignore [p]')
  .description('Manage ignore patterns')
  .option('-a, --add <pattern>', 'Add pattern to ignore list')
  .option('-r, --remove <pattern>', 'Remove pattern from ignore list')
  .option('-l, --list', 'List all ignored files')
  .action((p, opts) => {
    const c = process.cwd()
    if (!ignoreExists(c)) {
      console.log('No ignore file found. Run "lk sync" first.')
      return
    }
    const pPats = loadIgnore(c)
    if (opts.add) {
      if (pPats.includes(opts.add)) {
        console.log(`Pattern already exists: ${opts.add}`)
      } else {
        pPats.push(opts.add)
        saveIgnore(c, pPats)
        console.log(`Added: ${opts.add}`)
      }
      return
    }
    if (opts.remove) {
      const i = pPats.indexOf(opts.remove)
      if (i === -1) {
        console.log(`Pattern not found: ${opts.remove}`)
      } else {
        pPats.splice(i, 1)
        saveIgnore(c, pPats)
        console.log(`Removed: ${opts.remove}`)
      }
      return
    }
    const gPats = getIgnorePatterns()
    const aPats = [...gPats, ...pPats]
    const aFs = getAllFiles(c)
    const iBG = aFs.filter(f => isIgnored(f, gPats))
    const iBP = aFs.filter(f => isIgnored(f, pPats))
    const iFs = aFs.filter(f => isIgnored(f, aPats))
    if (opts.list) {
      console.log(`Ignored files: ${iBG.length} global, ${iBP.length} project\n`)
      if (iFs.length === 0) {
        console.log('No files are being ignored.')
      } else {
        iFs.forEach(f => console.log(`  ${f}`))
      }
      return
    }
    console.log(`Global patterns (${gPats.length}): ${iBG.length} files`)
    if (gPats.length > 0) {
      gPats.forEach(p => console.log(`  ${p}`))
    }
    console.log('')
    console.log(`Project patterns (${pPats.length}): ${iBP.length} files`)
    if (pPats.length > 0) {
      pPats.forEach(p => console.log(`  ${p}`))
    }
  })
program
  .command('expand [p]')
  .description('Expand prompt with context (for hooks)')
  .option('--debug', 'Show debug info to stderr')
  .action((p, opts) => expandCommand(p, { debug: opts.debug }))
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
    .action((opts) => {
      const c = process.cwd()
      if (!exists(c)) {
        console.log('[No LK context - run: lk sync]')
        process.exit(0)
      }
      let ctx = ''
      if (opts.syntax) {
        ctx = getSyntax(c)
      } else if (opts.project) {
        ctx = getProject(c)
      } else if (opts.header) {
        ctx = getProjectHeader(c)
      } else if (opts.domain) {
        const d = loadDomain(c, opts.domain)
        if (!d) {
          console.log(`Domain not found: ${opts.domain}`)
          console.log(`Available domains: ${listDomains(c).join(', ')}`)
          process.exit(1)
        }
        ctx = buildDomain(d.id, d.domain, d.vibe, d.groups, d.invariants)
      } else {
        ctx = opts.verbose ? buildVerboseContext(c) : buildContext(c)
      }
      if (!opts.verbose && (opts.syntax || opts.project || opts.header || opts.domain)) {
        ctx = minifyContext(ctx)
      }
      if (opts.tokens) {
        const s = countTokens(ctx)
        console.log(`Tokens: ~${s.tokens.toLocaleString()}`)
        console.log(`Chars:  ${s.chars.toLocaleString()}`)
        console.log(`Lines:  ${s.lines.toLocaleString()}`)
      } else {
        console.log(ctx)
      }
    })
  program
    .command('benchmark [q]')
    .description('[DEV] Compare token usage with/without LK context')
    .option('-s, --scenarios', 'Run all predefined scenarios')
    .option('-r, --run', 'Actually call the API (not just estimate)')
    .option('-v, --verbose', 'Show full responses')
    .action((q, opts) => benchmark(q, {
      scenarios: opts.scenarios,
      run: opts.run,
      verbose: opts.verbose
    }))
}
program
  .command('session-info')
  .description('Print session start info (for hooks)')
  .option('--json', 'Output JSON for Gemini CLI hooks')
  .action(async (opts) => {
    const jM = opts.json
    const output = (msg, iE = false) => {
      if (jM) {
        console.log(JSON.stringify({ systemMessage: msg }))
      } else {
        terminalPrint(msg)
      }
    }
    const g = '\x1b[32m'
    const y = '\x1b[33m'
    const r = '\x1b[31m'
    const rst = '\x1b[0m'
    const sTC = process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit'
    const c = '\x1b[36m'
    const lb = sTC ? '\x1b[38;2;0;212;255m' : c
    const llc = sTC ? '\x1b[38;2;168;85;247m' : '\x1b[35m'
    const gradientChar = (ch, rw, cl, rws, cls) => {
      const t = (rw / rws) * 0.1 + (cl / cls) * 0.9
      const R = Math.round(0 + t * 168)
      const G = Math.round(212 - t * 127)
      const B = Math.round(255 - t * 8)
      return `\x1b[38;2;${R};${G};${B}m${ch}`
    }
    if (!jM) {
      const iP = getProjectPureMode(process.cwd())
      const b = iP ? [
        '╔═══════════════════════════════════╗',
        '║    ◈ P U R E   M O D E ◈  L K     ║',
        '╚═══════════════════════════════════╝'
      ] : [
        '╔═══════════════════════════════════╗',
        '║       ⦓  L A T E N T - K  ⦔       ║',
        '╚═══════════════════════════════════╝'
      ]
      terminalPrint('')
      if (sTC) {
        const rws = b.length - 1
        const cls = b[0].length - 1
        if (iP) {
          b.forEach((ln, rw) => {
            const cLn = [...ln].map((ch, cl) => {
              const t = cl / cls
              const v = Math.round(180 + t * 75)
              return `\x1b[38;2;${v};${v};${v}m${ch}`
            }).join('')
            terminalPrint(cLn + rst)
          })
        } else {
          b.forEach((ln, rw) => {
            const cLn = [...ln].map((ch, cl) => gradientChar(ch, rw, cl, rws, cls)).join('')
            terminalPrint(cLn + rst)
          })
        }
      } else {
        b.forEach(ln => terminalPrint(`${c}${ln}${rst}`))
      }
    }
    if (!DEV_MODE) {
      const vC = await checkMinVersion()
      if (!vC.ok) {
        output(jM
          ? `❌ Update required: v${vC.minVersion} (current: v${vC.currentVersion}) - run: lk update`
          : `${r}Update required: v${vC.minVersion} (current: v${vC.currentVersion})${rst}\n${y}Run: lk update${rst}`, true)
        return
      }
    }
    if (!DEV_MODE) {
      const uE = getClaudeUserEmail() || getGeminiUserEmail()
      const a = await checkAccess(uE)
      if (!a.allowed) {
        output(jM ? `❌ ${a.message}` : `${r}${a.message}${rst}`, true)
        return
      }
      if (a.message && !jM) {
        terminalPrint(`${y}${a.message}${rst}`)
      }
    }
    if (!isConfigured()) {
      output(jM ? '❌ No API key - run: lk setup' : `${r}No API key - Stop Claude and run: lk setup${rst}`, true)
      return
    }
    if (isHomeOrRoot(process.cwd())) {
      const m = 'Cannot run in home/root directory. Use "lk clean -c" to remove .lk/ if needed.'
      output(jM ? `❌ ${m}` : `${r}${m}${rst}`, true)
      return
    }
    const pr = getAiProvider()
    let sR
    if (!existsSync('.lk')) {
      const v = validateProjectDirectory(process.cwd())
      if (!v.valid) {
        const m = v.reason === 'home_or_root'
          ? 'Not a project directory. Run "lk sync" manually if intended.'
          : v.reason === 'too_many_files'
          ? `Found ${v.count} files. Run "lk sync" manually to confirm.`
          : 'No project detected. Run "lk sync" manually if intended.'
        output(jM ? `⚠ ${m}` : `${y}${m}${rst}`)
        return
      }
      if (!jM) terminalPrint(`${y}Initializing context...${rst}`)
      await runSync({ quiet: true })
      sR = { synced: true }
    } else {
      sR = await syncProjectOnly()
    }
    const iPM = getProjectPureMode(process.cwd())
    const iPs = [iPM ? '◈ LK PURE' : '⦓ LK']
    if (sR.synced) {
      iPs.push(`${pr} ready`)
    } else if (sR.error) {
      iPs.push(`⚠ ${sR.error}`)
    }
    const lK = getLicenseKey()
    if (lK) {
      const lD = parseLicense(lK)
      if (lD?.type === 'trial') {
        const exp = getLicenseExpiration()
        const dT = exp?.daysLeft === 1 ? '1 day' : `${exp?.daysLeft} days`
        if (jM) {
          iPs.push(`trial (${dT})`)
        } else {
          iPs.push(`${y}\x1b[1mtrial (${dT})\x1b[22m${rst}${lb}`)
        }
      }
    }
    const cwd = process.cwd()
    const pA = getProjectPureMode(cwd)
    let t = pA ? 'code only • no fluff • pure signal' : PRO_TIPS[Math.floor(Math.random() * PRO_TIPS.length)]
    if (!pA && Math.random() < 0.25) {
      try {
        if (existsSync(statsPath(cwd))) {
          const st = loadStats(cwd)
          const ops = st.byOperationType || {}
          const expKeys = Object.keys(ops).filter(k => k.toLowerCase().includes('expand'))
          let tUsed = 0, tokUsed = 0
          for (const k of expKeys) {
            tUsed += ops[k].totalDurationMs || 0
            tokUsed += (ops[k].tokensSentEstimate || 0) + (ops[k].tokensReceivedEstimate || 0)
          }
          if (tUsed >= 60000) {
            if (Math.random() < 0.5) {
              const mins = Math.round(tUsed * 0.4 / 60000)
              if (mins > 0) t = `${mins}min saved with LK context injection`
            } else {
              const toks = Math.round(tokUsed * 0.4 / 1000)
              if (toks > 0) t = `${toks}k tokens saved with LK context injection`
            }
          }
        }
      } catch {}
    }
    const iL = iPs.join(' | ').replace('⦓ LK', 'Context loaded').replace('◈ LK PURE', '◈ Pure mode')
    output(jM ? iPs.join(' | ') : iL)
    if (!jM) {
      const tC = pA ? '\x1b[38;2;200;200;200m' : llc
      terminalPrint(`${tC}✦ ${t} ✦${rst}`)
    }
    if (pA) {
      console.log(`\n${PURE_MODE_INSTRUCTIONS}`)
    }
  })
program
  .command('pro-tips')
  .description('Show all LK pro tips')
  .action(() => {
    const c = '\x1b[36m'
    const rst = '\x1b[0m'
    console.log('')
    PRO_TIPS.forEach(t => {
      console.log(`${c}✦ ${t} ✦${rst}`)
    })
    console.log('')
  })
if (!IS_BINARY) {
  program
    .command('dev [action]')
    .description('[DEV] Toggle between source and binary mode (status|toggle|source|binary)')
    .action(dev)
}
program.parse()