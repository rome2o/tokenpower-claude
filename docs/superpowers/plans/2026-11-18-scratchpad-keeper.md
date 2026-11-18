# scratchpad-keeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** A mod that saves subagent reports and scratchpad files before a session ends, asks where they live, and (phase 2) writes verified session notes.

**Architecture:** Pure modules (`guards`, `redact`, `triage`, `notes`) hold every decision and are tested with `node --test`. `io`, `inbox` and `register` call the engine. Layout follows `compaction-pruner` (constants, guards, io, state, switches, register).

**Tech Stack:** TypeScript hooks module, Claude Code mod API 2.1.327, `node --test` (Node 22.18+ strips types).

**Spec:** `docs/superpowers/specs/2026-11-18-scratchpad-keeper-design.md`

## Global Constraints

- Plugin files only under `plugins/scratchpad-keeper/`, plus the marketplace entry and root README edits.
- No network calls; the only model call is phase 2 (`claude-haiku-5-5`).
- No em dashes, no emojis in docs or user text.
- No writes to the token-savings ledger, no savings claims.
- State under `~/.claude/mods-logs/scratchpad-keeper/`; default destination `~/.claude/scratchpad-keeper/saved/<project>/`.

## Review Focus

- A secret inside a saved agent report: masked in the inbox copy and in the saved copy (test in Task 1).
- A quote Haiku invented or altered by one word: the note is dropped (Task 3).
- Haiku returning prose, an empty list or invalid JSON: no notes file is written (Task 3).
- A destination setting containing `..` or a relative path: falls back to the default (Task 1).
- A path that only shares a prefix with the scratchpad (`/tmp/pad-evil` vs `/tmp/pad`): not tracked (Task 2).

---

### Task 1: Guards and redaction

**Files:** Create `hooks/constants.ts`, `hooks/guards.ts`, `hooks/redact.ts`; Test `tests/guards.test.mjs`

**Interfaces:**
- Produces: `redact(text): string` (same behaviour as compaction-pruner), `isInside(path, dir): boolean`, `resolveDest(setting, home): string` (default when empty, relative or containing `..`), `slug(s): string`, `safeInboxPath(p, home): boolean`.

- [ ] Write tests: `redact` masks an `sk-` key, a `Bearer` header and a PEM private key; `isInside('/tmp/pad-evil/a.md', '/tmp/pad')` is false; `resolveDest('../x', home)` returns the default; `resolveDest('~/notes', home)` expands `~`.
- [ ] Run `node --test plugins/scratchpad-keeper/tests/` and see it fail.
- [ ] Implement the three files; `redact.ts` is a copy of the pruner's.
- [ ] Run again, expect pass. Commit.

### Task 2: Triage and expiry

**Files:** Create `hooks/triage.ts`; Test `tests/triage.test.mjs`

**Interfaces:**
- Produces: `triageFile(f: {path, size, writes}, minBytes): { keep: boolean; why: string; rank: number }`, `isExpired(item: {at, skipped}, now, days): boolean`.

- [ ] Tests: `.md` of 2000 bytes kept; `.ts`, `.log`, `.pdf` skipped; `.json` named `cache.json` skipped; 100 bytes skipped; 3 writes returns `deferred`-style `why` and higher rank than 1 write; `isExpired` true at exactly N days.
- [ ] Implement, run, commit.

### Task 3: Session notes (phase 2, pure part)

**Files:** Create `hooks/notes.ts`; Test `tests/notes.test.mjs`

**Interfaces:**
- Produces: `buildPrompt(transcript): string`, `parseNotes(text): RawNote[]`, `verifyNotes(raw, transcript): { kept: Note[]; dropped: number }`, `renderNotes(kept, meta): string`.

- [ ] Tests: exact quote kept; quote with one changed word dropped; quote differing only in whitespace kept; quote under 12 chars dropped; `{"notes":[]}`, prose and broken JSON give no notes; fenced JSON parses; at most 12 notes.
- [ ] Implement, run, commit.

### Task 4: Engine wiring

**Files:** Create `hooks/state.ts`, `hooks/io.ts`, `hooks/switches.ts`, `hooks/inbox.ts`, `hooks/register.ts`, `hooks/hooks.json`, `.claude-plugin/plugin.json`, `tsconfig.json`

- [ ] Capture: `tool.call` for Write and Edit tracks paths inside `scratchpadDir`; `turn.complete` with a known `local_agent` id and `reason === 'answer'` adds an agent report to the inbox.
- [ ] Ask: batch question with Save, Skip, Always; Always stored in `$.store`; dismissed ask leaves items pending.
- [ ] `/keeper` command: status, list, save, always, ask.
- [ ] Phase 2 hooks on `session.end` and `session.compact`, gated by the `sessionNotes` option.
- [ ] Type-check with the engine's types, run `claude plugin validate`, commit.

### Task 5: Docs

- [ ] Plugin README, marketplace entry, root README (count and table row), SECURITY.md paragraph. Commit.
