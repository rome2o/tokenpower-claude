# Tokenpower for Claude

Nine mods for Claude that cut token cost, plus a switchboard to turn each one on or off and a pane that totals what they saved.

Requires Claude 2.1.287 or newer (terminal), or 2.1.286 or newer (desktop app). macOS is the tested platform.

## Install

In Claude:

```
/plugin marketplace add rome2o/tokenpower-claude
/plugin install large-file-reader@tokenpower-claude
/plugin install effort-level-switcher@tokenpower-claude
/plugin install subagent-model-router@tokenpower-claude
/plugin install prompt-cache-timer@tokenpower-claude
/plugin install context-handoff@tokenpower-claude
/plugin install web-research-saver@tokenpower-claude
/plugin install browser-screenshot-compressor@tokenpower-claude
/plugin install mods-manager@tokenpower-claude
/plugin install token-savings-tracker@tokenpower-claude
/reload-plugins
```

Type `/mods` to see every mod and switch each on or off. Type `/savings` for the totals.

## The mods

| Mod | What it does |
|---|---|
| large-file-reader | Haiku reads big files and connector results first. Claude gets short notes and a path to the full content. |
| effort-level-switcher | Picks the effort level each prompt needs and offers to switch to it, or sets it in auto mode. |
| subagent-model-router | Moves a subagent task to a cheaper model when Haiku is confident it is simple enough. |
| prompt-cache-timer | Counts down until the prompt cache goes cold, and can ping it to keep it warm. |
| context-handoff | At 250k tokens, writes a handoff of the chat and starts a fresh chat with it. |
| web-research-saver | Keeps web research out of the main chat. A cheap worker reads pages and returns a short brief with sources. |
| browser-screenshot-compressor | Shrinks browser screenshots, or has Haiku describe them in words. |
| mods-manager | The `/mods` pane. Finds every mod on the machine and switches each on or off. |
| token-savings-tracker | The `/savings` pane. Totals the tokens the other mods saved. |

## Optional tools

- `brew install poppler` lets the large file reader read PDFs.
- The Firecrawl command-line tool (npm) lets the web research saver scrape pages.
- The screenshot compressor uses `sips`, which ships with macOS.

## What they touch

The mods keep shared state under `~/.claude/mods`, `~/.claude/mods-logs` and `~/.claude/handoffs`. Turning a mod off in `/mods` leaves the others running. The web research saver can fetch URLs found in search results, and the context handoff reads the chat transcript to write its summary.

## License

MIT, see `LICENSE`.
