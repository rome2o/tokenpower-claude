// Run with: node --test plugins/scratchpad-keeper/tests/ (Node 22.18+ or 23.6+ strips types, no install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redact } from '../hooks/redact.ts'
import { redact as pruner } from '../../compaction-pruner/hooks/redact.ts'
import { isInside, resolveDest, slug, safeInboxPath, DEFAULT_DEST_SUBPATH } from '../hooks/guards.ts'

const home = '/home/someone'

test('redact masks keys, bearer headers and private key blocks', () => {
  const key = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2'
  const text = `use ${key} here\nAuthorization: Bearer abcdefghijklmnop1234\n-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\nplain line`
  const out = redact(text)
  assert.ok(!out.includes(key))
  assert.ok(!out.includes('abcdefghijklmnop1234'))
  assert.ok(!out.includes('MIIabc'))
  assert.ok(out.includes('plain line'))
})

test('redact behaves the same as the compaction-pruner copy it was taken from', () => {
  const sample = 'API_KEY=supersecretvalue123\nghp_' + 'x'.repeat(30) + '\nhello'
  assert.equal(redact(sample), pruner(sample))
})

test('isInside needs a real path boundary, not a shared prefix', () => {
  assert.equal(isInside('/tmp/pad/a.md', '/tmp/pad'), true)
  assert.equal(isInside('/tmp/pad-evil/a.md', '/tmp/pad'), false)
  assert.equal(isInside('/tmp/pad/../x.md', '/tmp/pad'), false)
  assert.equal(isInside('/tmp/pad', '/tmp/pad'), false)
})

test('resolveDest: default when empty, relative or holding ..; ~ is expanded', () => {
  const dflt = `${home}/${DEFAULT_DEST_SUBPATH}`
  assert.equal(resolveDest('', home), dflt)
  assert.equal(resolveDest('notes', home), dflt)
  assert.equal(resolveDest('../x', home), dflt)
  assert.equal(resolveDest('/a/../b', home), dflt)
  assert.equal(resolveDest('~/notes', home), `${home}/notes`)
  assert.equal(resolveDest('/data/keep/', home), '/data/keep')
})

test('slug gives a safe folder name', () => {
  assert.equal(slug('My Project: v2!'), 'my-project-v2')
  assert.equal(slug('../..'), 'project')
  assert.equal(slug(''), 'project')
})

test('safeInboxPath only accepts paths inside the inbox', () => {
  const ok = `${home}/.claude/mods-logs/scratchpad-keeper/inbox/abcd1234/item.json`
  assert.equal(safeInboxPath(ok, home), true)
  assert.equal(safeInboxPath(`${home}/.claude/mods-logs/scratchpad-keeper/inbox/../../x.json`, home), false)
  assert.equal(safeInboxPath(`${home}/Documents/item.json`, home), false)
  assert.equal(safeInboxPath(`${home}/.claude/mods-logs/scratchpad-keeper/inbox/`, home), false)
})

test('redact masks lowercase bearer tokens and Basic auth headers in any case', () => {
  const out = redact('authorization: bearer abcdefghijklmnop1234\nAUTHORIZATION: basic dXNlcjpwYXNzd29yZDEyMw==\nAuthorization: Basic dXNlcjpwYXNzd29yZDEyMw==')
  assert.ok(!out.includes('abcdefghijklmnop1234'))
  assert.ok(!out.includes('dXNlcjpwYXNzd29yZDEyMw'))
})

test('only a real .. segment is refused, not a name that contains two dots', () => {
  assert.equal(isInside('/tmp/pad/notes..draft.md', '/tmp/pad'), true)
  assert.equal(isInside('/tmp/pad/a/../b.md', '/tmp/pad'), false)
  assert.equal(resolveDest('/data/my..notes', home), '/data/my..notes')
  assert.equal(resolveDest('/data/../x', home), `${home}/.claude/scratchpad-keeper/saved`)
})
