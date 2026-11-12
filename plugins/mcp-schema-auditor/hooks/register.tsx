import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Rows } from '../types'

import { ACCENT, BAD, BAR_WIDTH, BUSY_MS, COMMAND, EMPTY_ROWS, MAX_ROWS, MAX_SUGGEST, NOTE, PANE, SUGGEST_PCT, SUGGEST_TOKENS, TITLE, WARN } from './constants.ts'
import { bar, fmtPct, fmtTokens } from './format.ts'
import { clampTokens, cleanName, pct } from './guards.ts'
import { groupByServer } from './group.ts'
import { log, msg } from './io.ts'
import { S } from './state.ts'
import { suggest, suggestionText } from './suggest.ts'
import { readSwitch } from './switches.ts'

// MCP Schema Auditor reads the engine's usage breakdown, groups the MCP tool schemas by server
// and shows what each server costs per request. It suggests; it never changes any config.

const rowsAtom = atom({ plugin: 'mcp-schema-auditor', key: 'rows' } as const, EMPTY_ROWS, { shape: 'mcp-rows-2' })

function init($: EngineInterface) {
  const root = String($.plugin.root)
  S.root = root.replace(/\/\.claude-plugin\/?$/, '')
  // Files are read and written only when the plugin sits under /<home>/.claude/. Any other root (a checkout,
  // --plugin-dir, a Windows path, a path with "..") leaves home empty and the mod touches no file.
  const at = root.indexOf('/.claude/')
  S.home = root.startsWith('/') && at > 0 && !root.includes('\\') && !root.split('/').includes('..') ? root.slice(0, at) : ''
}

async function setRows($: EngineInterface, rows: Rows, force: boolean) {
  const sig = `${rows.status}|${rows.window}|${rows.moreServers}:${rows.moreLoaded}:${rows.moreDeferred}|${rows.servers.map(r => `${r.server}:${r.loaded}:${r.deferred}:${r.count}`).join(',')}`
  if (!force && sig === S.lastSig) return
  S.lastSig = sig
  S.status = rows.status
  S.rows = rows.servers
  S.totalMcp = rows.totalLoaded
  S.window = rows.window
  S.at = rows.at
  await update($, rowsAtom, () => rows)
}

