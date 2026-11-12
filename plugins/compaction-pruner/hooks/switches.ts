import type { EngineInterface } from 'claude-code'

import { NAME } from './constants.ts'
import { S } from './state.ts'

// The one read of the /mods switchboard file in this mod: one exists check and one read, on this exact path.
// Only a plain false under this mod's name counts. An unreadable file counts as off, so a mod that can
// shorten the chat stays quiet when it cannot be sure it is wanted.
export async function isSwitchedOff($: EngineInterface): Promise<boolean> {
  if (!S.home) return false
  const path = `${S.home}/.claude/mods/switches.json`
  try {
    if (!(await $.fs.exists(path))) return false
    const json = JSON.parse(String(await $.fs.read(path))) as unknown
    return !!json && typeof json === 'object' && !Array.isArray(json) && (json as Record<string, unknown>)[NAME] === false
  } catch {
    return true
  }
}
