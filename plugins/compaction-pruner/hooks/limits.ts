// Plain numbers and names with no engine import, so the pure modules and a node harness can load them.
export const TAIL_PINNED = 6
export const MIN_TOKENS = 2000
export const HEAD_CHARS = 300
export const AGE_LINES = 20
export const RETENTION_DAYS = 14
export const STUB_MARK = '[pruned by compaction-pruner'
// Results of these tools are never shortened.
export const PINNED_TOOLS: readonly string[] = ['Edit', 'Write', 'TodoWrite', 'MultiEdit', 'NotebookEdit']
export const BASH_LIKE: readonly string[] = ['Bash', 'Grep']
// What one compaction may write to disk. Past any of these, the rest is left as it is and counted as skipped.
export const MAX_CANDIDATES = 200
export const MAX_SAVE_CHARS = 20_000_000
export const MAX_RESULT_CHARS = 2_000_000
// R4 looks at this many leading characters of a result.
export const SCAN_CHARS = 400_000
