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

// Makes the folder and its parents. The engine's file write is not relied on to do it, as in the other mods. The path is a plain argument, never shell text.
export async function ensureDir($: EngineInterface, dir: string) {
  const r = await $.process.run(['mkdir', '-p', dir], { timeoutMs: 10_000 })
  if (r.exitCode !== 0) throw new Error(`could not create the folder ${tilde(dir)}`)
}

// The command that shows a folder in the file manager, as an argv array (never shell text). Null where there is none:
// a hosted session (the machine is not yours), WSL or an unknown system.
export function openArgv(platform: string | undefined, dir: string, isHosted = false): string[] | null {
  if (isHosted) return null
  if (platform === 'macos') return ['open', dir]
  if (platform === 'linux') return ['xdg-open', dir]
  if (platform === 'windows') return ['explorer', dir]
  return null
}

// Opens the folder in the file manager, making it first if it is missing. Returns a sentence for the person.
export async function openFolder($: EngineInterface, dir: string): Promise<string> {
  let platform: string | undefined
  let hosted = false
  try {
    const info = await $.session.info()
    platform = info.platform
    hosted = info.isHosted === true
  } catch {
    // Unknown system: handled below.
  }
  const argv = openArgv(platform, dir, hosted)
  if (!argv) return `No file manager is available here. The folder is ${tilde(dir)}`
  await ensureDir($, dir)
  try {
    const r = await $.process.run(argv, { timeoutMs: 10_000 })
    // Windows explorer exits 1 even when the folder opened.
    if (r.exitCode === 0 || platform === 'windows') return `Opened ${tilde(dir)}`
  } catch {
    // The command is not installed.
  }
  return `Could not open a file manager. The folder is ${tilde(dir)}`
}

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
    await ensureDir($, `${S.home}/${STORE_SUBPATH}`)
    await $.fs.write(path, `${old}${at} ${cleanLine(text, 200)}\n`.slice(-20_000))
  } catch {
    // Logging must never break a session.
  }
}
