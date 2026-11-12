import type { EngineInterface } from 'claude-code'

import { HIDE_KEY, NAME } from './constants.ts'
import { S } from './state.ts'

// The /mods switchboard: one exists and one read of one file, booleans only.
// "mcp-schema-auditor": false turns the mod off; "mcp-schema-auditor:hidden": true hides its pane.
export async function readSwitch($: EngineInterface): Promise<void> {
  try {
    // No home under ~/.claude/ means no file is read.
    if (!S.home) {
      S.off = false
      S.hidden = false
      return
    }
    const path = `${S.home}/.claude/mods/switches.json`
    if (!(await $.fs.exists(path))) {
      S.off = false
      S.hidden = false
      return
    }
    const json = JSON.parse(String(await $.fs.read(path))) as unknown
    const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
    S.off = o[NAME] === false
    S.hidden = o[HIDE_KEY] === true
  } catch {
    // A broken file changes nothing.
  }
}
