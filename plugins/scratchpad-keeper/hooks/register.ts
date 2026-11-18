import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_EXPIRE_DAYS, DEFAULT_MIN_BYTES, MODEL } from './constants.ts'
import { hash8, isInside, redact, resolveDest, slug, stampOf } from './guards.ts'
import { addItem, agentItem, askText, describe, expireOld, gather, listInbox, saveAll, setSkipped } from './inbox.ts'
import type { Stored } from './inbox.ts'
import { ensureDir, homeOf, log, openFolder, tilde, toast } from './io.ts'
import { originFields, withFrontmatter } from './provenance.ts'
import type { Origin } from './provenance.ts'
import { buildPrompt, freshNotes, parseNotes, renderNotes, verifyNotes } from './notes.ts'
import { openPane, refreshPane, registerPane } from './pane.ts'
import { listSaved, newest, savedLine, SAVED_CAP } from './saved.ts'
import { S } from './state.ts'
import { isSwitchedOff } from './switches.ts'

// Scratchpad Keeper saves subagent reports and scratchpad documents to a folder you choose, so they
// outlive the session. Triage, masking and expiry are plain code. Only the optional session notes call a model.

const dest = () => resolveDest(S.settings.destination, S.home)
const fail = (err: unknown) => String(err instanceof Error ? err.message : err)

async function always($: EngineInterface): Promise<boolean> {
  try {
    return (await $.store.get('always')) === true
  } catch {
    return false
  }
}

const noteAsk = (d: string) => `Write session notes to ${tilde(d)}? A masked copy of this chat is sent to Haiku once and costs tokens.`

const mine = async ($: EngineInterface): Promise<Stored[]> => (await listInbox($)).filter(s => !s.item.skipped && s.item.sid === S.sid).sort((a, b) => a.item.at - b.item.at)

// One question for the batch: Save, Skip or Always. A dismissed question leaves every item pending.
async function askAndAct($: EngineInterface) {
  if (S.asking || !S.home) return
  S.asking = true
  try {
    const list = await mine($)
    if (list.length === 0) return
    const d = dest()
    if (await always($)) {
      S.choice = 'always'
      const r = await saveAll($, list, d)
      toast($, `Saved ${r.saved} item${r.saved === 1 ? '' : 's'} to ${tilde(d)}${r.failed ? `, ${r.failed} failed (see keeper.log)` : ''}.`)
      return
    }
    let answer = ''
    try {
      answer = await $.ui.ask(askText(list, d), ['Save', 'Skip', 'Always'])
    } catch {
      await log($, 'ask was dismissed or could not be shown; items stay in the inbox')
      return
    }
    S.choice = answer === 'Skip' ? 'skip' : answer === 'Always' ? 'always' : answer === 'Save' ? 'save' : S.choice
    if (answer === 'Skip') {
      for (const s of list) await setSkipped($, s)
      toast($, `Skipped. They stay in the inbox for ${S.settings.expireDays} days: /keeper list`)
      return
    }
    if (answer === 'Always') await $.store.set('always', true)
    if (answer === 'Save' || answer === 'Always') {
      const r = await saveAll($, list, d)
      toast($, `Saved ${r.saved} item${r.saved === 1 ? '' : 's'} to ${tilde(d)}${r.failed ? `, ${r.failed} failed (see keeper.log)` : ''}.`)
    }
  } finally {
    S.asking = false
    refreshPane($)
  }
}

// Session notes follow the same choice as the files. After a Skip nothing is sent and nothing is written. With no
// choice yet this session, one question asks first; a dismissed question counts as no.
async function notesAllowed($: EngineInterface): Promise<boolean> {
  if (await always($)) return true
  if (S.choice === 'save' || S.choice === 'always') return true
  if (S.choice === 'skip' || S.asking) return false
  S.asking = true
  try {
    const answer = await $.ui.ask(noteAsk(dest()), ['Save', 'Skip', 'Always'])
    S.choice = answer === 'Skip' ? 'skip' : answer === 'Always' ? 'always' : answer === 'Save' ? 'save' : ''
    if (answer === 'Always') await $.store.set('always', true)
    return answer === 'Save' || answer === 'Always'
  } catch {
    return false
  } finally {
    S.asking = false
  }
}

