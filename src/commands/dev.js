import { readFile, writeFile, mkdir, chmod, access, constants } from 'fs/promises'
import { existsSync, createWriteStream, unlinkSync } from 'fs'
import { homedir, platform } from 'os'
import { join, dirname } from 'path'
import https from 'https'

const MODE_FILE = '.lk-mode'
const GITHUB_REPO = 'jordi-zaragoza/latent-k-releases'
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

function getProjectRoot() {
  return process.cwd()
}

function getModeFilePath() {
  return join(getProjectRoot(), MODE_FILE)
}

function getBinaryDir() {
  return '/usr/local/bin'
}

function getBinaryPath() {
  const ext = platform() === 'win32' ? '.exe' : ''
  return join(getBinaryDir(), `lk${ext}`)
}

function getSourcePath() {
  return join(getProjectRoot(), 'src', 'cli.js')
}

async function getCurrentMode() {
  try {
    const content = await readFile(getModeFilePath(), 'utf8')
    return content.trim() === 'binary' ? 'binary' : 'source'
  } catch {
    return 'source' // default to source
  }
}

async function setMode(mode) {
  await writeFile(getModeFilePath(), mode)
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'lk' }
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject)
      }

      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Invalid JSON response'))
        }
      })
    }).on('error', reject)
  })
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)

    file.on('error', reject)

    const request = (url) => {
      https.get(url, {
        headers: {
          'User-Agent': 'lk',
          'Accept': 'application/octet-stream'
        }
      }, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return request(res.headers.location)
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`))
          return
        }

        const total = parseInt(res.headers['content-length'], 10)
        let downloaded = 0

        res.on('data', (chunk) => {
          downloaded += chunk.length
          const pct = total ? Math.round(downloaded / total * 100) : 0
          process.stdout.write(`\rDownloading... ${pct}%`)
        })

        res.pipe(file)

        file.on('finish', () => {
          file.close()
          console.log('\rDownloading... done')
          resolve()
        })
      }).on('error', (err) => {
        try { unlinkSync(dest) } catch {}
        reject(err)
      })
    }

    request(url)
  })
}

function getPlatformAsset(assets) {
  const p = platform()

  let target
  if (p === 'darwin') {
    target = 'macos'
  } else if (p === 'win32') {
    target = 'win'
  } else {
    target = 'linux'
  }

  return assets.find(asset => {
    const name = asset.name.toLowerCase()
    return name.includes(target) && !name.endsWith('.sh')
  })
}

async function ensureBinary() {
  const binaryPath = getBinaryPath()

  if (existsSync(binaryPath)) {
    return binaryPath
  }

  console.log('Binary not found. Downloading...\n')

  const release = await fetchJSON(RELEASES_URL)
  if (!release || !release.tag_name) {
    throw new Error('No releases found')
  }

  const asset = getPlatformAsset(release.assets)
  if (!asset) {
    throw new Error(`No binary available for ${platform()}`)
  }

  await mkdir(getBinaryDir(), { recursive: true })
  await downloadFile(asset.browser_download_url, binaryPath)

  if (platform() !== 'win32') {
    await chmod(binaryPath, 0o755)
  }

  console.log(`Installed: ${binaryPath}\n`)
  return binaryPath
}

function getHookCommands(mode) {
  const lkBin = '/usr/local/bin/lk'
  const sourcePath = getSourcePath()

  const expandCmd = mode === 'binary'
    ? `${lkBin} expand || true`
    : `node ${sourcePath} expand || true`

  const syncCmd = mode === 'binary'
    ? `${lkBin} sync`
    : `node ${sourcePath} sync`

  const sessionCmd = mode === 'binary'
    ? `${lkBin} session-info || true`
    : `node ${sourcePath} session-info || true`

  return { expandCmd, syncCmd, sessionCmd }
}

function isLkExpandHook(command) {
  if (!command) return false
  const isLk = /\blk\b/.test(command) || command.includes('cli.js')
  return isLk && (command.includes('expand') || command.includes('context'))
}

function updateHooksInSettings(settings, stopEvent, expandCmd, syncCmd, sessionCmd) {
  // Update UserPromptSubmit hook (expand on every prompt)
  if (settings.hooks?.UserPromptSubmit) {
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.map(h => {
      if (h.hooks?.some(hh => isLkExpandHook(hh.command))) {
        return {
          ...h,
          hooks: h.hooks.map(hh => {
            if (isLkExpandHook(hh.command)) {
              return { ...hh, command: expandCmd }
            }
            return hh
          })
        }
      }
      return h
    })
  }

  // Update SessionStart hooks: session-info and remove legacy expand/context hooks
  if (settings.hooks?.SessionStart) {
    // Update session-info hooks
    settings.hooks.SessionStart = settings.hooks.SessionStart.map(h => {
      if (h.hooks?.some(hh => hh.command?.includes('session-info'))) {
        return {
          ...h,
          hooks: h.hooks.map(hh => {
            if (hh.command?.includes('session-info')) {
              return { ...hh, command: sessionCmd }
            }
            return hh
          })
        }
      }
      return h
    })
    // Remove legacy expand/context hooks from SessionStart (they should be in UserPromptSubmit now)
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(h =>
      !h.hooks?.some(hh => isLkExpandHook(hh.command) && !hh.command?.includes('session-info'))
    )
    if (settings.hooks.SessionStart.length === 0) {
      delete settings.hooks.SessionStart
    }
  }

  // Update stop hook (Stop for Claude, SessionEnd for Gemini)
  if (settings.hooks?.[stopEvent]) {
    settings.hooks[stopEvent] = settings.hooks[stopEvent].map(h => {
      if (h.hooks?.some(hh => hh.command?.includes('sync'))) {
        return {
          ...h,
          hooks: h.hooks.map(hh => {
            if (hh.command?.includes('sync')) {
              return { ...hh, command: syncCmd }
            }
            return hh
          })
        }
      }
      return h
    })
  }

  return settings
}

async function updateClaudeHooks(mode) {
  const settingsPath = join(homedir(), '.claude', 'settings.json')

  let settings = {}
  try {
    const content = await readFile(settingsPath, 'utf8')
    settings = JSON.parse(content)
  } catch {
    return false
  }

  const { expandCmd, syncCmd, sessionCmd } = getHookCommands(mode)
  settings = updateHooksInSettings(settings, 'Stop', expandCmd, syncCmd, sessionCmd)

  await writeFile(settingsPath, JSON.stringify(settings, null, 2))
  return true
}

async function updateGeminiHooks(mode) {
  const settingsPath = join(homedir(), '.gemini', 'settings.json')

  let settings = {}
  try {
    const content = await readFile(settingsPath, 'utf8')
    settings = JSON.parse(content)
  } catch {
    return false
  }

  const { expandCmd, syncCmd, sessionCmd } = getHookCommands(mode)
  settings = updateHooksInSettings(settings, 'SessionEnd', expandCmd, syncCmd, sessionCmd)

  await writeFile(settingsPath, JSON.stringify(settings, null, 2))
  return true
}

export async function dev(action) {
  const currentMode = await getCurrentMode()

  if (!action || action === 'status') {
    console.log(`Current mode: ${currentMode}`)
    console.log(`Mode file: ${getModeFilePath()}`)
    if (currentMode === 'binary') {
      console.log(`Binary path: ${getBinaryPath()}`)
    } else {
      console.log(`Source path: ${getSourcePath()}`)
    }
    return
  }

  if (action === 'toggle') {
    const newMode = currentMode === 'source' ? 'binary' : 'source'

    if (newMode === 'binary') {
      try {
        await ensureBinary()
      } catch (err) {
        console.error(`✗ Failed to get binary: ${err.message}`)
        return
      }
    }

    await setMode(newMode)

    const claudeUpdated = await updateClaudeHooks(newMode)
    const geminiUpdated = await updateGeminiHooks(newMode)

    if (claudeUpdated || geminiUpdated) {
      console.log(`Switched to: ${newMode}`)
      if (newMode === 'binary') {
        console.log(`Using: ${getBinaryPath()}`)
      } else {
        console.log(`Using: node ${getSourcePath()}`)
      }
      if (claudeUpdated) console.log('✓ Claude hooks updated')
      if (geminiUpdated) console.log('✓ Gemini hooks updated')
    }
    return
  }

  if (action === 'use-source' || action === 'source') {
    await setMode('source')
    const claudeUpdated = await updateClaudeHooks('source')
    const geminiUpdated = await updateGeminiHooks('source')

    console.log('Switched to: source')
    console.log(`Using: node ${getSourcePath()}`)
    if (claudeUpdated) console.log('✓ Claude hooks updated')
    if (geminiUpdated) console.log('✓ Gemini hooks updated')
    return
  }

  if (action === 'use-binary' || action === 'binary') {
    try {
      await ensureBinary()
    } catch (err) {
      console.error(`✗ Failed to get binary: ${err.message}`)
      return
    }

    await setMode('binary')
    const claudeUpdated = await updateClaudeHooks('binary')
    const geminiUpdated = await updateGeminiHooks('binary')

    console.log('Switched to: binary')
    console.log(`Using: ${getBinaryPath()}`)
    if (claudeUpdated) console.log('✓ Claude hooks updated')
    if (geminiUpdated) console.log('✓ Gemini hooks updated')
    return
  }

  console.log('Usage: lk dev [status|toggle|source|binary]')
}
