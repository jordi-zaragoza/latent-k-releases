import fs from 'fs'
import { getFileExtension } from './context.js'

// Strip comments by language
const stripJS = code => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const stripPy = code => code.replace(/#.*$/gm, '').replace(/'''[\s\S]*?'''/g, '').replace(/"""[\s\S]*?"""/g, '')
const stripGo = code => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const stripPHP = code => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/#.*$/gm, '')
const stripRuby = code => code.replace(/#.*$/gm, '').replace(/=begin[\s\S]*?=end/g, '')
const stripRust = code => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const stripJava = code => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

// JS/TS exports
function extractJS(content) {
  const exports = new Set()
  // module.exports = { foo, bar }
  const objExport = content.match(/module\.exports\s*=\s*\{([^}]+)\}/)
  if (objExport) {
    const keys = objExport[1].split(',').map(p => p.trim().split(/[\s:]/)[0]).filter(k => /^\w+$/.test(k))
    keys.forEach(k => exports.add(k))
  }
  // module.exports.foo = ... or exports.foo = ...
  for (const m of content.matchAll(/(?:module\.)?exports\.(\w+)\s*=/g)) exports.add(m[1])
  // ES: export function/const/class foo
  for (const m of content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g)) exports.add(m[1])
  // ES: export { foo, bar }
  const esNamed = content.match(/export\s*\{([^}]+)\}/)
  if (esNamed) (esNamed[1].match(/\w+/g) || []).forEach(n => exports.add(n))
  const ignore = ['use', 'strict', 'default']
  return [...exports].filter(e => !ignore.includes(e)).sort()
}

// Python: def foo, class Foo, async def foo (exclude _private)
function extractPy(content) {
  const exports = new Set()
  for (const m of content.matchAll(/^(?:async\s+)?def\s+(\w+)/gm)) exports.add(m[1])
  for (const m of content.matchAll(/^class\s+(\w+)/gm)) exports.add(m[1])
  return [...exports].filter(e => !e.startsWith('_')).sort()
}

// Go: func Foo, type Foo (exported = capitalized)
function extractGo(content) {
  const exports = new Set()
  for (const m of content.matchAll(/^func\s+(?:\([^)]+\)\s+)?(\w+)/gm)) exports.add(m[1])
  for (const m of content.matchAll(/^type\s+(\w+)/gm)) exports.add(m[1])
  return [...exports].filter(e => /^[A-Z]/.test(e)).sort()
}

// PHP: public function, class (exclude __magic)
function extractPHP(content) {
  const exports = new Set()
  for (const m of content.matchAll(/^\s*function\s+(\w+)/gm)) exports.add(m[1])
  for (const m of content.matchAll(/^\s*public\s+(?:static\s+)?function\s+(\w+)/gm)) exports.add(m[1])
  for (const m of content.matchAll(/^\s*class\s+(\w+)/gm)) exports.add(m[1])
  return [...exports].filter(e => !e.startsWith('__')).sort()
}

// Ruby: def, class, module (exclude initialize)
function extractRuby(content) {
  const exports = new Set()
  for (const m of content.matchAll(/^\s*def\s+(?:self\.)?(\w+)/gm)) exports.add(m[1])
  for (const m of content.matchAll(/^\s*(?:class|module)\s+(\w+)/gm)) exports.add(m[1])
  return [...exports].filter(e => !['initialize'].includes(e) && !e.startsWith('_')).sort()
}

// Rust: pub fn, pub struct, pub enum, pub trait
function extractRust(content) {
  const exports = new Set()
  for (const m of content.matchAll(/^\s*pub\s+(?:async\s+)?fn\s+(\w+)/gm)) exports.add(m[1])
  for (const m of content.matchAll(/^\s*pub\s+(?:struct|enum|trait|type)\s+(\w+)/gm)) exports.add(m[1])
  return [...exports].sort()
}

// Java/Kotlin: public class, public void/type method
function extractJava(content) {
  const exports = new Set()
  for (const m of content.matchAll(/^\s*public\s+(?:static\s+)?(?:class|interface|enum)\s+(\w+)/gm)) exports.add(m[1])
  for (const m of content.matchAll(/^\s*public\s+(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/gm)) exports.add(m[1])
  return [...exports].sort()
}

// Main extractor
export function extractExports(filePath) {
  if (!fs.existsSync(filePath)) return []
  const ext = getFileExtension(filePath)
  const content = fs.readFileSync(filePath, 'utf8')

  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(ext)) return extractJS(stripJS(content))
  if (['py'].includes(ext)) return extractPy(stripPy(content))
  if (['go'].includes(ext)) return extractGo(stripGo(content))
  if (['php'].includes(ext)) return extractPHP(stripPHP(content))
  if (['rb'].includes(ext)) return extractRuby(stripRuby(content))
  if (['rs'].includes(ext)) return extractRust(stripRust(content))
  if (['java', 'kt', 'kts'].includes(ext)) return extractJava(stripJava(content))
  return []
}
