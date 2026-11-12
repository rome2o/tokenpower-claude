import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionCompactInput } from 'claude-code'

import type { Mode, Report } from '../types'

import { BUDGET_MS, EMPTY_VIEW, MAX_CANDIDATES, MAX_RESULT_CHARS, MAX_SAVE_CHARS, PANE, SAVE_BUDGET_MS, SHOW_CHARS, SHOW_ITEMS, TITLE } from './constants.ts'
import { cleanLine, isValidId, redact, shortOf, stampOf } from './guards.ts'
import { homeOf, log, readMode, writeMode } from './io.ts'
import { ledgerLine } from './ledger.ts'
import { makeStub, rebuild } from './rebuild.ts'
import { dryToast, liveToast, oldLines, statusLines } from './report.ts'
import { planCandidates } from './rules.ts'
import { S } from './state.ts'
import { listOld, openById, saveLedgerLine, saveOriginal, storeRoot, tildeOf } from './store.ts'
import { isSwitchedOff } from './switches.ts'

// Compaction Pruner is OFF until /prune on. When you compact, it shortens old large tool results with
// simple local rules, keeps the original text (secrets masked) in ~/.claude/mods-logs/compaction-pruner/,
// and lets core write the summary. It deletes nothing, runs no command and makes no network or model call.

