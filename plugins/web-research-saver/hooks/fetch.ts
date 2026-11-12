import type { EngineInterface } from 'claude-code'
import type { CallResult, Firecrawl, Job, Kit, Link, Source } from './shapes.ts'
import { S } from './state.ts'
import { ask, callTool, problem, resultText, searchParts, step, used } from './tools.ts'
import { commas, header, htmlToText, newestDate, oneLine, shortName } from './text.ts'
import { log, notesDir, withTimeout } from './io.ts'
import { FIRECRAWL_MS, MAX_FETCHES, MAX_SOURCES, MIN_PAGE_CHARS, NOTE_PAGE_CHARS, PAGE_CHARS, PAGE_MS, PLAN_MS, SEARCH_LIMIT, UA } from './constants.ts'

// One page, three ways: WebFetch while it exists, a plain GET with no key, then the firecrawl CLI.
export async function readPage($: EngineInterface, job: Job, link: Link, question: string, today: string): Promise<Source | null> {
  if (!safeUrl(link.url)) {
    await log($, 'page', `skipped a local or private URL: ${link.url}`)
    return null
  }
  if (!S.webFetchMissing && !job.noWebFetch) {
    try {
      const r = await callTool($, {
        tool: 'WebFetch',
        url: link.url,
        prompt: `Pull out every fact that helps answer this question: ${question}. Keep numbers, names, dates and short quotes.`,
      })
      await used($, job, 'WebFetch', 'built-in')
      const text = resultText(r)
      const bad = problem(r, text)
      if (!bad) return { ...link, text, via: 'WebFetch', newest: newestDate(text, today) }
      await log($, 'WebFetch', `${bad} for ${link.url}`)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      job.noWebFetch = true
      // The tool is not in this session at all: later runs skip it too.
      if (/no tool named/i.test(why)) S.webFetchMissing = true
      await log($, 'WebFetch', why)
    }
  }
  try {
    const res = await withTimeout($, $.http.fetch(link.url, { headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' } }), PAGE_MS, 'the page')
    await used($, job, 'plain page read (no key)', 'http')
    const type = header(res.headers, 'content-type')
    if (!res.ok) await log($, 'page', `HTTP ${res.status} for ${link.url}`)
    else if (type && !/html|text|xml|json/i.test(type)) await log($, 'page', `skipped ${type} at ${link.url}`)
    else {
      const page = /html/i.test(type) || /<html|<body/i.test(res.text.slice(0, 2000)) ? htmlToText(res.text) : { title: '', text: res.text.trim() }
      // The raw HTML keeps the dates a page hides in <time> tags and meta fields.
      if (page.text.length >= MIN_PAGE_CHARS) {
        return { title: link.title === link.url && page.title ? page.title : link.title, url: link.url, text: page.text.slice(0, NOTE_PAGE_CHARS), via: 'plain GET', newest: newestDate(res.text, today) }
      }
      await log($, 'page', `only ${page.text.length} characters of text at ${link.url}`)
    }
  } catch (err) {
    await log($, 'page', err)
  }
  const fc = S.kit?.firecrawl
  if (fc) {
    try {
      const r = await $.process.run([fc.node, fc.bin, 'scrape', link.url, '--format', 'markdown', '--only-main-content'], {
        cwd: notesDir(),
        env: { PATH: fc.path },
        timeoutMs: FIRECRAWL_MS,
      })
      await used($, job, 'firecrawl scrape (CLI)', 'cli')
      if (r.exitCode === 0 && r.stdout.trim().length >= MIN_PAGE_CHARS) return { ...link, text: r.stdout.trim().slice(0, NOTE_PAGE_CHARS), via: 'firecrawl scrape', newest: newestDate(r.stdout, today) }
      await log($, 'firecrawl', `scrape exit ${r.exitCode}, ${r.stdout.length} characters: ${r.stderr.slice(0, 200)}`)
    } catch (err) {
      await log($, 'firecrawl', err)
    }
  }
  return null
}

export function parseFirecrawl(stdout: string): Source[] {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    const at = stdout.indexOf('{')
    data = at >= 0 ? JSON.parse(stdout.slice(at)) : null
  }
  const d = (data as { data?: unknown } | null)?.data
  const items = (Array.isArray(d) ? d : ((d as { web?: unknown } | undefined)?.web ?? [])) as Record<string, unknown>[]
  return items
    .filter(i => typeof i.url === 'string')
    .map(i => ({
      title: oneLine(String(i.title ?? i.url), 160),
      url: String(i.url),
      text: [String(i.description ?? ''), String(i.markdown ?? '')].filter(Boolean).join('\n\n'),
      via: 'firecrawl search',
    }))
}

export async function viaFirecrawl($: EngineInterface, job: Job, fc: Firecrawl, queries: string[]) {
  const sources: Source[] = []
  for (const [i, q] of queries.entries()) {
    await step($, job.id, `Searching ${i + 1} of ${queries.length} with firecrawl`)
    const r = await $.process.run(
      [fc.node, fc.bin, 'search', q, '--limit', String(SEARCH_LIMIT), '--scrape', '--json', '--timeout', '60000'],
      { cwd: notesDir(), env: { PATH: fc.path }, timeoutMs: FIRECRAWL_MS },
    )
    await used($, job, 'firecrawl search (CLI)', 'cli')
    if (r.exitCode !== 0) {
      await log($, 'firecrawl', `exit ${r.exitCode}: ${r.stderr.slice(0, 300)}`)
      continue
    }
    const found = parseFirecrawl(r.stdout)
    await log($, 'firecrawl', `${found.length} pages for "${q}"`)
    for (const s of found) {
      if (!sources.some(x => x.url === s.url)) sources.push(s)
    }
  }
  const kept = sources.slice(0, MAX_SOURCES)
  // Count each kept page once, cut where the worker cuts it, so "before" is not inflated.
  for (const s of kept) job.read += s.title.length + s.url.length + Math.min(s.text.length, PAGE_CHARS)
  return { sources: kept, notes: [] as string[] }
}

// First choice, no outside service: the built-in WebSearch for links, then each page read for real.
// Tried even when $.tool.list leaves WebSearch out, because a deferred tool is not on that list.
export async function viaWebTools($: EngineInterface, job: Job, queries: string[], question: string, o: { official: string[]; since: string | null; today: string }) {
  // The official pages the planner named are read first, ahead of anything the search finds.
  const links: Link[] = o.official.map(url => ({ title: url, url }))
  const notes: string[] = []
  for (const [i, q] of queries.entries()) {
    await step($, job.id, `Searching ${i + 1} of ${queries.length}`)
    let r: CallResult
    try {
      r = await callTool($, { tool: 'WebSearch', query: q })
    } catch (err) {
      // No such tool, or no answer in time: asking again would only wait again.
      await log($, 'WebSearch', err)
      break
    }
    // The pane counts only calls that ran; a missing tool or a timeout goes to the log alone.
    await used($, job, 'WebSearch', 'built-in')
    const text = resultText(r)
    const bad = problem(r, text)
    if (bad) {
      await log($, 'WebSearch', `${bad} for "${q}"`)
      if (r.deny) break
      continue
    }
    const found = searchParts(r, text)
    await log($, 'WebSearch', `${commas(text.length)} characters, ${found.links.length} links for "${q}"`)
    job.read += text.length
    notes.push(...found.notes)
    for (const l of found.links) if (!links.some(x => x.url === l.url)) links.push(l)
  }
  const sources: Source[] = []
  const toRead = links.slice(0, MAX_FETCHES)
  for (const [i, link] of toRead.entries()) {
    await step($, job.id, `Reading page ${i + 1} of ${toRead.length}`)
    const page = await readPage($, job, link, question, o.today)
    if (!page) {
      await log($, `run ${job.id}`, `page ${i + 1}: not read, ${link.url}`)
      continue
    }
    job.read += Math.min(page.text.length, PAGE_CHARS)
    // A page whose newest date is before the window holds nothing from inside it.
    if (o.since && page.newest && page.newest < o.since) {
      await log($, `run ${job.id}`, `page ${i + 1}: skipped, its newest date ${page.newest} is before ${o.since}, ${link.url}`)
      continue
    }
    await log($, `run ${job.id}`, `page ${i + 1}: read by ${page.via}, ${commas(page.text.length)} characters${page.newest ? `, newest date ${page.newest}` : ''}, ${link.url}`)
    sources.push(page)
  }
  // Only pages read count as sources. Links nobody read are listed apart, unless no page was read at all.
  const unread = links.filter(l => !sources.some(s => s.url === l.url))
  if (!sources.length) for (const link of unread.slice(0, MAX_SOURCES)) sources.push({ ...link, text: '', via: 'search link, not read' })
  return { sources, notes, unread: sources.some(s => s.text) ? unread : [] }
}

// One short Haiku call: keep only the pages about the request itself, and inside its time window.
export async function relevant($: EngineInterface, job: Job, question: string, sources: Source[], since: string | null, today: string) {
  const read = sources.filter(s => s.text)
  if (!read.length) return sources
  try {
    const text = await ask(
      $,
      job,
      [
        `Today is ${today}.`,
        `Research request: ${question}`,
        since ? `The request covers ${since} to ${today}.` : '',
        '',
        'Pages found for it, numbered, each with its first lines:',
        read.map((s, i) => `[${i + 1}] ${s.title} (${s.url})${s.newest ? `, newest date ${s.newest}` : ''}\n${s.text.slice(0, 600)}`).join('\n\n'),
        '',
        'Which pages to keep: a page stays only if it is about the subject of the request itself, not a different product or project with a similar name.',
        since ? 'With a time window, a page stays only if it holds something from inside the window.' : '',
        'Answer with this JSON and nothing else: {"keep":[1,2],"why":"one short line"}',
      ]
        .filter(l => l !== '')
        .join('\n'),
      200,
      PLAN_MS,
    )
    const json = /\{[\s\S]*\}/.exec(text)?.[0]
    if (!json) throw new Error('the relevance check gave no JSON')
    const data = JSON.parse(json) as { keep?: unknown; why?: unknown }
    if (!Array.isArray(data.keep)) throw new Error('the relevance check gave no "keep" list')
    const keep = new Set(data.keep.map(Number))
    const kept = read.filter((_, i) => keep.has(i + 1))
    const dropped = read.filter((_, i) => !keep.has(i + 1))
    await log($, `run ${job.id}`, `relevance check kept ${kept.length} of ${read.length} pages${dropped.length ? `, dropped ${dropped.map(s => s.url).join(' ')}` : ''}${typeof data.why === 'string' ? `: ${oneLine(data.why, 160)}` : ''}`)
    return kept
  } catch (err) {
    await log($, 'relevance', `${err instanceof Error ? err.message : String(err)}; every page kept`)
    return sources
  }
}

// The last resort: a connector that says it searches the web, asked with a plain query.
export async function viaConnector($: EngineInterface, job: Job, k: Kit, query: string) {
  for (const c of k.connectors.slice(0, 2)) {
    await step($, job.id, `Searching with ${shortName(c.name)}`)
    let r: CallResult
    try {
      r = await callTool($, { tool: c.name, query })
    } catch (err) {
      await log($, shortName(c.name), err)
      continue
    }
    await used($, job, shortName(c.name), 'connector')
    const text = resultText(r)
    const bad = problem(r, text) || (text.length < 200 ? 'too short' : '')
    await log($, shortName(c.name), bad || `${commas(text.length)} characters`)
    if (bad) continue
    job.read += text.length
    const links = searchParts(r, text).links.slice(0, MAX_SOURCES)
    // A connector's text is background; its links are the sources.
    return { sources: links.map(l => ({ ...l, text: '', via: `${shortName(c.name)} link` })), notes: [text] }
  }
  return { sources: [] as Source[], notes: [] as string[] }
}
