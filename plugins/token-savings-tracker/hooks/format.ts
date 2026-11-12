import type { Row } from '../types'

import { MONTHS } from './constants.ts'
import { localDay, modelLabel, modName } from './pure.ts'

// Tokens saved per part, for each mod whose lines carry a part: "Large File Reader: file saved 12,000 (2) · ...".
export function partLines(rows: readonly Row[]): string[] {
  const mods = new Map<string, Map<string, { saved: number; n: number }>>()
  for (const r of rows) {
    if (!r.part || r.leftOut) continue
    const name = modName(r.mod)
    const parts = mods.get(name) ?? new Map<string, { saved: number; n: number }>()
    const t = parts.get(r.part) ?? { saved: 0, n: 0 }
    t.saved += r.saved
    t.n += 1
    parts.set(r.part, t)
    mods.set(name, parts)
  }
  // Large File Reader's own order first, then any other part by name.
  const rank = (part: string) => {
    const i = ['file', 'connector', 'web'].indexOf(part)
    return i === -1 ? 99 : i
  }
  return [...mods].map(
    ([name, parts]) =>
      `${name}: ${[...parts]
        .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
        .map(([part, t]) => `${part} saved ${fmt(t.saved)} (${t.n})`)
        .join(' · ')}`,
  )
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export function fmt(n: number) {
  const s = Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return n < 0 ? `-${s}` : s
}

export function money(x: number) {
  const a = Math.abs(x)
  const s = a >= 1 ? a.toFixed(2) : a >= 0.1 ? a.toFixed(3) : a.toFixed(4)
  return `${x < 0 && Number(s) !== 0 ? '-' : ''}$${s}`
}

export const usdWords = (x: number) => (x >= 0 ? `saved ${money(x)}` : `cost ${money(-x)} more`)

export function timeLabel(ms: number, day: string) {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return localDay(ms) === day ? hm : `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${hm}`
}

export function clip(text: string, width: number) {
  const w = Math.max(8, width)
  return text.length <= w ? text : `${text.slice(0, w - 1)}…`
}

export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Today adds up every chat on this Mac (build chats too), so the card says how many.
export const todayLabel = (chats: number) => (chats === 1 ? 'TODAY · 1 CHAT' : chats ? `TODAY · ALL ${chats} CHATS` : 'TODAY · ALL CHATS')

export function helperLine(r: Row) {
  if (!r.helper) return 'No helper model'
  const h = r.helper
  const tokens = `${modelLabel(h.model)}, ${fmt(h.in)} in / ${fmt(h.out)} out`
  if (r.helperPriced === 'bill') return `Helper: ${tokens}, ${money(r.helperUsd ?? 0)} (its bill)`
  if (r.helperPriced === 'list') return `Helper: ${tokens}, ~${money(r.helperUsd ?? 0)}`
  if (r.helperPriced === 'estimated') return `Helper: ${tokens}, ~${money(r.helperUsd ?? 0)} (estimated)`
  return `Helper: ${tokens}, price unknown`
}
