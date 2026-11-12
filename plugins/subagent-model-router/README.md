# subagent-model-router

Picks the model each subagent runs on. Before a subagent starts, Haiku reads its task and answers in JSON:

```json
{"tier": "fast", "confidence": 0.86, "effort": 1, "effort_confidence": 0.7, "risky": 0.02}
```

| Tier | Default model | For |
|---|---|---|
| `fast` | `claude-haiku-5-5` | Mechanical and local work: read or summarise a file, run one command, rename a symbol. |
| `balanced` | `claude-sonnet-5-5` | Ordinary engineering: a well-specified change across a few files, tests, a clearly described bug. |
| `deep` | `claude-opus-5-5` | Open-ended or irreversible work: an unknown cause to find, an open design with no spec, or a task whose own execution is final. A long, well-specified brief is not deep, even when it mentions security, review or design. Off by default, see `allowDeep`. |

The judge call goes through `$.model.complete` with `model: "haiku"`. The mod makes no other network call and needs no API key.

## Credit

This is a modified copy of an MIT-licensed Jev model router (see `LICENSE`). The original asked TypeSafe's Jev. This copy asks Haiku in place of Jev.

## Changes in this copy

- **Haiku is the only judge.** The TypeSafe and Vercel AI Gateway paths are gone: no HTTP calls, no key options, no env reads.
- **The downgrade bar works.** The old fallback (`$.model.classify`) gave a label with no confidence, so a task never moved down from Opus. Haiku now gives a confidence from 0 to 1. A task moves to a cheaper model only when that confidence is at least `minDowngradeConfidence` (0.6). It moves to a dearer model only at `minUpgradeConfidence` (0.85) or more. The router is there to save budget, so the up bar is high: Haiku's confidence is its own estimate, and a wrong move up costs real money (an observed run put three well-specified review briefs on Opus at confidence 0.60, $0.65 to $0.94 more each).
- **Opus is opt-in.** `allowDeep` defaults to `false`. While it is off, a `deep` answer from a lower tier is capped at Sonnet, and the card and log say so ("Held at Sonnet: deep needs allowDeep"). A task already on Opus is never moved up; only the downgrade rule can move it. For Opus-only-when-asked behaviour, set `allowDeep` to `true`: the deep tier is then reachable at `minUpgradeConfidence`.
- **Fail-open.** A judge call that errors, runs past `timeoutMs`, or answers with no readable tier keeps the model as it is. A confidence that is not a number from 0 to 1 counts as none: it can never move a task down.
- **Risk forces the deep tier, when allowed.** With `allowDeep` true, `risky` above 0.7 sends the task to `deep`, whatever the tier said. With it false, risk raises a task to Sonnet at most and the log line says it was capped. A task already on the deep tier keeps its exact id (`claude-opus-5-5[1m]` stays as it is).
- **Task text is cut** at 12,000 characters before it goes to the judge, and sits inside `<task>` tags that the judge is told to treat as data.
- **Tiers are full ids.** `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`.
- **Main chat model: never changed.** A model change mid-chat throws the whole prompt cache away.
- **Main chat effort: off by default.** `routeMainEffort` is `false`. When on, it leaves effort alone while `~/.claude/mods-logs/.stably-<session id>` holds `"active":true`.
- **The /mods switch.** `"subagent-model-router": false` in `~/.claude/mods/switches.json` turns every hook into `next(e)`. Read at session start and every 3 seconds.
- **Savings ledger.** When a picked subagent's run ends (`turn.complete`), one line goes to `~/.claude/mods-logs/savings.jsonl` with `"mod":"subagent-model-router"`:
  - `model`: the model it ran on. `replaced`: the model it would have run on. `changed`: true or false.
  - `cost_usd`: `before`, `after` and `saved`, the run's real token counts priced at list price on both models (prices cached 2026-10-06).
  - `before` and `after` are the same token count: a model swap saves dollars, not tokens.
  - `helper`: `{"model":"claude-haiku-5-5","in":…,"out":…}`, the judge call's real token counts.
  - `router`: `"haiku"`.
  - `detail`: a short file in `~/.claude/mods-logs/subagent-model-router/` with the decision and the cost math.
  - No ledger line when the judge gave no decision.
