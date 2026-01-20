import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', 'src')

describe('CLI binary protection', () => {
  const cliContent = readFileSync(join(srcDir, 'cli.js'), 'utf8')

  it('defines IS_BINARY from process.pkg', () => {
    expect(cliContent).toContain('const IS_BINARY = !!process.pkg')
  })

  it('context command is protected with !IS_BINARY', () => {
    // The context command block should be inside if (!IS_BINARY)
    const contextBlock = cliContent.match(/if\s*\(\s*!IS_BINARY\s*\)\s*\{[\s\S]*?command\('context'\)/)
    expect(contextBlock).not.toBeNull()
  })

  it('expand command is available in binary (used by hooks)', () => {
    // The expand command should be OUTSIDE if (!IS_BINARY) so it's available in the binary
    // It's registered before the if (!IS_BINARY) block
    const expandBeforeBlock = cliContent.match(/\.command\('expand[\s\S]*?if\s*\(\s*!IS_BINARY\s*\)/)
    expect(expandBeforeBlock).not.toBeNull()
  })

  it('benchmark command is protected with !IS_BINARY', () => {
    // The benchmark command block should be inside if (!IS_BINARY)
    const benchmarkBlock = cliContent.match(/if\s*\(\s*!IS_BINARY\s*\)\s*\{[\s\S]*?command\('benchmark/)
    expect(benchmarkBlock).not.toBeNull()
  })

  it('dev command is protected with !IS_BINARY', () => {
    // The dev command block should be inside if (!IS_BINARY)
    const devBlock = cliContent.match(/if\s*\(\s*!IS_BINARY\s*\)\s*\{[\s\S]*?command\('dev/)
    expect(devBlock).not.toBeNull()
  })

  it('dev command does NOT use DEV_MODE for registration', () => {
    // Should not have: if (DEV_MODE) { ... command('dev')
    const devModeBlock = cliContent.match(/if\s*\(\s*DEV_MODE\s*\)\s*\{[\s\S]*?command\('dev/)
    expect(devModeBlock).toBeNull()
  })
})


describe('CLI banner gradient', () => {
  const cliContent = readFileSync(join(srcDir, 'cli.js'), 'utf8')

  it('checks COLORTERM for true color support', () => {
    expect(cliContent).toContain("process.env.COLORTERM === 'truecolor'")
    expect(cliContent).toContain("process.env.COLORTERM === '24bit'")
  })

  it('has gradient function with RGB colors', () => {
    expect(cliContent).toContain('gradientChar')
    expect(cliContent).toMatch(/\\x1b\[38;2;/)
  })

  it('has cyan fallback for unsupported terminals', () => {
    expect(cliContent).toContain("const cyan = '\\x1b[36m'")
    expect(cliContent).toContain('if (supportsTrueColor)')
    expect(cliContent).toMatch(/else\s*\{[\s\S]*?\$\{cyan\}/)
  })

  it('banner has correct ASCII art', () => {
    expect(cliContent).toContain('╔═══════════════════════════════════╗')
    expect(cliContent).toContain('║       ⦓  L A T E N T - K  ⦔       ║')
    expect(cliContent).toContain('╚═══════════════════════════════════╝')
  })
})

describe('License admin is external', () => {
  it('cli.js does not register license generation commands', () => {
    const cliContent = readFileSync(join(srcDir, 'cli.js'), 'utf8')

    // Should not have commands for license generation
    expect(cliContent).not.toMatch(/command\(['"]generate['"]/)
    expect(cliContent).not.toMatch(/command\(['"]batch['"]/)
    expect(cliContent).not.toMatch(/command\(['"]keys['"]/)
  })

  it('license-admin.js exists in scripts/', () => {
    const scriptsDir = join(__dirname, '..', 'scripts')
    const licenseAdmin = readFileSync(join(scriptsDir, 'license-admin.js'), 'utf8')

    expect(licenseAdmin).toContain('generate')
    expect(licenseAdmin).toContain('batch')
  })
})
