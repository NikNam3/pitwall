# Architecture

Condensed from spec section 3 (`docs/superpowers/specs/2026-10-28-foundation-design.md`).

## Packages and allowed dependencies

| Package | Role                                                                                                |
| --- |-----------------------------------------------------------------------------------------------------|
| `packages/protocol` | bytes to typed packets (spec 2025 only)                                                             |
| `packages/domain` | JSON-safe domain vocabulary (`Known`, `Corners`, `CarState`, records, `Insight`, ids); leaf package |
| `packages/engine` | race model: pure, no I/O, no clock, no network                                                      |
| `packages/analysis` | analysis calculators                                                                                 |
| `packages/contracts` | topic types and WebSocket messages, shared by bridge and UI; wire-only                              |
| `apps/bridge` | imperative shell: input, frame assembler, engine runner, storage, WebSocket, CLI                    |
| `apps/ui` | Svelte UI: kit, shell, widgets, connection, theme, emphasis, gallery                                |
| `apps/desktop` | Electron host: native windows at saved places, starts or attaches to the bridge (ADR 0010)         |

Allowed edges (everything else is a violation; dependency-cruiser fails the build):

- protocol → nothing
- domain → nothing
- contracts → domain
- engine → protocol, domain
- analysis → engine, domain
- bridge → all packages
- ui → contracts, domain
- desktop → nothing (it only loads the UI and spawns the bridge)

The UI imports neither `engine` nor `protocol`. See ADR 0003 for why `domain` is a separate package.

## Data flow

```
PacketSource (UDP | PwrecFile) → RawPacket → decode → SessionTracker + FrameAssembler → Frame
  → Engine.step(state, frame) → state → Scheduler → calculators (and job triggers → JobRunner → worker)
  → topic values / insights → TopicHub (throttle, per client) → WebSocket → UI
  ↘ PwrecWriter (raw + config sidecar)   ↘ StorageWriter (confirmed history → SQLite)
```

- `SessionTracker` and `FrameAssembler` are pure and live in `packages/engine/src/frame`. The bridge only feeds them packets.
- **Calculators run on demand** (`apps/bridge/src/pipeline/demand.ts`). A calculator runs when:
  - a subscribed topic is bound to it
  - it has an `insights` hook
  - no binding references it and no calculator reads it
  - a needed calculator reads it

  The hub reports demand changes per feed. Newly needed calculators run at once against the current state, also after the session has ended, so a late subscriber gets a value without waiting for a frame.
- **Jobs** (expensive work, later Monte Carlo) are part of features: each job gets a trigger calculator `job:<id>` with the job's `reads` and cadence. Its output (the job's input) goes to the feed's `JobRunner`, which runs the job in a worker. The result is published as `Computed<T>` = `{ computedFor: { lap, frameId }, value }`. A declared job without a binding, or a binding to an undeclared job, fails at startup (`JobDeclarationError`). Job topics are excluded from the determinism hash.

## The UI

Data flows `WebSocket → connection (topic store) → shell (panel frame) → widget component`. The UI is host-agnostic: everything host-specific goes through `Host` (`shell/host/`), implemented by the browser and by Electron's preload (ADR 0010).

Folders in `apps/ui/src` and their rules (dependency-cruiser enforces them):

- `connection/`: the WebSocket client and the topic store (`topic-store.svelte.ts`, rune state per subscription). The only place that talks to the bridge; imports contracts and domain only.
- `kit/`: value cell, tables, charts, canvas, size and stale primitives, folds, `defineWidget`. Imports only `theme`, `emphasis` (and contracts, domain); never shell, connection, widgets or gallery.
- `theme/`: roles, themes, team colours, fonts, CSS variables. `emphasis/`: pure functions from states to theme roles. No colour literal outside them.
- `shell/`: docking (the only importer of `dockview-core`), windows, workbooks, panel frame, commands and keys, link groups, inspector, host. With the gallery, the only importer of the generated widget index.
- `widgets/<name>/`: one folder per display (`widget.ts`, `register.ts`, `<Name>.svelte`, `emphasis.ts`, `gallery.ts`, tests). Imports only kit, theme, emphasis and its own folder (ADR 0012). A widget renders; it does not fetch, subscribe or measure: the panel frame resolves its declared data and passes props.
- `gallery/`: renders every widget at every declared size and state; the only importer of the widgets' `gallery.ts` files.

Tests in `apps/ui` may build engine state for fixtures; the UI never imports engine or protocol in production code.

## Units: analyses and displays

