# Strategy: live race calls (sub-project 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** computed answers for the race's strategy decisions (box now or later, compound, undercut or cover, box under SC/VSC, weather switch), plus the track map with official turn numbers, the radio window and the forecast, with practice feeding the race through stored knowledge.

**Architecture:**
- **`packages/analysis`:** functions, two **simulators** (`lap-model`, `race-forecast`: pure, plain arrays in, typed arrays out), three calculators (`track-geometry`, `degradation`, `pit-loss`) and thirteen analyses, one folder per unit. The forecast scoreboard (`forecast-score`, Task 29a) is a calculator plus a pure scoring function; the bridge collects its log through an output tap.
- **Knowledge** copies ADR 0008: `EngineView.priors` fixed per session, `definePriors`, contributions stored per source session by the bridge, a `<session>.priors.json` sidecar (ADR 0015).
- **`apps/bridge/src/features/<unit>/`** registers calculators, binds topics, declares config, priors and contributions.
- **`apps/ui/src/widgets/<display>/`:** twelve new widgets that only render, plus ghost lines on `gap-chart` and turns in `incident-feed`.

**Tech stack:** existing only. TypeScript (strict, type stripping), Vitest, fast-check, Svelte 5, uPlot, canvas, Playwright, Electron, better-sqlite3. No new dependency in pitwall. The FastF1 import script is Python and lives in its own repo (Task 6).

**Spec:** `docs/superpowers/specs/2026-10-30-strategy-live-calls-design.md`. Contracts: its Appendix A. Config defaults: Appendix B. Build order: section 12. Test rules: `docs/testing.md`.

## Global Constraints

- **CLAUDE.md "Rules" apply verbatim:**
  - units: ms, m, km/h, °C, psi, kg, J, rad
  - missing data is `Known`, never 0
  - no `enum`, namespaces or parameter properties
  - relative imports end in `.ts`
  - `packages/analysis` is pure: no clock, no `Math.random`, no I/O
  - expected problems are values, exceptions are bugs
  - registration by convention, no central lists
- **The existing architecture stays** (spec 1.4, item 10). Additions only, in the existing kinds. The only shape changes are `IncidentWhere.turn`, `Moment` `'window'` and `gap-chart` reading `rejoin.car`.
- **Displays render, analyses compute** (ADR 0014). Any arithmetic on topic values beyond formatting is a review finding.
- **A display never shares its unit name with an analysis** (spec 8.2).
- **Contracts are binding.** Task 1 commits every value type, topic file, calculator id, simulator signature, priors key and config declaration. Unit workers treat them as read-only; changes go under "Requested changes to supervisor-owned files".
- **Calculator outputs** follow SP3. A per-car analysis outputs `Record<CarId, Value>`, and the binding's `select` picks `params.carId`. Strategy analyses fill only our cars (`session.info` `playerCar`, `teammateCar`); any other car is `notApplicable`. The `forecast-score` calculator (Task 29a) forecasts the whole field and has no topic.
- **Cadence** (spec 1.4, item 9): strategy units run on `lapCompleted`, `pitStop`, `flagChange` and `{ hz: 1 }`, **never `'frame'`**. Only `track-positions` and `radio-window` place cars per frame, and only by lookups into precomputed geometry.
- **Budgets** are tests (spec 10.3, `test-support/bench.ts`). A miss is profiled and fixed. A budget is never raised without the user.
- **Numbers only, no verdicts.** No text such as "BOX", "undercut works" or "switch now". **The game's pit window** (`SessionState.pitWindow`) is never read by any unit.
- **Rivals do not stop in 4a forecasts.** A rival past its tyre life is marked `stopDue`.
- **Turn labels come only from turn files.** A detected corner never gets a number. Without a file, the label is `unknown('notApplicable')` and the sector stays.
- **Realism:** an analysis passes `unknown('realism')` through. A rival whose wear is hidden uses the `age` basis. Positions stay visible (GPS).
- **Priors in tests are pinned:** builders, or `fixtures/priors/*.json`. A test never reads `PITWALL_DATA_DIR`.
- **Test data** follows `docs/testing.md`:
  - segments ≤ 1 MB (plus the three full-lap segments)
  - several laps → builder data
  - no recording facts
  - whole recordings only in acceptance, for the determinism set and reprocess
- **Who runs which tests** (as in the SP3 plan; user, 2026-10-29). Set `PITWALL_FIXTURES_DIR=/home/nklx/dev/personal/pitwall/recordings` for every run.
  - Test agents run only their new files, once.
  - Implementers run their task's files, then `pnpm eslint <changed files>` and `pnpm depcruise` once at the end.
  - Reviewers run nothing.
  - The supervisor runs `pnpm check` after every three to four merges, and `test:ui` and acceptance in Task 45. Never while an agent edits source.
- **Two phases per unit,** worker env `PITWALL_PHASE=<test|implement> PITWALL_WORKER_UNIT=<unit> PITWALL_WORKER_SCOPE=<folders>`, one worktree per task under `../pitwall-wt/<task>`. Implementers never touch tests, `test-support/`, `fixtures/` or a widget's `gallery.ts`.
- **Centralise presentation:** formats in `kit/values/format.ts`, texts in `kit/text.ts` or the widget's `text.ts`, colours as theme roles.
- **Questions during the run** go into `docs/superpowers/plans/2026-10-30-strategy-live-calls-questions.md` (lettered options, what was built, a recommendation, an empty `**Answer:**`). Work continues on the built option.
- **Agents:** at most eight at once, reviewers included.
- **Commits** end with a blank line and `Co-Authored-By: <model name> <noreply@anthropic.com>`. Only the supervisor bumps `CONTRACT_VERSION` and `SCHEMA_VERSION`.

## Review Focus

