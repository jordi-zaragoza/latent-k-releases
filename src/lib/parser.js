import fs from 'fs'
import { getFileExtension } from './context.js'

// Max content size for regex operations to prevent ReDoS
const MAX_STRIP_SIZE = 100000  // 100KB limit for comment stripping

/**
 * Safe comment stripping with size limit to prevent ReDoS
 * For large files, returns content as-is (exports extraction will still work)
 */
function safeStrip(code, stripFn) {
  if (code.length > MAX_STRIP_SIZE) {
    return code  // Skip stripping for very large files
  }
  return stripFn(code)
}

// Strip comments by language (applied with size limit)
const stripJS = code => safeStrip(code, c => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
const stripPy = code => safeStrip(code, c => c.replace(/#.*$/gm, '').replace(/'''[\s\S]*?'''/g, '').replace(/"""[\s\S]*?"""/g, ''))
const stripGo = code => safeStrip(code, c => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
const stripPHP = code => safeStrip(code, c => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/#.*$/gm, ''))
const stripRuby = code => safeStrip(code, c => c.replace(/#.*$/gm, '').replace(/=begin[\s\S]*?=end/g, ''))
const stripRust = code => safeStrip(code, c => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))
const stripJava = code => safeStrip(code, c => c.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))

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

// HTML: extract IDs, form names, and data attributes
function extractHTML(content) {
  const exports = new Set()
  // IDs
  for (const m of content.matchAll(/\bid=["']([^"']+)["']/gi)) exports.add(m[1])
  // Form names
  for (const m of content.matchAll(/<form[^>]+name=["']([^"']+)["']/gi)) exports.add(m[1])
  // Data component attributes
  for (const m of content.matchAll(/data-component=["']([^"']+)["']/gi)) exports.add(m[1])
  return [...exports].sort()
}

// CSS: extract class and ID selectors
function extractCSS(content) {
  const exports = new Set()
  // Class selectors (followed by space, brace, comma, colon, or end)
  for (const m of content.matchAll(/\.([a-zA-Z_][\w-]*)(?=\s|[{,:]|$)/g)) exports.add(m[1])
  // ID selectors
  for (const m of content.matchAll(/#([a-zA-Z_][\w-]*)(?=\s|[{,:]|$)/g)) exports.add(m[1])
  // CSS custom properties
  for (const m of content.matchAll(/--([\w-]+)\s*:/g)) exports.add(`--${m[1]}`)
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
  if (['html', 'htm'].includes(ext)) return extractHTML(content)
  if (['css'].includes(ext)) return extractCSS(content)
  return []
}

// ========== Function body extraction ==========

/**
 * Extract function/class body from source code
 * @param {string} content - File content
 * @param {string} name - Function/class name to extract
 * @param {string} ext - File extension
 * @returns {string|null} Function body or null if not found
 */
export function extractFunctionBody(content, name, ext) {
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(ext)) {
    return extractJSFunction(content, name)
  }
  if (['py'].includes(ext)) {
    return extractPyFunction(content, name)
  }
  // For other languages, return null (full file will be used)
  return null
}

/**
 * Extract JS/TS function, class, or const arrow function
 */
function extractJSFunction(content, name) {
  const lines = content.split('\n')

  // Patterns to match function/class declaration start
  const patterns = [
    new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${name}\\s*\\(`),
    new RegExp(`^(export\\s+)?(const|let|var)\\s+${name}\\s*=`),
    new RegExp(`^(export\\s+)?class\\s+${name}\\b`),
    new RegExp(`^\\s*${name}\\s*\\(`),  // Method in object/class
    new RegExp(`^\\s*(async\\s+)?${name}\\s*\\(`),  // Method shorthand
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (patterns.some(p => p.test(line))) {
      // Found start, now find end using brace counting
      return extractBraceBlock(lines, i)
    }
  }
  return null
}

/**
 * Extract Python function or class using indentation
 */
function extractPyFunction(content, name) {
  const lines = content.split('\n')
  const pattern = new RegExp(`^(async\\s+)?def\\s+${name}\\s*\\(|^class\\s+${name}\\b`)

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return extractIndentBlock(lines, i)
    }
  }
  return null
}

/**
 * Extract block using brace counting (JS/TS/Go/Rust/Java/C-style)
 * Properly ignores braces inside strings and comments
 */
function extractBraceBlock(lines, startLine) {
  let braceCount = 0
  let started = false
  const result = []

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]
    result.push(line)

    // Count braces while respecting strings and comments
    let inString = null  // null, '"', "'", or '`'
    let inLineComment = false

    for (let j = 0; j < line.length; j++) {
      const char = line[j]
      const prevChar = j > 0 ? line[j - 1] : ''

      // Skip escaped characters
      if (prevChar === '\\') continue

      // Handle line comments
      if (!inString && char === '/' && line[j + 1] === '/') {
        inLineComment = true
        break  // Rest of line is comment
      }

      // Handle string boundaries
      if (!inLineComment) {
        if (inString === null && (char === '"' || char === "'" || char === '`')) {
          inString = char
        } else if (inString === char) {
          inString = null
        }
      }

      // Count braces only outside strings and comments
      if (!inString && !inLineComment) {
        if (char === '{') {
          braceCount++
          started = true
        } else if (char === '}') {
          braceCount--
        }
      }
    }

    // If we started and braces are balanced, we're done
    if (started && braceCount === 0) {
      break
    }
  }

  return result.join('\n')
}

/**
 * Extract block using indentation (Python/Ruby)
 */
function extractIndentBlock(lines, startLine) {
  const result = [lines[startLine]]
  const defLine = lines[startLine]
  // Get base indentation (leading whitespace)
  const baseIndent = defLine.match(/^(\s*)/)[1].length

  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i]
    // Empty lines or lines more indented than base belong to block
    if (line.trim() === '' || line.match(/^(\s*)/)[1].length > baseIndent) {
      result.push(line)
    } else {
      // First line at same or less indentation ends the block
      break
    }
  }

  return result.join('\n')
}

/**
 * Extract multiple functions from a file
 * @param {string} filePath - Path to file
 * @param {string[]} functionNames - Functions to extract
 * @returns {Object} Map of function name to code
 */
export function extractFunctions(filePath, functionNames) {
  if (!fs.existsSync(filePath)) return {}
  const ext = getFileExtension(filePath)
  const content = fs.readFileSync(filePath, 'utf8')
  const result = {}

  for (const name of functionNames) {
    const body = extractFunctionBody(content, name, ext)
    if (body) {
      result[name] = body.trim()
    }
  }

  return result
}

// Max lines to show at start/end of large files
const HEAD_LINES = 25
const TAIL_LINES = 25
const MAX_LINES = HEAD_LINES + TAIL_LINES

/**
 * Truncate content to first N + last N lines if too large
 * @param {string} content - File content
 * @returns {{content: string, truncated: boolean}}
 */
function truncateByLines(content) {
  const lines = content.split('\n')

  if (lines.length <= MAX_LINES) {
    return { content, truncated: false }
  }

  const head = lines.slice(0, HEAD_LINES)
  const tail = lines.slice(-TAIL_LINES)
  const omitted = lines.length - MAX_LINES

  const result = [
    ...head,
    `\n... (${omitted} lines omitted) ...\n`,
    ...tail
  ].join('\n')

  return { content: result, truncated: true }
}

/**
 * Get file content, optionally extracting only specified functions
 * @param {string} filePath - Path to file
 * @param {string[]|null} functionNames - Functions to extract, or null for full file
 * @returns {{content: string, truncated: boolean}|null} File content and truncation status
 */
export function getFileContext(filePath, functionNames = null) {
  if (!fs.existsSync(filePath)) return null
  const content = fs.readFileSync(filePath, 'utf8')

  if (!functionNames || functionNames.length === 0) {
    // Return full file, truncated if needed
    return truncateByLines(content)
  }

  // Extract specified functions
  const ext = getFileExtension(filePath)
  const extracted = []

  for (const name of functionNames) {
    const body = extractFunctionBody(content, name, ext)
    if (body) {
      extracted.push(body.trim())
    }
  }

  if (extracted.length === 0) {
    // No functions found, return full file
    return truncateByLines(content)
  }

  const result = extracted.join('\n\n')
  return truncateByLines(result)
}
