import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../hooks/register.ts'
import { S } from '../hooks/state.ts'

const HOME = '/home/u'
const QUOTE = 'Decision: use sqlite with WAL mode for the queue.'

// A small in-memory engine: just the calls register.ts makes.
function setup({ answers = [], agents = [], mkdirFails = false, noChat = false, cwd = '/work/demo' } = {}) {
  const files = new Map()
  const handlers = {}
  const calls = { ask: 0, complete: 0, prompts: [], mkdirs: [] }
  const messages = [{ role: 'user', text: 'which queue?' }, { role: 'assistant', text: QUOTE }]
  const $ = {
    plugin: { root: `${HOME}/.claude/plugins/scratchpad-keeper` },
    session: { id: async () => 'abcd1234-0000', cwd: async () => cwd, info: async () => ({ scratchpadDir: '/pad' }), messages: async () => { if (noChat) throw new Error('$.session.messages is not available in this mode: no session is bound in this process'); return messages } },
    clock: { now: async () => 1_700_000_000_000 },
    fs: {
      exists: async p => files.has(p),
      read: async p => { if (!files.has(p)) throw new Error('nope'); return files.get(p) },
      write: async (p, t) => void files.set(p, t),
      list: async d => {
        const seen = new Map()
        for (const k of files.keys()) {
          if (!k.startsWith(`${d}/`)) continue
          const rest = k.slice(d.length + 1)
          const [first, ...more] = rest.split('/')
          seen.set(first, more.length ? 'dir' : 'file')
        }
        return [...seen].map(([name, kind]) => ({ name, kind }))
      },
      stat: async p => (files.has(p) ? { kind: 'file', size: files.get(p).length, mtimeMs: 0, isLink: false } : Promise.reject(new Error('nope'))),
    },
    process: { run: async argv => { if (argv[0] === 'mkdir') { calls.mkdirs.push(argv[2]); return { exitCode: mkdirFails && !argv[2].includes('/mods-logs/') ? 1 : 0, stdout: '', stderr: '' } } files.delete(argv[2]); return { exitCode: 0, stdout: '', stderr: '' } } },
    ui: { ask: async () => { calls.ask++; const a = answers.shift(); if (a === undefined) throw new Error('dismissed'); return a }, toast: () => {} },
    store: (() => { const m = new Map(); return { get: async k => m.get(k), set: async (k, v) => void m.set(k, v) } })(),
    command: { register: async () => {} },
    agent: { list: async () => agents },
    model: { complete: async r => { calls.complete++; calls.prompts.push(r.prompt); return { isAnswered: true, text: JSON.stringify({ notes: [{ kind: 'decision', text: 'sqlite chosen', quote: QUOTE }] }) } } },
  }
  register((name, ...rest) => void (handlers[name] = rest.at(-1)), {})
  const fire = (name, e = {}) => handlers[name]($, e, async x => x)
  const notesFiles = () => [...files.keys()].filter(k => k.includes('session-notes-'))
  return { fire, files, calls, notesFiles, messages }
}

test('after Skip, session end sends nothing to Haiku and writes no notes', async () => {
  const t = setup({ answers: ['Skip'] })
  await t.fire('session.start')
  await t.files.set(`${HOME}/.claude/mods-logs/scratchpad-keeper/inbox/abcd1234/f-1.json`, JSON.stringify({ id: 'f-1', kind: 'file', title: 'a.md', name: 'a.md', source: '/pad/a.md', project: 'demo', sid: 'abcd1234-0000', at: 1, size: 900, skipped: false, text: 'x'.repeat(900) }))
  await t.fire('session.end', { reason: 'other' })
  assert.equal(t.calls.complete, 0)
  assert.equal(t.notesFiles().length, 0)
})

test('with no choice yet, session end asks first and a dismissed question means no notes', async () => {
  const t = setup({ answers: [] })
  await t.fire('session.start')
  await t.fire('session.end', { reason: 'other' })
  assert.equal(t.calls.ask, 1)
  assert.equal(t.calls.complete, 0)
})

test('after Save, notes are written once even when compaction and session end both run', async () => {
  const t = setup({ answers: ['Save'] })
  await t.fire('session.start')
  await t.fire('session.compact', { trigger: 'manual' })
  t.messages.push({ role: 'user', text: 'thanks' })
  await t.fire('session.end', { reason: 'other' })
  assert.equal(t.calls.complete, 2)
  assert.equal(t.notesFiles().length, 1)
  assert.equal(t.calls.ask, 1)
})

