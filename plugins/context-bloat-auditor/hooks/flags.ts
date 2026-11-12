// Pure: items to flags. Metadata only. Wording asks for a look by hand and never says to delete.
import type { Flag, Item } from '../types'

import { fmt } from './format.ts'
import { capText } from './guards.ts'

type Opts = { flagTokens: number; dupMinTokens: number }

const KIND_WORD: Record<Item['kind'], string> = { memory: 'Memory file', skill: 'Skill', agent: 'Agent' }

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const g = m.get(k)
    if (g) g.push(x)
    else m.set(k, [x])
  }
  return m
}

// At most five distinct sources are listed, then a count of the rest, and a whole flag is capped, so one flag stays short.
const MAX_SOURCES = 5
const MAX_FLAG_TEXT = 300

function sources(xs: Item[]): string {
  const all = [...new Set(xs.map(x => x.source).filter(Boolean))]
  const more = all.length - MAX_SOURCES
  return more > 0 ? `${all.slice(0, MAX_SOURCES).join(', ')} and ${fmt(more)} more` : all.join(', ')
}

const flagText = (s: string) => capText(s, MAX_FLAG_TEXT)

export function flagsOf(memory: Item[], skills: Item[], agents: Item[], o: Opts): Flag[] {
  const out: Flag[] = []
  for (const it of [...memory, ...skills, ...agents]) {
    if (it.tokens <= o.flagTokens) continue
    out.push({
      kind: 'big',
      label: it.label,
      text: flagText(`${KIND_WORD[it.kind]}, ${fmt(it.tokens)} tokens, over ${fmt(o.flagTokens)}. Trim by hand if you agree.`),
      tokens: it.tokens,
    })
  }
  // (a) skills with an identical name, even from different plugins: the names collide in the listing.
  for (const [name, g] of groupBy(skills, s => s.key)) {
    if (name === '' || g.length < 2) continue
    out.push({
      kind: 'dup',
      label: g[0]?.label ?? '',
      text: flagText(`Possible duplicate, check by hand. ${g.length} skills share this name (${sources(g) || 'unknown source'}).`),
      tokens: g.reduce((n, x) => n + x.tokens, 0),
    })
  }
  // (b) memory files with the same file name and the same size, above a small size. Credential-like files are left out.
  const mem = memory.filter(m => !m.secret && m.tokens > o.dupMinTokens)
  for (const [, g] of groupBy(mem, m => `${m.key}|${m.tokens}`)) {
    if (g.length < 2) continue
    out.push({
      kind: 'dup',
      label: capText(g[0]?.key ?? '', 60),
      text: flagText(`Possible duplicate, check by hand. ${g.length} memory files share this name and size (${fmt(g[0]?.tokens ?? 0)} tokens).`),
      tokens: g.reduce((n, x) => n + x.tokens, 0),
    })
  }
  // (c) agents with an identical type.
  for (const [name, g] of groupBy(agents, a => a.key)) {
    if (name === '' || g.length < 2) continue
    out.push({
      kind: 'dup',
      label: g[0]?.label ?? '',
      text: flagText(`Possible duplicate, check by hand. ${g.length} agents share this type (${sources(g) || 'unknown source'}).`),
      tokens: g.reduce((n, x) => n + x.tokens, 0),
    })
  }
  return out.sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label))
}
