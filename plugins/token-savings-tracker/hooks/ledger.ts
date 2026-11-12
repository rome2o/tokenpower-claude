import type { Helper, Row, Totals } from '../types'

import type { Found, Parsed, RowsOut } from './types.ts'
import { MAX_ROWS } from './constants.ts'
import { cacheOf, hash, laterRequests, localDay, num, obj, priceOf, str } from './pure.ts'
import { fmt, secs } from './format.ts'

/** helper.calls: one {in, out} per request. Anything short of a full, valid list is ignored. */
export function toCalls(v: unknown): Helper['calls'] {
  if (!Array.isArray(v) || v.length === 0) return undefined
  const calls: NonNullable<Helper['calls']> = []
  for (const c of v) {
    const o = obj(c)
    const i = o ? num(o.in) : null
    const out = o ? num(o.out) : null
    if (i === null || out === null) return undefined
    calls.push({ in: i, out })
  }
  return calls
}

export function toHelper(v: unknown): Helper | null {
  const o = obj(v)
  if (!o) return null
  const calls = toCalls(o.calls)
  const sum = (k: 'in' | 'out') => calls?.reduce((s, c) => s + c[k], 0) ?? 0
  const h: Helper = { model: str(o.model) || 'unknown', in: num(o.in) ?? sum('in'), out: num(o.out) ?? sum('out') }
  const usd = num(o.usd)
  if (usd !== null) h.usd = usd
  if (calls) h.calls = calls
  return h
}

export function priceHelper(h: Helper | null): { usd: number | null; how: Row['helperPriced'] } {
  if (!h) return { usd: 0, how: 'none' }
  if (h.usd !== undefined) return { usd: h.usd, how: 'bill' }
  const p = priceOf(h.model, 0)
  if (!p) return { usd: null, how: 'unknown' }
  // A list prices each request on its own tier.
  if (h.calls) {
    const usd = h.calls.reduce((s, c) => {
      const q = priceOf(h.model, c.in) ?? p
      return s + c.in * q.in + c.out * q.out
    }, 0)
    return { usd, how: 'list' }
  }
  // A total can add up several requests (read-router and connector-reader cap each one well
  // under 100k tokens), so it gets the short-prompt rate. While the total itself is on that
  // tier, every request was too and the price is exact. Above it, the tier is a guess.
  const exact = priceOf(h.model, h.in)?.in === p.in
  return { usd: h.in * p.in + h.out * p.out, how: exact ? 'list' : 'estimated' }
}

// Subagent Model Router (once Jev Model Router) saves dollars, not tokens: cost_usd.saved, below 0 when a task went to a dearer model.
export function toUsd(v: unknown): Row['usd'] {
  const o = obj(v)
  const saved = o ? num(o.saved) : null
  return o && saved !== null ? { before: num(o.before), after: num(o.after), saved } : null
}

