import { atom, read, update } from 'claude-code'
import type { EngineInterface, SessionContextUsage, SessionCost } from 'claude-code'

import type { Compaction, Ledger, Live } from '../types'

import { DETAIL_CHARS, EMPTY_VIEW, HIDE_KEY, NAME, PANE } from './constants.ts'
import { fired, S } from './state.ts'

const ledgerAtom = atom({ plugin: 'token-savings-tracker', key: 'ledger' } as const, null, { shape: 'ledger-5' })
const liveAtom = atom({ plugin: 'token-savings-tracker', key: 'live' } as const, null, { shape: 'live-1' })
const compactAtom = atom({ plugin: 'token-savings-tracker', key: 'compactions' } as const, [], { shape: 'compactions-1' })
const viewAtom = atom({ plugin: 'token-savings-tracker', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-1' })

export function switchesPath($: EngineInterface) {
  return `${$.plugin.root.split('/.claude/')[0] ?? ''}/.claude/mods/switches.json`
}
export const ledgerPath = () => `${S.home}/.claude/mods-logs/savings.jsonl`
export const samplePath = () => `${S.root}/test/sample-savings.jsonl`
export const tilde = (p: string) => (S.home && p.startsWith(S.home) ? `~${p.slice(S.home.length)}` : p)

export async function readSwitches($: EngineInterface): Promise<Record<string, unknown>> {
  const path = switchesPath($)
  if (!(await $.fs.exists(path))) return {}
  const json = JSON.parse(String(await $.fs.read(path))) as unknown
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {}
}

export async function readSwitch($: EngineInterface) {
  let now = false
  let nowHidden = false
  try {
    const json = await readSwitches($)
    now = json[NAME] === false
    nowHidden = json[HIDE_KEY] === true
  } catch {
    now = S.off
    nowHidden = S.hidden
  }
  if (nowHidden && !S.hidden) await $.ui.close({ id: PANE }).catch(() => undefined)
  S.hidden = nowHidden
  if (now === S.off) return
  S.off = now
  if (!S.off) S.lastSig = ''
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

// Read, change, write the whole file, so every chat sees the choice within 3 s.
export async function setHidden($: EngineInterface, value: boolean) {
  try {
    const json = await readSwitches($)
    if (value) json[HIDE_KEY] = true
    else delete json[HIDE_KEY]
    await $.fs.write(switchesPath($), `${JSON.stringify(json, null, 2)}\n`)
  } catch (err) {
    await log($, `save hidden failed: ${String(err instanceof Error ? err.message : err)}`)
  }
  S.hidden = value
  if (value) await $.ui.close({ id: PANE }).catch(() => undefined)
}

// Errors are appended to ~/.claude/mods-logs/token-savings-tracker.log, so a failure is never silent.
export async function log($: EngineInterface, text: string) {
  try {
    const path = `${S.home}/.claude/mods-logs/token-savings-tracker.log`
    let old = ''
    try {
      old = String(await $.fs.read(path))
    } catch {
      old = ''
    }
    const at = new Date(await $.clock.now()).toISOString()
    await $.fs.write(path, `${old}${at} ${text}\n`)
  } catch {
    // Logging must never break the pane.
  }
}

export async function setLedger($: EngineInterface, value: Ledger) {
  await update($, ledgerAtom, () => value)
}

export async function setLive($: EngineInterface, context: SessionContextUsage, cost: SessionCost | undefined) {
  const next: Live = {
    tokens: context.tokens ?? null,
    window: context.window,
    percent: context.percent ?? null,
    usd: cost?.usd ?? null,
  }
  const now = await read($, liveAtom)
  if (JSON.stringify(now) === JSON.stringify(next)) return
  await update($, liveAtom, () => next)
}

export async function readLive($: EngineInterface) {
  try {
    const u = await $.session.usage()
    await setLive($, u.context, u.cost)
  } catch (err) {
    await log($, `session.usage failed: ${String(err instanceof Error ? err.message : err)}`)
  }
}

export async function firstFire($: EngineInterface, hook: string) {
  if (fired.has(hook)) return
  fired.add(hook)
  await log($, `${hook} fired (session ${S.sid || 'unknown'})`)
}

export async function addCompaction($: EngineInterface, c: Compaction) {
  S.lastCompactAt = c.at
  await update($, compactAtom, list => [...list, c].slice(-20))
}

// session.measure fires after each main-chat turn. A big drop in the context size
// is a compaction the session.compact hook did not see (that hook is blocked on desktop).
export async function onMeasure($: EngineInterface, context: SessionContextUsage, cost: SessionCost | undefined) {
  const cur = context.tokens ?? null
  if (cur !== null && S.prevTokens !== null) {
    const drop = S.prevTokens - cur
    const now = await $.clock.now()
    if (drop >= 10_000 && cur < S.prevTokens * 0.7 && now - S.lastCompactAt > 60_000) {
      await addCompaction($, { at: now, before: S.prevTokens, after: cur, source: 'measure' })
    }
  }
  if (cur !== null) S.prevTokens = cur
  await setLive($, context, cost)
}

// A detail path is data another mod wrote: open only a file that sits under ~/.claude/mods-logs/.
export async function safeDetailPath($: EngineInterface, p: string): Promise<string | null> {
  const full = p.startsWith('~/') ? `${S.home}${p.slice(1)}` : p
  const dir = `${S.home}/.claude/mods-logs/`
  if (!S.home || !full.startsWith(dir) || full.split('/').includes('..')) return null
  try {
    const st = await $.fs.stat(full, { resolve: true })
    if (st.kind !== 'file') return null
    if (st.realPath && !st.realPath.includes('/.claude/mods-logs/')) return null
    return full
  } catch {
    return null
  }
}

export async function toggleDetail($: EngineInterface, key: string) {
  const v = await read($, viewAtom)
  if (v.open === key) {
    await update($, viewAtom, x => ({ ...x, open: '', detail: '', detailError: '' }))
    return
  }
  const row = (await read($, ledgerAtom))?.rows.find(r => r.key === key)
  if (!row) return
  if (!row.detail) {
    await update($, viewAtom, x => ({ ...x, open: key, detail: '', detailError: 'This action has no detail file.' }))
    return
  }
  const path = await safeDetailPath($, row.detail)
  if (!path) {
    await update($, viewAtom, x => ({ ...x, open: key, detail: '', detailError: `Not found under ~/.claude/mods-logs: ${row.detail}` }))
    return
  }
  let text = ''
  try {
    text = String(await $.fs.read(path))
  } catch (err) {
    await log($, `read detail failed: ${String(err instanceof Error ? err.message : err)}`)
    await update($, viewAtom, x => ({ ...x, open: key, detail: '', detailError: 'Could not read the detail file.' }))
    return
  }
  const shown = text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS)}\n\n… (open the file for the rest)` : text
  await update($, viewAtom, x => ({ ...x, open: key, detail: shown, detailError: '' }))
}

export async function openFile($: EngineInterface, key: string) {
  const row = (await read($, ledgerAtom))?.rows.find(r => r.key === key)
  const path = row?.detail ? await safeDetailPath($, row.detail) : null
  let note = 'The detail file is missing.'
  if (path) {
    try {
      const r = await $.process.run(['open', '-t', path])
      note = r.exitCode === 0 ? `Opened ${tilde(path)}` : 'Could not open the file.'
      if (r.exitCode !== 0) await log($, `open exited ${r.exitCode}: ${r.stderr.trim()}`)
    } catch (err) {
      note = 'Could not open the file.'
      await log($, `open failed: ${String(err instanceof Error ? err.message : err)}`)
    }
  }
  await update($, viewAtom, x => ({ ...x, note }))
}
