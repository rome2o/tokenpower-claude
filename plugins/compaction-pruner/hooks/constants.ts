import type { View } from '../types'

export * from './limits.ts'

export const NAME = 'compaction-pruner'
export const PANE = 'compaction-pruner'
export const TITLE = 'Compaction Pruner'
// Off until the person turns it on. /prune on starts in dry-run mode.
export const DEFAULT_MODE = 'off'
export const STORE_SUBPATH = '.claude/mods-logs/compaction-pruner'
// If planning a compaction took longer than this, nothing is pruned and the compaction goes on as core does it.
export const BUDGET_MS = 1000
// Saving the originals stops after this long: results not yet saved are left as they are.
export const SAVE_BUDGET_MS = 5000
// The pane shows at most this many characters of a stored file. The file holds the rest.
export const SHOW_CHARS = 8000
export const SHOW_ITEMS = 40

export const EMPTY_VIEW: View = { title: '', lines: [] }
