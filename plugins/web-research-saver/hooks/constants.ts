import type { Price } from './shapes.ts'

export const NAME = 'web-research-saver'

export const TITLE = 'Web Research Saver'

export const PANE = 'web-research-saver'

// Not /research: another plugin's /content:research answers to that name first.
export const COMMAND = 'research-router'

// The cheap worker. Every search, page and brief goes through it, never through the main chat.
export const MODEL = 'claude-haiku-5-5'

// Haiku 5.5 list prices per million tokens, as Subagent Model Router's policy.ts cached them on 2026-10-06.
export const PRICE_IN = 0.1

export const PRICE_OUT = 0.5

export const PRICES: { family: RegExp; name: string; small: Price; large?: Price }[] = [
  { family: /opus/i, name: 'Opus', small: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  { family: /sonnet/i, name: 'Sonnet', small: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  {
    family: /haiku/i,
    name: 'Haiku',
    small: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    large: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
]

// How many subagents' tool text and request usage the mod keeps while it waits for their runs.
export const MAX_AGENT_MEMO = 32

export const MAX_RUNS = 8

export const MAX_AUTO = 12

export const SEARCH_LIMIT = 4

export const MAX_QUERIES = 2

export const MAX_SOURCES = 6

export const MAX_FETCHES = 4

export const MIN_PARTS = 2

export const MAX_PARTS = 4

// What the worker's model reads of each page, and of all of them together.
export const PAGE_CHARS = 12_000

export const ALL_CHARS = 60_000

// What the notes file keeps of each page's own text.
export const NOTE_PAGE_CHARS = 40_000

// A page shorter than this after the HTML is stripped is a script shell, not an article.
export const MIN_PAGE_CHARS = 200

// What the expanded card keeps of the brief and of each subagent report.
export const BRIEF_CHARS = 4000

export const REPORT_CHARS = 2500

export const FIRECRAWL_MS = 150_000

// One WebSearch or WebFetch call. A permission dialog nobody answers counts against it.
export const TOOL_MS = 90_000

export const PAGE_MS = 20_000

export const PLAN_MS = 30_000

export const WRITE_MS = 120_000

// Auto mode: Haiku is asked only when the search engine's commentary alone is over this many tokens.
// Under it, the call costs more than it can save.
export const AUTO_MIN_COMMENTARY = 800

export const AUTO_MS = 25_000

// One deep-mode subagent's time limit.
export const PART_MS = 300_000

export const OFF_TEXT = `${TITLE} is off. Turn it on with /mods.`

export const USAGE_TEXT = `Type /${COMMAND} and a question, for example: /${COMMAND} what do people say about Claude plugins? Put deep first to use subagents: /${COMMAND} deep <question>`

// Pane colours, the same as the other mods' panes.
export const ACCENT = '#d97757'

export const GOOD = '#16a34a'

export const BAD = '#dc2626'

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 web-research-saver/2'

// Connector tools are matched by what they say they do, because their names are random ids.
export const WEBBY = /\b(web|internet|online|google|bing|urls?|web ?pages?|websites?|search engine|serp)\b/i

export const ACTION = /\b(search\w*|scrap\w*|crawl\w*|fetch\w*|brows\w*|research\w*)\b/i
