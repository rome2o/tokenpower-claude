import type { Job, Link, Plan, Source } from './shapes.ts'
import { MODEL, NOTE_PAGE_CHARS, TITLE } from './constants.ts'
import { commas, money, oneLine, sourceLines, toolLine } from './text.ts'

export const SYSTEM = [
  'You are a research worker. You read web search results and pages, and you report what they say.',
  'Write plain, simple English in short sentences. Never use em dashes or en dashes. Never use the word "ship".',
  'Use only the sources you are given. Never invent a number, date, name or quote.',
].join(' ')

// Said to every writer: the brief keeps what the sources hedge, and never upgrades a claim.
export const CAVEATS =
  'Keep each source\'s own caveats and limits. Never state a claim more strongly than its source does. Say who measured a number: a vendor testing its own product is "the vendor\'s own test", never "controlled" or "independent" unless the source says so. Say when a number comes from one source only.'

export function partPrompt(question: string, part: string, n: number, total: number, today: string) {
  return [
    `Today is ${today}.`,
    `You are research worker ${n} of ${total}. Research only this part:`,
    part,
    '',
    `It is one part of a bigger question: ${question}`,
    '',
    'Use WebSearch to find sources. If you have WebFetch, read the best 2 or 3 pages.',
    'Then answer in at most 250 words of plain English: the facts, numbers, dates and names that answer your part. Put [n] after each claim, matching your source list.',
    CAVEATS,
    'End with this exact block and nothing after it:',
    'SOURCES:',
    '1. Page title | https://full.page/url',
    '2. Page title | https://full.page/url',
    'Rules: list only pages you found, by their full page URL. A search query is not a source. Never paste raw pages or long quotes. Never invent a number, name, date or quote. Never use em dashes.',
  ].join('\n')
}

export function briefMessage(question: string, brief: string, sources: Source[], notesPath: string, failed: string[]) {
  return [
    UNTRUSTED_HEADER,
    `${TITLE} brief`,
    `Question: ${oneLine(question, 300)}`,
    '',
    ...fence([brief, ...(failed.length ? ['', `Not covered, a subagent failed: ${failed.join('; ')}`] : []), '', 'Sources:', ...sourceLines(sources)]),
    '',
    `Full notes, only if the brief leaves a gap: ${notesPath}`,
    'Answer the question from this brief.',
  ].join('\n')
}

export function notesFile(o: {
  question: string
  when: string
  mode: Plan['mode']
  job: Job
  queries: string[]
  brief: string
  notes: string
  sources: Source[]
  before: number
  after: number
  cost: number
  models: string[]
  failed: string[]
  since: string | null
  unread: Link[]
}) {
  return [
    `# Research notes: ${oneLine(o.question, 200)}`,
    '',
    `- When: ${o.when}`,
    `- Mode: ${o.mode}${o.models.length ? `, subagents on ${o.models.join(', ')}` : ''}`,
    `- Worker: ${MODEL}, run by the ${TITLE} mod. Haiku cost about ${money(o.cost - o.job.agentCost)} at list price.`,
    ...(o.mode === 'deep' ? [`- Subagents cost about ${money(o.job.agentCost)} at list price, each request priced by its own size. Run total: about ${money(o.cost)}.`] : []),
    ...(o.since ? [`- Time window: ${o.since} to ${o.when.slice(0, 10)}. Pages whose newest date is older were skipped.`] : []),
    `- Tools used: ${toolLine(o.job.tools)}`,
    ...(o.mode === 'quick' ? [`- Search queries: ${o.queries.map(q => `"${q}"`).join(', ')}`, `- Pages read: ${o.sources.filter(s => s.text).length}`] : []),
    ...(o.failed.length ? [`- Failed parts: ${o.failed.join('; ')}`] : []),
    `- Tokens: the worker${o.mode === 'deep' ? ' and the subagents' : ''} read about ${commas(o.before)} tokens; Claude read about ${commas(o.after)} (the command reply and the brief).`,
    o.mode === 'deep'
      ? "- How tokens are counted: the text the subagents' tools returned (search results and pages) plus their reports, characters divided by 4, an estimate. Cache reads are not counted: they are the same prompt read again."
      : '- How tokens are counted: characters divided by 4, an estimate.',
    '',
    '## Brief (what Claude got)',
    '',
    o.brief,
    '',
    o.mode === 'deep' ? '## Subagent reports' : '## Notes',
    '',
    o.notes,
    '',
    '## Sources',
    '',
    ...o.sources.map((s, i) => `${i + 1}. ${s.title}, ${s.url} (${s.via}${s.newest ? `, newest date ${s.newest}` : ''})`),
    '',
    ...(o.unread.length ? ['## Links listed but not read (not counted as sources)', '', ...o.unread.map(l => `- ${l.title}, ${l.url}`), ''] : []),
    ...(o.sources.some(s => s.text)
      ? [
          `## Page text, as read (each cut at ${commas(NOTE_PAGE_CHARS)} characters)`,
          '',
          ...o.sources.filter(s => s.text).flatMap(s => [`### [${o.sources.indexOf(s) + 1}] ${s.title}`, '', `${s.url}, read by ${s.via}`, '', s.text.slice(0, NOTE_PAGE_CHARS), '']),
        ]
      : []),
  ].join('\n')
}
