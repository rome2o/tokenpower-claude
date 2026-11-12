import type { EngineInterface } from 'claude-code'
import { showPane } from './cards.ts'
import { NAME, PANE, PANE_TITLE, PARTS } from './constants.ts'
import type { Part } from './constants.ts'
import { sessionId } from './ledger.ts'
import { S, chatOff, fullNext, globalOff, hiddenIn } from './state.ts'

const OFF = { plugin: 'large-file-reader', key: 'off' } as const

// The /mods switchboard turns this mod off in every chat with switches.json. Missing means on.
export async function readSwitch($: EngineInterface) {
  try {
    const path = `${S.home || ($.plugin.root.split('/.claude/')[0] ?? '')}/.claude/mods/switches.json`
    const json = (await $.fs.exists(path)) ? (JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>) : {}
    const wasShown = !S.off && !S.globalHidden
    const wasOff = S.off
    S.off = json[NAME] === false
    S.globalHidden = json[`${NAME}:hidden`] === true
    for (const p of PARTS) {
      if (json[`${NAME}:${p}`] === false) globalOff.add(p)
      else globalOff.delete(p)
    }
    // The /mods switch turns the pane off with the mod.
    if (wasShown && (S.off || S.globalHidden)) void $.ui.close({ id: PANE }).catch(() => undefined)
    if (S.off !== wasOff) void $.state.set(OFF, S.off).catch(() => undefined)
  } catch {
    // Keep the last value.
  }
}

// The /mods switchboard's Open button writes ~/.claude/mods/.open-large-file-reader-<session id>: open the pane in
// that chat (even after Hide or the X), then remove the file. The open is the mod's own, so a narrow window
// may hold it undrawn; the toast then names the command, which always places it.
export async function checkOpen($: EngineInterface) {
  const sid = S.currentSid || (await sessionId($))
  if (!sid || !S.home) return
  const path = `${S.home}/.claude/mods/.open-${NAME}-${sid}`
  if (!(await $.fs.exists(path).catch(() => false))) return
  await $.process.run(['rm', '-f', path])
  hiddenIn.delete(sid)
  if (S.off || S.globalHidden) return
  const opened = await showPane($, '/mods Open')
  if (!opened.isPlaced) {
    void Promise.resolve()
      .then(() => $.ui.toast(`${PANE_TITLE} is waiting for a wider window. Type /input-router pane to show it now.`))
      .catch(() => undefined)
  }
}

export async function partOn($: EngineInterface, part: Part) {
  if (S.off || globalOff.has(part)) return false
  if (chatOff.size === 0) return true
  return !chatOff.get(await sessionId($))?.has(part)
}

// /input-router full: true once, for the next input a part would have acted on.
export async function takeFull($: EngineInterface) {
  if (fullNext.size === 0) return false
  return fullNext.delete(await sessionId($))
}
