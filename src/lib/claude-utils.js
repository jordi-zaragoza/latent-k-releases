import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Get Claude user email from ~/.claude.json
 * @returns {string|null} Email address or null if not found
 */
export function getClaudeUserEmail() {
  try {
    const claudeConfigPath = join(homedir(), '.claude.json')
    if (!existsSync(claudeConfigPath)) return null
    const config = JSON.parse(readFileSync(claudeConfigPath, 'utf8'))
    return config.oauthAccount?.emailAddress || null
  } catch {
    return null
  }
}
