// Module variables reset on a reload; what the pane draws lives in the audit atom.
// One object, so every module reads and writes the same values (an ES import cannot be reassigned).
export const S = {
  root: '',
  home: '',
  sid: '',
  // The /mods switchboard turns this mod off in every chat with switches.json.
  off: false,
  hidden: false,
  // When a refresh started (ms), 0 when none runs. A refresh stuck for 30 s no longer blocks the next one.
  busySince: 0,
  // Bumped when the session ends, so a refresh that finishes late does not write into the cleared pane.
  epoch: 0,
  items: 0,
  flags: 0,
  at: 0,
}
// The newest error lines, kept here so the log file can be rewritten without reading it.
export const logLines: string[] = []
