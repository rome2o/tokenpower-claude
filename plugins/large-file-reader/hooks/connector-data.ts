import { DATA_CHUNK_CHARS, DROP_KEY, PAGING_HOLDER, PAGING_KEY } from './constants.ts'

// ============================================================================
// Connector part (was Connector Reader)
// ============================================================================

// The text of a result, when it is plain text or text blocks only. Anything else is not ours to change.
export function textOf(result: unknown): { texts: string[] } | { skip: string } {
  if (typeof result === 'string') return { texts: [result] }
  if (!Array.isArray(result)) return { skip: 'not text' }
  const parts: string[] = []
  for (const block of result) {
    const type = block && typeof block === 'object' ? (block as { type?: unknown }).type : undefined
    if (type === 'image' || type === 'document') return { skip: 'image' }
    if (type !== 'text') return { skip: `block ${String(type)}` }
    parts.push(String((block as { text?: unknown }).text ?? ''))
  }
  return { texts: parts }
}

// The words of the task, so the trimmer never drops a field the task names.
export function wordsOf(text: string) {
  const words = new Set<string>()
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) ?? []) {
    words.add(w)
    if (w.endsWith('s')) words.add(w.slice(0, -1))
  }
  return words
}

function isWanted(key: string, words: Set<string>) {
  return key
    .toLowerCase()
    .split(/[_\-.\s]+/)
    .some(part => part.length >= 4 && words.has(part))
}

type Trim = { removed: Set<string>; cut: number; cutChars: number; unpacked: number; words: Set<string>; cap: number }

export function trim(words: Set<string>, cap: number): Trim {
  return { removed: new Set(), cut: 0, cutChars: 0, unpacked: 0, words, cap }
}

function isEmpty(v: unknown) {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  return typeof v === 'object' && Object.keys(v as object).length === 0
}

export function trimValue(v: unknown, t: Trim): unknown {
  if (typeof v === 'string') {
    if (v.length >= 200 && !v.includes(' ') && /^[A-Za-z0-9+/=\r\n]+$/.test(v)) {
      t.cut += 1
      return '[base64 removed]'
    }
    // JSON written into a text field is unpacked, so the trim reaches inside it.
    if (/^\s*[[{]/.test(v)) {
      const inner = parseOne(v)
      if (inner !== undefined) {
        t.unpacked += 1
        return trimValue(inner, t)
      }
    }
    if (v.length > t.cap) {
      t.cut += 1
      t.cutChars += v.length - t.cap
      return `${v.slice(0, t.cap)} [+${(v.length - t.cap).toLocaleString('en-US')} characters, full text in the file]`
    }
    return v
  }
  if (Array.isArray(v)) {
    const items = v.map(x => trimValue(x, t)).filter(x => !isEmpty(x))
    return hoist(items)
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (DROP_KEY.test(k) && !isWanted(k, t.words)) {
        t.removed.add(k)
        continue
      }
      const kept = trimValue(x, t)
      if (!isEmpty(kept)) out[k] = kept
    }
    return out
  }
  return v
}

// A list of three or more records whose fields hold the same value in every record lists those fields once.
function hoist(items: unknown[]): unknown {
  if (items.length < 3 || !items.every(x => x && typeof x === 'object' && !Array.isArray(x))) return items
  const rows = items as Record<string, unknown>[]
  const same: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rows[0]!)) {
    const json = JSON.stringify(v)
    if (json.length < 40) continue
    if (rows.every(r => k in r && JSON.stringify(r[k]) === json)) same[k] = v
  }
  if (Object.keys(same).length === 0) return items
  return {
    same_in_every_item: same,
    items: rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !(k in same)))),
  }
}

