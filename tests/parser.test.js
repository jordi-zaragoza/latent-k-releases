import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { extractExports, extractFunctionBody, extractFunctions, getFileContext } from '../src/lib/parser.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

const tmpDir = path.join(os.tmpdir(), 'lk-test-parser')

beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeTestFile(name, content) {
  const filePath = path.join(tmpDir, name)
  fs.writeFileSync(filePath, content)
  return filePath
}

describe('extractExports', () => {
  it('returns empty array for non-existent file', () => {
    expect(extractExports('/nonexistent/file.js')).toEqual([])
  })

  it('returns empty array for unknown extension', () => {
    const file = writeTestFile('test.xyz', 'some content')
    expect(extractExports(file)).toEqual([])
  })
})

describe('JavaScript extraction', () => {
  it('extracts export function', () => {
    const file = writeTestFile('test1.js', 'export function foo() {}')
    expect(extractExports(file)).toEqual(['foo'])
  })

  it('extracts export const', () => {
    const file = writeTestFile('test2.js', 'export const bar = 123')
    expect(extractExports(file)).toEqual(['bar'])
  })

  it('extracts export class', () => {
    const file = writeTestFile('test3.js', 'export class MyClass {}')
    expect(extractExports(file)).toEqual(['MyClass'])
  })

  it('extracts async function', () => {
    const file = writeTestFile('test4.js', 'export async function fetchData() {}')
    expect(extractExports(file)).toEqual(['fetchData'])
  })

  it('extracts named exports', () => {
    const file = writeTestFile('test5.js', `
      const a = 1
      const b = 2
      export { a, b }
    `)
    expect(extractExports(file)).toEqual(['a', 'b'])
  })

  it('extracts module.exports object', () => {
    const file = writeTestFile('test6.js', `
      function foo() {}
      function bar() {}
      module.exports = { foo, bar }
    `)
    expect(extractExports(file)).toEqual(['bar', 'foo'])
  })

  it('extracts module.exports.name', () => {
    const file = writeTestFile('test7.js', `
      module.exports.myFunc = function() {}
      exports.otherFunc = function() {}
    `)
    expect(extractExports(file)).toEqual(['myFunc', 'otherFunc'])
  })

  it('ignores comments', () => {
    const file = writeTestFile('test8.js', `
      // export function commented() {}
      /* export function blockCommented() {} */
      export function real() {}
    `)
    expect(extractExports(file)).toEqual(['real'])
  })

  it('handles multiple exports', () => {
    const file = writeTestFile('test9.js', `
      export function one() {}
      export const two = 2
      export class Three {}
      export async function four() {}
    `)
    expect(extractExports(file)).toEqual(['Three', 'four', 'one', 'two'])
  })

  it('handles TypeScript files', () => {
    const file = writeTestFile('test.ts', `
      export interface User {}
      export function getUser() {}
      export const API_URL = 'http://...'
    `)
    const exports = extractExports(file)
    expect(exports).toContain('getUser')
    expect(exports).toContain('API_URL')
  })
})

describe('Python extraction', () => {
  it('extracts def functions', () => {
    const file = writeTestFile('test.py', `
def foo():
    pass

def bar():
    pass
`)
    expect(extractExports(file)).toEqual(['bar', 'foo'])
  })

  it('extracts class definitions', () => {
    const file = writeTestFile('test2.py', `
class MyClass:
    pass

class AnotherClass:
    pass
`)
    expect(extractExports(file)).toEqual(['AnotherClass', 'MyClass'])
  })

  it('extracts async def', () => {
    const file = writeTestFile('test3.py', `
async def fetch_data():
    pass
`)
    expect(extractExports(file)).toEqual(['fetch_data'])
  })

  it('ignores private functions', () => {
    const file = writeTestFile('test4.py', `
def public():
    pass

def _private():
    pass

def __dunder__():
    pass
`)
    expect(extractExports(file)).toEqual(['public'])
  })

  it('ignores comments', () => {
    const file = writeTestFile('test5.py', `
# def commented():
#     pass
"""
def docstring_commented():
    pass
"""
def real():
    pass
`)
    expect(extractExports(file)).toEqual(['real'])
  })
})