// Phase 2: one Haiku pass. Notes whose quote is not in the transcript are dropped by code; no notes means no file.
async function sessionNotes($: EngineInterface) {
  if (!S.settings.sessionNotes || !S.home) return
  try {
    const msgs = await $.session.messages().catch(err => {
      if (/not available in this mode/.test(fail(err))) return null
      throw err
    })
    if (msgs === null) {
      if (!S.noSession) await log($, 'session notes skipped: no chat to read in this mode (headless or background)')
      S.noSession = true
      return
    }
    if (msgs.length === 0 || msgs.length === S.notesAt) return
    if (!(await notesAllowed($))) return
    const transcript = redact(msgs.map(m => `${m.role}: ${m.text}`).join('\n')).slice(-60_000)
    const res = await $.model.complete({ model: MODEL, prompt: buildPrompt(transcript), maxTokens: 1500, timeoutMs: 30_000 })
    if (!res.isAnswered) {
      await log($, `session notes: model call failed (${res.reason})`)
      return
    }
    S.notesAt = msgs.length
    const verified = verifyNotes(parseNotes(res.text), transcript)
    const dropped = verified.dropped
    const kept = freshNotes(verified.kept, S.quotes)
    if (kept.length === 0) {
      await log($, `session notes: nothing kept (${dropped} dropped)`)
      return
    }
    const now = await $.clock.now()
    const d = dest()
    const path = `${d}/${slug(S.project)}/session-notes-${stampOf(now)}-${hash8(S.sid + msgs.length)}.md`
    if (!isInside(path, d)) return
    for (const n of kept) S.quotes.add(n.quote)
    await ensureDir($, `${d}/${slug(S.project)}`)
    const origin: Origin = { project: slug(S.project), projectPath: S.projectPath, sid: S.sid, saved: new Date(now).toISOString(), source: 'session-notes', originalName: path.slice(path.lastIndexOf('/') + 1) }
    await $.fs.write(path, withFrontmatter(renderNotes(kept, { project: S.project, date: new Date(now).toISOString().slice(0, 10), dropped }), originFields(origin, S.home)))
    toast($, `Session notes saved: ${tilde(path)}`)
  } catch (err) {
    await log($, `session notes failed: ${fail(err)}`)
  }
}

async function help($: EngineInterface, args: string): Promise<string> {
  const [sub = 'status', arg = ''] = args.trim().split(/\s+/)
  const d = dest()
  if (sub === 'status') {
    const all = await listInbox($)
    const waiting = all.filter(s => !s.item.skipped).length
    return `Scratchpad Keeper. Destination ${tilde(d)}. ${waiting} waiting, ${all.length - waiting} skipped (expire after ${S.settings.expireDays} days). Always-save: ${(await always($)) ? 'on' : 'off'}. Session notes: ${S.settings.sessionNotes ? 'on' : 'off'}. Commands: list, list saved, open, panel, save <id|all>, always, ask.`
  }
  if (sub === 'list' && arg === 'saved') {
    const rows = newest(await listSaved($, d), SAVED_CAP)
    return rows.length === 0 ? `Nothing saved under ${tilde(d)} yet.` : rows.map(savedLine).join('\n')
  }
  if (sub === 'list') {
    const all = await listInbox($)
    if (all.length === 0) return 'The inbox is empty.'
    return all.map(s => `${s.item.id}  ${s.item.skipped ? 'skipped' : 'waiting'}  ${describe(s.item)}`).join('\n')
  }
  if (sub === 'open') return openFolder($, d)
  if (sub === 'panel') return openPane($)
  if (sub === 'save') {
    const all = await listInbox($)
    const pick = arg === 'all' ? all : all.filter(s => s.item.id === arg)
    if (pick.length === 0) return arg ? `No inbox item matches "${arg}". Try /keeper list.` : 'Usage: /keeper save <id|all>'
    const r = await saveAll($, pick, d)
    refreshPane($)
    return `Saved ${r.saved} to ${tilde(d)}${r.failed ? `, ${r.failed} failed (see keeper.log)` : ''}.`
  }
  if (sub === 'always') {
    await $.store.set('always', true)
    return 'Always-save is on: items are saved to the destination without asking. Turn it off with /keeper never.'
  }
  if (sub === 'never') {
    await $.store.set('always', false)
    return 'Always-save is off: Scratchpad Keeper asks again.'
  }
  if (sub === 'ask') {
    await askAndAct($)
    return 'Done.'
  }
  return 'Usage: /keeper status | list | list saved | open | panel | save <id|all> | always | never | ask'
}

