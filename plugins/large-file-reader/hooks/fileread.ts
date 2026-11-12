import type { EngineInterface } from 'claude-code'
import type { CardTool } from '../types'
import { newCard, setCard } from './cards.ts'
import { purpose } from './connector.ts'
import {
  COVER_SHARE,
  EDIT_LINES,
  FILE_READ_MAX,
  MIN_TOKENS,
  NAME,
  PASS_LOG_TOKENS,
  READ_LINES,
  REMIND_LINES,
  SMALL_RANGE,
  TITLE,
  ZOOM_PAGES,
} from './constants.ts'
import {
  addPulled,
  isInstruction,
  lineRange,
  noted,
  notedKey,
  notesKey,
  pct,
  pulledKey,
  routed,
  shareWith,
} from './filebase.ts'
import type { How, Notes } from './filebase.ts'
import { ledger, log, remember, sessionId } from './ledger.ts'
import { frame, lastCard, makeNotes, notesFor, saveNotes } from './notes.ts'
import { parsePages, textSource } from './sources.ts'
import { S } from './state.ts'
import type { ToolOut } from './state.ts'
import { baseName, fmt, slug, stamp, tokens } from './text.ts'

// A Read result of type text: the notes stand where the file's lines would.
export function answer(filePath: string, content: string) {
  const numLines = content.split('\n').length
  return { result: { type: 'text' as const, file: { filePath, content, numLines, startLine: 1, totalLines: numLines } } }
}

// Ledger, detail file, toast and pane card for notes Claude is about to get. Returns the text it gets.
export async function recordFile($: EngineInterface, e: { tool_use_id?: string; agentId?: string; file_path: string; tool?: CardTool }, notes: Notes, how: How) {
  const fresh = how === 'fresh'
  const text = frame(e.file_path, notes, how)
  const after = tokens(text)
  try {
    if (fresh) {
      const detail = `${S.home}/.claude/mods-logs/${NAME}/${stamp(await $.clock.now())}-${slug(e.file_path)}.md`
      const body = [
        notes.noun === 'output' ? `# ${TITLE} (file part, Bash output): ${notes.label}` : `# ${TITLE} (file): ${e.file_path}`,
        '',
        notes.noun === 'output'
          ? `- Before: ~${fmt(notes.before)} tokens (the whole output, characters / 4; core shows Claude a preview and the saved path, and Claude pages through the rest). Saved at ${e.file_path}`
          : `- Before: ~${fmt(notes.before)} tokens (what the plain ${e.tool ?? 'Read'} would have handed Claude, characters / 4). ${notes.label}`,
        `- After: ~${fmt(after)} tokens of notes`,
        notes.helper
          ? `- Helper: ${notes.helper.model}, ${fmt(notes.helper.in)} in, ${fmt(notes.helper.out)} out, ${notes.helper.calls.length} requests (${notes.helper.calls.map(c => fmt(c.in)).join(', ')} in)`
          : '- Helper: none',
        '',
        '## What Claude got',
        '',
        text,
        '',
      ].join('\n')
      notes.detail = await $.fs
        .write(detail, body)
        .then(() => detail)
        .catch(() => null)
    }
    const why = how === 'kept' ? ' (kept notes, no helper call)' : how === 'disk' ? ' (notes kept on disk, no helper call)' : ''
    await ledger($, 'file', {
      tool_use_id: e.tool_use_id,
      tool: e.tool ?? 'Read',
      action: `notes for ${notes.noun === 'output' ? `the output of ${notes.label}` : notes.label}${why}`,
      before: notes.before,
      after,
      helper: fresh ? notes.helper : null,
      detail: notes.detail,
    })
  } catch (err) {
    await log($, 'file', 'ledger', err)
  }
  if (fresh) {
    await setCard($, lastCard.get(e.file_path), { detail: notes.detail })
    lastCard.delete(e.file_path)
  } else {
    await newCard($, {
      part: 'file',
      tool: e.tool ?? 'Read',
      label: notes.noun === 'output' ? notes.label : baseName(e.file_path),
      where: e.file_path,
      before: notes.before,
      after,
      requests: 0,
      phase: 'kept',
      state: how === 'kept' ? 'Notes from earlier in this chat. No Haiku call' : 'Notes kept on disk from an earlier chat. No Haiku call',
      notes: text,
      detail: notes.detail,
      full: notes.full,
    })
  }
  noted.set(notedKey(await sessionId($), e.agentId, e.file_path), e.tool_use_id || 'earlier')
  await remember($, { part: 'file', label: notes.noun === 'output' ? notes.label : baseName(e.file_path), before: notes.before, after, how: fresh ? 'haiku' : 'kept notes' })
  await log($, 'file', 'notes', `${e.file_path} ${fmt(notes.before)} -> ${fmt(after)} tokens${fresh ? '' : ` (${how})`}`)
  return text
}