test('a subagent finishing does not ask inside turn.complete; the question comes with the next prompt', async () => {
  const agents = [{ id: 'ag1', kind: 'local_agent', description: 'research queues' }]
  const t2 = setup({ answers: ['Skip'], agents })
  await t2.fire('session.start')
  await t2.fire('turn.complete', { agentId: 'ag1', reason: 'answer', answer: 'A long report about queues.' })
  assert.equal(t2.calls.ask, 0)
  await t2.fire('prompt.submit', { text: 'next' })
  assert.equal(t2.calls.ask, 1)
})

const SAVED = `${HOME}/.claude/scratchpad-keeper/saved/demo`
const reportFlow = async t => {
  await t.fire('session.start')
  await t.fire('turn.complete', { agentId: 'ag1', reason: 'answer', answer: 'A long report about queues.' })
  await t.fire('prompt.submit', { text: 'next' })
}
const agents = [{ id: 'ag1', kind: 'local_agent', description: 'research queues' }]
const savedFiles = t => [...t.files.keys()].filter(k => k.startsWith(`${SAVED}/`))

test('Save into a destination that does not exist yet creates the project folder first, then writes', async () => {
  const t = setup({ answers: ['Save'], agents })
  await reportFlow(t)
  assert.ok(t.calls.mkdirs.includes(SAVED))
  assert.equal(savedFiles(t).length, 1)
  assert.match(t.files.get(savedFiles(t)[0]), /A long report about queues\./)
})

test('when the folder cannot be created nothing is written to the destination and the failure is logged', async () => {
  const t = setup({ answers: ['Save'], agents, mkdirFails: true })
  await reportFlow(t)
  assert.equal(savedFiles(t).length, 0)
  const log = t.files.get(`${HOME}/.claude/mods-logs/scratchpad-keeper/keeper.log`) ?? ''
  assert.match(String(log), /could not create the folder/)
})

test('with no chat to read (headless or background), notes are skipped and the reason is logged once', async () => {
  const t = setup({ answers: ['Save'], noChat: true })
  await t.fire('session.start')
  await t.fire('session.compact', { trigger: 'manual' })
  await t.fire('session.end', { reason: 'other' })
  await t.fire('session.end', { reason: 'other' })
  assert.equal(t.calls.complete, 0)
  assert.equal(t.notesFiles().length, 0)
  const log = String(t.files.get(`${HOME}/.claude/mods-logs/scratchpad-keeper/keeper.log`) ?? '')
  assert.equal((log.match(/no chat to read/g) ?? []).length, 1)
  assert.doesNotMatch(log, /session notes failed/)
})

const INBOX = `${HOME}/.claude/mods-logs/scratchpad-keeper/inbox/abcd1234`
const seed = (t, item) => t.files.set(`${INBOX}/${item.id}.json`, JSON.stringify({ kind: 'file', source: '/pad/x', project: 'demo', projectPath: '~/work/demo', sid: 'abcd1234-0000', at: 1_700_000_000_000, skipped: false, ...item }))
const saveAllNow = async t => {
  await t.fire('session.start')
  return t.fire('command.run', { args: 'save all' })
}
const fm = text => /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''

test('a saved markdown file gets a provenance header with every field', async () => {
  const t = setup({ cwd: `${HOME}/work/demo` })
  seed(t, { id: 'f-1', title: 'plan.md', name: 'plan.md', size: 900, text: `# Plan\n\n${'x'.repeat(500)}` })
  await saveAllNow(t)
  const out = t.files.get(`${SAVED}/plan.md`)
  const head = fm(out)
  for (const k of ['saved-by: "scratchpad-keeper"', 'project: "demo"', 'project-path: "~/work/demo"', 'session: "abcd1234"', 'source: "scratchpad-file"', 'original-name: "plan.md"']) assert.ok(head.includes(k), k)
  assert.match(head, /saved: "2023-11-14T22:13:20\.000Z"/)
  assert.ok(out.endsWith('x'.repeat(500)))
})

test('the home folder never appears in a header, only ~', async () => {
  const t = setup()
  seed(t, { id: 'f-2', title: 'n.md', name: 'n.md', size: 900, projectPath: `${HOME}/work/demo`, text: 'y'.repeat(500) })
  await saveAllNow(t)
  const head = fm(t.files.get(`${SAVED}/n.md`))
  assert.ok(!head.includes(HOME))
  assert.match(head, /project-path: "~\/work\/demo"/)
})