export const register: Register = (on, options) => {
  registerPane(on, dest)
  const num = (k: string, d: number) => (typeof options[k] === 'number' && Number.isFinite(options[k]) ? (options[k] as number) : d)
  on('session.start', async ($, e, next) => {
    S.home = homeOf($)
    S.tracked.clear()
    S.notesAt = 0
    S.noSession = false
    S.choice = ''
    S.pendingAsk = false
    S.quotes.clear()
    S.settings = {
      destination: typeof options.destination === 'string' ? options.destination : '',
      minBytes: num('minBytes', DEFAULT_MIN_BYTES),
      expireDays: num('expireDays', DEFAULT_EXPIRE_DAYS),
      sessionNotes: options.sessionNotes !== false,
    }
    try {
      S.sid = await $.session.id()
    } catch {
      S.sid = ''
    }
    S.short = S.sid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'nosid'
    try {
      const cwd = await $.session.cwd()
      S.project = slug(cwd.slice(cwd.lastIndexOf('/') + 1))
      S.projectPath = tilde(cwd)
    } catch {
      S.project = 'project'
      S.projectPath = ''
    }
    S.scratch = ''
    S.scratchReal = ''
    try {
      const info = await $.session.info()
      if (info.scratchpadDir) {
        S.scratch = info.scratchpadDir.replace(/\/+$/, '')
        S.scratchReal = (await $.fs.stat(S.scratch, { resolve: true }).catch(() => undefined))?.realPath ?? ''
      }
    } catch {
      // No scratchpad: only subagent reports are captured.
    }
    try {
      await $.command.register({ name: 'keeper', description: 'Scratchpad Keeper: status, list, list saved, open, panel, save <id|all>, always, never, ask', immediate: true })
    } catch (err) {
      await log($, `could not register /keeper: ${fail(err)}`)
    }
    if (!(await isSwitchedOff($))) {
      try {
        await expireOld($, await $.clock.now())
        const waiting = (await listInbox($)).filter(s => !s.item.skipped).length
        if (waiting > 0) toast($, `${waiting} item${waiting === 1 ? '' : 's'} waiting in the Scratchpad Keeper inbox: /keeper list`)
      } catch (err) {
        await log($, `startup check failed: ${fail(err)}`)
      }
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const res = await next(e)
    try {
      if ((e.tool !== 'Write' && e.tool !== 'Edit') || !S.scratch || (await isSwitchedOff($))) return res
      if ('deny' in res || ('isError' in res && res.isError)) return res
      const path = e.file_path
      if (!path.startsWith('/')) return res
      const inside = isInside(path, S.scratch) || (S.scratchReal !== '' && isInside(path, S.scratchReal))
      if (!inside) return res
      const t = S.tracked.get(path) ?? { writes: 0 }
      S.tracked.set(path, { writes: t.writes + 1 })
    } catch (err) {
      await log($, `could not track a write: ${fail(err)}`)
    }
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    try {
      if (!S.home || (await isSwitchedOff($))) return res
      if (e.agentId) {
        if (e.reason !== 'answer' || !e.answer.trim()) return res
        const known = (await $.agent.list()).find(a => a.id === e.agentId)
        if (!known || known.kind !== 'local_agent' || known.spawnedBy) return res
        const now = await $.clock.now()
        await addItem($, agentItem({ agentId: e.agentId, title: known.description || known.name || 'subagent report', answer: e.answer, now }))
        await gather($, false, now)
        refreshPane($)
        // Not asked here: a question inside turn.complete would hold the turn. It waits for the next prompt.
        S.pendingAsk = true
        toast($, 'A subagent report is waiting in the Scratchpad Keeper inbox. You will be asked before your next prompt, or type /keeper ask.')
      }
    } catch (err) {
      await log($, `turn.complete failed: ${fail(err)}`)
    }
    return res
  })

  on('prompt.submit', async ($, e, next) => {
    if (S.pendingAsk) {
      S.pendingAsk = false
      try {
        if (S.home && !(await isSwitchedOff($))) await askAndAct($)
      } catch (err) {
        await log($, `ask failed: ${fail(err)}`)
      }
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      if (S.home && !(await isSwitchedOff($))) {
        await gather($, true, await $.clock.now())
        await askAndAct($)
        await sessionNotes($)
      }
    } catch (err) {
      await log($, `session.end failed: ${fail(err)}`)
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    try {
      if (!e.agentId && S.home && !(await isSwitchedOff($))) await sessionNotes($)
    } catch (err) {
      await log($, `session.compact failed: ${fail(err)}`)
    }
    return next(e)
  })

  on('command.run', { command: 'keeper' }, async ($, e) => {
    try {
      return { text: await help($, e.args) }
    } catch (err) {
      await log($, `command failed: ${fail(err)}`)
      return { text: 'Scratchpad Keeper hit an error. See ~/.claude/mods-logs/scratchpad-keeper/keeper.log' }
    }
  })
}