export const UNCHANGED = (path: string) =>
  [
    `[${TITLE}] ${path} is unchanged since your last Read, and the ${TITLE} notes from that Read still cover it. You do not need to read the file again to check them.`,
    `Read exact lines (offset and limit, ${SMALL_RANGE}) only when you must quote exact text, or right before you Edit or Write this file. The person can type /input-router full to let the next whole read through.`,
  ].join('\n')

// A ranged Read of many lines of a file whose notes are already in this loop gets one line after its result.
// The Read itself is never blocked or changed.
export async function remind($: EngineInterface, e: { file_path: string; offset?: number; limit?: number; pages?: string; agentId?: string }, ran: ToolOut): Promise<string | null> {
  try {
    if (ran.deny !== undefined || ran.isError || e.pages !== undefined || (e.limit ?? READ_LINES) < REMIND_LINES) return null
    const from = noted.get(notedKey(await sessionId($), e.agentId, e.file_path))
    if (!from) return null
    await log($, 'file', 'reminder', `${e.file_path} offset ${e.offset ?? 1} limit ${e.limit ?? READ_LINES}`)
    return remindLine(e.file_path, from)
  } catch {
    return null
  }
}

export function remindLine(path: string, from: string) {
  return `[${TITLE}] Notes for ${path} are already in this chat (from tool call ${from}) and cover this file. You do not need to read it in pieces to check them. Read exact lines (${SMALL_RANGE}) only to quote exact text or right before an Edit.`
}

// Guard A let a short piece through after the piece counter passed its share: say what the next big piece gets.
function coverLine(path: string, share: number) {
  return `[${TITLE}] You have now read ${pct(share)} of ${path} in pieces. A read of ${EDIT_LINES} lines or more of it now returns its notes. Read ranges ${SMALL_RANGE}, only to quote exact text or right before an Edit.`
}

// The file's notes for this task (kept in memory or on disk, or fresh from Haiku), in place of `before` tokens of
// raw text: a whole read, a piece over the limit, or a piece past the piece counter. null: the read passes as it
// ran (a helper failure, a binary file, or notes that would not be shorter than the text).
export async function fileNotes(
  $: EngineInterface,
  e: { tool_use_id?: string; agentId?: string; file_path: string },
  before: number,
  tool: CardTool,
  signal: AbortSignal,
  why: string,
): Promise<string | null> {
  const stat = await $.fs.stat(e.file_path)
  const task = await purpose($, e.agentId)
  const key = notesKey(e.file_path, stat, task)
  const got = await notesFor($, e.file_path, key, async () => {
    const src = await textSource($, e.file_path, stat.size)
    return src ? makeNotes($, { ...src, tool }, before, baseName(e.file_path), signal, task) : null
  })
  if (!got) return null
  if (got.how === 'fresh') await saveNotes($, e.file_path, key, got.notes)
  const notes = { ...got.notes, before }
  // At a 2,000-token limit a file's notes can be longer than a piece of it: then the raw piece is the cheaper answer.
  const after = tokens(frame(e.file_path, notes, got.how))
  if (after >= before) {
    await log($, 'file', 'pass', `${e.file_path}: the notes (~${fmt(after)} tokens) are not shorter than the text (~${fmt(before)} tokens), so the ${tool} passes (${why})`)
    if (got.how === 'fresh') {
      await setCard($, lastCard.get(e.file_path), { phase: 'failed', state: 'The notes were not shorter, so Claude got the plain text' })
      lastCard.delete(e.file_path)
    }
    return null
  }
  routed.add(e.file_path)
  await log($, 'file', 'route', `${e.file_path}: ${why}`)
  return recordFile($, { ...e, tool }, notes, got.how)
}

