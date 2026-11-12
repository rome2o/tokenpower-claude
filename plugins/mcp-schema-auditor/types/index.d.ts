/** One MCP server: its tool schemas split by whether they are inside the window now. */
export type ServerRow = {
  /** Cleaned server name, or "(unknown)". */
  server: string
  /** Estimated tokens of the tool schemas that are in the window. */
  loaded: number
  /** Estimated tokens of the tool schemas that load on demand and are not in the window. */
  deferred: number
  /** Tools of this server, loaded or not. */
  count: number
  /** True for tools that name no usable server. Never suggested. */
  unknown?: boolean
  /** True for the one row that sums the servers past the distinct server cap. Never suggested. */
  other?: boolean
}

/** A server worth disabling. The wording is a fixed template drawn at render time. */
export type Suggestion = {
  server: string
  loaded: number
}

export type Rows = {
  /** waiting: nothing read yet. unsupported: this Claude version gave no MCP sizes. empty: no MCP tools. ok: rows below. */
  status: 'waiting' | 'unsupported' | 'empty' | 'ok'
  /** The biggest servers only, at most 10. */
  servers: ServerRow[]
  suggestions: Suggestion[]
  /** Loaded tokens over all servers. Deferred tokens are never in this figure. */
  totalLoaded: number
  totalDeferred: number
  /** Servers past the top rows, and their loaded and deferred tokens. Totals above include them. */
  moreServers: number
  moreLoaded: number
  moreDeferred: number
  /** The compaction window the breakdown is measured against, 0 when unknown. */
  window: number
  /** When these rows were read, in ms. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'mcp-schema-auditor': {
      rows: Shaped<Rows>
    }
  }
}
