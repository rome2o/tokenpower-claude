export type Settings = { destination: string; minBytes: number; expireDays: number; sessionNotes: boolean }

// Module variables reset on a reload. One object, so every module reads and writes the same values.
export const S = {
  home: '',
  sid: '',
  // The first 8 letters and digits of the chat id: the name of this chat's inbox folder.
  short: '',
  project: 'project',
  scratch: '',
  scratchReal: '',
  // Files written or edited under the scratchpad that no triage has judged yet.
  tracked: new Map<string, { writes: number }>(),
  asking: false,
  // What the person chose at the last question this session. Notes need Save or Always, and never follow a Skip.
  choice: '' as '' | 'save' | 'skip' | 'always',
  // An agent report is waiting for the next safe moment to ask (the next prompt, or the end of the session).
  pendingAsk: false,
  // Quotes already written to a notes file this session, so compaction and session end do not repeat a note.
  quotes: new Set<string>(),
  // Message count at the last session notes run, so one chat does not write notes twice for the same stretch.
  notesAt: 0,
  // The engine had no chat to read in this mode (headless or background). Logged once, then notes are skipped quietly.
  noSession: false,
  settings: { destination: '', minBytes: 400, expireDays: 14, sessionNotes: true } as Settings,
}
