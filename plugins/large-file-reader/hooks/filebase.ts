import type { CardTool } from '../types'
import { CHUNK_CHARS, LINE_CHARS, MAX_CHARS } from './constants.ts'
import type { Helper } from './state.ts'
import { baseName, fmt, hash } from './text.ts'

// ============================================================================
// File part (was Read Router)
// ============================================================================

export const FILE_SYSTEM = [
  'You write reading notes for another AI model. It will not see the file, only your notes.',
  'Be exact and short. Cite every place with the line numbers given at the start of each line.',
  'Plain text or simple markdown bullets. No preamble, no closing remarks, no em dashes.',
].join(' ')

// The notes body is kept; the header and footer around it are written when they are served, so they can say
// whether Haiku wrote them for this task or earlier.
export type Notes = {
  body: string
  about: string
  // Said at the end: what the notes cover and when to read exact lines.
  covers: string
  exact: string
  before: number
  helper: Helper | null
  detail: string | null
  label: string
  // The pane's "open full result": the file, or the text pulled out of a PDF.
  full: string
  // 'output': notes on a shell command's output, not on a file.
  noun?: 'output'
}
export type How = 'fresh' | 'kept' | 'disk'
export type Line = { n: number; text: string; page?: number }
export type Chunk = { lines: Line[] }
export type Source = {
  path: string
  kind: 'text' | 'pdf'
  // Said at the top of the notes: what the helper read. At the end: what the notes cover, how to reach exact text.
  about: string
  covers: string
  exact: string
  full: string
  chunks: Chunk[]
  // A shell command's output: what the prompt calls it, and what the pane card shows.
  title?: string
  label?: string
  where?: string
  tool?: CardTool
  noun?: 'output'
}

// Guard B: files Claude must see word for word. Skills, CLAUDE.md, AGENTS.md, memory files, settings and switches.
export function isInstruction(path: string) {
  const base = baseName(path)
  return (
    base === 'SKILL.md' ||
    base === 'CLAUDE.md' ||
    base === 'AGENTS.md' ||
    base === 'switches.json' ||
    /^settings(\.local)?\.json$/.test(base) ||
    path.includes('/skills/') ||
    /\/\.claude\/projects\/[^/]+\/memory\//.test(path)
  )
}

// What a read is for: the person's real request (in a subagent, its own prompt) and Claude's words just before
// the call. The request picks the notes: the same file for another request gets new notes.
export type Task = { user: string; assistant: string }
const taskTag = (task: Task) => (task.user ? `|t${hash(task.user).slice(0, 6)}` : '')
export const notesKey = (path: string, st: { mtimeMs: number; size: number }, task: Task, extra = '') => `${path}|${st.mtimeMs}|${st.size}${extra}${taskTag(task)}`

// Guard D: the raw lines of each file that reached Claude, per chat and agent, for the file as it is now.
// Pieces answered with notes never reached Claude as text, so they do not count.
const pulled = new Map<string, Set<number>>()
export const pulledKey = (session: string, agentId: string | undefined, path: string, st: { mtimeMs: number; size: number }) =>
  `${session}\n${agentId ?? ''}\n${path}\n${st.mtimeMs}|${st.size}`
// The share of the file pulled in, counting these lines too. Each line counts once however often it is read.
export function shareWith(key: string, lines: readonly number[], total: number) {
  if (total <= 0) return 0
  const had = pulled.get(key)
  let n = had?.size ?? 0
  for (const l of lines) if (l >= 1 && l <= total && !had?.has(l)) n += 1
  return Math.min(1, n / total)
}
export function addPulled(key: string, lines: readonly number[]) {
  const set = pulled.get(key) ?? new Set<number>()
  for (const l of lines) set.add(l)
  pulled.set(key, set)
}
export const lineRange = (from: number, count: number) => Array.from({ length: Math.max(0, count) }, (_, i) => from + i)
export const pct = (share: number) => `${Math.round(share * 100)}%`

// Paths this mod answered with notes, and the notes kept per path, mtime and size.
export const routed = new Set<string>()
// Ranges (path, offset, limit) this mod answered with notes, so core's "unchanged" for the same range maps to them.
export const routedRanges = new Set<string>()
export const rangeKey = (e: { file_path: string; offset?: number; limit?: number }) => `${e.file_path}|${e.offset ?? ''}|${e.limit ?? ''}`
export const cache = new Map<string, Notes>()
// Which loop got notes for which path, and from which Read call: session, agent and path.
export const noted = new Map<string, string>()
export const notedKey = (session: string, agentId: string | undefined, path: string) => `${session}\n${agentId ?? ''}\n${path}`

export function cut(text: string) {
  return text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS)} [line cut]` : text
}

const size = (l: Line) => l.text.length + 10

// Keeps line boundaries; one chunk is at most CHUNK_CHARS of numbered text.
export function chunk(lines: Line[]): Chunk[] {
  const out: Chunk[] = []
  let cur: Line[] = []
  let n = 0
  for (const line of lines) {
    if (cur.length > 0 && n + size(line) > CHUNK_CHARS) {
      out.push({ lines: cur })
      cur = []
      n = 0
    }
    cur.push(line)
    n += size(line)
  }
  if (cur.length > 0) out.push({ lines: cur })
  return out
}

// Over MAX_CHARS the helper reads the head and the tail; the gap is said in the notes.
export function fit(lines: Line[]): { kept: Line[]; gap: string } {
  if (lines.reduce((s, l) => s + size(l), 0) <= MAX_CHARS) return { kept: lines, gap: '' }
  const half = MAX_CHARS / 2
  let h = 0
  let n = 0
  while (h < lines.length && n + size(lines[h]!) <= half) n += size(lines[h++]!)
  let t = lines.length
  n = 0
  while (t > h && n + size(lines[t - 1]!) <= half) n += size(lines[--t]!)
  const from = lines[h]?.n ?? 0
  const to = lines[t - 1]?.n ?? 0
  return { kept: [...lines.slice(0, h), ...lines.slice(t)], gap: `The helper skipped lines ${fmt(from)}-${fmt(to)} (too big to read whole).` }
}

export function toLines(text: string, from: number): Line[] {
  const raw = text.split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  return raw.map((t, i) => ({ n: from + i, text: cut(t) }))
}
