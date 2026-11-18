import type { EngineInterface } from 'claude-code'

import { ASK_ITEMS, INBOX_DIR, MAX_FILE_BYTES } from './constants.ts'
import { cleanLine, hash8, isInside, redact, safeInboxPath, slug, stampOf } from './guards.ts'
import { ensureDir, log, tilde, toast } from './io.ts'
import { indexLine, originFields, withFrontmatter } from './provenance.ts'
import type { Origin } from './provenance.ts'
import { S } from './state.ts'
import { extOf, isExpired, triageFile } from './triage.ts'

// One inbox item: a file under the scratchpad, or a subagent report. The text is already masked.
export type Item = {
  id: string
  kind: 'agent' | 'file'
  title: string
  name: string
  source: string
  project: string
  projectPath?: string
  sid: string
  at: number
  size: number
  skipped: boolean
  skippedAt?: number
  text: string
}

export type Stored = { item: Item; path: string }

const inboxRoot = () => `${S.home}/${INBOX_DIR}`

function asItem(j: unknown): Item | null {
  const o = j as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const str = (k: string) => typeof o[k] === 'string'
  if (!str('id') || !str('title') || !str('name') || !str('text') || !str('project')) return null
  if ((o.kind !== 'agent' && o.kind !== 'file') || typeof o.at !== 'number' || typeof o.skipped !== 'boolean') return null
  return {
    id: o.id as string,
    kind: o.kind,
    title: o.title as string,
    name: o.name as string,
    source: typeof o.source === 'string' ? o.source : '',
    project: o.project as string,
    ...(typeof o.projectPath === 'string' ? { projectPath: o.projectPath } : {}),
    sid: typeof o.sid === 'string' ? o.sid : '',
    at: o.at,
    size: typeof o.size === 'number' ? o.size : (o.text as string).length,
    skipped: o.skipped,
    ...(typeof o.skippedAt === 'number' ? { skippedAt: o.skippedAt } : {}),
    text: o.text as string,
  }
}

export async function listInbox($: EngineInterface): Promise<Stored[]> {
  const out: Stored[] = []
  if (!S.home) return out
  let dirs: Awaited<ReturnType<typeof $.fs.list>> = []
  try {
    dirs = await $.fs.list(inboxRoot())
  } catch {
    return out
  }
  for (const d of dirs) {
    if (d.kind !== 'dir') continue
    let files: typeof dirs = []
    try {
      files = await $.fs.list(`${inboxRoot()}/${d.name}`)
    } catch {
      continue
    }
    for (const f of files) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      const path = `${inboxRoot()}/${d.name}/${f.name}`
      try {
        const item = asItem(JSON.parse(String(await $.fs.read(path))))
        if (item && safeInboxPath(path, S.home)) out.push({ item, path })
      } catch {
        // An unreadable item is left where it is.
      }
    }
  }
  return out
}

export async function addItem($: EngineInterface, item: Item): Promise<boolean> {
  const path = `${inboxRoot()}/${S.short}/${item.id}.json`
  if (!safeInboxPath(path, S.home)) return false
  try {
    if (await $.fs.exists(path)) return false
    await ensureDir($, `${inboxRoot()}/${S.short}`)
    await $.fs.write(path, JSON.stringify(item))
    return true
  } catch (err) {
    await log($, `could not add ${item.id}: ${String(err instanceof Error ? err.message : err)}`)
    return false
  }
}

async function removeItem($: EngineInterface, path: string) {
  if (!safeInboxPath(path, S.home)) return
  try {
    // $.fs has no delete. The path was checked to sit inside this mod's own inbox.
    await $.process.run(['/bin/rm', '-f', path], { timeoutMs: 5000 })
  } catch (err) {
    await log($, `could not remove an inbox item: ${String(err instanceof Error ? err.message : err)}`)
  }
}

export async function setSkipped($: EngineInterface, s: Stored) {
  try {
    await $.fs.write(s.path, JSON.stringify({ ...s.item, skipped: true, skippedAt: await $.clock.now() }))
  } catch (err) {
    await log($, `could not mark ${s.item.id} skipped: ${String(err instanceof Error ? err.message : err)}`)
  }
}

export async function expireOld($: EngineInterface, now: number): Promise<number> {
  let n = 0
  for (const s of await listInbox($)) {
    if (isExpired(s.item, now, S.settings.expireDays)) {
      await removeItem($, s.path)
      n++
    }
  }
  return n
}

