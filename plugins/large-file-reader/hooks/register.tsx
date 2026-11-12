import type { Register } from 'claude-code'
import type { Card } from '../types'
import { bashPart, isReader, logDiskWrite, passOther, programs } from './bash.ts'
import { loadCards, setCard, showPane } from './cards.ts'
import { PART_WORDS, REMOVED, statusText } from './commands.ts'
import { connector, purpose } from './connector.ts'
import {
  BAD,
  CARDS,
  DRAW_NOTES_MAX,
  GOOD,
  HAIKU,
  IMAGE_EXT,
  NAME,
  OFF,
  OPEN,
  PANE,
  PANE_TITLE,
  READERS,
  READ_LINES,
  SKIP_SERVER,
  SKIP_TOOL,
  TITLE,
} from './constants.ts'
import type { Part } from './constants.ts'
import { isInstruction, lineRange, notesKey, rangeKey, routed, routedRanges } from './filebase.ts'
import { UNCHANGED, answer, pass, piece, recordFile, remind, wholeRead, wouldRoute } from './fileread.ts'
import { log, sessionId, status } from './ledger.ts'
import { makeNotes, notesFor, saveNotes } from './notes.ts'
import { pdfSource } from './sources.ts'
import { S, chatOff, fullNext, globalOff, hiddenIn } from './state.ts'
import type { ToolOut } from './state.ts'
import { checkOpen, partOn, readSwitch, takeFull } from './switches.ts'
import { extOf, fmt, tokens } from './text.ts'
import { MASCOT_PX, clockOf, cutText, fileUrl, mascotSvg, toolOf, usdText } from './ui.ts'

// Large File Reader: anything big that comes into the chat from outside is read by Haiku first, and Claude gets
// short notes and a path to the full thing. Two parts, one switch:
//   file       a whole Read of a big text file or PDF (was Read Router)
//   connector  a big connector (MCP) result (was Connector Reader)
// The real tool always runs first (a big PDF is the one exception: it is read before core, only when the
// permission check says the Read would run unasked). Anything that fails passes the normal result on.
// A side pane shows each hand-off to Haiku as it happens: what went in, what came back, what it cost.
//
// The web part (repeat WebFetch) was removed on 2026-11-03. It is archived in
// ~/.claude/mods-archive/input-router-web-part-2026-11-03/.
//
// Results with images belong to Browser Screenshot Compressor, so image files and image blocks pass on untouched.

