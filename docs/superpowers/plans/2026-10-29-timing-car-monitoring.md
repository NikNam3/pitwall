# Timing + car monitoring (sub-project 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the first working race-engineer panel: car care and timing for practice, qualifying and the race, as shared calculators, analyses publishing topics, and displays that only render them.

**Architecture:**
- **`packages/analysis`** (renamed from `packages/strategy`): pure functions and engine calculators, one folder per unit.
- **`apps/bridge/src/features/<unit>/`:** registers a unit's calculators, binds its topics and declares its config.
- **`packages/domain/src/analyses/`** holds the value types, **`packages/contracts/src/topics/`** the topic files. Both are committed as code before any unit starts.
- **`apps/ui/src/widgets/<display>/`:** widgets that format and apply emphasis, built on new shared kit pieces.

**Tech stack:** existing only. TypeScript (strict, type stripping), Vitest, fast-check, Stryker, Svelte 5, uPlot, Playwright, Electron. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-29-timing-car-monitoring-design.md`. The contracts are its Appendix A, the config defaults its Appendix B, the build order its section 13. The dependency graph is `docs/superpowers/specs/2026-10-29-timing-car-monitoring/dependency-graph.html`.

## Global Constraints

- **CLAUDE.md "Rules" apply verbatim:**
  - units: ms, m, km/h, °C, psi, kg, J, rad
  - missing data is `Known`, never 0
  - no `enum`, namespaces or parameter properties
  - relative imports end in `.ts`
  - `packages/analysis` is pure like the engine: no clock, no `Math.random`, no I/O
  - expected problems are values, exceptions are bugs
  - registration by convention, no central lists
- **Displays render, analyses compute** (spec 1.4, item 7). A widget formats and applies emphasis only. Any arithmetic on topic values beyond formatting is a review finding. No new display-private feature folders.
- **Dependency direction:** `analysis` imports `engine` and `domain`; `contracts` imports `domain`; `ui` imports `contracts` and `domain`. Value types shared by an analysis and a topic live in `packages/domain/src/analyses/` (spec 3.2).
- **Contracts are binding.** The value types, topic files, calculator ids and config declarations committed in Task 3 are read-only for unit workers, like tests. A needed change goes under "Requested changes to supervisor-owned files" in the report, and the supervisor decides.
- **Config values are flat primitives** (`number | string | boolean`, `packages/engine/src/calc/config.ts`). Bands are `lo`/`hi` pairs per field (`surfaceDryLo: 85, surfaceDryHi: 105`), and the incident severity kinds are one boolean per kind (`collisionMajor: true`).
- **Calculator ids** equal the unit name (`'pace'`, `'tyre-wear'`). Readers depend on `{ calculator: '<unit>' }` and read `view.outputs.get('<unit>')` typed by the contract type.
- **Calculator outputs** (Task 3 commits them as types): a per-car analysis outputs `Record<CarId, Value>`, where `Value` is its topic's value, and the binding's `select` picks `params.carId`. A global analysis outputs its topic value. `gaps` outputs `GapsOutput` (Task 13). `alarms` outputs its active `Insight[]`.
- **"Our cars"** are `session.info.playerCar` and `teammateCar` (engine: `state.playerCar`, and the teammate where present). No analysis assumes a single feed.
- **Realism:** an analysis passes `unknown('realism')` through and never replaces it with a guess.
- **Who runs which tests** (user, 2026-10-29: the supervisor runs the big tests; each agent runs only what its lane strictly needs). Set `PITWALL_FIXTURES_DIR=/home/nklx/dev/personal/pitwall/recordings` for every run.
  - **Test agents:** only the test files they wrote, once, to see them fail for the right reason.
  - **Implementers:**
    - while working: only their task's test files (the `typecheck.sh` hook already typechecks the touched package after each edit)
    - once at the end: the same test files, `pnpm eslint <changed files>` and `pnpm depcruise`
    - never a whole package's tests, `pnpm check`, `pnpm test:ui`, acceptance tests or Stryker
  - **Reviewers:** no tests. They read the diff and the agents' reports.
  - **The supervisor** runs everything bigger:
    - `pnpm check` on the integration branch after every three to four merges, bisecting by unit on a failure
    - `pnpm test:ui` at the milestones
    - acceptance tests, determinism and Stryker once, in Task 38
  - **Never** run a gate while an agent is editing source, and never two suites at the same time.
- **Two phases per unit** (CLAUDE.md "Workflow"):
  - The test agent commits `test(<scope>): …` and lists its assumptions. The supervisor rules on them before the implementer starts.
  - The implementer commits `feat(<scope>): …` without touching tests, `test-support/` or a widget's `gallery.ts`.
  - Screenshot baselines are made by the implementer and checked by the supervisor against the approved mockups (Task 0).
- **Worker env:** `PITWALL_PHASE=<test|implement> PITWALL_WORKER_UNIT=<unit> PITWALL_WORKER_SCOPE=<folders>`, one worktree per task under `../pitwall-wt/<task>`.
- **Centralise presentation** (UI shell plan rule). Formats go in `kit/values/format.ts`, texts in `kit/text.ts` or the widget's `text.ts`, colours as theme roles. A duplicated presentational literal is an Important review finding.
- **Questions during the run** go into `docs/superpowers/plans/2026-10-29-timing-car-monitoring-questions.md`: one heading per question, lettered options, which one was built, a recommendation, an empty `**Answer:**` line. Work continues on the built option.
- **Commits** end with a blank line and `Co-Authored-By: <model name> <noreply@anthropic.com>`. `CONTRACT_VERSION` is bumped by the supervisor only.

## Review Focus

Five conditions that hurt in real use and that the spec's happy path doesn't spell out. Each has a test in its owning task.
1. **A flashback in the middle of a stint.** The history shrinks, and every rate, best lap, gap and incident must equal a fresh run over the truncated history, with no duplicate incident and no stale best lap. (Tasks 12, 13, 15–23: the flashback property)
2. **A pit stop resets the stint.** The wear rate, fuel burn and ERS trend must restart from the new stint, not fit one line across the stop: new tyres make wear jump down, and a refuel makes fuel jump up. (Tasks 15, 16, 17)
3. **A car retires or is lapped.** Gaps, the neighbourhood and battle cards must not show a retired car as "ahead", and a lapped car's gap is "laps down", not a huge number of ms. (Tasks 13, 20)
4. **The player car changes between sessions,** e.g. the TT car and then the race car, or a restart. "Our cars", alarms and the neighbourhood follow the new `playerCar`. Alarms of the old car are resolved, not left active. (Tasks 13, 22)
5. **A rival's data is hidden by realism.** The rival's wear, fuel and ERS stay empty cells. Battle cards and incidents still work from timing alone, and no alarm fires on hidden data. (Tasks 15–17, 20, 22)

## Build order

Spec section 13 is the schedule. In short:
- **W0** (Tasks 0–7) is the only serial stretch. Task 1 runs alone first, then Task 3. Tasks 0, 2, 4, 5, 6 and 7 run after Task 3, in parallel.
- **Then every unit (Tasks 8–35) goes through its own life** (spec 13.1): test phase, ruling, implement phase, review, merge.
  - A unit's **test phase** may start once Tasks 3 and 5 are merged. A display's test phase also needs Task 0's approval.
  - Its **implement phase** may start once every task in its **Depends on** is merged.
- **Scheduler rule (spec 13.5):** at most **eight** agents, reviewers included (user, 2026-10-29). A free slot goes to:
  1. a ready implementation on the critical path (Tasks 8, 12, 18, 21, 23, 35)
  2. another ready implementation, the one with the longest chain of readers first
  3. a pending review
  4. the next test phase, lowest level first, analyses before displays
- **Milestone "car"** (Task 36) as soon as Tasks 22 and 24, 26–30 are merged. **Milestone "race"** (Task 37) when everything is merged. Then Task 38.

| Level (spec 13.3) | Tasks |
|---|---|
| W0 | 1 → 3 → 0, 2, 4, 5, 6, 7 |
| 0 | 8 `lap-classes`, 9 `per-lap-rate`, 10 `pace-delta`, 11 `session-remaining`, 13 `gaps`, 14 `car-bands`, 24 `alarm-list` |
| 1 | 12 `pace`, 15 `tyre-wear`, 16 `fuel`, 17 `ers`, 25 `gap-chart` |
| 2 | 18 `damage`, 19 `lap-times`, 20 `battle`, 26 `corner-block`, 27 `tyre-life-bar`, 28 `fuel-gauge`, 29 `ers-budget` |
| 3 | 21 `incidents`, 22 `alarms`, 30 `damage-card`, 31 `timing-tower`, 32 `lap-analysis`, 33 `projected-lap`, 34 `battle-cards` |
| 4 | 23 `race-moment`, 35 `incident-feed` |
| end | 36, 37, 38; open: 39, 40 |

**Common files of a unit task** (not repeated below):
- **Analysis or calculator `<unit>`:**
  - `packages/analysis/src/<unit>/index.ts` (exports)
  - `packages/analysis/src/<unit>/<unit>.ts` (maths)
  - `packages/analysis/src/<unit>/calculator.ts` (engine calculator, if any)
  - `packages/analysis/src/<unit>/config.ts` (from Task 3)
  - tests in `packages/analysis/test/<unit>/`
  - `apps/bridge/src/features/<unit>/register.ts`, with binding tests in `apps/bridge/test/features/<unit>/`
- **Display `<display>`:** `apps/ui/src/widgets/<display>/` with `widget.ts`, `register.ts`, `<Name>.svelte`, `emphasis.ts`, `emphasis.test.ts`, `gallery.ts` (test phase) and `text.ts` if it has fixed texts.

**Common tests:**
- **Every incremental calculator:** a test `flashback equals fresh run`. Build a history with the Task 5 builders, run `init` plus `update` over it, truncate it with `truncated: true`, and compare with `init` over the truncated history using `toEqual`.
- **Every per-car topic:** a binding test that `select` returns the value for `params.carId` and `undefined` for an unknown car.
- **Every display:**
  - gallery cases for compact and full mode, for a realism-hidden case and for its emphasis states
  - emphasis tests for each branch
  - the fit expectations in `gallery.ts` for Task 38's Playwright run

---

### Task 0: Mockups of all twelve displays (user gate)

**Goal:** the user approves how every display looks, in one session (spec 8.5).

**Done by:** the supervisor, with the user. Not a two-phase task.

**Status: done 2026-10-29** (built from the spec's contracts before Task 3). Approved values and rules: `docs/brainstorms/2026-10-29-sp3-displays/README.md`. Display test agents read that README and the HTML pages.

**Blocks:** every display's test phase (Tasks 24–35) and Task 36.

- [ ] Write full HTML documents in `docs/brainstorms/2026-10-29-sp3-displays/`, one per display. Each shows compact and full mode at the theme's font size, with colour only where the spec's "Lights up" column says.
- [ ] Add `0-compound-and-sectors.html` with the two open colour questions as variants: compound as a letter or a letter plus colour; purple and green for our cars only, or for every car.
- [ ] Add `0-layouts.html` with the `car`, `quali` and `race` workbooks (spec 9) on a 24" and a 14" monitor.
- [ ] Screenshot every document with the cached headless Chromium and check the screenshots before showing them.
- [ ] Get the user's approval. Record the approved column priorities, size modes, colour variants and layouts in `docs/brainstorms/2026-10-29-sp3-displays/README.md`. The theme variant values go into `apps/ui/src/theme/`.
- [ ] Commit: `docs: approved sub-project 3 display mockups`.

---

### Task 1: Rename `packages/strategy` → `packages/analysis`

**Goal:** the package of all analysis maths has a name that matches what it holds (spec 3.1).

**Done by:** the supervisor, alone, before every other task (it touches every worktree's base).

- [ ] `git mv packages/strategy packages/analysis`. Set the package name to `@pitwall/analysis` and update every dependent `package.json`, then run `pnpm install` so `pnpm-lock.yaml` updates.
- [ ] Update `.dependency-cruiser.cjs` (rule `analysis-only-engine-domain`), the root `package.json` `mutation` script, the Stryker config of the package, `vitest.config.ts` projects, and `.claude/hooks/guard-scope.sh` lines 31–32 (`packages/analysis/src/$unit`, `packages/analysis/test/$unit`).
- [ ] Update CLAUDE.md (Map, dependency direction, unit folders, "The engine and analysis are pure"), `docs/architecture.md` and ADR 0011 (paths).
- [ ] Verify: `grep -rn "packages/strategy\|@pitwall/strategy" --exclude-dir=node_modules . | grep -v "docs/superpowers/\(plans\|specs\)/2026-10-28"` prints nothing, and `pnpm check` passes.
- [ ] Commit: `build: rename packages/strategy to packages/analysis`.

---

### Task 2: Lap-end samples in `LapRecord`

**Goal:** every lap record carries the car's wear, ERS and damage at the lap end, so no analysis re-detects lap ends (spec 3.3).

**Scope:** `packages/engine/src/history`, `packages/engine/test/history`, `packages/domain/src/records.ts` (from Task 3, read-only here).

**Depends on:** Task 3 (the fields exist in the type).

**Interfaces:**
- Consumes: `LapRecord` with `wearAtEndPct`, `ersStoreAtEndJ`, `ersDeployedJ`, `ersHarvestedJ`, `damageAtEnd` (spec A.1).
- Produces: the engine fills them where it writes a `LapRecord` today. Storage needs no change: laps are stored as JSON (`apps/bridge/src/storage/storage-writer.ts:86`).

**Requirements:**
1. The samples are taken from the car state of the frame that completes the lap.
2. `ersDeployedJ` and `ersHarvestedJ` are the lap's totals. The game resets its per-lap counters at the line, so take the last value before the reset.
3. A field the car state doesn't have (realism, not received) is that `Known`'s unknown, never 0.
4. A `confirmed` record keeps the samples of its `provisional` predecessor.

**Tests** (`packages/engine/test/history/lap-end-samples.test.ts`):
- `lap end samples wear per corner from the completing frame`
- `ers deployed is the value before the per-lap reset`
- `a rival hidden by realism has unknown('realism') samples`
- `confirmed record keeps the provisional samples`
- Fixture test (`apps/bridge/test/fixtures/laps.fixture.test.ts`, new `it`): on `ttZandvoort` every lap has `wearAtEndPct.fl` known with value 0, and `ersStoreAtEndJ` known with value 4 000 000 (the time trial holds both fixed, spec 11.3).

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 3: Contracts as code

**Goal:** every interface between the parts exists as code before any unit starts (spec 1.4, item 9; Appendix A and B).

**Done by:** the supervisor. Not a two-phase task. Verified by `pnpm typecheck`, `pnpm depcruise` and `pnpm gen`.

**Depends on:** Task 1.

- [ ] `packages/domain/src/known.ts`: add `'insufficientData'` to `UnknownReason`. In `apps/ui`, give it a hover text in `kit/text.ts`, next to the other reasons.
- [ ] `packages/domain/src/records.ts`: add the `LapRecord` fields of spec A.1. Fill them with `unknown('notReceived')` wherever records are built today, so the engine compiles until Task 2 fills them for real.
- [ ] `packages/domain/src/analyses/`: one file per analysis with the value types of spec A.3, plus `damage.ts` with `DamageParts`, and an `index.ts` re-exported from the package index.
- [ ] `packages/analysis/src/<unit>/index.ts` for the five shared pieces: their exported types and signatures from spec A.2. Functions throw `new Error('not implemented')` until their task, and each calculator's `id` is exported as a constant.
- [ ] Each analysis's `packages/analysis/src/<unit>/index.ts` exports its calculator id and output type (Global Constraints, "Calculator outputs"), including `GapsOutput` of Task 13.
- [ ] `packages/contracts/src/topics/`: the 14 topic files of spec A.3's table, each `defineTopic<Params, Value>({ owner: '<unit>', mode: 'state', maxHz })`. `GapperReference` params on `gaps.gapper`, `{ referenceCarId: CarId }` on `lapTimes.board`.
- [ ] `packages/analysis/src/<unit>/config.ts` for every unit in spec Appendix B. Each is a `defineConfig('<unit>', { … })` with flat fields (Global Constraints) and a source comment per field.
  - Check each default against a community source for F1 25, or F1 24 where F1 25 has none. Look hardest at the pressure band (spec 14, item 2).
  - Where a source differs, use the source's value. Write the source as a URL, or "pitwall estimate".
- [ ] `apps/ui/src/shell/topbar/segments/Moment.svelte` and its model: read `raceMoment.current` as an optional topic and show the moment's name from `kit/text.ts` (spec 3.4). The UI shell's top-bar gallery cell gets a case with the `battle` moment.
- [ ] `docs/decisions/0014-displays-render-analyses-compute.md` (spec 3.5). Add one line to CLAUDE.md's Workflow: "Displays render, analyses compute; anything two parallel workers would share is built first (ADR 0014)."
- [ ] Create the questions file with its header (Global Constraints).
- [ ] Run `pnpm gen`, `pnpm typecheck`, `pnpm depcruise` and `pnpm check`.
- [ ] Commit: `feat(contracts): sub-project 3 contracts, config and ADR 0014`.

---

### Task 4: Gallery cells for the top bar and overlays; `pitwall dev` restores the moment

**Goal:** the UI shell's open item Q5 (spec 10).

**Scope:** `apps/ui/src/gallery` (the cells live in `cells.ts`), `apps/ui/e2e`, `apps/ui/e2e/__screenshots__`.

**Depends on:** Task 3.

**Requirements:**
1. Gallery cells:
   - the top bar: race with one tier-1 alert, realism pending, replay transport, the `battle` moment from Task 3
   - the palette (open, with a query)
   - the key overview
   - a settings popover of `feed-status`
   - the inspector on `feed-status`
2. Screenshot baselines for each cell, made through Electron like the existing ones.
3. E2E: start `pitwall dev --replay <ttZandvoort segment> --at-lap 2`, seek to a moment, touch a feature file. After the restart the replay is at the same session time (±1 s) and the panels show data again. Kill the process in `finally`.

**Tests:** `apps/ui/e2e/screenshots.spec.ts` (new cells) and `apps/ui/e2e/dev-restart.spec.ts`.

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 5: Test builders

**Goal:** one small vocabulary for building engine history and views in tests (spec 11.1).

**Scope:** `test-support/builders`. **Done by:** one agent, as a single phase. The builders are test code, and their own tests come with them.

**Depends on:** Task 3.

**Interfaces (produces):** `test-support/builders/index.ts`:
- `lap(over?: Partial<LapRecord>): LapRecord`. Defaults: car 0, lap 1, 90 000 ms, sectors 30 000 each, valid, soft C3, no SC, `confirmed`, every `Known` field known.
- `crossings(carId: CarId, lap: number, lapTimeMs: Ms, startAt: SessionTime): MiniSectorCrossing[]`: 50 evenly spaced crossings.
- `event(over: Partial<RaceEvent> & { kind: RaceEventKind }): RaceEvent`
- `flagPhase(over: Partial<FlagPhase>): FlagPhase`
- `field({ cars, laps, paceMs }: { cars: number; laps: number; paceMs: Ms | Ms[] }): { laps: LapRecord[]; miniSectors: MiniSectorCrossing[] }`. Car i laps at `paceMs[i]`, all starting at session time 0.
- `carState(over?: DeepPartial<CarState>): CarState`, `engineView({ cars?, history?, session?, config?, outputs?, delta? }): EngineView`. These reuse `apps/bridge/test/helpers/view.ts` where it fits, and move its shared part here.

**Tests** (`test-support/builders/builders.test.ts`):
- `field gives each car laps × 50 crossings in time order`
- `field with 3 cars at 90/91/92 s gives car 1 a 1 s gap per lap`
- `engineView config falls back to the declared defaults`

- [ ] Built · [ ] review · [ ] merged

---

### Task 6: Kit pieces, car care group

**Goal:** `CornerGrid`, `Bar`, the unit formats, the insight line and `CompoundMark`, before any display uses them (spec 8.4, A.4).

**Scope:** `apps/ui/src/kit/{corners,bar,insight,compound,values}`, `apps/ui/src/shell/topbar` (moving the insight line out), the kit gallery cells.

**Depends on:** Task 3. The look follows Task 0 once approved: the plumbing can start before, the visual details are adjusted after.

**Interfaces (produces):** the props of spec A.4 for `CornerGrid`, `Bar`, `InsightLine` and `CompoundMark`. `kit/values/format.ts` gains `formatLapNumber` (`L23`), `formatLaps` (`1.8 laps`; the Task 0 rule: a lap number is `L23`, a count always says laps), `formatCelsius`, `formatPsi`, `formatPercent`, `formatKg`, `formatLaps`, `formatJoules` (shown as MJ with one decimal) and `formatDeltaMs` (signed, `+0.412`).

**Requirements:**
1. `Bar` renders in text cells only (block characters), so it obeys the character-cell sizing. An unknown value is an empty bar with the reason on hover.
2. `InsightLine` is the top bar's current insight rendering, moved. The top bar then uses the kit piece, and its baselines don't change.
3. `CompoundMark` reads the theme variant: letter only by default (Task 0, A1), letter plus colour in `quiet-compound-colour`.
4. A kit grid helper for character-cell tables with fixed column widths and right-aligned numbers in fixed decimals, so `.` and `:` line up (Task 0 README); `Table` gains it if it doesn't do this already.

**Tests:**
- `format.test.ts`: each new formatter, including negative, zero and unknown
- `bar.test.ts` (the pure cell computation): value at min, at max, beyond the limit, unknown
- the top-bar screenshot baselines unchanged
- gallery cells for each piece

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 7: Kit pieces, timing group

**Goal:** `CarLabel`, `PositionMark`, chart phase bands, the our-cars highlight and sector status emphasis (spec 8.4, A.4).

**Scope:** `apps/ui/src/kit/{car,values,chart}`, `apps/ui/src/emphasis`, the kit gallery cells.

**Depends on:** Task 3 (look: Task 0, as in Task 6).

**Interfaces (produces):**
- `CarLabel`, `PositionMark` and `PhaseBand` (spec A.4). `Chart` gains an optional `bands: PhaseBand[]` prop.
- `emphasis/`:
  - `sectorStatusRole(status: SectorStatus, focus: { ours: boolean }): Role | undefined`: `sessionBest` → the purple role for every car, `personalBest` → the green role for our cars only (Task 0, B2)
  - `ourCarRole(ours: boolean): Role | undefined`

**Tests:**
- `emphasis.test.ts`: each branch of both functions, including a rival's personal best → `undefined`
- `chart data.test.ts`: phase bands outside the x-range are clipped
- gallery cells for each piece

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 8: `lap-classes` (critical path)

**Goal:** the one definition of which laps count (spec 4).

**Unit:** `lap-classes` (function, no feature). **Depends on:** Tasks 3, 5.

**Interfaces:** produces `classifyLap(lap: LapRecord, session: { isRace: boolean }): LapClass` (spec A.2).

**Tests** (`packages/analysis/test/lap-classes/`):
- `a clean lap counts for pace, rate and best`
- `in lap and out lap count for neither pace nor rate`
- `a lap with scShare 0.1 or vscShare 0.1 counts for neither pace nor rate`
- `an invalid lap counts for rate but not for pace or best; its valid sectors count for best`
- `lap 1 of a race is not a pace lap; lap 1 of practice is`
- property: `forPace implies forRate`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 9: `per-lap-rate`

**Unit:** `per-lap-rate` (function). **Depends on:** Tasks 3, 5.

**Interfaces:** produces `perLapRate` and `lapsUntil` (spec A.2). The slope is Theil–Sen: the median of `(v_j − v_i)/(lap_j − lap_i)` over all pairs `i < j` in the last `window` samples.

**Tests:**
- property: `a linear series a + b·lap gives perLap b`
- property: `adding a constant to every value changes nothing`
- `one outlier among 5 samples moves the rate by less than 10 %`
- `2 samples with minSamples 3 is unknown('insufficientData')`
- `lapsUntil with rate −2 from 60 to 40 is 10; with rate +2 it is notApplicable`
- `samples outside the window are ignored`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 10: `pace-delta`

**Unit:** `pace-delta` (function). **Depends on:** Tasks 3, 5.

**Interfaces:** produces `paceDelta(beforeMs, afterMs): Known<Ms>` (spec A.2).

**Tests:**
- `before 90 000 ×2, after 91 000 ×2 gives +1000`
- `fewer than two laps on either side is insufficientData`
- property: `swapping before and after flips the sign`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 11: `session-remaining`

**Unit:** `session-remaining` (calculator, `cadence: { hz: 1 }`, reads `session`, `timing`; feature without topics). **Depends on:** Tasks 3, 5.

**Interfaces:** produces the calculator id `'session-remaining'` with output `SessionRemaining` (spec A.2).

**Tests:**
- `race of 50 laps, leader on lap 20 at 40 % of the lap: lapsLeft 30.6, basis laps`
- `practice: basis time, timeLeftMs from the session, lapsLeft notApplicable`
- `time trial: both notApplicable`
- `after the chequered flag lapsLeft is 0`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 12: `pace` (critical path)

**Unit:** `pace` (incremental calculator over `laps`, `cadence: 'lapCompleted'`; feature without topics). **Depends on:** Task 8.

**Interfaces:** consumes `classifyLap`. Produces the calculator id `'pace'` with output `Pace` (spec A.2), using `window` from its config.

**Tests:**
- `recent is the mean of the last 3 pace laps; an SC lap in between is skipped`
- `stint mean resets at a new stint`
- `a car with no pace lap has recentMs insufficientData`
- `a provisional then confirmed lap counts once` (use `currentLaps`)
- flashback equals fresh run (Common tests)

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 13: `gaps`

**Unit:** `gaps` (incremental calculator over `miniSectors`, `cadence: 'frame'`, reads `miniSectors`, `timing`). **Depends on:** Tasks 3, 5.

**Interfaces:** produces the topics `gaps.intervals`, `gaps.toCar`, `gaps.gapper` and `gaps.neighbourhood`. The calculator `'gaps'` outputs
`GapsOutput = { intervals: Interval[]; lineTimes: Record<CarId, { lap: number; at: SessionTime }[]>; latest: Record<CarId, { lap: number; segment: number; at: SessionTime }>; neighbourhood: Neighbourhood[] }`.
The bindings compute `gaps.toCar` and `gaps.gapper` from it in their `select`, with their params. `battle` reads `lineTimes` for the gap at each line crossing (the gap of A behind B at lap L is A's line time minus B's).

**Requirements:** spec 6.1. Leader and ahead/behind come from the car's position in the car state. Retired and DSQ cars (`resultStatus`) are excluded from the intervals and the neighbourhood.

**Tests:**
- `field 3 cars at 90/91/92 s: after lap 5, car 2 is 10 s behind the leader and 5 s behind car 1`
- `the gap updates at every crossing, not only at the line`
- `a lapped car has lapsDown 1 and gap to leader under one lap`
- `a retired car is not in the intervals or the neighbourhood`
- `the gapper with leaderAverage 90 s: a car at 91 s is −1000 ms per lap more each lap`; also `fixed` and `carAverage`
- `the neighbourhood holds cars within ±1 position or ±3000 ms of the player car`
- `the neighbourhood follows a playerCar change` (Review Focus 4)
- property: `gap(A,B) = −gap(B,A)`; `gap(A,C) = gap(A,B) + gap(B,C)` at a segment all three crossed
- flashback equals fresh run

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 14: `car-bands`

**Unit:** `car-bands` (quick calculator, `cadence: { hz: 4 }`, reads `tyres`, `condition`). Its out-of-band times need state, so they are kept by an incremental calculator over frames, or by comparing with the previous output (implementer's choice; the tests decide). **Depends on:** Tasks 3, 5.

**Interfaces:** produces `carBands.car` (`CarBands`, spec A.3).

**Tests:**
- `soft surface 104 °C is in band; 106 °C is above`
- `hysteresis: after going above at 106, 104.5 stays above, 102.9 returns to in`
- `outSince is the session time the channel left the band; outForFullLap after one full lap out`
- `inter tyres use the inter band`
- `carcass in surface-only mode is notApplicable`
- `a rival hidden by realism has unknown('realism') values and states`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 15: `tyre-wear`

**Unit:** `tyre-wear` (quick calculator, `cadence: { hz: 4 }`, reads `laps`, `stints`, `tyres`). **Depends on:** Tasks 2, 9.

**Interfaces:** consumes `perLapRate`, `lapsUntil`, `classifyLap`. Produces `tyreWear.car` (`TyreWear`).

**Tests:**
- `wear 0, 2, 4, 6, 8 % at lap ends gives 2 %/lap and laps to the 70 % limit 31`
- `the rate uses only the current stint` (Review Focus 2: a stop resets it)
- `an SC lap is not a rate sample`
- `fewer than 3 laps in the stint: rate insufficientData`
- `gameLifeSpanLaps is the fitted set's lifeSpanLaps`
- `realism: a rival's corners are unknown('realism')`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 16: `fuel`