// One refresh at a time; an event that arrives while one runs is dropped, the next event redraws.
// A refresh that holds the lock for BUSY_MS (a usage call that never settles) is retired by the next one.
async function refresh($: EngineInterface, force: boolean) {
  if (S.busy) {
    const t = await $.clock.now().catch(() => 0)
    if (S.busyAt < 0 || t - S.busyAt < BUSY_MS) return
  }
  S.busy = true
  S.busyAt = -1
  const gen = ++S.gen
  try {
    if (!S.home) init($)
    S.busyAt = await $.clock.now()
    await readSwitch($)
    if (S.hidden) await $.ui.close({ id: PANE }).catch(() => undefined)
    if (S.off) return
    const u = await $.session.usage({ breakdown: 'summary' })
    if (gen !== S.gen) return
    const b = u?.context?.breakdown
    const at = await $.clock.now()
    if (!b || !Array.isArray(b.mcpTools)) {
      await setRows($, { ...EMPTY_ROWS, status: 'unsupported', at }, force)
      return
    }
    const all = groupByServer(b.mcpTools)
    const window = clampTokens(b.rawMaxTokens)
    const rest = all.slice(MAX_ROWS)
    const sum = (k: 'loaded' | 'deferred', rs: typeof all) => rs.reduce((n, r) => n + r[k], 0)
    const suggestions = suggest(all, window, SUGGEST_PCT, SUGGEST_TOKENS).slice(0, MAX_SUGGEST)
    const status = all.length ? 'ok' : 'empty'
    const rows: Rows = { status, servers: all.slice(0, MAX_ROWS), suggestions, totalLoaded: sum('loaded', all), totalDeferred: sum('deferred', all), moreServers: rest.length, moreLoaded: sum('loaded', rest), moreDeferred: sum('deferred', rest), window, at }
    await setRows($, rows, force)
  } catch (err) {
    await log($, `refresh failed: ${msg(err)}`)
    // A failed read shows "unsupported" unless the pane already has rows from an earlier read.
    if (S.status !== 'ok' && S.status !== 'empty') {
      try {
        await setRows($, { ...EMPTY_ROWS, status: 'unsupported', at: 0 }, true)
      } catch {
        // The pane keeps its last state.
      }
    }
  } finally {
    if (gen === S.gen) S.busy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      init($)
      S.lastSig = ''
      await $.command.register({ name: COMMAND, description: 'Show what each MCP server costs in tool definitions per request', immediate: true })
      try {
        S.sid = await $.session.id()
      } catch {
        S.sid = ''
      }
      void refresh($, true).catch(() => undefined)
    } catch (err) {
      await log($, `session.start failed: ${msg(err)}`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async $ => {
    try {
      if (!S.home) init($)
      await readSwitch($)
      if (S.off) return { text: 'MCP Schema Auditor is off. Turn it on with /mods.' }
      if (S.hidden) return { text: 'MCP Schema Auditor is hidden. Show it from /mods.' }
      await $.ui.open({ id: PANE, title: TITLE })
      await refresh($, true)
      return { text: 'Opened MCP Schema Auditor.' }
    } catch (err) {
      await log($, `${COMMAND} failed: ${msg(err)}`)
      return { text: 'MCP Schema Auditor could not open. See ~/.claude/mods-logs/mcp-schema-auditor.log.' }
    }
  }).catch(($, e, next) => next(e))

  // session.measure fires after each main-chat turn; the breakdown is asked for, not pushed.
  on('session.measure', async ($, e, next) => {
    void refresh($, false).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') void refresh($, false).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    try {
      if (e.reason === 'clear') {
        S.lastSig = ''
        S.status = 'waiting'
        await update($, rowsAtom, () => EMPTY_ROWS)
      }
    } catch (err) {
      await log($, `session.end failed: ${msg(err)}`)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    try {
      if (S.off) {
        return (
          <Box flexDirection="column">
            <Text dimColor>Turned off. Open /mods to turn it on.</Text>
          </Box>
        )
      }
      const width = Math.max(30, Number(e.props.bodyColumns) || 80)
      const rows = await read($, rowsAtom)
      const top = Math.max(1, ...rows.servers.map(r => r.loaded))
      const flagged = new Set(rows.suggestions.map(s => s.server))
      return (
        <Box flexDirection="column" width={width}>
          <Text bold color={ACCENT}>
            MCP tool definitions, estimated
          </Text>
          {rows.status === 'waiting' ? <Text dimColor>Reading tool sizes…</Text> : null}
          {rows.status === 'unsupported' ? <Text dimColor>This Claude version does not report MCP tool sizes</Text> : null}
          {rows.status === 'empty' ? <Text dimColor>No MCP tools loaded.</Text> : null}
          {rows.status === 'ok' ? (
            <Box flexDirection="column">
              <Text tabular wrap="truncate-end">
                {`${fmtTokens(rows.totalLoaded)} tokens in every request${rows.window ? ` (${fmtPct(pct(rows.totalLoaded, rows.window))} of the ${fmtTokens(rows.window)} window)` : ''}`}
              </Text>
              <Text dimColor tabular wrap="truncate-end">
                {`${fmtTokens(rows.totalDeferred)} more tokens are deferred, outside the window until searched for`}
              </Text>
              {rows.servers.map(r => (
                <Text key={`s-${cleanName(r.server)}`} tabular wrap="truncate-end">
                  <Text bold color={flagged.has(r.server) ? WARN : ACCENT}>{cleanName(r.server)}</Text>
                  <Text>{`  ${fmtTokens(r.loaded)} `}</Text>
                  <Text color={flagged.has(r.server) ? WARN : ACCENT}>{bar(r.loaded / top, BAR_WIDTH)}</Text>
                  <Text dimColor>{`  ${fmtTokens(r.deferred)} deferred · ${r.count} ${r.count === 1 ? 'tool' : 'tools'}`}</Text>
                </Text>
              ))}
              {rows.moreServers ? (
                <Text dimColor tabular wrap="truncate-end">
                  {`+${rows.moreServers} more ${rows.moreServers === 1 ? 'server' : 'servers'}, ${fmtTokens(rows.moreLoaded)} tokens loaded, ${fmtTokens(rows.moreDeferred)} deferred`}
                </Text>
              ) : null}
              {rows.suggestions.length ? (
                <Box flexDirection="column" marginTop={1}>
                  {rows.suggestions.map(s => (
                    <Text key={`g-${cleanName(s.server)}`} color={WARN} wrap="wrap">
                      {suggestionText(cleanName(s.server))}
                    </Text>
                  ))}
                </Box>
              ) : null}
            </Box>
          ) : null}
          <Box marginTop={1}>
            <Text dimColor size="footnote" wrap="wrap">
              {NOTE}
            </Text>
          </Box>
        </Box>
      )
    } catch (err) {
      await log($, `render failed: ${msg(err)}`)
      return (
        <Box flexDirection="column">
          <Text color={BAD}>MCP Schema Auditor could not draw. See ~/.claude/mods-logs/mcp-schema-auditor.log.</Text>
        </Box>
      )
    }
  }).catch(($, e, next) => next(e))
}
