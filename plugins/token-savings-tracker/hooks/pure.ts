import type { Row } from '../types'

import type { Scan } from './types.ts'
import { MOD_NAMES, PER_M } from './constants.ts'

/**
 * List prices per token, from the claude-api skill (model-migration.md), read 2026-11-02.
 * Anything else (Jev, an unknown model) has no price: the pane says so instead of guessing.
 */
export function priceOf(model: string, prompt: number): { in: number; out: number } | null {
  const m = model.toLowerCase()
  if (/fable|mythos/.test(m)) return { in: 10 * PER_M, out: 50 * PER_M }
  if (/opus-5[-.]5/.test(m) || /^opus(\[|$)/.test(m)) return { in: 4 * PER_M, out: 20 * PER_M }
  if (/opus-5(?![-.]\d)/.test(m)) return { in: 5 * PER_M, out: 25 * PER_M }
  if (/sonnet-5/.test(m) || /^sonnet(\[|$)/.test(m)) return { in: 2 * PER_M, out: 10 * PER_M }
  if (/haiku-5[-.]5/.test(m) || /^haiku(\[|$)/.test(m)) {
    return prompt <= 100_000 ? { in: 0.1 * PER_M, out: 0.5 * PER_M } : { in: 0.5 * PER_M, out: 2.5 * PER_M }
  }
  if (/haiku-4[-.]5/.test(m)) return { in: 1 * PER_M, out: 5 * PER_M }
  return null
}

/**
 * Prompt cache prices per token, from the claude-api skill (prompt-caching.md, models.md), read 2026-11-03.
 * Claude writes the cache with the 1-hour TTL (ephemeral_1h_input_tokens), so a write is 2x input.
 * A read is 0.05x input on Opus 5.5, 0.025x on Fable 5.1 and Mythos 5.1, 0.1x on the others.
 */
export function cacheOf(model: string): { write: number; read: number } | null {
  const p = priceOf(model, 0)
  if (!p) return null
  const m = model.toLowerCase()
  const readX =
    /(fable|mythos)-5[-.]1/.test(m) || /^(fable|mythos)(\[|$)/.test(m)
      ? 0.025
      : /opus-5[-.]5/.test(m) || /^opus(\[|$)/.test(m)
        ? 0.05
        : 0.1
  return { write: 2 * p.in, read: readX * p.in }
}

// Several transcript entries share one request id: the first one dates the request.
export function parseScan(text: string): Scan {
  const seen = new Set<string>()
  const requests: Scan['requests'] = []
  const compacts: number[] = []
  for (const line of text.split('\n')) {
    const p = line.trim().split(' ')
    const ms = Date.parse(p[1] ?? '')
    if (!Number.isFinite(ms)) continue
    if (p[0] === 'C') compacts.push(ms)
    else if (p[0] === 'M' && p[2] && !seen.has(p[2])) {
      seen.add(p[2])
      requests.push({ ms, model: p[3] ?? '' })
    }
  }
  compacts.sort((a, b) => a - b)
  return { requests, compacts }
}

// Each request after a tool result sends it again, until a compaction drops it.
export function laterRequests(scan: Scan, ms: number): { n: number; model: string } {
  const stop = scan.compacts.find(c => c > ms) ?? Infinity
  let n = 0
  let model = ''
  for (const r of scan.requests) {
    if (r.ms <= ms || r.ms >= stop) continue
    n += 1
    if (!model && priceOf(r.model, 0)) model = r.model
  }
  return { n, model }
}

export function modelLabel(model: string) {
  const m = model.replace(/^claude-/, '').replace(/\[.*\]$/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1')
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : 'unknown'
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function str(v: unknown) {
  return typeof v === 'string' ? v : ''
}

export function hash(text: string) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function localDay(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

export const modName = (mod: string) => MOD_NAMES[mod] ?? mod

// A mod with parts (Large File Reader: file, connector, web) shows the part after its name.
export const rowName = (r: Pick<Row, 'mod' | 'part'>) => (r.part ? `${modName(r.mod)} · ${r.part}` : modName(r.mod))
