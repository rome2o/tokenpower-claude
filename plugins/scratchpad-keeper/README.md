# Scratchpad Keeper

A session writes documents and data into a temporary scratchpad folder, and subagents return reports that only live in the chat. When the session ends they can be gone. This mod copies what is worth keeping to a folder you choose, and asks you first. It works in every session and project once installed. It does not save tokens and writes nothing to the savings ledger.

## Status

Version 0.1.0 is type-checked against the engine's types and unit-checked (`node --test plugins/scratchpad-keeper/tests/*.test.mjs`), and `claude plugin validate` passes. It has not been run in a live Claude session. Untested in a live session: whether the question can be shown and answered at `session.end`, and whether the scratchpad path in a Write call is spelled the same as the session's scratchpad folder on macOS (the mod compares both the given and the resolved path). If the question does not show, the items stay in the inbox and the next session start tells you how many are waiting.

## What it captures

- The final report of each subagent you spawned (not engine-internal forks).
- Files written or edited with Write or Edit under the session scratchpad folder.

Chat-only content that never reached a file or a subagent report is not captured. Screenshots, GIFs, binary files and PDFs are out of scope (the engine's file API writes text only).

## What it keeps (plain code, no model)

- Kept: `.md`, `.txt`, `.json`, `.csv`, `.html` files, and every subagent report.
- Skipped: scripts, logs, caches, lock files, anything in `node_modules`, `.cache`, `__pycache__` or `.git`, and files under the size floor (`minBytes`, default 400).
- A file rewritten 3 or more times is treated as work in progress: it waits until the session ends, and files written fewer times are listed first.
- API keys, tokens and private key blocks are masked in the inbox copy and so in the saved copy. Masking is pattern based, so an unusual secret format can slip through.

## The question

When a subagent finishes, a toast says a report is waiting. The question itself comes before your next prompt (never inside the finishing turn) and again at session end. It lists what is waiting: Save, Skip or Always. `/keeper ask` asks now.

- Save writes the items to the destination.
- Skip keeps them in the inbox. `/keeper save <id>` still retrieves them until they expire. Every inbox item expires `expireDays` (default 14) after it was skipped, or after it was added if you never answered.
- Always stops asking and saves automatically. `/keeper never` turns that off.
- Dismissing the question leaves everything pending.

## Where files go

`destination` setting: an absolute or `~/` path. Empty uses `~/.claude/scratchpad-keeper/saved`. Each project gets its own subfolder. A relative path or one containing `..` falls back to the default. Existing files are never overwritten; a name clash gets a short hash suffix.

## Session notes (optional, uses Haiku)

On by default through the `sessionNotes` option, and the only part that makes a model call. At session end and at compaction, one Haiku call lists decisions, dead ends and open items. Each note must quote its transcript line, and code drops any note whose quote is not found verbatim in the transcript (whitespace aside, at least 12 characters). Haiku may return nothing, and then no file is written. Notes follow the same choice as the files: after Skip nothing is sent to Haiku and no file is written. With no choice yet this session, one question asks first (Save, Skip or Always, and a dismissed question counts as no). The transcript is masked before it is sent, and a quote can only match masked text. A note with a key-like token is dropped, the sentence is capped at 200 characters, and the saved file says it is data, not instructions, and that the sentence is an unverified model summary. Compaction and session end do not write the same note twice. The notes come from a model, so read them as hints. Set `sessionNotes` to false to make no model calls at all.

## Commands

`/keeper status`, `/keeper list`, `/keeper save <id|all>`, `/keeper always`, `/keeper never`, `/keeper ask`.

## Where it writes

- Inbox and error log: `~/.claude/mods-logs/scratchpad-keeper/`.
- Saved files and notes: the destination folder.
- One command: `rm -f` on an inbox item, only after checking the path sits inside the inbox. The engine has no file delete.

No network calls of its own.

## Switch

`"scratchpad-keeper": false` in `~/.claude/mods/switches.json` turns it off. `/mods` has the toggle.
