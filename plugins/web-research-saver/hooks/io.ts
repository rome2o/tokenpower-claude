import { S } from './state.ts'
import type { EngineInterface } from 'claude-code'

export const logsDir = () => `${S.home}/.claude/mods-logs`

export const notesDir = () => `${S.home}/.claude/mods-logs/web-research-saver`

// A true append: many mods write the ledger, so a read and rewrite would drop their lines.
export async function append($: EngineInterface, path: string, text: string) {
  const r = await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', path], { stdin: text, timeoutMs: 10_000 })
  if (r.exitCode !== 0) throw new Error(`append to ${path} failed: ${r.stderr.slice(0, 200)}`)
}

export async function log($: EngineInterface, what: string, detail: unknown) {
  try {
    const msg = detail instanceof Error ? detail.message : String(detail)
    await append($, `${logsDir()}/web-research-saver.log`, `${new Date(await $.clock.now()).toISOString()} ${what}: ${msg}\n`)
  } catch {
    // Nowhere left to report it.
  }
}

export async function exists($: EngineInterface, path: string) {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

// Rejects with `what` when the promise gives no answer in `ms`.
export async function withTimeout<T>($: EngineInterface, p: Promise<T>, ms: number, what: string): Promise<T> {
  const box: { timer?: { cancel: () => void } } = {}
  const late = new Promise<never>((_, reject) => {
    box.timer = $.clock.after(ms, () => reject(new Error(`${what} gave no answer in ${ms / 1000} s`)))
  })
  try {
    return await Promise.race([p, late])
  } finally {
    box.timer?.cancel()
  }
}
