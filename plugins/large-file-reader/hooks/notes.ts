import type { EngineInterface } from 'claude-code'
import type { Card } from '../types'
import { haikuUsd, newCard, reading, setCard } from './cards.ts'
import { EDIT_LINES, MIN_TOKENS, MODEL, NAME, NOTE_WORDS, TITLE } from './constants.ts'
import { FILE_SYSTEM, cache } from './filebase.ts'
import type { Chunk, How, Notes, Source, Task } from './filebase.ts'
import { ask, helperOf, log, usageOf } from './ledger.ts'
import { S } from './state.ts'
import type { Call } from './state.ts'
import { baseName, clean, extOf, hash, slug, tokens } from './text.ts'

function promptFor(src: Source, part: Chunk, i: number, of: number, words: number, task: Task) {
  const first = part.lines[0]!
  const last = part.lines[part.lines.length - 1]!
  const where = src.kind === 'pdf' ? `pages ${first.page}-${last.page}, lines L${first.n}-L${last.n}` : `lines L${first.n}-L${last.n}`
  const cite =
    src.kind === 'pdf'
      ? 'Cite places as p.<page> L<start>-L<end>. "=== Page N ===" lines mark where each page starts.'
      : 'Cite places as L<start>-L<end>.'
  const what =
    src.kind === 'pdf' || /\.(md|mdx|txt|rst|html?|docx?|rtf|vtt|srt)\b/i.test(src.title ? (src.where ?? '') : src.path)
      ? 'Cover: the headings and sections with where each starts, key facts, numbers, names, dates, definitions and conclusions.'
      : 'Cover: the structure (sections, functions, classes, tables, config blocks) with where each starts, key values and names. For logs: first and last timestamps, each distinct error or warning with a count and where it first and last shows, and anything unusual.'
  return [
    `${src.title ?? `File: ${src.path}`}. Part ${i + 1} of ${of}: ${where}.`,
    ...(task.user ? [`The agent's task (the person's request): ${task.user}`] : []),
    ...(task.assistant ? [`Why the agent is reading this ${src.noun ?? 'file'} (its words just before the read): ${task.assistant}`] : []),
    `Write notes that let the agent do this task without reading the ${src.noun ?? 'file'} itself, and know exactly where to look for the full text.`,
    task.user || task.assistant ? 'Put first what the task needs. Then still cover the whole part, so nothing the task might need is missing.' : '',
    cite,
    what,
    'Quote short exact strings when they matter (ids, error messages, keys, figures).',
    `At most ${words} words.`,
    '<text>',
    part.lines.map(l => `L${l.n}: ${l.text}`).join('\n'),
    '</text>',
  ]
    .filter(Boolean)
    .join('\n')
}

// null: a helper call failed, so the Read goes through as it is. The pane card follows every request.
export async function makeNotes($: EngineInterface, src: Source, before: number, label: string, signal: AbortSignal, task: Task): Promise<Notes | null> {
  const of = src.chunks.length
  const words = Math.max(150, Math.min(600, Math.round(NOTE_WORDS / of)))
  const plainNoun = src.noun ?? 'file'
  const card = await newCard($, { part: 'file', tool: src.tool ?? 'Read', label: src.label ?? baseName(src.path), where: src.where ?? src.path, before, requests: of, phase: 'working', state: reading(0, of) })
  let answered = 0
  try {
    const answers = await Promise.all(
      src.chunks.map((part, i) =>
        ask($, FILE_SYSTEM, promptFor(src, part, i, of, words, task), words * 2 + 300, signal).then(async a => {
          answered += 1
          await setCard($, card, { answered, state: reading(answered, of) })
          return a
        }),
      ),
    )
    const calls: Call[] = []
    const bodies: string[] = []
    for (const [i, { r }] of answers.entries()) {
      calls.push(usageOf(r))
      if (!r.isAnswered || !r.text.trim()) {
        await log($, 'file', 'helper', `part ${i + 1} of ${of} for ${src.path}: ${r.isAnswered ? 'empty' : r.reason}`)
        await setCard($, card, { phase: 'failed', state: `Haiku failed, so Claude got the plain ${plainNoun}`, usd: haikuUsd(calls) })
        return null
      }
      const part = src.chunks[i]!
      const first = part.lines[0]!
      const last = part.lines[part.lines.length - 1]!
      const head =
        of === 1 ? '' : src.kind === 'pdf' ? `## Pages ${first.page}-${last.page} (L${first.n}-L${last.n})\n` : `## Lines ${first.n}-${last.n}\n`
      bodies.push(`${head}${clean(r.text)}`)
    }
    const helper = helperOf(answers[0]?.model ?? MODEL, calls)
    const notes: Notes = { body: bodies.join('\n\n'), about: src.about, covers: src.covers, exact: src.exact, before, helper, detail: null, label, full: src.full, ...(src.noun && { noun: src.noun }) }
    const text = frame(src.path, notes, 'fresh')
    await setCard($, card, { phase: 'done', state: 'Done. Claude got these notes', after: tokens(text), notes: text, usd: haikuUsd(calls), full: src.full })
    lastCard.set(src.path, card)
    return notes
  } finally {
    if (card.phase === 'working') await setCard($, card, { phase: 'failed', state: `Something broke, so Claude got the plain ${plainNoun}` })
  }
}

