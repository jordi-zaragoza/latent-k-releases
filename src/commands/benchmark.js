import fs from 'fs'
import path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getApiKey, getAiProvider } from '../lib/config.js'
import { buildContext, getAllFiles, exists, countTokens } from '../lib/context.js'
let g = null
let m = null
function iC() {
  const K = getApiKey()
  if (!K) throw new Error('API key not configured. Run: lk setup')
  g = new GoogleGenerativeAI(K)
  m = g.getGenerativeModel({ model: 'gemini-2.5-flash' })
}
function eT(T) {
  return Math.ceil(T.length / 4)
}
function sG(R, P) {
  const F = getAllFiles(R)
  const RE = new RegExp(P.replace(/\*/g, '.*'))
  const MA = F.filter(fI => RE.test(fI))
  const RES = `Found ${MA.length} files:\n${MA.join('\n')}`
  return { result: RES, tokens: eT(RES), matches: MA }
}
function sGR(R, P, MF = 5) {
  const F = getAllFiles(R)
  const MA = []
  for (const fI of F) {
    if (MA.length >= MF) break
    try {
      const fP = path.join(R, fI)
      const C = fs.readFileSync(fP, 'utf8')
      const L = C.split('\n')
      const ML = L
        .map((lI, I) => ({ line: lI, num: I + 1 }))
        .filter(({ line: lI }) => lI.toLowerCase().includes(P.toLowerCase()))
        .slice(0, 3)
      if (ML.length > 0) {
        MA.push({ file: fI, lines: ML })
      }
    } catch (e) {}
  }
  let RES = `Found matches in ${MA.length} files:\n`
  for (const M of MA) {
    RES += `\n${M.file}:\n`
    for (const lIN of M.lines) {
      RES += `  ${lIN.num}: ${lIN.line.slice(0, 100)}\n`
    }
  }
  return { result: RES, tokens: eT(RES), matches: MA }
}
function sR(R, F, ML = 100) {
  try {
    const fP = path.join(R, F)
    const C = fs.readFileSync(fP, 'utf8')
    const L = C.split('\n').slice(0, ML)
    const RES = L.join('\n')
    return { result: RES, tokens: eT(RES) }
  } catch (e) {
    return { result: 'File not found', tokens: 5 }
  }
}
function eE(fP) {
  try {
    const C = fs.readFileSync(fP, 'utf8')
    const E = []
    const EM = C.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)
    for (const MT of EM) {
      E.push(MT[1])
    }
    const NE = C.matchAll(/export\s*\{([^}]+)\}/g)
    for (const MT of NE) {
      const NS = MT[1].split(',').map(NM => NM.trim().split(' ')[0])
      E.push(...NS)
    }
    return E.slice(0, 5)
  } catch (e) {
    return []
  }
}
function aP(R) {
  const F = getAllFiles(R)
  const P = {
    type: 'unknown',
    entryPoint: null,
    keyFiles: [],
    commands: [],
    exports: [],
    configFiles: []
  }
  const EP = F.filter(fI =>
    fI.endsWith('cli.js') ||
    fI.endsWith('index.js') ||
    fI.endsWith('main.js') ||
    fI.endsWith('app.js') ||
    fI.endsWith('server.js')
  )
  if (EP.length > 0) {
    P.entryPoint = EP[0]
  }
  const CF = F.filter(fI => fI.includes('/commands/') || fI.includes('/cmd/'))
  P.commands = CF.slice(0, 3).map(fI => path.basename(fI, path.extname(fI)))
  const LF = F.filter(fI =>
    fI.includes('/lib/') ||
    fI.includes('/src/') ||
    fI.includes('/utils/')
  ).filter(fI => !fI.includes('/commands/') && !fI.includes('test'))
  P.keyFiles = LF.slice(0, 5)
  P.configFiles = F.filter(fI =>
    fI.includes('config') ||
    fI.endsWith('package.json') ||
    fI.endsWith('.json')
  ).slice(0, 3)
  for (const fI of P.keyFiles.slice(0, 3)) {
    const fP = path.join(R, fI)
    const FE = eE(fP)
    if (FE.length > 0) {
      P.exports.push({ file: fI, exports: FE })
    }
  }
  if (F.some(fI => fI.includes('cli.js') || fI.includes('/commands/'))) {
    P.type = 'CLI'
  } else if (F.some(fI => fI.includes('server.js') || fI.includes('app.js') || fI.includes('/routes/'))) {
    P.type = 'API/Server'
  } else if (F.some(fI => fI.includes('/components/'))) {
    P.type = 'Frontend'
  } else {
    P.type = 'Library'
  }
  return P
}
function gS(R, PI) {
  const S = []
  if (PI.exports.length > 0) {
    const { file: F, exports: E } = PI.exports[0]
    const FN = E[0]
    S.push({
      name: 'Find function location',
      question: `Where is the ${FN} function defined?`,
      simulateWithoutLK: () => {
        const GR = sGR(R, FN)
        const RS = GR.matches.slice(0, 2).map(M => sR(R, M.file))
        return {
          steps: [
            { tool: 'Grep', pattern: FN, tokens: GR.tokens },
            ...RS.map((RE, I) => ({ tool: 'Read', file: GR.matches[I]?.file, tokens: RE.tokens }))
          ],
          totalTokens: GR.tokens + RS.reduce((SU, RE) => SU + RE.tokens, 0)
        }
      }
    })
  }
  if (PI.keyFiles.length > 0) {
    const F = PI.keyFiles[0]
    const FNM = path.basename(F)
    S.push({
      name: 'Understand a file',
      question: `What does the ${FNM} file do?`,
      simulateWithoutLK: () => {
        const GL = sG(R, FNM)
        const RE = sR(R, F)
        return {
          steps: [
            { tool: 'Glob', pattern: `**/${FNM}`, tokens: GL.tokens },
            { tool: 'Read', file: F, tokens: RE.tokens }
          ],
          totalTokens: GL.tokens + RE.tokens
        }
      }
    })
  }
  if (PI.commands.length > 0) {
    const CMD = PI.commands[0]
    S.push({
      name: 'Explore a flow',
      question: `How does the ${CMD} command work? What files are involved?`,
      simulateWithoutLK: () => {
        const GR = sGR(R, CMD, 10)
        const RS = GR.matches.slice(0, 4).map(M => sR(R, M.file, 150))
        return {
          steps: [
            { tool: 'Grep', pattern: CMD, tokens: GR.tokens },
            ...RS.map((RE, I) => ({ tool: 'Read', file: GR.matches[I]?.file, tokens: RE.tokens }))
          ],
          totalTokens: GR.tokens + RS.reduce((SU, RE) => SU + RE.tokens, 0)
        }
      }
    })
  } else if (PI.entryPoint) {
    S.push({
      name: 'Explore main flow',
      question: `How does the application start? What is the main flow?`,
      simulateWithoutLK: () => {
        const RE = sR(R, PI.entryPoint, 150)
        const GR = sGR(R, 'import', 5)
        return {
          steps: [
            { tool: 'Read', file: PI.entryPoint, tokens: RE.tokens },
            { tool: 'Grep', pattern: 'import', tokens: GR.tokens }
          ],
          totalTokens: RE.tokens + GR.tokens
        }
      }
    })
  }
  if (PI.configFiles.length > 0) {
    S.push({
      name: 'Find configuration',
      question: `How is the application configured? Where are settings stored?`,
      simulateWithoutLK: () => {
        const GR = sGR(R, 'config')
        const CNF = PI.configFiles.find(F => F.includes('config'))
        const RE = CNF ? sR(R, CNF) : { tokens: 0 }
        return {
          steps: [
            { tool: 'Grep', pattern: 'config', tokens: GR.tokens },
            ...(CNF ? [{ tool: 'Read', file: CNF, tokens: RE.tokens }] : [])
          ],
          totalTokens: GR.tokens + RE.tokens
        }
      }
    })
  }
  S.push({
    name: 'Understand project structure',
    question: `What is the overall architecture of this ${PI.type} project?`,
    simulateWithoutLK: () => {
      const F = getAllFiles(R)
      const KF = [
        PI.entryPoint,
        ...PI.keyFiles.slice(0, 4),
        ...PI.commands.map(CM => F.find(fI => fI.includes(CM)))
      ].filter(Boolean).slice(0, 6)
      const RS = KF.map(fI => sR(R, fI, 50))
      return {
        steps: [
          { tool: 'Glob', pattern: '**/*.{js,ts,py}', tokens: eT(F.join('\n')) },
          ...RS.map((RE, I) => ({ tool: 'Read', file: KF[I], tokens: RE.tokens }))
        ],
        totalTokens: eT(F.join('\n')) + RS.reduce((SU, RE) => SU + RE.tokens, 0)
      }
    }
  })
  return S
}
async function rQ(C, Q) {
  if (!m) iC()
  const P = `You are analyzing a codebase. Answer based on the context provided.\n\nContext:\n${C}\n\nQuestion: ${Q}`
  const ST = Date.now()
  const RES = await m.generateContent(P)
  const E = Date.now() - ST
  const R = RES.response
  const U = R?.usageMetadata || {}
  return {
    inputTokens: U.promptTokenCount || 0,
    outputTokens: U.candidatesTokenCount || 0,
    timeMs: E,
    response: R?.text?.() || ''
  }
}
export async function benchmark(Q, O = {}) {
  const C = process.cwd()
  if (!exists(C)) {
    console.log('No LK context found. Run: lk sync')
    process.exit(1)
  }
  const P = getAiProvider()
  console.log('lk benchmark\n')
  console.log(`Provider: ${P === 'gemini' ? 'Gemini' : 'Anthropic'}`)
  console.log('Analyzing project structure...')
  const PI = aP(C)
  console.log(`Project type: ${PI.type}`)
  console.log(`Entry point: ${PI.entryPoint || 'not detected'}`)
  console.log(`Key files: ${PI.keyFiles.length}`)
  console.log(`Commands: ${PI.commands.length > 0 ? PI.commands.join(', ') : 'none'}`)
  console.log('')
  const LC = buildContext(C)
  const LT = countTokens(LC).tokens
  const S = gS(C, PI)
  if (O.scenarios || !Q) {
    const RA = O.run
    console.log(`Running ${RA ? 'ACTUAL' : 'estimated'} scenario benchmarks...`)
    console.log(`Generated ${S.length} scenarios for this project\n`)
    console.log('='.repeat(60))
    let TWLK = 0
    let TWL = 0
    let TTWLK = 0
    let TTWL = 0
    for (const SC of S) {
      console.log(`\nScenario: ${SC.name}`)
      console.log(`Question: "${SC.question}"`)
      console.log('-'.repeat(50))
      const WLKS = SC.simulateWithoutLK()
      if (RA) {
        let GC = ''
        for (const ST of WLKS.steps) {
          if (ST.tool === 'Grep' && ST.pattern) {
            const GR = sGR(C, ST.pattern)
            GC += GR.result + '\n\n'
          } else if (ST.tool === 'Glob' && ST.pattern) {
            const GL = sG(C, ST.pattern)
            GC += GL.result + '\n\n'
          } else if (ST.tool === 'Read' && ST.file) {
            const RE = sR(C, ST.file)
            GC += `--- ${ST.file} ---\n${RE.result}\n\n`
          }
        }
        console.log('\nWithout LK (actual API call):')
        const RW = await rQ(GC, SC.question)
        console.log(`  Input:  ${RW.inputTokens.toLocaleString()} tokens`)
        console.log(`  Output: ${RW.outputTokens.toLocaleString()} tokens`)
        console.log(`  Time:   ${RW.timeMs.toLocaleString()}ms`)
        console.log('\nWith LK (actual API call):')
        const RWI = await rQ(LC, SC.question)
        console.log(`  Input:  ${RWI.inputTokens.toLocaleString()} tokens`)
        console.log(`  Output: ${RWI.outputTokens.toLocaleString()} tokens`)
        console.log(`  Time:   ${RWI.timeMs.toLocaleString()}ms`)
        if (O.verbose) {
          console.log('\n  Response WITHOUT LK:')
          console.log('  ' + RW.response.split('\n').slice(0, 10).join('\n  '))
          if (RW.response.split('\n').length > 10) console.log('  ...')
          console.log('\n  Response WITH LK:')
          console.log('  ' + RWI.response.split('\n').slice(0, 10).join('\n  '))
          if (RWI.response.split('\n').length > 10) console.log('  ...')
        }
        const SV = RW.inputTokens - RWI.inputTokens
        const PC = ((SV / RW.inputTokens) * 100).toFixed(1)
        if (SV > 0) {
          console.log(`\n  ✓ LK saves ${SV.toLocaleString()} input tokens (${PC}% reduction)`)
        } else {
          console.log(`\n  → LK uses ${Math.abs(SV).toLocaleString()} more input tokens`)
        }
        TWLK += RW.inputTokens
        TWL += RWI.inputTokens
        TTWLK += RW.timeMs
        TTWL += RWI.timeMs
      } else {
        console.log('\nWithout LK (estimated tool calls):')
        for (const ST of WLKS.steps) {
          console.log(`  ${ST.tool}(${ST.pattern || ST.file || '...'}) → ~${ST.tokens} tokens`)
        }
        console.log(`  Total context: ~${WLKS.totalTokens} tokens`)
        console.log('\nWith LK:')
        console.log(`  LK context already loaded → ~${LT} tokens`)
        const SV = WLKS.totalTokens - LT
        const PC = ((SV / WLKS.totalTokens) * 100).toFixed(1)
        if (SV > 0) {
          console.log(`\n  ✓ LK saves ~${SV} tokens (${PC}% reduction)`)
        } else {
          console.log(`\n  → LK uses ${Math.abs(SV)} more tokens (but provides full context upfront)`)
        }
        TWLK += WLKS.totalTokens
        TWL += LT
      }
    }
    console.log('\n' + '='.repeat(60))
    console.log('SUMMARY (across all scenarios)\n')
    if (RA) {
      console.log(`Total without LK: ${TWLK.toLocaleString()} input tokens`)
      console.log(`Total with LK:    ${TWL.toLocaleString()} input tokens`)
      console.log(`Total time without LK: ${TTWLK.toLocaleString()}ms`)
      console.log(`Total time with LK:    ${TTWL.toLocaleString()}ms`)
    } else {
      console.log(`Total without LK: ~${TWLK.toLocaleString()} tokens (estimated)`)
      console.log(`Total with LK:    ~${(LT * S.length).toLocaleString()} tokens`)
    }
    const TSV = TWLK - (RA ? TWL : LT * S.length)
    const TPC = ((TSV / TWLK) * 100).toFixed(1)
    if (TSV > 0) {
      console.log(`\nLK saves ${RA ? '' : '~'}${TSV.toLocaleString()} tokens total (${TPC}% reduction)`)
    }
    if (!RA) {
      console.log('\nNote: These are estimates. Use --run to make actual API calls.')
    }
  } else {
    console.log(`Question: "${Q}"\n`)
    const WLKS = {
      steps: [],
      totalTokens: 0
    }
    const LW = Q.split(' ').filter(W => W.length > 3).slice(-1)[0] || 'main'
    const GR = sGR(C, LW)
    const RS = GR.matches.slice(0, 2).map(MT => sR(C, MT.file))
    WLKS.steps = [
      { tool: 'Grep', pattern: LW, tokens: GR.tokens },
      ...RS.map((RE, I) => ({ tool: 'Read', file: GR.matches[I]?.file, tokens: RE.tokens }))
    ]
    WLKS.totalTokens = GR.tokens + RS.reduce((SU, RE) => SU + RE.tokens, 0)
    console.log('Estimated without LK:')
    console.log(`  Tool calls: ${WLKS.steps.length}`)
    console.log(`  Context tokens: ~${WLKS.totalTokens}`)
    console.log('')
    console.log('With LK:')
    console.log(`  Context tokens: ~${LT}`)
    console.log('')
    if (O.run) {
      let GC = ''
      GC += GR.result + '\n\n'
      for (let I = 0; I < RS.length && I < GR.matches.length; I++) {
        GC += `--- ${GR.matches[I].file} ---\n${RS[I].result}\n\n`
      }
      console.log('Running actual API calls...\n')
      const RW = await rQ(GC, Q)
      console.log('Without LK:')
      console.log(`  Input:  ${RW.inputTokens} tokens`)
      console.log(`  Output: ${RW.outputTokens} tokens`)
      console.log(`  Time:   ${RW.timeMs}ms`)
      const RWI = await rQ(LC, Q)
      console.log('\nWith LK:')
      console.log(`  Input:  ${RWI.inputTokens} tokens`)
      console.log(`  Output: ${RWI.outputTokens} tokens`)
      console.log(`  Time:   ${RWI.timeMs}ms`)
      if (O.verbose) {
        console.log('\nResponse WITHOUT LK:')
        console.log(RW.response)
        console.log('\nResponse WITH LK:')
        console.log(RWI.response)
      }
      const SV = RW.inputTokens - RWI.inputTokens
      console.log('\n' + '-'.repeat(50))
      if (SV > 0) {
        console.log(`LK saves ${SV} tokens (${((SV / RW.inputTokens) * 100).toFixed(1)}% reduction)`)
      } else {
        console.log(`LK uses ${Math.abs(SV)} more tokens`)
      }
    } else {
      const SV = WLKS.totalTokens - LT
      console.log('-'.repeat(50))
      if (SV > 0) {
        console.log(`LK saves ~${SV} tokens (${((SV / WLKS.totalTokens) * 100).toFixed(1)}% reduction)`)
      } else {
        console.log(`LK provides full context upfront (${LT} tokens)`)
      }
      console.log('\nUse --run to make actual API calls.')
    }
  }
}