import type { EngineInterface } from 'claude-code'

import { HIDE_KEY, NAME } from './constants.ts'
import { switchesPathOf } from './guards.ts'

export type Switches = { off: boolean; hidden: boolean }

// The one read of the /mods switchboard. It looks at two booleans and nothing else in the file.
// Null when the file is missing or unreadable, so the caller keeps what it had.
export async function readSwitches($: EngineInterface, home: string): Promise<Switches | null> {
  const path = switchesPathOf(home)
  if (!path) return null
  try {
    if (!(await $.fs.exists(path))) return { off: false, hidden: false }
    const json = JSON.parse(String(await $.fs.read(path))) as unknown
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { off: false, hidden: false }
    const o = json as Record<string, unknown>
    return { off: o[NAME] === false, hidden: o[HIDE_KEY] === true }
  } catch {
    return null
  }
}
