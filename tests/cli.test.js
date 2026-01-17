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

describe('Nav context has no command references', () => {
  const cliContent = readFileSync(join(srcDir, 'cli.js'), 'utf8')

  it('buildProjectContext Nav does not reference lk commands', () => {
    // Extract the Nav block from buildProjectContext
    const navMatch = cliContent.match(/parts\.push\(`⟦Nav⟧[\s\S]*?`\)/)
    expect(navMatch).not.toBeNull()

    const navContent = navMatch[0]
    expect(navContent).not.toContain('lk context')
    expect(navContent).not.toContain('Bash:')
  })

  it('buildDomainContext Nav does not reference lk commands', () => {
    // Find the second Nav block (in buildDomainContext)
    const matches = cliContent.match(/⟦Nav⟧[\s\S]*?`\)/g)
    expect(matches).not.toBeNull()
    expect(matches.length).toBeGreaterThanOrEqual(2)

    const domainNav = matches[1]
    expect(domainNav).not.toContain('lk context')
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
