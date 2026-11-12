# Compaction Pruner

When you compact, this mod shortens old, large tool results so the compacted chat keeps more of what matters. Claude's own compaction still writes the summary. It is OFF by default.

## Turn it on

- `/prune on` starts in dry-run mode. At each compaction it shows what it would shorten (tool, size in tokens, which rule fired) and changes nothing.
- `/prune live` lets it shorten results for real.
- `/prune dry` goes back to dry-run. `/prune off` turns it off.
- `/prune status` shows the mode and the last report. Ids are listed only for the last report of this session.

## What it shortens

A tool result is a candidate when it is older than the last 6 messages and about 2,000 tokens or more (estimated as characters divided by 4). Four simple rules, checked in this order:

1. A whole-file Read (no offset or limit) that a later whole-file Read of the same file, at least half its size, replaced.
2. A Bash output that came again, identical, later in the chat.
3. A large Bash or Grep output more than 20 messages old.
4. A screenshot or a result that is mostly base64 data (at least half of its start).

The result keeps its first 300 characters and a one-line note with the saved file and an id. The call and its result stay paired. A single compaction shortens at most 200 results, and results over 2,000,000 characters or beyond 20,000,000 characters in total are left as they are; the report counts them as skipped. Nothing else is touched: the first message, the last 6 messages, Edit, Write, TodoWrite and NotebookEdit results, errors, and results with no matching call are never shortened. Subagent compactions are left alone.

## Getting the original back

Before a result is shortened, the full text is saved to `~/.claude/mods-logs/compaction-pruner/<chat>/<time>/`. If the save fails, that result is left as it is. Live mode works only with the default `~/.claude` folder on macOS and Linux. Type `/prune open <id>` (the id is in the toast and in `/prune status`) to read it.

Secrets are masked in the saved copy and in the 300 characters left in the chat: common API key and token formats, Bearer and Basic headers, passwords in URLs, NAME=value lines for names such as PASSWORD, SECRET, TOKEN and API_KEY, and private key blocks (an unfinished block is masked for at most 4,096 characters). Certificates and public keys are kept. Masking uses pattern matching, so an unusual format can slip through, and the saved copy is lossy for masked values. The saved files use default file permissions, so treat the folder as sensitive.

## It deletes nothing

This mod never deletes a file. Saved folders pile up, so `/prune old` lists the ones whose newest copy is 14 days old or more. Clear them yourself when you like.

## Private

No network calls and no model calls. It reads and writes only inside `~/.claude/mods-logs/compaction-pruner/`, plus the one switch file below. Any error during a compaction hands the compaction back to Claude unchanged.

## Switch

`"compaction-pruner": false` in `~/.claude/mods/switches.json` turns it off. `/mods` has the toggle. The mode set with `/prune` is its own setting, kept separately.

## Savings

Each live compaction writes its own record (`ledger.jsonl`) inside its saved folder. The token savings tracker does not read these records, so the savings do not appear in its totals.

## Log

In live mode only, a short one-line-per-event log is kept in the store folder. Dry mode writes nothing.

## Not tested offline

Whether Claude Code keeps the tool-call text on the assistant side of a paired call, and how it treats a very short result, needs a manual test in a real session.
