import { atom } from 'claude-code'

import type { View } from '../types'

export const NAME = 'token-savings-tracker'
export const PANE = 'token-savings-tracker'
export const TITLE = 'Token Savings Tracker'
export const MAX_ROWS = 300
export const SHOW_ROWS = 60
export const MAX_BYTES = 3_500_000
export const TAIL_LINES = 20_000
export const DETAIL_CHARS = 6000

// /savings sample reads the 5 test lines in test/, as if it were this time and this chat.
export const SAMPLE_NOW = Date.parse('2026-11-02T12:00:00Z')
export const SAMPLE_CHAT = 'sample-chat-1'

export const ACCENT = '#d97757'
export const GOOD = '#16a34a'
export const BAD = '#dc2626'
export const WARN = '#ca8a04'
export const INFO = '#2563eb'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const EMPTY_VIEW: View = { filter: 'today', open: '', detail: '', detailError: '', note: '' }
export const ledgerAtom = atom({ plugin: 'token-savings-tracker', key: 'ledger' } as const, null, { shape: 'ledger-5' })
export const liveAtom = atom({ plugin: 'token-savings-tracker', key: 'live' } as const, null, { shape: 'live-1' })
export const compactAtom = atom({ plugin: 'token-savings-tracker', key: 'compactions' } as const, [], { shape: 'compactions-1' })
export const viewAtom = atom({ plugin: 'token-savings-tracker', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-1' })
// "token-savings-tracker:hidden": true in switches.json closes the pane in every chat.
export const HIDE_KEY = `${NAME}:hidden`

export const PER_M = 1e-6

/**
 * Prints one line per main-chat request ("M <first ts> <requestId> <model>") and one per
 * compaction ("C <ts>"). awk reads a 46 MB transcript in about 1 s; JSON.parse of it would not fit.
 */
export const SCAN = String.raw`function last(s, re,   out) { out = ""; while (match(s, re)) { out = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) } return out }
/"type":"system","subtype":"compact_boundary"/ { t = last($0, "\"timestamp\":\"[^\"]*\""); if (t != "") print "C " substr(t, 14, length(t) - 14); next }
match($0, /"type":"assistant","uuid":"[^"]*","timestamp":"[^"]*"/) {
  t = substr($0, RSTART, RLENGTH); sub(/.*"timestamp":"/, "", t); sub(/"$/, "", t)
  id = last($0, "\"requestId\":\"req_[^\"]*\""); if (id == "") next
  id = substr(id, 14, length(id) - 14)
  m = "-"; if (match($0, /"model":"[^"]*"/)) m = substr($0, RSTART + 9, RLENGTH - 10)
  print (($0 ~ /"isSidechain":true/) ? "S " : "M ") t " " id " " m
}`

// Renamed mods keep their old name on old ledger lines, so both names show the new one.
// Image Offload became Browser Screenshot Compressor. Large File Reader merged Read Router, Connector Reader and Web Fetch
// Cache; the old three keep their own names, so old and new numbers stay apart.
export const MOD_NAMES: Record<string, string> = {
  'input-router': 'Large File Reader',
  'model-router': 'Subagent Model Router',
  'efficient-browser-use': 'Browser Screenshot Compressor',
  'research-router': 'Web Research Saver',
  'jev-model-router': 'Subagent Model Router',
  'subagent-model-router': 'Subagent Model Router',
  'jev-compaction': 'Haiku Compaction',
  'haiku-compaction': 'Haiku Compaction',
  'image-offload': 'Browser Screenshot Compressor',
  'browser-screenshot-compressor': 'Browser Screenshot Compressor',
  'large-file-reader': 'Large File Reader',
  'read-router': 'Read Router',
  'connector-reader': 'Connector Reader',
  'web-fetch-cache': 'Web Fetch Cache',
}
