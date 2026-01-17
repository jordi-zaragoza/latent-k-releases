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
