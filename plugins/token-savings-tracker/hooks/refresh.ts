import type { EngineInterface } from 'claude-code'

import type { Found, Scan } from './types.ts'
import { MAX_BYTES, PANE, SAMPLE_CHAT, SAMPLE_NOW, SCAN, TAIL_LINES } from './constants.ts'
import { S, scans, transcripts } from './state.ts'
import { localDay, parseScan, priceOf } from './pure.ts'
import { emptyTotals, parseRows, summarize, valueRow, wantedChats } from './ledger.ts'
import { ledgerPath, log, samplePath, setLedger, tilde } from './io.ts'

// Finds the wanted chats' files in ~/.claude/projects/<folder>/<session>.jsonl. A new session
// lists again at once; a session not found lists again after 5 minutes, never twice a minute.
export async function findTranscripts($: EngineInterface, want: string[], now: number) {
  const fresh = want.some(s => !transcripts.has(s))
  const lost = want.some(s => transcripts.get(s) === null)
  if (!fresh && !(lost && now - S.listedAt > 300_000)) return
  if (S.listedAt && now - S.listedAt < 60_000) return
  S.listedAt = now
  const base = `${S.home}/.claude/projects`
  try {
    for (const dir of await $.fs.list(base)) {
      if (dir.kind !== 'dir') continue
      let files: Awaited<ReturnType<typeof $.fs.list>> = []
      try {
        files = await $.fs.list(`${base}/${dir.name}`)
      } catch {
        continue
      }
      for (const f of files) {
        if (f.kind === 'file' && f.name.endsWith('.jsonl')) transcripts.set(f.name.slice(0, -6), `${base}/${dir.name}/${f.name}`)
      }
    }
  } catch (err) {
    await log($, `list chats failed: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`)
  }
  for (const s of want) if (!transcripts.has(s)) transcripts.set(s, null)
}

// Chat files are read only while the pane is drawn, so a closed pane in another chat costs nothing.
export async function paneUp($: EngineInterface) {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
  } catch {
    return false
  }
}

// True while a wanted chat is not found yet, or found and not read yet.
export function unread(want: string[]) {
  return want.some(s => {
    const path = transcripts.get(s)
    return path === undefined || (path !== null && !scans.has(path))
  })
}

// Scans each wanted chat whose file changed, newest first, at most once a minute per file.
// A failed scan is kept, so it waits a minute too. The first open has every chat to read
// (45 files took 9 s), so one call stops after 8 scans or 2 s; the next poll goes on.
export async function updateScans($: EngineInterface, want: string[], now: number): Promise<boolean> {
  let changed = false
  let done = 0
  const start = await $.clock.now()
  for (const s of want) {
    const path = transcripts.get(s)
    if (!path) continue
    let sig = ''
    try {
      const st = await $.fs.stat(path)
      sig = `${st.size}|${st.mtimeMs}`
    } catch {
      continue
    }
    const old = scans.get(path)
    if (old && (old.sig === sig || now - old.at < 60_000)) continue
    if (done >= 8 || (done > 0 && (await $.clock.now()) - start > 2000)) break
    let scan: Scan | null = null
    try {
      const r = await $.process.run(['/usr/bin/awk', SCAN, path], { timeoutMs: 60_000 })
      if (r.exitCode !== 0) throw new Error(`awk exited ${r.exitCode}: ${r.stderr.trim().slice(0, 200)}`)
      scan = parseScan(r.stdout)
    } catch (err) {
      await log($, `scan ${tilde(path)} failed: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`)
    }
    scans.set(path, { sig, at: now, scan })
    changed = true
    done += 1
  }
  return changed
}

export function foundFor(session: string): Found {
  if (S.sample) return 'no-chat'
  const path = transcripts.get(session)
  if (path === undefined) return 'reading'
  if (path === null) return 'no-chat'
  const s = scans.get(path)
  return s === undefined ? 'reading' : (s.scan ?? 'no-chat')
}

// Prices the last parsed rows with the scans read so far and draws them.
export async function publish($: EngineInterface) {
  if (!S.lastParse) return
  const { kept, skipped, dropped, ...base } = S.lastParse
  const priced = kept.map(r => valueRow(r, base.mainModel, foundFor(r.session)))
  const mainPrice = priceOf(base.mainModel, 0)?.in ?? null
  await setLedger($, { ...base, mainPrice, missing: false, error: '', skipped, dropped, ...summarize(priced, base.chatId, base.day) })
}

export async function refresh($: EngineInterface, force: boolean) {
  if (S.off || S.busy) return
  S.busy = true
  try {
    const path = S.sample ? samplePath() : ledgerPath()
    const now = S.sample ? SAMPLE_NOW : await $.clock.now()
    const chatId = S.sample ? SAMPLE_CHAT : S.sid
    const day = localDay(now)
    const price = priceOf(S.mainModel, 0)
    const mainPrice = price?.in ?? null
    const base = { path, sample: S.sample, chatId, day, mainPrice, mainModel: S.mainModel }
    let stat: { size: number; mtimeMs: number } | null = null
    try {
      stat = await $.fs.stat(path)
    } catch {
      stat = null
    }
    const sig = stat ? `${path}|${stat.size}|${stat.mtimeMs}|${day}|${chatId}|${S.mainModel}` : `${path}|missing|${day}`
    const dirty = force || sig !== S.lastSig
    if (!stat) {
      if (!dirty) return
      const none = emptyTotals()
      S.lastParse = null
      await setLedger($, { ...base, missing: true, error: '', rows: [], today: none, chat: none, all: none, skipped: 0, dropped: 0, partial: false })
      S.lastSig = sig
      return
    }
    if (dirty) {
      let text = ''
      let partial = false
      if (stat.size > MAX_BYTES) {
        const r = await $.process.run(['tail', '-n', String(TAIL_LINES), path])
        if (r.exitCode !== 0) throw new Error(`tail exited ${r.exitCode}: ${r.stderr.trim()}`)
        text = r.stdout
        partial = true
      } else {
        text = String(await $.fs.read(path))
      }
      S.lastParse = { path, sample: S.sample, chatId, day, mainModel: S.mainModel, partial, ...parseRows(text) }
      await publish($)
      S.lastSig = sig
      if (!S.sample) S.scanMore = S.scanMore || unread(wantedChats(S.lastParse.kept))
    }
    // /savings never waits for chat files: the 3 s poll reads them, a batch at a time, while the
    // pane is drawn. A chat file read once is checked again once a minute (it changes every turn).
    if (force || S.sample || !S.lastParse) return
    if (!S.scanMore && now - S.checkedAt < 60_000) return
    if (!(await paneUp($))) return
    S.checkedAt = now
    const want = wantedChats(S.lastParse.kept)
    await findTranscripts($, want, now)
    const changed = await updateScans($, want, now)
    S.scanMore = unread(want)
    if (changed) await publish($)
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err).slice(0, 300)
    await log($, `read ledger failed: ${message}`)
    const none = emptyTotals()
    await setLedger($, {
      path: S.sample ? samplePath() : ledgerPath(),
      sample: S.sample,
      chatId: S.sample ? SAMPLE_CHAT : S.sid,
      day: '',
      mainPrice: null,
      mainModel: S.mainModel,
      missing: false,
      error: message,
      rows: [],
      today: none,
      chat: none,
      all: none,
      skipped: 0,
      dropped: 0,
      partial: false,
    })
  } finally {
    S.busy = false
  }
}
