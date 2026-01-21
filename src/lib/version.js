import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
// __VERSION__ injected by esbuild at build time
let version
try {
  if (typeof __VERSION__ !== 'undefined') {
    version = __VERSION__
  } else {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    version = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')).version
  }
} catch {
  version = '0.0.0'
}
export const VERSION = version