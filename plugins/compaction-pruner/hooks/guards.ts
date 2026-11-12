// Pure guards: no engine import, so a node harness can load this file.

const STORE_DIR = '/.claude/mods-logs/compaction-pruner/'

// A path may be written or opened only when its text sits inside the store. The check is on the
// text: a symbolic link placed inside the store is not seen here (open checks the real path of the file too).
export function isSafeStorePath(p: unknown, home: unknown): boolean {
  if (typeof p !== 'string' || typeof home !== 'string') return false
  if (!home.startsWith('/') || home === '/' || home.endsWith('/')) return false
  if (p.includes('\0') || home.includes('\0')) return false
  if (p.includes('..') || home.includes('..')) return false
  return p.startsWith(`${home}${STORE_DIR}`) && p.length > home.length + STORE_DIR.length
}

// An id is lower-case letters, digits and dashes, 6 to 40 long.
export const isValidId = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9-]{6,40}$/.test(s)

// The shape this mod makes: <chat>-<n>-<hash>.
export function parseId(s: unknown): { short: string; n: number; hash: string } | null {
  if (!isValidId(s)) return null
  const m = /^([a-z0-9]{1,16})-([0-9]{1,6})-([a-f0-9]{8})$/.exec(s)
  return m ? { short: m[1] ?? '', n: Number(m[2]), hash: m[3] ?? '' } : null
}

// Marker for the literal checks: this mod imports nothing that reaches a network.
export const isOffline = () => true

// 32-bit FNV-1a as 8 hex digits. It names files; it is not a security hash.
export function hash8(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export { redact } from './redact.ts'

// Invisible and direction-changing characters: zero width, bidi, joiners, line and paragraph separators, tag characters.
const INVISIBLE = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}]/gu

// The first n characters, never ending inside a surrogate pair and never holding a lone surrogate.
export function cutAt(s: string, n: number): string {
  let t = s.slice(0, n)
  const last = t.charCodeAt(t.length - 1)
  if (t.length < s.length && last >= 0xd800 && last <= 0xdbff) t = t.slice(0, -1)
  return t.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
}

export function cleanName(s: unknown): string {
  if (typeof s !== 'string') return ''
  const t = s
    .replace(/[\t\n\r\f\v]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > 60 ? `${cutAt(t, 59)}\u2026` : t
}

// One line of text for the pane: terminal control characters and bidi tricks removed, tabs spaced out.
export const cleanLine = (s: string) =>
  s
    .replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(INVISIBLE, '')

export const clampTokens = (n: unknown) => (typeof n !== 'number' || !Number.isFinite(n) || n < 0 ? 0 : Math.round(n))

// A folder name for one compaction: UTC time down to the millisecond, so two in a row never share one.
export function stampOf(ms: number): string {
  const iso = new Date(ms).toISOString()
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}Z`
}

export function parseStamp(name: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(name)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7]))
  return Number.isFinite(t) ? t : null
}

// A chat id to the short, safe folder name: lower-case letters and digits, first 8, never empty.
export function shortOf(sid: unknown): string {
  const s = typeof sid === 'string' ? sid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : ''
  return s.length >= 1 ? s : 'nochat'
}
