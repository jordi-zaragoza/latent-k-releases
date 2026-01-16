import fs from 'fs'
import path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getApiKey, getAiProvider } from '../lib/config.js'
import { buildContext, getAllFiles, exists, countTokens } from '../lib/context.js'

let genAI = null
let model = null

function initClient() {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('API key not configured. Run: lk setup')

  genAI = new GoogleGenerativeAI(apiKey)
  model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
}

// Estimate tokens (rough: ~4 chars per token)
function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

// Simulate Glob tool result
function simulateGlob(root, pattern) {
  const files = getAllFiles(root)
  const regex = new RegExp(pattern.replace(/\*/g, '.*'))
  const matches = files.filter(f => regex.test(f))
  const result = `Found ${matches.length} files:\n${matches.join('\n')}`
  return { result, tokens: estimateTokens(result), matches }
}

// Simulate Grep tool result
function simulateGrep(root, pattern, maxFiles = 5) {
  const files = getAllFiles(root)
  const matches = []

  for (const file of files) {
    if (matches.length >= maxFiles) break
    try {
      const fullPath = path.join(root, file)
      const content = fs.readFileSync(fullPath, 'utf8')
      const lines = content.split('\n')
      const matchingLines = lines
        .map((line, i) => ({ line, num: i + 1 }))
        .filter(({ line }) => line.toLowerCase().includes(pattern.toLowerCase()))
        .slice(0, 3)

      if (matchingLines.length > 0) {
        matches.push({ file, lines: matchingLines })
      }
    } catch (e) {}
  }

  let result = `Found matches in ${matches.length} files:\n`
  for (const m of matches) {
    result += `\n${m.file}:\n`
    for (const l of m.lines) {
      result += `  ${l.num}: ${l.line.slice(0, 100)}\n`
    }
  }

  return { result, tokens: estimateTokens(result), matches }
}

// Simulate Read tool result
function simulateRead(root, file, maxLines = 100) {
  try {
    const fullPath = path.join(root, file)
    const content = fs.readFileSync(fullPath, 'utf8')
    const lines = content.split('\n').slice(0, maxLines)
    const result = lines.join('\n')
    return { result, tokens: estimateTokens(result) }
  } catch (e) {
    return { result: 'File not found', tokens: 5 }
  }
}

// Extract exported functions from a file
function extractExports(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const exports = []

    // ES6 exports: export function name, export const name, export { name }
    const exportMatches = content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)
    for (const match of exportMatches) {
      exports.push(match[1])
    }

    // Named exports: export { foo, bar }
    const namedExports = content.matchAll(/export\s*\{([^}]+)\}/g)
    for (const match of namedExports) {
      const names = match[1].split(',').map(n => n.trim().split(' ')[0])
      exports.push(...names)
    }

    return exports.slice(0, 5) // Max 5 exports
  } catch (e) {
    return []
  }
}

// Detect project type and key characteristics
function analyzeProject(root) {
  const files = getAllFiles(root)
  const project = {
    type: 'unknown',
    entryPoint: null,
    keyFiles: [],
    commands: [],
    exports: [],
    configFiles: []
  }

  // Detect entry points
  const entryPoints = files.filter(f =>
    f.endsWith('cli.js') ||
    f.endsWith('index.js') ||
    f.endsWith('main.js') ||
    f.endsWith('app.js') ||
    f.endsWith('server.js')
  )
  if (entryPoints.length > 0) {
    project.entryPoint = entryPoints[0]
  }

  // Detect commands directory
  const commandFiles = files.filter(f => f.includes('/commands/') || f.includes('/cmd/'))
  project.commands = commandFiles.slice(0, 3).map(f => path.basename(f, path.extname(f)))

  // Detect lib/core files
  const libFiles = files.filter(f =>
    f.includes('/lib/') ||
    f.includes('/src/') ||
    f.includes('/utils/')
  ).filter(f => !f.includes('/commands/') && !f.includes('test'))
  project.keyFiles = libFiles.slice(0, 5)

  // Detect config files
  project.configFiles = files.filter(f =>
    f.includes('config') ||
    f.endsWith('package.json') ||
    f.endsWith('.json')
  ).slice(0, 3)

  // Extract exports from key files
  for (const file of project.keyFiles.slice(0, 3)) {
    const fullPath = path.join(root, file)
    const fileExports = extractExports(fullPath)
    if (fileExports.length > 0) {
      project.exports.push({ file, exports: fileExports })
    }
  }

  // Detect project type
  if (files.some(f => f.includes('cli.js') || f.includes('/commands/'))) {
    project.type = 'CLI'
  } else if (files.some(f => f.includes('server.js') || f.includes('app.js') || f.includes('/routes/'))) {
    project.type = 'API/Server'
  } else if (files.some(f => f.includes('/components/'))) {
    project.type = 'Frontend'
  } else {
    project.type = 'Library'
  }

  return project
}

