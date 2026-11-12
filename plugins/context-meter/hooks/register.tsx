import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Meter } from '../types'

import { CLEAR_WAIT_MS, COMPACT_WAIT_MS, NAME, STORE_HIDDEN, TICK_MS } from './constants.ts'
import { homeOf } from './guards.ts'
import { errText, log, logOnce } from './io.ts'
import { applySwitches, refresh, tick } from './refresh.ts'
import { S } from './state.ts'
import { band } from './view.tsx'

// Context Meter draws one band above the prompt: what fills the context window, how close it is to
// compaction, this chat's cost as Claude reports it, and today's tokens saved by the other mods.
// It reads the savings ledger and never writes it.

function stopTimer() {
  S.timer?.cancel()
  S.timer = null
  S.gen += 1
}

// One timer, ever. It only re-reads the switchboard and the ledger total; a timer of an earlier run stops itself.
function startTimer($: EngineInterface) {
  if (S.timer) return
  const gen = S.gen
  S.timer = $.clock.every(TICK_MS, () => {
    if (S.gen !== gen) return
    void tick($).catch(() => undefined)
  })
}

function redraw($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      stopTimer()
      S.root = $.plugin.root.replace(/\/\.claude-plugin\/?$/, '')
      S.home = homeOf(S.root)
      if (!S.home) await logOnce($, 'no-home', 'plugin root is not under <home>/.claude/plugins/: ledger, switchboard and log are off')
      S.lastSig = ''
      S.breakdown = null
      await $.command.register({ name: NAME, description: 'Show or hide the context meter above the prompt', immediate: true })
      try {
        S.hidden = (await $.store.get(STORE_HIDDEN)) === true
      } catch {
        S.hidden = false
      }
      await applySwitches($)
      await refresh($)
      startTimer($)
    } catch (err) {
      await log($, `session.start failed: ${errText(err)}`)
    }
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    if (S.off) return { text: 'Context Meter is off. Turn it on with /mods.' }
    const arg = String(e.args ?? '').trim().toLowerCase()
    const hide = arg === 'hide' || arg === 'off' ? true : arg === 'show' || arg === 'on' ? false : !S.hidden
    try {
      await $.store.set(STORE_HIDDEN, hide)
    } catch (err) {
      await log($, `save hidden failed: ${errText(err)}`)
    }
    S.hidden = hide
    redraw($)
    if (hide) return { text: 'Context Meter hidden. Type /context-meter to show it.' }
    if (S.switchHidden) return { text: 'Context Meter is hidden by the /mods switch. Turn that off in /mods to see it.' }
    void refresh($).catch(() => undefined)
    return { text: 'Context Meter is shown above the prompt. Type /context-meter to hide it.' }
  })

  // After each main-chat turn, with the cost so far. The breakdown is then read with usage.
  on('session.measure', async ($, e, next) => {
    try {
      void applySwitches($)
        .then(() => refresh($, e.cost?.usd))
        .catch(() => undefined)
    } catch {
      // Watching only.
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    try {
      // A subagent's compaction and a precompute leave the main chat as it was.
      if (!e.agentId && e.trigger !== 'precompute') {
        void refresh($).catch(() => undefined)
        $.clock.after(COMPACT_WAIT_MS, () => {
          void refresh($).catch(() => undefined)
        })
      }
    } catch {
      // Watching only: the compaction stands whatever happens here.
    }
    return r
  })

  on('session.end', async ($, e, next) => {
    try {
      stopTimer()
      if (e.reason === 'clear') {
        S.breakdown = null
        S.lastSig = ''
        S.costUsd = null
        await update($, { plugin: 'context-meter', key: 'meter' } as const, () => null)
        // The new chat starts after this one ends: read it again when the end budget has passed.
        const gen = S.gen
        $.clock.after(CLEAR_WAIT_MS, () => {
          if (S.gen !== gen) return
          void (async () => {
            await applySwitches($)
            await refresh($)
            startTimer($)
          })().catch(() => undefined)
        })
      }
    } catch (err) {
      await log($, `session.end failed: ${errText(err)}`)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (S.off || S.hidden || S.switchHidden || e.props.hasSurvey) return next(e)
    let m: Meter | null = null
    try {
      if (typeof e.props.bodyColumns !== 'number') {
        await logOnce($, 'no-band', 'AbovePrompt gave no bodyColumns: Context Meter stays inert')
        return next(e)
      }
      m = await read($, { plugin: 'context-meter', key: 'meter' } as const)
    } catch (err) {
      await logOnce($, `read:${errText(err)}`, `meter read failed: ${errText(err)}`)
      return next(e)
    }
    if (!m) return next(e)
    const rest = await next(e)
    try {
      const ui = $.ui.resolve(e)
      const { Box } = ui
      return (
        <Box flexDirection="column">
          {rest}
          {band(ui, m, e.props.bodyColumns, e.props.maxRows)}
        </Box>
      )
    } catch (err) {
      await logOnce($, `render:${errText(err)}`, `render failed: ${errText(err)}`)
      return rest
    }
  })
}