// The card a fresh set of notes drew, so recordFile can add its detail file.
export const lastCard = new Map<string, Card>()

// What Claude reads: a header that says who wrote the notes and for what, the notes, and when to read exact lines.
export function frame(path: string, n: Notes, how: How) {
  const output = n.noun === 'output'
  const noun = output ? 'output' : 'file'
  const who =
    how === 'fresh'
      ? `Haiku (a helper model) read this ${noun} for this task and wrote these notes.`
      : how === 'kept'
        ? `Haiku (a helper model) wrote these notes earlier in this chat. The ${noun} has not changed since.`
        : `Haiku (a helper model) wrote these notes in an earlier chat. The ${noun} has not changed since.`
  const again = output ? 'run the command again or read the saved output' : 'read the file again'
  const covers = `${n.covers}${how === 'fresh' ? ' and were written for this task' : ''}. You do not need to ${again} to check them.`
  const subject = output ? `the output of \`${n.label}\`` : path
  const thing = output ? 'the saved output' : extOf(path) === 'pdf' ? 'these pages' : 'this file'
  const full = output
    ? `Reading all or most of ${thing} again returns these same notes. For the exact text of all of it, ask the person to type /input-router full, then read it again.`
    : `Reading ${thing} again, or a range of ${EDIT_LINES} lines or more or over about ${MIN_TOKENS.toLocaleString('en-US')} tokens, returns these same notes. For the exact text of all of it, ask the person to type /input-router full, then read it again.`
  return [`[${TITLE}] Notes on ${subject}. ${who}`, n.about, '', n.body, '', covers, n.exact, full].join('\n')
}

// Notes are kept on disk by path, change time and size, so a reopened chat does not pay Haiku again. The format
// version is in the name: notes written before the 2026-11-03 wording are skipped (left on disk), never served.
const NOTES_V = 2
const notesFile = (path: string, key: string) => `${S.home}/.claude/mods-logs/${NAME}/notes/${slug(path)}-${hash(`v${NOTES_V}|${key}`)}.json`

async function loadNotes($: EngineInterface, path: string, key: string): Promise<Notes | undefined> {
  try {
    const file = notesFile(path, key)
    if (!(await $.fs.exists(file))) return undefined
    const o = JSON.parse(String(await $.fs.read(file))) as Record<string, unknown>
    if (o.v !== NOTES_V || o.key !== key || typeof o.body !== 'string' || typeof o.before !== 'number') return undefined
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    return {
      body: o.body,
      about: str(o.about),
      covers: str(o.covers) || 'These notes cover the whole file',
      exact: str(o.exact),
      before: o.before,
      helper: null,
      detail: typeof o.detail === 'string' ? o.detail : null,
      label: String(o.label ?? baseName(path)),
      full: str(o.full) || path,
    }
  } catch (err) {
    await log($, 'file', 'notes file unreadable', err)
    return undefined
  }
}

export async function saveNotes($: EngineInterface, path: string, key: string, n: Notes) {
  try {
    const { helper: _helper, ...rest } = n
    await $.fs.write(notesFile(path, key), JSON.stringify({ v: NOTES_V, key, ...rest }))
  } catch (err) {
    await log($, 'file', 'notes file not saved', err)
  }
}

// Looks in memory, then on disk; makes fresh notes only when neither has them.
export async function notesFor(
  $: EngineInterface,
  path: string,
  key: string,
  make: () => Promise<Notes | null>,
): Promise<{ notes: Notes; how: How } | null> {
  const kept = cache.get(key)
  if (kept) return { notes: kept, how: 'kept' }
  const disk = await loadNotes($, path, key)
  if (disk) {
    cache.set(key, disk)
    return { notes: disk, how: 'disk' }
  }
  const made = await make()
  if (!made) return null
  cache.set(key, made)
  return { notes: made, how: 'fresh' }
}
