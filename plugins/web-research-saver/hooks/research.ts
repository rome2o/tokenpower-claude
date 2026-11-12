import type { EngineInterface } from 'claude-code'
import type { Done, Job, Link, Source } from './shapes.ts'
import { ALL_CHARS, BRIEF_CHARS, MAX_RUNS, MODEL, NAME, PAGE_CHARS, PART_MS, REPORT_CHARS, TITLE, WRITE_MS } from './constants.ts'
import { ask, plan, refreshTools, setAgent, setRun, step, used } from './tools.ts'
import { CAVEATS, briefMessage, notesFile, partPrompt } from './prompts.ts'
import { clean, commas, day, dollars, money, oneLine, requestCost, slug, tally, tokens, toolLine, urlsIn, windowStart } from './text.ts'
import { agentChars, agentSteps, answers, owned, waiters } from './state.ts'
import { append, log, logsDir, notesDir } from './io.ts'
import { relevant, viaConnector, viaFirecrawl, viaWebTools } from './fetch.ts'
import type { RunView, SourceView } from '../types'
import { atom, read, update } from 'claude-code'
import { openPane } from './ui.ts'

const runsAtom = atom({ plugin: 'web-research-saver', key: 'runs' } as const, [] as RunView[], { shape: 'runs-2' })