Five conditions the spec implies but its happy path doesn't spell out. Each has a test in its owning task.
1. **A flashback across a pit stop.** The stop, its pit-loss sample, the new stint's fit and the ghost must equal a fresh run over the truncated history. No stop is counted twice. (Tasks 12, 13, 26: flashback property plus `a flashback before the stop removes its sample and the new stint`.)
2. **The first race at a new track:** no contributions, no stop yet. Every call shows numbers from the defaults with source `default`, not `unknown` everywhere and never 0. (Tasks 12, 26, 28: `with no samples the loss is the default with source default`.)
3. **Reprocessing a session twice.** The store holds one contribution per session and key, and the next session's priors are unchanged. (Task 3.)
4. **A retired car, a car in the pit lane and a lapped car at forecast time.**
   - A retired car is out of the crossing order and the forecast.
   - A car in the pit lane is placed at its pit-exit projection.
   - A lapped car appears in traffic but doesn't count as a position ahead.
   (Tasks 18, 26: `retired car is not in the order`, `lapped car is traffic, not a position`.)
5. **Our car under an active SC.** `rejoin` uses the SC loss and today's compressed gaps, `sc-call` expands, and the ghost lines don't jump on the green lap after. (Tasks 26, 28: `under an active SC the SC condition uses live gaps`.)

## Build order

Spec section 12 is the schedule:
- **Level 0** (Tasks 0–7). Task 1 first and alone. Tasks 2, 3, 4, 5, 6, 7 follow in parallel; Task 3 needs Task 2.
- **Then each unit** (Tasks 8–43) goes through test phase, ruling, implement phase, review, merge.
  - A unit's **test phase** may start once Tasks 1 and 4 are merged.
  - A display's test phase also needs Task 0's approval.
  - The **implement phase** may start once every task in its **Depends on** is merged.
- **Scheduler rule:** a free slot goes to
  1. a ready implementation on the critical path (Tasks 10 → 17 → 26, 13 → 18)
  2. another ready implementation, the one with the longest chain of readers first
  3. a pending review
  4. the next test phase, lowest level first, analyses before displays
- **End:** Task 44 once all displays are merged, then Task 45. Task 29a has no display and runs whenever a slot is free after its dependencies.

| Level (spec 12.2) | Tasks |
|---|---|
| 0 | 1 → 2 → 3; 0, 4, 5, 6, 7 |
| 1 | 8 `track-lookup`, 9 `tyre-life`, 10 `lap-model`, 11 `track-geometry`, 12 `pit-loss`, 13 `degradation`, 14 `weather`, 15 `raising-average`, 16 `lap-overview` |
| 2 | 17 `race-forecast`, 18 `forecast-field`, 19 `pit-losses`, 20 `stint-analysis`, 21 `track-positions`, 22 `radio-window`, 23 `crossover`, 24 `pit-window`, 25 `incidents` turn |
| 3 | 26 `rejoin`, 27 `undercut`, 28 `sc-call`, 29 `pit-sweep` |
| 4 | 29a `forecast-score`: its calculator, `scoreForecasts`, the output tap, `pitwall score` |
| displays | 30–43, each after its analysis's contract (test phase) and Tasks 0, 7 (implement phase) |
| end | 44, 45 |

**Common files of a unit task** (as in the SP3 plan, not repeated below):
- `packages/analysis/src/<unit>/{index,<unit>,calculator,config}.ts`, tests in `packages/analysis/test/<unit>/`
- `apps/bridge/src/features/<unit>/register.ts`, binding tests in `apps/bridge/test/features/<unit>/`
- a display: `apps/ui/src/widgets/<display>/` with `widget.ts`, `register.ts`, `<Name>.svelte`, `emphasis.ts`, `emphasis.test.ts`, `gallery.ts`, `text.ts`