**Unit:** `fuel` (quick calculator, `cadence: { hz: 4 }`, reads `laps`, `stints`, `energy`, `{ calculator: 'session-remaining' }`). **Depends on:** Tasks 9, 11.

**Interfaces:** produces `fuel.car` (`FuelState`).

**Tests:**
- `burn 1.5 kg/lap, 30 kg left, 18 laps left: lapsOfFuel 20, margin +2, save target notApplicable`
- `30 kg, burn 1.5, 22 laps left: margin −2, save target 0.136 kg/lap` (1.5 − 30/22)
- `a refuel or stop restarts the burn samples` (Review Focus 2)
- `time trial fuel constant at 10 kg: burn 0, margin follows lapsLeft (notApplicable in TT)`
- `gameRemainingLaps is the car state's remainingLaps`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 17: `ers`

**Unit:** `ers` (quick calculator, `cadence: { hz: 4 }`, reads `laps`, `energy`). **Depends on:** Tasks 2, 9.

**Interfaces:** produces `ers.car` (`ErsState`).

**Tests:**
- `store 4.0, 3.6, 3.2 MJ at lap ends: trend −0.4 MJ/lap`
- `store 2.0 MJ rising 0.4 MJ/lap: lapsToAttackLevel 1 (attack level 2.4 MJ)`
- `store falling: lapsToAttackLevel notApplicable`
- `deployedThisLapJ is the car state's deployedJ; the limit is 4 MJ`
- `a new stint restarts the trend samples`
- `realism: a rival's store is unknown('realism')`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 18: `damage` (critical path)