// Stably puts effort, baseline and time under "stably".
export function stablyExtra(o: Record<string, unknown>) {
  const baseline = str(o.baseline)
  const msBefore = num(o.ms_before)
  const msAfter = num(o.ms_after)
  return [
    str(o.effort) ? `Effort ${str(o.effort)}` : '',
    baseline === 'none' ? 'no baseline yet, so 0 counted' : baseline ? `baseline: ${baseline}` : '',
    msAfter === null ? '' : msBefore === null ? secs(msAfter) : `${secs(msBefore)} to ${secs(msAfter)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * A before no one tool result can have, so most likely a counting bug in the mod that logged it.
 * Claude cuts a tool result near 25,000 tokens. A cache hit (after 0) is never caught by the ratio.
 */
export function implausible(before: number, after: number): string {
  if (before > 500_000) return `before ${fmt(before)} is over 500,000 tokens`
  if (after > 0 && before > 100_000 && before / after > 1000) return `${fmt(before)} to ${fmt(after)} is over a 1,000x cut`
  return ''
}

export function toRow(j: unknown, raw: string): Row | null {
  const o = obj(j)
  if (!o) return null
  const before = num(o.before)
  const after = num(o.after)
  if (before === null || after === null) return null
  const ts = str(o.ts)
  const ms = Date.parse(ts)
  if (!Number.isFinite(ms)) return null
  const helper = toHelper(o.helper)
  const priced = priceHelper(helper)
  const id = str(o.tool_use_id)
  const usd = toUsd(o.cost_usd)
  const stably = obj(o.stably)
  // Stably's before and after are output tokens, so they cost the output price.
  const tokenKind: Row['tokenKind'] = stably || o.tokens === 'output' ? 'output' : 'input'
  const saved = before - after
  // valueRow prices the token rows, once the chat transcripts are read.
  const valueUsd = usd ? usd.saved : null
  return {
    key: hash(raw),
    ts,
    ms,
    session: str(o.session),
    toolUseId: id || null,
    mod: str(o.mod) || 'unknown',
    part: str(o.part),
    action: str(o.action),
    before,
    after,
    saved,
    tokenKind,
    usd,
    valueUsd,
    cache: null,
    leftOut: usd ? '' : implausible(before, after),
    extra: stably ? stablyExtra(stably) : '',
    helper,
    helperUsd: priced.usd,
    helperPriced: priced.how,
    measured: o.measured === 'real' ? 'real' : 'estimated',
    detail: str(o.detail),
  }
}

export function emptyTotals(): Totals {
  return { actions: 0, before: 0, after: 0, saved: 0, real: 0, estimated: 0, helperUsd: 0, usdSaved: 0, usdActions: 0, value: 0, unpriced: 0, leftOut: 0, chats: 0 }
}

export function add(t: Totals, r: Row) {
  if (r.leftOut) {
    t.leftOut += 1
    return
  }
  t.actions += 1
  // A dollar row's tokens are the same either way, and a line that changed nothing claims
  // nothing: neither goes in "before to after", so it shows only the tokens the mods cut.
  if (!r.usd && r.before !== r.after) {
    t.before += r.before
    t.after += r.after
    t.saved += r.saved
  }
  if (r.measured === 'real') t.real += 1
  else t.estimated += 1
  if (r.helperUsd !== null) t.helperUsd += r.helperUsd
  if (r.usd) {
    t.usdSaved += r.usd.saved
    t.usdActions += 1
  }
  if (r.valueUsd !== null) t.value += r.valueUsd
  if (r.valueUsd === null || r.helperPriced === 'unknown') t.unpriced += 1
}

/**
 * Turns the ledger's text into counted rows, not priced yet.
 * A tool_use_id counts once across the whole file: a later "real" line replaces an
 * "estimated" one, any other repeat is dropped. A null id is never matched by id,
 * only an exact repeat of the same line is dropped.
 */
export function parseRows(text: string): RowsOut {
  const kept: Row[] = []
  const byId = new Map<string, number>()
  const seen = new Set<string>()
  let skipped = 0
  let dropped = 0
  for (const rawLine of text.split('\n')) {
    const raw = rawLine.trim()
    if (!raw) continue
    let j: unknown
    try {
      j = JSON.parse(raw)
    } catch {
      skipped += 1
      continue
    }
    const row = toRow(j, raw)
    if (!row) {
      skipped += 1
      continue
    }
    if (row.toolUseId) {
      const at = byId.get(row.toolUseId)
      if (at !== undefined) {
        dropped += 1
        if (kept[at]?.measured !== 'real' && row.measured === 'real') kept[at] = row
        continue
      }
      byId.set(row.toolUseId, kept.length)
    } else {
      if (seen.has(raw)) {
        dropped += 1
        continue
      }
      seen.add(raw)
    }
    kept.push(row)
  }
  return { kept, skipped, dropped }
}

/**
 * Dollars for a token row. A saved output token costs the output price once.
 * A saved input token would have been written to the prompt cache once, then read again by
 * every later request of that chat until a compaction: 1 write + (requests - 1) reads.
 */
export function valueRow(r: Row, mainModel: string, found: Found): Row {
  if (r.usd || r.leftOut) return r
  if (r.tokenKind === 'output') {
    const p = priceOf(mainModel, 0)
    return { ...r, valueUsd: p ? r.saved * p.out : null }
  }
  const later = typeof found === 'object' ? laterRequests(found, r.ms) : { n: 0, model: '' }
  const model = later.model || mainModel
  const c = cacheOf(model)
  if (!c) return { ...r, valueUsd: null }
  const how = typeof found === 'object' ? 'chat' : found
  const valueUsd = r.saved * (c.write + c.read * Math.max(0, later.n - 1))
  return { ...r, valueUsd, cache: { how, requests: later.n, model } }
}

/** Sessions whose transcript prices a row: counted input-token rows only. */
export function wantedChats(kept: Row[]): string[] {
  const newest = new Map<string, number>()
  for (const r of kept) {
    if (r.usd || r.leftOut || r.tokenKind === 'output' || !r.session || r.before === r.after) continue
    newest.set(r.session, Math.max(newest.get(r.session) ?? 0, r.ms))
  }
  return [...newest.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
}

export function summarize(kept: Row[], chatId: string, day: string): Pick<Parsed, 'rows' | 'today' | 'chat' | 'all'> {
  const today = emptyTotals()
  const chat = emptyTotals()
  const all = emptyTotals()
  const chats = { today: new Set<string>(), chat: new Set<string>(), all: new Set<string>() }
  for (const r of kept) {
    add(all, r)
    if (!r.leftOut) chats.all.add(r.session)
    if (localDay(r.ms) === day) {
      add(today, r)
      if (!r.leftOut) chats.today.add(r.session)
    }
    if (chatId && r.session === chatId) {
      add(chat, r)
      if (!r.leftOut) chats.chat.add(r.session)
    }
  }
  today.chats = chats.today.size
  chat.chats = chats.chat.size
  all.chats = chats.all.size
  const rows = [...kept].sort((a, b) => b.ms - a.ms).slice(0, MAX_ROWS)
  return { rows, today, chat, all }
}