// The state reference is written here, in the file that reads and writes it.
const viewAtom = atom({ plugin: 'compaction-pruner', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-1' })

async function show($: EngineInterface, title: string, lines: string[]) {
  await update($, viewAtom, () => ({ title: cleanLine(title), lines: lines.map(cleanLine) }))
  await $.ui.open({ id: PANE, title: TITLE })
}

function toast($: EngineInterface, text: string) {
  try {
    $.ui.toast(text)
  } catch {
    // The toast is only a hint.
  }
}

type Prepared = { input: SessionCompactInput; report: Report; stamp: string; before: number; after: number } | null

// Plans the compaction. Returns null whenever the compaction should go on exactly as core would do it.
async function prepare($: EngineInterface, e: SessionCompactInput, mode: 'dry' | 'live'): Promise<Prepared> {
  const t0 = await $.clock.now()
  // Dry mode changes and writes nothing, so it does not write the log either.
  const note = (text: string) => (mode === 'live' ? log($, text) : Promise.resolve())
  const plan = planCandidates(e.messages)
  if (!plan.ok) {
    await note(`skipped: ${plan.reason}`)
    return null
  }
  if ((await $.clock.now()) - t0 > BUDGET_MS) {
    await note(`skipped: planning took over ${BUDGET_MS} ms`)
    return null
  }
  const items = plan.candidates.map(c => ({ tool: c.tool, tokens: c.tokens, rule: c.rule }))
  const tokens = items.reduce((a, c) => a + c.tokens, 0)
  const base: Report = { at: t0, mode, trigger: e.trigger, items, tokens, ids: [], folder: '', failed: 0, skipped: 0 }
  if (mode === 'dry') {
    S.lastReport = base
    toast($, dryToast(items.length, tokens))
    return null
  }
  if (!S.home) {
    await note('skipped: the Claude home folder is not known')
    return null
  }

  const stamp = stampOf(t0)
  const stubs = new Map<string, string>()
  const ids: string[] = []
  const kept: typeof items = []
  let failed = 0
  let skipped = 0
  let n = 0
  let chars = 0
  for (const c of plan.candidates) {
    const original = e.messages[c.resIdx]?.toolResults?.find(r => r.tool_use_id === c.id)?.text
    if (original === undefined) continue
    // One compaction saves at most so many results, so many characters, for so long. The rest stay as they are.
    if (n >= MAX_CANDIDATES || original.length > MAX_RESULT_CHARS || chars + original.length > MAX_SAVE_CHARS || (await $.clock.now()) - t0 > SAVE_BUDGET_MS) {
      skipped++
      continue
    }
    n++
    const masked = redact(original)
    const saved = await saveOriginal($, S.home, S.short, stamp, n, masked, original)
    if (!saved) {
      failed++
      continue
    }
    chars += original.length
    stubs.set(c.id, makeStub(original, saved.shown, saved.id, masked))
    ids.push(saved.id)
    kept.push({ tool: c.tool, tokens: c.tokens, rule: c.rule })
  }
  if (failed) await note(`${failed} result(s) not pruned: the original could not be saved`)
  if (skipped) await note(`${skipped} result(s) not pruned: the size, count or time limit for one compaction was reached`)
  if (stubs.size === 0) {
    S.lastReport = { ...base, items: [], tokens: 0, failed, skipped }
    if (failed) toast($, `Nothing pruned: ${failed} original${failed === 1 ? '' : 's'} could not be saved.`)
    return null
  }
  const r = rebuild(e.messages, stubs)
  if (!r.ok) {
    await note(`skipped: rebuild refused (${r.reason})`)
    return null
  }
  const folder = tildeOf(`${storeRoot(S.home)}/${S.short}/${stamp}`, S.home)
  const report: Report = { ...base, items: kept, tokens: r.before - r.after, ids, folder, failed, skipped }
  return { input: { ...e, messages: r.messages }, report, stamp, before: r.before, after: r.after }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    S.root = $.plugin.root.replace(/\/\.claude-plugin\/?$/, '')
    S.home = homeOf($)
    try {
      S.sid = await $.session.id()
    } catch {
      S.sid = ''
    }
    S.short = shortOf(S.sid)
    S.mode = await readMode($)
    await $.command.register({ name: 'prune', description: 'Compaction Pruner: on, dry, live, off, status, old, open <id>', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'prune' }, async ($, e) => {
    const parts = e.args.trim().split(/\s+/)
    const sub = (parts[0] ?? '').toLowerCase()
    const set = async (mode: Mode, text: string) => {
      await writeMode($, mode)
      return { text }
    }
    if (sub === 'on') {
      if (S.mode !== 'off') return { text: `Compaction Pruner is already ${S.mode}.` }
      return set('dry', 'Compaction Pruner is on in dry-run mode: at each compaction it reports what it would shorten and changes nothing. Type /prune live to let it shorten results, /prune off to turn it off.')
    }
    if (sub === 'off') return set('off', 'Compaction Pruner is off. Compactions run as core does them.')
    if (sub === 'dry') return set('dry', 'Dry-run mode. Compactions only get a report; nothing is changed.')
    if (sub === 'live') {
      if (!S.home) return { text: 'Live mode needs the Claude home folder, which was not found. Staying in the current mode.' }
      return set('live', 'Live mode. At the next compaction, old large tool results are shortened and the originals are saved (secrets masked) under ~/.claude/mods-logs/compaction-pruner/. Nothing is ever deleted by this mod.')
    }
    if (sub === '' || sub === 'status') {
      S.mode = await readMode($)
      const scan = await listOld($, S.home, await $.clock.now())
      await show($, 'Compaction Pruner status', statusLines(S.mode, S.lastReport, scan.old.length, SHOW_ITEMS))
      return { text: 'Opened Compaction Pruner.' }
    }
    if (sub === 'old') {
      const scan = await listOld($, S.home, await $.clock.now())
      await show($, 'Saved folders older than the retention time', oldLines(scan, SHOW_ITEMS))
      return { text: 'Opened the list of old saved folders. This mod deletes nothing; clear them yourself.' }
    }
    if (sub === 'open') {
      const id = (parts[1] ?? '').toLowerCase()
      if (!isValidId(id)) return { text: 'Usage: /prune open <id>. The id is in the toast and in /prune status.' }
      const o = await openById($, S.home, id)
      if (!o.ok) return { text: o.why }
      const shown = o.text.length > SHOW_CHARS ? `${o.text.slice(0, SHOW_CHARS)}\n\n(shown part only; the file holds the rest)` : o.text
      await show($, `Saved result ${id}`, [`File: ${o.shown}`, 'Secrets in this text are masked.', '', ...shown.split('\n').slice(0, SHOW_ITEMS * 5)])
      return { text: `Opened ${id}.` }
    }
    return { text: 'Usage: /prune on | dry | live | off | status | old | open <id>' }
  })

  on('session.compact', async ($, e, next) => {
    let input: SessionCompactInput = e
    let prepared: Prepared = null
    try {
      // The hook does nothing for a precompute, a subagent's compaction, or while another one is being planned.
      if (e.trigger !== 'precompute' && e.agentId === undefined && !S.busy) {
        S.busy = true
        try {
          const mode = await readMode($)
          S.mode = mode
          if (mode !== 'off' && !(await isSwitchedOff($))) {
            prepared = await prepare($, e, mode)
            if (prepared) input = prepared.input
          }
        } finally {
          S.busy = false
        }
      }
    } catch (err) {
      input = e
      prepared = null
      if (S.mode === 'live') await log($, `prepare failed: ${String(err instanceof Error ? err.message : err)}`)
    }

    // No second try with the unshortened list: the engine documents no error that means "this list shape is refused",
    // and any other failure (overload, cancel) would run the summary a second time.
    const result = await next(input)

    if (prepared && result.skip === undefined) {
      try {
        S.lastReport = prepared.report
        const at = await $.clock.now()
        await saveLedgerLine($, S.home, S.short, prepared.stamp, ledgerLine(at, S.sid, prepared.report.items.length, prepared.before, prepared.after, prepared.report.folder))
        toast($, liveToast(prepared.report.items.length, prepared.report.tokens, prepared.report.ids[0] ?? '', prepared.report.failed, prepared.report.skipped))
      } catch (err) {
        await log($, `after-compaction notes failed: ${String(err instanceof Error ? err.message : err)}`)
      }
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, viewAtom)
    return (
      <Box flexDirection="column" width={Math.max(30, e.props.bodyColumns)}>
        <Text bold>{v.title || TITLE}</Text>
        {v.lines.map((line, i) => (
          <Text key={`l${i}`} wrap="wrap">
            {line || ' '}
          </Text>
        ))}
      </Box>
    )
  })
}
