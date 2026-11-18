// Pure: the rules for what is worth keeping. No model call, no engine import.
import { WIP_WRITES } from './constants.ts'

export type Candidate = { path: string; size: number; writes: number }
export type Verdict = { keep: boolean; why: string; wip: boolean; rank: number }

const KEEP_EXT = new Set(['md', 'txt', 'json', 'csv', 'html'])
// Names that are caches or machine files even when the extension is a document or data type.
const CACHE_NAME = /(^|[-_.])cache([-_.]|$)|(^|[-_.])lock([-_.]|$)|^package-lock\.json$|^\.ds_store$/i
const CACHE_DIR = /\/(node_modules|\.cache|__pycache__|\.git)\//

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

export function triageFile(c: Candidate, minBytes: number): Verdict {
  const base = c.path.slice(c.path.lastIndexOf('/') + 1)
  const wip = c.writes >= WIP_WRITES
  const no = (why: string): Verdict => ({ keep: false, why, wip, rank: c.writes })
  if (!KEEP_EXT.has(extOf(c.path))) return no('not a document or data file')
  if (CACHE_DIR.test(c.path) || CACHE_NAME.test(base)) return no('looks like a cache or lock file')
  if (!(c.size >= minBytes)) return no('smaller than the size floor')
  return { keep: true, why: wip ? 'rewritten often, may be work in progress' : 'document or data file', wip, rank: c.writes }
}

// Only a skipped item expires. A bad days value expires nothing.
export function isExpired(item: { at: number; skipped: boolean }, now: number, days: number): boolean {
  if (!item.skipped || !Number.isFinite(days) || days <= 0) return false
  return now - item.at >= days * 86_400_000
}