**Common tests:**
- **Every incremental calculator:** `flashback equals fresh run` and `incremental equals from scratch` (`expectIncrementalEqualsFromScratch`).
- **Every per-car topic:** `select` returns the value for `params.carId` and `undefined` for an unknown car.
- **Every analysis:** each output field becomes `unknown(reason)` when its input is missing (`notReceived`, `insufficientData`, `realism`, `notApplicable` for a car that isn't ours).
- **Every strategy analysis:** a budget test (`< 5 ms` per run on `benchField()`, unless the task says otherwise), and `never reads SessionState.pitWindow` (the test sets `pitWindow` to absurd values and expects identical output).
- **Every display:** gallery cases for compact and full mode, a realism-hidden case, an `unknown` case, and each emphasis state; emphasis tests per branch; the fit expectations in `gallery.ts`.

---

### Task 0: Mockups of all twelve displays and two workbooks (user gate)

**Goal:** the user approves how every display looks, in one session (spec 8.4).

**Done by:** the supervisor, with the user. Not a two-phase task. **Depends on:** Task 1 (the contracts the mockups show).

**Blocks:** every display's test phase (Tasks 30–43) and Task 44.

- [ ] Write full HTML documents in `docs/brainstorms/2026-10-30-sp4a-displays/`, one per display of spec 8.2, plus the `gap-chart` ghost lines and the `incident-feed` turn. Each shows compact and full mode at the theme's font size, with the real theme roles, colour only to highlight or distinguish, our cars white, and the source badge on prior-based values.
- [ ] Add `0-layouts.html` with the `strategy` and `longrun` workbooks (spec 9) on the 24" and the 14" monitor.
- [ ] Screenshot every document with the cached headless Chromium (`~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell --no-sandbox --hide-scrollbars --window-size=1500,1500 --screenshot=<scratchpad>/x.png file://…`) and check each one before showing it.
- [ ] Get the user's approval. Record column priorities, size modes and layouts in `docs/brainstorms/2026-10-30-sp4a-displays/README.md`.
- [ ] Commit: `docs: approved sub-project 4a display mockups`.

---

### Task 1: Contracts, config, ADR 0015

**Goal:** every interface between the parts exists as code before any unit starts (spec 3, Appendix A and B).

**Done by:** the supervisor. Not a two-phase task. Verified by `pnpm gen`, `pnpm typecheck`, `pnpm depcruise`, `pnpm check`.

- [ ] `packages/domain/src/knowledge.ts`: `Lifetime`, `KnowledgeSource` (A.1). `tracks.ts`: `TrackTurn`, `TrackTurns`. `analyses/track.ts`: `MapPoint`, `Corner`, `Straight`, `TrackGeometry`. `incidents.ts`: `IncidentWhere.turn`, filled with `unknown('notApplicable')` where entries are built today. `race-moment.ts`: `'window'` in `Moment` between `'neutralised'` and `'incident'`, with a `kit/text.ts` name.
- [ ] `packages/domain/src/analyses/`: one file per new analysis with the value types of spec A.3, named after the analysis (`pit-losses.ts`, `stint-analysis.ts`, `raising-average.ts`, `lap-overview.ts`, `rejoin.ts`, `undercut.ts`, `sc-call.ts`, `pit-sweep.ts`, `pit-window.ts`, `track-positions.ts`, `radio-window.ts`, `weather.ts`, `crossover.ts`), plus `strategy.ts` with `PitCondition`, `PitLossSample`, `CompoundFit`, `StintFit`. Export them from the package index.
- [ ] `packages/engine/src/calc/priors.ts`: the `PriorsKey` type and `definePriors` signature (A.2). It throws `not implemented` until Task 3. `EngineView` gains `priors`.
- [ ] `packages/analysis/src/<unit>/index.ts` for every unit of Tasks 8–29a: the exported types, signatures and calculator ids of A.2, and the priors keys:
  - `PIT_LOSS_PRIORS` (`'pit-loss'`, `track`)
  - `DEGRADATION_PRIORS` (`'degradation'`, `weekend`)
  - `TRACK_GEOMETRY_PRIORS` (`'track-geometry'`, `track`)
  - `TRACK_TURNS_PRIORS` (`'track-turns'`, `reference`, default `null`)

  Bodies throw `not implemented`.
- [ ] `packages/contracts/src/topics/`: the 14 topic files of A.3, with the names fixed in the spec: `pitLosses.track`, `stintAnalysis.car`, `raisingAverage.car`, `lapOverview.car`, `rejoin.car`, `undercut.car`, `scCall.car`, `pitSweep.car` (params `{ carId: CarId; compound: ActualCompound }`), `pitWindow.car`, `trackPositions.geometry`, `trackPositions.cars`, `radioWindow.car`, `weather.forecast`, `crossover.field`.
- [ ] `packages/analysis/src/<unit>/config.ts` for every Appendix B row: flat fields, each with a source comment. **R3 happens here.** Look up community values for F1 25 (F1 24 where 25 has none):
  - pit loss per track and condition
  - dirty-air coefficients
  - overtaking threshold (TUM's value as the start)
  - wear limit
  - `γ`

  Where a source differs from the spec's default, use the source's value and write the URL. Otherwise write "pitwall estimate".
- [ ] `gen:catalogue`: a folder whose `index.ts` exports `kind = 'simulator' as const` is listed as kind `simulator`. ADR 0014 gets one line naming simulators.
- [ ] `docs/decisions/0015-knowledge-priors-and-contributions.md` (spec 4).
- [ ] Docs:
  - `docs/architecture.md`: priors, simulators
  - CLAUDE.md map: `data/tracks/`; the ADR list gets "knowledge priors"
  - the foundation spec's roadmap table (spec 2)
- [ ] Create the questions file with its header.
- [ ] Commit: `feat(contracts): sub-project 4a contracts, config and ADR 0015`.

---

### Task 2: Storage session key

**Goal:** sessions whose UID the game reuses are stored side by side (spec 3.3).

**Scope:** `apps/bridge/src/storage`, `apps/bridge/src/cli/rebuild-database.ts`, `apps/bridge/test/storage`. **Depends on:** Task 1. The supervisor bumps `SCHEMA_VERSION` to 2 in the test commit.

**Interfaces:**
- Produces: `sessions.session_key TEXT PRIMARY KEY` = `` `${uid}-${startedAt}` ``. Every child table references `session_key`; `session_uid` stays as a plain indexed column. `SessionRow` gains `sessionKey: string`.
- A database of version 1 is renamed to `pitwall.v1.sqlite` with a log line, and a new one is created. (Nothing reads v1; `pitwall reprocess` rebuilds it.)

**Tests** (`apps/bridge/test/storage/session-key.test.ts`):
- `two sessions with the same uid and different start times are stored side by side`
- `laps of the second session do not overwrite the first's`
- `a version 1 database is moved aside and a version 2 one created`
- segment test: `practice and race of the UID-reuse weekend both land in the store` (the Zandvoort pit-exit segment and a few seconds of `practiceZandvoortUidReuse`, cut in Task 5)

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 3: Priors and contributions

**Goal:** knowledge flows from stored sessions into a run, and back out per session (spec 4, ADR 0015).

**Scope:**
- `packages/engine/src/calc/{priors,scheduler,types}.ts`
- `apps/bridge/src/knowledge/` (new)
- `apps/bridge/src/features/feature.ts`
- `apps/bridge/src/pipeline/feed-pipeline.ts`
- `apps/bridge/src/cli/commands/{replay,reprocess,live}.ts`
- their tests

**Depends on:** Tasks 1, 2.

**Interfaces:**
- Produces:
  - `definePriors<P, C>(key, lifetime, defaults, aggregate)`; `read(view)` returns `view.priors[key]`, or `defaults` when absent.
  - `Feature.priors?: PriorsKey<unknown, unknown>[]`
  - `Feature.contributions?: { calculator: CalculatorId; key: PriorsKey<unknown, unknown>; pick(output: unknown): unknown | undefined }[]`
- `apps/bridge/src/knowledge/store.ts`:
  - table `knowledge (key TEXT, scope_id TEXT, session_key TEXT REFERENCES sessions, laps INTEGER, json TEXT, PRIMARY KEY (key, scope_id, session_key)) STRICT`
  - `saveContribution(db, c: { key; scopeId; sessionKey; laps; value }): 'written' | 'keptFuller'`: replaces the row only when `laps` ≥ the stored row's `laps` (laps = the leader's completed laps when the contribution was taken)
  - `loadContributions(db, key, scopeId): unknown[]` in `session_key` order
- Scope ids: `track:<trackId>` and `weekend:<weekendLinkIdentifier>-<trackId>`.
- `apps/bridge/src/knowledge/priors.ts`: `loadPriors(db, features, session): Record<string, unknown>`.
  - It aggregates each declared key over its scope.
  - `reference` keys are read from `data/tracks/<trackId>.json`, resolved from the repository root like the default workbooks. A missing file gives `null`.
- `apps/bridge/src/knowledge/sidecar.ts`: `sessionPriorsPath(recording) = recording + '.priors.json'`, read leniently like the config sidecar.

**Requirements:**
1. Priors are loaded when the pipeline starts a session (its session-change path) and stay fixed until the next session.
2. `live` writes the sidecar at session start, and saves contributions at every `lapCompleted` and at session end.
3. `replay` and `dev` store nothing (existing rule), contributions included. They use the sidecar, or empty priors when there is none; `--fresh-priors` loads from the store instead.
4. `reprocess` uses the sidecar unless `--fresh-priors`, and replaces each session's contributions.
5. `EngineView.priors` reaches every calculator like `config` does.

**Tests:**
- engine: `read falls back to the defaults when the key is absent`; `priors reach the calculator through the view`
- bridge:
  - `reprocessing a session twice keeps one contribution per key` (Review Focus 3)
  - `replay and dev of a session write no contribution, even to lap 5 of a stored race`
  - `a contribution covering 5 laps does not replace one covering 40 laps of the same session`
  - `aggregate sees the contributions of every session in the scope and none outside it`
  - `a weekend key ignores another weekend at the same track; a track key includes it`
  - `replay with a sidecar gives the live run's priors`
  - `--fresh-priors loads from the store`
  - `a missing turn file gives null`
  - `a sidecar with an unknown key drops it with a warning`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 4: Builders and the benchmark harness

**Goal:** one vocabulary for strategy test data, and budgets as tests (spec 3.4, 10.1).

**Scope:** `test-support/builders`, `test-support/bench.ts`, `fixtures/priors/`. **Done by:** one agent, single phase. **Depends on:** Task 1.

**Interfaces (produces), in `test-support/builders/index.ts` next to the existing builders:**
- `pitStop(over?: Partial<PitStopRecord>): PitStopRecord`. Defaults: car 0, lap 10, green, pit lane 22 000 ms, stationary 2 500 ms.
- `stint(over?: Partial<StintRecord>): StintRecord`
- `degradedField({ cars, laps, paceMs, degMsPerLap, stops? })`. Like `field`, with each lap slower by `degMsPerLap × tyreAge`. A stop resets the age and adds `inLapExtraMs: 4000`, `outLapExtraMs: 18000`. Returns `{ laps, stints, pitStops, miniSectors }`.
- `ovalPositions(lengthM: number, binM: number): MapPoint[]`: a stadium shape with two 600 m straights and two 180° corners, for geometry tests.
- `priors(over?: Record<string, unknown>)`, and `engineView({ …, priors })`.
- `carModel(over?: Partial<CarModel>): CarModel`. Defaults: base 90 000, age basis, deg 50 ms/lap, fuel 0.
- `benchField(): { field: ForecastField; params: ForecastParams }`: 20 cars, 70 laps.

**`test-support/bench.ts`:** `withinBudget(name: string, budgetMs: number, fn: () => void, opts?: { runs?: number; warmup?: number }): void` (defaults 30 and 5). It fails with `"<name>: median <x> ms > budget <y> ms"`.

**`fixtures/priors/empty.json`** (`{}`) and **`fixtures/priors/zandvoort.json`** (pit loss samples and a soft and a medium fit, hand-set).

**Tests** (`test-support/builders/strategy-builders.test.ts`):
- `degradedField lap times grow by degMsPerLap per tyre age and reset after a stop`
- `ovalPositions has two straights of 600 m`
- `withinBudget fails when the median exceeds the budget`

- [ ] Built · [ ] review · [ ] merged

---

### Task 5: Segments (R2)

**Goal:** the real-data cases 4a needs, as committed segments (spec 10.1, `docs/testing.md` §3).

**Done by:** the supervisor. **Depends on:** nothing left: the `perf/full-laps` work (the 20-car race-lap segment) is merged (ba032e0).

- [ ] Check the existing segments for reuse: `race-zandvoort-pit-stop`, `race-zandvoort-pit-exit` (green stop), `race-zandvoort-vsc`.
- [ ] Search `raceZandvoortUidReuse` and `raceSingaporeWet` for a stop under VSC or SC (`PitStopRecord.flag`). If one exists, cut the pit-lane entry to the exit (≤ 1 MB) as `race-<track>-<vsc|sc>-stop`. If none exists, record that in the questions file; the case stays covered by builders.
- [ ] Cut `race-singapore-wet-crossover`: a moment where a car on intermediates sets a faster sector than our car on slicks (or the reverse) in `raceSingaporeWet`. ≤ 1 MB.
- [ ] Cut `practice-zandvoort-uid-reuse-start` (a few seconds) for Task 2.
- [ ] Record each one in `fixtures/index.json` with its verified facts. Facts help pick a segment; they are not assertions.
- [ ] Commit: `test: sub-project 4a segments`.

---

### Task 6: Turn files (R1)

**Goal:** official turn numbers for the league's tracks (spec 6.4).

**Done by:** the supervisor (research and script), with the user for the licence decision. Outside the worker run. **Depends on:** Task 1 (the `TrackTurns` type).

- [ ] Check FastF1 `get_circuit_info()`:
  - its corner fields (number, letter, distance)
  - which F1 25 track ids it covers (`TRACK_NAMES`)
  - the terms of the underlying data

  Write the findings to `docs/research/09-turn-data.md`.
- [ ] Ask the user: commit the files, or generate them locally into the data dir (spec 14, item 3). Record the answer in the questions file.
- [ ] Create the repo `~/dev/personal/pitwall-trackdata` with a script `turns.py <season> <event> <trackId> <gameTrackLengthM>`. It writes `TrackTurns` JSON with the distances scaled by `gameTrackLengthM / realLengthM`, and a `source` naming the event and both lengths.
- [ ] Generate files for Zandvoort (26) and Singapore (12), then for the league calendar, into `data/tracks/` (or the data dir, per the user's answer).
- [ ] Commit: `data: official turn files for <tracks>`.

---

### Task 7: Kit pieces: track outline, ghost marker, source badge

**Goal:** the pieces two displays share are built first (spec 8.3).

**Scope:** `apps/ui/src/kit/{track,ghost,source}`, kit gallery cells. **Depends on:** Task 1; the look follows Task 0.

**Interfaces (produces):**
- `TrackOutline.svelte`, a canvas with props:
  - `geometry: TrackGeometry`
  - `markers: { point: MapPoint; role: Role; label?: string; shape: 'dot' | 'ghost' | 'incident' }[]`
  - `turnLabels: boolean`

  It fits the outline into its box, keeping the aspect ratio.
- `ghostRole` in `emphasis/`. A `GhostMark.svelte` for tables (crossing order).
- `SourceBadge.svelte` with props `source: KnowledgeSource`. Text via `kit/text.ts`: `measured · 6 stops`, `stored · 3 sessions`, `default · <note>`.

**Tests:**
- `outline transform fits a 600 × 300 track into a 200 × 200 box centred with equal scale` (pure function `fitTransform`)
- `source text for each kind`
- gallery cells for each piece

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 8: `track-lookup`

**Unit:** function. **Depends on:** Tasks 1, 4.

**Interfaces:** produces, from `packages/analysis/src/track-lookup/index.ts`:
- `segmentAt(g: TrackGeometry, distanceM: Metres): { kind: 'corner'; corner: Corner } | { kind: 'straight'; straight: Straight } | { kind: 'other' }`
- `nextStraight(g, distanceM): { straight: Straight; distanceToM: Metres }`, wrapping over the line
- `pointAt(g, distanceM): MapPoint`, interpolated between bins
- `turnAt(g, turns: TrackTurns | null, distanceM): Known<string>`: the label of the turn whose apex is nearest within the corner at that distance; `notApplicable` when there's no file or the distance isn't in a corner

**Tests:**
- `on the oval, 300 m is on the first straight`
- `next straight from the last corner wraps over the line`
- `pointAt halfway between two bins is their midpoint`
- `turnAt without a turn file is notApplicable`
- `turnAt inside a corner with T1 and T2 apexes picks the nearer`
- property: `pointAt(d) equals pointAt(d + lengthM)`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 9: `tyre-life`

**Unit:** function. **Depends on:** Tasks 1, 4.

**Interfaces:** produces `lifeEndLap(stint: StintFit, now: { lap: number; wearPct: Corners<Known<Percent>>; tyreAge: number }, cfg: { wearLimitPct: number; ageLossLimitMs: number }): Known<number>`.
- **Wear basis:** the first lap at which any corner reaches `wearLimitPct` at its rate.
- **Age basis:** the age at which `degMsPerLap.mean × age` reaches `ageLossLimitMs`.

**Tests:**
- `wear 40 % rising 3 %/lap with limit 70 reaches it in 10 laps`
- `the fastest-wearing corner decides`
- `age basis with deg 100 ms/lap and limit 2000 ends at age 20`
- `unknown deg is insufficientData`
- `a hidden rival (realism) uses the age basis`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 10: `lap-model` (simulator, critical path)

**Unit:** simulator. **Depends on:** Tasks 1, 4.

**Interfaces:** produces `predictLaps(car: CarModel, fromLap: number, count: number, gapAheadMs: number, p: ForecastParams, out: Float64Array): void` and `lapTime(car, ageOffset, fuelKg, gapAheadMs, p): number`. These implement spec 5.2's formula term by term. `predictLaps` writes only into `out` and allocates nothing.

**Tests:**
- `age basis: lap k is base + offset + deg·(age+k) + γ·fuel`
- `wear basis: lap time follows msPerWearPct × wear`
- `fuel falls by burn per lap and the γ term with it`
- `dirty air applies only for gaps in [200, 1350] ms`
- property: `with deg ≥ 0 and burn 0, predicted laps never get faster`
- budget: `predictLaps for 70 laps × 20 cars < 0.2 ms`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 11: `track-geometry`

**Unit:** calculator (incremental, cadence `lapCompleted`). **Depends on:** Tasks 1, 3, 4. Segment test: Tasks 5, 6.

**Interfaces:** produces output `Known<TrackGeometry>` and the contribution `{ bins: { medianX; medianZ; count }[] }`, plus `TRACK_GEOMETRY_PRIORS` and its aggregate (count-weighted median merge).

**Requirements:**
- Samples come from every car's `motion.position` and `timing.lapDistanceM` per frame. They go into the accumulator in `update` and are folded into bins at each `lapCompleted`. A sample from a car in the pit lane or on an invalid lap is not used.
- Corners: curvature above `cornerCurvature`, merged when closer than `binM × 4`. Straights: stretches longer than `straightMinM`.
- The prior's bins seed the accumulator.

**Tests:**
- `the oval gives two corners and two straights`
- `pit lane samples are ignored`
- `a prior alone gives a known geometry before any lap`
- `insufficientData before the first full lap without a prior`
- `curvature-based corners exist with realism on`
- segment (the 20-car full-lap segment): `every turn of the Zandvoort file lies within turnSnapM of a detected apex, in order`
- budget: `fold at lapCompleted < 1 ms`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 12: `pit-loss`

**Unit:** calculator (incremental, cadence `pitStop`, `lapCompleted`). **Depends on:** Tasks 1, 3, 4.

**Interfaces:** produces `PitLossOut` (A.2), contribution `{ samples: PitLossSample[] }`, `PIT_LOSS_PRIORS` (aggregate: concatenate the samples, median per condition).

**Requirements:**
- `loss = inLap + outLap − 2 × reference`, where reference is the median of the car's `forPace` laps within `referenceLaps` before the stop.
- The stationary time above the condition's median is subtracted.
- A sample becomes known once the out-lap completes.
- Source: `measured` (this session's samples exist), `stored` (prior only), `default` (neither).

**Tests:**
- `a green stop with in 94 s, out 108 s, reference 90 s gives loss 22 s`
- `a stop flagged vsc is a vsc sample`
- `stationary time above the median does not raise the loss`
- `with no samples the loss is the default with source default` (Review Focus 2)
- `stored samples merge with measured ones; source measured`
- `a flashback before the stop removes its sample` (Review Focus 1)
- `a stop without reference laps is insufficientData for that sample, not 0`
- segment (`race-zandvoort-pit-stop` + `pit-exit`): `the real stop yields one sample classed green with the record's stationary time`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 13: `degradation` (critical path)

**Unit:** calculator (incremental, cadence `lapCompleted`, `pitStop`). **Depends on:** Tasks 1, 3, 4.

**Interfaces:** produces `DegradationOut` (A.2), contribution `{ compounds: CompoundFit[]; gamma: { value; laps } }`, `DEGRADATION_PRIORS` (aggregate: inverse-variance weighted mean per compound).

**Requirements:**
- A Kalman filter per car and stint over `forPace` laps:
  - the state is `[α, ν]`
  - the observation is the lap time minus `γ × fuel`
  - the process noise and `outlierSd` come from config
  - a stop starts a new filter from the compound's prior
- A residual above `+outlierSd·σ` inflates that observation's variance. A negative residual never does.
- The wear basis needs the car's wear known. Otherwise (realism, restricted) the basis is `age`.

**Tests:**
- `degradedField at 50 ms/lap gives ν within 5 ms after 10 laps`
- `σ of ν shrinks as laps arrive`
- `one lap +3 s slower moves ν by less than 5 ms; one lap −3 s faster moves it fully`
- `a stop starts a new stint fit seeded from the compound prior`
- `a flashback before the stop removes the new stint` (Review Focus 1)
- `a rival hidden by realism has basis age`
- `the weekend prior seeds the first stint`
- property: `incremental equals from scratch`
- budget: `update per lap for 20 cars < 1 ms`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 14: `weather` → `weather.forecast`

**Unit:** analysis (quick, cadence `sessionChange` and on the `session` change tag). **Depends on:** Tasks 1, 4.

**Tests:**
- `only samples of the current session type, in offset order`
- `firstRain is the first sample at or above rainPct`
- `no rain sample gives notApplicable`
- `accuracy passes through`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 15: `raising-average` → `raisingAverage.car`

**Unit:** analysis (incremental, `lapCompleted`). **Depends on:** Tasks 1, 4.

**Tests:**
- `laps 90, 91, 92 give means 90, 90.5, 91`
- `invalid laps are excluded`
- `a flashback removes the truncated laps`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 16: `lap-overview` → `lapOverview.car`

**Unit:** analysis (incremental, `lapCompleted`). **Depends on:** Tasks 1, 4.

**Tests:**
- `in and out laps are marked`
- `heat is 0 for the stint's best forPace lap and 1 for its worst`
- `heat of a non-forPace lap is notApplicable`
- `a lap with scShare > 0 has status sc`
- `the session best is session, our other bests personal`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 17: `race-forecast` (simulator, critical path)

**Unit:** simulator. **Depends on:** Task 10.

**Interfaces:** produces `forecast(field, stops, laps, p): ForecastResult` (A.2), following spec 5.3's four steps. Typed arrays are row-major `[car × laps]`. Positions come from race time, but a car that may not pass stays behind at `minFollowGapMs`.

**Tests:**
- `with no stops and equal pace, gaps hold (dirty air off)`
- `a car 0.5 s/lap faster with threshold 1 s stays behind at minFollowGap`
- `with threshold 0.3 s it passes`
- `a stop adds the condition's loss and resets the tyre age`
- property: `with deg 0, a stop adds exactly the condition's loss plus outLapPenaltyMs to that car's race time`
- property: `a stopping car's position on the stop lap is never better than without the stop`
- property: `with no stops and no interaction, the result equals straight extrapolation from lap-model`
- property: `positions are a permutation of 1..n on every lap`
- budget: `one scenario on benchField < 1 ms`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 18: `forecast-field`

**Unit:** function. **Depends on:** Tasks 1, 4, 10.

**Interfaces:** produces `buildField(view: EngineView, deg: DegradationOut, loss: PitLossOut, cfg: { lapModel: LapModelConfig; forecast: RaceForecastConfig }): { field: ForecastField; params: ForecastParams; carIds: CarId[]; excluded: { carId: CarId; reason: UnknownReason }[] }`.

**Requirements:**
- Race time at the last crossing comes from the mini-sector history.
- A car in the pit lane is projected to its exit with the green loss.
- A retired or DSQ car is excluded.
- A car without a fit gets its compound's weekend fit, and otherwise lands in `excluded` with `insufficientData`.

**Tests:**
- `retired car is not in the field` (Review Focus 4)
- `car in the pit lane is placed at its exit projection`
- `lapped car keeps its own lap count` (Review Focus 4)
- `a car without any fit is excluded with insufficientData`
- `a hidden rival gets the age basis`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 19: `pit-losses` → `pitLosses.track`

**Unit:** analysis (quick, reads `pit-loss`). **Depends on:** Task 12.

**Tests:**
- `the table carries each condition's loss and source`
- `this session's stops are listed newest first`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 20: `stint-analysis` → `stintAnalysis.car`

**Unit:** analysis (quick, reads `degradation`, `laps`). **Depends on:** Task 13.

**Tests:**
- `each lap has its tyre age and fuel-corrected time`
- `an in-lap is excluded with reason inLap`
- `the slow outlier is used but marked down-weighted`
- `the weekend compounds pass through`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 21: `track-positions` → `trackPositions.geometry`, `trackPositions.cars`

**Unit:** analysis. Geometry: quick, reads `track-geometry`, cadence `lapCompleted`. Cars: quick, cadence `'frame'`, lookups only. **Depends on:** Tasks 8, 11.

**Tests:**
- `each car gets the map point of its lap distance`
- `a car in the pit lane is marked inPit`
- `major incidents of the last markerLaps laps become markers with their turn or sector label`
- `positions stay with realism on`
- budget: `placement of 20 cars < 50 µs` (`withinBudget` with a µs-scaled budget of 0.05 ms)

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 22: `radio-window` → `radioWindow.car`

**Unit:** analysis (quick, cadence `{ hz: 4 }`). **Depends on:** Tasks 8, 11.

**Tests:**
- `on the oval's straight at 300 m at 300 km/h, 300 m left gives 3.6 s`
- `in a corner, seconds to the next straight from distance and speed`
- `below 30 km/h the stored median speed per bin is used`
- `no geometry gives insufficientData`
- `another car is notApplicable`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 23: `crossover` → `crossover.field`

**Unit:** analysis (incremental, `lapCompleted`; reads `pit-loss`). **Depends on:** Task 12.

**Tests:**
- `median per tyre type per lap`
- `our ratio is our last lap over the dry reference`
- `the first inter car faster in a sector than our slick car is reported once with its lap`
- `payback laps = loss / lap-time difference when the other type is faster; notApplicable otherwise`
- segment (`race-singapore-wet-crossover`): `the wet moment produces firstFaster`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 24: `pit-window` → `pitWindow.car`, and the *window* moment

**Unit:** analysis (quick, reads `degradation`), plus the change to `race-moment`. **Depends on:** Tasks 9, 13. Scope adds `packages/analysis/src/race-moment`, `packages/analysis/test/race-moment`.

**Tests:**
- `latest lap is the current tyres' life end`
- `earliest per compound is totalLaps minus its life`
- `window spans the earliest over the next compounds to the latest`
- `the next compounds are the dry compounds of our available tyre sets; a used-up compound drops out`
- `fewer than minLaps fit laps is insufficientData`
- race-moment: `window moment from earliest − windowLeadLaps until our stop`; `neutralised outranks window, window outranks incident`; `cause carries earliestLap and latestLap`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 25: `incidents`: the official turn

**Unit:** change to `incidents`. **Depends on:** Tasks 8, 11.

**Tests:**
- `an incident in a corner of a track with a turn file has its turn label`
- `without a turn file the turn is notApplicable and the sector stays`
- `the turn never comes from a detected corner's index`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 26: `rejoin` → `rejoin.car`

**Unit:** analysis (quick, cadence `lapCompleted`, `pitStop`, `flagChange`, `{ hz: 1 }`). **Depends on:** Tasks 8, 11, 17, 18.

**Requirements:**
- Per condition: forecast "our car stops at the end of this lap" against "no stop".
- Rejoin position is our position at pit exit in the stop scenario.
- The crossing order lists cars by projected line crossing after the exit, with the ghost inserted.
- `lapDistanceM` and `point` come from `track-lookup` on the car ahead's projected place plus the gap.
- Ghost lines: our `gaps.gapper` line minus each condition's loss.

**Tests:**
- `with loss 22 s and cars 10 s and 25 s behind, the ghost rejoins between them`
- `the sc condition uses the sc loss`
- `under an active SC the SC condition uses live gaps` (Review Focus 5)
- `a retired car is not in the order` (Review Focus 4)
- `a lapped car is traffic, not a position` (Review Focus 4)
- `with no samples the loss is the default with source default and the ghost is still placed` (Review Focus 2)
- `ghost lines are the gapper line minus the loss`
- `a flashback before a stop gives the fresh run's ghost` (Review Focus 1)
- budget: `< 5 ms`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 27: `undercut` → `undercut.car`

**Unit:** analysis (quick, same cadence as Task 26). **Depends on:** Tasks 9, 17, 18.

**Requirements:** for each neighbour within `undercutRangeMs`, run forecasts with us stopping now and the rival stopping N = 1, 2, 3 laps later. `Δ(N)` is our gain over the rival after both have stopped, compared with now. The car behind's row is the mirror case. `stopDue` comes from `tyre-life`.

**Tests:**
- `fresh tyres 1.5 s/lap faster for 2 laps with equal loss give Δ(2) ≈ 3 s`
- `margin is Δ minus the gap`
- `a rival past its tyre life is stopDue`
- `no neighbour in range gives an empty list`
- `realism-hidden rival still gets Δ from the age basis`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 28: `sc-call` → `scCall.car`

**Unit:** analysis (quick, same cadence). **Depends on:** Tasks 17, 18.

**Tests:**
- `gain vs green is the green loss minus the SC loss`
- `alsoGain lists rivals within the window whose stop also gains`
- `active is sc while an SC phase is open`
- `under an active SC the option uses live gaps` (Review Focus 5)
- `with no samples the losses are defaults with source default` (Review Focus 2)

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 29: `pit-sweep` → `pitSweep.car`

**Unit:** analysis (quick, cadence `lapCompleted`, `pitStop`, `flagChange`). **Depends on:** Tasks 9, 17, 18.

**Tests:**
- `one row per lap from the next lap to the window's end`
- `traffic lists cars within trafficGapMs in the first trafficLaps laps`
- `finish time and position with no further stop`
- `a stint to the finish beyond the compound's life is exceedsLife`
- `the params compound changes the rows`
- budget: `all rows on benchField < 20 ms`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 29a: `forecast-score` and `pitwall score`

**Unit:** a quick calculator without a topic, a pure function, a bridge pipeline option and a CLI command (spec 7.15, 1.5). **Depends on:** Tasks 17, 18, 26, 27. **Scope** adds `apps/bridge/src/pipeline/`, `apps/bridge/test/pipeline/`, `apps/bridge/src/cli/` and `apps/bridge/test/cli/`.

**Interfaces:**
- Consumes: `forecast` (Task 17), `forecastField` (Task 18), the `rejoin.car` and `undercut.car` value types (Task 1), `History` from the engine.
- Produces (types in spec A.2, committed by Task 1 in `packages/analysis/src/forecast-score/index.ts`):
  - calculator `forecast-score` (quick, cadence `lapCompleted`, output `ScoreForecastOut`)
  - `scoreForecasts(log: ScoreLog, history: DeepReadonly<History>, config: ForecastScoreConfig): ForecastScore`
  - `FeedPipelineOptions.tap?: { calculators: CalculatorId[]; onPass(at: SessionTime, outputs: ReadonlyMap<CalculatorId, unknown>, state: EngineView['state']): void }`. Observation only: the tap changes neither the demand nor the schedule. `onPass` gets only the tapped calculators that ran in that pass. After a flashback the pipeline calls `onRewind(at)` (also in `tap`) before the next pass, so the collector drops later entries.
  - `scoreRecording(path: string, config: FeatureConfig, priors: PriorsSource, log: Logger, signal: AbortSignal): Promise<ForecastScore>` in `apps/bridge/src/cli/process-recording.ts`, next to `processRecording`, wired the same way but without `storage`, with hub subscriptions to `rejoin.car` and `undercut.car` so the existing demand runs those calculators (the `forecast-score` calculator runs always, since nothing references it). `PriorsSource` is what Task 3 reads priors from (the sidecar, the store or a pinned file).

**Requirements:**
- The calculator, the exclusions, the errors, the rejoin and undercut rows: exactly as spec 7.15. One forecast per leader lap is scored (the first one made at that leader lap).
- The collector in `scoreRecording` builds the `ScoreLog`: tapped `forecast-score` outputs, our cars' `rejoin` and `undercut` values, and our position at pit exit (read from `state` in the pass where our car's pit stop record appears). It computes nothing else.
- `pitwall score <recording> [--priors <file> | --fresh-priors] [--json]`: `apps/bridge/src/cli/commands/score.ts`, wired in `pitwall.ts`, its lines in `usage.ts` below the existing first line (the tests pin that line). It opens no database for writing and writes no knowledge.

**Tests** (builder logs and histories unless named):
- `a forecast that matches the laps scores 0 error and every position right`
- `a car 200 ms per lap slower than its forecast shows bias +200, +600, +1000, +2000 ms at horizons 1, 3, 5, 10`
- `a stop inside the horizon excludes the pair with reason stop`
- `a VSC inside the horizon excludes the pair with reason neutralised`
- `a car that never reaches the target lap is excluded with reason unfinished`
- `positions rank only the cars scored for the same lap and horizon`
- `errors are split by basis; a realism-hidden rival counts under age`
- `one of our stops gives one rejoin row with the condition the stop had`
- `a rival ahead stopping 2 laps after us gives an undercut row with n 2 and the real gain from the lap records`
- `only the first forecast of a leader lap is scored`
- calculator: `the forecast covers max(scoreHorizons) laps for every running car`, budget `< 5 ms` on `benchField()`, `never reads SessionState.pitWindow`
- `apps/bridge/test/pipeline/output-tap.test.ts` on segments: `onPass gets only the tapped calculators that ran`, `the tap leaves the calculators that run unchanged`, `on race-singapore-wet-flashback onRewind comes before the replayed passes`
- `apps/bridge/test/cli/pitwall-score.test.ts` on a segment: `score prints the table header and one row per horizon and basis`, `--json prints a ForecastScore`, `score writes no session and no knowledge` (the data directory is unchanged), `a missing recording exits 1 with a message`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Tasks 30–43: Displays

**Common to all:**
- **Depends on:** Task 0 (approval), Task 1 (test phase), Task 7 (implement phase).
- **Interfaces:** consume only the topics in their row.
- **Tests:** the common display tests, plus the emphasis branches listed.
- Each ends with `- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged`.

| Task | Display | Topics | Emphasis branches to test |
|---|---|---|---|
| 30 | `pit-loss-table` (V33) | `pitLosses.track` | source `default` shown muted; this session's stops listed |
| 31 | `stint-scatter` (V07) | `stintAnalysis.car` | excluded laps grey; the fit band; our car white |
| 32 | `raising-average-chart` (V08) | `raisingAverage.car` | our cars white, rivals by team colour |
| 33 | `lap-overview-grid` (V09) | `lapOverview.car` | session best purple; in/out marked; SC/VSC strip |
| 34 | `crossing-order` (V03) | `rejoin.car` | ghost row per condition; the cars around the ghost highlighted |
| 35 | `gap-chart` change (V04) | `gaps.gapper`, `rejoin.car` | ghost line per condition, dashed; hidden when `rejoin` is unknown |
| 36 | `track-map` | `trackPositions.geometry`, `trackPositions.cars`, `rejoin.car` | our cars white; ghost; incident marker; turn labels only from the topic |
| 37 | `radio-clock` (V34) | `radioWindow.car` | "on straight" highlighted; counts down |
| 38 | `undercut-card` (V13) | `undercut.car` | positive margin highlighted, never a verdict text; `stopDue` mark |
| 39 | `sc-card` (V18) | `scCall.car` | one line when `active` is none; the sheet when sc/vsc |
| 40 | `pit-sweep-table` (V15) | `pitSweep.car` | `exceedsLife` rows marked; compound selector sets params |
| 41 | `forecast-strip` | `weather.forecast` | first rain sample highlighted; `approximate` shown |
| 42 | `crossover-chart` (V19) | `crossover.field` | the 110 % line; our ratio; payback laps |
| 43 | `incident-feed` change | `incidents.feed` | turn label shown when known, sector otherwise |

---

### Task 44: Workbooks `strategy` and `longrun`

**Goal:** the two default workbooks of spec 9, laid out as Task 0 approved.

**Scope:** `apps/bridge/src/ui-state/default-workbooks/`, `apps/bridge/test/ui-state`. **Depends on:** Tasks 30–43.

**Tests:**
- `strategy and longrun are seeded when missing`
- `an existing race workbook is not touched`
- `every widget id in both files is registered`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 45: Gates, human check, merge

**Done by:** the supervisor, with the user for the human check.

- [ ] `pnpm check`, `pnpm test:ui` (baselines within the budget of 50), `pnpm test:acceptance`.
- [ ] Add determinism with pinned priors to acceptance: the determinism set replayed with `fixtures/priors/empty.json` and with `fixtures/priors/zandvoort.json`, twice each, gives identical topic streams.
- [ ] Add reprocess to acceptance: `pitwall reprocess` of a fixture twice leaves the knowledge table unchanged.
- [ ] Write `docs/acceptance/4a.md`, the human checklist:
  - replay `raceZandvoortUidReuse` at the user's stop
  - the ghost on the map and in the crossing order
  - the SC card under the SC
  - the undercut card before the stop
  - turn labels at Zandvoort
  - the forecast strip and crossover in `raceSingaporeWet`
- [ ] Run `pitwall score` with `fixtures/priors/empty.json` on the league races in `recordings/` and put the tables in `docs/acceptance/4a.md` as the baseline 4b is judged against. This is a report for the user, not a gate.
- [ ] Get the user's check. Their findings become fix tasks.
- [ ] Write the run rulings to `docs/superpowers/notes/2026-10-30-sp4a-run-rulings.md`. Update CLAUDE.md: "Where to look", and `score` in the bridge CLI line of "Commands".
- [ ] Merge to main and push.
