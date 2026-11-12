/** One category of the context window, as the band draws it. */
export type MeterCat = {
  name: string
  tokens: number
}

/** Tokens the other mods saved today: a number, nothing to show, or a ledger too big to read here. */
export type MeterSaved = { kind: 'none' } | { kind: 'big' } | { kind: 'ok'; tokens: number }

/** What the band above the prompt draws. The token figures are estimates. */
export type Meter = {
  /** Categories filling the window now, names cleaned. */
  used: MeterCat[]
  /** Tokens kept back as a compaction buffer. */
  buffer: number
  total: number
  window: number
  /** Claude's own percentage of the window. */
  percent: number
  /** Where auto-compact starts, null when Claude gave none. */
  threshold: number | null
  /** null when Claude did not say. */
  autoCompact: boolean | null
  /** False when there was no breakdown: one bar from the plain usage figures. */
  detailed: boolean
  /** This chat's cost as Claude reported it, null when absent. */
  costUsd: number | null
  saved: MeterSaved
}

declare module 'claude-code' {
  interface PluginState {
    'context-meter': {
      meter: Shaped<Meter | null>
    }
  }
}