- **Plain log.** `~/.claude/mods-logs/subagent-model-router.log`: the setup line, the first time each hook fires, every spawn, every judge answer with its confidence, and every ledger line.
- **Command.** `/model-router` shows the judge, the bars, the picks in this chat and the saving.

Known limit: when the Agent call names no model, the "replaced" model is the parent's. An agent type with its own model in its definition is not seen here, so its saving can be overstated.

Known limit: Haiku's confidence is its own estimate. It is not calibrated, which is why moving up needs 0.85 and the deep tier needs `allowDeep`. Haiku also over-calls `deep` on long briefs that mention security or review; the deep wording now describes missing direction, not subject matter.

## The pane: Subagent Model Router

On camera the pane is called "Subagent Model Router". The folder, the switch key and `/model-router` keep the old name.

- It opens by itself when Claude starts a subagent. If you close it, it stays closed until you ask for it again.
- Reopen it with every card from this chat: type `/model-router pane` (or `/model-router`), or press Open in `/mods`.
- `"subagent-model-router:hidden": true` in switches.json (the Shown/Hidden button in `/mods`) stops it opening by itself. The routing goes on.
- One card for each subagent: the task, Haiku's tier and confidence, the model it ran on, the model it would have run on, and one plain sentence on why. Kept models get a card too, for example "Kept Opus: confidence 0.45 under the 0.6 bar" or "Held at Sonnet: deep needs allowDeep".
- When the run ends, the card shows the dollars saved (or the extra cost).
- "Details" opens a card: Haiku's whole answer, the time it took, the rule, the risk score, the list prices, the task and the detail file, with a button to open it.
- Tiles on top: subagents, how many moved, dollars saved.
- The mascot is a pixel Claude dispatcher with a blue cap, a signal paddle and three doors (Haiku, Sonnet, Opus). It waves only while Haiku judges a task.
- The `/mods` switch closes the pane, and the pane says "Turned off".
- The log names each task on its spawn, judge and decision lines, for example `spawn general-purpose "Read README.md and say what": ...`, so parallel spawns can be matched.

## Reading the log

```
ready on the Haiku judge (claude-haiku-5-5, 8000ms limit); routing subagent model
judge (general-purpose): tier fast (0.86) · effort 1.0 → medium (0.70) · risky 0.02 · 1240ms
general-purpose: claude-opus-5-5 -> claude-haiku-5-5: fast (confidence 0.86)
judge (general-purpose): tier fast (0.45) · effort 1.0 → medium (0.50) · risky 0.01 · 1180ms
general-purpose: kept claude-opus-5-5: kept claude-opus-5-5, wanted claude-haiku-5-5 (confidence 0.45)
```

- `judge (...)` is what Haiku answered, before the policy.
- `kept ..., wanted ...` means the bar stopped the move.
- `judge gave no answer (...)`, `judge answer unreadable` or `judge call refused` means the model was kept and no ledger line is written.

## Options

```
fastModel:              string  default claude-haiku-5-5
balancedModel:          string  default claude-sonnet-5-5
deepModel:              string  default claude-opus-5-5
minUpgradeConfidence:   number  default 0.85
minDowngradeConfidence: number  default 0.6
allowDeep:              boolean default false (true lets a task move up to the deep tier)
routeSubagentModel:     boolean default true
routeMainEffort:        boolean default false
timeoutMs:              number  default 8000 (Haiku takes about 1.3 s)
logDecisions:           boolean default true
```

## Privacy

The subagent's prompt (cut to 12,000 characters), its description and its agent type go to Haiku through the engine's own model call. Nothing else leaves the machine.

## Tests

```
claude plugin test ~/.claude/mods/model-router
node --test plugins/subagent-model-router/tests/*.test.mjs   # policy logic, no install (Node 22.18+)
```