**Unit:** `damage` (incremental calculator over frames and `laps`, reads `condition`, `tyres`, `laps`, `{ calculator: 'pace' }`). **Depends on:** Tasks 2, 10, 12.

**Interfaces:** produces `damage.car` (`DamageState`, with `corners` for tyre and brake damage).

**Tests:**
- `front left wing 0 → 12 % within 2 s is one jump with deltaPct 12`
- `a 3 % rise is not a jump; two rises of 3 % within 2 s are`
- `lossMsPerLap is insufficientData until two pace laps after the jump, then pace after minus before`
- `two jumps in one lap are two entries`
- flashback equals fresh run

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 19: `lap-times`

**Unit:** `lap-times` (incremental calculator over `laps` and `miniSectors`, reads `{ calculator: 'pace' }`, `session`). **Depends on:** Tasks 8, 12.

**Interfaces:** produces `lapTimes.board` (params `referenceCarId`) and `lapTimes.projection` (`CarParams`).

**Requirements:** spec 6.2. The cut-off position comes from `eliminatedPerPart` and the number of active cars. Q1 with 20 cars knocks out P16–P20, so the cut-off is P15.

**Tests:**
- `sector status: a new session-best sector is sessionBest; a personal best not session best is personalBest`
- `theoretical best is the sum of the best valid sectors`
- `deltas to the reference car are signed (positive = slower than the reference)`
- `projection at crossing 25 of a lap 0.3 s up on the best lap's crossing 25 projects best − 300 ms`
- `no projection on an in or out lap (onLap false, rest notApplicable)`
- `Q1, 20 cars: cut-off is P15's best lap; margin positive when we are inside`
- `timed session, 60 s left, 45 s of the projected lap remaining: finishMarginMs 15 000`
- flashback equals fresh run: `a best lap removed by a flashback is not the best any more`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 20: `battle`

