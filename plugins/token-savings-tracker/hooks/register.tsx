import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Row, Totals, View } from '../types'

import { ACCENT, BAD, compactAtom, GOOD, INFO, ledgerAtom, liveAtom, NAME, PANE, PER_M, SHOW_ROWS, TAIL_LINES, TITLE, viewAtom, WARN } from './constants.ts'
import { S } from './state.ts'
import { cacheOf, localDay, modelLabel, modName, priceOf, rowName } from './pure.ts'
import { clip, count, fmt, helperLine, money, partLines, timeLabel, todayLabel, usdWords } from './format.ts'
import { addCompaction, firstFire, log, onMeasure, openFile, readLive, readSwitch, setHidden, tilde, toggleDetail } from './io.ts'
import { refresh } from './refresh.ts'

// Token Savings Tracker reads ~/.claude/mods-logs/savings.jsonl, the ledger every
// token-saving mod appends to, and shows what they saved. It never writes it.

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE })
  await refresh($, true)
  await readLive($)
}

// The /mods switchboard asks for this pane by leaving an empty file for this chat.
async function checkOpen($: EngineInterface) {
  if (!S.sid) return
  const path = `${$.plugin.root.split('/.claude/')[0] ?? ''}/.claude/mods/.open-${NAME}-${S.sid}`
  try {
    if (!(await $.fs.exists(path))) return
    await $.process.run(['rm', '-f', path])
    if (!S.off) await openPane($)
  } catch (err) {
    await log($, `open request failed: ${String(err instanceof Error ? err.message : err)}`)
  }
}