test('agent reports are saved with source subagent-report and the header above the title', async () => {
  const t = setup({ answers: ['Save'], agents, cwd: `${HOME}/work/demo` })
  await reportFlow(t)
  const out = t.files.get(savedFiles(t)[0])
  assert.match(out, /^---\n/)
  assert.match(fm(out), /source: "subagent-report"/)
  assert.match(fm(out), /project-path: "~\/work\/demo"/)
  assert.match(out, /\n---\n\n# research queues\n/)
})

test('existing frontmatter is kept: missing keys are added inside it and existing keys are not duplicated', async () => {
  const t = setup()
  const tail = `\n---\n\n# Body\n${'z'.repeat(500)}`
  seed(t, { id: 'f-3', title: 'd.md', name: 'd.md', size: 900, text: `---\ntitle: My doc\nproject: other${tail}` })
  await saveAllNow(t)
  const out = t.files.get(`${SAVED}/d.md`)
  assert.equal(out.match(/^---$/gm).length, 2)
  assert.match(out, /^---\ntitle: My doc\nproject: other\n/)
  assert.equal(out.match(/^project:/gm).length, 1)
  assert.match(out, /saved-by: "scratchpad-keeper"/)
  assert.ok(out.endsWith(tail))
})

test('a json file is written byte for byte and the provenance goes to the index', async () => {
  const t = setup()
  const text = JSON.stringify({ a: 1, list: [1, 2, 3], pad: 'p'.repeat(500) }, null, 2)
  seed(t, { id: 'f-4', title: 'data.json', name: 'data.json', size: 900, text })
  await saveAllNow(t)
  assert.equal(t.files.get(`${SAVED}/data.json`), text)
  const lines = String(t.files.get(`${SAVED}/_keeper-index.jsonl`)).trim().split('\n')
  assert.equal(lines.length, 1)
  const row = JSON.parse(lines[0])
  assert.equal(row['saved-file'], 'data.json')
  assert.equal(row['original-name'], 'data.json')
  assert.equal(row.source, 'scratchpad-file')
  assert.equal(row['saved-by'], 'scratchpad-keeper')
  assert.equal(row.session, 'abcd1234')
})

test('a second non-markdown save appends a line instead of replacing the index', async () => {
  const t = setup()
  seed(t, { id: 'f-5', title: 'a.csv', name: 'a.csv', size: 900, text: `a,b\n${'1,2\n'.repeat(200)}` })
  seed(t, { id: 'f-6', title: 'b.txt', name: 'b.txt', size: 900, text: 'b'.repeat(500) })
  await saveAllNow(t)
  assert.equal(String(t.files.get(`${SAVED}/_keeper-index.jsonl`)).trim().split('\n').length, 2)
})

test('a name with newlines and frontmatter markers cannot inject lines into the header or the index', async () => {
  const t = setup()
  seed(t, { id: 'f-7', title: 'x', name: 'x\n---\nevil: true\n.md', size: 900, text: 'q'.repeat(500) })
  seed(t, { id: 'f-8', title: 'y', name: 'y\n{"injected":1}.json', size: 900, text: `{"k":"${'q'.repeat(500)}"}` })
  await saveAllNow(t)
  const md = [...t.files.entries()].find(([k]) => k.startsWith(`${SAVED}/x`))[1]
  assert.equal(md.match(/^---$/gm).length, 2)
  assert.ok(!/^evil:/m.test(md))
  const rows = String(t.files.get(`${SAVED}/_keeper-index.jsonl`)).trim().split('\n')
  assert.equal(rows.length, 1)
  assert.equal(JSON.parse(rows[0]).injected, undefined)
})

test('a key-like string in a file name is masked in the header', async () => {
  const key = `sk-${'a1B2c3D4e5F6g7H8i9J0k1L2'}`
  const t = setup()
  seed(t, { id: 'f-9', title: 'k', name: `${key}.md`, size: 900, text: 'v'.repeat(500) })
  await saveAllNow(t)
  const all = [...t.files.entries()].filter(([k]) => k.startsWith(`${SAVED}/`)).map(([, v]) => String(v)).join('\n')
  assert.ok(!all.includes(key))
})

test('session notes carry the header with source session-notes', async () => {
  const t = setup({ answers: ['Save'], cwd: `${HOME}/work/demo` })
  await t.fire('session.start')
  await t.fire('session.end', { reason: 'other' })
  const out = t.files.get(t.notesFiles()[0])
  assert.match(fm(out), /source: "session-notes"/)
  assert.match(fm(out), /project-path: "~\/work\/demo"/)
  assert.match(out, /\n---\n\n# Session notes/)
})
