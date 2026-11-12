import type { EngineInterface } from 'claude-code'
import type { Card } from '../types'
import { connector, purpose } from './connector.ts'
import { clip, parseOne } from './connector-data.ts'
import {
  BASH_MIN_CHARS,
  FILE_READ_MAX,
  FLAG_VALUE,
  HELPERS,
  MIN_TOKENS,
  NAME,
  READERS,
  REMIND_LINES,
  STARTERS,
  STRUCTURE,
} from './constants.ts'
import { chunk, fit, isInstruction, lineRange, noted, notedKey, notesKey, toLines } from './filebase.ts'
import type { Source } from './filebase.ts'
import { fileNotes, pass, piece, recordFile, remindLine } from './fileread.ts'
import { log, sessionId } from './ledger.ts'
import { makeNotes, notesFor } from './notes.ts'
import { S } from './state.ts'
import type { ToolOut } from './state.ts'
import { partOn, takeFull } from './switches.ts'
import { baseName, fmt, hash, safe, stamp, tokens } from './text.ts'

// ============================================================================
// Bash: a shell read of a file or an API
// ============================================================================

type BashOut = { stdout: string; stderr: string; interrupted: boolean; isImage?: boolean; backgroundTaskId?: string; returnCodeInterpretation?: string; persistedOutputPath?: string }