**Unit:** `battle` (quick calculator, `cadence: { hz: 2 }`, reads `{ calculator: 'gaps' }`, `{ calculator: 'pace' }`, `tyres`, `energy`). Race only. The gap now comes from `GapsOutput.latest`; the gap per lap, for the closing rate, from `GapsOutput.lineTimes`. **Depends on:** Tasks 9, 12, 13.

**Interfaces:** produces `battle.cards` (`CarParams`, `BattleCard`).

**Tests:**
- `gap behind 2.4, 2.0, 1.6 s at the last three line crossings: closing 400 ms/lap, lapsToDrs 1.5`
- `the gap growing: lapsToDrs notApplicable`
- `paceDeltaMs positive when we are faster; overtakeMarginMs = paceDelta − 1000`
- `no car ahead (we lead): ahead is notApplicable`
- `a retired car is never ahead or behind` (Review Focus 3)
- `realism: theirErsStoreJ unknown('realism'), the rest still known` (Review Focus 5)
- `outside the race: every card notApplicable`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 21: `incidents` (critical path)

**Unit:** `incidents` (incremental calculator over `events`, `flagPhases`, `miniSectors`, reads `{ calculator: 'gaps' }`, `{ calculator: 'damage' }`, `timing`). Race only. **Depends on:** Tasks 10, 13, 18.

