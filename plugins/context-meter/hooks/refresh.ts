import { update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { meterFromBreakdown, meterFromPlain } from './bar.ts'
import type { MeterData } from './bar.ts'
import { errText, log, logOnce, readSaved } from './io.ts'
import { S } from './state.ts'
import { readSwitches } from './switches.ts'

async function publish($: EngineInterface, m: MeterData) {
  const sig = JSON.stringify(m)
  S.breakdown = m
  // The same figures draw the same band: no atom write, so no redraw.
  if (sig === S.lastSig) return
  S.lastSig = sig
  await update($, { plugin: 'context-meter', key: 'meter' } as const, () => m)
}

// The /mods switchboard: off, or hidden. A missing file leaves what was there.
export async function applySwitches($: EngineInterface) {
  const sw = await readSwitches($, S.home)
  if (!sw) return
  const changed = sw.off !== S.off || sw.hidden !== S.switchHidden
  S.off = sw.off
  S.switchHidden = sw.hidden
  if (changed) {
    S.lastSig = ''
    try {
      $.ui.invalidate('ui.render')
    } catch {
      // The next state change redraws anyway.
    }
  }
}

// Today's saved tokens from the ledger, cached by size, modified time and day.
async function loadSaved($: EngineInterface) {
  if (S.ledgerBusy) return
  S.ledgerBusy = true
  try {
    const r = await readSaved($, await $.clock.now())
    S.savedToday = r.saved
    S.ledgerSig = r.sig
  } catch (err) {
    await logOnce($, `ledger:${errText(err)}`, `ledger read failed: ${errText(err)}`)
  } finally {
    S.ledgerBusy = false
  }
}

/** The whole band: the context breakdown, the cost and today's saved tokens. `cost` is the figure a session.measure carried. */
export async function refresh($: EngineInterface, cost?: number): Promise<void> {
  if (S.off) return
  if (S.busy) {
    S.again = true
    return
  }
  S.busy = true
  const gen = S.gen
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const usd = u?.cost?.usd ?? cost
    S.costUsd = typeof usd === 'number' && Number.isFinite(usd) ? usd : null
    await loadSaved($)
    // A chat that ended while this read was in flight keeps its cleared band.
    if (S.gen !== gen) return
    const ctx = u?.context
    if (!ctx) throw new Error('usage() returned no context')
    const bd = ctx.breakdown
    await publish($, bd ? meterFromBreakdown(bd, S.costUsd, S.savedToday) : meterFromPlain(ctx, S.costUsd, S.savedToday))
  } catch (err) {
    // No old figures under a failed read: the band hides until the next good one.
    S.breakdown = null
    S.lastSig = ''
    try {
      await update($, { plugin: 'context-meter', key: 'meter' } as const, () => null)
    } catch {
      // The band keeps what it had.
    }
    await logOnce($, `refresh:${errText(err)}`, `refresh failed: ${errText(err)}`)
  } finally {
    S.busy = false
    if (S.again) {
      S.again = false
      void refresh($, cost).catch(() => undefined)
    }
  }
}

/** The 30 second tick: the switchboard and today's saved tokens only. The breakdown is not read again. */
export async function tick($: EngineInterface) {
  await applySwitches($)
  if (S.off) return
  await loadSaved($)
  if (S.breakdown) await publish($, { ...S.breakdown, saved: S.savedToday })
}