describe('Go extraction', () => {
  it('extracts exported functions (capitalized)', () => {
    const file = writeTestFile('test.go', `
package main

func ExportedFunc() {}
func privateFunc() {}
`)
    expect(extractExports(file)).toEqual(['ExportedFunc'])
  })

  it('extracts exported types', () => {
    const file = writeTestFile('test2.go', `
package main

type MyStruct struct {}
type myPrivate struct {}
`)
    expect(extractExports(file)).toEqual(['MyStruct'])
  })

  it('extracts method receivers', () => {
    const file = writeTestFile('test3.go', `
package main

func (s *Server) HandleRequest() {}
func (s *Server) internal() {}
`)
    expect(extractExports(file)).toEqual(['HandleRequest'])
  })
})

describe('PHP extraction', () => {
  it('extracts functions', () => {
    const file = writeTestFile('test.php', `<?php
function myFunction() {}
`)
    expect(extractExports(file)).toEqual(['myFunction'])
  })

  it('extracts public methods', () => {
    const file = writeTestFile('test2.php', `<?php
class MyClass {
    public function publicMethod() {}
    private function privateMethod() {}
}
`)
    expect(extractExports(file)).toContain('publicMethod')
    expect(extractExports(file)).toContain('MyClass')
  })

  it('ignores magic methods', () => {
    const file = writeTestFile('test3.php', `<?php
class MyClass {
    public function __construct() {}
    public function __toString() {}
    public function realMethod() {}
}
`)
    const exports = extractExports(file)
    expect(exports).toContain('realMethod')
    expect(exports).not.toContain('__construct')
  })
})

describe('Ruby extraction', () => {
  it('extracts methods', () => {
    const file = writeTestFile('test.rb', `
def my_method
end

def another_method
end
`)
    expect(extractExports(file)).toEqual(['another_method', 'my_method'])
  })

  it('extracts class methods', () => {
    const file = writeTestFile('test2.rb', `
def self.class_method
end
`)
    expect(extractExports(file)).toEqual(['class_method'])
  })

  it('extracts classes and modules', () => {
    const file = writeTestFile('test3.rb', `
class MyClass
end

module MyModule
end
`)
    expect(extractExports(file)).toEqual(['MyClass', 'MyModule'])
  })

  it('ignores initialize and private', () => {
    const file = writeTestFile('test4.rb', `
def initialize
end

def _private_method
end

def public_method
end
`)
    expect(extractExports(file)).toEqual(['public_method'])
  })
})

describe('Rust extraction', () => {
  it('extracts pub fn', () => {
    const file = writeTestFile('test.rs', `
pub fn exported() {}
fn private() {}
`)
    expect(extractExports(file)).toEqual(['exported'])
  })

  it('extracts pub async fn', () => {
    const file = writeTestFile('test2.rs', `
pub async fn async_func() {}
`)
    expect(extractExports(file)).toEqual(['async_func'])
  })

  it('extracts pub struct/enum/trait', () => {
    const file = writeTestFile('test3.rs', `
pub struct MyStruct {}
pub enum MyEnum {}
pub trait MyTrait {}
struct PrivateStruct {}
`)
    expect(extractExports(file)).toEqual(['MyEnum', 'MyStruct', 'MyTrait'])
  })
})

describe('Java extraction', () => {
  it('extracts public classes', () => {
    const file = writeTestFile('Test.java', `
public class MyClass {}
class PackagePrivate {}
`)
    expect(extractExports(file)).toEqual(['MyClass'])
  })

  it('extracts public methods', () => {
    const file = writeTestFile('Test2.java', `
public class MyClass {
    public void myMethod() {}
    private void privateMethod() {}
    public static String staticMethod() {}
}
`)
    const exports = extractExports(file)
    expect(exports).toContain('MyClass')
    expect(exports).toContain('myMethod')
    expect(exports).toContain('staticMethod')
  })

  it('extracts interfaces and enums', () => {
    const file = writeTestFile('Test3.java', `
public interface MyInterface {}
public enum MyEnum {}
`)
    expect(extractExports(file)).toEqual(['MyEnum', 'MyInterface'])
  })
})

describe('HTML extraction', () => {
  it('extracts element IDs', () => {
    const file = writeTestFile('test.html', `
<div id="header"></div>
<form id="login-form">
  <input id="username" type="text">
  <button id="submit-btn">Submit</button>
</form>
`)
    const exports = extractExports(file)
    expect(exports).toContain('header')
    expect(exports).toContain('login-form')
    expect(exports).toContain('username')
    expect(exports).toContain('submit-btn')
  })

  it('extracts form names', () => {
    const file = writeTestFile('test2.html', `
<form name="contactForm" action="/submit">
  <input type="text">
</form>
`)
    expect(extractExports(file)).toContain('contactForm')
  })

  it('extracts data-component attributes', () => {
    const file = writeTestFile('test3.html', `
<div data-component="NavBar"></div>
<section data-component="Hero"></section>
`)
    const exports = extractExports(file)
    expect(exports).toContain('NavBar')
    expect(exports).toContain('Hero')
  })

  it('handles mixed quotes', () => {
    const file = writeTestFile('test4.html', `
<div id="double-quoted"></div>
<div id='single-quoted'></div>
`)
    const exports = extractExports(file)
    expect(exports).toContain('double-quoted')
    expect(exports).toContain('single-quoted')
  })

  it('handles .htm extension', () => {
    const file = writeTestFile('test.htm', `<div id="content"></div>`)
    expect(extractExports(file)).toEqual(['content'])
  })
})

