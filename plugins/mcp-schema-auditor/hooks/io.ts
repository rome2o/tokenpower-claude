import type { EngineInterface } from 'claude-code'

import { MAX_LOG_LINES } from './constants.ts'
import { S } from './state.ts'

// The only write this mod makes: the newest error lines in ~/.claude/mods-logs/mcp-schema-auditor.log.
// The file holds the lines of this session only and replaces the file of an earlier session, because appending would need a read.
export async function log($: EngineInterface, text: string): Promise<void> {
  try {
    // No home under ~/.claude/ means no file is written.
    if (!S.home) return
    // Control characters become spaces and long token-like runs are cut out; the same line twice in a row is written once.
    const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[A-Za-z0-9_-]{24,}/g, '[cut]').slice(0, 300)
    if (clean === S.lastLog) return
    S.lastLog = clean
    const at = new Date(await $.clock.now()).toISOString()
    S.logLines = [...S.logLines, `${at} ${clean}`].slice(-MAX_LOG_LINES)
    await $.fs.write(`${S.home}/.claude/mods-logs/mcp-schema-auditor.log`, `${S.logLines.join('\n')}\n`)
  } catch {
    // Logging must never break the chat.
  }
}

export const msg = (err: unknown): string => String(err instanceof Error ? err.message : err)