// Generate dynamic scenarios based on project analysis
function generateScenarios(root, projectInfo) {
  const scenarios = []

  // Scenario 1: Find a function (if we have exports)
  if (projectInfo.exports.length > 0) {
    const { file, exports } = projectInfo.exports[0]
    const funcName = exports[0]
    scenarios.push({
      name: 'Find function location',
      question: `Where is the ${funcName} function defined?`,
      simulateWithoutLK: () => {
        const grep = simulateGrep(root, funcName)
        const reads = grep.matches.slice(0, 2).map(m => simulateRead(root, m.file))
        return {
          steps: [
            { tool: 'Grep', pattern: funcName, tokens: grep.tokens },
            ...reads.map((r, i) => ({ tool: 'Read', file: grep.matches[i]?.file, tokens: r.tokens }))
          ],
          totalTokens: grep.tokens + reads.reduce((sum, r) => sum + r.tokens, 0)
        }
      }
    })
  }

  // Scenario 2: Understand a key file
  if (projectInfo.keyFiles.length > 0) {
    const file = projectInfo.keyFiles[0]
    const fileName = path.basename(file)
    scenarios.push({
      name: 'Understand a file',
      question: `What does the ${fileName} file do?`,
      simulateWithoutLK: () => {
        const glob = simulateGlob(root, fileName)
        const read = simulateRead(root, file)
        return {
          steps: [
            { tool: 'Glob', pattern: `**/${fileName}`, tokens: glob.tokens },
            { tool: 'Read', file, tokens: read.tokens }
          ],
          totalTokens: glob.tokens + read.tokens
        }
      }
    })
  }

  // Scenario 3: Explore a command/flow (if CLI or has commands)
  if (projectInfo.commands.length > 0) {
    const command = projectInfo.commands[0]
    scenarios.push({
      name: 'Explore a flow',
      question: `How does the ${command} command work? What files are involved?`,
      simulateWithoutLK: () => {
        const grep = simulateGrep(root, command, 10)
        const reads = grep.matches.slice(0, 4).map(m => simulateRead(root, m.file, 150))
        return {
          steps: [
            { tool: 'Grep', pattern: command, tokens: grep.tokens },
            ...reads.map((r, i) => ({ tool: 'Read', file: grep.matches[i]?.file, tokens: r.tokens }))
          ],
          totalTokens: grep.tokens + reads.reduce((sum, r) => sum + r.tokens, 0)
        }
      }
    })
  } else if (projectInfo.entryPoint) {
    // For non-CLI projects, explore the main entry point
    scenarios.push({
      name: 'Explore main flow',
      question: `How does the application start? What is the main flow?`,
      simulateWithoutLK: () => {
        const read = simulateRead(root, projectInfo.entryPoint, 150)
        const grep = simulateGrep(root, 'import', 5)
        return {
          steps: [
            { tool: 'Read', file: projectInfo.entryPoint, tokens: read.tokens },
            { tool: 'Grep', pattern: 'import', tokens: grep.tokens }
          ],
          totalTokens: read.tokens + grep.tokens
        }
      }
    })
  }

  // Scenario 4: Find configuration
  if (projectInfo.configFiles.length > 0) {
    scenarios.push({
      name: 'Find configuration',
      question: `How is the application configured? Where are settings stored?`,
      simulateWithoutLK: () => {
        const grep = simulateGrep(root, 'config')
        const configFile = projectInfo.configFiles.find(f => f.includes('config'))
        const read = configFile ? simulateRead(root, configFile) : { tokens: 0 }
        return {
          steps: [
            { tool: 'Grep', pattern: 'config', tokens: grep.tokens },
            ...(configFile ? [{ tool: 'Read', file: configFile, tokens: read.tokens }] : [])
          ],
          totalTokens: grep.tokens + read.tokens
        }
      }
    })
  }

  // Scenario 5: Understand project structure (always include)
  scenarios.push({
    name: 'Understand project structure',
    question: `What is the overall architecture of this ${projectInfo.type} project?`,
    simulateWithoutLK: () => {
      const files = getAllFiles(root)
      const keyFiles = [
        projectInfo.entryPoint,
        ...projectInfo.keyFiles.slice(0, 4),
        ...projectInfo.commands.map(c => files.find(f => f.includes(c)))
      ].filter(Boolean).slice(0, 6)

      const reads = keyFiles.map(f => simulateRead(root, f, 50))
      return {
        steps: [
          { tool: 'Glob', pattern: '**/*.{js,ts,py}', tokens: estimateTokens(files.join('\n')) },
          ...reads.map((r, i) => ({ tool: 'Read', file: keyFiles[i], tokens: r.tokens }))
        ],
        totalTokens: estimateTokens(files.join('\n')) + reads.reduce((sum, r) => sum + r.tokens, 0)
      }
    }
  })

  return scenarios
}

