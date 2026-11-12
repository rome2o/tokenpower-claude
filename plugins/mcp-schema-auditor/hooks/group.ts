import type { ServerRow } from '../types'

import { MAX_RAW, MAX_SERVERS } from './constants.ts'
import { cleanName, rawTokens } from './guards.ts'

export const UNKNOWN = '(unknown)'
export const OTHER = '(other servers)'

// A server is told apart by the name it reports, not by the cleaned name drawn for it.
const rawKey = (s: string): string => (s.length > MAX_RAW ? `${s.slice(0, MAX_RAW)}\u0000${s.length}` : s)

/**
 * Groups the engine's MCP tool list by server: loaded and deferred tokens and a tool count,
 * biggest loaded first. Anything that is not a well formed entry counts as nothing.
 * A tool with no usable name goes to one unknown row; servers past MAX_SERVERS go to one other row.
 * Two servers whose cleaned names match keep separate rows, the later one drawn with a "#2" suffix.
 */
export function groupByServer(tools: unknown): ServerRow[] {
  if (!Array.isArray(tools)) return []
  const by = new Map<string, ServerRow>()
  let other: ServerRow | undefined
  for (const t of tools as unknown[]) {
    if (!t || typeof t !== 'object') continue
    const o = t as { serverName?: unknown; tokens?: unknown; isLoaded?: unknown }
    const name = cleanName(o.serverName)
    // A name with no letter or digit left after cleaning is not a name.
    const key = typeof o.serverName === 'string' && /[\p{L}\p{N}]/u.test(name) ? rawKey(o.serverName) : ''
    let row = by.get(key)
    if (!row) {
      if (by.size >= MAX_SERVERS) {
        other ??= { server: OTHER, loaded: 0, deferred: 0, count: 0, other: true }
        row = other
      } else {
        row = key ? { server: name, loaded: 0, deferred: 0, count: 0 } : { server: UNKNOWN, loaded: 0, deferred: 0, count: 0, unknown: true }
        by.set(key, row)
      }
    }
    // The engine says a schema is outside the window only with isLoaded false.
    if (o.isLoaded === false) row.deferred += rawTokens(o.tokens)
    else row.loaded += rawTokens(o.tokens)
    row.count += 1
  }
  const rows = [...by.values()]
  if (other) rows.push(other)
  for (const r of rows) {
    r.loaded = Math.round(r.loaded)
    r.deferred = Math.round(r.deferred)
  }
  rows.sort((a, b) => b.loaded - a.loaded || b.deferred - a.deferred || (a.server < b.server ? -1 : a.server > b.server ? 1 : 0))
  const seen = new Map<string, number>()
  for (const r of rows) {
    const n = (seen.get(r.server) ?? 0) + 1
    seen.set(r.server, n)
    if (n > 1) r.server = `${r.server} #${n}`
  }
  return rows
}
