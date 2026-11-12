import type { EngineInterface, ModelUsage } from 'claude-code'
import type { CallResult, Firecrawl, Job, Kit, Link, Plan } from './shapes.ts'
import { S } from './state.ts'
import { exists, log, withTimeout } from './io.ts'
import { ACTION, MAX_PARTS, MAX_QUERIES, MIN_PARTS, MODEL, NAME, PLAN_MS, TOOL_MS, WEBBY } from './constants.ts'
import { oneLine, shortName, urlsIn } from './text.ts'
import type { AgentView, FoundView, RunView, ToolUse } from '../types'
import { update } from 'claude-code'
import { foundAtom, runsAtom } from './atoms.ts'
import { SYSTEM } from './prompts.ts'

// The desktop app's process may not have nvm on its PATH, so look in the usual places by hand.
export async function findFirecrawl($: EngineInterface): Promise<Firecrawl | null> {
  const dirs: string[] = []
  const nvm = `${S.home}/.nvm/versions/node`
  try {
    if (await exists($, nvm)) {
      const versions = (await $.fs.list(nvm)).filter(v => v.kind === 'dir').map(v => v.name)
      versions.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
      for (const v of versions) dirs.push(`${nvm}/${v}/bin`)
    }
  } catch {
    // No nvm here.
  }
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', `${S.home}/.local/bin`, `${S.home}/.npm-global/bin`, `${S.home}/.bun/bin`, `${S.home}/.volta/bin`)
  const nodes = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  for (const dir of dirs) {
    if (!(await exists($, `${dir}/firecrawl`))) continue
    let node = (await exists($, `${dir}/node`)) ? `${dir}/node` : ''
    for (const n of nodes) if (!node && (await exists($, n))) node = n
    if (!node) continue
    return { bin: `${dir}/firecrawl`, node, path: [dir, node.slice(0, node.lastIndexOf('/')), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':') }
  }
  // Last try: the person's own shell knows their PATH.
  try {
    const r = await $.process.run(['/bin/zsh', '-ilc', 'command -v firecrawl; command -v node'], { timeoutMs: 8000 })
    const found = r.stdout.split('\n').map(s => s.trim()).filter(s => s.startsWith('/'))
    const bin = found.find(s => s.endsWith('/firecrawl'))
    const node = found.find(s => s.endsWith('/node'))
    if (bin && node) return { bin, node, path: [bin.slice(0, bin.lastIndexOf('/')), node.slice(0, node.lastIndexOf('/')), '/usr/bin', '/bin'].join(':') }
  } catch {
    // No shell answer either.
  }
  return null
}

export async function refreshTools($: EngineInterface): Promise<Kit> {
  const list = await $.tool.list().catch(() => [])
  const names = new Set(list.map(t => t.name))
  const connectors = list
    .filter(t => t.mcp && !t.name.includes(NAME) && WEBBY.test(t.description) && ACTION.test(t.description))
    .map(t => ({ name: t.name, description: oneLine(t.description, 160) }))
    .slice(0, 12)
  const firecrawl = await findFirecrawl($)
  S.kit = { firecrawl, webSearch: names.has('WebSearch'), webFetch: names.has('WebFetch'), connectors }
  const found: FoundView = {
    at: await $.clock.now(),
    firecrawl: firecrawl?.bin ?? null,
    webSearch: S.kit.webSearch,
    webFetch: S.kit.webFetch,
    connectors: connectors.map(c => shortName(c.name)),
  }
  await update($, foundAtom, () => found)
  return S.kit
}

export async function setRun($: EngineInterface, id: number, change: (r: RunView) => RunView) {
  await update($, runsAtom, list => (list ?? []).map(r => (r.id === id ? change(r) : r)))
}

// Each step goes to the pane and the log, so a stalled run shows where it stopped.
export async function step($: EngineInterface, id: number, text: string) {
  await setRun($, id, r => ({ ...r, step: text }))
  await log($, `run ${id}`, text)
}

export async function used($: EngineInterface, job: Job, name: string, kind: ToolUse['kind'], calls = 1) {
  const hit = job.tools.find(t => t.name === name)
  if (hit) hit.calls += calls
  else job.tools.push({ name, kind, calls })
  const tools = job.tools.map(t => ({ ...t }))
  await setRun($, job.id, r => ({ ...r, tools }))
}

export function countUsage(u: ModelUsage | undefined) {
  if (!u) return { input: 0, output: 0 }
  return { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 }
}

export async function ask($: EngineInterface, job: Job, prompt: string, maxTokens: number, timeoutMs: number) {
  const r = await $.model.complete({ model: MODEL, system: SYSTEM, prompt, maxTokens, timeoutMs })
  const u = countUsage(r.usage)
  job.helperIn += u.input
  job.helperOut += u.output
  await used($, job, MODEL, 'model')
  if (!r.isAnswered) throw new Error(`the worker model did not answer (${r.reason})`)
  return r.text
}

