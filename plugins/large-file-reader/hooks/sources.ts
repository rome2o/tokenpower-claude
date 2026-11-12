import type { EngineInterface } from 'claude-code'
import { FS_MAX, MAX_CHARS, NAME, PDF_TOOLS, READ_PAGE_CAP, SMALL_RANGE, ZOOM_PAGES } from './constants.ts'
import { chunk, cut, fit, toLines } from './filebase.ts'
import type { Line, Source } from './filebase.ts'
import { log } from './ledger.ts'
import { S } from './state.ts'
import { baseName, fmt, hash, slug, tokens } from './text.ts'

// null: binary content, let core answer.
export async function textSource($: EngineInterface, path: string, bytes: number): Promise<Source | null> {
  let lines: Line[]
  let gap = ''
  let total: number
  if (bytes <= FS_MAX) {
    const text = String(await $.fs.read(path))
    if (text.includes('\u0000')) return null
    const all = toLines(text, 1)
    total = all.length
    const fitted = fit(all)
    lines = fitted.kept
    gap = fitted.gap
  } else {
    const half = String(MAX_CHARS / 2)
    const [head, tail, wc] = await Promise.all([
      $.process.run(['/usr/bin/head', '-c', half, path], { timeoutMs: 30_000 }),
      $.process.run(['/usr/bin/tail', '-c', half, path], { timeoutMs: 30_000 }),
      $.process.run(['/usr/bin/wc', '-l', path], { timeoutMs: 30_000 }),
    ])
    if (head.stdout.includes('\u0000')) return null
    total = Number.parseInt(wc.stdout.trim(), 10) || 0
    // The byte cuts land mid-line: drop the head's last line and the tail's first.
    const headLines = toLines(head.stdout, 1).slice(0, -1)
    const tailRaw = toLines(tail.stdout, 1).slice(1)
    const tailFrom = Math.max(headLines.length + 1, total - tailRaw.length + 1)
    lines = [...headLines, ...tailRaw.map((l, i) => ({ n: tailFrom + i, text: l.text }))]
    gap = `The helper skipped lines ${fmt(headLines.length + 1)}-${fmt(tailFrom - 1)} (the file is ${fmt(Math.round(bytes / 1_000_000))} MB).`
  }
  return {
    path,
    kind: 'text',
    about: gap
      ? `Text file, ${fmt(total)} lines. ${gap} Refs like L120-L140 are line numbers in the real file.`
      : `Text file, ${fmt(total)} lines. Haiku read all ${fmt(total)} lines. Refs like L120-L140 are line numbers in the real file.`,
    covers: gap ? 'These notes cover every line Haiku read' : 'These notes cover the whole file',
    exact: `Read exact lines of ${path} (offset and limit, for example offset 120, limit 40) only when you must quote exact text, or right before you Edit or Write this file${gap ? ', or for the lines Haiku skipped' : ''}. A range ${SMALL_RANGE}, passes through as exact text.`,
    full: path,
    chunks: chunk(lines),
  }
}

async function bin($: EngineInterface, name: string) {
  for (const dir of PDF_TOOLS) {
    if (await $.fs.exists(`${dir}/${name}`).catch(() => false)) return `${dir}/${name}`
  }
  return null
}

export function parsePages(arg: string | undefined, total: number): { first: number; last: number } | null {
  if (arg === undefined || arg.trim() === '') return { first: 1, last: total }
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)?)?\s*$/.exec(arg)
  if (!m) return null
  const first = Math.max(1, Number(m[1]))
  const last = Math.min(total, m[2] !== undefined ? Number(m[2]) : arg.includes('-') ? total : first)
  return first <= last ? { first, last } : null
}

