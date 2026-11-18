import type { EngineInterface, Register, RenderElement } from 'claude-code'

import { describe, listInbox, saveItem, setSkipped } from './inbox.ts'
import type { Stored } from './inbox.ts'
import { log, openFolder, tilde, toast } from './io.ts'
import { listSaved, newest, savedLine } from './saved.ts'
import type { SavedRow } from './saved.ts'
import { S } from './state.ts'
import { isSwitchedOff } from './switches.ts'

type On = Parameters<Register>[0]

// A pane beside the chat: what waits in the inbox, with Save and Skip buttons, and the newest saves. Nothing is
// saved unless a button or a command is pressed, the same consent as the question. It redraws when the inbox changes.
// Written with h() instead of JSX so the unit tests can load this file under plain Node.
export const PANE = 'scratchpad-keeper'
const MAX_WAITING = 10
const MAX_RECENT = 8

export type PanelModel = {
  waiting: { id: string; label: string; skipped: boolean }[]
  more: number
  recent: string[]
  recentMore: number
}

// Pure: the rows the pane draws. Waiting items come before skipped ones, newest first.
export function panelModel(items: Stored[], saved: SavedRow[]): PanelModel {
  const rows = [...items].sort((a, b) => Number(a.item.skipped) - Number(b.item.skipped) || b.item.at - a.item.at)
  const recent = newest(saved, MAX_RECENT)
  return {
    waiting: rows.slice(0, MAX_WAITING).map(s => ({ id: s.item.id, label: describe(s.item), skipped: s.item.skipped })),
    more: Math.max(0, rows.length - MAX_WAITING),
    recent: recent.map(savedLine),
    recentMore: Math.max(0, saved.length - recent.length),
  }
}

// Asks the engine to draw the pane again. Harmless when the pane is not open.
export function refreshPane($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // No pane to refresh.
  }
}

export async function openPane($: EngineInterface): Promise<string> {
  try {
    const r = await $.ui.open({ id: PANE, title: 'Scratchpad Keeper' })
    refreshPane($)
    return r.isPlaced ? 'Scratchpad Keeper pane opened.' : 'Scratchpad Keeper pane opened, but this window has no room to show it yet.'
  } catch (err) {
    return `Could not open the pane: ${String(err instanceof Error ? err.message : err)}`
  }
}

export function registerPane(on: On, dest: () => string) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (await isSwitchedOff($)) return h(Text, { dimColor: true }, 'Turned off in /mods.') as RenderElement
    const d = dest()
    const model = panelModel(await listInbox($), await listSaved($, d))

    const act = (what: string, fn: () => Promise<unknown>) => () => {
      void fn()
        .catch(err => log($, `${what} from the pane failed: ${String(err instanceof Error ? err.message : err)}`))
        .finally(() => refreshPane($))
    }
    const pick = async (id: string) => (await listInbox($)).find(s => s.item.id === id)

    const waiting = model.waiting.map(w =>
      h(
        Box,
        { key: `row-${w.id}`, flexDirection: 'column', marginBottom: 1 },
        h(Text, { wrap: 'wrap' }, `${w.skipped ? '(skipped) ' : ''}${w.label}`),
        h(
          Box,
          { flexDirection: 'row', gap: 1 },
          h(Button, {
            key: `save-${w.id}`,
            label: 'Save',
            variant: 'primary',
            onPress: act('save', async () => {
              const s = await pick(w.id)
              if (!s) return
              const path = await saveItem($, s, d)
              toast($, path ? `Saved to ${tilde(path)}` : 'Could not save (see keeper.log).')
            }),
          }),
          w.skipped
            ? null
            : h(Button, {
                key: `skip-${w.id}`,
                label: 'Skip',
                onPress: act('skip', async () => {
                  const s = await pick(w.id)
                  if (s) await setSkipped($, s)
                }),
              }),
        ),
      ),
    )

    return h(
      Box,
      { flexDirection: 'column', width: Math.max(32, e.props.bodyColumns) },
      h(Text, { bold: true }, 'Waiting'),
      model.waiting.length === 0 ? h(Text, { key: 'none', dimColor: true }, 'Nothing is waiting.') : null,
      ...waiting,
      model.more > 0 ? h(Text, { key: 'more', dimColor: true }, `and ${model.more} more: /keeper list`) : null,
      h(Text, { key: 'saved-title', bold: true }, 'Recent saves'),
      model.recent.length === 0 ? h(Text, { key: 'nosaves', dimColor: true }, 'Nothing saved yet.') : null,
      ...model.recent.map((line, i) => h(Text, { key: `saved-${i}`, dimColor: true, wrap: 'truncate-end' }, line)),
      model.recentMore > 0 ? h(Text, { key: 'smore', dimColor: true }, `and ${model.recentMore} more: /keeper list saved`) : null,
      h(Button, { key: 'open', label: `Open folder ${tilde(d)}`, onPress: act('open folder', async () => toast($, await openFolder($, d))) }),
    ) as RenderElement
  })
}
