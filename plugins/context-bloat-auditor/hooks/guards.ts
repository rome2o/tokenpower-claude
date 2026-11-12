// Pure guards, no engine imports.

const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g

const strip = (s: string) => s.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()

// Key shapes that look like a live secret. Each must start at a word edge, so ordinary words ("task-management") are left alone.
const KEY_LIKE = new RegExp(
  [
    'sk-[A-Za-z0-9_-]{16,}',
    'sk_(?:live|test)_[A-Za-z0-9]{10,}',
    'AKIA[A-Z0-9]{16}',
    'AIza[A-Za-z0-9_-]{35}',
    'ya29\\.[A-Za-z0-9_-]{20,}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'xox[baprs]-[A-Za-z0-9-]{10,}',
    'eyJ[A-Za-z0-9_-]{8,}(?:\\.[A-Za-z0-9_-]+){1,2}',
    'Bearer [A-Za-z0-9._~+/=-]{10,}',
  ]
    .map(x => `(?<![A-Za-z0-9])${x}`)
    .join('|'),
  'g',
)

export function maskSecrets(s: string): string {
  return s.replace(KEY_LIKE, '[hidden]')
}

/** Cut to n code points (never inside a surrogate pair) and add an ellipsis. */
export function capText(s: string, n: number): string {
  const cps = Array.from(s)
  return cps.length > n ? `${cps.slice(0, n).join('')}…` : s
}

/** Strip control and invisible characters, collapse spaces, mask key shapes, then cap. Masking runs before the cap so a key is never cut into a visible prefix. */
export function clean(s: unknown, cap: number): string {
  return typeof s === 'string' ? capText(maskSecrets(strip(s)), cap) : ''
}

/** A cleaned, masked name, capped at 60 characters. */
export function cleanName(s: unknown): string {
  return clean(s, 60)
}

/** Same as cleanName, longer cap, for a path already shortened. */
export function cleanPath(s: unknown): string {
  return clean(s, 120)
}

/** The cleaned, masked name with a far larger cap. Used to group duplicates, never drawn. */
export function cleanKey(s: unknown): string {
  return clean(s, 300)
}

export const MAX_TOKENS = 10_000_000

export function clampTokens(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.round(n), MAX_TOKENS)
}

/** Fixed text drawn for a credential-like file: no path, no name. */
export const SECRET_TEXT = 'credential-like file, path hidden'

const segmentsOf = (p: string): string[] =>
  p
    .replace(/\\/g, '/')
    .split('/')
    .filter(x => x !== '')

export function basename(p: string): string {
  const parts = segmentsOf(p)
  return parts[parts.length - 1] ?? ''
}

// Names that are credential files, by the person's global credential rule (case-insensitive, compared lower case):
// .env, .env.*, *.env, service_account.json, *_credentials.json, *_service_account.json,
// *.pem, *.key, *.p12, *.pfx, *.token, *_token.json, auth.json.
// Extra, by name only: ssh private key names, the default names Google tooling writes, common token and key stores.
function secretName(n: string): boolean {
  const s = n.toLowerCase()
  if (s === '.env' || s.startsWith('.env.') || s.endsWith('.env')) return true
  if (s === 'service_account.json' || s === 'service-account.json' || s === 'auth.json' || s === 'credentials.json' || s === 'token.json') return true
  if (s.endsWith('_credentials.json') || s.endsWith('_service_account.json') || s.endsWith('_token.json')) return true
  if (s.endsWith('.pem') || s.endsWith('.key') || s.endsWith('.p12') || s.endsWith('.pfx') || s.endsWith('.token')) return true
  if (s.endsWith('.jks') || s.endsWith('.keystore') || s.endsWith('.p8')) return true
  if (s.startsWith('id_rsa') || s.startsWith('id_ed25519') || s.startsWith('id_ecdsa') || s.startsWith('id_dsa')) return true
  if (s.startsWith('client_secret') || s.startsWith('.git-credentials') || s === '.netrc' || s === '.npmrc' || s === '.pgpass' || s === 'known_hosts') return true
  return /secret|credential|password/.test(s)
}

// Directory names that are credential folders: secrets, credentials, .secrets, .ssh, .aws.
const SECRET_DIRS = new Set(['secrets', 'credentials', '.secrets', '.ssh', '.aws'])

/**
 * One normal form for a path, used both to decide secrecy and to draw: control and invisible characters removed,
 * compatibility forms folded (NFKC), and per segment a trailing dot or space and a ":stream" suffix dropped,
 * because Windows ignores them and the name then still opens the real file.
 */
export function normPath(p: string): string {
  const abs = p.startsWith('/') || p.startsWith('\\')
  const segs = strip(p.normalize('NFKC'))
    .replace(/\\/g, '/')
    .split('/')
    .map((seg, i) => {
      if (seg === '.' || seg === '..') return seg
      const cut = seg.indexOf(':') >= 2 || (i > 0 && seg.indexOf(':') >= 0) ? seg.slice(0, seg.indexOf(':')) : seg
      return cut.replace(/[. ]+$/, '')
    })
    .filter(x => x !== '')
  return (abs ? '/' : '') + segs.join('/')
}

/** True when the basename or any path segment is credential-like. Handles / and \, case, a trailing slash, and the odd forms normPath folds. */
export function isSecretPath(p: unknown): boolean {
  if (typeof p !== 'string') return true
  for (const seg of segmentsOf(normPath(p))) {
    const low = seg.toLowerCase()
    if (SECRET_DIRS.has(low) || secretName(low)) return true
  }
  return false
}

const lastTwo = (parts: string[]) => `.../${parts.slice(-2).join('/')}`

/** Home becomes ~. A path outside home, or with .. in it, shows its last two segments only. Never an absolute path. */
export function shortPath(p: string, home: string): string {
  const parts = segmentsOf(p)
  if (parts.includes('..')) return lastTwo(parts)
  const h = segmentsOf(home)
  if (h.length > 0 && parts.length >= h.length && h.every((x, i) => parts[i] === x)) {
    const rest = parts.slice(h.length)
    return rest.length === 0 ? '~' : `~/${rest.join('/')}`
  }
  return lastTwo(parts)
}

/**
 * The home folder that holds .claude, taken from the plugin root. Empty unless the root really sits under a .claude folder,
 * so a --plugin-dir run or an odd root never makes the mod write outside ~/.claude. Backslashes are folded first.
 */
export function homeOfRoot(root: unknown): string {
  if (typeof root !== 'string') return ''
  const r = root.replace(/\\/g, '/')
  const i = r.indexOf('/.claude/')
  return i > 0 ? r.slice(0, i) : ''
}
