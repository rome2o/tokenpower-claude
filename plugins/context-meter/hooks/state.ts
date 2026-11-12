import type { MeterData, Saved } from './bar.ts'

// Module variables reset on a reload; what the band draws lives in the meter atom.
// One object, so every module reads and writes the same values (an ES import cannot be reassigned).
export const S = {
  root: '',
  home: '',
  // The /mods switchboard turns this mod off, or hides the band, in every chat with switches.json.
  off: false,
  switchHidden: false,
  // The /context-meter command's own choice, kept in the store.
  hidden: false,
  busy: false,
  again: false,
  ledgerBusy: false,
  lastSig: '',
  breakdown: null as MeterData | null,
  savedToday: { kind: 'none' } as Saved,
  costUsd: null as number | null,
  ledgerSig: '',
  // Bumped on session end and on a new start, so a timer from an earlier run stops itself.
  gen: 0,
  timer: null as { cancel: () => void } | null,
}
// One log line the first time each message is sent.
export const logged = new Set<string>()
