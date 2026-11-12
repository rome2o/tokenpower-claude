// Run with: node --test plugins/subagent-model-router/tests/ (Node 22.18+ or 23.6+ strips types, no install).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readJudgement, route, rankOf, DEFAULT_BARS } from '../hooks/policy.ts'

const tiers = { fast: 'claude-haiku-5-5', balanced: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' }
const config = { tiers, minUpgradeConfidence: 0.85, minDowngradeConfidence: 0.6, allowDeep: false }
const decide = (tier, confidence, risky = 0.05) => ({ tier, confidence, risky, effort: null, effortConfidence: null })
const run = (decision, model, overrides = {}) => route(decision, { model }, { ...config, ...overrides })

test('readJudgement: plain, fenced and noisy answers', () => {
  const body = '{"tier":"balanced","confidence":0.7,"effort":1,"effort_confidence":0.5,"risky":0.1}'
  for (const text of [body, '```json\n' + body + '\n```', 'Sure! Here it is: ' + body + ' Hope that helps.']) {
    const d = readJudgement(text)
    assert.equal(d.tier, 'balanced')
    assert.equal(d.confidence, 0.7)
    assert.equal(d.risky, 0.1)
    assert.equal(d.effort, 1)
  }
})

test('readJudgement: null, out-of-range and invalid confidence read as null', () => {
  for (const c of ['null', '1.4', '-0.1', '"high"', '""']) {
    assert.equal(readJudgement(`{"tier":"fast","confidence":${c}}`).confidence, null, c)
  }
  assert.equal(readJudgement('{"tier":"fast"}').confidence, null)
  assert.equal(readJudgement('{"tier":"fast","confidence":"0.8"}').confidence, 0.8)
})

test('readJudgement: no decision without a usable tier or JSON', () => {
  assert.equal(readJudgement('no json here'), null)
  assert.equal(readJudgement('{"tier":"huge","confidence":0.9}'), null)
  assert.equal(readJudgement('{broken'), null)
  assert.equal(readJudgement('[1,2]'), null)
})

test('upgrade bar: balanced to deep boundary (allowDeep true)', () => {
  const on = { allowDeep: true }
  assert.equal(run(decide('deep', 0.84), 'claude-sonnet-5-5', on).model, null)
  assert.equal(run(decide('deep', 0.85), 'claude-sonnet-5-5', on).model, 'claude-opus-5-5')
})

test('downgrade bar: opus to balanced boundary', () => {
  assert.equal(run(decide('balanced', 0.59), 'claude-opus-5-5').model, null)
  assert.equal(run(decide('balanced', 0.6), 'claude-opus-5-5').model, 'claude-sonnet-5-5')
})

test('upgrade bar applies to haiku to sonnet too', () => {
  assert.equal(run(decide('balanced', 0.6), 'claude-haiku-5-5').model, null)
  assert.equal(run(decide('balanced', 0.9), 'claude-haiku-5-5').model, 'claude-sonnet-5-5')
})

test('observed bug: sonnet + deep@0.60 stays on Sonnet (default config)', () => {
  assert.equal(run(decide('deep', 0.6), 'claude-sonnet-5-5').model, null)
})

test('sonnet + deep@0.95 with allowDeep false stays on Sonnet and says why', () => {
  const r = run(decide('deep', 0.95), 'claude-sonnet-5-5')
  assert.equal(r.model, null)
  assert.equal(r.capped, true)
  assert.match(r.reason, /allowDeep/)
})

test('sonnet + deep@0.95 with allowDeep true goes to Opus', () => {
  assert.equal(run(decide('deep', 0.95), 'claude-sonnet-5-5', { allowDeep: true }).model, 'claude-opus-5-5')
})

test('haiku + deep@0.95 with allowDeep false is capped at Sonnet, not Opus', () => {
  assert.equal(run(decide('deep', 0.95), 'claude-haiku-5-5').model, 'claude-sonnet-5-5')
})

test('risky forcing is capped at balanced when allowDeep is false', () => {
  const risky = decide('fast', 0.9, 0.95)
  const held = run(risky, 'claude-sonnet-5-5')
  assert.equal(held.model, null)
  assert.match(held.reason, /allowDeep/)
  assert.equal(run(risky, 'claude-haiku-5-5').model, 'claude-sonnet-5-5')
  assert.equal(run(risky, 'claude-sonnet-5-5', { allowDeep: true }).model, 'claude-opus-5-5')
})

test('a task already on Opus is not moved up or changed by a deep answer or by risk', () => {
  assert.equal(run(decide('deep', 0.99), 'claude-opus-5-5').model, null)
  assert.equal(run(decide('fast', 0.2, 0.99), 'claude-opus-5-5[1m]').model, null)
})

test('opus + balanced@0.9 moves down', () => {
  assert.equal(run(decide('balanced', 0.9), 'claude-opus-5-5').model, 'claude-sonnet-5-5')
})

test('null confidence never moves down', () => {
  assert.equal(run(decide('fast', null), 'claude-opus-5-5').model, null)
  assert.equal(run(decide('balanced', null), 'claude-opus-5-5').model, null)
})

test('a [1m] suffix on the current id is kept when nothing moves', () => {
  assert.equal(run(decide('deep', 0.99), 'claude-opus-5-5[1m]').model, null)
  assert.equal(rankOf('claude-opus-5-5[1m]', tiers), 2)
})

// End to end on the exported shipped defaults (what model-router.ts falls back to).
const shipped = { tiers, ...DEFAULT_BARS }
const ship = (decision, model, overrides = {}) => route(decision, { model }, { ...shipped, ...overrides })

test('DEFAULT_BARS values', () => {
  assert.deepEqual({ ...DEFAULT_BARS }, { minUpgradeConfidence: 0.85, minDowngradeConfidence: 0.6, allowDeep: false })
})

test('shipped defaults: sonnet + deep at 0.60, 0.80 and 0.95 stays on Sonnet', () => {
  for (const c of [0.6, 0.8, 0.95]) assert.equal(ship(decide('deep', c), 'claude-sonnet-5-5').model, null, String(c))
})

test('shipped defaults with allowDeep true: sonnet + deep@0.95 moves to Opus', () => {
  assert.equal(ship(decide('deep', 0.95), 'claude-sonnet-5-5', { allowDeep: true }).model, 'claude-opus-5-5')
})

test('shipped defaults: opus + balanced@0.9 moves down to Sonnet', () => {
  assert.equal(ship(decide('balanced', 0.9), 'claude-opus-5-5').model, 'claude-sonnet-5-5')
})
