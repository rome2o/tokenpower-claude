import type { Ledger } from '../types'

import type { RowsOut, Scan } from './types.ts'

// Module variables reset on a reload; what the pane draws lives in $.state.
// One object, so every module reads and writes the same values (an ES import cannot be reassigned).
export const S = {
  root: '',
  home: '',
  sid: '',
  mainModel: '',
  sample: false,
  busy: false,
  lastSig: '',
  prevTokens: null as number | null,
  lastCompactAt: 0,
  // The last parsed ledger, so a new chat scan reprices it without reading the ledger again.
  lastParse: null as (Pick<Ledger, 'path' | 'sample' | 'chatId' | 'day' | 'mainModel' | 'partial'> & RowsOut) | null,
  listedAt: 0,
  checkedAt: 0,
  // A chat is still unread, so the next poll goes on without the 1-minute wait.
  scanMore: false,
  // The /mods switchboard turns this mod off in every chat with switches.json.
  off: false,
  hidden: false,
}
// One log line the first time each watching hook fires, so a live test shows which hooks run.
export const fired = new Set<string>()
// Chat transcripts price each saved input token by the requests after it.
// Session id to its ~/.claude/projects file, null when no file was found.
export const transcripts = new Map<string, string | null>()
// One scan per transcript, redone when the file changed, at most once a minute.
export const scans = new Map<string, { sig: string; at: number; scan: Scan | null }>()
