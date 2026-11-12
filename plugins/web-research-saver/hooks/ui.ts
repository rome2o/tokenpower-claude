import type { EngineInterface } from 'claude-code'
import { S } from './state.ts'
import { PANE, TITLE } from './constants.ts'

// Asked (the command, or Open in /mods) always opens it. On its own it opens only when not hidden and not closed.
export async function openPane($: EngineInterface, asked = false) {
  if (asked) S.closed = false
  else if (S.closed || S.switchHidden) return
  try {
    await $.ui.open({ id: PANE, title: TITLE })
  } catch {
    // The pane is a nicety.
  }
}

export async function closePane($: EngineInterface) {
  try {
    await $.ui.close({ id: PANE })
  } catch {
    // Not open.
  }
}
