# MCP Schema Auditor

Every MCP server you connect adds its tool definitions to every request Claude makes. This mod shows what each server costs, ranked, so you can decide which ones to switch off for a chat.

## Use it

Type `/mcp-cost`. The pane shows:

- the total tokens the MCP tool definitions take in every request, and their share of the compaction window
- one row per server: its name, its tokens in the window, a bar, its deferred tokens and its tool count
- the ten biggest servers, then one line for the rest; bars are relative to the largest server
- a suggestion for each server that takes 5 percent of the window or 5,000 tokens or more: "Consider disabling X with /mcp."

The rows refresh after each turn, after `/compact`, and when you open the pane (unless a refresh is already running, then the pane shows that refresh's rows). `/clear` empties them until the next turn.

## What the numbers mean

- Loaded tokens are the tool definitions that are inside the window now. They are the ones that cost you on every request.
- Deferred tokens are definitions that load only when Claude searches for the tool. They are shown apart and never count toward the total or a suggestion.
- The percentage is of the window Claude measures against, which can be a smaller compaction window than the model's full window.
- All sizes are estimates of tool schemas. Whether a server's instructions text is counted in them has not been verified, and the pane says so.

## What it touches

- Reads only the usage figures Claude reports for this chat. It does not read tool arguments, tool results or any MCP config.
- Shows server names exactly as the servers report them, after stripping control characters and cutting each to 60 characters.
- Changes nothing. It never edits your config and never toggles a server; the suggestion is text.
- Reads `~/.claude/mods/switches.json` for the `/mods` on/off and hide switches.
- Writes only the newest error lines of the current session to `~/.claude/mods-logs/mcp-schema-auditor.log`. Each session replaces the file, and long token-like strings in error text are cut out.
- Reads and writes those files only when the plugin folder sits under `~/.claude/`. Loaded from anywhere else (a checkout, `--plugin-dir`, a Windows path) it touches no file.
- No network, no model calls, no shell commands.

## Turn it off

Use `/mods`, or set `"mcp-schema-auditor": false` in `~/.claude/mods/switches.json`. Set `"mcp-schema-auditor:hidden": true` to keep the pane closed.

If your Claude version does not report MCP tool sizes, or reading them fails before any rows were shown, the pane says so.