async function poll($: EngineInterface) {
  await readSwitch($)
  await checkOpen($)
  if (!S.off) await refresh($, false)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    S.root = $.plugin.root.replace(/\/\.claude-plugin\/?$/, '')
    S.home = S.root.split('/.claude/')[0] ?? ''
    S.prevTokens = null
    S.lastSig = ''
    await $.command.register({ name: 'savings', description: 'Open Token Savings Tracker: tokens the mods saved today and in this chat', immediate: true })
    try {
      S.sid = await $.session.id()
    } catch {
      S.sid = ''
    }
    try {
      S.mainModel = await $.session.model()
    } catch {
      S.mainModel = ''
    }
    await poll($).catch(() => undefined)
    $.clock.every(3000, () => {
      void poll($).catch(() => undefined)
    })
    return next(e)
  })

  on('command.run', { command: 'savings' }, async ($, e) => {
    if (S.off) return { text: 'Token Savings Tracker is off. Turn it on with /mods.' }
    const arg = e.args.trim().toLowerCase()
    S.sample = arg === 'sample'
    if (S.hidden) await setHidden($, false)
    await openPane($)
    return {
      text: S.sample
        ? 'Opened Token Savings Tracker with the 5 sample lines. This is test data, not the real ledger. Type /savings to go back.'
        : 'Opened Token Savings Tracker.',
    }
  })

  on('session.measure', async ($, e, next) => {
    void firstFire($, 'session.measure').catch(() => undefined)
    if (!S.off) void onMeasure($, e.context, e.cost).catch(() => undefined)
    return next(e)
  })

  // Blocked on the desktop app by cc-plugin-sec-default (2026-11-02). Works where the engine lets it run.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    void firstFire($, 'session.compact').catch(() => undefined)
    try {
      if (!S.off && !e.agentId && e.trigger !== 'precompute' && r.skip === undefined && r.tokensBefore !== undefined && r.tokensAfter !== undefined) {
        const before = r.tokensBefore
        const after = r.tokensAfter
        void (async () => addCompaction($, { at: await $.clock.now(), before, after, source: 'compact' }))().catch(() => undefined)
      }
    } catch {
      // Watching only: the compaction stands whatever happens here.
    }
    return r
  })

  on('ui.press', { plugin: 'token-savings-tracker' }, async ($, e) => {
    const el = e.element
    if (el === 'hide') {
      await setHidden($, true)
      try {
        $.ui.toast('Token Savings Tracker hidden. Type /savings or open /mods to show it.')
      } catch {
        // The toast is only a hint.
      }
      return { element: el }
    }
    if (S.off) return { element: el }
    if (el === 'refresh') {
      await refresh($, true)
      await readLive($)
    } else if (el === 'real') {
      S.sample = false
      await refresh($, true)
    } else if (el === 'filter-chat' || el === 'filter-today' || el === 'filter-all') {
      const filter = el.slice('filter-'.length) as View['filter']
      await update($, viewAtom, x => ({ ...x, filter }))
    } else if (el.startsWith('row:')) {
      await toggleDetail($, el.slice(4))
    } else if (el.startsWith('file:')) {
      await openFile($, el.slice(5))
    }
    return { element: el }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    if (S.off) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Turned off. Open /mods to turn it on.</Text>
        </Box>
      )
    }
    const noop = () => undefined
    const width = Math.max(30, e.props.bodyColumns)
    const l = await read($, ledgerAtom)
    const live = await read($, liveAtom)
    const comps = await read($, compactAtom)
    const v = await read($, viewAtom)

    const stat = (key: string, label: string, t: Totals) => {
      const netText =
        // Nothing has a price only when the main model has none, no chat file gave one and no line brought its own dollars.
        l?.mainPrice === null && t.usdActions === 0 && t.actions > 0 && t.value === 0
          ? 'net: price unknown'
          : `~${money(t.value - t.helperUsd)} net after helpers${t.unpriced ? ` (${t.unpriced} not priced)` : ''}`
      return (
        <Box key={key} flexDirection="column" flexGrow={1} minWidth={24} borderStyle="round" borderColor={GOOD} paddingX={1}>
          <Text dimColor size="caption" weight="medium">
            {label}
          </Text>
          <Text bold color={GOOD} size="title" tabular>
            {fmt(t.saved)}
          </Text>
          <Text size="footnote">tokens saved</Text>
          {t.usdActions ? (
            <Text bold color={t.usdSaved >= 0 ? GOOD : BAD} tabular wrap="truncate-end">
              {`Model choice ${usdWords(t.usdSaved)}`}
            </Text>
          ) : null}
          <Text dimColor size="footnote" tabular wrap="truncate-end">
            {`${fmt(t.before)} to ${fmt(t.after)} · ${count(t.actions, 'action', 'actions')}`}
          </Text>
          <Text dimColor size="footnote" tabular wrap="truncate-end">
            {netText}
          </Text>
          {t.leftOut ? (
            <Text color={BAD} size="footnote" wrap="truncate-end">
              {`${count(t.leftOut, 'row', 'rows')} left out (not believable)`}
            </Text>
          ) : null}
          <Text size="footnote" wrap="truncate-end">
            <Text color={GOOD}>{`${t.real} real`}</Text>
            <Text dimColor> · </Text>
            <Text color={WARN}>{`${t.estimated} estimated`}</Text>
          </Text>
        </Box>
      )
    }

    const filterButton = (key: View['filter'], label: string) => (
      <Button key={`filter-${key}`} label={label} variant={v.filter === key ? 'primary' : 'secondary'} onPress={noop} />
    )

    const rows = (l?.rows ?? []).filter(r =>
      v.filter === 'all' ? true : v.filter === 'chat' ? r.session === l?.chatId : localDay(r.ms) === l?.day,
    )

    const rowView = (r: Row) => {
      const net = r.valueUsd === null ? null : r.valueUsd - (r.helperUsd ?? 0)
      const isOpen = v.open === r.key
      const badge = r.leftOut ? 'LEFT OUT' : r.measured === 'real' ? 'REAL' : 'ESTIMATED'
      const badgeColor = r.leftOut ? BAD : r.measured === 'real' ? GOOD : WARN
      const c = r.cache
      const reads = c ? Math.max(0, c.requests - 1) : 0
      const cacheText = !c
        ? ''
        : c.how === 'reading'
          ? 'Cache: 1 write for now (reading the chat)'
          : c.how === 'no-chat'
            ? `Cache: 1 write (${l?.sample ? 'sample lines have no chat file' : 'chat file not found'})`
            : reads === 0
              ? `Cache: 1 write (${c.requests ? '1 later request' : 'no later request yet'}, ${modelLabel(c.model)})`
              : `Cache: 1 write + ${count(reads, 'read', 'reads')} (${c.requests} later requests, ${modelLabel(c.model)})`
      return (
        <Box key={`r-${r.key}`} flexDirection="column" width={width} marginTop={1} paddingLeft={1} borderStyle="single" borderColor={badgeColor}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text bold color={ACCENT}>
                {rowName(r)}
              </Text>
              <Text dimColor>{`  ${timeLabel(r.ms, l?.day ?? '')}${l && r.session === l.chatId ? '  this chat' : ''}`}</Text>
            </Text>
            <Text bold color={badgeColor}>
              {badge}
            </Text>
          </Box>
          <Text wrap="truncate-end">{clip(r.action || '(no description)', width - 3)}</Text>
          {r.usd && r.usd.before !== null && r.usd.before === r.usd.after && r.usd.saved === 0 ? (
            <Text tabular wrap="truncate-end">{`${money(r.usd.before)} either way`}</Text>
          ) : r.usd ? (
            <Text tabular wrap="truncate-end">
              <Text>{r.usd.before !== null && r.usd.after !== null ? `${money(r.usd.before)} to ${money(r.usd.after)} · ` : 'Model price · '}</Text>
              <Text bold color={r.usd.saved >= 0 ? GOOD : BAD}>{usdWords(r.usd.saved)}</Text>
            </Text>
          ) : null}
          {r.usd && r.saved === 0 ? (
            <Text dimColor size="footnote" tabular wrap="truncate-end">{`${fmt(r.before)} tokens either way`}</Text>
          ) : (
            <Text tabular wrap="truncate-end">
              <Text>{`${fmt(r.before)} to ${fmt(r.after)} ${r.tokenKind === 'output' ? 'output tokens' : 'tokens'} · `}</Text>
              <Text bold color={r.saved >= 0 ? GOOD : BAD}>{`saved ${fmt(r.saved)}`}</Text>
            </Text>
          )}
          {r.leftOut ? (
            <Text color={BAD} size="footnote">
              {`Left out of the totals: ${r.leftOut}. Likely a counting bug in ${modName(r.mod)}.`}
            </Text>
          ) : null}
          {cacheText ? (
            <Text dimColor size="footnote" tabular wrap="truncate-end">
              {clip(cacheText, width - 3)}
            </Text>
          ) : null}
          {r.extra ? (
            <Text dimColor size="footnote" wrap="truncate-end">
              {clip(r.extra, width - 3)}
            </Text>
          ) : null}
          <Text dimColor size="footnote" tabular wrap="truncate-end">
            {clip(helperLine(r), width - 3)}
          </Text>
          <Box flexDirection="row" justifyContent="space-between">
            <Text size="footnote" tabular color={net === null || r.leftOut || r.helperPriced === 'unknown' ? undefined : net >= 0 ? GOOD : BAD} dimColor={net === null || !!r.leftOut || r.helperPriced === 'unknown'}>
              {r.leftOut
                ? 'Net: not counted'
                : net === null
                  ? 'Net: price unknown'
                  : r.helperPriced === 'unknown'
                    ? `Net: before helper ~${money(net)}`
                    : `Net ~${money(net)}`}
            </Text>
            <Button key={`row:${r.key}`} label={isOpen ? 'Close detail' : r.detail ? 'Detail' : 'No detail'} dimColor onPress={noop} />
          </Box>
          {isOpen ? (
            <Box flexDirection="column" marginTop={1}>
              {v.detailError ? <Text color={BAD}>{v.detailError}</Text> : <Markdown text={v.detail || '(empty file)'} />}
              {v.detailError ? null : (
                <Box flexDirection="row">
                  <Button key={`file:${r.key}`} label="Open file" variant="secondary" onPress={noop} />
                  <Text dimColor wrap="truncate-end">{`  ${clip(r.detail, width - 16)}`}</Text>
                </Box>
              )}
            </Box>
          ) : null}
        </Box>
      )
    }

    const emptyText =
      v.filter === 'chat' ? 'No savings in this chat yet.' : v.filter === 'today' ? 'No savings logged today yet.' : 'No savings logged yet.'

    return (
      <Box flexDirection="column" width={width}>
        {l?.sample ? (
          <Box flexDirection="row" justifyContent="space-between" borderStyle="round" borderColor={WARN} paddingX={1}>
            <Text bold color={WARN}>
              SAMPLE DATA, not the real ledger
            </Text>
            <Button key="real" label="Show real ledger" variant="secondary" onPress={noop} />
          </Box>
        ) : null}

        {!l ? <Text dimColor>Reading the savings ledger…</Text> : null}
        {l?.error ? (
          <Box flexDirection="column">
            <Text bold color={BAD}>
              The ledger did not load
            </Text>
            <Text color={BAD} wrap="wrap">
              {l.error}
            </Text>
          </Box>
        ) : null}

        {l && !l.error ? (
          <Box flexDirection={width >= 56 ? 'row' : 'column'} gap={1}>
            {stat('stat-today', `${todayLabel(l.today.chats)}${l.sample ? ' (sample day)' : ''}`, l.today)}
            {stat('stat-chat', `THIS CHAT${l.sample ? ' (sample chat)' : ''}`, l.chat)}
          </Box>
        ) : null}

        <Box flexDirection="column" marginTop={1}>
          <Text size="footnote" wrap="truncate-end">
            <Text bold color={INFO}>
              Real now
            </Text>
            <Text dimColor> (from Claude): </Text>
            <Text tabular>
              {live
                ? `context ${live.tokens === null ? 'not measured yet' : fmt(live.tokens)} of ${fmt(live.window)}${live.percent === null ? '' : ` (${live.percent}%)`}${live.usd === null ? '' : ` · this chat cost ${money(live.usd)}`}`
                : 'waiting for the first measure'}
            </Text>
          </Text>
          {comps.slice(-3).map((c, i) => (
            <Text key={`c${i}`} size="footnote" tabular wrap="truncate-end">
              <Text color={INFO}>{`${c.source === 'compact' ? 'Compaction' : 'Context drop'} ${timeLabel(c.at, l?.day ?? localDay(c.at))}: `}</Text>
              <Text>{`${fmt(c.before)} to ${fmt(c.after)} tokens`}</Text>
              <Text dimColor>{c.source === 'compact' ? ' (real, from the engine)' : ' (real; a compaction, /clear or /rewind)'}</Text>
            </Text>
          ))}
          {comps.length ? (
            <Text dimColor size="footnote">
              Shown apart. Not in the totals above.
            </Text>
          ) : null}
        </Box>

        {partLines(rows).map(line => (
          <Text key={`part-${line}`} size="footnote" tabular wrap="wrap">
            {line}
          </Text>
        ))}

        <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          {filterButton('chat', 'This chat')}
          {filterButton('today', 'Today (all chats)')}
          {filterButton('all', 'All')}
          <Button key="refresh" label="Refresh" dimColor onPress={noop} />
          <Button key="hide" label="Hide" dimColor onPress={noop} />
        </Box>
        {v.note ? (
          <Text color={GOOD} size="footnote" wrap="truncate-end">
            {clip(v.note, width)}
          </Text>
        ) : null}

        {l?.missing ? (
          <Box flexDirection="column" marginTop={1}>
            <Text>No savings logged yet.</Text>
            <Text dimColor wrap="wrap">
              Each token-saving mod adds one line to ~/.claude/mods-logs/savings.jsonl when it saves tokens. Rows show up here within 3 seconds.
            </Text>
          </Box>
        ) : null}
        {l && !l.missing && !l.error && rows.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor>{emptyText}</Text>
          </Box>
        ) : null}
        {rows.slice(0, SHOW_ROWS).map(rowView)}
        {rows.length > SHOW_ROWS ? <Text dimColor>{`Showing the newest ${SHOW_ROWS} of ${rows.length}.`}</Text> : null}

        {l && !l.error ? (
          <Box flexDirection="column" marginTop={1}>
            {l.dropped || l.skipped ? (
              <Text dimColor size="footnote" wrap="wrap">
                {[l.dropped ? `${count(l.dropped, 'double count', 'double counts')} dropped (same tool call)` : '', l.skipped ? `${count(l.skipped, 'bad line', 'bad lines')} skipped` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
            <Text dimColor size="footnote" wrap="wrap">
              {`Reading ${tilde(l.path)}${l.partial ? ` (newest ${fmt(TAIL_LINES)} lines)` : ''}. All time: ${fmt(l.all.saved)} tokens saved in ${count(l.all.actions, 'action', 'actions')}.${l.all.usdActions ? ` Model choice ${usdWords(l.all.usdSaved)}.` : ''}`}
            </Text>
            <Text dimColor size="footnote" wrap="wrap">
              {l.mainPrice === null
                ? `Token dollars need the main model's price. ${l.mainModel ? modelLabel(l.mainModel) : 'This model'} has none here. Model choice uses each mod's own dollar figure.`
                : `~$ uses list prices. A saved input token is 1 cache write (2x input: $${((cacheOf(l.mainModel)?.write ?? 0) / PER_M).toFixed(2)} per million on ${modelLabel(l.mainModel)}) plus 1 cache read ($${((cacheOf(l.mainModel)?.read ?? 0) / PER_M).toFixed(2)} per million) for each later request in its chat, until a compaction. A saved output token is $${((priceOf(l.mainModel, 0)?.out ?? 0) / PER_M).toFixed(2)} per million. Helpers are at their own price. Model choice uses each mod's own dollar figure.`}
            </Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
