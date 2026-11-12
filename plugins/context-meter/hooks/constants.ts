import { atom } from 'claude-code'

import type { Meter } from '../types'

export const NAME = 'context-meter'
export const BAND = 'context-meter'
// The ledger is only read, and only when it is smaller than this (the engine will not read a file over 4 MiB).
export const LEDGER_MAX_BYTES = 3_500_000
export const LEDGER_LINES = 20_000
// The percent badge is green below WARN_AT, yellow up to BAD_AT, red above.
export const WARN_AT = 70
export const BAD_AT = 90
export const TICK_MS = 30_000
export const CLEAR_WAIT_MS = 1500
export const COMPACT_WAIT_MS = 1000
export const LEGEND_MAX = 8

export const GOOD = '#16a34a'
export const WARN = '#ca8a04'
export const BAD = '#dc2626'
export const FILL_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#d97757', '#db2777', '#65a30d', '#9333ea', '#0d9488']

// "context-meter:hidden": true in switches.json hides the band; the /context-meter command keeps its own choice in the store.
export const HIDE_KEY = `${NAME}:hidden`
export const STORE_HIDDEN = 'hidden'

export const meterAtom = atom({ plugin: 'context-meter', key: 'meter' } as const, null as Meter | null, { shape: 'meter-1' })
