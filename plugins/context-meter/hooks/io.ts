import type { EngineInterface } from 'claude-code'

import { savedToday, dayKey } from './ledger-read.ts'
import type { Saved } from './bar.ts'
import { isLedgerPath, ledgerPathOf, logPathOf, logText } from './guards.ts'
import { LEDGER_LINES, LEDGER_MAX_BYTES } from './constants.ts'
import { logged, S } from './state.ts'

// Errors are appended to ~/.claude/mods-logs/context-meter.log, so a failure is never silent.
// This is the only place that writes a file, and the only place that touches the ledger.
export async function log($: EngineInterface, text: string) {
  try {
    const path = logPathOf(S.home)
    if (!path) return
    let old = ''
    try {
      old = String(await $.fs.read(path))
    } catch {
      old = ''
    }
    if (old.length > 200_000) old = old.slice(old.length - 100_000)
    const at = new Date(await $.clock.now()).toISOString()
    const line = logText(text)
    await $.fs.write(path, `${old}${at} ${line}\n`)
  } catch {
    // Logging must never break the band.
  }
}

export async function logOnce($: EngineInterface, key: string, text: string) {
  // Keyed by the first 60 characters, so a message with a changing value is still logged once.
  const k = key.slice(0, 60)
  if (logged.has(k)) return
  logged.add(k)
  await log($, text)
}

export function errText(err: unknown): string {
  return String(err instanceof Error ? err.message : err)
}

/**
 * Tokens saved today from the ledger. Read only. Cached by size, modified time and day.
 * A ledger over the size cap is not read: the band says "ledger too large to read" instead.
 */
export async function readSaved($: EngineInterface, now: number): Promise<{ saved: Saved; sig: string }> {
  const path = ledgerPathOf(S.home)
  if (!path || !isLedgerPath(path, S.home)) return { saved: { kind: 'none' }, sig: 'no-home' }
  let st: { kind: string; size: number; mtimeMs: number; isLink: boolean }
  try {
    st = await $.fs.stat(path)
  } catch {
    return { saved: { kind: 'none' }, sig: 'missing' }
  }
  if (st.kind !== 'file' || st.isLink) return { saved: { kind: 'none' }, sig: 'not-a-file' }
  const today = dayKey(now)
  const sig = `${st.size}|${st.mtimeMs}|${today}`
  if (sig === S.ledgerSig) return { saved: S.savedToday, sig }
  if (st.size > LEDGER_MAX_BYTES) return { saved: { kind: 'big' }, sig }
  const text = String(await $.fs.read(path))
  const r = savedToday(text, today, LEDGER_LINES)
  return { saved: { kind: 'ok', tokens: r.tokens }, sig }
}