describe('CSS extraction', () => {
  it('extracts class selectors', () => {
    const file = writeTestFile('test.css', `
.header {
  color: red;
}
.nav-item {
  display: flex;
}
`)
    const exports = extractExports(file)
    expect(exports).toContain('header')
    expect(exports).toContain('nav-item')
  })

  it('extracts ID selectors', () => {
    const file = writeTestFile('test2.css', `
#main-content {
  width: 100%;
}
#sidebar {
  width: 300px;
}
`)
    const exports = extractExports(file)
    expect(exports).toContain('main-content')
    expect(exports).toContain('sidebar')
  })

  it('extracts CSS custom properties', () => {
    const file = writeTestFile('test3.css', `
:root {
  --primary-color: #007bff;
  --font-size-base: 16px;
}
`)
    const exports = extractExports(file)
    expect(exports).toContain('--primary-color')
    expect(exports).toContain('--font-size-base')
  })

  it('handles combined selectors', () => {
    const file = writeTestFile('test4.css', `
.card, .panel {
  border: 1px solid;
}
.btn:hover {
  opacity: 0.8;
}
`)
    const exports = extractExports(file)
    expect(exports).toContain('card')
    expect(exports).toContain('panel')
    expect(exports).toContain('btn')
  })

  it('handles nested selectors', () => {
    const file = writeTestFile('test5.css', `
.container .inner-box {
  padding: 10px;
}
`)
    const exports = extractExports(file)
    expect(exports).toContain('container')
    expect(exports).toContain('inner-box')
  })
})

describe('extractFunctionBody', () => {
  describe('JavaScript', () => {
    it('extracts simple function', () => {
      const content = `function foo() {
  return 42
}`
      const result = extractFunctionBody(content, 'foo', 'js')
      expect(result).toContain('function foo()')
      expect(result).toContain('return 42')
    })

    it('extracts export function', () => {
      const content = `export function bar() {
  console.log('hello')
}`
      const result = extractFunctionBody(content, 'bar', 'js')
      expect(result).toContain('export function bar()')
    })

    it('extracts async function', () => {
      const content = `export async function fetchData() {
  const res = await fetch('/api')
  return res.json()
}`
      const result = extractFunctionBody(content, 'fetchData', 'js')
      expect(result).toContain('async function fetchData()')
      expect(result).toContain('await fetch')
    })

    it('extracts const arrow function', () => {
      const content = `export const add = (a, b) => {
  return a + b
}`
      const result = extractFunctionBody(content, 'add', 'js')
      expect(result).toContain('const add')
      expect(result).toContain('return a + b')
    })

    it('extracts class', () => {
      const content = `export class MyClass {
  constructor() {
    this.value = 0
  }
  getValue() {
    return this.value
  }
}`
      const result = extractFunctionBody(content, 'MyClass', 'js')
      expect(result).toContain('class MyClass')
      expect(result).toContain('constructor()')
      expect(result).toContain('getValue()')
    })

    it('handles nested braces', () => {
      const content = `function complex() {
  if (true) {
    const obj = { a: 1, b: { c: 2 } }
  }
  return { done: true }
}`
      const result = extractFunctionBody(content, 'complex', 'js')
      expect(result).toContain('function complex()')
      expect(result).toContain('return { done: true }')
    })

    it('ignores braces in strings', () => {
      const content = `function withStrings() {
  const a = "{ not a brace }"
  const b = '{ also not }'
  return true
}`
      const result = extractFunctionBody(content, 'withStrings', 'js')
      expect(result).toContain('return true')
    })

    it('ignores braces in comments', () => {
      const content = `function withComments() {
  // { comment brace }
  return 1
}`
      const result = extractFunctionBody(content, 'withComments', 'js')
      expect(result).toContain('return 1')
    })

    it('returns null for non-existent function', () => {
      const content = `function foo() {}`
      const result = extractFunctionBody(content, 'bar', 'js')
      expect(result).toBeNull()
    })
  })

  describe('Python', () => {
    it('extracts simple function', () => {
      const content = `def foo():
    return 42`
      const result = extractFunctionBody(content, 'foo', 'py')
      expect(result).toContain('def foo():')
      expect(result).toContain('return 42')
    })

    it('extracts async function', () => {
      const content = `async def fetch_data():
    result = await api.get()
    return result`
      const result = extractFunctionBody(content, 'fetch_data', 'py')
      expect(result).toContain('async def fetch_data()')
      expect(result).toContain('await api.get()')
    })

    it('extracts class', () => {
      const content = `class MyClass:
    def __init__(self):
        self.value = 0

    def get_value(self):
        return self.value`
      const result = extractFunctionBody(content, 'MyClass', 'py')
      expect(result).toContain('class MyClass:')
      expect(result).toContain('def __init__')
      expect(result).toContain('def get_value')
    })

    it('stops at same indentation', () => {
      const content = `def first():
    return 1

def second():
    return 2`
      const result = extractFunctionBody(content, 'first', 'py')
      expect(result).toContain('def first()')
      expect(result).toContain('return 1')
      expect(result).not.toContain('def second')
    })

    it('returns null for non-existent function', () => {
      const content = `def foo():\n    pass`
      const result = extractFunctionBody(content, 'bar', 'py')
      expect(result).toBeNull()
    })
  })

  describe('unsupported languages', () => {
    it('returns null for Go', () => {
      const content = `func main() {}`
      const result = extractFunctionBody(content, 'main', 'go')
      expect(result).toBeNull()
    })
  })
})

