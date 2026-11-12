import type { Mode, Report } from '../types'

import { DEFAULT_MODE } from './constants.ts'

// Module variables reset on a reload; what the pane draws lives in $.state.
// One object, so every module reads and writes the same values (an ES import cannot be reassigned).
export const S = {
  root: '',
  home: '',
  sid: '',
  // The first 8 letters and digits of the chat id: the name of this chat's folder in the store.
  short: '',
  mode: DEFAULT_MODE as Mode,
  // True while a compaction is being planned, so a second one passes straight through.
  busy: false,
  lastReport: null as Report | null,
}
