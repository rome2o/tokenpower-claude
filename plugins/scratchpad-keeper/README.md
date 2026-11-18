# Scratchpad Keeper

A session writes documents and data into a temporary scratchpad folder, and subagents return reports that only live in the chat. When the session ends they can be gone. This mod copies what is worth keeping to a folder you choose, and asks you first. It works in every session and project once installed. It does not save tokens and writes nothing to the savings ledger.

## Status

This mod is type-checked against the engine's types and unit-checked (`node --test plugins/scratchpad-keeper/tests/*.test.mjs`), and `claude plugin validate` passes. It has not been run in a live Claude session. Untested in a live session: whether the question can be shown and answered at `session.end`, and whether the scratchpad path in a Write call is spelled the same as the session's scratchpad folder on macOS (the mod compares both the given and the resolved path). If the question does not show, the items stay in the inbox and the next session start tells you how many are waiting.

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

The `destination` setting is an absolute path or a `~/` path. Leave it empty to use `~/.claude/scratchpad-keeper/saved`. A path like `/.mystuff` (no `~`) is a folder at the root of the disk, not in your home folder, and will probably not be writable. A relative path or one containing `..` falls back to the default. The mod creates the folders it needs.

What the destination looks like after a few sessions:

```
<destination>/
  my-project/                                  one folder per project (the working folder's name, lower-cased)
    _keeper-index.jsonl                        one line per saved non-markdown file: where it came from
    agent-research-queues-20261118T094200Z.md  a subagent report, with a title and a "Saved from a subagent report on <date>" line
    competitor-pricing.md                      a scratchpad document, original file name kept
    competitor-pricing-3fa9c1d2.md             same name saved again: a short hash is added, nothing is overwritten
    session-notes-20261118T095100Z-ab12cd34.md session notes, only if that option is on
  another-project/
    ...
```

Every markdown file the mod saves starts with a short header that says where it came from, so a file can be traced to its project and chat later. Two projects with the same folder name share a folder, and the header is what tells their files apart:

```
---
saved-by: "scratchpad-keeper"
project: "my-project"
project-path: "~/work/my-project"
session: "ab12cd34"
saved: "2026-11-18T09:42:00.000Z"
source: "subagent-report"
original-name: "agent-research-queues-20261118T094200Z.md"
---
```

- `source` is `subagent-report`, `scratchpad-file` or `session-notes`. `project-path` shows your home folder as `~`. Every value is one line, and key-like strings are masked.
- A file that already starts with a frontmatter block keeps it: the keys above are added inside it, and a key that is already there is left alone.
- `.json`, `.csv`, `.txt` and `.html` files are saved exactly as they are, because a header would break them. Instead, one JSON line per saved file is appended to `<destination>/<project>/_keeper-index.jsonl` with the same fields plus `saved-file` (the name it was saved under).

Every item you have not saved yet, and every skipped item, waits in the inbox at `~/.claude/mods-logs/scratchpad-keeper/inbox/` until you save it or it expires. That folder is the safety net, not the place to read your work. `/keeper status` prints the current destination, and `/keeper list` shows what is waiting.

## Session notes (optional, uses Haiku)

On by default through the `sessionNotes` option, and the only part that makes a model call. At session end and at compaction, one Haiku call lists decisions, dead ends and open items. Each note must quote its transcript line, and code drops any note whose quote is not found verbatim in the transcript (whitespace aside, at least 12 characters). Haiku may return nothing, and then no file is written. Notes follow the same choice as the files: after Skip nothing is sent to Haiku and no file is written. With no choice yet this session, one question asks first (Save, Skip or Always, and a dismissed question counts as no). The transcript is masked before it is sent, and a quote can only match masked text. A note with a key-like token is dropped, the sentence is capped at 200 characters, and the saved file says it is data, not instructions, and that the sentence is an unverified model summary. Compaction and session end do not write the same note twice. The notes come from a model, so read them as hints. In a headless or background process there is no chat to read, so notes are skipped and one line is written to the log. Set `sessionNotes` to false to make no model calls at all.

## Commands

`/keeper status`, `/keeper list`, `/keeper save <id|all>`, `/keeper always`, `/keeper never`, `/keeper ask`.

## Where it writes

- Inbox and error log: `~/.claude/mods-logs/scratchpad-keeper/`.
- Saved files and notes: the destination folder.
- One command: `rm -f` on an inbox item, only after checking the path sits inside the inbox. The engine has no file delete.

No network calls of its own.

## Switch

`"scratchpad-keeper": false` in `~/.claude/mods/switches.json` turns it off. `/mods` has the toggle.
