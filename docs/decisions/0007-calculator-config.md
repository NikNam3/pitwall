# 0007: Read-only config for calculators, stored with each session

## Status

Accepted (2026-10-28). User decision Q-C of the foundation review.

## Context

Alarms and monitoring need values the engineer chooses: tyre temperature windows, brake temperature limits, fuel targets. ATLAS alarms are user-defined rules (`docs/research/02-atlas-interaction-model.md`). Calculators are pure and saw only engine state, so there was no clean way to pass such values in. Replays must still reproduce the same insights.

## Decision

- **Features declare config:** `defineConfig(key, defaults)` gives a typed `ConfigKey`, and `Feature.config` lists it. Duplicate keys across features are a startup error.
- **Calculators read it:** `EngineView.config` (read-only), via `key.read(view)`, which merges the overrides over the defaults.
- **The engineer overrides it** in `<PITWALL_DATA_DIR>/config.json` (`{ "<key>": { "<name>": value } }`). An unknown key or field, or a value of the wrong type, stops the bridge with a clear message before anything listens.
- **The effective config is fixed per bridge run** and written as `<session file>.config.json` next to each live session's recording.
- **Replays reproduce alarms:** `replay` and `reprocess` use the sidecar next to a recording when it exists, otherwise the current config.
- **Sidecars are read leniently** (they are history): an undeclared key or field is dropped and a wrong-typed value falls back to the feature default, each with a warning, so old recordings stay replayable after a feature changes its config. Invalid JSON or an unreadable sidecar is an error. `config.json` stays strict.

## Consequences

- Thresholds are data, not code; an alarm calculator stays pure and testable.
- The raw truth of a session becomes the `.pwrec` file plus its config sidecar. `import` copies the sidecar along with the recording. `pwrec-cut` does not: a cut segment replays with the current config.
- **Not yet:** changing config at runtime from the UI. When that comes, config changes need a change tag and must be logged into the session (with session time), so a replay still reproduces them.
