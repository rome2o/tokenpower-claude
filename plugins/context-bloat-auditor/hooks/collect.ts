// Pure: the engine's breakdown to a list of items. Reads numbers only, never a file.
import type { Item, Totals } from '../types'

import { basename, cleanKey, cleanName, cleanPath, clampTokens, isSecretPath, normPath, SECRET_TEXT, shortPath } from './guards.ts'

// The part of the engine's breakdown this mod reads, written out so no engine import is needed.
export type BreakdownLike = {
  memoryFiles?: readonly { path: string; type: string; tokens: number }[]
  skills?: {
    totalSkills: number
    includedSkills: number
    tokens: number
    skillFrontmatter: readonly { name: string; source: string; pluginName?: string; tokens: number }[]
  }
  slashCommands?: { totalCommands: number; includedCommands: number; tokens: number }
  agents?: readonly { agentType: string; source: string; tokens: number }[]
}

export type Collected = {
  memory: Item[]
  skills: Item[]
  agents: Item[]
  totals: Totals
  hasSkills: boolean
  hasCommands: boolean
}

const byTokens = (a: Item, b: Item) => b.tokens - a.tokens || a.label.localeCompare(b.label)

const count = (n: unknown) => clampTokens(n)

// A list the engine should give; anything else (absent, null, an object) is an empty list, and a non-object entry is skipped.
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? x.filter((i): i is T => !!i && typeof i === 'object') : [])

// The name is capped for drawing; the key keeps up to 300 characters so two long names that differ late are not called duplicates.
const named = (kind: Item['kind'], name: unknown, source: unknown, tokens: unknown): Item => {
  const key = cleanKey(name)
  return { kind, label: cleanName(name), source: cleanName(source), tokens: clampTokens(tokens), secret: false, key }
}

export function collect(b: BreakdownLike, home: string, showPaths: boolean): Collected {
  const memory: Item[] = list<{ path: unknown; type: unknown; tokens: unknown }>(b.memoryFiles).map(f => {
    // Secrecy is decided on the same normal form that is drawn, so what is checked is what is shown.
    const secret = isSecretPath(f.path)
    const np = typeof f.path === 'string' ? normPath(f.path) : ''
    const sp = shortPath(np, home)
    const shown = showPaths || sp === '~' ? sp : `.../${basename(sp)}`
    return {
      kind: 'memory' as const,
      label: secret ? SECRET_TEXT : cleanPath(shown),
      source: cleanName(f.type),
      tokens: clampTokens(f.tokens),
      secret,
      key: secret ? '' : cleanKey(basename(np)),
    }
  })
  const skills: Item[] = list<{ name: unknown; source: unknown; pluginName?: unknown; tokens: unknown }>(b.skills?.skillFrontmatter).map(s =>
    named('skill', s.name, s.pluginName ? s.pluginName : s.source, s.tokens),
  )
  const agents: Item[] = list<{ agentType: unknown; source: unknown; tokens: unknown }>(b.agents).map(a => named('agent', a.agentType, a.source, a.tokens))
  memory.sort(byTokens)
  skills.sort(byTokens)
  agents.sort(byTokens)
  const sum = (xs: Item[]) => xs.reduce((n, x) => n + x.tokens, 0)
  const sk = b.skills && typeof b.skills === 'object' ? b.skills : undefined
  const sc = b.slashCommands && typeof b.slashCommands === 'object' ? b.slashCommands : undefined
  const totals: Totals = {
    memory: sum(memory),
    memoryCount: memory.length,
    skills: sk ? clampTokens(sk.tokens) : 0,
    skillCount: sk ? count(sk.totalSkills) : 0,
    commands: sc ? clampTokens(sc.tokens) : 0,
    commandCount: sc ? count(sc.totalCommands) : 0,
    agents: sum(agents),
    agentCount: agents.length,
  }
  return { memory, skills, agents, totals, hasSkills: sk !== undefined, hasCommands: sc !== undefined }
}
