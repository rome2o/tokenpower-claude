import type { ToolUse } from '../types'
import type { TurnUsage } from 'claude-code'

// Subagent list prices per million tokens, as Subagent Model Router's policy.ts cached them on 2026-10-06.
// Haiku has a second card for one request whose prompt is over 100K tokens.
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Firecrawl = { bin: string; node: string; path: string }

export type Kit = { firecrawl: Firecrawl | null; webSearch: boolean; webFetch: boolean; connectors: { name: string; description: string }[] }

export type Link = { title: string; url: string }

// `via` names the path that read the page, for the log and the notes file.
// `newest`: the newest date found on the page, YYYY-MM-DD, when there is one.
export type Source = Link & { text: string; via: string; newest?: string }

// `noWebFetch`: WebFetch failed to answer once in this run (missing, or no answer in time), so the run stops asking it.
// `agentCost`: dollars the deep-mode subagents used, at list price.
export type Job = { id: number; question: string; reply: number; tools: ToolUse[]; helperIn: number; helperOut: number; read: number; agentCost: number; noWebFetch?: boolean }

export type CallResult = { text?: string; result?: unknown; isError?: true; deny?: string }

// `since`: the first day of the time window the request names, YYYY-MM-DD. `official`: pages to read first.
export type Plan = { mode: 'quick' | 'deep'; queries: string[]; parts: string[]; since: string | null; official: string[] }

export type Done = { answer: string; reason: string; model?: string; usage?: TurnUsage }

export type WebSearchRecord = { query: string; results: unknown[]; durationSeconds: number; searchCount?: number }
