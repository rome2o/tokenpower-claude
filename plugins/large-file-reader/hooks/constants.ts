import type { CardPart } from '../types'

export const NAME = 'large-file-reader'
export const TITLE = 'Large File Reader'
export type Part = CardPart
export const PARTS: readonly Part[] = ['file', 'connector']

export const MODEL = 'claude-haiku-5-5'
export const MODEL_ALIAS = 'haiku'
// Every Haiku request stays under 100k tokens, Haiku's cheap tier. JSON and logs run about 2 characters a
// token, not 4 (Connector Reader sent 260k characters and Haiku counted 107,756 tokens), so a request is
// kept under this many characters.
const PROMPT_MAX_CHARS = 150_000

// ---------- file part ----------
// A file read (whole or a range) or a shell read whose result is over this many tokens gets notes (v0.3: was 8,000).
export const MIN_TOKENS = 2000
// Guard A, the edit escape: a ranged Read of fewer lines than this always passes as exact text, so Edit works.
export const EDIT_LINES = 100
// How a short exact range is described to Claude. It must also be under the token limit, so long-line files need a
// smaller limit.
export const SMALL_RANGE = `under ${EDIT_LINES} lines and under about ${MIN_TOKENS.toLocaleString('en-US')} tokens; if the lines are long, use a smaller limit, for example 10`
// Guard D, the piece counter: once the raw pieces of one file Claude has pulled in pass this share of it, the next
// piece gets the file's notes instead.
export const COVER_SHARE = 0.5
// A PDF read of this many pages or fewer passes through: Claude zooming in after the notes.
export const ZOOM_PAGES = 5
// Read takes at most 20 PDF pages per call, so `before` counts at most that many.
export const READ_PAGE_CAP = 20
// Core's default line count for a Read with an offset and no limit.
export const READ_LINES = 2000
// What the helper reads per call, and in all. Longer files get their head and tail read.
export const CHUNK_CHARS = 120_000
export const MAX_CHARS = 960_000
// Longer lines are cut, as core's Read cuts them (transcripts often have 1,000 to 1,300 character lines).
export const LINE_CHARS = 2000
// $.fs.read stops at 4 MiB; bigger files are read with head and tail.
export const FS_MAX = 3_900_000
export const NOTE_WORDS = 1500
export const CALL_MS = 180_000
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'ico', 'avif'])
export const PDF_TOOLS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

// ---------- connector part ----------
// Under this size a result passes on untouched (about 4k tokens).
export const MIN_CHARS = 16_000
// A trimmed result this small goes to Claude as it is, with no helper call (about 2k tokens).
export const TRIM_ENOUGH_CHARS = 8_000
// A trim-only reply may cut text values past this many characters, but only when the cut removes at most
// CUT_SHARE of the trimmed result. Past that the content lives in the long text, so Haiku reads it whole.
export const STRING_CAP = 1_200
export const CUT_SHARE = 0.2
// One helper call reads at most this much of the result; the task context and rules fit in the rest of
// PROMPT_MAX_CHARS. A result past it is split by records.
export const DATA_CHUNK_CHARS = 128_000
export const MAX_CHUNKS = 6
export const HELPER_MAX_TOKENS = 8_000
// The person's request goes to Haiku whole up to this size, cut from the middle past it. Claude's words before
// the call, and a tool's arguments, are cut at PROMPT_CHARS.
export const REQUEST_CHARS = 12_000
export const PROMPT_CHARS = 2_000
// $.fs.read refuses a file over 4 MiB.
export const FILE_READ_MAX = 4_000_000

// Tools whose exact output the next step depends on (page refs, the app's own tools, other mods' tools).
export const SKIP_SERVER =
  /^mcp__(ccd_[a-z_]+|helper-desk|chat-relay|handoff|plugin-authoring|mods|Claude_Browser|claude-in-chrome|Control_Chrome|computer-use|playwright|Claude_Code_iOS_Simulator|terminal|visualize|scheduled-tasks|mcp-registry)__/
export const SKIP_TOOL = /__(read_page|find|screenshot|show_widget|read_widget_context|render-ui|read_me|create_view|guide)$/i

