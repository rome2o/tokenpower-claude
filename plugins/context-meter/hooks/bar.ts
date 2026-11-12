// Pure: the engine's context breakdown to a meter, a meter to bar segments, and pieces to fit a width.
// No engine imports.
import { cleanName, clampTokens, pct } from './guards.ts'

export type Cat = { name: string; tokens: number }

export type Saved = { kind: 'none' } | { kind: 'big' } | { kind: 'ok'; tokens: number }

/** What the band draws. Built from the engine's figures, which are estimates. */
export type MeterData = {
  /** Categories that fill the window now (kind "used"), names cleaned, empty ones left out. */
  used: Cat[]
  /** The tokens the engine keeps back as a compaction buffer. */
  buffer: number
  total: number
  window: number
  /** The engine's own percentage of the window. */
  percent: number
  /** Where auto-compact starts, or null when the engine gave none. */
  threshold: number | null
  /** null when the engine did not say. */
  autoCompact: boolean | null
  /** False when there was no breakdown: one bar from the plain usage figures. */
  detailed: boolean
  costUsd: number | null
  saved: Saved
}

/** The fields of the engine's breakdown that this mod reads. */
export type RawBreakdown = {
  categories?: readonly { name?: unknown; tokens?: unknown; kind?: unknown }[]
  totalTokens?: unknown
  rawMaxTokens?: unknown
  percentage?: unknown
  autoCompactThreshold?: unknown
  isAutoCompactEnabled?: unknown
}

export type RawContext = { tokens?: unknown; window?: unknown; percent?: unknown }

const MAX_CATS = 24

export function meterFromBreakdown(b: RawBreakdown, costUsd: number | null, saved: Saved): MeterData {
  const used: Cat[] = []
  let buffer = 0
  for (const c of (Array.isArray(b.categories) ? b.categories : []).slice(0, 200)) {
    if (!c || typeof c !== 'object') continue
    const tokens = clampTokens(c.tokens)
    if (c.kind === 'used' && tokens > 0) used.push({ name: cleanName(c.name) || 'other', tokens })
    else if (c.kind === 'buffer') buffer += tokens
  }
  // The largest categories first, so the bar and the legend keep the ones that matter.
  used.sort((a, b) => b.tokens - a.tokens)
  used.length = Math.min(used.length, MAX_CATS)
  const usedSum = used.reduce((a, c) => a + c.tokens, 0)
  const total = clampTokens(b.totalTokens) || usedSum
  const threshold = typeof b.autoCompactThreshold === 'number' && Number.isFinite(b.autoCompactThreshold) && b.autoCompactThreshold > 0 ? Math.round(b.autoCompactThreshold) : null
  return {
    used,
    buffer,
    total,
    window: clampTokens(b.rawMaxTokens),
    percent: Math.min(999, Math.max(0, Number.isFinite(b.percentage) ? (b.percentage as number) : 0)),
    threshold,
    autoCompact: typeof b.isAutoCompactEnabled === 'boolean' ? b.isAutoCompactEnabled : null,
    detailed: true,
    costUsd,
    saved,
  }
}

/** No breakdown: one bar from the plain usage figures. */
export function meterFromPlain(c: RawContext, costUsd: number | null, saved: Saved): MeterData {
  const total = clampTokens(c.tokens)
  const window = clampTokens(c.window)
  const percent = typeof c.percent === 'number' && Number.isFinite(c.percent) ? c.percent : pct(total, window)
  return {
    used: total > 0 ? [{ name: 'context', tokens: total }] : [],
    buffer: 0,
    total,
    window,
    percent: Math.min(999, Math.max(0, percent)),
    threshold: null,
    autoCompact: null,
    detailed: false,
    costUsd,
    saved,
  }
}

/** How full the chat is against the compaction point, else against the window. */
export function fillPercent(m: MeterData): number {
  const p = m.threshold !== null ? pct(m.total, m.threshold) : m.percent
  return Math.min(999, Math.max(0, Number.isFinite(p) ? p : 0))
}

