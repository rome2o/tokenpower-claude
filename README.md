# Tokenpower for Claude: token-saving mods and plugin marketplace

Tokenpower is a Claude plugin marketplace with nine mods that cut token cost: cheaper models read big files, web pages and screenshots first, subagents move to lower tiers, and a pane totals what you saved. Each mod switches on or off on its own.

Requires Claude 2.1.287 or newer (terminal), or 2.1.286 or newer (desktop app). macOS is the tested platform.

## Quickstart

In Claude:

```
/plugin marketplace add rome2o/tokenpower-claude
/plugin install large-file-reader@tokenpower-claude
/plugin install token-savings-tracker@tokenpower-claude
/plugin install mods-manager@tokenpower-claude
/reload-plugins
```

Type `/mods` to see every mod and switch each on or off. Type `/savings` for the totals. The other six mods install the same way, for example `/plugin install web-research-saver@tokenpower-claude`.

## The nine mods

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

## How it saves tokens

- **Progressive disclosure.** A cheap model reads the large input and hands Claude short notes plus a path to the full result, so the full text is read only when needed.
- **Right-sized models and effort.** Subagent tasks and prompts go to the cheapest tier that can do them.
- **Cache and context awareness.** The cache timer and context handoff avoid paying to rebuild a cold or oversized chat.

## Optional tools

- `brew install poppler` lets the large file reader read PDFs.
- The Firecrawl command-line tool (npm) lets the web research saver scrape pages.
- The screenshot compressor uses `sips`, which ships with macOS.

## What they touch

The mods keep shared state under `~/.claude/mods`, `~/.claude/mods-logs` and `~/.claude/handoffs`. Turning a mod off in `/mods` leaves the others running. The web research saver fetches public URLs found in search results and skips local and private addresses. It treats fetched text as untrusted data. The large file reader only opens saved outputs under `~/.claude/projects/`. The context handoff reads the chat transcript to write its summary. See `SECURITY.md`.

## Contributing and license

Built and maintained by Kazim Ali. Issues and pull requests are welcome, see `CONTRIBUTING.md`.

MIT, see `LICENSE`. The subagent-model-router plugin is derived from an MIT-licensed model router and keeps that notice in `plugins/subagent-model-router/LICENSE`.