export function parseOne(text: string): unknown {
  const s = text.trim()
  if (!/^[[{]/.test(s)) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

// The texts of a list of text blocks. Core saves a result that way when it has several blocks or block notes.
function blockTexts(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined
  const texts: string[] = []
  for (const b of v) {
    if (!b || typeof b !== 'object' || (b as { type?: unknown }).type !== 'text') return undefined
    const text = (b as { text?: unknown }).text
    if (typeof text !== 'string') return undefined
    texts.push(text)
  }
  return texts
}

// The result as JSON when it is JSON: one value, or one value per text block. A saved list of text blocks is
// unwrapped first; blocks says how many it had.
export function parse(texts: string[]): { data: unknown; text: string; blocks: number } {
  if (texts.length === 1) {
    const v = parseOne(texts[0]!)
    const inner = blockTexts(v)
    if (inner) return { ...parse(inner), blocks: inner.length }
    return { data: v, text: texts[0]!, blocks: 0 }
  }
  const values = texts.map(parseOne)
  const data = values.some(v => v !== undefined) ? values.map((v, i) => v ?? texts[i]) : undefined
  return { data, text: texts.join('\n'), blocks: 0 }
}

// A one-line outline of a JSON value: its keys, and the length of each list.
export function outline(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `list of ${v.length}${v.length && depth < 1 ? ` (each ${outline(v[0], depth + 1)})` : ''}`
  if (v && typeof v === 'object') {
    const keys = Object.entries(v as Record<string, unknown>)
    if (depth >= 1) return `{${keys.slice(0, 12).map(([k]) => k).join(', ')}${keys.length > 12 ? ', ...' : ''}}`
    return `{${keys
      .slice(0, 15)
      .map(([k, x]) => (Array.isArray(x) ? `${k}[${x.length}]` : k))
      .join(', ')}${keys.length > 15 ? ', ...' : ''}}`
  }
  return typeof v
}

// The paging and count fields at the top of the data (or in a meta or pagination object), word for word.
export function pagingOf(data: unknown): string {
  const found: string[] = []
  const look = (o: unknown, prefix: string, depth: number) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (PAGING_KEY.test(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v)) && String(v).length < 200) {
        found.push(`${prefix}${k}: ${JSON.stringify(v)}`)
      } else if (depth === 0 && PAGING_HOLDER.test(k)) look(v, `${k}.`, 1)
    }
  }
  look(data, '', 0)
  return found.length > 0 ? `Paging and count fields, copied by code word for word: ${found.join(', ')}. What each field means is not worked out here.` : ''
}

export function plain(text: string) {
  const tags = text.match(/<\/?[a-z][^>]*>/gi)?.length ?? 0
  const s = tags > 20 ? text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ') : text
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

function slices(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += DATA_CHUNK_CHARS) out.push(text.slice(i, i + DATA_CHUNK_CHARS))
  return out
}

// Splits trimmed data into parts a helper call can read, by records where the data is a list. A part never
// passes DATA_CHUNK_CHARS: one record bigger than that is cut into plain slices.
export function chunks(data: unknown, text: string): string[] {
  if (text.length <= DATA_CHUNK_CHARS) return [text]
  let list: unknown[] | undefined
  let wrap: (part: unknown[]) => unknown = part => part
  if (Array.isArray(data)) list = data
  else if (data && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    let best: [string, unknown[]] | undefined
    for (const [k, v] of entries) {
      const items = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items) ? (v as { items: unknown[] }).items : undefined
      if (items && (!best || items.length > best[1].length)) best = [k, items]
    }
    if (best) {
      const [key, items] = best
      list = items
      const holder = (data as Record<string, unknown>)[key]
      wrap = part => ({
        ...(data as Record<string, unknown>),
        [key]: Array.isArray(holder) ? part : { ...(holder as Record<string, unknown>), items: part },
      })
    }
  }
  if (!list || list.length < 2) return slices(text)
  const out: string[] = []
  let part: unknown[] = []
  let n = 0
  // The wrapper (the other top-level fields) goes into every part, so it counts against the budget.
  const room = DATA_CHUNK_CHARS - JSON.stringify(wrap([])).length
  for (const item of list) {
    const len = JSON.stringify(item).length + 1
    if (part.length > 0 && n + len > room) {
      out.push(JSON.stringify(wrap(part)))
      part = []
      n = 0
    }
    part.push(item)
    n += len
  }
  if (part.length > 0) out.push(JSON.stringify(wrap(part)))
  return out.flatMap(p => (p.length > DATA_CHUNK_CHARS ? slices(p) : [p]))
}

export function clip(text: string, max: number) {
  const s = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)} ...` : s
}

// Long text cut from the middle, so both the start of a request and its last lines reach Haiku.
export function middle(text: string, max: number) {
  const s = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const half = Math.floor((max - 24) / 2)
  return `${s.slice(0, half)} ... [middle cut] ... ${s.slice(s.length - half)}`
}

// Short replies that only say go on. They are not the task, so the walk-back steps over them.
const FILLER = new Set(
  'yes yeah yep yup ok okay k sure go ahead do it that this please pls thanks thank you continue proceed approved approve sounds good great perfect fine lgtm carry on keep going right cool nice alright now then and run start the y'.split(' '),
)
export function isFiller(text: string) {
  if (text.length >= 40 || /[/\\]|\.\w{1,5}\b|\d/.test(text)) return false
  const words = text.toLowerCase().match(/[a-z]+/g) ?? []
  return words.every(w => FILLER.has(w))
}