Work is split into units (ADR 0011). A unit is named in kebab-case; its topics are prefixed with the camelCase name (`undercut-card` owns `undercutCard.*`). The topic is the seam between an analysis and the displays that read it. `pitwall where <unit>` lists a unit's files; the catalogue check (`gen:catalogue`) enforces owners and reading rules.

## The analysis layer (sub-project 3)

Three layers, built bottom-up (ADR 0014): calculators (pure maths) → analyses (`packages/analysis/src/<unit>/`, wired into the bridge by `apps/bridge/src/features/<unit>/register.ts`) → displays (`apps/ui/src/widgets/<unit>/`). A display renders only; every decision, threshold and sign convention is computed by an analysis and arrives in the topic value as a `Known` field.

- **Quick calculators** are stateless: a function of the engine view.
- **Incremental calculators** are a fold over the history (`init`, `step`); a flashback re-runs `init`, and a test checks incremental = from scratch.
- `packages/analysis/src/shared/` holds helpers shared by analyses (current-stint laps, our cars, penalty classes). It is not a unit.
- Thresholds live in each unit's `config.ts` (features declare them; `config.json` overrides). `per-lap-rate` owns the rate config that tyre-wear, fuel, ers and battle read.

### Units and topics

| Unit (analysis and display) | Topics | Reads |
| --- | --- | --- |
| `lap-times` (`lap-analysis`, `projected-lap`) | `lapTimes.board`, `lapTimes.projection` | laps, session |
| `gaps` (`timing-tower`, `gap-chart`) | `gaps.intervals`, `gaps.neighbourhood`, `gaps.toCar`, `gaps.gapper` | mini-sector crossings, events |
| `battle` (`battle-cards`) | `battle.cards` | gaps, pace-delta |
| `tyre-wear` (`tyre-life-bar`) | `tyreWear.car` | per-lap-rate, tyre sets |
| `fuel` (`fuel-gauge`) | `fuel.car` | per-lap-rate, session-remaining |
| `ers` (`ers-budget`) | `ers.car` | per-lap-rate |
| `damage` (`damage-card`) | `damage.car` | damage history, pace |
| `car-bands` (`corner-block`) | `carBands.car` | tyre and brake temperatures |
| `incidents` (`incident-feed`) | `incidents.feed` | events, penalties |
| `alarms` (`alarm-list`) | `insights` (alarm kinds) | bands, wear, fuel, damage, penalties |
| `race-moment` | `raceMoment.current` | flag phase, battle, incidents |
| `pace`, `pace-delta`, `per-lap-rate`, `session-remaining`, `lap-classes` | fed into the units above | laps, session |
| `feed-status` | `feed.status` | bridge |

Other SP3 topics: `cars.overview` (assembled in the `cars-overview` feature, with stop count and compound fallback), `car.detail`, `car.telemetry`, `flagPhases`, `laps`, `stints`, `pitStops`, `events`, `session.info`, `replay.status`, `ui.*` and `dev.*`. The dependency graph of the units: `docs/superpowers/specs/2026-10-29-timing-car-monitoring/dependency-graph.html`.

### The race moment

`raceMoment.current` states what the race is doing now (e.g. car care, battle, incident, neutralised). It is computed by `race-moment` from the engine's open flag phase (`EngineView.activeFlagPhase`), the battle cards and the incident feed. Displays use it only to pick emphasis (`emphasis.ts` maps a moment to theme roles), and the top bar shows it. `cause.params` carries what triggered it (battle: car, side, laps to DRS, gap; incident: entry id), so no widget re-derives the trigger.

### Alarms vs insights

An insight is an event on the append topic `insights` (`raised`, `cleared`) with a category and severity. Alarms are the insights of the `alarms` analysis: a fixed set of kinds (`bandOut`, `bandOutLap`, `wearLimitNear`, `fuelShort`, `damageJump`, `warningLast`, `penaltyNew`), each keyed by kind, car and channel. Acknowledging and muting are `uiAction`s stored in the bridge (`ui.alerts`); `alarm-list` shows unacknowledged first. Other insights (advice, later sub-projects) use the same stream but are not alarms.

### Where presentation lives

One place each, never in a widget:

- numbers and units: `apps/ui/src/kit/values/format.ts` (one minus glyph, U+2212; empty string for a non-finite input)
- UI text, wording and reason texts: `apps/ui/src/kit/text.ts`; insight lines: `kit/insight`
- colours and fonts: `theme/` roles; a widget gets a role from its `emphasis.ts` (pure state to role), never a literal
- shared shapes: kit components (`Bar`, `Table`, `Chart`, `CarLabel`, `PositionMark`, corner grids, compound mark)

