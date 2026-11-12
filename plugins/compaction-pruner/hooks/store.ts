import type { EngineInterface } from 'claude-code'

import { RETENTION_DAYS, STORE_SUBPATH } from './constants.ts'
import { hash8, isSafeStorePath, parseId, parseStamp } from './guards.ts'

// The store: where shortened text is kept and read back. Every write is checked first with
// isSafeStorePath. Nothing here deletes anything and nothing runs a command.

export const storeRoot = (home: string) => `${home}/${STORE_SUBPATH}`
export const tildeOf = (p: string, home: string) => (home && p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p)

export type Saved = { id: string; path: string; shown: string }

// Writes the (already masked) text. Returns null when the write did not happen: that item is then NOT shortened.
export async function saveOriginal($: EngineInterface, home: string, short: string, stamp: string, n: number, masked: string, original: string): Promise<Saved | null> {
  const hash = hash8(original)
  const path = `${storeRoot(home)}/${short}/${stamp}/${n}-${hash}.txt`
  if (!isSafeStorePath(path, home)) return null
  try {
    await $.fs.write(path, masked)
    return { id: `${short}-${n}-${hash}`, path, shown: tildeOf(path, home) }
  } catch {
    return null
  }
}

// One ledger line kept beside the saved text of its compaction. The shared savings ledger is not
// written from here: a true append needs a command, and a read and rewrite would drop other mods' lines.
export async function saveLedgerLine($: EngineInterface, home: string, short: string, stamp: string, line: string): Promise<boolean> {
  const path = `${storeRoot(home)}/${short}/${stamp}/ledger.jsonl`
  if (!isSafeStorePath(path, home)) return false
  try {
    await $.fs.write(path, `${line}\n`)
    return true
  } catch {
    return false
  }
}

export type Opened = { ok: true; shown: string; text: string } | { ok: false; why: string }

// Reads one saved file by id. The id is checked, the path is built from it, and the real path must stay in the store.
export async function openById($: EngineInterface, home: string, id: unknown): Promise<Opened> {
  const parsed = parseId(id)
  if (!parsed) return { ok: false, why: 'That is not an id this mod made. Ids look like abc12345-3-0a1b2c3d.' }
  if (!home) return { ok: false, why: 'The Claude home folder is not known, so nothing can be opened.' }
  const chatDir = `${storeRoot(home)}/${parsed.short}`
  if (!isSafeStorePath(`${chatDir}/x`, home)) return { ok: false, why: 'That id does not point into the store.' }
  try {
    if (!(await $.fs.exists(chatDir))) return { ok: false, why: 'No saved text for that id.' }
    // The real place of the store folder; the chat folder and the file must both resolve to somewhere under it.
    const realRoot = (await $.fs.stat(storeRoot(home), { resolve: true })).realPath
    const realChat = (await $.fs.stat(chatDir, { resolve: true })).realPath
    if (!realRoot || !realChat || !realChat.startsWith(`${realRoot}/`)) return { ok: false, why: 'The saved folder is not inside the store.' }
    const stamps = (await $.fs.list(chatDir)).filter(e => e.kind === 'dir' && parseStamp(e.name) !== null).map(e => e.name).sort().reverse()
    const file = `${parsed.n}-${parsed.hash}.txt`
    for (const stamp of stamps) {
      const dir = `${chatDir}/${stamp}`
      const entries = await $.fs.list(dir)
      if (!entries.some(e => e.kind === 'file' && e.name === file)) continue
      const path = `${dir}/${file}`
      if (!isSafeStorePath(path, home)) return { ok: false, why: 'That id does not point into the store.' }
      const st = await $.fs.stat(path, { resolve: true })
      if (st.kind !== 'file' || st.isLink || !st.realPath || !st.realPath.startsWith(`${realRoot}/`)) return { ok: false, why: 'The saved file is not a plain file inside the store.' }
      return { ok: true, shown: tildeOf(path, home), text: String(await $.fs.read(path)) }
    }
    return { ok: false, why: 'No saved text for that id.' }
  } catch (err) {
    return { ok: false, why: `Could not read it: ${String(err instanceof Error ? err.message : err).slice(0, 120)}` }
  }
}

export type OldFolder = { shown: string; ageDays: number }
export type OldScan = { old: OldFolder[]; chats: number; unreadable: number }

// Lists chat folders whose newest compaction is over RETENTION_DAYS old, so the person can clear them
// by hand. A folder with no timestamped compaction inside is judged by its own modified time.
export async function listOld($: EngineInterface, home: string, now: number): Promise<OldScan> {
  const scan: OldScan = { old: [], chats: 0, unreadable: 0 }
  if (!home) return scan
  const root = storeRoot(home)
  try {
    if (!(await $.fs.exists(root))) return scan
    for (const e of await $.fs.list(root)) {
      if (e.kind !== 'dir' || !/^[a-z0-9-]{1,40}$/.test(e.name)) continue
      scan.chats++
      const dir = `${root}/${e.name}`
      try {
        let newest = -Infinity
        for (const s of await $.fs.list(dir)) {
          const t = s.kind === 'dir' ? parseStamp(s.name) : null
          if (t !== null && t > newest) newest = t
        }
        if (newest === -Infinity) newest = (await $.fs.stat(dir)).mtimeMs
        const ageDays = (now - newest) / 86_400_000
        if (ageDays >= RETENTION_DAYS) scan.old.push({ shown: tildeOf(dir, home), ageDays: Math.floor(ageDays) })
      } catch {
        scan.unreadable++
      }
    }
  } catch {
    scan.unreadable++
  }
  scan.old.sort((a, b) => b.ageDays - a.ageDays)
  return scan
}
