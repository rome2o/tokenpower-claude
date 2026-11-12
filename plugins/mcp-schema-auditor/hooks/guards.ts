// Pure guards for strings and numbers the engine reports. Nothing here imports the engine.

// C0 and C1 control characters and DEL.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
// Bidi controls and zero-width characters, which can reorder or hide text in a pane.
const HIDDEN = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u061c\u2060-\u2064\u00ad\u034f\u180e\ufff9-\ufffb\u3164\u2800\uffa0\ufe00-\ufe0f\u{e0000}-\u{e007f}]/gu
const MAX_NAME = 60
// Only this many characters of a name are looked at, so a huge name costs nothing.
const MAX_READ = 1000
const MAX_TOKENS = 1e9

/** A name that is safe to draw: one line, no control or bidi characters, at most 60 characters plus an ellipsis. */
export function cleanName(s: unknown): string {
  if (typeof s !== 'string') return ''
  const one = s.slice(0, MAX_READ).replace(CONTROL, '').replace(HIDDEN, '').replace(/\s+/g, ' ').trim()
  if (one.length <= MAX_NAME) return one
  let cut = one.slice(0, MAX_NAME)
  // Do not leave half of a surrogate pair at the cut.
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/** True for the wire name of an MCP tool: mcp__server__tool. */
export function isMcpName(s: unknown): boolean {
  return typeof s === 'string' && /^mcp__[A-Za-z0-9_-]+__/.test(s)
}

/** A token count the engine reported, not rounded: 0 unless it is a finite number of at least 0, at most 1e9. */
export function rawTokens(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0
  return Math.min(n, MAX_TOKENS)
}

/** A token count the engine reported, rounded. */
export function clampTokens(n: unknown): number {
  return Math.round(rawTokens(n))
}

/** n as a percent of d, 0 when d is not a positive finite number. */
export function pct(n: number, d: number): number {
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return 0
  return (clampTokens(n) * 100) / d
}
