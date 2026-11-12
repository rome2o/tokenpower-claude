import type { ServerRow } from '../types'

// Module variables reset on a reload; what the pane draws lives in an atom.
// One object, so every module reads and writes the same values (an ES import cannot be reassigned).
export const S = {
  root: '',
  home: '',
  sid: '',
  // The /mods switchboard turns this mod off, or hides its pane, in every chat, through the switchboard file.
  off: false,
  hidden: false,
  // A refresh is running: events that arrive meanwhile are ignored.
  busy: false,
  // When the running refresh started (ms), -1 while the start time is being read, and a counter that retires an old refresh.
  busyAt: 0,
  gen: 0,
  status: 'waiting' as string,
  lastSig: '',
  rows: [] as ServerRow[],
  totalMcp: 0,
  window: 0,
  at: 0,
  // The newest error lines, written whole to the log file.
  logLines: [] as string[],
  lastLog: '',
}
