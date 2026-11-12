// Pure: the token-savings ledger's text to the tokens saved today. Read only; no engine imports.
// Only the numbers before, after and ts, the id, and the markers that decide whether a line counts
// are read. The detail, helper and session text of a line is never looked at.

/** The local calendar day of a time in ms, as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Kept = { before: number; after: number; ms: number; real: boolean }

/** True for a line no tool result could have produced: most likely a counting bug in the mod that wrote it. */
export function implausible(before: number, after: number): boolean {
  if (before > 500_000) return true
  return after > 0 && before > 100_000 && before / after > 1000
}

export type SavedResult = { tokens: number; counted: number; skipped: number; dropped: number }

/**
 * Tokens saved on the day `today` (a dayKey). Only the last `maxLines` lines are read.
 * A tool_use_id counts once; a later "real" line replaces an "estimated" one. A line with no id
 * is dropped only when it repeats an earlier line exactly.
 */
export function savedToday(text: string, today: string, maxLines = 20_000): SavedResult {
  const lines = text.split('\n')
  const tail = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines
  const kept: Kept[] = []
  const byId = new Map<string, number>()
  const seen = new Set<string>()
  let skipped = 0
  let dropped = 0
  for (const rawLine of tail) {
    const raw = rawLine.trim()
    if (!raw) continue
    let j: unknown
    try {
      j = JSON.parse(raw)
    } catch {
      skipped += 1
      continue
    }
    if (!j || typeof j !== 'object' || Array.isArray(j)) {
      skipped += 1
      continue
    }
    const o = j as Record<string, unknown>
    const before = o.before
    const after = o.after
    if (typeof before !== 'number' || typeof after !== 'number' || !Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0 || after > before) {
      skipped += 1
      continue
    }
    const ms = typeof o.ts === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(o.ts) ? Date.parse(o.ts) : Number.NaN
    if (!Number.isFinite(ms)) {
      skipped += 1
      continue
    }
    // Dollar savers, output-token lines and Stably lines are not input-token savings.
    const stably = o.stably
    if ((o.cost_usd !== undefined && o.cost_usd !== null) || o.tokens === 'output' || (stably && typeof stably === 'object' && !Array.isArray(stably))) {
      skipped += 1
      continue
    }
    const row: Kept = { before, after, ms, real: o.measured === 'real' }
    const id = typeof o.tool_use_id === 'string' ? o.tool_use_id : ''
    if (id) {
      const at = byId.get(id)
      if (at !== undefined) {
        dropped += 1
        const old = kept[at]
        if (old && !old.real && row.real) kept[at] = row
        continue
      }
      byId.set(id, kept.length)
    } else {
      if (seen.has(raw)) {
        dropped += 1
        continue
      }
      seen.add(raw)
    }
    kept.push(row)
  }
  let tokens = 0
  let counted = 0
  for (const r of kept) {
    if (dayKey(r.ms) !== today) continue
    if (implausible(r.before, r.after)) {
      dropped += 1
      continue
    }
    tokens += r.before - r.after
    counted += 1
  }
  return { tokens: Math.max(0, tokens), counted, skipped, dropped }
}
