import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from '../hooks/register.ts'
import { S } from '../hooks/state.ts'

const HOME = '/home/u'
const QUOTE = 'Decision: use sqlite with WAL mode for the queue.'

// A small in-memory engine: just the calls register.ts makes.
function setup({ answers = [], agents = [] } = {}) {
  const files = new Map()
  const handlers = {}
  const calls = { ask: 0, complete: 0, prompts: [] }
  const messages = [{ role: 'user', text: 'which queue?' }, { role: 'assistant', text: QUOTE }]
  const $ = {
    plugin: { root: `${HOME}/.claude/plugins/scratchpad-keeper` },
    session: { id: async () => 'abcd1234-0000', cwd: async () => '/work/demo', info: async () => ({ scratchpadDir: '/pad' }), messages: async () => messages },
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
    process: { run: async argv => { files.delete(argv[2]); return { exitCode: 0, stdout: '', stderr: '' } } },
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
