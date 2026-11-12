import type { EngineInterface, SessionMessage } from 'claude-code'
import type { Card, CardTool } from '../types'
import { haikuUsd, newCard, reading, setCard } from './cards.ts'
import {
  chunks,
  clip,
  isFiller,
  middle,
  outline,
  pagingOf,
  parse,
  plain,
  textOf,
  trim,
  trimValue,
  wordsOf,
} from './connector-data.ts'
import {
  CORE_NOTE,
  CUT_SHARE,
  FILE_READ_MAX,
  HELPER_MAX_TOKENS,
  MAX_CHUNKS,
  MIN_CHARS,
  MIN_TOKENS,
  MODEL,
  NAME,
  NOTE_MAX,
  OVER_CAP,
  PERSISTED_NOTE,
  PROMPT_CHARS,
  REQUEST_CHARS,
  STRING_CAP,
  TITLE,
  TRIM_ENOUGH_CHARS,
} from './constants.ts'
import type { Task } from './filebase.ts'
import { isSafeSavedPath } from './guards.ts'
import { ask, helperOf, ledger, log, remember, status, usageOf } from './ledger.ts'
import { S } from './state.ts'
import type { Helper, ToolOut } from './state.ts'
import { takeFull } from './switches.ts'
import { clean, fmt, safe, stamp, tokens } from './text.ts'

// What the call was for: the person's last real request and Claude's last words before the call. A short go-on
// reply ("yes", "do it") is stepped over to the request before it; if every reply is one, the newest is used.
// In a subagent the transcript is its own, so the request is the subagent's prompt.
export async function purpose($: EngineInterface, agentId: string | undefined): Promise<Task> {
  let rows: readonly SessionMessage[] = []
  try {
    const got = await $.session.messages(agentId ? { agentId } : {})
    if (Array.isArray(got)) rows = got as readonly SessionMessage[]
  } catch {
    // No transcript: the arguments alone say what the call was for.
  }
  let user = ''
  let filler = ''
  let assistant = ''
  for (let i = rows.length - 1; i >= 0 && !user; i--) {
    const row = rows[i]!
    if (row.role === 'assistant' && !assistant && !filler) assistant = clip(row.text ?? '', PROMPT_CHARS)
    if (row.role !== 'user' || (row.toolResults && row.toolResults.length > 0)) continue
    const text = middle(row.text ?? '', REQUEST_CHARS)
    if (!text) continue
    if (isFiller(text)) filler ||= text
    else user = text
  }
  return { user: user || filler, assistant }
}

const CONNECTOR_SYSTEM = [
  'You help another AI assistant by reading a large tool result it asked for. The assistant sees only your answer, not the raw data.',
  'Return only what the assistant needs for its task.',
  'Rules:',
  '- Copy values exactly: names, ids, emails, numbers, dates, URLs. Never invent, guess or round.',
  '- When the task needs a list of records, keep every record that fits, one compact line each, with the fields the task needs plus the record id and name.',
  '- When the task is unclear, keep one compact line per record with its id, its name and its most telling fields.',
  '- Copy paging and count fields by their exact name and value (for example page_count: 5, count: 33946, has_next_page: true). Never write "page X of Y", a page total, or what a paging field means. Never work out a number the data does not state.',
  '- No preamble and no closing summary.',
  '- The last line is "Not kept:" and then the kinds of fields you left out, in a few words.',
].join('\n')