// ============================================================================
// Hooks
// ============================================================================

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    S.home = $.plugin.root.split('/.claude/')[0] ?? ''
    try {
      await $.command.register({
        name: 'input-router',
        description: 'Large File Reader. No argument: what it did in this chat. full: let the next big input through whole. off/on file|connector. pane: show the Haiku pane',
        argumentHint: '[full | pane | off <file|connector> | on <file|connector>]',
        immediate: true,
      })
    } catch (err) {
      await log($, 'mod', 'command not registered', err)
    }
    S.currentSid = await sessionId($)
    if (typeof e.cwd === 'string') S.cwd = e.cwd
    await readSwitch($)
    await loadCards($)
    if (!S.polling) {
      S.polling = true
      $.clock.every(3000, () => {
        void readSwitch($)
          .then(() => checkOpen($))
          .catch(() => undefined)
      })
    }
    return next(e)
  })

  // ---------- file ----------
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (!(await partOn($, 'file'))) return next(e)
    const ext = extOf(e.file_path)
    // Image files belong to Browser Screenshot Compressor; notebooks keep their cells.
    if (IMAGE_EXT.has(ext) || ext === 'ipynb') return next(e)
    // Guard B: skills, CLAUDE.md, AGENTS.md, memory, settings and switches reach Claude word for word.
    if (isInstruction(e.file_path)) {
      const ran = await next(e)
      const text = typeof ran.text === 'string' ? ran.text : ''
      await pass($, tokens(text), `${e.file_path}: instruction file, passed word for word`)
      return ran
    }
    // Core's saved tool results (tool-results/) are routed like any file, so subagents paging through them are
    // counted by the piece counter too.

    if (e.agentId === undefined && fullNext.size > 0 && (await wouldRoute($, e, ext)) && (await takeFull($))) {
      await log($, 'file', 'full', e.file_path)
      if (ext === 'pdf' || e.offset !== undefined || e.limit !== undefined) return next(e)
      // Core keeps a record of the read it ran under the notes; another limit stops it answering "unchanged".
      return next({ ...e, allow_large: true, ...(routed.has(e.file_path) && { offset: 1, limit: 10_000_000 }) })
    }

    if (ext === 'pdf') {
      const stat = await $.fs.stat(e.file_path)
      const task = await purpose($, e.agentId)
      const key = notesKey(e.file_path, stat, task, `|${e.pages ?? ''}`)
      const input = { file_path: e.file_path, ...(e.pages !== undefined && { pages: e.pages }) }
      let checked = false
      const got = await notesFor($, e.file_path, key, async () => {
        const plan = await pdfSource($, e.file_path, e.pages, stat.mtimeMs)
        if (!plan) return null
        // The notes skip core, and with it the permission prompt: answer only a read that would run unasked.
        const check = await $.tool.check({ tool: 'Read', input })
        checked = true
        if (check.decision !== 'allow') {
          await log($, 'file', 'pass', `${e.file_path}: permission check said ${check.decision}${check.reason ? ` (${check.reason})` : ''}, so core answers`)
          return null
        }
        return makeNotes($, plan.src, plan.before, plan.label, next.signal, task)
      })
      if (!got) return next(e)
      if (!checked && (await $.tool.check({ tool: 'Read', input })).decision !== 'allow') return next(e)
      routed.add(e.file_path)
      if (got.how === 'fresh') await saveNotes($, e.file_path, key, got.notes)
      return answer(e.file_path, await recordFile($, e, got.notes, got.how))
    }

    // A range Claude chose. Core runs first. A range that covers the whole file is a whole read. Any other range
    // is a piece: guard A, the piece counter and the limit decide (see piece()).
    if (e.offset !== undefined || e.limit !== undefined || e.pages !== undefined) {
      let ran = await next(e)
      // Core may take offset 1 for the whole read under the notes and answer "unchanged": ask for the lines.
      if (routed.has(e.file_path) && e.limit === undefined && ran.isError !== true && ran.result?.type === 'file_unchanged') {
        ran = await next({ ...e, limit: READ_LINES })
      }
      if (ran.deny !== undefined || ran.isError === true || ran.result === undefined) return ran
      const r = ran.result
      // The same range again, after this mod answered it with notes: core's "unchanged" points at those notes.
      if (r.type === 'file_unchanged') return routedRanges.has(rangeKey(e)) ? answer(r.file.filePath, UNCHANGED(e.file_path)) : ran
      if (r.type !== 'text' || e.pages !== undefined) return ran
      try {
        const total = r.file.totalLines ?? r.file.numLines
        const start = r.file.startLine ?? e.offset ?? 1
        const text = ran.text ?? r.file.content
        if ((e.offset ?? 1) <= 1 && r.file.numLines >= total) {
          const out = await wholeRead($, e, ran, r.file.filePath, text, 'whole range', next.signal)
          if (out !== ran) routedRanges.add(rangeKey(e))
          return out
        }
        const what = `ranged read, lines ${start}-${start + r.file.numLines - 1} of ${total}`
        const got = await piece($, e, { lines: lineRange(start, r.file.numLines), total, text, what }, 'Read', next.signal)
        if ('notes' in got) {
          routedRanges.add(rangeKey(e))
          return answer(r.file.filePath, got.notes)
        }
        const line = got.context ?? (await remind($, e, ran as ToolOut))
        return line ? { ...ran, context: [...(ran.context ?? []), line] } : ran
      } catch (err) {
        await log($, 'file', 'ranged read', err)
        return ran
      }
    }

    // Core runs first: the permission check, and the record of the read that Edit looks for.
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || ran.result === undefined) return ran
    const r = ran.result
    if (r.type === 'file_unchanged') return routed.has(e.file_path) ? answer(r.file.filePath, UNCHANGED(e.file_path)) : ran
    if (r.type !== 'text') return ran
    return wholeRead($, e, ran, r.file.filePath, ran.text ?? r.file.content, 'whole read', next.signal)
  }).catch(($, e, next) => next(e))

  // ---------- Bash: file reads and API calls through the shell ----------
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.run_in_background || !((await partOn($, 'file')) || (await partOn($, 'connector')))) return next(e)
    const reader = isReader(e.command)
    const ran = await next(e)
    if (S.off || ran.deny !== undefined || ran.isError === true) return ran
    // The command has run: from here a failure hands back its output, never a second run.
    const held: { card?: Card } = {}
    try {
      if (!reader) {
        // A reader piped on to a writer (curl ... | tee file) sent its output to disk.
        if (programs(e.command).some(p => READERS.has(p))) await logDiskWrite($, e.command)
        await passOther($, e.command, ran as ToolOut)
        return ran
      }
      return (await bashPart($, e, ran as ToolOut, next.signal, held)) as typeof ran
    } catch (err) {
      await log($, 'file', 'Bash failed, plain output sent', err)
      await status($, undefined)
      return ran
    } finally {
      if (held.card?.phase === 'working') await setCard($, held.card, { phase: 'failed', state: 'Something broke, so Claude got the plain output' })
    }
  }).catch(($, e, next) => next(e))

  // ---------- connector ----------
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (!tool.startsWith('mcp__') || SKIP_SERVER.test(tool) || SKIP_TOOL.test(tool) || !(await partOn($, 'connector'))) return next(e)
    const ran = await next(e)
    if (S.off || ran.deny !== undefined || ran.isError) return ran
    // The tool has run: from here a failure hands back its result, never a second run (the .catch would repeat it).
    const held: { card?: Card } = {}
    try {
      return (await connector($, e as unknown as Record<string, unknown> & { tool_use_id?: string }, tool, ran as ToolOut, next.signal, held)) as typeof ran
    } catch (err) {
      await log($, 'connector', 'failed, plain result sent', err)
      await status($, undefined)
      return ran
    } finally {
      if (held.card?.phase === 'working') await setCard($, held.card, { phase: 'failed', state: 'Something broke, so Claude got the plain result' })
    }
  }).catch(($, e, next) => next(e))

  // ---------- pane ----------
  // The person's close mark (X) or key: hidden in this chat, like Hide, so the next hand-off does not pop it back.
  // The close itself always goes on.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      try {
        hiddenIn.add(await sessionId($))
        void Promise.resolve()
          .then(() => $.ui.toast(`${PANE_TITLE} closed in this chat. Type /input-router pane, or press Open in /mods, to show it again.`))
          .catch(() => undefined)
      } catch {
        // The pane closes anyway.
      }
    }
    return next(e)
  })

  on('ui.press', { plugin: NAME, element: 'hide' }, async ($, e) => {
    hiddenIn.add(await sessionId($))
    await $.ui.close({ id: PANE }).catch(() => undefined)
    void Promise.resolve()
      .then(() => $.ui.toast(`${PANE_TITLE} hidden in this chat. Type /input-router pane, or press Open in /mods, to show it again.`))
      .catch(() => undefined)
    return { element: e.element }
  })

  on('ui.press', { plugin: NAME }, async ($, e, next) => {
    if (!e.element.startsWith('notes-')) return next(e)
    const id = e.element.slice('notes-'.length)
    const { value: open = '' } = await $.state.get(OPEN)
    await $.state.set(OPEN, open === id ? '' : id)
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const { value: isOff = false } = await $.state.get(OFF)
    if (isOff || S.off) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Svg and Markdown draw on desktop, the editor and mobile; the terminal gets text.
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const Markdown = e.surface !== 'terminal' && 'Markdown' in els ? els.Markdown : null
    const sid = await sessionId($)
    const { value: all = [] } = await $.state.get(CARDS)
    const list = (sid ? all.filter(c => c.session === sid) : all).slice().reverse()
    const { value: openId = '' } = await $.state.get(OPEN)
    const width = Math.max(32, e.props.bodyColumns)
    const cw = width - 4
    const working = list.some(c => c.phase === 'working')
    const handed = list.filter(c => c.phase !== 'kept')
    const before = list.reduce((s, c) => s + (c.after === null ? 0 : c.before), 0)
    const after = list.reduce((s, c) => s + (c.after ?? 0), 0)
    const usd = handed.some(c => c.usd !== null) ? handed.reduce((s, c) => s + (c.usd ?? 0), 0) : null
    const summary = list.length
      ? [`${list.length} in this chat`, after ? `${fmt(before)} to ${fmt(after)} tokens` : '', handed.length ? `Haiku ${usdText(usd)}` : ''].filter(Boolean).join(' · ')
      : 'Nothing handed to Haiku yet'

    const mascot = Svg ? (
      <Box key="mascot" width={9} flexShrink={0}>
        <Svg source={mascotSvg(working)} alt={working ? 'Haiku reader, teal, reading' : 'Haiku reader, teal, resting'} width={MASCOT_PX} height={MASCOT_PX} />
      </Box>
    ) : (
      <Box key="mascot" width={7} flexShrink={0} flexDirection="column">
        <Text color={HAIKU}>{working ? '(o_o)' : '(-_-)'}</Text>
        <Text color={HAIKU}>{' [≡] '}</Text>
      </Box>
    )

    const card = (c: Card) => {
      const live = c.phase === 'working'
      const isOpen = openId === c.id
      const mark = live ? '●' : c.phase === 'done' ? '✓' : c.phase === 'failed' ? '✗' : '↺'
      const markColor = live ? HAIKU : c.phase === 'failed' ? BAD : c.phase === 'done' ? GOOD : undefined
      const stateColor = live ? HAIKU : c.phase === 'failed' ? BAD : c.phase === 'done' ? GOOD : undefined
      const secs = c.endedAt ? Math.max(0, Math.round((c.endedAt - c.startedAt) / 1000)) : 0
      const numbers = [
        c.after === null ? `${fmt(c.before)} tokens in` : `${fmt(c.before)} to ${fmt(c.after)} tokens`,
        c.requests ? `${c.requests} Haiku request${c.requests === 1 ? '' : 's'} · ${usdText(c.usd)}` : 'no Haiku call',
        clockOf(c.startedAt),
      ].join(' · ')
      const state = c.phase === 'done' || c.phase === 'failed' ? `${c.state} (${secs}s)` : c.state
      const links = [c.detail ? `[Open detail file](${fileUrl(c.detail)})` : '', c.full ? `[Open full result](${fileUrl(c.full)})` : ''].filter(Boolean).join('  ·  ')
      return (
        <Box
          key={`card-${c.id}`}
          flexDirection="column"
          width={width}
          marginBottom={1}
          borderStyle="round"
          borderColor={live ? HAIKU : undefined}
          borderDimColor={!live}
          paddingX={1}
        >
          <Box flexDirection="row" justifyContent="space-between" width={cw}>
            <Box width={cw - 2}>
              <Text wrap="truncate-end">
                <Text bold color={HAIKU}>{`${toolOf(c)}  `}</Text>
                <Text bold>{cutText(c.label, cw - 14)}</Text>
              </Text>
            </Box>
            <Text bold color={markColor}>{mark}</Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {cutText(c.where, cw)}
          </Text>
          <Text wrap="truncate-end">{numbers}</Text>
          <Text bold={live} color={stateColor} wrap="truncate-end">
            {state}
          </Text>
          {links && Markdown ? <Markdown key={`links-${c.id}`} text={links} /> : null}
          {links && !Markdown ? (
            <Text dimColor wrap="truncate-end">
              {[c.detail, c.full].filter(Boolean).join('  ')}
            </Text>
          ) : null}
          {c.notes ? (
            <Button key={`notes-${c.id}`} plain dimColor onPress={() => undefined}>
              {isOpen ? '▾ Hide the notes' : '▸ Show the notes Claude got'}
            </Button>
          ) : null}
          {isOpen && c.notes ? (
            <Box key={`text-${c.id}`} flexDirection="column" width={cw} marginTop={1}>
              <Text wrap="wrap">{c.notes.length > DRAW_NOTES_MAX ? `${c.notes.slice(0, DRAW_NOTES_MAX)}\n[cut here: open the detail file for the rest]` : c.notes}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        <Box key="header" flexDirection="row" gap={1} width={width} marginBottom={1}>
          {mascot}
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold color={working ? HAIKU : undefined}>
                {working ? 'Haiku is reading' : PANE_TITLE}
              </Text>
              <Button key="hide" label="Hide" dimColor onPress={() => undefined} />
            </Box>
            <Text dimColor wrap="wrap">
              {summary}
            </Text>
          </Box>
        </Box>
        {list.length ? null : <Text dimColor>A card shows up here each time a big file or connector result goes to Haiku.</Text>}
        {list.map(card)}
      </Box>
    )
  })

  // ---------- command ----------
  on('command.run', { command: 'input-router' }, async ($, e) => {
    await readSwitch($)
    if (S.off) return { text: `${TITLE} is off. Turn it on with /mods.` }
    const sid = await sessionId($)
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const [verb, what] = words
    if (!verb) return { text: await statusText($) }
    if (verb === 'full') {
      fullNext.add(sid)
      return { text: `${TITLE}: the next big input in this chat (a file or a connector result) comes through whole, once.` }
    }
    if (verb === 'pane') {
      hiddenIn.delete(sid)
      if (S.globalHidden) return { text: `${TITLE}: the pane is hidden in every chat. Press Shown in /mods, or remove "${NAME}:hidden" from switches.json, to show it.` }
      const opened = await showPane($, '/input-router pane').catch(async err => {
        await log($, 'mod', 'pane open', err)
        return null
      })
      if (opened === null) return { text: `${TITLE}: the pane did not open. The reason is in ~/.claude/mods-logs/${NAME}.log.` }
      const count = S.cards.filter(c => c.session === sid).length
      if (!opened.isPlaced) return { text: `${TITLE}: the pane is open but not drawn yet (${opened.reason}).` }
      return { text: `${TITLE}: pane opened with ${count} card${count === 1 ? '' : 's'} from this chat. New cards show up when Haiku reads a big file or connector result.` }
    }
    if ((verb === 'off' || verb === 'on') && what !== undefined && REMOVED.has(what)) {
      return { text: `${TITLE}: the web part was removed on 2026-11-03. Large File Reader has two parts now: file and connector.` }
    }
    if ((verb === 'off' || verb === 'on') && what !== undefined && PART_WORDS[what]) {
      const part = PART_WORDS[what]!
      const set = chatOff.get(sid) ?? new Set<Part>()
      if (verb === 'off') set.add(part)
      else set.delete(part)
      if (set.size) chatOff.set(sid, set)
      else chatOff.delete(sid)
      const global = verb === 'on' && globalOff.has(part) ? ` It is still off in every chat: switches.json has "${NAME}:${part}": false.` : ''
      return { text: `${TITLE}: the ${part} part is ${verb} in this chat.${global}` }
    }
    return { text: `${TITLE}: unknown "${e.args.trim()}". Use /input-router, /input-router full, /input-router pane, or /input-router off file (or connector) and on to undo.\n\n${await statusText($)}` }
  })
}
