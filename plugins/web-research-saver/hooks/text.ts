import { MAX_AGENT_MEMO, PRICES, PRICE_IN, PRICE_OUT } from './constants.ts'
import type { ModelUsage } from 'claude-code'
import type { ToolUse } from '../types'
import type { Source } from './shapes.ts'

// Newest last; the oldest goes when the map is full.
export function remember<V>(map: Map<string, V>, id: string, value: V) {
  map.delete(id)
  map.set(id, value)
  for (const k of [...map.keys()].slice(0, Math.max(0, map.size - MAX_AGENT_MEMO))) map.delete(k)
}

// Plain text: no em or en dashes, never the banned word.
export function clean(raw: string, max: number) {
  return raw
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\bship(s|ped|ping)?\b/gi, 'publish')
    .trim()
    .slice(0, max)
}

export function oneLine(raw: string, max: number) {
  return clean(raw.replace(/\s+/g, ' '), max)
}

export function tokens(chars: number) {
  return Math.ceil(chars / 4)
}

export function commas(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function dollars(helperIn: number, helperOut: number) {
  return (helperIn * PRICE_IN + helperOut * PRICE_OUT) / 1_000_000
}

export function money(d: number) {
  return d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`
}

// One request (or, with oneRequest false, a turn's summed counts) at list price; null for a model with no price here.
export function requestCost(model: string, u: ModelUsage, oneRequest: boolean): number | null {
  const card = PRICES.find(p => p.family.test(model))
  if (!card) return null
  const input = u.input_tokens ?? 0
  const read = u.cache_read_input_tokens ?? 0
  const write = u.cache_creation_input_tokens ?? 0
  // Summed counts are not one prompt: only a single request's size can pick the long-prompt card.
  const p = oneRequest && input + read + write > 100_000 && card.large ? card.large : card.small
  return (input * p.input + (u.output_tokens ?? 0) * p.output + read * p.cacheRead + write * p.cacheWrite) / 1_000_000
}

// "claude-haiku-5-5" reads as "Haiku"; a model with no family here keeps its id.
export function family(model: string) {
  return PRICES.find(p => p.family.test(model))?.name ?? model
}

export function tally(models: string[]) {
  const counts = new Map<string, number>()
  for (const m of models) counts.set(family(m), (counts.get(family(m)) ?? 0) + 1)
  return [...counts].map(([m, c]) => `${m} x${c}`)
}

// Today and the time window the request names in plain words, counted back from today.
export function day(ms: number) {
  return new Date(ms).toISOString().slice(0, 10)
}

export function windowStart(question: string, now: number): string | null {
  const m = /\b(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month)s?\b/i.exec(question)
  if (m) return day(now - Number(m[1]) * (m[2]!.toLowerCase() === 'week' ? 7 : m[2]!.toLowerCase() === 'month' ? 30 : 1) * 86_400_000)
  if (/\b(?:this|last|past)\s+week\b/i.test(question)) return day(now - 7 * 86_400_000)
  if (/\b(?:this|last|past)\s+month\b/i.test(question)) return day(now - 30 * 86_400_000)
  if (/\b(?:today|yesterday)\b/i.test(question)) return day(now - 86_400_000)
  return null
}

export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// The newest date a page names, up to today: ISO dates and "Nov 2, 2026" or "2 November 2026".
export function newestDate(raw: string, today: string): string | undefined {
  const found: string[] = []
  for (const m of raw.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)/g)) found.push(`${m[1]}-${m[2]}-${m[3]}`)
  const pad = (n: string) => n.padStart(2, '0')
  for (const m of raw.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d\d)\b/g)) {
    found.push(`${m[3]}-${pad(String(MONTHS.indexOf(m[1]!.toLowerCase()) + 1))}-${pad(m[2]!)}`)
  }
  for (const m of raw.matchAll(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(20\d\d)\b/g)) {
    found.push(`${m[3]}-${pad(String(MONTHS.indexOf(m[2]!.toLowerCase()) + 1))}-${pad(m[1]!)}`)
  }
  return found.filter(d => /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d) && d <= today).sort().pop()
}

// A connector's name without its random server id.
export function shortName(tool: string) {
  return tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '')
}

export function urlsIn(text: string) {
  const out: string[] = []
  for (const m of text.matchAll(/https?:\/\/[^\s)\]"'<>,|]+/g)) {
    const u = m[0].replace(/[.;:]+$/, '')
    if (!out.includes(u)) out.push(u)
  }
  return out
}

export function decode(s: string) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&')
}

// The readable text of an HTML page: no scripts, styles or menus, block ends as new lines.
export function htmlToText(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|template|iframe|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|section|article|header|blockquote|pre|table|main)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decode(body)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title: oneLine(decode(title), 160), text }
}

export function header(headers: Record<string, string>, name: string) {
  const key = Object.keys(headers).find(k => k.toLowerCase() === name)
  return key ? (headers[key] ?? '') : ''
}

export function slug(question: string) {
  return (
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'research'
  )
}

export function toolLine(tools: ToolUse[]) {
  return tools.map(t => `${t.name} x${t.calls}`).join(', ')
}

export function sourceLines(sources: Source[]) {
  return sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.url}`)
}
