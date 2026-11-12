import type { EngineInterface, Register } from 'claude-code'
import { S, agentChars, agentSteps, answers, owned, waiters } from './state.ts'
import { ACCENT, BAD, COMMAND, GOOD, MODEL, NAME, OFF_TEXT, PANE, TITLE, USAGE_TEXT } from './constants.ts'
import { exists, log } from './io.ts'
import { closePane, openPane } from './ui.ts'
import { atom, read, update } from 'claude-code'
import { refreshTools, resultText } from './tools.ts'
import { startRun } from './research.ts'
import { shorten } from './auto.ts'
import type { CallResult, Done } from './shapes.ts'
import { commas, money, remember, tally } from './text.ts'
import { explorerSvg } from './mascot.ts'
import type { AutoView, FoundView, RunView } from '../types'

const runsAtom = atom({ plugin: 'web-research-saver', key: 'runs' } as const, [] as RunView[], { shape: 'runs-2' })
const autoAtom = atom({ plugin: 'web-research-saver', key: 'auto' } as const, [] as AutoView[], { shape: 'auto-1' })
const foundAtom = atom({ plugin: 'web-research-saver', key: 'found' } as const, null as FoundView | null, { shape: 'found-1' })
const offAtom = atom({ plugin: 'web-research-saver', key: 'off' } as const, false)
const routerAtom = atom({ plugin: 'web-research-saver', key: 'router' } as const, false)
const busyAtom = atom({ plugin: 'web-research-saver', key: 'busy' } as const, 0)
const openAtom = atom({ plugin: 'web-research-saver', key: 'open' } as const, [] as number[], { shape: 'open-1' })

// The /mods switchboard turns this mod off in every chat with switches.json; Subagent Model Router's switch is read too.
async function readSwitch($: EngineInterface) {
  let now = S.off
  let routed = S.router
  let nowHidden = S.switchHidden
  try {
    const mods = `${$.plugin.root.split('/.claude/')[0] ?? ''}/.claude/mods`
    let json: Record<string, unknown> = {}
    if (await $.fs.exists(`${mods}/switches.json`)) json = JSON.parse(String(await $.fs.read(`${mods}/switches.json`))) as Record<string, unknown>
    now = json[NAME] === false
    nowHidden = json[`${NAME}:hidden`] === true
    // Subagent Model Router's manifest is a file; the folder alone is the second check.
    const installed = (await exists($, `${mods}/subagent-model-router/.claude-plugin/plugin.json`)) || (await exists($, `${mods}/subagent-model-router`))
    routed = installed && json['subagent-model-router'] !== false
    S.switchError = ''
  } catch (err) {
    // A broken file changes nothing. Logged once, not every 3 seconds.
    const said = err instanceof Error ? err.message : String(err)
    if (said !== S.switchError) await log($, 'switches', `switches.json not read, nothing changed: ${said}`)
    S.switchError = said
  }
  if (nowHidden !== S.switchHidden) {
    S.switchHidden = nowHidden
    if (nowHidden) await closePane($)
  }
  if (now !== S.off) {
    S.off = now
    await update($, offAtom, () => now)
    if (now) await closePane($)
  }
  if (routed !== S.router || !S.routerKnown) {
    S.routerKnown = true
    S.router = routed
    await update($, routerAtom, () => routed)
  }
}

// Open in /mods writes an empty file named for this mod and this chat: open the pane, remove the file.
async function checkOpen($: EngineInterface) {
  if (!S.session || !S.home) return
  const path = `${S.home}/.claude/mods/.open-${NAME}-${S.session}`
  if (!(await exists($, path))) return
  await $.process.run(['/bin/rm', '-f', path], { timeoutMs: 10_000 })
  if (!S.off) await openPane($, true)
}

