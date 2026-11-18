// Pure: the rules for what is worth keeping. No model call, no engine import.
import { WIP_WRITES } from './constants.ts'

export type Candidate = { path: string; size: number; writes: number }
export type Verdict = { keep: boolean; why: string; wip: boolean; rank: number }

const KEEP_EXT = new Set(['md', 'txt', 'json', 'csv', 'html'])
// Names that are caches or machine files even when the extension is a document or data type.
// Judged on the name without its extension: it must be, or end in, cache or lock. A name that only starts with
// those words (cache-strategy-research.md, lock-free-queue-notes.md) is a real document.
const CACHE_NAME = /^(.+[-_.])?(cache|lock)$|^\.ds_store$/i
const CACHE_DIR = /\/(node_modules|\.cache|__pycache__|\.git)\//

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

const stemOf = (base: string) => (base.lastIndexOf('.') > 0 ? base.slice(0, base.lastIndexOf('.')) : base)

export function triageFile(c: Candidate, minBytes: number): Verdict {
  const base = c.path.slice(c.path.lastIndexOf('/') + 1)
  const wip = c.writes >= WIP_WRITES
  const no = (why: string): Verdict => ({ keep: false, why, wip, rank: c.writes })
  if (!KEEP_EXT.has(extOf(c.path))) return no('not a document or data file')
  if (CACHE_DIR.test(c.path) || CACHE_NAME.test(stemOf(base))) return no('looks like a cache or lock file')
  if (!(c.size >= minBytes)) return no('smaller than the size floor')
  return { keep: true, why: wip ? 'rewritten often, may be work in progress' : 'document or data file', wip, rank: c.writes }
}

// Every item expires after N days: a skipped one counts from the moment it was skipped, a waiting one from when it
// was added. A bad days value expires nothing.
export function isExpired(item: { at: number; skipped: boolean; skippedAt?: number }, now: number, days: number): boolean {
  if (!Number.isFinite(days) || days <= 0) return false
  const since = item.skipped && typeof item.skippedAt === 'number' ? item.skippedAt : item.at
  return now - since >= days * 86_400_000
}
