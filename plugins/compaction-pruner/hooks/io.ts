import type { EngineInterface } from 'claude-code'

import type { Mode } from '../types'

import { DEFAULT_MODE, STORE_SUBPATH } from './constants.ts'
import { cleanLine, isSafeStorePath } from './guards.ts'
import { S } from './state.ts'

// The Claude home folder: what comes before /.claude/ in this plugin's own path. Empty when it is not there.
export function homeOf($: EngineInterface): string {
  const i = $.plugin.root.indexOf('/.claude/')
  return i > 0 ? $.plugin.root.slice(0, i) : ''
}

export async function readMode($: EngineInterface): Promise<Mode> {
  try {
    const v = await $.store.get('mode')
    return v === 'dry' || v === 'live' || v === 'off' ? v : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

export async function writeMode($: EngineInterface, mode: Mode) {
  S.mode = mode
  await $.store.set('mode', mode)
}

// Errors are appended to ~/.claude/mods-logs/compaction-pruner/pruner.log (inside the store, so one guard covers every write).
// The log keeps its newest 20,000 characters and never holds tool text. Each line is one clean line of at most 200 characters.
// Writes run one after another, so two hooks at once do not drop each other's lines.
let queue: Promise<void> = Promise.resolve()

export function log($: EngineInterface, text: string): Promise<void> {
  queue = queue.then(() => append($, text))
  return queue
}

async function append($: EngineInterface, text: string) {
  try {
    const path = `${S.home}/${STORE_SUBPATH}/pruner.log`
    if (!isSafeStorePath(path, S.home)) return
    let old = ''
    try {
      old = String(await $.fs.read(path))
    } catch {
      old = ''
    }
    const at = new Date(await $.clock.now()).toISOString()
    const line = cleanLine(text).replace(/[\r\n]+/g, ' ').slice(0, 200)
    await $.fs.write(path, `${old}${at} ${line}\n`.slice(-20_000))
  } catch {
    // Logging must never break a compaction.
  }
}
