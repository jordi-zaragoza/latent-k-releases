#!/usr/bin/env node

import { build } from 'esbuild'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distDir = join(root, 'dist')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// Clean dist
rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

console.log('📦 Bundling with esbuild...')

// Bundle CLI
await build({
  entryPoints: [join(root, 'src/cli.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: join(distDir, 'cli.js'),
  minify: true,
  sourcemap: false,
  define: {
    __VERSION__: JSON.stringify(pkg.version)
  }
})

// Create package.json for pkg
writeFileSync(join(distDir, 'package.json'), JSON.stringify({
  name: 'lk',
  bin: 'cli.js',
  pkg: {
    assets: [],
    targets: ['node18']
  }
}, null, 2))

console.log('✅ Bundle created: dist/cli.js')

// Determine which targets to build
const targets = process.argv.includes('--all')
  ? ['node18-linux-x64', 'node18-macos-x64', 'node18-win-x64']
  : process.argv.includes('--linux') ? ['node18-linux-x64']
  : process.argv.includes('--macos') ? ['node18-macos-x64']
  : process.argv.includes('--win') ? ['node18-win-x64']
  : [detectCurrentPlatform()]

function detectCurrentPlatform() {
  const platform = process.platform === 'darwin' ? 'macos'
    : process.platform === 'win32' ? 'win'
    : 'linux'
  return `node18-${platform}-x64`
}

console.log(`\n🔨 Building binaries for: ${targets.join(', ')}`)

// Build with pkg from dist directory
const pkgCmd = `npx @yao-pkg/pkg . --targets ${targets.join(',')} --output lk --compress GZip`

try {
  execSync(pkgCmd, { cwd: distDir, stdio: 'inherit' })
  console.log('\n✅ Binaries created in dist/')

  // Show output files
  execSync('ls -lh dist/lk*', { cwd: root, stdio: 'inherit' })
} catch (err) {
  console.error('❌ Failed to create binaries')
  process.exit(1)
}