function noop() {}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    S.home = $.plugin.root.split('/.claude/')[0] ?? ''
    S.session = await $.session.id().catch(() => '')
    await $.command.register({
      name: COMMAND,
      description: 'Web Research Saver: a cheap worker runs the web research and gives Claude a short brief with sources. Put deep first for subagents. "pane" opens the pane.',
      argumentHint: '[deep] <question> | pane',
      immediate: true,
    })
    await readSwitch($).catch(err => log($, 'switches', err))
    $.clock.every(3000, () => {
      void readSwitch($)
        .then(() => checkOpen($))
        .catch(err => log($, 'switches', err))
    })
    $.clock.after(0, () => {
      void refreshTools($).catch(err => log($, 'tools', err))
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (S.off) return { text: OFF_TEXT }
    const raw = (e.args ?? '').trim()
    if (/^pane$/i.test(raw)) {
      await openPane($, true)
      const runs = (await read($, runsAtom)) ?? []
      const autos = (await read($, autoAtom)) ?? []
      const short = autos.filter(a => a.status === 'shortened').length
      return { text: `${TITLE} pane open. This chat: ${runs.length} research run${runs.length === 1 ? '' : 's'}, ${short} of ${autos.length} searches shortened.` }
    }
    const forceDeep = /^deep\b/i.test(raw)
    const question = raw.replace(/^deep\b[\s:,-]*/i, '').trim()
    if (!question) {
      await openPane($, true)
      return { text: USAGE_TEXT }
    }
    const reply = forceDeep
      ? `${TITLE} is on it, in deep mode. ${MODEL} splits the question, and 2 to 4 subagents research the parts. A short brief with sources comes back here as a new message. Do not research this yourself meanwhile.`
      : `${TITLE} is on it. A cheap worker (${MODEL}) plans the research, searches the web and reads the pages. A short brief with sources comes back here as a new message. Do not research this yourself meanwhile.`
    await startRun($, question, reply.length, forceDeep)
    return { text: reply }
  })

  // Auto mode. Only the main chat's own searches: the mod's own calls (origin is this plugin) and
  // every subagent's (agentId set, the deep-mode ones too) pass through, so nothing loops.
  on('tool.call', { tool: 'WebSearch' }, async ($, e, next) => {
    if (S.off || next.origin.plugin !== 'engine' || e.agentId) return next(e)
    const r = await next(e)
    try {
      const short = await shorten($, String(e.query ?? ''), e.tool_use_id, r as CallResult)
      return short ? (short as typeof r) : r
    } catch (err) {
      void log($, 'auto', err)
      return r
    }
  })

  // Deep mode counts what each subagent's tools handed it: the search results and pages it read.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const id = (e as { agentId?: string }).agentId
    if (id) remember(agentChars, id, (agentChars.get(id) ?? 0) + resultText(r as unknown as CallResult).length)
    return r
  })

  // Deep mode prices each subagent request by its own size, as Subagent Model Router does.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId && result.usage) remember(agentSteps, e.agentId, [...(agentSteps.get(e.agentId) ?? []), result.usage])
    return result
  })

  // A deep-mode subagent's answer is its turn.complete.
  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const done: Done = { answer: e.answer ?? '', reason: e.reason, model: e.usage?.model, ...(e.usage ? { usage: e.usage } : {}) }
      const w = waiters.get(id)
      if (w) w(done)
      else if (!answers.has(id)) {
        answers.set(id, done)
        // Only a few fast answers wait here; old ones nobody claimed go.
        for (const k of [...answers.keys()].slice(0, Math.max(0, answers.size - 16))) answers.delete(k)
      }
    }
    return next(e)
  })

  // Keep a finished subagent's report out of the main chat: it goes into the brief instead.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification' && owned.size) {
      const hit = [...owned].find(id => e.text.includes(id))
      if (hit) {
        void log($, 'notification', `dropped the task notification of subagent ${hit}`)
        return { drop: `${TITLE}: a research subagent finished. Its report goes into the brief.` }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') S.closed = true
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.press', { plugin: NAME }, async ($, e) => {
    const x = /^expand-(\d+)$/.exec(e.element)
    if (x) {
      const id = Number(x[1])
      await update($, openAtom, l => ((l ?? []).includes(id) ? (l ?? []).filter(v => v !== id) : [...(l ?? []), id]))
      return { element: e.element }
    }
    const m = /^open-(\d+)$/.exec(e.element)
    if (m) {
      const run = ((await read($, runsAtom)) ?? []).find(r => r.id === Number(m[1]))
      if (run?.notes) await $.process.run(['/usr/bin/open', run.notes], { timeoutMs: 10_000 }).catch(err => log($, 'open', err))
    }
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Link, Button } = els
    if (await read($, offAtom)) return <Text dimColor>Turned off. Open /mods to turn it on.</Text>
    // Svg draws on desktop, the editor and mobile; the terminal gets a glyph.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const width = Math.max(24, e.props.bodyColumns)
    const runs = (await read($, runsAtom)) ?? []
    const autos = (await read($, autoAtom)) ?? []
    const found = await read($, foundAtom)
    const routed = await read($, routerAtom)
    // A spawn that came back on a picked model proves a hook picked it then. Only the newest deep run counts,
    // so the line follows the switch again once a later run has no picked model.
    const newestDeep = runs.find(r => r.mode === 'deep')
    const pickedLast = Boolean(newestDeep?.agents.some(a => a.picked))
    const routerSeen = Boolean(routed) || pickedLast
    const lastDeep = runs.find(r => r.mode === 'deep' && r.agents.some(a => a.status === 'done'))
    const lastModels = lastDeep ? tally(lastDeep.agents.filter(a => a.status === 'done').map(a => a.model)) : []
    const open = (await read($, openAtom)) ?? []
    const shortening = ((await read($, busyAtom)) ?? 0) > 0
    const live = runs.find(r => r.status === 'working')
    const busy = Boolean(live) || shortening
    const cw = width - 4
    const tools = found
      ? `Tools: WebSearch, page reads${found.firecrawl ? ', firecrawl CLI as fallback' : ''}${found.connectors.length ? `, ${found.connectors.join(', ')}` : ''}`
      : 'Looking for research tools...'

    const mascot = Svg ? (
      <Box key="mascot" width={12} flexShrink={0}>
        <Svg source={explorerSvg(busy)} alt="Claude explorer with a helmet and a magnifying glass" width={66} height={48} />
      </Box>
    ) : (
      <Box key="mascot" width={6} flexShrink={0}>
        <Text color={ACCENT}>{busy ? '▟█▙⌕' : '▟█▙ '}</Text>
      </Box>
    )
    const doing = live ? `Researching: ${live.step}` : shortening ? 'Haiku is shortening a search…' : TITLE

    const card = (r: RunView) => {
      const models = tally(r.agents.filter(a => a.status === 'done').map(a => a.model))
      const spent =
        r.agentCost !== undefined ? `Cost: ${money(r.cost ?? 0)} (Haiku ${money((r.cost ?? 0) - r.agentCost)}, subagents ${money(r.agentCost)}).` : `Haiku: ${money(r.cost ?? 0)}.`
      const saved =
        r.before !== undefined && r.after !== undefined
          ? `Kept out of the chat: about ${commas(Math.max(0, r.before - r.after))} tokens. ${spent} Time: ${r.secs ?? 0} s.${models.length ? ` Subagents on ${models.join(', ')}.` : ''}`
          : ''
      const working = r.status === 'working'
      const isOpen = open.includes(r.id)
      const more = Boolean(r.brief || r.reports?.length)
      return (
        <Box
          key={`run-${r.id}`}
          flexDirection="column"
          borderStyle="round"
          borderColor={working ? ACCENT : undefined}
          borderDimColor={!working}
          paddingX={1}
          marginBottom={1}
          width={width}
          flexShrink={0}
        >
          <Text key="q" bold wrap="wrap">
            {r.question}
          </Text>
          <Text key="status" dimColor={r.status !== 'failed'} color={r.status === 'failed' ? 'red' : undefined} wrap="wrap">
            {`${r.mode === 'deep' ? 'Deep' : 'Quick'}. ${r.status === 'working' ? r.step : r.status === 'done' ? `Done, ${r.sources.length} sources${r.pagesRead !== undefined && r.pagesRead < r.sources.length ? `, ${r.pagesRead} pages read` : ''}.` : `Failed: ${r.error ?? 'unknown'}`}`}
          </Text>
          {r.mode === 'deep' && !routerSeen && r.status === 'working' && !r.agents.some(a => a.picked) && (
            <Text key="router" dimColor wrap="wrap">
              Subagent Model Router is off, so the subagents use the chat's own model.
            </Text>
          )}
          {r.agents.map(a => (
            <Text key={`agent-${a.part}`} dimColor wrap="wrap">
              {`Subagent ${a.part} of ${r.agents.length} on ${a.model}: ${a.status}${a.note ? `, ${a.note}` : ''}`}
            </Text>
          ))}
          {r.sources.map(s =>
            s.url.startsWith('https://') ? (
              <Link key={`src-${s.n}`} href={s.url} label={`[${s.n}] ${s.title}`} />
            ) : (
              <Text key={`src-${s.n}`} wrap="wrap">
                {`[${s.n}] ${s.title}: ${s.url}`}
              </Text>
            ),
          )}
          {saved && (
            <Text key="saved" color={GOOD} wrap="wrap">
              {saved}
            </Text>
          )}
          {(more || r.notes) && (
            <Box key="buttons" flexDirection="row" justifyContent="space-between" width={cw}>
              {r.notes ? <Button key={`open-${r.id}`} label="Open notes" onPress={noop} /> : <Text> </Text>}
              {more ? (
                <Button key={`expand-${r.id}`} plain dimColor onPress={noop}>
                  {isOpen ? '▾ Hide brief' : r.reports?.length ? '▸ Brief and reports' : '▸ Brief'}
                </Button>
              ) : null}
            </Box>
          )}
          {isOpen && more && (
            <Box key="more" flexDirection="column" width={cw} marginTop={1}>
              <Text bold>The brief Claude got</Text>
              <Text wrap="wrap">{r.brief || 'No brief was kept.'}</Text>
              {(r.reports ?? []).map((t, i) => (
                <Box key={`rep-${i}`} flexDirection="column" width={cw} marginTop={1}>
                  <Text bold>{`Subagent report ${i + 1} of ${r.reports?.length ?? 0}`}</Text>
                  <Text dimColor wrap="wrap">
                    {t}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        <Box key="header" flexDirection="row" gap={1} width={width} marginBottom={1}>
          {mascot}
          <Box flexDirection="column" width={width - 13}>
            <Text bold color={busy ? ACCENT : undefined} wrap="wrap">
              {doing}
            </Text>
            <Text dimColor wrap="wrap">
              A cheap worker reads the web. Claude gets a short brief.
            </Text>
          </Box>
        </Box>
        <Text key="tools" dimColor wrap="wrap">
          {tools}
        </Text>
        <Text key="router" dimColor wrap="wrap">
          {`${routed ? 'Subagent Model Router: on. It picks each deep-mode subagent model.' : pickedLast ? "Subagent Model Router: a hook picked the last deep run's subagent models." : "Subagent Model Router: off. Deep-mode subagents use the chat's own model."}${lastModels.length ? ` Last deep run: ${lastModels.join(', ')}.` : ''}`}
        </Text>
        <Text key="gap"> </Text>
        {runs.length === 0 ? (
          <Text key="empty" dimColor wrap="wrap">
            {`No research yet. Type /${COMMAND} and a question, or /${COMMAND} deep and a question.`}
          </Text>
        ) : (
          runs.map(card)
        )}
        {autos.length > 0 && <Text key="auto-gap"> </Text>}
        {autos.length > 0 && (
          <Text key="auto-head" bold>
            Searches Claude ran
          </Text>
        )}
        {autos.map((a, i) => (
          <Box key={`auto-${i}`} flexDirection="row" gap={1} width={width}>
            <Text color={a.status === 'shortened' ? GOOD : a.status === 'failed' ? BAD : undefined} dimColor={a.status === 'kept'}>
              {a.status === 'shortened' ? '✓' : a.status === 'failed' ? '✗' : '·'}
            </Text>
            <Box width={width - 2}>
              <Text dimColor wrap="wrap">
                {`${
                  a.status === 'shortened' ? `"${a.query}": ${commas(a.before)} to ${commas(a.after)} tokens` : `"${a.query}": kept, ${commas(a.before)} tokens${a.note ? ` (${a.note})` : ''}`
                }${a.cost !== undefined ? `, Haiku ${money(a.cost)}` : ''}`}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
