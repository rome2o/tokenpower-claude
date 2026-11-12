import type { EngineInterface } from 'claude-code'

import { HIDE_KEY, NAME } from './constants.ts'
import { homeOfRoot } from './guards.ts'

export type Switches = { off: boolean; hidden: boolean }

export function switchesPath($: EngineInterface): string {
  const home = homeOfRoot($.plugin.root)
  return home === '' ? '' : `${home}/.claude/mods/switches.json`
}

/**
 * The only file this mod reads: the /mods switchboard. One exists check, one read, booleans only.
 * Returns null when the file is missing, too big (a read over 4 MiB rejects), or not an object: nothing changes then.
 */
export async function readSwitches($: EngineInterface): Promise<Switches | null> {
  try {
    const path = switchesPath($)
    if (path === '') return null
    if (!(await $.fs.exists(path))) return { off: false, hidden: false }
    const json = JSON.parse(String(await $.fs.read(path))) as unknown
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null
    const o = json as Record<string, unknown>
    return { off: o[NAME] === false, hidden: o[HIDE_KEY] === true }
  } catch {
    return null
  }
}
