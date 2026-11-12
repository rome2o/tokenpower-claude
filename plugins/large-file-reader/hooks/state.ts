import type { Card } from '../types'
import type { Part } from './constants.ts'

// ---------- shared state ----------

export type Call = { in: number; out: number }
export type Helper = { model: string; in: number; out: number; calls: Call[] }
export type Done = { part: Part; label: string; before: number; after: number; how: string; at: string }

// "large-file-reader:file": false in switches.json turns one part off in every chat.
export const globalOff = new Set<Part>()
// /input-router off <part> and /input-router full hold for one chat, keyed by session id.
export const chatOff = new Map<string, Set<Part>>()
export const fullNext = new Set<string>()
export const done = new Map<string, Done[]>()
export const RECENT_MAX = 8

export const hiddenIn = new Set<string>()

export type ToolOut = { deny?: unknown; isError?: boolean; result?: unknown }

// Top-level state that more than one module reads and writes. An ES import cannot be reassigned, so each
// value lives on this one object.
export const S = {
  home: '',
  off: false,
  polling: false,
  // The chat id of the newest session.start: the 3-second poll checks that chat's /mods Open file, so after
  // /clear or a resume it looks for the new chat's file, as Helper Desk does.
  currentSid: '',
  // The chat's folder, for paths a shell command names from it.
  cwd: '',
  // "large-file-reader:hidden": true in switches.json keeps the pane shut in every chat; Hide shuts it in one chat.
  globalHidden: false,
  // Why the shell append failed, once, for the plain log.
  fellBack: '',
  cards: [] as Card[],
  cardN: 0,
}
