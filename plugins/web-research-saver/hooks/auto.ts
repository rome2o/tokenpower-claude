import type { EngineInterface } from 'claude-code'
import type { AutoView } from '../types'
import { update } from 'claude-code'
import { autoAtom, busyAtom } from './atoms.ts'
import { ALL_CHARS, AUTO_MIN_COMMENTARY, AUTO_MS, MAX_AUTO, MODEL, NAME } from './constants.ts'
import type { CallResult, WebSearchRecord } from './shapes.ts'
import { countUsage, resultText } from './tools.ts'
import { clean, commas, dollars, money, oneLine, tokens, urlsIn } from './text.ts'
import { append, log, logsDir } from './io.ts'
import { openPane } from './ui.ts'
import { SYSTEM } from './prompts.ts'

export async function addAuto($: EngineInterface, row: AutoView) {
  await update($, autoAtom, list => [row, ...(list ?? [])].slice(0, MAX_AUTO))
}

// Auto mode: the main chat's own WebSearch result, shortened by Haiku to what matters for the query.
// Every link entry stays as it is, so every URL stays. Any failure returns the original result.
export async function shorten($: EngineInterface, query: string, toolUseId: string | undefined, r: CallResult): Promise<CallResult | null> {
  const record = r.result as WebSearchRecord | undefined
  if (r.deny || r.isError || !record || !Array.isArray(record.results)) return null
  const text = resultText(r)
  const before = tokens(text.length)
  const at = await $.clock.now()
  const commentary = record.results.filter((x): x is string => typeof x === 'string').join('\n\n')
  const extra = tokens(commentary.trim().length)
  // Only the commentary can shrink. Under the bar, Haiku would cost more than it saves.
  if (extra <= AUTO_MIN_COMMENTARY) {
    await log($, 'auto', `kept "${oneLine(query, 80)}" as it is, no Haiku call: ${commas(before)} tokens, commentary ${commas(extra)} tokens, at or under ${AUTO_MIN_COMMENTARY}`)
    await addAuto($, { at, query: oneLine(query, 120), status: 'kept', before, after: before, note: extra ? 'small already' : 'nothing to shorten' })
    return null
  }
  const sid = await $.session.id().catch(() => 'unknown')
  // Every Haiku call gets a ledger line, the ones that saved nothing too: they cost money.
  const ledger = async (after: number, result: string, u: { input: number; output: number }) => {
    const line = {
      ts: new Date(at).toISOString(),
      session: sid,
      tool_use_id: toolUseId ?? null,
      mod: NAME,
      action: `auto: ${oneLine(query, 80)}`,
      result,
      before,
      after,
      helper: { model: MODEL, in: u.input, out: u.output },
      measured: 'estimated',
      how: "before: the WebSearch result as the model reads it, chars/4; after: the same text with the commentary swapped for Haiku's shorter one, chars/4 (the same as before when nothing was swapped)",
    }
    await append($, `${logsDir()}/savings.jsonl`, `${JSON.stringify(line)}\n`)
  }
  // Haiku is about to work on this search: show the pane, and the mascot moves until it answers.
  void openPane($)
  await update($, busyAtom, n => (n ?? 0) + 1)
  const m = await $.model
    .complete({
    model: MODEL,
    system: SYSTEM,
    prompt: [
      `Search query: ${query}`,
      '',
      "Below is a web search tool's commentary on its results. Shorten it to the findings that matter for the query.",
      'Keep every number, name, date and URL that bears on the query, each finding next to its URL. Short bullets. At most 250 words. No preamble.',
      '',
      'Commentary:',
      commentary.slice(0, ALL_CHARS),
    ].join('\n'),
    maxTokens: 700,
    // There is no switch for thinking here: low effort is the least the engine can ask for.
    effort: 'low',
    timeoutMs: AUTO_MS,
  })
    .finally(() => update($, busyAtom, n => Math.max(0, (n ?? 0) - 1)))
  const u = countUsage(m.usage)
  const cost = dollars(u.input, u.output)
  if (!m.isAnswered || !m.text.trim()) {
    await log($, 'auto', `Haiku gave no answer for "${oneLine(query, 80)}" (${m.isAnswered ? 'empty' : m.reason}), original kept, cost ${money(cost)}`)
    await ledger(before, 'failed', u)
    await addAuto($, { at, query: oneLine(query, 120), status: 'failed', before, after: before, note: 'Haiku gave no answer, original kept', cost })
    return null
  }
  let short = clean(m.text, 4000)
  // The link entries hold the URLs; a URL only the commentary named is put back by hand.
  const have = new Set([...urlsIn(JSON.stringify(record.results.filter(x => typeof x !== 'string'))), ...urlsIn(short)])
  const lost = urlsIn(commentary).filter(x => !have.has(x))
  if (lost.length) short += `\n\nOther URLs in the results: ${lost.join(' ')}`
  const after = tokens(text.length - commentary.length + short.length)
  if (after >= before) {
    await log($, 'auto', `no saving for "${oneLine(query, 80)}": Haiku's text came to ${commas(after)} tokens against ${commas(before)}, original kept, cost ${money(cost)}`)
    await ledger(before, 'no saving', u)
    await addAuto($, { at, query: oneLine(query, 120), status: 'kept', before, after: before, note: 'no saving', cost })
    return null
  }
  await ledger(after, 'shortened', u)
  await log($, 'auto', `shortened "${oneLine(query, 80)}": ${commas(before)} to ${commas(after)} tokens, cost ${money(cost)}`)
  await addAuto($, { at, query: oneLine(query, 120), status: 'shortened', before, after, cost })
  return { result: { ...record, results: [...record.results.filter(x => typeof x !== 'string'), short] } }
}
