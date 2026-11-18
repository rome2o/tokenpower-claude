import type { EngineInterface } from 'claude-code'

import { STORE_SUBPATH } from './constants.ts'
import { cleanLine, isInside } from './guards.ts'
import { S } from './state.ts'

// The Claude home folder: what comes before /.claude/ in this plugin's own path. Empty when it is not there.
export function homeOf($: EngineInterface): string {
  const i = $.plugin.root.indexOf('/.claude/')
  return i > 0 ? $.plugin.root.slice(0, i) : ''
}

export const tilde = (p: string) => (S.home && p.startsWith(`${S.home}/`) ? `~${p.slice(S.home.length)}` : p)

export function toast($: EngineInterface, text: string) {
  try {
    $.ui.toast(text, { timeoutMs: 8000 })
  } catch {
    // The toast is only a hint.
  }
}

// Errors go to ~/.claude/mods-logs/scratchpad-keeper/keeper.log: newest 20,000 characters, one clean line each, never item text.
// Writes run one after another, so two hooks at once do not drop each other's lines.
let queue: Promise<void> = Promise.resolve()

export function log($: EngineInterface, text: string): Promise<void> {
  queue = queue.then(() => append($, text))
  return queue
}

async function append($: EngineInterface, text: string) {
  try {
    if (!S.home) return
    const path = `${S.home}/${STORE_SUBPATH}/keeper.log`
    if (!isInside(path, `${S.home}/${STORE_SUBPATH}`)) return
    let old = ''
    try {
      old = String(await $.fs.read(path))
    } catch {
      old = ''
    }
    const at = new Date(await $.clock.now()).toISOString()
    await $.fs.write(path, `${old}${at} ${cleanLine(text, 200)}\n`.slice(-20_000))
  } catch {
    // Logging must never break a session.
  }
}