export type Seg = { kind: 'used' | 'free' | 'buffer'; name: string; tokens: number; cells: number; index: number }

/**
 * Divide `columns` cells between the used categories, the free space and the buffer.
 * The cells always add up to `columns`. Each used category with tokens gets at least one cell
 * while there are cells enough for them all (else the largest ones get it).
 */
export function buildBar(m: Pick<MeterData, 'used' | 'buffer' | 'window'>, columns: number): Seg[] {
  const n = Number.isFinite(columns) ? Math.min(500, Math.max(0, Math.floor(columns))) : 0
  if (n === 0) return []
  const used = m.used.filter(c => Number.isFinite(c.tokens) && c.tokens > 0)
  const usedSum = used.reduce((a, c) => a + c.tokens, 0)
  const buffer = clampTokens(m.buffer)
  const window = clampTokens(m.window)
  const denom = Math.max(window, usedSum + buffer)
  const items: Seg[] = used.map((c, i) => ({ kind: 'used', name: c.name, tokens: c.tokens, cells: 0, index: i }))
  const free = Math.max(0, denom - usedSum - buffer)
  items.push({ kind: 'free', name: 'free', tokens: free, cells: 0, index: used.length })
  items.push({ kind: 'buffer', name: 'buffer', tokens: buffer, cells: 0, index: used.length + 1 })
  const W = items.reduce((a, s) => a + s.tokens, 0)
  if (W <= 0) return [{ kind: 'free', name: 'free', tokens: 0, cells: n, index: 0 }]

  const exact = items.map(s => (s.tokens / W) * n)
  const cells = exact.map(x => Math.floor(x))
  // At most n used categories can hold the one-cell minimum; the largest ones win.
  const wanted = items
    .map((s, i) => ({ s, i }))
    .filter(x => x.s.kind === 'used' && x.s.tokens > 0)
    .sort((a, b) => b.s.tokens - a.s.tokens)
    .slice(0, n)
  const min = items.map(() => 0)
  for (const x of wanted) {
    min[x.i] = 1
    if ((cells[x.i] ?? 0) < 1) cells[x.i] = 1
  }
  let sum = cells.reduce((a, c) => a + c, 0)
  for (let guard = 0; sum > n && guard < 10_000; guard++) {
    let at = -1
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] ?? 0
      if (c > (min[i] ?? 0) && (at < 0 || c > (cells[at] ?? 0))) at = i
    }
    if (at < 0) break
    cells[at] = (cells[at] ?? 0) - 1
    sum -= 1
  }
  for (let guard = 0; sum < n && guard < 10_000; guard++) {
    let at = -1
    let best = -1
    for (let i = 0; i < cells.length; i++) {
      if ((items[i]?.tokens ?? 0) <= 0) continue
      const frac = (exact[i] ?? 0) - (cells[i] ?? 0)
      if (frac > best) {
        best = frac
        at = i
      }
    }
    if (at < 0) break
    cells[at] = (cells[at] ?? 0) + 1
    sum += 1
  }
  return items.map((s, i) => ({ ...s, cells: cells[i] ?? 0 })).filter(s => s.cells > 0)
}

/** One piece of the line under the bar. A lower `keep` goes first when the line is too wide; on a tie the right-most goes. */
export type Piece = { id: string; text: string; keep: number }

/** Drop whole pieces until the line (pieces and one-space gaps of `gap`) fits `columns`. */
export function fitPieces<T extends Piece>(pieces: T[], columns: number, gap = 2): T[] {
  const cols = Number.isFinite(columns) ? Math.max(0, Math.floor(columns)) : 0
  const out = pieces.filter(p => p.text.length > 0)
  const width = (xs: T[]) => xs.reduce((a, p) => a + Array.from(p.text).length, 0) + gap * Math.max(0, xs.length - 1)
  while (width(out) > cols && out.length > 0) {
    let at = 0
    for (let i = 1; i < out.length; i++) {
      if ((out[i]?.keep ?? 0) <= (out[at]?.keep ?? 0)) at = i
    }
    out.splice(at, 1)
  }
  return out
}