async function extract(
  $: EngineInterface,
  parts: string[],
  task: { tool: string; args: string; user: string; assistant: string; shape: string },
  signal: AbortSignal | undefined,
  onAnswer: () => Promise<void>,
): Promise<{ text: string; helper: Helper } | { error: string; helper: Helper }> {
  const head = [
    'Task context',
    `The person's last message: ${task.user || '(none)'}`,
    `The assistant's words before the call: ${task.assistant || '(none)'}`,
    `Tool: ${task.tool}`,
    `Arguments: ${task.args}`,
  ].join('\n')
  const asks = parts
    .slice(0, MAX_CHUNKS)
    .map((part, i) =>
      ask($, CONNECTOR_SYSTEM, `${head}\n\nTool result (${task.shape}${parts.length > 1 ? `, part ${i + 1} of ${parts.length}` : ''}):\n${part}`, HELPER_MAX_TOKENS, signal).then(
        async a => {
          await onAnswer()
          return a
        },
      ),
    )
  const answers = await Promise.all(asks)
  const helper = helperOf(answers[0]?.model ?? MODEL, answers.map(a => usageOf(a.r)))
  const texts: string[] = []
  for (const { r } of answers) {
    if (!r.isAnswered) return { error: r.reason, helper }
    texts.push(clean(r.text))
  }
  if (texts.every(t => !t)) return { error: 'empty-reply', helper }
  if (parts.length > MAX_CHUNKS) {
    texts.push(`(Only the first ${MAX_CHUNKS} of ${parts.length} parts were read. The rest is only in the file.)`)
  }
  return { text: texts.join('\n\n'), helper }
}

