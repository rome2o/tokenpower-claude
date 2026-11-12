# Context Bloat Auditor

Type `/context-audit` to see which always-loaded items cost the most tokens in this chat: CLAUDE.md and memory files, skills (including skills from plugins), agents, and the slash command total.

The pane shows:

- The 30 biggest memory files, with paths under your home folder shown as `~/...`.
- The 15 biggest skills and the skill total.
- Slash commands as a total only (Claude reports no per-command figure).
- The 10 biggest agents.
- Flags: any item over 2,000 tokens, and possible duplicates (two skills or two agents with the same name, two memory files with the same file name and size).

It is read only. It uses the sizes Claude reports and nothing else. It never reads the contents of your files, never lists, edits or deletes one, and it makes no network call. The only file it reads is the `/mods` switch file, and the only file it writes is its own error log.

## Privacy

- Credential-like files (`.env`, `*.pem`, `*.key`, `.ssh`, `.aws`, `secrets` and `credentials` folders, `credentials.json`, `token.json`, `.netrc`, `.npmrc`, and any name containing `secret`, `credential` or `password`) show only their size and the text "credential-like file, path hidden". Their path and name are never drawn. The test is by name only, so an unusual name for a secret file can still be shown.
- Paths under your home folder show as `~/...`. Any other path shows its last two segments.
- Names are cleaned of control and invisible characters and capped at 60 characters. Common key shapes are masked before the cap (`sk-`, `AKIA`, `AIza`, `ya29.`, `ghp_` and other GitHub tokens, `xox` Slack tokens, `sk_live_`, JWTs, `Bearer` values). Other secret formats are not recognised.
- Project folder names still show inside `~` paths. Set `SHOW_PATHS` to `false` in `hooks/constants.ts` to show file names only.

## Limits

- Counts are estimates and can differ from `/context`.
- A duplicate flag is a hint from names and sizes. Check by hand before you change anything.
- An item is flagged when it is over 2,000 tokens (2,000 exactly is not flagged).
- If your Claude version does not report context items, the pane says so and does nothing.

## Controls

The pane follows the `/mods` switchboard: turning `context-bloat-auditor` off, or setting `context-bloat-auditor:hidden` to true, in `~/.claude/mods/switches.json` stops it. The switch is read when a chat starts and when you run `/context-audit`, so a change made mid-chat takes effect at the next of those. That file is the only one this mod reads.

Errors are written to `~/.claude/mods-logs/context-bloat-auditor.log`. The log holds the current chat only (each chat rewrites it), and nothing is written when the plugin is not installed under a `.claude` folder.
