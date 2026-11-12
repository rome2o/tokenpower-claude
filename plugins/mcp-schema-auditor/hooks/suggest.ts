import type { ServerRow, Suggestion } from '../types'

import { cleanName, pct } from './guards.ts'

/** The only wording a suggestion has: a fixed template and one cleaned name in quotes. */
export function suggestionText(name: string): string {
  return `Consider disabling "${cleanName(name).replace(/"/g, "'")}" with /mcp. This mod does not change your config.`
}

/**
 * Servers whose LOADED tokens are at least `minPct` percent of the window or at least `minTokens`.
 * Deferred tokens never count. The unknown and other rows are not servers, so they are never suggested.
 */
export function suggest(rows: readonly ServerRow[], window: number, minPct: number, minTokens: number): Suggestion[] {
  const out: Suggestion[] = []
  for (const r of rows) {
    if (r.unknown || r.other || r.loaded <= 0) continue
    if (r.loaded >= minTokens || pct(r.loaded, window) >= minPct) out.push({ server: r.server, loaded: r.loaded })
  }
  return out
}
