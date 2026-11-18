import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../hooks/register.ts'
import { openArgv } from '../hooks/io.ts'
import { panelModel } from '../hooks/pane.ts'

const HOME = '/home/u'
const DEFAULT_DEST = `${HOME}/.claude/scratchpad-keeper/saved`
const INBOX = `${HOME}/.claude/mods-logs/scratchpad-keeper/inbox/abcd1234`

// A small in-memory engine: files with modified times, and a record of every process the mod runs.
function setup({ platform = 'macos', isHosted = false, runFails = false, noInfo = false, options = {} } = {}) {
  const files = new Map()
  const handlers = {}
  const runs = []
  const toasts = []
  const invalidated = []
  const $ = {
    plugin: { root: `${HOME}/.claude/plugins/scratchpad-keeper` },
    session: {
      id: async () => 'abcd1234-0000',
      cwd: async () => '/work/demo',
      info: async () => {
        if (noInfo) throw new Error('no info')
        return { platform, isHosted }
      },
    },
    clock: { now: async () => 1_700_000_000_000 },
    fs: {
      exists: async p => files.has(p),
      read: async p => { if (!files.has(p)) throw new Error('nope'); return files.get(p).text },
      write: async (p, text) => void files.set(p, { text, mtimeMs: 1_700_000_000_000 }),
      list: async d => {
        const seen = new Map()
        for (const [k, v] of files) {
          if (!k.startsWith(`${d}/`)) continue
          const [first, ...more] = k.slice(d.length + 1).split('/')
          seen.set(first, more.length ? { kind: 'dir', mtimeMs: 0 } : { kind: 'file', mtimeMs: v.mtimeMs })
        }
        if (seen.size === 0) throw new Error('no such folder')
        return [...seen].map(([name, v]) => ({ name, kind: v.kind, size: 1, mtimeMs: v.mtimeMs, isLink: false }))
      },
      stat: async () => { throw new Error('nope') },
    },
    process: {
      run: async argv => {
        runs.push(argv)
        if (argv[0] === '/bin/rm') files.delete(argv[2])
        return { exitCode: runFails && argv[0] !== 'mkdir' ? 1 : 0, stdout: '', stderr: '' }
      },
    },
    ui: { ask: async () => { throw new Error('dismissed') }, toast: t => void toasts.push(t), invalidate: e => void invalidated.push(e), resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button' }) },
    store: (() => { const m = new Map(); return { get: async k => m.get(k), set: async (k, v) => void m.set(k, v) } })(),
    command: { register: async () => {} },
    agent: { list: async () => [] },
  }
  register((name, ...rest) => void (handlers[name] = rest.at(-1)), options)
  const fire = (name, e = {}) => handlers[name]($, e, async x => x)
  const keeper = async args => (await fire('command.run', { args })).text
  const put = (path, mtimeMs) => files.set(path, { text: 'x'.repeat(500), mtimeMs })
  return { fire, keeper, files, runs, toasts, invalidated, put, handlers, $ }
}

const item = (id, over = {}) => ({ id, kind: 'file', title: `${id}.md`, name: `${id}.md`, source: '/pad/x.md', project: 'demo', sid: 'abcd1234-0000', at: 1_700_000_000_000, size: 900, skipped: false, text: `body of ${id}`, ...over })

test('openArgv gives an argv array per system and none where there is no file manager', () => {
  assert.deepEqual(openArgv('macos', '/a b/c'), ['open', '/a b/c'])
  assert.deepEqual(openArgv('linux', '/a'), ['xdg-open', '/a'])
  assert.deepEqual(openArgv('windows', 'C:/a'), ['explorer', 'C:/a'])
  assert.equal(openArgv('wsl', '/a'), null)
  assert.equal(openArgv('unknown', '/a'), null)
  assert.equal(openArgv(undefined, '/a'), null)
  assert.equal(openArgv('macos', '/a', true), null)
})

test('/keeper open creates the default folder first, then opens exactly that path with an argv array', async () => {
  const t = setup()
  await t.fire('session.start')
  const text = await t.keeper('open')
  assert.deepEqual(t.runs, [['mkdir', '-p', DEFAULT_DEST], ['open', DEFAULT_DEST]])
  assert.equal(text, 'Opened ~/.claude/scratchpad-keeper/saved')
})

test('/keeper open uses the destination setting and the Linux command', async () => {
  const t = setup({ platform: 'linux', options: { destination: '~/Research' } })
  await t.fire('session.start')
  await t.keeper('open')
  assert.deepEqual(t.runs, [['mkdir', '-p', `${HOME}/Research`], ['xdg-open', `${HOME}/Research`]])
})

test('/keeper open with no file manager (unknown system or hosted) prints the path and runs nothing', async () => {
  for (const opts of [{ platform: 'unknown' }, { platform: 'macos', isHosted: true }, { noInfo: true }]) {
    const t = setup(opts)
    await t.fire('session.start')
    const text = await t.keeper('open')
    assert.equal(t.runs.length, 0)
    assert.match(text, /No file manager is available here\. The folder is ~\/\.claude\/scratchpad-keeper\/saved/)
  }
})

test('/keeper open says so when the file manager command fails', async () => {
  const t = setup({ platform: 'linux', runFails: true })
  await t.fire('session.start')
  assert.match(await t.keeper('open'), /^Could not open a file manager\. The folder is ~\//)
})

test('/keeper list saved is newest first, capped at 20, with ~ paths and the project', async () => {
  const t = setup()
  await t.fire('session.start')
  // 25 files across two projects; file n was modified n minutes after the base time.
  for (let n = 0; n < 25; n++) t.put(`${DEFAULT_DEST}/${n % 2 ? 'alpha' : 'beta'}/f${String(n).padStart(2, '0')}.md`, 1_700_000_000_000 + n * 60_000)
  const lines = (await t.keeper('list saved')).split('\n')
  assert.equal(lines.length, 20)
  assert.equal(lines[0], '2023-11-14 22:37  beta  ~/.claude/scratchpad-keeper/saved/beta/f24.md')
  assert.match(lines[1], /alpha .*f23\.md$/)
  assert.match(lines[19], /f05\.md$/)
  assert.ok(!lines.join('\n').includes(HOME))
})

test('/keeper list saved reads a custom destination, ignores dot files, and says when nothing is saved', async () => {
  const t = setup({ options: { destination: '/data/keep' } })
  await t.fire('session.start')
  assert.equal(await t.keeper('list saved'), 'Nothing saved under /data/keep yet.')
  t.put('/data/keep/demo/.hidden.md', 5)
  t.put('/data/keep/demo/a.md', 1_700_000_000_000)
  assert.equal(await t.keeper('list saved'), '2023-11-14 22:13  demo  /data/keep/demo/a.md')
})

test('/keeper list saved never lists the keeper index file, and a project holding only the index shows nothing', async () => {
  const t = setup()
  await t.fire('session.start')
  t.put(`${DEFAULT_DEST}/demo/_keeper-index.jsonl`, 1_700_000_900_000)
  assert.equal(await t.keeper('list saved'), `Nothing saved under ~/.claude/scratchpad-keeper/saved yet.`)
  t.put(`${DEFAULT_DEST}/demo/report.md`, 1_700_000_000_000)
  const out = await t.keeper('list saved')
  assert.match(out, /report\.md$/)
  assert.doesNotMatch(out, /_keeper-index/)
})

test('/keeper list still shows waiting inbox items, not saved files', async () => {
  const t = setup()
  await t.fire('session.start')
  t.files.set(`${INBOX}/f-1.json`, { text: JSON.stringify(item('f-1')), mtimeMs: 1 })
  t.put(`${DEFAULT_DEST}/demo/saved.md`, 1)
  const text = await t.keeper('list')
  assert.match(text, /^f-1  waiting  f-1\.md/)
  assert.doesNotMatch(text, /saved\.md/)
})

test('panelModel lists waiting before skipped, caps both lists and formats saves', () => {
  const stored = []
  for (let n = 0; n < 12; n++) stored.push({ path: `/p/${n}`, item: item(`i${n}`, { at: n, skipped: n === 11 }) })
  const saved = []
  for (let n = 0; n < 10; n++) saved.push({ project: 'demo', name: `s${n}.md`, path: `${HOME}/s${n}.md`, mtimeMs: n * 1000 })
  const m = panelModel(stored, saved)
  assert.equal(m.waiting.length, 10)
  assert.equal(m.more, 2)
  assert.equal(m.waiting[0].id, 'i10')
  assert.ok(m.waiting.every(w => !w.skipped))
  assert.equal(m.recent.length, 8)
  assert.equal(m.recentMore, 2)
  assert.match(m.recent[0], /s9\.md$/)
})

// Draws the pane with a plain-data h() and returns every element as a flat list.
async function drawPane(t) {
  globalThis.h = (tag, props, ...children) => ({ tag, props: props ?? {}, children: children.flat() })
  const tree = await t.handlers['ui.render'](t.$, { props: { bodyColumns: 60 } })
  const out = []
  const walk = n => { if (n && typeof n === 'object') { out.push(n); n.children?.forEach(walk) } }
  walk(tree)
  return out
}

test('pane: Save writes the item to the destination, takes it out of the inbox and redraws; nothing is saved before the press', async () => {
  const t = setup()
  await t.fire('session.start')
  t.files.set(`${INBOX}/f-1.json`, { text: JSON.stringify(item('f-1')), mtimeMs: 1 })
  const saveBtn = (await drawPane(t)).find(n => n.props.key === 'save-f-1')
  assert.ok(saveBtn)
  assert.equal([...t.files.keys()].filter(k => k.startsWith(DEFAULT_DEST)).length, 0)
  saveBtn.props.onPress()
  await new Promise(r => setTimeout(r, 20))
  const saved = t.files.get(`${DEFAULT_DEST}/demo/f-1.md`)?.text
  assert.match(saved, /^---\n[\s\S]*saved-by: "scratchpad-keeper"[\s\S]*---\n\nbody of f-1$/)
  assert.equal(t.files.has(`${INBOX}/f-1.json`), false)
  assert.ok(t.invalidated.includes('ui.render'))
  const after = await drawPane(t)
  assert.ok(!after.some(n => n.props.key === 'save-f-1'))
  assert.ok(after.some(n => typeof n.children?.[0] === 'string' && n.children[0].endsWith('/demo/f-1.md')))
})

test('pane: Skip keeps the item and saves nothing; Open folder opens the destination', async () => {
  const t = setup()
  await t.fire('session.start')
  t.files.set(`${INBOX}/f-2.json`, { text: JSON.stringify(item('f-2')), mtimeMs: 1 })
  const els = await drawPane(t)
  els.find(n => n.props.key === 'skip-f-2').props.onPress()
  await new Promise(r => setTimeout(r, 20))
  assert.equal(JSON.parse(t.files.get(`${INBOX}/f-2.json`).text).skipped, true)
  assert.equal([...t.files.keys()].filter(k => k.startsWith(DEFAULT_DEST)).length, 0)
  els.find(n => n.props.key === 'open').props.onPress()
  await new Promise(r => setTimeout(r, 20))
  assert.deepEqual(t.runs.at(-1), ['open', DEFAULT_DEST])
})

test('pane: a turned-off mod draws no buttons', async () => {
  const t = setup()
  await t.fire('session.start')
  t.files.set(`${HOME}/.claude/mods/switches.json`, { text: '{"scratchpad-keeper":false}', mtimeMs: 1 })
  t.files.set(`${INBOX}/f-3.json`, { text: JSON.stringify(item('f-3')), mtimeMs: 1 })
  assert.ok(!(await drawPane(t)).some(n => n.tag === 'Button'))
})