export function cleanQueries(raw: unknown[]) {
  return raw
    .map(q => String(q ?? ''))
    // Strip quotes only around the whole line: a query can start with a quoted phrase.
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().replace(/^(["'])(.*)\1$/, '$2').trim())
    .filter(l => l.length > 2)
}

// The planner picks quick or deep, and writes the queries and the parts. `deep` forces deep.
export async function plan($: EngineInterface, job: Job, question: string, forceDeep: boolean, today: string): Promise<Plan> {
  const fallback: Plan = { mode: forceDeep ? 'deep' : 'quick', queries: [oneLine(question, 200)], parts: forceDeep ? [oneLine(question, 400)] : [], since: null, official: [] }
  try {
    const text = await ask(
      $,
      job,
      [
        `Today is ${today}.`,
        `Research request: ${question}`,
        '',
        forceDeep
          ? 'This request is deep: split it into 2 to 4 separate lines of research.'
          : 'Decide how big it is. "quick": one or two web searches answer it. "deep": it needs 2 to 4 separate lines of research, for example several products, a broad survey, or a comparison across many angles.',
        `Write ${MAX_QUERIES} short web search queries, under 12 words each, that would find the best sources. If the request names a time window, such as "last 7 days", put the month and year in the queries.`,
        'Prefer official sources. For a product, that is its own changelog, release notes, docs or GitHub releases page; for Claude, its docs changelog and https://github.com/anthropics/claude-code/releases. Put up to 2 such page URLs in "official", only URLs you are sure exist, else [].',
        'Set "since" to the first day of the time window the request names, as YYYY-MM-DD, counted back from today. With no window, "since" is null.',
        'For deep, also write 2 to 4 self-contained sub-questions, one per line of research. For quick, parts is [].',
        'Answer with JSON only, in this form:',
        '{"mode":"quick","queries":["...","..."],"parts":[],"official":[],"since":null}',
      ].join('\n'),
      400,
      PLAN_MS,
    )
    const json = /\{[\s\S]*\}/.exec(text)?.[0]
    if (!json) throw new Error('the planner gave no JSON')
    const data = JSON.parse(json) as { mode?: unknown; queries?: unknown; parts?: unknown; official?: unknown; since?: unknown }
    const queries = cleanQueries(Array.isArray(data.queries) ? data.queries : []).slice(0, MAX_QUERIES).map(q => oneLine(q, 200))
    const parts = cleanQueries(Array.isArray(data.parts) ? data.parts : []).slice(0, MAX_PARTS).map(p => oneLine(p, 400))
    const mode = forceDeep || (data.mode === 'deep' && parts.length >= MIN_PARTS) ? 'deep' : 'quick'
    const official = (Array.isArray(data.official) ? data.official : [])
      .map(u => String(u ?? '').trim())
      .filter(u => /^https:\/\/[^\s]+$/.test(u))
      .slice(0, 2)
    const since = typeof data.since === 'string' && /^20\d\d-\d\d-\d\d$/.test(data.since) && data.since <= today ? data.since : null
    return {
      mode,
      queries: queries.length ? queries : fallback.queries,
      parts: mode === 'deep' ? (parts.length ? parts : fallback.parts) : [],
      since,
      official,
    }
  } catch (err) {
    await log($, 'plan', err)
    return fallback
  }
}

// Rejects when no tool has that name, or when the call gives no answer in time.
export async function callTool($: EngineInterface, input: Record<string, unknown>, ms = TOOL_MS): Promise<CallResult> {
  const call = ($.tool.call as unknown as (i: Record<string, unknown>) => Promise<CallResult>)(input)
  return (await withTimeout($, call, ms, String(input.tool))) ?? {}
}

// What the model would read: `text` from core, else the tool's own record.
export function resultText(r: CallResult) {
  if (r.text) return r.text
  if (typeof r.result === 'string') return r.result
  return r.result === undefined ? '' : JSON.stringify(r.result)
}

// What went wrong with a call that answered, or '' when it answered with text.
export function problem(r: CallResult, text: string) {
  if (r.deny) return `denied: ${oneLine(r.deny, 200)}`
  if (r.isError) return `error: ${oneLine(text, 200)}`
  return text ? '' : 'empty result'
}

// A WebSearch answer holds link lists ({ tool_use_id, content: [{ title, url }] }) and the search
// engine's own commentary (strings). The links are the sources; the commentary is background.
export function searchParts(r: CallResult, text: string) {
  const links: Link[] = []
  const notes: string[] = []
  const add = (title: unknown, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url) || links.some(l => l.url === url)) return
    links.push({ title: oneLine(String(title || url), 160), url })
  }
  const results = (r.result as { results?: unknown } | undefined)?.results
  if (Array.isArray(results)) {
    for (const item of results) {
      if (typeof item === 'string') notes.push(item)
      else if (item && typeof item === 'object' && Array.isArray((item as { content?: unknown }).content)) {
        for (const c of (item as { content: { title?: unknown; url?: unknown }[] }).content) add(c?.title, c?.url)
      }
    }
  }
  if (!links.length) {
    // The text form: `Links: [{"title":...,"url":...}]` on one line.
    const m = /Links:\s*(\[.*\])/.exec(text)
    try {
      for (const l of m ? (JSON.parse(m[1] ?? '[]') as { title?: unknown; url?: unknown }[]) : []) add(l?.title, l?.url)
    } catch {
      // Not JSON after all.
    }
    for (const u of urlsIn(text)) add(u, u)
  }
  if (!notes.length && text) notes.push(text.replace(/Links:\s*\[.*\]/, '').trim())
  return { links, notes: notes.filter(n => n.trim()) }
}

export async function setAgent($: EngineInterface, id: number, part: number, change: (a: AgentView) => AgentView) {
  await setRun($, id, r => ({ ...r, agents: r.agents.map(a => (a.part === part ? change(a) : a)) }))
}