**Interfaces:** consumes `paceDelta`. Produces `incidents.feed` (`IncidentEntry[]`, newest first, at most `feedLength`).

**Requirements:** spec 6.4. An entry's id is stable: kind + cars + session time, so an update replaces its entry instead of adding one. The "before" values are taken at the incident. The "after" values are taken 5 s later, `notReceived` until then.

**Tests:**
- `a collision of the player car is a major entry with both cars`
- `a collision of two cars outside the neighbourhood is not in the feed`
- `a corner-cutting warning increase of a neighbour is a minor warning entry`
- `a mini-sector 2.5 s slower than the car's median is a major timeLoss entry; 1.5 s is none`
- `forUs: player P7 before, P9 five seconds later, gap to the car before and after`
- `timeLostMs first from the mini-sector, then from paceDelta once two laps exist`
- `majorKinds config: warningMajor true makes warnings major`
- flashback equals fresh run: `no duplicate entry after a flashback over the incident` (Review Focus 1)

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 22: `alarms`

**Unit:** `alarms` (quick calculator with `insights`, `cadence: { hz: 2 }`, reads the calculators `tyre-wear`, `fuel`, `ers`, `car-bands`, `damage`, and `timing`). **Depends on:** Tasks 14–18.

**Interfaces:** produces `Insight`s through the existing `insights` topic. No topic of its own. The insight `kind`s are named sets: `bandOut`, `bandOutLap`, `wearLimitNear`, `fuelShort`, `damageJump`, `warningLast`, `penaltyNew`, each with `params` the UI formats.

