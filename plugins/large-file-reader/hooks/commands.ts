import type { EngineInterface } from 'claude-code'
import { MIN_CHARS, MIN_TOKENS, NAME, PARTS, TITLE, TRIM_ENOUGH_CHARS, ZOOM_PAGES } from './constants.ts'
import type { Part } from './constants.ts'
import { sessionId } from './ledger.ts'
import { RECENT_MAX, S, chatOff, done, fullNext, globalOff, hiddenIn } from './state.ts'
import { fmt } from './text.ts'

// ============================================================================
// Commands
// ============================================================================

export const PART_WORDS: Record<string, Part> = {
  file: 'file',
  files: 'file',
  read: 'file',
  connector: 'connector',
  connectors: 'connector',
  mcp: 'connector',
}
// The web part was removed on 2026-11-03.
export const REMOVED = new Set(['web', 'webfetch', 'fetch'])

const ABOUT: Record<Part, string> = {
  file: `a whole Read over ~${fmt(MIN_TOKENS)} tokens, a PDF over ${ZOOM_PAGES} pages, or a Bash read (cat, sed, grep, curl and the like) over ~${fmt(MIN_TOKENS)} tokens gets Haiku notes with line numbers`,
  connector: `a connector result over ~${fmt(MIN_CHARS / 4)} tokens is trimmed by code, then read by Haiku if still over ~${fmt(TRIM_ENOUGH_CHARS / 4)}`,
}

export async function statusText($: EngineInterface) {
  const sid = await sessionId($)
  const list = done.get(sid) ?? []
  const lines = [`${TITLE} is on.`]
  for (const p of PARTS) {
    const mine = list.filter(d => d.part === p)
    const state = globalOff.has(p)
      ? `off in every chat ("${NAME}:${p}": false in switches.json)`
      : chatOff.get(sid)?.has(p)
        ? `off in this chat (/input-router on ${p})`
        : 'on'
    const sum = mine.length
      ? `${mine.length} handled, ${fmt(mine.reduce((s, d) => s + d.before, 0))} to ${fmt(mine.reduce((s, d) => s + d.after, 0))} tokens`
      : 'nothing handled yet'
    lines.push(`- ${p[0]!.toUpperCase()}${p.slice(1)}: ${state}. ${sum}. When: ${ABOUT[p]}.`)
  }
  lines.push(`- /input-router full: ${fullNext.has(sid) ? 'armed. The next big input comes through whole.' : 'lets the next big input through whole, once.'}`)
  lines.push(
    `- Pane: ${S.globalHidden ? `hidden in every chat ("${NAME}:hidden": true in switches.json)` : hiddenIn.has(sid) ? 'hidden in this chat. /input-router pane shows it' : 'opens when Haiku reads something. /input-router pane opens it now'}.`,
  )
  if (list.length) lines.push(`- Recent: ${list.slice(-RECENT_MAX).reverse().map(d => `${d.label} ${fmt(d.before)} to ${fmt(d.after)} (${d.part}, ${d.how})`).join('; ')}.`)
  lines.push(`- Ledger: ${S.home}/.claude/mods-logs/savings.jsonl`)
  return lines.join('\n')
}
