import { AGE_LINES, BASH_LIKE, MIN_TOKENS, PINNED_TOOLS, SCAN_CHARS, STUB_MARK, TAIL_PINNED } from './limits.ts'
import type { Candidate, Msg, Plan, Rule, ToolResult, ToolUse } from './shape.ts'

// Pure: messages in, the list of results the rules would shorten out. It holds no tool text.

export const estTokens = (s: string) => Math.ceil(s.length / 4)

// R4: most of the text is long base64 runs (a screenshot, an inline image, an encoded blob). One pass, no backtracking.
const BLOB_RUN = 300
function mostlyBlob(text: string): boolean {
  const s = text.length > SCAN_CHARS ? text.slice(0, SCAN_CHARS) : text
  let blob = 0
  let run = 0
  for (let i = 0; i <= s.length; i++) {
    const c = i < s.length ? s.charCodeAt(i) : 0
    const b64 = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 47 || c === 61
    if (b64) run++
    else {
      if (run >= BLOB_RUN) blob += run
      run = 0
    }
  }
  return blob * 2 >= s.length && blob > 0
}

type Pos = { idx: number; pos: number }
type Read = Pos & { tokens: number }
const earlier = (a: Pos, b: Pos) => a.idx < b.idx || (a.idx === b.idx && a.pos < b.pos)

function isMsg(m: unknown): m is Msg {
  if (!m || typeof m !== 'object') return false
  const x = m as Record<string, unknown>
  if ((x.role !== 'user' && x.role !== 'assistant') || typeof x.text !== 'string' || !Array.isArray(x.toolUses)) return false
  if (x.toolResults !== undefined && !Array.isArray(x.toolResults)) return false
  for (const u of x.toolUses as unknown[]) {
    const t = u as Record<string, unknown> | null
    if (!t || typeof t.tool_use_id !== 'string' || typeof t.tool !== 'string' || !t.input || typeof t.input !== 'object') return false
  }
  for (const r of (x.toolResults ?? []) as unknown[]) {
    const t = r as Record<string, unknown> | null
    if (!t || typeof t.tool_use_id !== 'string' || typeof t.text !== 'string' || typeof t.isError !== 'boolean') return false
  }
  return true
}

export function planCandidates(messages: readonly Msg[]): Plan {
  if (!Array.isArray(messages)) return { ok: false, reason: 'messages is not a list' }
  for (const m of messages) if (!isMsg(m)) return { ok: false, reason: 'unrecognised message shape' }
  const n = messages.length

  const uses = new Map<string, Pos & { use: ToolUse }>()
  const results = new Map<string, Pos & { res: ToolResult }>()
  for (const [idx, m] of messages.entries()) {
    for (const [pos, use] of m.toolUses.entries()) {
      if (uses.has(use.tool_use_id)) return { ok: false, reason: 'duplicate tool_use_id' }
      uses.set(use.tool_use_id, { idx, pos, use })
    }
    for (const [pos, res] of (m.toolResults ?? []).entries()) {
      if (results.has(res.tool_use_id)) return { ok: false, reason: 'duplicate tool_result id' }
      results.set(res.tool_use_id, { idx, pos, res })
    }
  }

  // Pinned messages: the first, the tail, and any message holding a call or result with no partner.
  const pinned = new Set<number>([0])
  for (let i = Math.max(0, n - TAIL_PINNED); i < n; i++) pinned.add(i)
  for (const [id, u] of uses) if (!results.has(id)) pinned.add(u.idx)
  for (const [id, r] of results) if (!uses.has(id)) pinned.add(r.idx)

  // R1: whole Reads by path (the later one must be about as large, so a short "unchanged" note never counts), and R2: the latest copy of each large Bash output.
  const wholeReads = new Map<string, Read[]>()
  const lastBash = new Map<string, Pos>()
  for (const [id, u] of uses) {
    const r = results.get(id)
    if (!r || r.res.isError || u.use.isError) continue
    if (u.use.tool === 'Read') {
      const path = u.use.input.file_path
      // A whole read has no other argument at all (no offset, limit or pages). Its result must be real content, not a stub.
      const only = Object.keys(u.use.input).filter(k => u.use.input[k] !== undefined && u.use.input[k] !== null)
      if (typeof path === 'string' && only.length === 1 && !r.res.text.includes(STUB_MARK)) {
        const list = wholeReads.get(path) ?? []
        list.push({ idx: u.idx, pos: u.pos, tokens: estTokens(r.res.text) })
        wholeReads.set(path, list)
      }
    }
  }
  for (const [idx, m] of messages.entries()) {
    for (const [pos, res] of (m.toolResults ?? []).entries()) {
      const u = uses.get(res.tool_use_id)
      if (u?.use.tool === 'Bash' && !res.isError && estTokens(res.text) >= MIN_TOKENS) lastBash.set(res.text, { idx, pos })
    }
  }

  const candidates: Candidate[] = []
  for (const [idx, m] of messages.entries()) {
    if (pinned.has(idx)) continue
    for (const [pos, res] of (m.toolResults ?? []).entries()) {
      const u = uses.get(res.tool_use_id)
      if (!u || pinned.has(u.idx)) continue
      const tool = u.use.tool
      if (PINNED_TOOLS.includes(tool) || res.isError || u.use.isError) continue
      if (res.text.includes(STUB_MARK)) continue
      const tokens = estTokens(res.text)
      if (tokens < MIN_TOKENS) continue

      let rule: Rule | null = null
      const path = u.use.input.file_path
      if (tool === 'Read' && typeof path === 'string' && (wholeReads.get(path) ?? []).some(p => earlier(u, p) && p.tokens * 2 >= tokens)) rule = 'R1'
      else if (tool === 'Bash') {
        const last = lastBash.get(res.text)
        if (last && earlier({ idx, pos }, last)) rule = 'R2'
      }
      if (!rule && BASH_LIKE.includes(tool) && idx < n - AGE_LINES) rule = 'R3'
      if (!rule && mostlyBlob(res.text)) rule = 'R4'
      if (rule) candidates.push({ id: res.tool_use_id, tool, rule, tokens, useIdx: u.idx, resIdx: idx })
    }
  }
  return { ok: true, candidates }
}
