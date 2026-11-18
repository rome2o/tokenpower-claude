import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triageFile, isExpired } from '../hooks/triage.ts'

const f = (path, size, writes = 1) => ({ path, size, writes })

test('documents and data are kept', () => {
  for (const name of ['a.md', 'b.txt', 'c.json', 'd.csv', 'e.html']) {
    assert.equal(triageFile(f(`/pad/${name}`, 2000), 400).keep, true, name)
  }
})

test('scripts, logs, binaries and pdf are skipped', () => {
  for (const name of ['a.ts', 'b.py', 'c.log', 'd.sh', 'e.png', 'f.pdf', 'noext']) {
    const r = triageFile(f(`/pad/${name}`, 5000), 400)
    assert.equal(r.keep, false, name)
  }
})

test('caches and lock files are skipped even when the extension is allowed', () => {
  assert.equal(triageFile(f('/pad/cache.json', 5000), 400).keep, false)
  assert.equal(triageFile(f('/pad/package-lock.json', 5000), 400).keep, false)
  assert.equal(triageFile(f('/pad/node_modules/x/readme.md', 5000), 400).keep, false)
  assert.equal(triageFile(f('/pad/.cache/notes.md', 5000), 400).keep, false)
})

test('the size floor is inclusive and configurable', () => {
  assert.equal(triageFile(f('/pad/a.md', 399), 400).keep, false)
  assert.equal(triageFile(f('/pad/a.md', 400), 400).keep, true)
  assert.equal(triageFile(f('/pad/a.md', 50), 10).keep, true)
})

test('a file rewritten often ranks after a file written once and is marked work in progress', () => {
  const once = triageFile(f('/pad/a.md', 2000, 1), 400)
  const many = triageFile(f('/pad/b.md', 2000, 3), 400)
  assert.equal(many.keep, true)
  assert.equal(many.wip, true)
  assert.equal(once.wip, false)
  assert.ok(many.rank > once.rank)
})

test('isExpired: skipped items expire after N days, pending and kept ones never', () => {
  const day = 86_400_000
  const now = 100 * day
  assert.equal(isExpired({ at: now - 14 * day, skipped: true }, now, 14), true)
  assert.equal(isExpired({ at: now - 14 * day + 1, skipped: true }, now, 14), false)
  assert.equal(isExpired({ at: now - 90 * day, skipped: false }, now, 14), false)
})

test('isExpired: a bad days value never expires anything', () => {
  const now = 100 * 86_400_000
  for (const d of [0, -1, NaN, Infinity]) assert.equal(isExpired({ at: 0, skipped: true }, now, d), false, String(d))
})
