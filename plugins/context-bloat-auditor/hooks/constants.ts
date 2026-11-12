export const NAME = 'context-bloat-auditor'
export const PANE = 'context-bloat-auditor'
export const TITLE = 'Context Bloat Auditor'
// An item over this many tokens is flagged. Edit here.
export const FLAG_TOKENS = 2000
// Two memory files with the same name and token count count as a possible duplicate above this size.
export const DUP_MIN_TOKENS = 200
export const TOP_SKILLS = 15
export const TOP_AGENTS = 10
export const TOP_MEMORY = 30
export const MAX_FLAGS = 40
// Longest cleaned name and cleaned path kept.
export const NAME_CAP = 60
export const PATH_CAP = 120
// Set false to hide every project folder name and show only the file name.
export const SHOW_PATHS = true

export const ACCENT = '#d97757'
export const WARN = '#ca8a04'

// "context-bloat-auditor:hidden": true in switches.json closes the pane in every chat.
export const HIDE_KEY = `${NAME}:hidden`
