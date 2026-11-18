// Pure: no engine import. Builds the "where did this come from" header for saved files.
import { cleanLine, redact } from './guards.ts'

export type Source = 'subagent-report' | 'scratchpad-file' | 'session-notes'

export type Origin = {
  project: string
  projectPath: string
  sid: string
  saved: string
  source: Source
  originalName: string
}

// The short session id, the same shape as the inbox folder name.
export const shortSid = (sid: string) => sid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'nosid'

// One clean line: control characters removed, masked, and the home folder shown as ~.
function clean(v: string, home: string): string {
  let t = redact(cleanLine(v, 300))
  if (home) t = t.split(home).join('~')
  return t
}

export function originFields(o: Origin, home: string, savedFile?: string): [string, string][] {
  const rows: [string, string][] = [
    ['saved-by', 'scratchpad-keeper'],
    ['project', o.project],
    ['project-path', o.projectPath || 'unknown'],
    ['session', shortSid(o.sid)],
    ['saved', o.saved],
    ['source', o.source],
    ['original-name', o.originalName],
  ]
  if (savedFile !== undefined) rows.push(['saved-file', savedFile])
  return rows.map(([k, v]) => [k, clean(v, home)])
}

// A JSON string is also a valid YAML double-quoted string.
const yamlLine = ([k, v]: [string, string]) => `${k}: ${JSON.stringify(v)}`

// Prepends the header. If the text already starts with a closed frontmatter block, the missing keys are added
// inside it and existing keys are left alone. An unclosed block counts as plain text and is wrapped.
export function withFrontmatter(text: string, fields: [string, string][]): string {
  const open = /^---[ \t]*\r?\n/.exec(text)
  if (open) {
    const rest = text.slice(open[0].length)
    const close = /^---[ \t]*\r?$/m.exec(rest)
    if (close) {
      const block = rest.slice(0, close.index)
      const have = new Set([...block.matchAll(/^([A-Za-z0-9_-]+)[ \t]*:/gm)].map(x => x[1]))
      const add = fields.filter(([k]) => !have.has(k)).map(yamlLine)
      if (add.length === 0) return text
      return `${open[0]}${block}${add.join('\n')}\n${rest.slice(close.index)}`
    }
  }
  return `---\n${fields.map(yamlLine).join('\n')}\n---\n\n${text}`
}

export const indexLine = (fields: [string, string][]) => `${JSON.stringify(Object.fromEntries(fields))}\n`
