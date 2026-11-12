// Pure guards. No engine imports, so a node script can load this file.

// Control, format (bidi, zero-width, soft hyphen, word joiner, tag), surrogate and private-use characters,
// plus the blank fillers and variation selectors that Unicode does not class as format. Written as escapes.
const STRIP = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180e\u3164\uffa0\ufe00-\ufe0f\u{e0000}-\u{e0fff}]/gu

/** Text for the log: the same characters as cleanName removes become spaces, at most 300 characters. */
export function logText(s: string): string {
  return s.replace(STRIP, ' ').slice(0, 300)
}

/** A string that is safe to draw: no control, bidi or zero-width characters, one space between words, at most 60 characters. */
export function cleanName(s: unknown): string {
  if (typeof s !== 'string') return ''
  const t = s.replace(STRIP, '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(t)
  return chars.length > 60 ? `${chars.slice(0, 59).join('')}…` : t
}

/** A token count: 0 for anything that is not a finite number or is negative, else rounded. */
export function clampTokens(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0
  return Math.min(1e12, Math.round(n))
}

/** n over d as a percentage, 0 when d is not a positive finite number. */
export function pct(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0
  return (n / d) * 100
}

/** True for an absolute home with no empty, "." or ".." segment, no "%", no backslash and no control character. */
export function validHome(home: unknown): boolean {
  if (typeof home !== 'string' || !home.startsWith('/') || home === '/') return false
  if (/[%\\\u0000-\u001f\u007f]/.test(home)) return false
  return !home.split('/').slice(1).some(seg => seg === '' || seg === '.' || seg === '..')
}

/** The home folder, taken from a plugin root that sits under "<home>/.claude/plugins/", or '' when it cannot be trusted. */
export function homeOf(root: unknown): string {
  if (typeof root !== 'string') return ''
  const at = root.indexOf('/.claude/')
  if (at <= 0 || !root.startsWith('/.claude/plugins/', at)) return ''
  const home = root.slice(0, at)
  return validHome(home) ? home : ''
}

// The three files this mod touches, under the home. These are the only places their names are written.
export function ledgerPathOf(home: string): string {
  return validHome(home) ? `${home}/.claude/mods-logs/savings.jsonl` : ''
}
export function logPathOf(home: string): string {
  return validHome(home) ? `${home}/.claude/mods-logs/context-meter.log` : ''
}
export function switchesPathOf(home: string): string {
  return validHome(home) ? `${home}/.claude/mods/switches.json` : ''
}

/** True only for exactly the ledger path under a trusted home. A textual check: a symbolic link is refused where the file is stat-ed. */
export function isLedgerPath(p: unknown, home: unknown): boolean {
  if (typeof p !== 'string' || typeof home !== 'string') return false
  const want = ledgerPathOf(home)
  return want !== '' && p === want
}
