import type { EngineInterface } from 'claude-code'
import type { Card } from '../types'
import { CARDS, CARDS_ALL, CARDS_MAX, CARD_NOTES_MAX, PANE, PANE_TITLE } from './constants.ts'
import { log, sessionId } from './ledger.ts'
import { S, hiddenIn } from './state.ts'
import type { Call } from './state.ts'

// ---------- the pane's cards ----------
// None of these throw: a pane error after a tool has run must never send the call down again (the .catch would).

// Haiku 5.5 list prices per token, the same table Token Savings Tracker uses (claude-api skill, model-migration.md,
// read 2026-11-02). Each request is priced on its own tier. No usage means no price, not a guess.
export function haikuUsd(calls: readonly Call[]): number | null {
  if (calls.length === 0 || calls.every(c => c.in === 0 && c.out === 0)) return null
  return calls.reduce((s, c) => s + (c.in <= 100_000 ? c.in * 0.1e-6 + c.out * 0.5e-6 : c.in * 0.5e-6 + c.out * 2.5e-6), 0)
}

async function drawCards($: EngineInterface) {
  try {
    await $.state.set(CARDS, S.cards.map(c => ({ ...c })))
  } catch (err) {
    await log($, 'mod', 'pane state', err)
  }
}

// The newest CARDS_MAX cards of each chat, and CARDS_ALL in all, so a busy chat never pushes another chat's cards out.
function trimCards(all: Card[]) {
  const seen = new Map<string, number>()
  const out: Card[] = []
  for (let i = all.length - 1; i >= 0 && out.length < CARDS_ALL; i--) {
    const c = all[i]!
    const n = (seen.get(c.session) ?? 0) + 1
    seen.set(c.session, n)
    if (n <= CARDS_MAX) out.push(c)
  }
  return out.reverse()
}

// After a reload the module starts empty; the cards drawn before it are still in state.
export async function loadCards($: EngineInterface) {
  if (S.cards.length > 0) return
  try {
    const { value = [] } = await $.state.get(CARDS)
    S.cards = trimCards(value.map(c => ({ ...c, ...(c.phase === 'working' && { phase: 'failed' as const, state: 'Stopped by a reload' }) })))
    S.cardN = S.cards.reduce((m, c) => Math.max(m, Number(c.id.slice(1)) || 0), S.cardN)
  } catch (err) {
    await log($, 'mod', 'cards not loaded', err)
  }
}

// Opens the pane with every card of this chat. A person's command or press places it at any width; an open
// the mod makes on its own (a hand-off, the /mods Open button) waits undrawn on a narrow window.
export async function showPane($: EngineInterface, why: string) {
  await loadCards($)
  await drawCards($)
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
  if (!opened.isPlaced) await log($, 'mod', 'pane not placed', `${why}: ${opened.reason}`)
  return opened
}

// A new card. Hand-offs to Haiku open the pane (unless it is hidden); kept notes only add a card.
export async function newCard($: EngineInterface, c: Omit<Card, 'id' | 'session' | 'startedAt' | 'endedAt' | 'answered' | 'usd' | 'notes' | 'detail' | 'full' | 'after'> & Partial<Card>) {
  const now = await $.clock.now().catch(() => 0)
  const session = await sessionId($)
  const card: Card = { id: `c${++S.cardN}`, session, startedAt: now, endedAt: 0, answered: 0, usd: null, notes: '', detail: null, full: null, after: null, ...c }
  S.cards.push(card)
  S.cards = trimCards(S.cards)
  await drawCards($)
  if (card.phase === 'working' && !S.off && !S.globalHidden && !hiddenIn.has(session)) {
    void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(err => log($, 'mod', 'pane open', err))
  }
  return card
}

export async function setCard($: EngineInterface, card: Card | null | undefined, patch: Partial<Card>) {
  if (!card) return
  try {
    Object.assign(card, patch)
    if (patch.phase && patch.phase !== 'working' && !card.endedAt) card.endedAt = await $.clock.now()
    if (patch.notes !== undefined && card.notes.length > CARD_NOTES_MAX) card.notes = `${card.notes.slice(0, CARD_NOTES_MAX)}\n[cut here: the rest is in the detail file]`
  } catch {
    // Keep what is set.
  }
  await drawCards($)
}

// Live line while the requests run side by side.
export const reading = (answered: number, of: number) => (of > 1 ? `Haiku is reading ${of} parts: ${answered} of ${of} done` : 'Haiku is reading')