// Fields almost no task reads: pictures, styling, and html or rich-text copies of a plain field.
export const DROP_KEY =
  /^(avatar|avatar_url|.+_avatar_url|avatar_.+|image_url|.+_image_url|thumbnail|thumbnail_url|.+_thumbnail_url|icon|icon_url|.+_icon_url|cover_image(_url)?|banner(_url)?|logo_url|html|.+_html|html_.+|rich_text|rich_text_.+|.+_rich_text|tiptap_.+|.+_tiptap_.+|body_for_editor|__typename|etag|_links|_meta|color|.+_color|emoji|display_format|display_locations|placeholder)$/i

// Paging and count fields. Code copies them into the reply word for word, so nobody has to work out
// "page X of Y" (Haiku once wrote "Page 1 of 5" for page_count: 5, the number of records on the page).
export const PAGING_KEY =
  /^(page|page_number|current_page|per_page|page_size|page_count|pages|total_pages|count|total|total_count|has_more|has_next|has_next_page|next_page|next_page_token|next_cursor|cursor|offset|limit)$/i
export const PAGING_HOLDER = /^(meta|pagination|paging|page_info|pageInfo)$/

// The note core gives in place of a result over its MCP token cap, and the one for any result over 100k characters.
export const CORE_NOTE = /Output has been saved to (\/[^\n]+?)\.?\s*(?:\n|$)/
export const PERSISTED_NOTE = /Full output saved to: (\/\S+)/
export const OVER_CAP = 'exceeds maximum allowed tokens'
// A note is short. A result longer than this is data, even when it quotes a note.
export const NOTE_MAX = 12_000

// ---------- pane ----------
export const PANE = 'haiku'
export const PANE_TITLE = 'Haiku hand-offs'
export const CARDS_MAX = 30
export const CARDS_ALL = 150
// Notes kept per card, and drawn when one is open (one drawing draws at most 100,000 characters).
export const CARD_NOTES_MAX = 40_000
export const DRAW_NOTES_MAX = 20_000
// The Haiku colour: a mid teal that reads on white and on a dark pane.
export const HAIKU = '#139c8a'
export const HAIKU_DARK = '#0b5a4f'
export const GOOD = '#22a55b'
export const BAD = '#e5484d'
// A ranged Read of a file with notes this many lines or more gets a one-line reminder; exact reads stay quiet.
export const REMIND_LINES = 150
// A big input left alone gets a "pass" line in the log, with the reason, from this size up.
export const PASS_LOG_TOKENS = MIN_TOKENS / 2
// Bash: output over this many characters (about MIN_TOKENS tokens), or output core saved to a file, gets notes.
export const BASH_MIN_CHARS = MIN_TOKENS * 4
// Bash commands whose output is file or API content. Every program in the command must be a reader or a
// helper, and at least one a reader; anything else (git, npm, test runners, builds, find, ls, diff) passes.
export const READERS = new Set(['cat', 'head', 'tail', 'sed', 'awk', 'gawk', 'less', 'more', 'nl', 'tac', 'jq', 'yq', 'curl', 'wget', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'zcat', 'gzcat', 'bzcat', 'xzcat', 'strings', 'pdftotext', 'textutil', 'xmllint', 'bat'])
export const HELPERS = new Set(['cd', 'sort', 'uniq', 'cut', 'tr', 'column', 'fold', 'expand', 'iconv', 'wc', 'echo', 'printf', 'true', 'false', 'ls', 'find', 'du', 'stat', 'file', 'realpath', 'readlink', 'basename', 'dirname', 'pwd', 'date', 'sleep', 'seq', 'test', '[', 'set', 'unset', 'which', 'type', '.', 'source', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'ln', 'chmod', 'read'])
// Words in front of the real program: sudo, xargs, shell keywords. Their flags are skipped too.
export const STARTERS = new Set(['sudo', 'time', 'env', 'command', 'nice', 'exec', 'xargs', 'export', 'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '('])
// Steps that are only shell structure: a loop head, a closing word, a comment.
export const STRUCTURE = new Set(['for', 'case', 'done', 'fi', 'esac', '}', ')', ';;'])
// Flags of a starter that take a value: sudo -u root, xargs -I {}, xargs -n 1, nice -n 10, env -u NAME.
export const FLAG_VALUE = new Set(['-u', '-n', '-I', '-P', '-L', '-d', '-s'])
