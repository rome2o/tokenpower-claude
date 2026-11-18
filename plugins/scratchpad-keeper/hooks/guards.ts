// Pure guards: no engine import, so a node harness can load this file.
import { DEFAULT_DEST_SUBPATH, INBOX_DIR } from './constants.ts'

export { DEFAULT_DEST_SUBPATH }
export { redact } from './redact.ts'

// A real parent-folder segment. A name that merely contains two dots, like notes..draft.md, is not one.
const hasDotDot = (p: string) => p.split(/[\\/]/).includes('..')

// True when p is below dir, on a path boundary. The check is on the text: p with a .. segment is refused.
export function isInside(p: unknown, dir: unknown): boolean {
  if (typeof p !== 'string' || typeof dir !== 'string' || !dir.startsWith('/')) return false
  if (p.includes('\0') || hasDotDot(p) || hasDotDot(dir)) return false
  const d = dir.replace(/\/+$/, '')
  return p.startsWith(`${d}/`) && p.length > d.length + 1
}

// The destination folder. An empty, relative or .. setting falls back to the default; ~ is the home folder.
export function resolveDest(setting: unknown, home: string): string {
  const fallback = `${home}/${DEFAULT_DEST_SUBPATH}`
  if (typeof setting !== 'string') return fallback
  const s = setting.trim().replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')
  if (!s.startsWith('/') || hasDotDot(s) || s.includes('\0') || s === '') return fallback
  return s
}

// A folder or file name part: lower-case letters, digits and dashes.
export function slug(s: unknown, max = 40): string {
  const t = (typeof s === 'string' ? s : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return t || 'project'
}

// An inbox item may be read or removed only when its path text sits inside the inbox.
export function safeInboxPath(p: unknown, home: unknown): boolean {
  if (typeof home !== 'string' || !home.startsWith('/') || home === '/' || home.endsWith('/')) return false
  return isInside(p, `${home}/${INBOX_DIR}`)
}

// 32-bit FNV-1a as 8 hex digits. It names files; it is not a security hash.
export function hash8(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// One line of text: control and invisible characters removed, cut to n characters.
export function cleanLine(s: unknown, n = 80): string {
  const t = (typeof s === 'string' ? s : '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function stampOf(ms: number): string {
  const iso = new Date(ms).toISOString()
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z`
}
