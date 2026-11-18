import type { EngineInterface } from 'claude-code'

import { NAME } from './constants.ts'
import { S } from './state.ts'

// The one read of the /mods switchboard file: only a plain false under this mod's name turns it off.
// An unreadable file leaves the mod on: it only copies text, it never changes the chat.
export async function isSwitchedOff($: EngineInterface): Promise<boolean> {
  if (!S.home) return false
  const path = `${S.home}/.claude/mods/switches.json`
  try {
    if (!(await $.fs.exists(path))) return false
    const json = JSON.parse(String(await $.fs.read(path))) as unknown
    return !!json && typeof json === 'object' && !Array.isArray(json) && (json as Record<string, unknown>)[NAME] === false
  } catch {
    return false
  }
}
