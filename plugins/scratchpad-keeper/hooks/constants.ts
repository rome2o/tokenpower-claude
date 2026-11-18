export const NAME = 'scratchpad-keeper'
export const STORE_SUBPATH = '.claude/mods-logs/scratchpad-keeper'
export const INBOX_DIR = `${STORE_SUBPATH}/inbox`
// Where saved items go when the destination setting is empty. Under the Claude home folder, never a personal path.
export const DEFAULT_DEST_SUBPATH = '.claude/scratchpad-keeper/saved'
export const DEFAULT_MIN_BYTES = 400
export const DEFAULT_EXPIRE_DAYS = 14
// A file written this many times or more is probably work in progress: it waits until the session ends.
export const WIP_WRITES = 3
// Files above this are left alone (the copy would be read into memory).
export const MAX_FILE_BYTES = 2_000_000
// The ask lists at most this many items by name.
export const ASK_ITEMS = 8
export const MODEL = 'claude-haiku-5-5'