describe('extractFunctions', () => {
  it('extracts multiple functions from JS file', () => {
    const file = writeTestFile('multi.js', `
function foo() {
  return 1
}

function bar() {
  return 2
}

function baz() {
  return 3
}
`)
    const result = extractFunctions(file, ['foo', 'bar'])
    expect(Object.keys(result)).toHaveLength(2)
    expect(result.foo).toContain('return 1')
    expect(result.bar).toContain('return 2')
    expect(result.baz).toBeUndefined()
  })

  it('extracts multiple functions from Python file', () => {
    const file = writeTestFile('multi.py', `
def alpha():
    return 'a'

def beta():
    return 'b'
`)
    const result = extractFunctions(file, ['alpha', 'beta'])
    expect(result.alpha).toContain("return 'a'")
    expect(result.beta).toContain("return 'b'")
  })

  it('returns empty object for non-existent file', () => {
    const result = extractFunctions('/nonexistent/file.js', ['foo'])
    expect(result).toEqual({})
  })

  it('skips functions that are not found', () => {
    const file = writeTestFile('partial.js', `
function exists() {
  return true
}
`)
    const result = extractFunctions(file, ['exists', 'missing'])
    expect(result.exists).toBeDefined()
    expect(result.missing).toBeUndefined()
  })
})

describe('getFileContext', () => {
  it('returns full file content for small files', () => {
    const file = writeTestFile('small.js', `
function hello() {
  return 'world'
}
`)
    const result = getFileContext(file)
    expect(result.truncated).toBe(false)
    expect(result.content).toContain("return 'world'")
  })

  it('truncates large files', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`)
    const file = writeTestFile('large.js', lines.join('\n'))
    const result = getFileContext(file)
    expect(result.truncated).toBe(true)
    expect(result.content).toContain('lines omitted')
    expect(result.content).toContain('// line 1')
    expect(result.content).toContain('// line 100')
  })

  it('extracts specific functions when requested', () => {
    const file = writeTestFile('selective.js', `
function wanted() {
  return 'yes'
}

function unwanted() {
  return 'no'
}
`)
    const result = getFileContext(file, ['wanted'])
    expect(result.content).toContain("return 'yes'")
    expect(result.content).not.toContain("return 'no'")
  })

  it('returns full file if requested functions not found', () => {
    const file = writeTestFile('fallback.js', `
function actual() {
  return 1
}
`)
    const result = getFileContext(file, ['nonexistent'])
    expect(result.content).toContain('function actual()')
  })

  it('returns null for non-existent file', () => {
    const result = getFileContext('/nonexistent/file.js')
    expect(result).toBeNull()
  })

  it('handles empty functionNames array as full file', () => {
    const file = writeTestFile('empty-arr.js', `const x = 1`)
    const result = getFileContext(file, [])
    expect(result.content).toContain('const x = 1')
  })
})