### Screenshots and fit

The gallery renders every case of every display at every declared size and theme. `fit.spec` checks all of them for overflow and clipping. Screenshots are far fewer: one baseline per display size of the display's first gallery case (the most telling one), default theme, plus kit and shell cells. `SCREENSHOT_BUDGET` caps the total and fails `pnpm check` if exceeded.

## Determinism rules

- The engine never reads the system clock. Time comes only from `sessionTime` and frame IDs.
- Randomness only through an injected, seeded generator.
- The same input stream always produces the same state and the same topic stream.
- Wall-clock time (`receivedAtMs`) exists only in the shell, for diagnostics, except that `SessionTracker` compares receive times (differences only) for the `SEND` grace window, because UID-0 packets carry no usable session time.

## Parallel development

Several agents work in parallel in git worktrees; a supervisor merges. The architecture prevents conflicts on shared files:

- **Registration by convention, no central lists.**
  - A feature is a folder `apps/bridge/src/features/<name>/register.ts`, collected by a generated index (ADR 0005). It declares calculators, jobs, config and topic bindings.
  - A topic is a file `packages/contracts/src/topics/<topic name>.ts`, also collected by a generated index (ADR 0007).
  - A widget is a folder `apps/ui/src/widgets/<name>/register.ts`, collected by a generated index (ADR 0012).
  - `pnpm gen` regenerates the three indexes and the catalogue.
- **Typed bindings:** `bindState`, `bindHistory`, `bindInsights` and `bindJob` (`features/feature.ts`) only compile when the source's value type matches the topic's.
- **Change tags are domain areas** (`session, identity, timing, tyres, energy, condition, dynamics, ownCar` and the history lists), not packet names. A calculator's `reads` uses them.
- **One agent per unit:** `PITWALL_WORKER_UNIT` grants a worker its unit's folders and topic files (ADR 0011).
- **The supervisor owns the shared files:** `packages/domain`, `packages/contracts` (except a unit's own topic files), the UI kit, shell, connection, theme and emphasis, every `package.json`, the lockfile, base types in `engine`. Workers request changes in their report.
- **Ports per worktree:** `PITWALL_WS_PORT`, `PITWALL_UDP_PORT` and `PITWALL_UI_PORT` come from the environment, so parallel instances and Playwright runs do not collide.

## Where state lives

- **Engine state** (`EngineState`): session, one `CarState` per car (identity, timing, tyres, energy, condition, dynamics, own-car data, `updatedAt`), player and teammate ids. Held in memory, advanced only by `Engine.step(state, frame)`. Calculators see it read-only and without the in-progress trackers (`open`).
- **Freshness:** `CarState.updatedAt` holds, per data source, the session time of its last update for that car. `SOURCE_INTERVAL_MS` (domain) gives each source's expected interval, and `feed.status.cadenceMs` the measured menu-rate step. The UI decides when a value is stale; the engine has no stale reason.
- **History:** append-only inside the engine state. Each lap is appended twice, provisional then confirmed. Read laps through `currentLaps` / `addLaps` (domain), which return the current record per car and lap.
- **Calculators:** quick calculators keep no state. Incremental calculators keep an accumulator that is always a fold over a history prefix (tested: incremental = from scratch). Whatever has to be remembered lives in engine state or history.
- **Config:** features declare read-only config (`defineConfig`). `<PITWALL_DATA_DIR>/config.json` overrides it, and calculators read it from `EngineView.config`. Each live session stores its effective config as a sidecar next to its recording, and replays use that sidecar (ADR 0008).
- **Storage:** raw `.pwrec` files per session are the source of truth; one SQLite database (`better-sqlite3`, ADR 0004) is a rebuildable cache written from confirmed history by the bridge. The engine has no database access. The bridge passes the player's earlier sessions of the weekend in as read-only `WeekendContext`, with every driver's records per session. `live` rebuilds an outdated database from the recordings by itself.

- **UI state** (workbooks, link groups, alert acknowledgements, settings): owned by the bridge, published as the `ui.*` topics, stored as files in `PITWALL_DATA_DIR/ui/`, changed only by `uiAction` messages (ADR 0013). Windows hold no persistent state of their own.
- **Window-local UI state:** topic values live in the connection's topic store; panel size, staleness and overlay stacks are runtime state of the window and are rebuilt on reload.

## Second car (later)

Out of MVP scope, but no code may assume a single feed. ADR 0009 lists what the second car will need: storage keyed per view `(sessionUid, playerCar)`, several feeds in one bridge, and a weekend context per driver.
