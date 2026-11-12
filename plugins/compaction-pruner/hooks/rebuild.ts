import { HEAD_CHARS, STUB_MARK } from './limits.ts'
import { cutAt, redact } from './guards.ts'
import { estTokens } from './rules.ts'
import type { Msg } from './shape.ts'

// Pure: messages plus the stubs to put in, out comes the new list. Only the text of a tool result
// changes. No message is removed and no call or result is removed, so pairing and role order stay.

// The head of the original (secrets masked) plus one fixed line. The head is tool text; the line holds
// only a store path and an id this mod made, so text inside a tool result cannot become part of it.
// `safe` is the masked text when the caller already has it, so the masking runs once per result.
export function makeStub(original: string, shownPath: string, id: string, safe: string = redact(original)): string {
  const head = cutAt(safe, HEAD_CHARS)
  const masked = safe !== original
  return `${head}\n${STUB_MARK}, original: ${shownPath}, id: ${id}]${masked ? ' (secrets masked)' : ''}`
}

export type Rebuilt =
  | { ok: true; messages: Msg[]; trimmed: number; before: number; after: number }
  | { ok: false; reason: string }

export function rebuild(messages: readonly Msg[], stubs: ReadonlyMap<string, string>): Rebuilt {
  const out: Msg[] = []
  const done = new Set<string>()
  let before = 0
  let after = 0
  for (const m of messages) {
    const rs = m.toolResults
    if (m.role !== 'user' || !rs || !rs.some(r => stubs.has(r.tool_use_id))) {
      out.push(m)
      continue
    }
    // A new object with no `handle`: the engine reads it as built, so the trim stands.
    const next: Msg = {
      role: m.role,
      text: m.text,
      toolUses: m.toolUses,
      toolResults: rs.map(r => {
        const stub = stubs.get(r.tool_use_id)
        if (stub === undefined) return r
        done.add(r.tool_use_id)
        before += estTokens(r.text)
        after += estTokens(stub)
        return { tool_use_id: r.tool_use_id, text: stub, isError: r.isError }
      }),
    }
    out.push(next)
  }
  if (done.size !== stubs.size) return { ok: false, reason: 'a stub had no result to go into' }
  const check = checkPairs(messages, out)
  return check.ok ? { ok: true, messages: out, trimmed: done.size, before, after } : check
}

function ids(list: readonly Msg[], key: 'toolUses' | 'toolResults'): string[] {
  const found: string[] = []
  for (const m of list) for (const x of m[key] ?? []) found.push(x.tool_use_id)
  return found
}

// Count, role order, pairing and handles of the new list against the old one.
export function checkPairs(before: readonly Msg[], after: readonly Msg[]): { ok: true } | { ok: false; reason: string } {
  if (before.length !== after.length) return { ok: false, reason: 'message count changed' }
  for (const [i, a] of after.entries()) {
    const b = before[i]
    if (!b || a.role !== b.role) return { ok: false, reason: 'role order changed' }
    if (a !== b && a.handle !== undefined) return { ok: false, reason: 'an edited message kept its handle' }
  }
  const useIds = ids(after, 'toolUses')
  const resIds = ids(after, 'toolResults')
  if (new Set(useIds).size !== useIds.length || new Set(resIds).size !== resIds.length) return { ok: false, reason: 'duplicate id' }
  // The same calls and the same results as before, so every pair that stood still stands.
  if (JSON.stringify(ids(before, 'toolUses')) !== JSON.stringify(useIds) || JSON.stringify(ids(before, 'toolResults')) !== JSON.stringify(resIds)) {
    return { ok: false, reason: 'a call or result was added, removed or moved' }
  }
  for (const [i, a] of after.entries()) {
    const b = before[i]
    if (b && a.toolUses !== b.toolUses) return { ok: false, reason: 'a message lost its calls' }
  }
  return { ok: true }
}
