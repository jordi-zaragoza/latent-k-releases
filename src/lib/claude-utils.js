import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
export function getClaudeUserEmail() {
  try {
    const p = join(homedir(), '.claude.json');
    if (!existsSync(p)) return null;
    const c = JSON.parse(readFileSync(p, 'utf8'));
    return c.oauthAccount?.emailAddress || null;
  } catch { return null }
}