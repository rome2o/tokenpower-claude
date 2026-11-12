# Install Tokenpower on Mac

## What you need

- A Mac with macOS.
- Claude 2.1.287 or newer in the terminal, or 2.1.286 or newer in the desktop app.

Some mods can use more tools. They work without them.

- large-file-reader reads PDFs only when Poppler is installed (`brew install poppler`), so that `pdftotext` works in a new terminal.
- web-research-saver uses Firecrawl only when you install the Firecrawl command-line tool with npm, so that `firecrawl` works in a new terminal.
- browser-screenshot-compressor makes pictures smaller with `sips`. It is already part of macOS.

## Steps

1. Open Claude.

2. Add the pack. Type this:

   ```
   /plugin marketplace add rome2o/tokenpower-claude
   ```

3. Install the mods. Type each line:

   ```
   /plugin install large-file-reader@tokenpower-claude
   /plugin install effort-level-switcher@tokenpower-claude
   /plugin install subagent-model-router@tokenpower-claude
   /plugin install prompt-cache-timer@tokenpower-claude
   /plugin install context-handoff@tokenpower-claude
   /plugin install web-research-saver@tokenpower-claude
   /plugin install browser-screenshot-compressor@tokenpower-claude
   /plugin install mods-manager@tokenpower-claude
   /plugin install token-savings-tracker@tokenpower-claude
   ```

4. Load them. Type:

   ```
   /reload-plugins
   ```

5. Check them. Type `/mods`. The Mods pane opens and shows each mod. Type `/savings` to open the Token Savings Tracker pane.

## If something goes wrong

- If `/plugin marketplace add` cannot find the repo, check the spelling of `rome2o/tokenpower-claude`.
- If a mod does not work, turn it off in the `/mods` pane. The other mods keep working.
