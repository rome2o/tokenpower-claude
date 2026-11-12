// The message shapes this mod reads, written out so the pure modules need no engine import.
// They mirror the engine's SessionMessage, ToolUseSummary and ToolResultSummary.
export type ToolUse = {
  tool_use_id: string
  tool: string
  input: Record<string, unknown>
  result?: unknown
  text?: string
  isError?: true
}

export type ToolResult = {
  tool_use_id: string
  text: string
  isError: boolean
  result?: unknown
}

export type Msg = {
  role: 'user' | 'assistant'
  text: string
  toolUses: ToolUse[]
  toolResults?: ToolResult[]
  handle?: string
}

export type Rule = 'R1' | 'R2' | 'R3' | 'R4'

/** One tool result the rules would shorten. It holds no tool text. */
export type Candidate = {
  id: string
  tool: string
  rule: Rule
  tokens: number
  useIdx: number
  resIdx: number
}

export type Plan = { ok: true; candidates: Candidate[] } | { ok: false; reason: string }
