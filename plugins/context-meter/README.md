# context-meter

A live band above the prompt that shows what fills the context window, how close the session is to compaction, what the session has cost so far, and how many tokens the other mods saved today.

## What you see

- A bar split by category (system, tools, memory, messages and so on), with a free-space section and a marker for the auto-compact buffer.
- A percentage badge, coloured green, amber or red by how close the chat is to the compaction point (amber from 70%, red above 90%). It is the share of that point, so it does not match `/context`, which reports against the whole window.
- A legend of the eight largest categories (the bar is ordered the same way), then "compacts at N" (or "auto-compact off"), "saved today N tokens", and "est. session cost $X.XX". Pieces that do not fit the terminal width are dropped, the cost first.
- On a very short terminal everything sits on a single line.

## Where the numbers come from

- Category sizes, the window size and the compaction threshold come from the engine's own usage report. They are an estimate, so they can differ slightly from what `/context` prints.
- The cost is whatever the engine reports for the session, formatted to two decimals. This mod computes no dollar amounts of its own and carries no tables of them.
- "Saved today" is read from the shared savings ledger at `~/.claude/mods-logs/savings.jsonl`, which the other token-saving mods write. This mod only reads it, never writes it. Ledgers larger than 3.5 MB are not read; the band shows "ledger too large to read" instead.

## Controls

- `/context-meter` toggles the band. `/context-meter show` and `/context-meter hide` set it explicitly, and the choice is remembered.
- In `~/.claude/mods/switches.json`, set `"context-meter": false` to switch the mod off, or `"context-meter:hidden": true` to hide the band while keeping the mod loaded.

## Behaviour and limits

- No network calls, and no access to project files, credentials or environment files. It reads the savings ledger and the `/mods` switchboard (`~/.claude/mods/switches.json`, two booleans only) and writes only its own log. All three paths are built from the `.claude` folder the plugin is installed under, which must be `<home>/.claude/plugins/`; otherwise they stay off.
- A plugin installed under a project-level `.claude` folder reads that folder's ledger. macOS and Linux paths only: on Windows the saved-today figure, the switchboard and the log are off.
- The band refreshes after each turn, after a compaction, and every 30 seconds for the savings figure.
- Problems are logged to `~/.claude/mods-logs/context-meter.log`, which is trimmed when it grows large. If anything fails to render, the prompt area falls back to its normal look.
