import type { EngineInterface } from 'claude-code'

import { tilde } from './io.ts'

// One saved file, found on disk under <destination>/<project folder>/.
export type SavedRow = { project: string; name: string; path: string; mtimeMs: number }

export const SAVED_CAP = 20

// Newest first, ties broken by path so the order never changes between runs.
export function newest(rows: SavedRow[], cap = SAVED_CAP): SavedRow[] {
  return [...rows].sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1)).slice(0, cap)
}

export function savedLine(r: SavedRow): string {
  const d = new Date(r.mtimeMs).toISOString()
  return `${d.slice(0, 10)} ${d.slice(11, 16)}  ${r.project}  ${tilde(r.path)}`
}

// The saved files are the source of truth, so a file you moved or deleted drops off the list on its own.
// Only the two levels the mod writes are read: project folders, then the files in them.
export async function listSaved($: EngineInterface, dest: string): Promise<SavedRow[]> {
  const rows: SavedRow[] = []
  let dirs: Awaited<ReturnType<typeof $.fs.list>> = []
  try {
    dirs = await $.fs.list(dest)
  } catch {
    return rows
  }
  for (const d of dirs) {
    if (d.kind !== 'dir' || d.name.startsWith('.')) continue
    try {
      for (const f of await $.fs.list(`${dest}/${d.name}`)) {
        // _keeper-index.jsonl is this mod's own index, not a saved document.
        if (f.kind === 'file' && !f.name.startsWith('.') && !f.name.startsWith('_keeper-')) rows.push({ project: d.name, name: f.name, path: `${dest}/${d.name}/${f.name}`, mtimeMs: f.mtimeMs })
      }
    } catch {
      // An unreadable project folder is left out.
    }
  }
  return rows
}