// Run a single query against the API
async function runQuery(context, question) {
  if (!model) initClient()

  const prompt = `You are analyzing a codebase. Answer based on the context provided.\n\nContext:\n${context}\n\nQuestion: ${question}`
  const startTime = Date.now()

  const result = await model.generateContent(prompt)
  const elapsed = Date.now() - startTime

  const response = result.response
  const usage = response?.usageMetadata || {}

  return {
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    timeMs: elapsed,
    response: response?.text?.() || ''
  }
}

export async function benchmark(question, options = {}) {
  const cwd = process.cwd()

  if (!exists(cwd)) {
    console.log('No LK context found. Run: lk sync')
    process.exit(1)
  }

  const provider = getAiProvider()
  console.log('lk benchmark\n')
  console.log(`Provider: ${provider === 'gemini' ? 'Gemini' : 'Anthropic'}`)

  // Analyze project and generate scenarios
  console.log('Analyzing project structure...')
  const projectInfo = analyzeProject(cwd)
  console.log(`Project type: ${projectInfo.type}`)
  console.log(`Entry point: ${projectInfo.entryPoint || 'not detected'}`)
  console.log(`Key files: ${projectInfo.keyFiles.length}`)
  console.log(`Commands: ${projectInfo.commands.length > 0 ? projectInfo.commands.join(', ') : 'none'}`)
  console.log('')

  // Build LK context
  const lkContext = buildContext(cwd)
  const lkTokens = countTokens(lkContext).tokens

  // Generate dynamic scenarios
  const scenarios = generateScenarios(cwd, projectInfo)

  // Run scenarios or single question
  if (options.scenarios || !question) {
    const runActual = options.run
    console.log(`Running ${runActual ? 'ACTUAL' : 'estimated'} scenario benchmarks...`)
    console.log(`Generated ${scenarios.length} scenarios for this project\n`)
    console.log('='.repeat(60))

    let totalWithoutLK = 0
    let totalWithLK = 0
    let totalTimeWithoutLK = 0
    let totalTimeWithLK = 0

    for (const scenario of scenarios) {
      console.log(`\nScenario: ${scenario.name}`)
      console.log(`Question: "${scenario.question}"`)
      console.log('-'.repeat(50))

      const withoutLKSim = scenario.simulateWithoutLK()

      if (runActual) {
        // Build actual context from simulated tool calls
        let gatheredContext = ''
        for (const step of withoutLKSim.steps) {
          if (step.tool === 'Grep' && step.pattern) {
            const grep = simulateGrep(cwd, step.pattern)
            gatheredContext += grep.result + '\n\n'
          } else if (step.tool === 'Glob' && step.pattern) {
            const glob = simulateGlob(cwd, step.pattern)
            gatheredContext += glob.result + '\n\n'
          } else if (step.tool === 'Read' && step.file) {
            const read = simulateRead(cwd, step.file)
            gatheredContext += `--- ${step.file} ---\n${read.result}\n\n`
          }
        }

        // Run actual API calls
        console.log('\nWithout LK (actual API call):')
        const resultWithout = await runQuery(gatheredContext, scenario.question)
        console.log(`  Input:  ${resultWithout.inputTokens.toLocaleString()} tokens`)
        console.log(`  Output: ${resultWithout.outputTokens.toLocaleString()} tokens`)
        console.log(`  Time:   ${resultWithout.timeMs.toLocaleString()}ms`)

        console.log('\nWith LK (actual API call):')
        const resultWith = await runQuery(lkContext, scenario.question)
        console.log(`  Input:  ${resultWith.inputTokens.toLocaleString()} tokens`)
        console.log(`  Output: ${resultWith.outputTokens.toLocaleString()} tokens`)
        console.log(`  Time:   ${resultWith.timeMs.toLocaleString()}ms`)

        // Show responses if verbose
        if (options.verbose) {
          console.log('\n  Response WITHOUT LK:')
          console.log('  ' + resultWithout.response.split('\n').slice(0, 10).join('\n  '))
          if (resultWithout.response.split('\n').length > 10) console.log('  ...')
          console.log('\n  Response WITH LK:')
          console.log('  ' + resultWith.response.split('\n').slice(0, 10).join('\n  '))
          if (resultWith.response.split('\n').length > 10) console.log('  ...')
        }

        const saved = resultWithout.inputTokens - resultWith.inputTokens
        const pct = ((saved / resultWithout.inputTokens) * 100).toFixed(1)

        if (saved > 0) {
          console.log(`\n  ✓ LK saves ${saved.toLocaleString()} input tokens (${pct}% reduction)`)
        } else {
          console.log(`\n  → LK uses ${Math.abs(saved).toLocaleString()} more input tokens`)
        }

        totalWithoutLK += resultWithout.inputTokens
        totalWithLK += resultWith.inputTokens
        totalTimeWithoutLK += resultWithout.timeMs
        totalTimeWithLK += resultWith.timeMs

      } else {
        // Just estimate
        console.log('\nWithout LK (estimated tool calls):')
        for (const step of withoutLKSim.steps) {
          console.log(`  ${step.tool}(${step.pattern || step.file || '...'}) → ~${step.tokens} tokens`)
        }
        console.log(`  Total context: ~${withoutLKSim.totalTokens} tokens`)

        console.log('\nWith LK:')
        console.log(`  LK context already loaded → ~${lkTokens} tokens`)

        const saved = withoutLKSim.totalTokens - lkTokens
        const pct = ((saved / withoutLKSim.totalTokens) * 100).toFixed(1)

        if (saved > 0) {
          console.log(`\n  ✓ LK saves ~${saved} tokens (${pct}% reduction)`)
        } else {
          console.log(`\n  → LK uses ${Math.abs(saved)} more tokens (but provides full context upfront)`)
        }

        totalWithoutLK += withoutLKSim.totalTokens
        totalWithLK += lkTokens
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('SUMMARY (across all scenarios)\n')

    if (runActual) {
      console.log(`Total without LK: ${totalWithoutLK.toLocaleString()} input tokens`)
      console.log(`Total with LK:    ${totalWithLK.toLocaleString()} input tokens`)
      console.log(`Total time without LK: ${totalTimeWithoutLK.toLocaleString()}ms`)
      console.log(`Total time with LK:    ${totalTimeWithLK.toLocaleString()}ms`)
    } else {
      console.log(`Total without LK: ~${totalWithoutLK.toLocaleString()} tokens (estimated)`)
      console.log(`Total with LK:    ~${(lkTokens * scenarios.length).toLocaleString()} tokens`)
    }

    const totalSaved = totalWithoutLK - (runActual ? totalWithLK : lkTokens * scenarios.length)
    const totalPct = ((totalSaved / totalWithoutLK) * 100).toFixed(1)

    if (totalSaved > 0) {
      console.log(`\nLK saves ${runActual ? '' : '~'}${totalSaved.toLocaleString()} tokens total (${totalPct}% reduction)`)
    }

    if (!runActual) {
      console.log('\nNote: These are estimates. Use --run to make actual API calls.')
    }

  } else {
    // Single question mode
    console.log(`Question: "${question}"\n`)

    const withoutLKSim = {
      steps: [],
      totalTokens: 0
    }

    // Generic simulation: grep + 2 file reads
    const lastWord = question.split(' ').filter(w => w.length > 3).slice(-1)[0] || 'main'
    const grep = simulateGrep(cwd, lastWord)
    const reads = grep.matches.slice(0, 2).map(m => simulateRead(cwd, m.file))

    withoutLKSim.steps = [
      { tool: 'Grep', pattern: lastWord, tokens: grep.tokens },
      ...reads.map((r, i) => ({ tool: 'Read', file: grep.matches[i]?.file, tokens: r.tokens }))
    ]
    withoutLKSim.totalTokens = grep.tokens + reads.reduce((sum, r) => sum + r.tokens, 0)

    console.log('Estimated without LK:')
    console.log(`  Tool calls: ${withoutLKSim.steps.length}`)
    console.log(`  Context tokens: ~${withoutLKSim.totalTokens}`)
    console.log('')

    console.log('With LK:')
    console.log(`  Context tokens: ~${lkTokens}`)
    console.log('')

    if (options.run) {
      let gatheredContext = ''
      gatheredContext += grep.result + '\n\n'
      for (let i = 0; i < reads.length && i < grep.matches.length; i++) {
        gatheredContext += `--- ${grep.matches[i].file} ---\n${reads[i].result}\n\n`
      }

      console.log('Running actual API calls...\n')

      const resultWithout = await runQuery(gatheredContext, question)
      console.log('Without LK:')
      console.log(`  Input:  ${resultWithout.inputTokens} tokens`)
      console.log(`  Output: ${resultWithout.outputTokens} tokens`)
      console.log(`  Time:   ${resultWithout.timeMs}ms`)

      const resultWith = await runQuery(lkContext, question)
      console.log('\nWith LK:')
      console.log(`  Input:  ${resultWith.inputTokens} tokens`)
      console.log(`  Output: ${resultWith.outputTokens} tokens`)
      console.log(`  Time:   ${resultWith.timeMs}ms`)

      if (options.verbose) {
        console.log('\nResponse WITHOUT LK:')
        console.log(resultWithout.response)
        console.log('\nResponse WITH LK:')
        console.log(resultWith.response)
      }

      const saved = resultWithout.inputTokens - resultWith.inputTokens
      console.log('\n' + '-'.repeat(50))
      if (saved > 0) {
        console.log(`LK saves ${saved} tokens (${((saved / resultWithout.inputTokens) * 100).toFixed(1)}% reduction)`)
      } else {
        console.log(`LK uses ${Math.abs(saved)} more tokens`)
      }
    } else {
      const saved = withoutLKSim.totalTokens - lkTokens
      console.log('-'.repeat(50))
      if (saved > 0) {
        console.log(`LK saves ~${saved} tokens (${((saved / withoutLKSim.totalTokens) * 100).toFixed(1)}% reduction)`)
      } else {
        console.log(`LK provides full context upfront (${lkTokens} tokens)`)
      }
      console.log('\nUse --run to make actual API calls.')
    }
  }
}
