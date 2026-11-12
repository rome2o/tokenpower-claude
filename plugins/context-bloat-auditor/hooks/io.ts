import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Audit } from '../types'

import { clean } from './guards.ts'
import { logLines, S } from './state.ts'

const MAX_LOG = 50
// The atom is declared in the file that reads and writes it, so the engine's scan can see its plugin and key.
const auditAtom = atom({ plugin: 'context-bloat-auditor', key: 'audit' } as const, null, { shape: 'audit-2' })

// Errors go to ~/.claude/mods-logs/context-bloat-auditor.log, so a failure is never silent.
// The file is rewritten from the newest lines kept in memory (this mod never reads a file back), so it holds the current session only.
// Nothing is written unless the plugin root sits under a .claude folder, so the log can never land elsewhere.
export async function log($: EngineInterface, text: string) {
  try {
    if (S.home === '') return
    const at = new Date(await $.clock.now()).toISOString()
    // One line, key shapes masked, the home folder shown as ~, capped.
    logLines.push(`${at} ${clean(text.split(S.home).join('~'), 200)}`)
    if (logLines.length > MAX_LOG) logLines.splice(0, logLines.length - MAX_LOG)
    await $.fs.write(`${S.home}/.claude/mods-logs/context-bloat-auditor.log`, `${logLines.join('\n')}\n`)
  } catch {
    // Logging must never break the pane.
  }
}

export const msg = (err: unknown) => String(err instanceof Error ? err.message : err)

export async function setAudit($: EngineInterface, value: Audit | null) {
  await update($, auditAtom, () => value)
}

export async function getAudit($: EngineInterface) {
  return read($, auditAtom)
}
