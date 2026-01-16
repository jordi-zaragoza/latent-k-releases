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
  return join(homedir(), '.lk', 'bin')
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

async function updateClaudeHooks(mode) {
  const claudeDir = join(homedir(), '.claude')
  const settingsPath = join(claudeDir, 'settings.json')

  let settings = {}
  try {
    const content = await readFile(settingsPath, 'utf8')
    settings = JSON.parse(content)
  } catch {
    console.log('Claude settings not found. Run: lk setup')
    return false
  }

  const lkBin = '$HOME/.lk/bin/lk'
  const sourcePath = getSourcePath()

  const contextCmd = mode === 'binary'
    ? `LK_INTERNAL=1 ${lkBin} context || true`
    : `LK_DEV=1 node ${sourcePath} context || true`

  const syncCmd = mode === 'binary'
    ? `${lkBin} sync`
    : `LK_DEV=1 node ${sourcePath} sync`

  // Update SessionStart hook
  if (settings.hooks?.SessionStart) {
    settings.hooks.SessionStart = settings.hooks.SessionStart.map(h => {
      if (h.hooks?.some(hh => hh.command?.includes('context'))) {
        return {
          ...h,
          hooks: h.hooks.map(hh => {
            if (hh.command?.includes('context')) {
              return { ...hh, command: contextCmd }
            }
            return hh
          })
        }
      }
      return h
    })
  }

  // Update Stop hook
  if (settings.hooks?.Stop) {
    settings.hooks.Stop = settings.hooks.Stop.map(h => {
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

    if (await updateClaudeHooks(newMode)) {
      console.log(`Switched to: ${newMode}`)
      if (newMode === 'binary') {
        console.log(`Using: ${getBinaryPath()}`)
      } else {
        console.log(`Using: node ${getSourcePath()}`)
      }
    }
    return
  }

  if (action === 'use-source' || action === 'source') {
    await setMode('source')
    if (await updateClaudeHooks('source')) {
      console.log('Switched to: source')
      console.log(`Using: node ${getSourcePath()}`)
    }
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
    if (await updateClaudeHooks('binary')) {
      console.log('Switched to: binary')
      console.log(`Using: ${getBinaryPath()}`)
    }
    return
  }

  console.log('Usage: lk dev [status|toggle|source|binary]')
}
