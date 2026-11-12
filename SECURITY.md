# Security

## Reporting a vulnerability

Use GitHub private vulnerability reporting on this repository (Security tab, Report a vulnerability). Please do not open a public issue for a security problem.

## Scope and known limits

- `web-research-saver` fetches URLs that appear in search results. It blocks non-http(s) schemes and local or private addresses. It does not follow redirect chains or resolve DNS itself, so a public URL that redirects to an internal address is not blocked.
- `large-file-reader` reads saved tool outputs only from `~/.claude/projects/<project>/<session>/tool-results/`. The check is on the path text, so a symlink placed inside that folder is not detected.
- Fetched web text is passed to Claude fenced and labelled as untrusted data. This lowers prompt-injection risk but does not remove it.
- `mcp-schema-auditor` reads MCP tool names and token sizes from the session usage report, strips control and hidden characters from server names before display, reads only the mods switchboard file, and writes only its own log file. It has no network access and never edits settings or MCP config.
- `context-bloat-auditor` never reads the contents of your files. It lists sizes the engine reports and hides credential-like file names. A credential-like name is recognised by its text (for example `.env`, `*.pem`, `*.key`, an `.ssh` or `.aws` folder), so an unusual name for a secret file can still be shown. It reads one file, the `/mods` switchboard (`~/.claude/mods/switches.json`), and writes only its own error log under `~/.claude/mods-logs/`.
- `context-meter` reads the token-savings ledger, the `/mods` switchboard (`switches.json`, two booleans) and the engine's usage figures. It never writes the ledger, makes no network calls, and writes only its own log, `~/.claude/mods-logs/context-meter.log`.
- `compaction-pruner` is off by default and makes no network or model call. It deletes nothing and runs no command. Before it shortens a tool result it saves the full text, with API keys, tokens and private key blocks masked, under `~/.claude/mods-logs/compaction-pruner/`. The masking uses pattern matching, so a secret in an unusual format can be saved as it is, and a masked value cannot be recovered from the saved copy. Saved folders are never removed by the mod: `/prune old` lists the ones 14 days old or more, and you clear them yourself. `/prune open <id>` reads only inside that folder (the id is checked, the path is checked, and the file must resolve to a plain file inside the store folder). Saved copies use default file permissions, so treat the folder as sensitive.
