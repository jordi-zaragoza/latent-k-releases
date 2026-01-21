import { existsSync, createWriteStream, unlinkSync, chmodSync, accessSync, constants, mkdirSync, renameSync } from 'fs'
import { dirname } from 'path'
import { platform, arch } from 'os'
import { randomBytes } from 'crypto'
import https from 'https'
import { VERSION } from '../lib/version.js'
const HTTP_TIMEOUT_MS = 30000  // 30 seconds timeout for HTTP requests
const GITHUB_REPO = 'jordi-zaragoza/latent-k-releases'
const LK_BIN_PATH = '/usr/local/bin/lk'
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
const MIN_VERSION_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/min_version`
function canWrite(path) {
  try {
    accessSync(dirname(path), constants.W_OK)
    return true
  } catch {
    return false
  }
}
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'lk' },
      timeout: HTTP_TIMEOUT_MS
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return fetchText(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode === 404) {
        resolve(null)
        return
      }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data.trim()))
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
  })
}
function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
  }
  return 0
}
export async function checkMinVersion() {
  try {
    const minVersion = await fetchText(MIN_VERSION_URL)
    if (!minVersion) return { ok: true }
    if (compareVersions(VERSION, minVersion) < 0) {
      return { ok: false, minVersion, currentVersion: VERSION }
    }
    return { ok: true }
  } catch {
    // Si falla la verificación, permitir continuar
    return { ok: true }
  }
}
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'lk' },
      timeout: HTTP_TIMEOUT_MS
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject)
      }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('Invalid JSON response'))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
  })
}
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    let file
    try {
      file = createWriteStream(dest)
    } catch (err) {
      if (err.code === 'EACCES') {
        reject(new Error('PERMISSION_DENIED'))
      } else {
        reject(err)
      }
      return
    }
    file.on('error', (err) => {
      if (err.code === 'EACCES') {
        reject(new Error('PERMISSION_DENIED'))
      } else {
        reject(err)
      }
    })
    const request = (url) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'lk',
          'Accept': 'application/octet-stream'
        },
        timeout: HTTP_TIMEOUT_MS
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
      })
      req.on('error', (err) => {
        try { unlinkSync(dest) } catch {}
        reject(err)
      })
      req.on('timeout', () => {
        req.destroy()
        try { unlinkSync(dest) } catch {}
        reject(new Error('Download timed out'))
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
export async function update(options = {}) {
  const { force } = options
  console.log('Checking for updates...\n')
  try {
    const release = await fetchJSON(RELEASES_URL)
    if (!release || !release.tag_name) {
      console.log('No releases found.')
      return
    }
    const latestVersion = release.tag_name.replace(/^v/, '')
    console.log(`Current version: ${VERSION}`)
    console.log(`Latest version:  ${latestVersion}`)
    if (VERSION === latestVersion && !force) {
      console.log('\nAlready up to date!')
      return
    }
    if (VERSION === latestVersion && force) {
      console.log('\nForcing reinstall...')
    }
    const asset = getPlatformAsset(release.assets)
    if (!asset) {
      console.error(`\n✗ No binary available for your platform (${platform()}-${arch()})`)
      process.exit(1)
    }
    const binaryPath = LK_BIN_PATH
    // Use random suffix to prevent TOCTOU attacks
    const randomSuffix = randomBytes(8).toString('hex')
    const tempPath = `${binaryPath}.new.${randomSuffix}`
    const backupPath = `${binaryPath}.backup.${randomSuffix}`
    // Ensure /usr/local/bin directory exists
    const binDir = dirname(binaryPath)
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true })
    }
    // Check permissions before downloading
    if (!canWrite(binaryPath)) {
      console.log('\nPermission denied writing to:', binaryPath)
      process.exit(1)
    }
    console.log(`\nDownloading ${asset.name}...`)
    try {
      await downloadFile(asset.browser_download_url, tempPath)
    } catch (err) {
      if (err.message === 'PERMISSION_DENIED') {
        console.log('\n\nPermission denied. Run with sudo:')
        console.log('  sudo lk update')
        process.exit(1)
      }
      throw err
    }
    if (platform() !== 'win32') {
      chmodSync(tempPath, 0o755)
    }
    console.log('Installing...')
    try {
      if (existsSync(backupPath)) unlinkSync(backupPath)
      // Use fs.renameSync instead of execSync to avoid command injection
      renameSync(binaryPath, backupPath)
      renameSync(tempPath, binaryPath)
      // Clean up backup after successful install
      try { unlinkSync(backupPath) } catch {}
      console.log('\nUpdate complete!')
      console.log(`Updated to version ${latestVersion}`)
    } catch (err) {
      // Try to restore backup if rename failed
      if (existsSync(backupPath) && !existsSync(binaryPath)) {
        try { renameSync(backupPath, binaryPath) } catch {}
      }
      console.log('\nPermission denied. Run with sudo:')
      console.log('  sudo lk update')
      try { unlinkSync(tempPath) } catch {}
      process.exit(1)
    }
  } catch (err) {
    console.error(`✗ Update failed: ${err.message}`)
    process.exit(1)
  }
}