export async function connector(
  $: EngineInterface,
  e: Record<string, unknown> & { tool_use_id?: string },
  tool: string,
  ran: ToolOut,
  signal: AbortSignal | undefined,
  held: { card?: Card },
  // A Bash command's JSON output (curl of an API): the card and ledger name the command, not a connector.
  shown?: { label: string; where: string; tool: CardTool },
) {
  const got = textOf(ran.result)
  if ('skip' in got) {
    if (got.skip !== 'image') await log($, 'connector', 'pass', `${tool}: result is ${got.skip}`)
    return ran
  }

  // Over core's cap the result is a note with the path of the file core saved: read that file.
  let texts = got.texts
  let raw = texts.join('\n')
  let file = ''
  // Over the cap, Claude gets core's note, not the data. So the note is the honest "before".
  let noteText = ''
  const found = raw.length < NOTE_MAX ? (CORE_NOTE.exec(raw) ?? PERSISTED_NOTE.exec(raw)) : null
  const note = found && isSafeSavedPath(found[1]!, S.home) ? found : null
  if (note) {
    file = note[1]!
    try {
      const st = await $.fs.stat(file)
      if (st.size > FILE_READ_MAX) {
        await log($, 'connector', 'pass', `${tool}: core file is ${st.size} bytes, over the read limit`)
        return ran
      }
      noteText = raw
      raw = String(await $.fs.read(file))
      texts = [raw]
    } catch (err) {
      await log($, 'connector', 'pass', `${tool}: core file unreadable: ${err instanceof Error ? err.message : String(err)}`)
      return ran
    }
  } else if (raw.length < NOTE_MAX && raw.includes(OVER_CAP)) {
    await log($, 'connector', 'pass', `${tool}: core says the result is over its cap, but its note has no saved-file path: ${clip(raw, 300)}`)
    return ran
  }
  if (raw.length < MIN_CHARS) {
    // The connector limit stays at 16,000 characters (about 4,000 tokens); files and shell reads use 2,000 tokens.
    if (raw.length >= MIN_CHARS / 4) await log($, 'connector', 'pass', `${tool}: result under the connector limit (${fmt(raw.length)} characters, limit ${fmt(MIN_CHARS)} characters; files and shell reads use ${fmt(MIN_TOKENS)} tokens)`)
    return ran
  }
  if (await takeFull($)) {
    await log($, 'connector', 'full', `${tool}: let through whole by /input-router full`)
    return ran
  }

  const now = await $.clock.now()
  const server = shown ? 'bash' : (tool.split('__')[1] ?? 'mcp')
  const short = shown?.label ?? (tool.split('__').slice(2).join('__') || tool)
  const args = Object.fromEntries(Object.entries(e).filter(([k]) => !['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent'].includes(k)))
  const argsText = clip(JSON.stringify(args), PROMPT_CHARS)
  const task = await purpose($, typeof e.agentId === 'string' ? e.agentId : undefined)

  // Save the full result, unless core already did.
  const { data, text, blocks } = parse(texts)
  if (!file) {
    file = `${S.home}/.claude/mods-logs/${NAME}/results/${stamp(now)}-${safe(server)}-${safe(short)}.${data === undefined ? 'txt' : 'json'}`
    try {
      await $.fs.write(file, data !== undefined && texts.length > 1 ? JSON.stringify(data) : raw)
    } catch (err) {
      await log($, 'connector', 'pass', `${tool}: could not save the full result: ${err instanceof Error ? err.message : String(err)}`)
      return ran
    }
  }

  // Plain code first: drop fields nobody uses, empty values and pictures written as text. No text is cut here,
  // so the path choice and Haiku both see every long text whole.
  const words = wordsOf(`${task.user} ${task.assistant} ${argsText}`)
  let t = trim(words, Infinity)
  const trimmedData = data === undefined ? undefined : trimValue(data, t)
  let trimmed = trimmedData === undefined ? plain(text) : JSON.stringify(trimmedData)
  // Cutting long text values is fine only when the cut is a small share. Otherwise the content is in that text.
  if (trimmed.length > TRIM_ENOUGH_CHARS && data !== undefined) {
    const tc = trim(words, STRING_CAP)
    const capped = JSON.stringify(trimValue(data, tc))
    if (capped.length <= TRIM_ENOUGH_CHARS && tc.cutChars <= trimmed.length * CUT_SHARE) {
      t = tc
      trimmed = capped
    }
  }
  const full = tokens(raw)
  // Over core's cap, core shows Claude a short preview and the saved path, and Claude then reads the saved file.
  // So `before` is the saved file, not the preview: counting the preview made savings negative.
  const before = full
  const kind = data === undefined ? 'text' : `JSON, ${outline(data)}`
  const removed = [...t.removed].slice(0, 20)
  const removedLine = removed.length > 0 ? `Fields left out (still in the file): ${removed.join(', ')}${t.removed.size > 20 ? ', ...' : ''}.` : ''
  const coreSaved = !note
    ? ''
    : noteText.includes('contains only the first')
      ? ' Claude had saved it to a file because it was over its size cap, and it cut that file short: the end of the data is missing.'
      : ' Claude had saved it to a file because it was over its size cap.'
  const shape = blocks
    ? `a JSON list of ${blocks} text blocks. The data is in the text of each block (jq -r '.[].text')${data === undefined ? '' : `, and it is JSON, ${outline(data)}`}`
    : kind
  // The saved file is for a field the reply does not have, never for checking the reply.
  const whereHaiku = `The full result is saved here: ${file} (${shape}). Use it only for a field this note does not list, not to re-check the note (jq or python through Bash).`
  const whereTrim = `The full result is saved here: ${file} (${shape}). Nothing below is summarised: only the fields named above were left out. Use the file only for one of those fields (jq or python through Bash).`
  const steps = [
    'Empty values were dropped.',
    t.unpacked > 0 ? 'JSON written inside text fields was unpacked.' : '',
    t.cutChars > 0 ? `${t.cut} text values over ${STRING_CAP.toLocaleString('en-US')} characters were cut.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  let reply = ''
  let how = ''
  let helper: Helper | null = null
  if (trimmed.length <= TRIM_ENOUGH_CHARS) {
    how = 'trim'
    reply = [
      `[${TITLE}] ${tool}: trimmed this result from about ${fmt(full)} to ${fmt(tokens(trimmed))} tokens.${coreSaved} ${removedLine} ${steps}`.replace(/ {2,}/g, ' '),
      whereTrim,
      '',
      trimmed,
    ].join('\n')
  } else {
    await status($, `${TITLE}: Haiku is reading ${short} (about ${fmt(tokens(trimmed))} tokens)`)
    const parts = chunks(trimmedData, trimmed)
    const asked = Math.min(parts.length, MAX_CHUNKS)
    const card = await newCard($, { part: 'connector', tool: shown?.tool ?? 'connector', label: short, where: shown?.where ?? tool, before, requests: asked, phase: 'working', state: reading(0, asked), full: file })
    held.card = card
    let answered = 0
    const got2 = await extract(
      $,
      parts,
      { tool, args: argsText, ...task, shape: data === undefined ? 'text' : 'JSON, trimmed: fields nobody uses and empty values removed' },
      signal,
      async () => {
        answered += 1
        await setCard($, card, { answered, state: reading(answered, asked) })
      },
    )
    helper = got2.helper
    await setCard($, card, { usd: haikuUsd(helper.calls) })
    if ('error' in got2) {
      await log($, 'connector', 'helper failed', `${tool}: ${got2.error}`)
      if (note || trimmed.length >= raw.length) {
        await status($, undefined)
        await setCard($, card, { phase: 'failed', state: 'Haiku failed, so Claude got the plain result' })
        return ran
      }
      how = 'trim, helper failed'
      reply = [
        `[${TITLE}] ${tool}: the helper model failed, so this is the trimmed result (about ${fmt(tokens(trimmed))} of ${fmt(full)} tokens). ${removedLine}`,
        whereTrim,
        '',
        trimmed,
      ].join('\n')
    } else {
      how = 'haiku'
      const paging = pagingOf(trimmedData ?? data)
      const whole = parts.length <= MAX_CHUNKS ? 'read the whole result for this task' : `read the first ${MAX_CHUNKS} of ${parts.length} parts for this task`
      reply = [
        `[${TITLE}] ${tool}: this result was about ${fmt(full)} tokens, so Haiku (a helper model) ${whole} and kept what the task needs. This note is the answer to use: you do not need to check it against the saved file.${coreSaved} ${removedLine}`.trim(),
        whereHaiku,
        ...(paging ? [paging] : []),
        '',
        got2.text,
      ].join('\n')
    }
  }

  const after = tokens(reply)
  if (after >= before) {
    await status($, undefined)
    await setCard($, held.card, { phase: 'failed', state: 'The notes were not shorter, so Claude got the plain result' })
    return ran
  }

  const detail = `${S.home}/.claude/mods-logs/${NAME}/${stamp(now)}-${safe(short)}.md`
  try {
    await $.fs.write(
      detail,
      [
        `# ${TITLE} (connector): ${tool}`,
        '',
        `- Arguments: ${argsText}`,
        `- Full result: ${file}${note ? ' (saved by Claude, over its MCP size cap)' : ''}`,
        `- Shape: ${shape}`,
        `- Path: ${how}`,
        note
          ? `- Before: about ${before} tokens (the file core saved, ${raw.length} characters; core's own note was ${noteText.length} characters). After: about ${after} tokens (${reply.length} characters)`
          : `- Before: about ${before} tokens (${raw.length} characters). After: about ${after} tokens (${reply.length} characters)`,
        `- Removed fields: ${[...t.removed].join(', ') || 'none'}`,
        `- Long text values cut: ${t.cutChars > 0 ? t.cut : 0}. JSON text fields unpacked: ${t.unpacked}`,
        helper ? `- Helper: ${helper.model}, ${helper.in} in, ${helper.out} out, ${helper.calls.length} requests (${helper.calls.map(c => c.in).join(', ')} in)` : '- Helper: none',
      ].join('\n') + '\n',
    )
  } catch {
    // The detail file is optional.
  }
  await ledger($, 'connector', {
    tool_use_id: e.tool_use_id,
    tool: shown?.tool ?? 'connector',
    action: `${how} ${short}${note ? ` (over the core cap: before is the ${fmt(full)}-token file core saved, not its ${fmt(tokens(noteText))}-token preview)` : ''}`,
    before,
    after,
    helper,
    detail,
  })
  await log($, 'connector', how, `${tool}: ${raw.length} chars${note ? ` from the core file (note ${noteText.length} chars)` : ''}, ${before} -> ${after} tokens`)
  await remember($, { part: 'connector', label: short, before, after, how: note ? `${how}, over the core cap` : how })
  await status($, `${TITLE}: ${short} ${fmt(before)} to ${fmt(after)} tokens`)
  await setCard($, held.card, {
    phase: how === 'haiku' ? 'done' : 'failed',
    state: how === 'haiku' ? 'Done. Claude got this note' : 'Haiku failed, so Claude got the trimmed result',
    after,
    notes: reply,
    detail,
  })
  return { result: reply }
}