**Requirements:** the table in spec 5.6. Our cars only. Each insight `key` is the kind plus car plus channel, so an active alarm is never raised twice.

**Tests:**
- one test per row of spec 5.6, asserting severity and category
- `an alarm resolves when its condition ends`
- `no alarm for a rival, and none on unknown('realism') data` (Review Focus 5)
- `after a playerCar change the old car's alarms are resolved` (Review Focus 4)
- `two cornerCuttingWarnings with warningsBeforePenalty 3 raises warningLast; one does not`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 23: `race-moment` (critical path)

**Unit:** `race-moment` (quick calculator, `cadence: { hz: 4 }`, reads `flagPhases`, `session`, `{ calculator: 'incidents' }`, `{ calculator: 'battle' }`, `{ calculator: 'alarms' }`). **Depends on:** Tasks 20, 21, 22.

**Interfaces:** produces `raceMoment.current` (`Known<RaceMoment>`).

**Tests:**
- one test per moment of spec 7.2, each asserting `moment`, `cause.rule` and `active`
- `an SC with a fresh major incident: moment neutralised, active [neutralised, incident, carCare]`
- `a minor incident never sets incident`
- `incident holds for 30 s after the major entry, then falls back`
- `since keeps its value while the moment stays the same`
- `practice and qualifying: notApplicable`
- `carCare's cause params carry the number of active critical alarms of our cars`

