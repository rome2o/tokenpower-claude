# scratchpad-keeper design

Date: 2026-11-18. Status: approved scope, built on branch `feat/scratchpad-keeper`.

## Intent

A Claude Code session writes research notes, data files and subagent reports into a temporary scratchpad directory. When the session ends that directory can be cleared, and subagent reports only ever lived in the chat. `scratchpad-keeper` saves what is worth keeping, asks the person where it should live, and never asks twice about the same item.

It works in every session and project once installed (user level). It is not research specific.

## Verified API points

Both were checked in the engine's type file (Claude Code 2.1.327), not assumed.

- (a) The `tool.call` event carries the file path of Write and Edit calls. `ToolCallInput` is a union discriminated by `tool`; the Write arguments are `{ file_path, content }` and Edit has `file_path` (see `BuiltinToolInputs`). A hook that calls `await next(e)` sees the result, so the mod records a path only after the call ran. MultiEdit is not in this build's tool list, so it is not handled.
- (b) A mod can discover the scratchpad. `await $.session.info()` returns `SessionInfo` with `scratchpadDir?: string`, absent "where the session has none". When absent, the file capture part does nothing and only agent reports are captured. Reading a file back uses `$.fs.read`, listing uses `$.fs.stat`.

Limits found while reading the types, each of which shapes the design:

- `$.fs.write` takes text only. There is no binary write and no delete in `$.fs`. So PDFs (and any binary file) cannot be copied with masking and are out of scope; `.pdf` was in the original list and is dropped. Deleting an expired inbox item uses `$.process.run(['/bin/rm', '-f', path])` on a path the mod checks to sit inside its own inbox folder.
- `$.ui.ask` takes 2 to 4 options and one question string. A checklist is therefore the question text (numbered items) with the options Save, Skip, Always.
- At `session.end` the engine gives no promise that a dialog can be drawn or answered. Items are written to the inbox before any ask, so a failed ask loses nothing.
- Engine forks (compaction, memory) and workflow agents carry agent ids that `$.agent.list()` does not name. Only ids that list names, of kind `local_agent` and not spawned by another plugin, are treated as agent reports.

## Goals

1. Capture, with no model call: the final report of each subagent (turn.complete with an `agentId`), and files written or edited under the scratchpad directory.
2. Triage with plain code: documents and data only; agent reports always; small files, scripts, logs and caches skipped; files rewritten many times are work in progress and wait.
3. Mask API keys, tokens and private keys in every saved copy.
4. Ask once per batch: Save, Skip, or Always (stop asking and save automatically). Skipped items stay in the inbox and expire after N days (default 14).
5. Save to a configurable folder. Default `~/.claude/scratchpad-keeper/saved/<project>/`. No personal path is hardcoded.
6. Switch on and off in `/mods` through `~/.claude/mods/switches.json`, like the sibling mods.
7. Phase 2, separable and switchable off: at `session.end` and `session.compact`, one Haiku call extracts decisions, dead ends and open items into one short notes file in the destination. Every note quotes its transcript line; a note whose quote is not found verbatim in the transcript is dropped by code. Haiku may return nothing.

## Non-goals

Screenshots and GIFs, todo lists, plan-mode plans, artifact URLs, crons, worktrees, user-correction or memory suggestions, chat-only content that never reached a file or a subagent report. No savings claims and no writes to the token-savings ledger. No binary files.

## Constraints

- No network calls of its own. The only model call is phase 2's Haiku pass.
- Plugins are independent: no sibling shares code with another. `redact.ts` is a copy of `compaction-pruner/hooks/redact.ts`, kept identical in behaviour (a test pins it).
- State lives under `~/.claude/mods-logs/scratchpad-keeper/` (inbox, log), the sibling convention for stores. `~/.claude/mods/` is not used for state: `mods-manager` lists every folder under it as a mod. This differs from the first brief, which named `~/.claude/mods`.
- Masking is pattern based and can miss unusual secrets. Saved copies use default file permissions.

## Approaches considered

- Copy files at write time. Rejected: a file edited later would be saved half done. The mod records paths at write time and reads content when it judges.
- Ask per item. Rejected: noisy. One question lists the batch.
- Haiku triage. Rejected by brief: triage is deterministic.
- Re-ask skipped items next session. Rejected: nagging. Skipped items wait in the inbox and `/keeper save <id>` retrieves them until they expire.

## Decisions

- Inbox: one JSON file per item in `~/.claude/mods-logs/scratchpad-keeper/inbox/<chat>/<id>.json`, holding the already masked text, so nothing unmasked is written anywhere.
- Triage rules (`triage.ts`, pure): keep extensions `.md .txt .json .csv .html`; skip names that look like caches or lock files; skip below `minBytes` (default 400); a file rewritten 3 or more times is deferred while the session runs and judged at session end, where fewer rewrites sort first.
- Agent reports are kept when the turn ended with `reason === 'answer'` and the text is not empty.
- `/keeper` command: `status`, `list`, `save <id|all>`, `always`, `ask`.
- Phase 2 verification: both the quote and the transcript have whitespace runs collapsed to one space, then the quote must be a substring and at least 12 characters. Nothing else is fuzzy.
- Phase 2 is on by default, as the brief asked, through the `sessionNotes` option. It is the only part that spends tokens; the README says so.

## Open items for the builder

- `session.end` dialog behaviour is untested in a live session. If the ask never shows, items stay in the inbox and the next session start shows a toast with the count.
- Whether the scratchpad path in `tool.call` is spelled the same as `scratchpadDir` (symlinked temp folders on macOS) is untested. The mod compares paths as given and also against the resolved path from `$.fs.stat(..., { resolve: true })`.
- Not run in a live session: type-check and unit tests only.
