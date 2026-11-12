/** One always-loaded item, as the engine sizes it. */
export type Item = {
  kind: 'memory' | 'skill' | 'agent'
  /** A cleaned name, or a cleaned path with ~ only. For a credential-like file it is a fixed text. */
  label: string
  /** Memory type, skill source or plugin name, agent source. Cleaned. */
  source: string
  tokens: number
  /** True for a credential-like path: no path or name is kept. */
  secret: boolean
  /** The full cleaned name (a memory file's file name), used only to group duplicates. Never drawn. */
  key: string
}

/** One thing worth a look. Wording never tells the person to delete. */
export type Flag = {
  kind: 'big' | 'dup'
  label: string
  text: string
  tokens: number
}

export type Totals = {
  memory: number
  memoryCount: number
  skills: number
  skillCount: number
  commands: number
  commandCount: number
  agents: number
  agentCount: number
}

export type Audit = {
  /** False when the engine gave no breakdown: the pane stays inert. */
  supported: boolean
  /** True when reading the breakdown failed: the pane points at the log. */
  failed: boolean
  /** Memory files, skills and agents, biggest first, capped for display. */
  memory: Item[]
  skills: Item[]
  agents: Item[]
  flags: Flag[]
  /** Flags dropped by the display cap. */
  moreFlags: number
  totals: Totals
  /** True when the engine reported a skills or slash commands section. */
  hasSkills: boolean
  hasCommands: boolean
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-bloat-auditor': {
      audit: Shaped<Audit | null>
    }
  }
}
