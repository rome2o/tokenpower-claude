import type { Rows } from '../types'

export const NAME = 'mcp-schema-auditor'
export const PANE = 'mcp-schema-auditor'
export const TITLE = 'MCP Schema Auditor'
export const COMMAND = 'mcp-cost'

// A server is suggested when its loaded tokens reach 5 percent of the compaction window or 5,000 tokens.
export const SUGGEST_PCT = 5
export const SUGGEST_TOKENS = 5000

export const BAR_WIDTH = 12
export const MAX_LOG_LINES = 50
// Rows drawn and stored, distinct servers tracked, characters of a name read, and how long a refresh may hold the lock (ms).
export const MAX_ROWS = 10
export const MAX_SERVERS = 500
export const MAX_RAW = 1000
export const MAX_SUGGEST = 10
export const BUSY_MS = 30000

export const ACCENT = '#d97757'
export const WARN = '#ca8a04'
export const BAD = '#dc2626'

export const NOTE = 'Sizes are estimates of tool schemas. Bars are relative to the largest server. Whether server instructions text is counted here has not been verified.'

export const EMPTY_ROWS: Rows = { status: 'waiting', servers: [], suggestions: [], totalLoaded: 0, totalDeferred: 0, moreServers: 0, moreLoaded: 0, moreDeferred: 0, window: 0, at: 0 }
// "mcp-schema-auditor:hidden": true in the switchboard file closes the pane in every chat.
export const HIDE_KEY = `${NAME}:hidden`
