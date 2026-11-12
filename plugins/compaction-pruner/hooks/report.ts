import type { Mode, Report } from '../types'

import { cleanName } from './guards.ts'
import { RETENTION_DAYS } from './limits.ts'

// Pure: turns plain numbers and names into the lines the pane and the toasts show.
// It never sees tool text, only tool names, sizes and the rule that fired.

const RULE_NAMES = {
  R1: 'a later read of the same file replaced it',
  R2: 'the same output came again later',
  R3: 'old large Bash or Grep output',
  R4: 'a screenshot or encoded blob',
} as const

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export function dryToast(count: number, tokens: number): string {
  return count === 0
    ? 'Dry run: nothing in this compaction would be shortened.'
    : `Dry run: would shorten ${count} result${count === 1 ? '' : 's'}, about ${fmt(tokens)} tokens. Nothing was changed. Type /prune status for the list.`
}

export function liveToast(count: number, tokens: number, firstId: string, failed: number, skipped = 0): string {
  const base = `Pruned ${count} result${count === 1 ? '' : 's'}, saved about ${fmt(tokens)} tokens. Recover with /prune open ${firstId}.`
  const more = `${failed ? ` ${failed} not pruned (could not save the original).` : ''}${skipped ? ` ${skipped} left as they were (size or time limit).` : ''}`
  return `${base}${more}`
}

export function reportLines(r: Report, limit: number): string[] {
  const lines = [
    `${r.mode === 'dry' ? 'Dry run' : 'Live run'} at ${Number.isFinite(r.at) ? new Date(r.at).toISOString().replace('T', ' ').slice(0, 19) : 'an unknown time'} UTC, trigger ${cleanName(r.trigger)}.`,
    `${r.items.length} result${r.items.length === 1 ? '' : 's'}, about ${fmt(r.tokens)} tokens (estimated, characters / 4).`,
  ]
  for (const it of r.items.slice(0, limit)) lines.push(`  ${cleanName(it.tool)}  ${fmt(it.tokens)} tokens  ${RULE_NAMES[it.rule] ?? 'a rule'}`)
  if (r.items.length > limit) lines.push(`  and ${r.items.length - limit} more`)
  if (r.mode === 'live') {
    lines.push(`Originals (secrets masked) are in ${cleanName(r.folder)}.`)
    if (r.ids.length) lines.push(`Ids: ${r.ids.slice(0, 12).map(cleanName).join(' ')}${r.ids.length > 12 ? ' ...' : ''}`)
    if (r.failed) lines.push(`${r.failed} result${r.failed === 1 ? '' : 's'} not pruned because the original could not be saved.`)
    if (r.skipped) lines.push(`${r.skipped} result${r.skipped === 1 ? '' : 's'} left as they were because of the size or time limit for one compaction.`)
  }
  return lines
}

export function statusLines(mode: Mode, last: Report | null, oldCount: number | null, limit: number): string[] {
  const lines = [
    `Mode: ${mode}. ${mode === 'off' ? 'Compactions pass through untouched.' : mode === 'dry' ? 'Compactions are only reported, never changed.' : 'Old large tool results are shortened when you compact.'}`,
    'Commands: /prune on, /prune dry, /prune live, /prune off, /prune status, /prune old, /prune open <id>',
  ]
  if (oldCount !== null) lines.push(oldCount ? `${oldCount} saved folder${oldCount === 1 ? '' : 's'} older than ${RETENTION_DAYS} days. Type /prune old to list them.` : `No saved folders older than ${RETENTION_DAYS} days.`)
  lines.push('')
  if (last) lines.push(...reportLines(last, limit))
  else lines.push('No compaction seen in this chat yet.')
  return lines
}

export function oldLines(scan: { old: { shown: string; ageDays: number }[]; chats: number; unreadable: number }, limit: number): string[] {
  const lines = [`${scan.chats} chat folder${scan.chats === 1 ? '' : 's'} in the store, ${scan.old.length} older than ${RETENTION_DAYS} days.`]
  if (scan.old.length) lines.push('This mod deletes nothing. Clear these yourself when you no longer need the originals:')
  for (const o of scan.old.slice(0, limit)) lines.push(`  ${o.shown}  (${o.ageDays} days)`)
  if (scan.old.length > limit) lines.push(`  and ${scan.old.length - limit} more`)
  if (scan.unreadable) lines.push(`${scan.unreadable} folder${scan.unreadable === 1 ? '' : 's'} could not be read.`)
  return lines
}