export async function writeUp($: EngineInterface, job: Job, question: string, sources: Source[], notes: string[], today: string, since: string | null) {
  let room = ALL_CHARS
  const take = (s: string) => {
    const body = s.slice(0, Math.max(0, Math.min(PAGE_CHARS, room)))
    room -= body.length
    return body
  }
  const blocks = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text ? take(s.text) : '(page not read; only the search engine listed it)'}`)
  const background = notes.map(n => take(n)).filter(Boolean)
  const text = await ask(
    $,
    job,
    [
      `Today is ${today}.${since ? ` The question covers ${since} to ${today}: leave out anything dated before ${since}, and say so if little falls inside it.` : ''}`,
      `Question: ${question}`,
      '',
      'Sources, numbered:',
      blocks.join('\n\n---\n\n') || '(none: no page was about the question)',
      '',
      'Search engine notes (background only, no number of their own; a claim from them takes the number of the source it names, else no number):',
      background.join('\n\n---\n\n') || '(none)',
      '',
      'Write two parts.',
      'BRIEF: at most 180 words. Lead with the direct answer. Put [n] after each claim, n being the source number. Say plainly what the sources do not settle.',
      CAVEATS,
      'NOTES: detailed notes for a later reader, source by source: the facts, numbers, dates and short quotes that bear on the question, each with its [n]. At most 900 words.',
      'If the sources do not answer the question, say so in the brief.',
      'Answer in exactly this form and nothing else:',
      '<brief>...</brief>',
      '<notes>...</notes>',
    ].join('\n'),
    2500,
    WRITE_MS,
  )
  const brief = /<brief>([\s\S]*?)<\/brief>/i.exec(text)?.[1] ?? text.slice(0, 1200)
  const more = /<notes>([\s\S]*?)<\/notes>/i.exec(text)?.[1] ?? text
  return { brief: clean(brief, 1600), notes: clean(more, 12_000) }
}

// A subagent's report: its text, and its own numbered source list.
export function parseReport(answer: string) {
  const at = answer.search(/\n\s*SOURCES:\s*\n/i)
  const body = (at >= 0 ? answer.slice(0, at) : answer).trim()
  const tail = at >= 0 ? answer.slice(at) : ''
  const list = new Map<number, Link>()
  for (const m of tail.matchAll(/^\s*(\d+)[.)]\s*(.*?)\s*\|\s*(https?:\/\/\S+)\s*$/gm)) list.set(Number(m[1]), { title: oneLine(m[2] || m[3] || '', 160), url: m[3] ?? '' })
  if (!list.size) for (const [i, u] of urlsIn(tail || answer).entries()) list.set(i + 1, { title: u, url: u })
  return { body, list }
}

export function waitFor($: EngineInterface, agentId: string, ms: number): Promise<Done> {
  const early = answers.get(agentId)
  if (early) {
    answers.delete(agentId)
    return Promise.resolve(early)
  }
  return new Promise(resolve => {
    const timer = $.clock.after(ms, () => {
      waiters.delete(agentId)
      resolve({ answer: '', reason: `no answer in ${ms / 1000} s` })
    })
    waiters.set(agentId, d => {
      timer.cancel()
      waiters.delete(agentId)
      resolve(d)
    })
  })
}

// Deep mode: one general-purpose subagent per part. Subagent Model Router's agent.spawn hook picks each model.
export async function viaSubagents($: EngineInterface, job: Job, question: string, parts: string[], today: string) {
  const total = parts.length
  await setRun($, job.id, r => ({ ...r, agents: parts.map((p, i) => ({ part: i + 1, question: p, model: 'starting', status: 'working' })) }))
  await step($, job.id, `Starting ${total} subagents`)
  let finished = 0
  const results = await Promise.all(
    parts.map(async (part, i) => {
      const n = i + 1
      try {
        const spawned = await $.agent.spawn({
          prompt: partPrompt(question, part, n, total, today),
          description: `${TITLE} run ${job.id} part ${n} of ${total}`,
          subagentType: 'general-purpose',
        })
        if (spawned.deny || !spawned.agentId) throw new Error(spawned.deny ? `refused: ${oneLine(spawned.deny, 160)}` : 'no agent id')
        owned.add(spawned.agentId)
        // With no model chosen by a hook, the spawn reports "inherit": the chat's own model.
        // Any other answer means a hook (Subagent Model Router) picked the model.
        const picked = spawned.model !== 'inherit'
        const first = picked ? spawned.model : "the chat's model"
        await setAgent($, job.id, n, a => ({ ...a, model: first, picked }))
        await log($, `run ${job.id}`, `subagent ${n} of ${total} on ${spawned.model}, ${spawned.agentId}`)
        const done = await waitFor($, spawned.agentId, PART_MS)
        finished += 1
        await step($, job.id, `Subagents: ${finished} of ${total} done`)
        // What it read and what it cost count even when it gave no report: the tokens were spent.
        const chars = agentChars.get(spawned.agentId) ?? 0
        const steps = agentSteps.get(spawned.agentId) ?? []
        agentChars.delete(spawned.agentId)
        agentSteps.delete(spawned.agentId)
        job.read += chars + done.answer.length
        let cost: number | null = null
        for (const s of steps) {
          const c = requestCost(s.model, s, true)
          if (c !== null) cost = (cost ?? 0) + c
        }
        if (!steps.length && done.usage) cost = requestCost(done.usage.model, done.usage, false)
        job.agentCost += cost ?? 0
        await log(
          $,
          `run ${job.id}`,
          `subagent ${n}: its tools returned ${commas(chars)} characters, report ${commas(done.answer.length)} characters, cost ${cost === null ? 'unknown (no usage or no price)' : money(cost)}${steps.length ? `, priced by ${steps.length} requests` : done.usage ? ', priced from its turn total' : ''}`,
        )
        if (!done.answer.trim()) throw new Error(done.reason === 'answer' ? 'empty report' : done.reason)
        const model = done.model ?? first
        await setAgent($, job.id, n, a => ({ ...a, model, status: 'done', ...(cost === null ? {} : { cost }) }))
        return { n, part, model, done }
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        await log($, `run ${job.id}`, `subagent ${n} failed: ${why}`)
        await setAgent($, job.id, n, a => ({ ...a, status: 'failed', note: oneLine(why, 120) }))
        return { n, part, model: '', done: null as Done | null, why }
      }
    }),
  )
  const sources: Source[] = []
  const reports: string[] = []
  const failed: string[] = []
  const models: string[] = []
  for (const r of results) {
    if (!r.done) {
      failed.push(`part ${r.n} (${r.part}): ${'why' in r ? r.why : 'failed'}`)
      continue
    }
    models.push(r.model)
    const { body, list } = parseReport(r.done.answer)
    // The report's own [n] become the global numbers.
    const map = new Map<number, number>()
    for (const [local, link] of list) {
      let g = sources.findIndex(s => s.url === link.url)
      if (g < 0) {
        sources.push({ ...link, text: '', via: `subagent ${r.n}` })
        g = sources.length - 1
      }
      map.set(local, g + 1)
    }
    const renumbered = body.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (all, nums: string) => {
      const out = nums.split(',').map(s => map.get(Number(s.trim())))
      return out.every(Boolean) ? `[${out.join(', ')}]` : all
    })
    reports.push(`Part ${r.n}: ${r.part}\n${renumbered}`)
  }
  await used($, job, 'general-purpose subagent', 'subagent', results.length)
  return { sources, reports, failed, models: tally(models) }
}

export async function joinReports($: EngineInterface, job: Job, question: string, sources: Source[], reports: string[], failed: string[]) {
  const text = await ask(
    $,
    job,
    [
      `Question: ${question}`,
      '',
      'Sources, numbered:',
      sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})`).join('\n') || '(none)',
      '',
      'Reports from the research workers, already using those numbers:',
      reports.join('\n\n---\n\n').slice(0, ALL_CHARS),
      '',
      failed.length ? `These parts failed and have no report: ${failed.join('; ')}` : '',
      'Write one BRIEF: at most 200 words. Lead with the direct answer. Keep the [n] after each claim. Say plainly what the reports do not settle, and name any part that failed.',
      CAVEATS,
      'Answer in exactly this form and nothing else:',
      '<brief>...</brief>',
    ].join('\n'),
    1200,
    WRITE_MS,
  )
  return clean(/<brief>([\s\S]*?)<\/brief>/i.exec(text)?.[1] ?? text.slice(0, 1400), 1800)
}