- [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Tasks 24–35: Displays

Every display task has the same shape. Each row of the tables in spec 8.2 and 8.3 is the requirement: "Reads" gives `data`, "Shows" the fields, "Lights up" the emphasis functions. Sizes and column priorities come from Task 0's approved mockups. **Each depends on:** Task 0, the kit task(s) of the pieces it uses (Task 6 or 7), and the analysis tasks it reads.

| Task | Display | Depends on | Emphasis functions (each tested per branch) | Extra tests |
|---|---|---|---|---|
| 24 | `alarm-list` | 0, 6 | `severityRole(severity)` | acknowledged insights stay listed but dim; a muted category is hidden with a count |
| 25 | `gap-chart` | 0, 7, 13 | `lineRole(carId, ours)` (our cars white, else team colour) | phase bands from `flagPhases`; the reference shown in the header text |
| 26 | `corner-block` | 0, 6, 14, 15 | `bandRole(reading)`: `warning` out of band, `critical` out for a full lap | carcass `notApplicable` renders empty without a gap in the grid |
| 27 | `tyre-life-bar` | 0, 6, 15 | `lapsToLimitRole(laps, threshold)` | the game's life span marker; an unknown rate gives an empty bar tail |
| 28 | `fuel-gauge` | 0, 6, 16 | `marginRole(marginLaps)` | the game's estimate is dimmed and labelled as the game's |
| 29 | `ers-budget` | 0, 6, 17 | `ersRole(moment, lapsToAttack)` | without `raceMoment.current` (optional) nothing lights up; the flow arrow for each `flow` value |
| 30 | `damage-card` | 0, 6, 18 | `jumpRole(jump, newest)`: the newest jump is highlighted while its `lossMsPerLap` is still `insufficientData` (no clock in the widget) | two jumps: the newest first |
| 31 | `timing-tower` | 0, 6, 7, 13, 19 | `sectorStatusRole` (kit), `ourCarRole` (kit), `neighbourhoodRole(moment, inNeighbourhood)` | a lapped car shows `+1L`; a retired car sits at the bottom, dim |
| 32 | `lap-analysis` | 0, 6, 7, 19 | `sectorStatusRole` (kit) | the reference car's own row shows no deltas |
| 33 | `projected-lap` | 0, 7, 19 | `cutOffRole(margin)`, `finishRole(margin)` | on an out lap the widget shows the finish margin only |
| 34 | `battle-cards` | 0, 6, 7, 20 | `battleRole(moment, lapsToDrs)` | a hidden rival ERS is an empty cell, the card still renders |
| 35 | `incident-feed` (critical path) | 0, 7, 21 | `incidentRole(moment, entry, newestMajorId)`; minor entries dim | `P7→P9` via `PositionMark`; an unresolved `timeLostMs` renders empty |

Per display task: [ ] Test phase · [ ] Implement phase · [ ] review · [ ] merged

---

### Task 36: Milestone "car"

**Goal:** the car care panel is usable in preseason training (spec 13.6).

**Done by:** the supervisor (bridge seeding) and one agent (e2e). **Depends on:** Tasks 22, 24, 26–30.

- [ ] **Default workbooks.** On bridge start, copy every file from `apps/bridge/src/ui-state/default-workbooks/` into `PITWALL_DATA_DIR/ui/workbooks/` when no file of that name exists, and never overwrite one. Add `car.json` with Task 0's approved layout.
  - Test `apps/bridge/test/ui-state/default-workbooks.test.ts`: `a missing car.json is created`, `an existing car.json is untouched`.
- [ ] **E2E** `apps/ui/e2e/car-workbook.spec.ts`: bridge plus a `ttZandvoort` replay, open `car`, the corner block shows four known surface temperatures (93 °C) and the brake temperatures change over 10 s.
- [ ] `pnpm check` and `pnpm test:ui` on the integration branch.
- [ ] Tell the user that milestone "car" is reached and where the workbook is.
- [ ] Commit: `feat(bridge): default car workbook (milestone car)`.

---

### Task 37: Milestone "race"

**Done by:** the supervisor and one agent. **Depends on:** every task from 0 to 35.

- [ ] Add `quali.json` and `race.json` to `default-workbooks/` (Task 0's layouts). The test of Task 36 gets both names.
- [ ] **E2E** `apps/ui/e2e/race-workbook.spec.ts`: a `raceSingapore` replay, open `race`. The tower shows 20 rows, and the incident feed shows at least one collision entry before 79 s.
- [ ] `pnpm check` and `pnpm test:ui`.
- [ ] Commit: `feat(bridge): default quali and race workbooks (milestone race)`.

---

### Task 38: End gates and final review

**Done by:** the supervisor. **Depends on:** Task 37.

- [ ] **Acceptance** (`apps/bridge/test/acceptance/sp3.acceptance.test.ts`, written by a test agent and run by the supervisor):
  - `ttZandvoort`: the lap times on the board equal the recorded laps; the brake band states follow the brake temperatures; every car care rate is 0 or `notApplicable`, and no alarm is raised (spec 11.3).
  - `raceSingapore`: the gaps of 20 cars are defined after the first sector; the feed holds 4 collision entries of the right severity and the penalty entries as minor.
  - `pnpm test:acceptance` passes.
- [ ] **Determinism:** `apps/bridge/test/acceptance/determinism.acceptance.test.ts` covers the new topics: the same recording and sidecar give the same hash for every sub-project 3 topic.
- [ ] **Stryker:** add `packages/analysis` and every new `apps/ui/src/widgets/*/emphasis.ts` to the mutation scope. Run `pnpm mutation` with nothing else running. Score at least 80 %, otherwise add tests for the surviving mutants.
- [ ] **Final review** of the whole diff from the base commit, split by area if it exceeds about 300 KB (analysis, bridge features, UI). Then a fix wave, then a re-review of the fix wave.
- [ ] Update CLAUDE.md "Where to look" (spec, graph) and `docs/architecture.md` (the analysis layer, units of sub-project 3).
- [ ] Write the run's rulings into `docs/superpowers/notes/2026-10-29-sp3-run-rulings.md`. Make sure the questions file holds only real questions.
- [ ] Merge into `main`, push, delete the worktrees and branches.

---

### Task 39 (open): Car care acceptance on the practice recording

**Starts when:** the user says the practice recording (10–15 laps on one set, normal fuel and wear) is in `recordings/`. **Does not block** the merge.

- [ ] Add the recording to `fixtures/index.json` with its features, as the existing entries are.
- [ ] Acceptance tests: the wear rate per corner matches the lap-end wear within 0.2 %/lap; the fuel burn matches the lap-end fuel within 0.05 kg/lap; the ERS trend follows the store; the band states match the recorded temperatures and pressures.
- [ ] Compare the Appendix B car care defaults with the recorded values. List the ones that look wrong in the questions file, as questions, with options.

### Task 40 (open): Timing acceptance on the race recording

**Starts when:** the user says the race recording is in `recordings/`. **Does not block** the merge.

- [ ] Add the recording to `fixtures/index.json`.
- [ ] Acceptance tests:
  - our gaps against the game's `gapToCarAheadMs` and `gapToLeaderMs` within 100 ms at the line
  - the gapper lines are continuous
  - battle closing rates have the sign of the gap change
  - race-moment transitions at SC phases (if any)
  - the car care checks of Task 39 over the race
  - a pit stop restarting the stint rates (Review Focus 2)
- [ ] Mark F8 of the foundation review as done if the race has a stop.