// Writes one item to the destination and takes it out of the inbox. Returns the saved path, or '' on failure.
export async function saveItem($: EngineInterface, s: Stored, dest: string): Promise<string> {
  const it = s.item
  const dir = `${dest}/${slug(it.project)}`
  const dot = it.name.lastIndexOf('.')
  const stem = dot > 0 ? it.name.slice(0, dot) : it.name
  const ext = dot > 0 ? it.name.slice(dot) : ''
  try {
    let path = `${dir}/${it.name}`
    if (await $.fs.exists(path)) path = `${dir}/${stem}-${hash8(it.text)}${ext}`
    if (!isInside(path, dest)) return ''
    await ensureDir($, dir)
    const body = it.kind === 'agent' ? `# ${it.title}\n\nSaved from a subagent report on ${new Date(it.at).toISOString().slice(0, 10)}.\n\n${it.text}\n` : it.text
    const origin: Origin = { project: slug(it.project), projectPath: it.projectPath ?? '', sid: it.sid, saved: new Date(await $.clock.now()).toISOString(), source: it.kind === 'agent' ? 'subagent-report' : 'scratchpad-file', originalName: it.name }
    if (extOf(it.name) === 'md') await $.fs.write(path, withFrontmatter(body, originFields(origin, S.home)))
    else {
      // Other types are written unchanged: a header would corrupt them. The link lives in a JSON-lines index instead.
      await $.fs.write(path, body)
      const index = `${dir}/_keeper-index.jsonl`
      let old = ''
      try {
        old = String(await $.fs.read(index))
      } catch {
        old = ''
      }
      await $.fs.write(index, `${old}${indexLine(originFields(origin, S.home, path.slice(path.lastIndexOf('/') + 1)))}`)
    }
    await removeItem($, s.path)
    return path
  } catch (err) {
    await log($, `could not save ${it.id}: ${String(err instanceof Error ? err.message : err)}`)
    return ''
  }
}

export async function saveAll($: EngineInterface, list: Stored[], dest: string): Promise<{ saved: number; failed: number }> {
  let saved = 0
  let failed = 0
  for (const s of list) {
    if (await saveItem($, s, dest)) saved++
    else failed++
  }
  return { saved, failed }
}

export const describe = (it: Item) => `${cleanLine(it.title, 50)} (${it.kind === 'agent' ? 'subagent report' : extOf(it.name)}, ${it.size >= 1024 ? `${Math.round(it.size / 1024)} KB` : `${it.size} B`})`

export function askText(list: Stored[], dest: string): string {
  const shown = list.slice(0, ASK_ITEMS).map((s, i) => `${i + 1}. ${describe(s.item)}`)
  const more = list.length > ASK_ITEMS ? [`and ${list.length - ASK_ITEMS} more`] : []
  return `${list.length} item${list.length === 1 ? '' : 's'} worth keeping:\n${[...shown, ...more].join('\n')}\nSave to ${tilde(dest)}?`
}

export function agentItem(args: { agentId: string; title: string; answer: string; now: number }): Item {
  const text = redact(args.answer)
  const title = cleanLine(args.title, 60) || 'subagent report'
  return {
    id: `a-${hash8(args.agentId + text)}`,
    kind: 'agent',
    title,
    name: `agent-${slug(title, 30)}-${stampOf(args.now)}.md`,
    source: `agent ${args.agentId}`,
    project: S.project,
    projectPath: S.projectPath,
    sid: S.sid,
    at: args.now,
    size: args.answer.length,
    skipped: false,
    text,
  }
}

// Reads the tracked scratchpad files, applies the triage rules and adds the keepers to the inbox.
// While the session runs (final false) a file rewritten often waits; at the end every file is judged.
export async function gather($: EngineInterface, final: boolean, now: number): Promise<number> {
  let added = 0
  const rows: { path: string; size: number; writes: number }[] = []
  for (const [path, t] of S.tracked) {
    try {
      const st = await $.fs.stat(path)
      if (st.kind === 'file' && st.size <= MAX_FILE_BYTES) rows.push({ path, size: st.size, writes: t.writes })
      else if (final) S.tracked.delete(path)
    } catch {
      S.tracked.delete(path)
    }
  }
  const verdicts = rows.map(r => ({ r, v: triageFile(r, S.settings.minBytes) })).sort((a, b) => a.v.rank - b.v.rank)
  for (const { r, v } of verdicts) {
    if (!v.keep) {
      if (final) S.tracked.delete(r.path)
      continue
    }
    if (v.wip && !final) continue
    try {
      const text = redact(String(await $.fs.read(r.path)))
      const base = r.path.slice(r.path.lastIndexOf('/') + 1)
      const item: Item = {
        id: `f-${hash8(r.path + text)}`,
        kind: 'file',
        title: base,
        name: base,
        source: r.path,
        project: S.project,
        projectPath: S.projectPath,
        sid: S.sid,
        at: now,
        size: r.size,
        skipped: false,
        text,
      }
      if (await addItem($, item)) added++
      S.tracked.delete(r.path)
    } catch (err) {
      await log($, `could not read a tracked file: ${String(err instanceof Error ? err.message : err)}`)
    }
  }
  return added
}

export { toast }
