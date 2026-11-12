import type { EngineInterface, ModelUsage } from 'claude-code'
import type { CardTool } from '../types'
import { CALL_MS, MODEL, MODEL_ALIAS, NAME, TITLE } from './constants.ts'
import type { Part } from './constants.ts'
import { S, done } from './state.ts'
import type { Call, Done, Helper } from './state.ts'
import { fmt } from './text.ts'

export async function sessionId($: EngineInterface) {
  return String(await $.session.id().catch(() => ''))
}

// A true append (O_APPEND), so lines from the other mods that share the ledger are never lost. If the host
// will not run it, read and write back, and never write over a file that could not be read.
async function append($: EngineInterface, path: string, line: string) {
  try {
    // Once the shell append has failed, do not wait on it again.
    if (S.fellBack) throw new Error(S.fellBack)
    const ran = await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', path], {
      stdin: `${line}\n`,
      timeoutMs: 5000,
    })
    if (ran.exitCode === 0) return
    throw new Error(`exit ${ran.exitCode}: ${ran.stderr.slice(0, 200)}`)
  } catch (err) {
    const first = !S.fellBack
    if (first) S.fellBack = `shell append failed, using read and write: ${err instanceof Error ? err.message : String(err)}`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    await $.fs.write(path, `${old}${line}\n`)
    if (first) await log($, 'mod', S.fellBack)
  }
}

export async function log($: EngineInterface, part: Part | 'mod', what: string, detail: unknown = '') {
  try {
    const msg = detail instanceof Error ? detail.message : String(detail)
    const ts = new Date(await $.clock.now()).toISOString()
    await append($, `${S.home}/.claude/mods-logs/${NAME}.log`, `${ts} ${part} ${what}${msg ? `: ${msg.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`)
  } catch {
    // Nowhere left to report it.
  }
}

type Asked = Awaited<ReturnType<EngineInterface['model']['complete']>>

// One Haiku request. The full id first; if it is refused (an allowlist, or no effort on this model), the
// alias resolves to the session's Haiku.
export async function ask($: EngineInterface, system: string, prompt: string, maxTokens: number, signal: AbortSignal | undefined) {
  const request = { prompt, system, maxTokens, timeoutMs: CALL_MS }
  const opts = signal ? { signal } : undefined
  try {
    const r = await $.model.complete({ model: MODEL, effort: 'low', ...request }, opts)
    if (r.isAnswered || r.reason !== 'api-error') return { model: MODEL, r }
  } catch {
    // The alias is the second try.
  }
  return { model: MODEL_ALIAS, r: (await $.model.complete({ model: MODEL_ALIAS, ...request }, opts)) as Asked }
}

export function usageOf(r: Asked): Call {
  const u = ((r as { usage?: ModelUsage }).usage ?? {}) as Partial<ModelUsage>
  return {
    in: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    out: u.output_tokens ?? 0,
  }
}

export function helperOf(model: string, calls: Call[]): Helper {
  return { model, in: calls.reduce((s, c) => s + c.in, 0), out: calls.reduce((s, c) => s + c.out, 0), calls }
}

// One ledger line per action, in the shape every token-saving mod writes, plus the part.
export async function ledger(
  $: EngineInterface,
  part: Part,
  row: { tool_use_id?: string | null; tool?: CardTool; action: string; before: number; after: number; helper: Helper | null; detail: string | null },
) {
  try {
    const line = {
      ts: new Date(await $.clock.now()).toISOString(),
      session: (await sessionId($)) || null,
      tool_use_id: row.tool_use_id || null,
      mod: NAME,
      part,
      tool: row.tool ?? (part === 'file' ? 'Read' : 'connector'),
      action: row.action,
      before: row.before,
      after: row.after,
      helper: row.helper,
      measured: 'estimated',
      detail: row.detail,
    }
    await append($, `${S.home}/.claude/mods-logs/savings.jsonl`, JSON.stringify(line))
  } catch (err) {
    await log($, part, 'ledger', err)
  }
}

// What /input-router lists, and a toast.
export async function remember($: EngineInterface, d: Omit<Done, 'at'>) {
  const sid = await sessionId($)
  const list = done.get(sid) ?? []
  list.push({ ...d, at: new Date(await $.clock.now()).toISOString().slice(11, 16) })
  if (list.length > 50) list.shift()
  done.set(sid, list)
  void Promise.resolve()
    .then(() => $.ui.toast(`${TITLE} (${d.part}): ${d.label} ${fmt(d.before)} to ${fmt(d.after)} tokens`))
    .catch(() => undefined)
}

export async function status($: EngineInterface, text: string | undefined) {
  try {
    await $.ui.status(text)
  } catch {
    // The status line is a nicety.
  }
}