// A Read whose lines are the whole file: notes in place of the text (kept, on disk, or fresh from Haiku).
export async function wholeRead<T extends ToolOut>($: EngineInterface, e: { tool_use_id?: string; agentId?: string; file_path: string }, ran: T, filePath: string, text: string, kind: string, signal: AbortSignal) {
  const before = tokens(text)
  if (before < MIN_TOKENS) {
    await pass($, before, `${e.file_path}: ${kind} under the limit (~${fmt(before)} tokens, limit ${fmt(MIN_TOKENS)})`)
    return ran
  }
  try {
    const out = await fileNotes($, e, before, 'Read', signal, `${kind} over the limit (~${fmt(before)} tokens, limit ${fmt(MIN_TOKENS)})`)
    return out === null ? ran : (answer(filePath, out) as unknown as T)
  } catch (err) {
    await log($, 'file', 'text', err)
    return ran
  }
}

// A piece of a file that came in as raw text: a ranged Read, or a shell print of part of the file.
//   Guard A (Read only): under EDIT_LINES lines and under MIN_TOKENS it stays exact text, so Edit still works. It
//   still counts. A short range of long lines over the limit is not an edit escape: it gets the notes.
//   Guard D: once the raw pieces of a big file pass COVER_SHARE of it, the piece gets the file's notes.
//   The limit: a piece over MIN_TOKENS gets the file's notes.
// Anything else passes, and its lines count toward the share.
type Piece = { lines: readonly number[]; total: number; text: string; what: string }
export async function piece(
  $: EngineInterface,
  e: { tool_use_id?: string; agentId?: string; file_path: string },
  p: Piece,
  tool: CardTool,
  signal: AbortSignal,
): Promise<{ notes: string } | { context: string | null }> {
  const st = await $.fs.stat(e.file_path)
  const key = pulledKey(await sessionId($), e.agentId, e.file_path, st)
  const size = tokens(p.text)
  const now = shareWith(key, p.lines, p.total)
  const bigFile = st.size / 4 >= MIN_TOKENS
  const where = `${e.file_path}: ${p.what}`
  if (tool === 'Read' && p.lines.length < EDIT_LINES && size < MIN_TOKENS) {
    addPulled(key, p.lines)
    await pass($, size, `${where}, edit escape (${p.lines.length} lines, under ${EDIT_LINES}; ~${fmt(size)} tokens, under ${fmt(MIN_TOKENS)}): exact text, ${pct(now)} of the file read in pieces`)
    return { context: bigFile && now > COVER_SHARE ? coverLine(e.file_path, now) : null }
  }
  const counted = bigFile && now > COVER_SHARE
  if (counted || size >= MIN_TOKENS) {
    const why = counted
      ? `piece counter: ${p.what} would make ${pct(now)} of the file read in pieces (limit ${pct(COVER_SHARE)})`
      : `${p.what} over the limit (~${fmt(size)} tokens, limit ${fmt(MIN_TOKENS)})`
    const out = await fileNotes($, e, size, tool, signal, why)
    if (out !== null) return { notes: out }
  } else {
    await pass($, size, `${where} under the limit (~${fmt(size)} tokens, limit ${fmt(MIN_TOKENS)}), ${pct(now)} of the file read in pieces`)
  }
  addPulled(key, p.lines)
  return { context: null }
}

// A big input this mod left alone, and why. Small ones are not logged.
export async function pass($: EngineInterface, size: number, why: string) {
  if (size >= PASS_LOG_TOKENS) await log($, 'file', 'pass', why)
}

// /input-router full is taken only by a Read the file part would have changed, by the same rules as above.
export async function wouldRoute($: EngineInterface, e: { file_path: string; offset?: number; limit?: number; pages?: string; agentId?: string }, ext: string) {
  if (isInstruction(e.file_path)) return false
  if (ext === 'pdf') {
    const range = parsePages(e.pages, Number.MAX_SAFE_INTEGER)
    return range === null || range.last - range.first + 1 > ZOOM_PAGES
  }
  if (e.pages !== undefined) return false
  const st = await $.fs.stat(e.file_path).catch(() => null)
  if (st === null || st.size / 4 < MIN_TOKENS) return false
  if (e.offset === undefined && e.limit === undefined) return true
  if (st.size > FILE_READ_MAX) return false
  const all = String(await $.fs.read(e.file_path)).split('\n')
  const start = Math.max(e.offset ?? 1, 1)
  const count = Math.max(0, Math.min(e.limit ?? READ_LINES, all.length - start + 1))
  if (start === 1 && count >= all.length) return true
  if (tokens(all.slice(start - 1, start - 1 + count).join('\n')) >= MIN_TOKENS) return true
  if (count < EDIT_LINES) return false
  return shareWith(pulledKey(await sessionId($), e.agentId, e.file_path, st), lineRange(start, count), all.length) > COVER_SHARE
}
