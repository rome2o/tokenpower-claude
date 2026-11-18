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
  // Message count at the last session notes run, so one chat does not write notes twice for the same stretch.
  notesAt: 0,
  settings: { destination: '', minBytes: 400, expireDays: 14, sessionNotes: true } as Settings,
}
