import type { EngineInterface, Register } from 'claude-code'

import type { Audit, Item } from '../types'

import { collect } from './collect.ts'
import type { BreakdownLike } from './collect.ts'
import { ACCENT, DUP_MIN_TOKENS, FLAG_TOKENS, MAX_FLAGS, PANE, SHOW_PATHS, TITLE, TOP_AGENTS, TOP_MEMORY, TOP_SKILLS, WARN } from './constants.ts'
import { flagsOf } from './flags.ts'
import { fmt, plural } from './format.ts'
import { homeOfRoot } from './guards.ts'
import { getAudit, log, msg, setAudit } from './io.ts'
import { S } from './state.ts'
import { readSwitches } from './switches.ts'

// Context Bloat Auditor lists what the engine says the always-loaded items cost.
// It reads numbers only. It never lists, edits or deletes a file. The two files it touches are the /mods switch file (read) and its own error log (write).

async function readSwitch($: EngineInterface) {
  const s = await readSwitches($)
  if (!s) return
  S.off = s.off
  if (s.hidden && !S.hidden) await $.ui.close({ id: PANE }).catch(() => undefined)
  S.hidden = s.hidden
}

// A refresh stuck longer than this no longer blocks the next one.
const STUCK_MS = 30000

const blank = (at: number, supported: boolean, failed: boolean): Audit => ({
  supported,
  failed,
  memory: [],
  skills: [],
  agents: [],
  flags: [],
  moreFlags: 0,
  totals: { memory: 0, memoryCount: 0, skills: 0, skillCount: 0, commands: 0, commandCount: 0, agents: 0, agentCount: 0 },
  hasSkills: false,
  hasCommands: false,
  at,
})

async function refresh($: EngineInterface) {
  if (S.off) return
  const started = Date.now()
  if (S.busySince !== 0 && started - S.busySince < STUCK_MS) return
  S.busySince = started
  const epoch = S.epoch
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const b = u.context.breakdown as BreakdownLike | undefined
    let next: Audit
    if (!b) {
      next = blank(await $.clock.now(), false, false)
    } else {
      const c = collect(b, S.home, SHOW_PATHS)
      const all = flagsOf(c.memory, c.skills, c.agents, { flagTokens: FLAG_TOKENS, dupMinTokens: DUP_MIN_TOKENS })
      next = {
        supported: true,
        failed: false,
        memory: c.memory.slice(0, TOP_MEMORY),
        skills: c.skills.slice(0, TOP_SKILLS),
        agents: c.agents.slice(0, TOP_AGENTS),
        flags: all.slice(0, MAX_FLAGS),
        moreFlags: Math.max(0, all.length - MAX_FLAGS),
        totals: c.totals,
        hasSkills: c.hasSkills,
        hasCommands: c.hasCommands,
        at: await $.clock.now(),
      }
      S.items = c.memory.length + c.skills.length + c.agents.length
      S.flags = all.length
      S.at = next.at
    }
    // The session ended while this ran: do not write old items into the cleared pane.
    if (epoch === S.epoch) await setAudit($, next)
  } catch (err) {
    await log($, `refresh failed: ${msg(err)}`)
    if (epoch === S.epoch) await setAudit($, blank(Date.now(), true, true)).catch(() => undefined)
  } finally {
    // Only the refresh that still owns the busy mark clears it.
    if (S.busySince === started) S.busySince = 0
  }
}