// The steps of a command, one per pipeline or list step, and one per $( ) inside it: the program, then its words.
// Heredoc bodies and quoted text are blanked first, so a | or ; inside them does not split the command. Steps that
// only set a variable, or are only loop words or comments, have no program. Anything odd is never a reader, so passes.
function stepsOf(cmd: string): string[][] {
  const plain = cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '<<Q')
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q')
  const out: string[][] = []
  for (const step of plain.split(/\|\||&&|[|;\n`]|\$\(|\)/)) {
    const words = step.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0 || words[0]!.startsWith('#') || STRUCTURE.has(words[0]!)) continue
    let i = 0
    while (i < words.length) {
      const w = words[i]!
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) i += 1
      else if (STARTERS.has(w)) {
        i += 1
        while (i < words.length && words[i]!.startsWith('-')) i += FLAG_VALUE.has(words[i]!) ? 2 : 1
      } else break
    }
    if (i < words.length) out.push([baseName(words[i]!).replace(/^[({]+/, ''), ...words.slice(i + 1)])
  }
  return out
}

export function programs(cmd: string): string[] {
  return stepsOf(cmd).map(s => s[0]!)
}

// Guard C: a grep or rg that lists files or counts matches finds where things are; it reads nothing. -c counts,
// but -C, -A and -B add context lines, so they make it a read. Flag clusters (-rl, -nC3) count letter by letter.
function grepFlags(prog: string, words: readonly string[]) {
  let find = false
  let context = false
  for (const w of words) {
    if (w === '--') break
    if (/^--(files|files-with-matches|files-without-match|count|count-matches)$/.test(w)) find = true
    else if (/^--(context|after-context|before-context)(=|$)/.test(w)) context = true
    else if (/^-[A-Za-z]/.test(w)) {
      const letters = w.slice(1).replace(/[^A-Za-z].*$/, '')
      if (/[ABC]/.test(letters)) context = true
      // rg -L follows links; only grep's -L lists files.
      if ((prog === 'rg' ? /[lc]/ : /[lLc]/).test(letters)) find = true
    }
  }
  return { find, context }
}

const GREPS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag'])
const FINDERS = new Set(['find', 'ls', 'fd', 'locate', 'mdfind', 'tree'])

// A command that finds files or counts matches: every reader in it is a listing or counting grep, or it is only
// find, ls and helpers.
function findStyle(cmd: string) {
  const steps = stepsOf(cmd)
  if (steps.length === 0) return false
  const readers = steps.filter(st => READERS.has(st[0]!))
  if (readers.length === 0) return steps.some(st => FINDERS.has(st[0]!)) && steps.every(st => FINDERS.has(st[0]!) || HELPERS.has(st[0]!))
  return readers.every(st => {
    if (!GREPS.has(st[0]!)) return false
    const f = grepFlags(st[0]!, st.slice(1))
    return f.find && !f.context
  })
}

// Scripts that may print a file. They stay out of the reader list; a big output from one is logged so it can be counted.
const SCRIPTS = /^(python[0-9.]*|node|deno|bun|ruby|perl|php|osascript)$/

// Only file and API reads are touched: never builds, tests, git, or anything Claude needs exactly as it ran.
export function isReader(cmd: string) {
  const progs = programs(cmd)
  return progs.length > 0 && progs.every(p => READERS.has(p) || HELPERS.has(p)) && progs.some(p => READERS.has(p))
}

// `cat /abs/file` and nothing else: the same as a Read of that file.
function catFile(cmd: string): string | null {
  const m = /^\s*cat\s+(?:'([^']+)'|"([^"]+)"|(\/\S+))\s*$/.exec(cmd)
  const path = m ? (m[1] ?? m[2] ?? m[3]) : undefined
  return path?.startsWith('/') ? path : null
}

// Whether the command names this text as a whole word: a path, not part of a longer name.
function mentions(cmd: string, text: string) {
  for (let i = cmd.indexOf(text); i >= 0; i = cmd.indexOf(text, i + 1)) {
    const before = i === 0 ? ' ' : cmd[i - 1]!
    const after = cmd[i + text.length] ?? ' '
    if (/[\s'"=(<]/.test(before) && /[\s'";&|)>]/.test(after)) return true
  }
  return false
}

// A file this loop already has notes for, named in the command: by full path, by its path from a folder the
// command cds into, or by the end of its path (fixtures/big.log). Quoted paths with spaces count.
function notedIn(sid: string, agentId: string | undefined, cmd: string): { path: string; from: string } | null {
  const prefix = `${sid}\n${agentId ?? ''}\n`
  const cds = [...cmd.matchAll(/\bcd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g)].map(m => (m[1] ?? m[2] ?? m[3]!).replace(/\/$/, ''))
  const words = cmd.split(/[\s'"=<>|;&()]+/).filter(w => w.includes('/') && !w.startsWith('/'))
  for (const [key, from] of noted) {
    if (!key.startsWith(prefix)) continue
    const path = key.slice(prefix.length)
    const named =
      mentions(cmd, path) ||
      cds.some(d => path.startsWith(`${d}/`) && mentions(cmd, path.slice(d.length + 1))) ||
      words.some(w => path.endsWith(`/${w.replace(/^\.\//, '')}`))
    if (named) return { path, from }
  }
  return null
}

// Line text without a line-number prefix (cat -n, grep -n, nl), so the same line matches either way.
const bare = (line: string) => line.replace(/^\s*\d+(?:[\t:|]|\s{2,})/, '').trim()

// Files the command names: absolute paths, ~/ paths, and paths under a folder the command cds into or the chat's
// folder. Only files that exist, at most 6.
async function namedFiles($: EngineInterface, cmd: string): Promise<string[]> {
  const words = [...cmd.matchAll(/'([^']+)'|"([^"]+)"|([^\s'";&|<>()]+)/g)].map(m => m[1] ?? m[2] ?? m[3]!)
  const full = (d: string) => (d.startsWith('~/') ? `${S.home}${d.slice(1)}` : d)
  const cds = [...cmd.matchAll(/\bcd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g)].map(m => full((m[1] ?? m[2] ?? m[3]!).replace(/\/$/, '')))
  const bases = [...cds.filter(d => d.startsWith('/')), ...(S.cwd ? [S.cwd] : [])]
  const out: string[] = []
  for (const raw of words) {
    if (out.length >= 6) break
    if (raw.startsWith('-') || !/[/.]/.test(raw) || raw.includes('*')) continue
    const w = full(raw)
    for (const path of w.startsWith('/') ? [w] : bases.map(d => `${d}/${w.replace(/^\.\//, '')}`)) {
      if (out.includes(path) || !(await $.fs.exists(path).catch(() => false))) continue
      const st = await $.fs.stat(path).catch(() => null)
      if (st?.kind === 'file') out.push(path)
    }
  }
  return out
}

// Programs whose output keeps the file's lines in order: a line range can be read straight from the command.
const RANGE_PROGS = new Set(['cat', 'nl', 'sed', 'head', 'tail', 'awk', 'cut'])

// The line range a plain sed -n 'A,Bp', head -n N, tail -n N or awk 'NR>=A && NR<=B' prints, or the whole file
// for a plain cat or nl. null: some other shape.
function rangeIn(cmd: string, total: number): { from: number; to: number } | null {
  if (!programs(cmd).every(p => RANGE_PROGS.has(p) || HELPERS.has(p))) return null
  let from = 1
  let to = total
  let m: RegExpExecArray | null
  if ((m = /\bsed\s+-n\s+['"]?(\d+)(?:\s*,\s*(\d+|\$))?\s*p['"]?/.exec(cmd))) {
    from = Number(m[1])
    to = m[2] === undefined ? from : m[2] === '$' ? total : Number(m[2])
  } else if ((m = /\bawk\s+['"]\s*NR\s*>=?\s*(\d+)\s*&&\s*NR\s*<=?\s*(\d+)/.exec(cmd))) {
    from = Number(m[1])
    to = Number(m[2])
  } else if ((m = /\bhead\s+(?:-n\s*|-)(\d+)\b/.exec(cmd))) {
    to = Number(m[1])
  } else if ((m = /\btail\s+(?:-n\s*|-)(\+?)(\d+)\b/.exec(cmd))) {
    from = m[1] ? Number(m[2]) : total - Number(m[2]) + 1
  } else if (!programs(cmd).every(p => p === 'cat' || p === 'nl' || p === 'cut' || HELPERS.has(p))) {
    return null
  }
  from = Math.max(1, from)
  to = Math.min(total, to)
  return from <= to ? { from, to } : null
}

// The one file a shell print of part of a file comes from, and which of its lines it printed. A plain range is
// read from the command; anything else is matched line by line (each file line used once, so repeats do not
// overcount). The output must come mostly (half or more) from that file.
async function fromFile($: EngineInterface, files: readonly string[], cmd: string, text: string): Promise<{ path: string; lines: number[]; total: number } | null> {
  const outLines = text.split('\n').map(bare)
  const outCount = outLines.filter(Boolean).length
  if (outCount === 0) return null
  let best: { path: string; lines: number[]; total: number } | null = null
  for (const path of files) {
    const st = await $.fs.stat(path).catch(() => null)
    if (!st || st.size > FILE_READ_MAX) continue
    const body = String(await $.fs.read(path))
    if (body.includes('\u0000')) continue
    const fileLines = body.split('\n')
    const total = fileLines.length
    const range = files.length === 1 ? rangeIn(cmd, total) : null
    let lines: number[]
    let own = 1
    if (range) lines = lineRange(range.from, range.to - range.from + 1)
    else {
      const at = new Map<string, number[]>()
      fileLines.forEach((l, i) => {
        const b = bare(l)
        if (b) at.set(b, [...(at.get(b) ?? []), i + 1])
      })
      lines = []
      for (const o of outLines) {
        const free = o ? at.get(o) : undefined
        if (free && free.length > 0) lines.push(free.shift()!)
      }
      own = lines.length / outCount
    }
    if (own >= 0.5 && lines.length > (best?.lines.length ?? 0)) best = { path, lines, total }
  }
  return best
}

// Where a reader command sends its output to disk instead of the chat: curl -o / --output, wget -O, > and >>, tee.
function diskTargets(cmd: string) {
  // Quoted text is held aside (a > inside an awk or grep pattern is not a redirect) and put back in the targets.
  const quotes: string[] = []
  const flat = cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '<<Q')
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, q => `\u0001${quotes.push(q.slice(1, -1)) - 1}\u0001`)
  const word = String.raw`([^\s;&|<>]+)`
  const out: string[] = []
  for (const step of flat.split(/\|\||&&|[|;\n]/)) {
    const words = step.trim().split(/\s+/).filter(w => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) && !STARTERS.has(w))
    const prog = baseName(words[0] ?? '')
    const found: RegExpMatchArray[] = []
    // -o is curl's and wget's output file; for grep and rg it means "only the match".
    if (prog === 'curl' || prog === 'wget') found.push(...step.matchAll(new RegExp(String.raw`(?:^|\s)(?:-o|--output|-O|--output-document)(?:\s+|=)` + word, 'g')))
    // A reader's output sent to a file. A heredoc step (cat > f <<EOF) writes a file; it reads nothing.
    if (READERS.has(prog) && !step.includes('<<')) found.push(...step.matchAll(new RegExp(String.raw`(?<![0-9&>])>>?\s*` + word, 'g')))
    if (prog === 'tee') found.push(...step.matchAll(new RegExp(String.raw`\btee\s+(?:-a\s+)?` + word, 'g')))
    out.push(...found.map(m => m[1]!.replace(/\u0001(\d+)\u0001/g, (_, n: string) => quotes[Number(n)] ?? '')))
  }
  return out.filter(t => t && t !== '-' && !t.startsWith('/dev/'))
}

// A big output from a command that is not a file or API read (python3, node, git, a build): left alone, logged.
export async function passOther($: EngineInterface, cmd: string, ran: ToolOut) {
  const r = ran.result as BashOut | undefined
  if (!r || typeof r.stdout !== 'string') return
  const size = r.persistedOutputPath ? Math.round(((await $.fs.stat(r.persistedOutputPath).catch(() => null))?.size ?? 0) / 4) : tokens(r.stdout)
  const progs = [...new Set(programs(cmd).filter(p => !HELPERS.has(p)))]
  if (progs.some(p => SCRIPTS.test(p))) await pass($, size, `unrouted script read (~${fmt(size)} tokens, ${progs.join(', ')}): ${clip(cmd, 200)}`)
  else if (findStyle(cmd)) await pass($, size, `find-style grep (~${fmt(size)} tokens, ${progs.join(', ')}): ${clip(cmd, 200)}`)
  else await pass($, size, `Bash output left alone (~${fmt(size)} tokens), not a file or API read (${progs.join(', ') || 'no program found'}): ${clip(cmd, 200)}`)
}

// A reader command that wrote its output to a file: nothing came into the chat, so the log says where it went.
export async function logDiskWrite($: EngineInterface, cmd: string) {
  for (const target of diskTargets(cmd)) {
    const st = target.startsWith('/') ? await $.fs.stat(target).catch(() => null) : null
    const size = st ? `, ~${fmt(Math.round(st.size / 4))} tokens` : ''
    await log($, 'file', 'pass', `Bash output written to disk (${target}${size}), not into the chat: ${clip(cmd, 200)}`)
  }
}

function outputSource(saved: string, cmd: string, text: string): Source {
  const all = toLines(text, 1)
  const { kept, gap } = fit(all)
  const label = clip(cmd.replace(/\s+/g, ' ').trim(), 80)
  return {
    path: saved,
    kind: 'text',
    title: `Output of the shell command \`${clip(cmd, 400)}\`, saved at ${saved}`,
    about: `Command output, ${fmt(all.length)} lines. ${gap || `Haiku read all ${fmt(all.length)} lines.`} Refs like L120-L140 are line numbers in the saved output.`,
    covers: gap ? 'These notes cover every line Haiku read' : 'These notes cover the whole output',
    exact: `The full output is saved at ${saved}. Read exact lines of it (Read with offset and limit) only when you must quote exact text${gap ? ', or for the lines Haiku skipped' : ''}. Short ranges like that pass through untouched.`,
    full: saved,
    chunks: chunk(kept),
    label,
    where: cmd,
    tool: 'Bash',
    noun: 'output',
  }
}

// What Claude gets in place of the command's output: a Bash result with the notes as its output.
const bashAnswer = (r: BashOut, text: string) => ({
  result: { ...r, stdout: text, stderr: '', persistedOutputPath: undefined, persistedOutputSize: undefined, rawOutputPath: undefined },
})

export async function bashPart(
  $: EngineInterface,
  e: { tool_use_id?: string; agentId?: string; command: string },
  ran: ToolOut & { context?: readonly string[] },
  signal: AbortSignal,
  held: { card?: Card },
): Promise<unknown> {
  const r = ran.result as BashOut | undefined
  const cmd = e.command
  if (!r || typeof r.stdout !== 'string') return ran
  if (r.interrupted || r.isImage || r.backgroundTaskId || r.returnCodeInterpretation) {
    const why = r.interrupted ? 'interrupted' : r.isImage ? 'an image' : r.backgroundTaskId ? 'moved to the background' : `exit status note (${r.returnCodeInterpretation})`
    await pass($, tokens(r.stdout), `Bash output left alone, ${why}: ${clip(cmd, 200)}`)
    return ran
  }
  if (!isReader(cmd)) return ran
  await logDiskWrite($, cmd)
  // Guard C: grep -l, grep -c, rg --files: it finds where things are and reads nothing.
  if (findStyle(cmd)) {
    const size = r.persistedOutputPath ? Math.round(((await $.fs.stat(r.persistedOutputPath).catch(() => null))?.size ?? 0) / 4) : tokens(r.stdout)
    await pass($, size, `find-style grep (~${fmt(size)} tokens): ${clip(cmd, 200)}`)
    return ran
  }
  let text = r.stdout
  if (r.persistedOutputPath) {
    const st = await $.fs.stat(r.persistedOutputPath)
    if (st.size > FILE_READ_MAX) {
      await log($, 'file', 'pass', `Bash output is ${st.size} bytes, over the read limit: ${clip(cmd, 200)}`)
      return ran
    }
    text = String(await $.fs.read(r.persistedOutputPath))
  }
  const files = await namedFiles($, cmd)
  // Guard B: a skill, CLAUDE.md, AGENTS.md, memory or settings file reaches Claude word for word.
  const rule = files.find(isInstruction)
  if (rule) {
    await pass($, tokens(text), `${rule}: instruction file, passed word for word: ${clip(cmd, 200)}`)
    return ran
  }
  const big = Boolean(r.persistedOutputPath) || text.length >= BASH_MIN_CHARS
  // A plain print of part of one file (sed -n, head, tail, awk NR, cat -n | sed): a piece, as a ranged Read is.
  // A whole `cat` of a big file gets the file notes further down.
  const src = programs(cmd).every(p => RANGE_PROGS.has(p) || HELPERS.has(p)) ? await fromFile($, files, cmd, text) : null
  if (src && !(big && catFile(cmd) === src.path)) {
    const got = await piece($, { ...e, file_path: src.path }, { lines: src.lines, total: src.total, text, what: `shell print of ${fmt(src.lines.length)} lines` }, 'Bash', signal)
    if ('notes' in got) return bashAnswer(r, got.notes)
    const from = noted.get(notedKey(await sessionId($), e.agentId, src.path))
    const line = got.context ?? (from && src.lines.length >= REMIND_LINES ? remindLine(src.path, from) : null)
    if (line) await log($, 'file', 'reminder', `Bash re-read of ${src.path}: ${clip(cmd, 200)}`)
    return line ? { ...ran, context: [...(ran.context ?? []), line] } : ran
  }
  // A shell read of a file whose notes are already in this loop: a long one gets the reminder.
  const hit = notedIn(await sessionId($), e.agentId, cmd)
  if (hit && !big && !(catFile(cmd) === hit.path)) {
    if (text.split('\n').length < REMIND_LINES) return ran
    await log($, 'file', 'reminder', `Bash re-read of ${hit.path}: ${clip(cmd, 200)}`)
    return { ...ran, context: [...(ran.context ?? []), remindLine(hit.path, hit.from)] }
  }
  if (!big) {
    await pass($, tokens(text), `Bash output under the limit (~${fmt(tokens(text))} tokens, limit ${fmt(MIN_TOKENS)}): ${clip(cmd, 200)}`)
    return ran
  }
  if (text.includes('\u0000')) {
    await log($, 'file', 'pass', `Bash output is binary: ${clip(cmd, 200)}`)
    return ran
  }

  // JSON (curl of an API): the connector part's trim, then Haiku.
  if (parseOne(text) !== undefined) {
    if (!(await partOn($, 'connector'))) {
      await log($, 'connector', 'pass', `Bash JSON output left alone, the connector part is off: ${clip(cmd, 200)}`)
      return ran
    }
    const plainRan = { result: text }
    const out = (await connector($, { tool_use_id: e.tool_use_id, command: cmd, ...(e.agentId !== undefined && { agentId: e.agentId }) }, 'Bash', plainRan, signal, held, {
      label: clip(cmd.replace(/\s+/g, ' ').trim(), 80),
      where: cmd,
      tool: 'Bash',
    })) as ToolOut
    return out === plainRan ? ran : bashAnswer(r, String(out.result))
  }

  if (!(await partOn($, 'file'))) {
    await log($, 'file', 'pass', `Bash output left alone, the file part is off: ${clip(cmd, 200)}`)
    return ran
  }
  if (await takeFull($)) {
    await log($, 'file', 'full', `Bash: ${clip(cmd, 200)}`)
    return ran
  }
  const before = tokens(text)

  // `cat /abs/file`: notes on the file itself, shared with Read (kept in memory and on disk). Core has
  // usually saved the output too (it saves anything over about 30,000 characters); the file is the source.
  const file = catFile(cmd)
  if (file) {
    const out = await fileNotes($, { ...e, file_path: file }, before, 'Bash', signal, `whole cat over the limit (~${fmt(before)} tokens, limit ${fmt(MIN_TOKENS)})`)
    return out === null ? ran : bashAnswer(r, out)
  }
  const task = await purpose($, e.agentId)

  // Any other read: save the whole output, and give notes on it. A Read of the saved file reuses these notes.
  const saved = `${S.home}/.claude/mods-logs/${NAME}/results/${stamp(await $.clock.now())}-bash-${safe(programs(cmd).find(p => READERS.has(p)) ?? 'out')}-${hash(cmd)}.txt`
  await $.fs.write(saved, text)
  const stat = await $.fs.stat(saved)
  const key = notesKey(saved, stat, task)
  const got = await notesFor($, saved, key, () => makeNotes($, outputSource(saved, cmd, text), before, clip(cmd.replace(/\s+/g, ' ').trim(), 80), signal, task))
  if (!got) return ran
  return bashAnswer(r, await recordFile($, { ...e, file_path: saved, tool: 'Bash' }, { ...got.notes, before }, got.how))
}
