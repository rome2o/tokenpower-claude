import { clampTokens } from './guards.ts'

// Pure: one ledger line for a live compaction, in the shape the other savers use. Dry runs make none.
export function ledgerLine(at: number, session: string, count: number, before: number, after: number, folder: string): string {
  return JSON.stringify({
    ts: new Date(at).toISOString(),
    session,
    tool_use_id: null,
    mod: 'compaction-pruner',
    part: '',
    tool: 'compact',
    action: 'prune',
    before: clampTokens(before),
    after: clampTokens(after),
    helper: null,
    measured: 'estimated',
    detail: `${count} results, recover ${folder}`,
  })
}