async function clear($: EngineInterface) {
  S.epoch += 1
  S.busySince = 0
  S.items = 0
  S.flags = 0
  await setAudit($, null).catch(() => undefined)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE })
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      S.root = String($.plugin.root ?? '').replace(/\/\.claude-plugin\/?$/, '')
      S.home = homeOfRoot(S.root)
      await $.command.register({ name: 'context-audit', description: 'Open Context Bloat Auditor: which always-loaded items cost the most tokens', immediate: true })
      try {
        S.sid = await $.session.id()
      } catch {
        S.sid = ''
      }
      await readSwitch($)
      void refresh($).catch(() => undefined)
    } catch (err) {
      await log($, `session.start failed: ${msg(err)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'context-audit' }, async ($, e) => {
    try {
      await readSwitch($)
      if (S.off) return { text: 'Context Bloat Auditor is off. Turn it on with /mods.' }
      if (S.hidden) return { text: 'Context Bloat Auditor is hidden. Show it from /mods.' }
      await openPane($)
      return { text: 'Opened Context Bloat Auditor. These are measurements. Nothing was changed.' }
    } catch (err) {
      await log($, `command failed: ${msg(err)}`)
      return { text: 'Could not open Context Bloat Auditor. See ~/.claude/mods-logs/context-bloat-auditor.log.' }
    }
  })

  on('session.measure', async ($, e, next) => {
    try {
      if (!S.off) void refresh($).catch(() => undefined)
    } catch (err) {
      await log($, `session.measure failed: ${msg(err)}`)
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    try {
      if (!S.off && !e.agentId && e.trigger !== 'precompute') void refresh($).catch(() => undefined)
    } catch (err) {
      await log($, `session.compact failed: ${msg(err)}`)
    }
    return r
  }).catch(async ($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    try {
      await clear($)
    } catch (err) {
      await log($, `session.end failed: ${msg(err)}`)
    }
    return next(e)
  })

  on('ui.press', { plugin: 'context-bloat-auditor' }, async ($, e) => {
    try {
      if (e.element === 'refresh' && !S.off) await refresh($)
    } catch (err) {
      await log($, `press failed: ${msg(err)}`)
    }
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: 'context-bloat-auditor' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (S.off) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Turned off. Open /mods to turn it on.</Text>
        </Box>
      )
    }
    let a: Audit | null = null
    let failed = false
    try {
      a = await getAudit($)
    } catch (err) {
      failed = true
      await log($, `render failed: ${msg(err)}`)
    }
    if (failed || a?.failed) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Could not read the context items. See ~/.claude/mods-logs/context-bloat-auditor.log.</Text>
        </Box>
      )
    }
    if (!a) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Reading the context items.</Text>
        </Box>
      )
    }
    if (!a.supported) {
      return (
        <Box flexDirection="column">
          <Text dimColor>This Claude version does not report context items.</Text>
        </Box>
      )
    }
    const noop = () => undefined
    const width = Math.max(30, Number.isFinite(e.props.bodyColumns) ? e.props.bodyColumns : 80)
    // Every label below was cleaned in collect.ts. A credential-like path was already replaced by a fixed text there.
    const rows = (title: string, total: string, items: Item[], empty: string) => (
      <Box key={title} flexDirection="column" marginTop={1}>
        <Text bold color={ACCENT} wrap="truncate-end">{`${title}  ${total}`}</Text>
        {items.length === 0 ? <Text dimColor>{empty}</Text> : null}
        {items.map((it, i) => (
          <Text key={`${title}-${i}`} wrap="truncate-end">
            <Text>{`${fmt(it.tokens)}  `}</Text>
            <Text>{it.label}</Text>
            {it.source ? <Text dimColor>{`  (${it.source})`}</Text> : null}
          </Text>
        ))}
      </Box>
    )
    const t = a.totals
    return (
      <Box flexDirection="column" width={width}>
        <Text dimColor wrap="wrap">These are measurements. Nothing was changed. Trim by hand if you agree. Counts are the engine's estimates.</Text>
        {rows('Memory files', `${plural(t.memoryCount, 'file', 'files')}, ${fmt(t.memory)} tokens`, a.memory, 'No memory files reported.')}
        {a.hasSkills
          ? rows('Skills', `${plural(t.skillCount, 'skill', 'skills')}, ${fmt(t.skills)} tokens (top ${TOP_SKILLS})`, a.skills, 'No skills reported.')
          : null}
        {a.hasCommands ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={ACCENT}>Slash commands</Text>
            <Text>{`${plural(t.commandCount, 'command', 'commands')}, ${fmt(t.commands)} tokens (total only)`}</Text>
          </Box>
        ) : null}
        {rows('Agents', `${plural(t.agentCount, 'agent', 'agents')}, ${fmt(t.agents)} tokens`, a.agents, 'No agents reported.')}
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={WARN}>Flags</Text>
          {a.flags.length === 0 ? <Text dimColor>Nothing to flag.</Text> : null}
          {a.flags.map((f, i) => (
            <Text key={`flag-${i}`} wrap="wrap">
              <Text bold>{f.label}</Text>
              <Text dimColor>{`  ${f.text}`}</Text>
            </Text>
          ))}
          {a.moreFlags > 0 ? <Text dimColor>{`${fmt(a.moreFlags)} more not shown.`}</Text> : null}
        </Box>
        <Box marginTop={1}>
          <Button key="refresh" label="Refresh" onPress={noop} />
        </Box>
      </Box>
    )
  })
}