// null: let the Read through to core (a zoom-in, no text layer, no pdftotext, a bad pages value).
export async function pdfSource($: EngineInterface, path: string, pagesArg: string | undefined, mtime: number) {
  const info = await bin($, 'pdfinfo')
  const totext = await bin($, 'pdftotext')
  if (!info || !totext) {
    await log($, 'file', 'pass', `no pdftotext or pdfinfo for ${path}`)
    return null
  }
  const meta = await $.process.run([info, path], { timeoutMs: 30_000 })
  const total = Number(/^Pages:\s+(\d+)/m.exec(meta.stdout)?.[1] ?? 0)
  if (meta.exitCode !== 0 || total === 0) {
    await log($, 'file', 'pass', `pdfinfo gave no page count for ${path} (exit ${meta.exitCode}): ${meta.stderr.slice(0, 200)}`)
    return null
  }
  const range = parsePages(pagesArg, total)
  if (!range) {
    await log($, 'file', 'pass', `pages "${pagesArg}" not understood for ${path} (${total} pages)`)
    return null
  }
  const count = range.last - range.first + 1
  if (count <= ZOOM_PAGES) return null
  const ran = await $.process.run([totext, '-f', String(range.first), '-l', String(range.last), '-enc', 'UTF-8', path, '-'], {
    timeoutMs: 120_000,
  })
  if (ran.exitCode !== 0) {
    await log($, 'file', 'pass', `pdftotext failed for ${path}: ${ran.stderr.slice(0, 200)}`)
    return null
  }
  const pages = ran.stdout.split('\f')
  if (pages.length > 0 && pages[pages.length - 1]!.trim() === '') pages.pop()
  const chars = pages.reduce((s, p) => s + p.trim().length, 0)
  // A scanned PDF has no text layer: core's page images are the only way in.
  if (chars < 100 * count) {
    await log($, 'file', 'pass', `little text in ${path} (${chars} chars, ${count} pages)`)
    return null
  }
  const out: Line[] = []
  let n = 1
  let before = 0
  pages.forEach((page, i) => {
    const no = range.first + i
    if (i < READ_PAGE_CAP) before += tokens(page)
    out.push({ n: n++, text: `=== Page ${no} ===`, page: no })
    let blank = 0
    for (const raw of page.split('\n')) {
      const text = raw.replace(/[ \t]+/g, ' ').trimEnd()
      blank = text === '' ? blank + 1 : 0
      if (blank > 1) continue
      out.push({ n: n++, text: cut(text), page: no })
    }
  })
  const sidecar = `${S.home}/.claude/mods-logs/${NAME}/text/${slug(path)}-p${range.first}-${range.last}-${hash(`${path}|${mtime}`)}.txt`
  const wrote = await $.fs
    .write(sidecar, `${out.map(l => l.text).join('\n')}\n`)
    .then(() => true)
    .catch(() => false)
  const fitted = fit(out)
  const where = wrote ? ` The text was pulled with pdftotext into ${sidecar} (${fmt(out.length)} lines).` : ''
  const src: Source = {
    path,
    kind: 'pdf',
    about: `PDF, pages ${range.first}-${range.last} of ${total}.${where}${fitted.gap ? ` ${fitted.gap}` : ''} Refs: p.12 is the PDF page${wrote ? ', L340 is the line in that text file' : ''}.`,
    covers: fitted.gap ? 'These notes cover every line Haiku read' : `These notes cover pages ${range.first}-${range.last}`,
    exact: wrote
      ? `Read exact text only when you must quote it: Read ${sidecar} with offset and limit, or Read ${path} with pages (${ZOOM_PAGES} pages or fewer pass through untouched).`
      : `Read exact text only when you must quote it: Read ${path} with pages (${ZOOM_PAGES} pages or fewer pass through untouched).`,
    full: wrote ? sidecar : path,
    chunks: chunk(fitted.kept),
  }
  // Over 20 pages a plain Read errors and gives no text, so `before` is a model: one 20-page Read.
  const label =
    count > READ_PAGE_CAP
      ? `${baseName(path)} (plain Read errors on ${count} pages; before = one ${READ_PAGE_CAP}-page Read)`
      : `${baseName(path)} (${count}-page PDF, before = its text)`
  return { src, before, label }
}
