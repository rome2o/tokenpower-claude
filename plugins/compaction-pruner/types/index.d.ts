export type Mode = 'off' | 'dry' | 'live'

/** What the pane draws: a title and plain text lines. */
export type View = {
  title: string
  lines: string[]
}

export type ReportItem = {
  tool: string
  /** Estimated tokens (characters / 4) of the result before it is shortened. */
  tokens: number
  rule: 'R1' | 'R2' | 'R3' | 'R4'
}

/** The last compaction this chat looked at. It holds names and sizes only, never tool text. */
export type Report = {
  at: number
  mode: 'dry' | 'live'
  trigger: string
  items: ReportItem[]
  tokens: number
  ids: string[]
  folder: string
  failed: number
  /** Results left as they were because one compaction reached its count, size or time limit. */
  skipped: number
}

declare module 'claude-code' {
  interface PluginState {
    'compaction-pruner': {
      view: Shaped<View>
    }
  }
}