export async function runResearch($: EngineInterface, id: number, question: string, reply: number, forceDeep: boolean) {
  const job: Job = { id, question, reply, tools: [], helperIn: 0, helperOut: 0, read: 0, agentCost: 0 }
  const t0 = await $.clock.now()
  const today = day(t0)
  const secs = async () => Math.round((await $.clock.now()) - t0) / 1000
  try {
    await step($, id, 'Planning')
    await $.process.run(['/bin/mkdir', '-p', notesDir()], { timeoutMs: 10_000 }).catch(() => undefined)
    const k = await refreshTools($)
    const p = await plan($, job, question, forceDeep, today)
    // The words of the request settle the window first; the planner's reading is the second choice.
    const since = windowStart(question, t0) ?? p.since
    await setRun($, id, r => ({ ...r, mode: p.mode }))
    await log(
      $,
      `run ${id}`,
      `${p.mode}; today ${today}${since ? `, window from ${since}` : ''}; queries: ${p.queries.map(q => `"${q}"`).join(', ')}${p.official.length ? `; official: ${p.official.join(' ')}` : ''}${p.parts.length ? `; parts: ${p.parts.map(q => `"${q}"`).join(', ')}` : ''}`,
    )

    let sources: Source[] = []
    let notes: string[] = []
    let brief = ''
    let more = ''
    let reports: string[] | undefined
    let failed: string[] = []
    let models: string[] = []
    let unread: Link[] = []
    if (p.mode === 'deep') {
      const d = await viaSubagents($, job, question, p.parts, today)
      failed = d.failed
      models = d.models
      if (!d.reports.length) throw new Error(`every subagent failed: ${d.failed.join('; ')}`)
      sources = d.sources
      await step($, id, 'Writing')
      brief = await joinReports($, job, question, sources, d.reports, failed)
      more = d.reports.join('\n\n')
      reports = d.reports.map(x => x.slice(0, REPORT_CHARS))
    } else {
      let got: { sources: Source[]; notes: string[]; unread?: Link[] } = await viaWebTools($, job, p.queries, question, { official: p.official, since, today }).catch(async err => {
        await log($, 'web tools', err)
        return { sources: [] as Source[], notes: [] as string[] }
      })
      // Firecrawl is an outside service, so it runs only when the built-in search is missing or fails.
      if (!got.sources.length && !got.notes.length && k.firecrawl) {
        await log($, 'fallback', 'WebSearch gave nothing, using the firecrawl CLI')
        got = await viaFirecrawl($, job, k.firecrawl, p.queries).catch(async err => {
          await log($, 'firecrawl', err)
          return { sources: [] as Source[], notes: [] as string[] }
        })
      }
      if (!got.sources.length && !got.notes.length && k.connectors.length) {
        await log($, 'fallback', k.firecrawl ? 'firecrawl gave nothing too, using a connector' : 'no firecrawl CLI, using a connector')
        got = await viaConnector($, job, k, p.queries[0] ?? question).catch(async err => {
          await log($, 'connector', err)
          return { sources: [] as Source[], notes: [] as string[] }
        })
      }
      if (!got.sources.length && !got.notes.length) throw new Error('no research tool on this Mac returned anything')
      unread = got.unread ?? []
      await step($, id, 'Checking the pages fit the question')
      sources = await relevant($, job, question, got.sources, since, today)
      notes = got.notes
      await step($, id, 'Writing')
      const w = await writeUp($, job, question, sources, notes, today, since)
      brief = w.brief
      more = w.notes
    }

    const when = new Date(await $.clock.now()).toISOString()
    const notesPath = `${notesDir()}/${when.replace(/[-:]/g, '').slice(0, 15)}-${slug(question)}.md`
    const message = briefMessage(question, brief, sources, notesPath, failed)
    const before = tokens(job.read)
    const after = tokens(job.reply + message.length)
    const cost = dollars(job.helperIn, job.helperOut) + job.agentCost
    const pagesRead = p.mode === 'quick' ? sources.filter(s => s.text).length : undefined
    await $.fs.write(notesPath, notesFile({ question, when, mode: p.mode, job, queries: p.queries, brief, notes: more, sources, before, after, cost, models, failed, since, unread }))
    const line = {
      ts: when,
      session: await $.session.id().catch(() => 'unknown'),
      tool_use_id: null,
      mod: NAME,
      action: `research${p.mode === 'deep' ? ' deep' : ''}: ${oneLine(question, 80)}`,
      before,
      after,
      helper: { model: MODEL, in: job.helperIn, out: job.helperOut },
      ...(p.mode === 'deep' ? { subagents: { models, cost_usd: Math.round(job.agentCost * 1_000_000) / 1_000_000 } } : {}),
      measured: 'estimated',
      how:
        p.mode === 'deep'
          ? "before: the text the subagents' tools returned plus their reports, chars/4, cache reads not counted; after: reply and brief chars/4; subagents.cost_usd: each request at list price"
          : 'before: search results and page text the worker read, chars/4; after: reply and brief chars/4',
      detail: notesPath,
    }
    await append($, `${logsDir()}/savings.jsonl`, `${JSON.stringify(line)}\n`)
    const took = await secs()
    const view: SourceView[] = sources.map((s, i) => ({ n: i + 1, title: s.title, url: s.url }))
    await setRun($, id, r => ({
      ...r,
      status: 'done',
      step: 'Brief sent to Claude',
      sources: view,
      before,
      after,
      cost,
      ...(p.mode === 'deep' ? { agentCost: job.agentCost } : {}),
      ...(pagesRead === undefined ? {} : { pagesRead }),
      secs: took,
      notes: notesPath,
      brief: brief.slice(0, BRIEF_CHARS),
      reports,
    }))
    await log(
      $,
      'done',
      `run ${id} (${p.mode}) in ${took} s, ${sources.length} sources${pagesRead === undefined ? '' : `, ${pagesRead} pages read`}, ${toolLine(job.tools)}, before ${before}, after ${after}, Haiku ${money(cost - job.agentCost)}${p.mode === 'deep' ? `, subagents ${money(job.agentCost)} on ${models.join(', ') || 'none'}` : ''}`,
    )
    $.ui.toast(`${TITLE}: brief ready. About ${commas(Math.max(0, before - after))} tokens kept out of the chat.`)
    await $.prompt.submit({ text: message })
    await log($, `run ${id}`, 'brief sent to the chat')
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    await log($, 'failed', `run ${id}: ${why}`)
    const took = await secs()
    await setRun($, id, r => ({ ...r, status: 'failed', step: 'Stopped', error: oneLine(why, 200), secs: took, cost: dollars(job.helperIn, job.helperOut) + job.agentCost }))
    await $.prompt
      .submit({ text: `${TITLE} could not finish the research for: ${oneLine(question, 300)}\nReason: ${oneLine(why, 200)}\nTell me, and research it another way only if I ask.` })
      .catch(() => undefined)
  }
}

export async function startRun($: EngineInterface, question: string, reply: number, forceDeep: boolean) {
  const runs = (await read($, runsAtom)) ?? []
  const id = (runs[0]?.id ?? 0) + 1
  const run: RunView = { id, at: await $.clock.now(), question: oneLine(question, 300), mode: forceDeep ? 'deep' : 'quick', status: 'working', step: 'Starting', tools: [], sources: [], agents: [] }
  await update($, runsAtom, list => [run, ...(list ?? [])].slice(0, MAX_RUNS))
  await openPane($, true)
  // The worker outlives this hook: a timer runs it, and the brief arrives as its own message.
  $.clock.after(0, () => {
    void runResearch($, id, question, reply, forceDeep).catch(err => log($, 'worker', err))
  })
  return id
}
