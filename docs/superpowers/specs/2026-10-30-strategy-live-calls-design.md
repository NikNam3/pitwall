# Pitwall: Sub-project 4a "Strategy: live race calls", Design

Status: spec, awaiting user review · Date: 2026-10-30 · Brainstorm: in conversation (2026-10-30)

## 1. Context

### 1.1 What this sub-project is for
Sub-project 3 delivered timing and car care. The strategy decisions of the race (D21 box now or later, D22 compound, D23 undercut or cover, D24/D25 box under SC/VSC, D26 weather switch) still have no computed answers. Sub-project 4a delivers them as **live race calls**: measured pit loss, a degradation fit, a forecast of the field, and the cards and views that show where we rejoin and what a stop gains. It also adds the **track map** with official turn numbers, the **radio window** and the **weather forecast**. Practice feeds the race through stored knowledge.

### 1.2 Goals
The ranked goals of the foundation spec (1.2) apply unchanged: clean code, extendable code, clean UI, intuitive UX, realism, findability, performance.

### 1.3 Decisions this spec builds on
- **SP3 spec** (`2026-10-29-timing-car-monitoring-design.md`): the analysis/display split, the layers (functions, calculators, analyses, displays), value types in `packages/domain/src/analyses/`, contracts first, the race moment, the build order and the two fronts (sections 4, 8, 13).
- **ADR 0008** (calculator config, stored as a session sidecar): knowledge copies its mechanism (section 4).
- **ADR 0014** (displays render, analyses compute): it foresaw **simulators** for sub-project 4.
- **Research 06** (decisions D01–D33, displays V01–V35, numbers only, no verdicts, the game's pit window never shown) and **research 07** (the strategy layers: estimation, forecast, optimiser).
- **Run rulings of SP3** (`docs/superpowers/notes/2026-10-29-sp3-run-rulings.md`).

### 1.4 Decisions made in this brainstorm (user, 2026-10-30)
1. **Sub-project 4 is split.** **4a, live race calls** (this spec): estimation and forecast. **4b, planning**: the DP optimiser, strategy comparison (V16), strategy overview (V06), plan board (V17), circle of doom (V01), and weather inside the strategy model (a switch at lap N from the forecast).
2. **Weather in 4a:** a forecast strip and the crossover chart (V19).
3. **The track map is in 4a:** per-track geometry and corners, the live map with cars, incident markers and the rejoin ghost, turn numbers in the incident feed, and the radio window (V34). Per-turn time deltas (V26) stay in sub-project 5 and reuse the corner list.
4. **Official turn numbers only.** Any other numbering confuses. They come from FastF1's circuit data (section 6.4); a track without a turn file shows sectors, never detected numbers.
5. **Knowledge lifetimes:** a **track** lifetime (geometry, pit loss) across weekends, and a **weekend** lifetime (degradation, fuel sensitivity) so practice feeds the race. Every value shows where it came from and falls back to community defaults. The user may later want what real teams do (everything across weekends, weighted), so the lifetime is a property of each piece of knowledge and the aggregation is replaceable (section 4).
6. **Rejoin ghost views:** live crossing order (V03), ghost lines on the existing gap chart (V04), and the ghost on the track map. V05 (lap slice) and V02 (gap strip) are dropped; V01 in 4b replaces V02.
7. **Order by dependency, not content.** The run is scheduled by dependency level like SP3 (section 12).
8. **Strategy core: a shared lap model and a field forecast**, with the TUM race simulation as the reference. Every call is a query against them, so the cards cannot disagree, and 4b's optimiser reuses them.
9. **Compute budgets now, Rust only on a measured miss.** Every strategy unit has a budget enforced by a benchmark test. Strategy runs per lap or event, never per frame. The forecast kernel takes plain arrays so it could become Rust/WASM later; that is decided at 4b's DP spike, only if TypeScript misses its budget after profiling.
10. **The existing architecture stays.** Every addition is additive and uses the existing kinds; nothing changes shape except the three planned extensions (gap chart ghost lines, incident turns, the *window* moment).
11. **Mockups for every display**, made by the supervisor as the run's first task and approved in one session, as in SP3 (8.5 there).

## 2. Scope

**In scope:**
1. Repository changes: priors and contributions (ADR 0015), the simulator kind, the storage key fix, the benchmark harness, domain and contract additions (section 3).
2. Shared functions and two simulators, `lap-model` and `race-forecast` (section 5).
3. Three calculators: `track-geometry`, `degradation`, `pit-loss` (section 6).
4. Thirteen analyses, each with its topic, and changes to `incidents` and `race-moment` (section 7).
5. Twelve displays plus the gap chart's ghost lines and the incident feed's turns (section 8).
6. Two new default workbooks, `strategy` and `longrun` (section 9).
7. Turn files for the league calendar, produced outside the run (section 6.4).

**Out of scope:**
- 4b: optimiser, V16, V06, V17, V01, weather in the strategy model
- sub-project 5: Monte Carlo and SC probabilities, rivals' predicted stops, calibration of the defaults (dirty air, overtaking threshold, tyre bands), per-turn deltas (V26), quali tools (V11, V12)
- the second driver's feed (ADR 0009): every unit works per car; "our cars" comes from `session.info`

**Roadmap change:** the foundation spec's table (1.3) splits row 4 into 4a and 4b as in 1.4, moves the track map into 4a, and lists V26 under sub-project 5.

## 3. Repository changes (supervisor, level 0)

### 3.1 Priors and contributions (ADR 0015)
Section 4. Engine: `EngineView.priors`, `definePriors`. Bridge: `Feature.priors`, `Feature.contributions`, the knowledge store, the `<session>.priors.json` sidecar, `--fresh-priors` on `replay` and `reprocess`.

### 3.2 The simulator kind
A **simulator** is a pure function in `packages/analysis/src/<name>/` (a unit like any other) that analyses call to run a model forward. It has no `reads` and no cadence; it is not registered. It takes plain arrays and numbers and returns typed arrays, so its kernel can be replaced without touching callers (1.4 point 9). `gen:catalogue` lists it as a unit of kind `simulator`. ADR 0014 gets one line naming the kind.

### 3.3 Storage key fix
The game reuses session UIDs within an online weekend (both UIDs of the Zandvoort weekend were reused). `sessions` gets a surrogate key `session_key` = `<uid>-<startedAt>`; every child table references it. `SCHEMA_VERSION` becomes 2. Nothing reads the version 1 tables, so a version 1 database is renamed aside with a message and rebuilt by `pitwall reprocess`.

### 3.4 Benchmark harness
`test-support/bench.ts`: `withinBudget(name, budgetMs, fn, { runs })` runs `fn` after a warm-up and fails with the median and the budget when the median exceeds it. Budget tests are ordinary `*.test.ts` files and run in `pnpm test`. A miss is fixed by profiling, never by raising the budget without the user (memory rule "fix slowness, not timeouts").

### 3.5 Domain and contract additions
Appendix A: the knowledge types, the turn file type, the value types of every new analysis, and the topic files. `IncidentWhere` gains `turn`; `Moment` gains `'window'`.

### 3.6 Docs
ADR 0015, the ADR 0014 line, `docs/architecture.md` (priors, simulators), CLAUDE.md map (`data/tracks/`), the foundation roadmap table.

## 4. Knowledge: priors in, contributions out (ADR 0015)

The analyses stay pure. Knowledge copies ADR 0008 one to one:

| Config (ADR 0008) | Priors (new) |
|---|---|
| `EngineView.config`, fixed per run | `EngineView.priors`, fixed per run |
| `defineConfig(key, defaults)` | `definePriors(key, lifetime, defaults, aggregate)` |
| `Feature.config` | `Feature.priors` |
| `<session>.config.json` | `<session>.priors.json` |
| replay uses the sidecar | replay uses the sidecar; `--fresh-priors` uses the current store |

- **Lifetime** is `reference` (committed data, never written: the turn files), `track` (all sessions at this track) or `weekend` (all sessions of this weekend).
- **A contribution** is what one session measured: the pit stops with their losses, the geometry samples, the per-compound fits. A calculator's output carries it; `Feature.contributions` names the calculator and the priors key it feeds.
- **The bridge stores contributions per source session** (`knowledge` table: key, lifetime, scope id, session key, JSON, written at every lap completion and at session end, an upsert). Replaying or reprocessing a session **replaces** its contribution, so nothing is counted twice; a bad session can be dropped by deleting its rows.
- **At session start** the bridge loads every contribution in scope (same track, or same weekend), calls the key's pure `aggregate(contributions)` and passes the result as the prior. With no contributions the prior is the key's `defaults`: the community values, each with a source note.
- **Moving to a real team's database later** (everything across weekends, weighted by age and conditions) is a new `aggregate` and a wider scope, not a migration.
- **Determinism:** priors are an input to the run like the recording. The determinism and segment tests pin them (empty or a committed priors file). The determinism hash covers the topics, not the store.
- **Weekend identity:** the game's `weekendLinkIdentifier` plus the track id. Whether the game reuses the link identifier across weekends is open (section 14).

## 5. Functions and simulators

### 5.1 Functions (pure, imported)
| Name | Computes |
|---|---|
| `lap-classes` (exists) | which laps count; unchanged |
| `per-lap-rate` (exists) | Theil–Sen rates; used for wear per lap |
| `track-lookup` | on a `TrackGeometry`: the corner or straight at a lap distance, the next straight, the map point of a lap distance, the turn label at a lap distance (from the turn file) |
| `tyre-life` | the lap at which a stint reaches its limit: wear at `wearLimitPct` (wear visible) or the age at which the predicted loss reaches `ageLossLimitMs` (wear hidden) |

### 5.2 `lap-model` (simulator)
One predicted lap time, Fieni's split with the TUM age model as the fallback (research 07, 2.1):

```
T_lap = baseMs + compoundOffsetMs
      + ΔT(wear)      wear visible (our cars, AI cars, public players): wear grows by the fitted rate per lap
        or ΔT(age)    wear hidden (restricted, or realism mode on): degMsPerLap · age
      + γ · fuelKg    fuel falls by the car's burn per lap; γ default 0.03 s/kg (Bonomi)
      + dirtyAir(gap) Fieni: a · gap + b for gap in [0.2 s, 1.35 s], else 0
      + in/out-lap and cold-tyre penalty on the stop laps
```

Input per car: a `CarModel` (Appendix A.2) built by the analyses from `degradation`, `pit-loss` and config. `predictLaps(car, fromLap, count, out)` fills `out` without allocating.

### 5.3 `race-forecast` (simulator)
Steps the field lap by lap from the current state. Input: a `ForecastField` (per car: race time at the last line crossing, lap, position, `CarModel`), a list of `ForecastStop { carIndex, lap, compound, condition }` and the number of laps. Per lap:
1. each car's lap time from `lap-model`, including dirty air from its gap at the start of the lap
2. a stop adds that condition's pit loss and resets the tyre to the new compound, age 0, and the out-lap penalty
3. a faster car closes; it **passes** only if its pace advantage exceeds `overtakeThresholdMs`; otherwise it stays `minFollowGapMs` behind
4. positions and gaps update

Output: race time and position per car per lap (`Float64Array`, `Int8Array`, cars × laps).
**Rivals do not stop in 4a** (their predicted stops are sub-project 5). An analysis that shows a rival marks it `stopDue` when `tyre-life` says its tyres are past their limit within the forecast.

## 6. Calculators

### 6.1 `degradation`
Reads `laps`, `stints`, priors `degradation`.
- **Lap-time part:** a Kalman filter per car and stint (Cappello & Hoegh; research 07, 2.2). The state is the tyre pace `α` and the degradation per lap `ν`; the observation is the fuel-corrected lap time; a pit stop starts a new filter from the compound's prior. Only `lap-classes.forPace` laps go in. **Slow outliers only:** a lap slower than the prediction by more than `outlierSd` standard deviations is down-weighted, a faster one never (mistakes and traffic only cost time).
- **Wear part:** wear per lap per corner from `LapRecord.wearAtEndPct` with `per-lap-rate`, and the lap-time cost per wear % from the stint's laps.
- **Fuel sensitivity `γ`:** a weekend prior (default 0.03 s/kg), refined from stints of known fuel.
- **Output:** per car and stint: base pace, `ν` with its standard deviation, the basis (`wear` or `age`), wear rates; per compound the weekend aggregate. Realism mode hides rivals' wear, so their basis is `age`.
- **Contribution (weekend):** per compound: base offset to the soft, `ν`, its standard deviation, the lap count.

### 6.2 `pit-loss`
Reads `pitStops`, `laps`, `flagPhases`, priors `pitLoss`.
- **Per stop of every car:** loss = (in-lap + out-lap) − 2 × the car's racing lap around the stop (median of its `forPace` laps within `referenceLaps` before the stop). The TUM definition (research 03).
- **Condition** from `PitStopRecord.flag`: green, VSC or SC. Stationary time is kept separately (it varies with repairs and wing changes); the loss is stored minus the stationary time above the median, so one long stop does not skew it.
- **Output:** per condition: median loss, sample count, source (`measured`, `stored`, `default`), median stationary time.
- **Contribution (track):** the samples.

### 6.3 `track-geometry`
Reads every car's `motion.position` and `timing.lapDistanceM`, priors `trackGeometry`, `trackTurns`.
- **Centreline:** positions binned by lap distance into `binM` bins; the median per bin over clean laps (no pit, no invalid lap) of any car. One lap of a full field fills it.
- **Corners** from the curvature of the centreline (not from speed, so they also work in realism mode): a corner is a stretch with curvature above `cornerCurvature`, with entry, apex and exit and a direction. **Straights** are stretches below it that are longer than `straightMinM`. **Pit exit** is the median lap distance at `pitLaneExit`.
- **Turn labels** come only from the turn file (`trackTurns` prior). A track without one has no labels.
- **Output:** the geometry, its quality (laps used), `Known` until the first full lap.
- **Contribution (track):** the bin medians and counts, so later sessions refine it.

### 6.4 Turn files (reference data)
- **File:** `data/tracks/<trackId>.json` (committed, supervisor-owned), type `TrackTurns` (Appendix A.1): each official turn with number, letter, label (`T6a`), apex lap distance in m, and a source note; groups such as a chicane.
- **Source:** FastF1's `get_circuit_info()` corners (number, letter, distance along the lap), scaled by the game's `trackLengthM` over the real lap length. The import script is Python and lives outside pitwall (memory rule "keep aux tools separate"), in its own repo.
- **Check:** a test runs every turn file against the stored geometry where a recording exists: every turn lies within `turnSnapM` of a detected corner's apex, in lap order. A failing track is fixed by hand.
- **Reverse layouts** (Silverstone, Austria, Zandvoort reversed) have no official numbering and get no file.
- **Before the run (research task R1):** confirm FastF1's fields and coverage of the F1 25 tracks, and whether the data may be committed (FastF1's code is MIT, the data comes from F1's timing feed). If not, the files are generated locally into the data dir like `external/`, and only the script is shared.

## 7. Analyses

All are computed for our cars (`session.info` `playerCar`, `teammateCar`); a `CarParams` topic for another car answers `notApplicable`. Strategy analyses run on `lapCompleted`, `pitStop` and `flagChange`, plus a `{ hz: 1 }` cadence so gaps stay current, **never per frame** (1.4 point 9).

### 7.1 `pit-losses` → `pitLosses.track` (V33)
The pit loss per condition with sample count and source, plus this session's stops (car, lap, condition, loss, stationary time).

### 7.2 `stint-analysis` → `stintAnalysis.car` (V07)
Per stint: each lap's tyre age, lap time, fuel-corrected time, whether the fit used it (and why not), and the fit line with its uncertainty band; per compound the weekend aggregate. Reads `degradation`.

### 7.3 `raising-average` → `raisingAverage.car` (V08)
The mean of the best X valid laps for X = 1…n in this session; a shallow slope means consistency.

### 7.4 `lap-overview` → `lapOverview.car` (V09)
One entry per lap: time, stint and compound, in/out lap, personal or session best, the heat within its stint (0 = best, 1 = worst `forPace` lap), the track status (green, VSC, SC).

### 7.5 `rejoin` → `rejoin.car`
If our car boxes at the end of this lap, per condition (green, VSC, SC):
- rejoin position, the cars directly ahead and behind with gaps
- the **crossing order** with the ghost inserted (V03)
- the ghost's lap distance at rejoin and its map point (the track map)
- **ghost lines** for the gap chart (V04): our gapper line shifted by each condition's loss (`gaps.gapper` plus pit loss)

Reads `gaps`, `pit-loss`, `degradation`, `track-geometry`; calls `race-forecast` for the out-lap and the first laps after it.

### 7.6 `undercut` → `undercut.car` (V13)
Per neighbour ahead and behind within `undercutRangeMs`: the gap now; `Δ(N)` for N = 1–3 (the time we gain over the rival when we stop now and it stops N laps later, from two forecasts); the margin `Δ(N) − gap`; `stopDue`. The car behind's row is the mirror (cover).

### 7.7 `sc-call` → `scCall.car` (V18)
The standing answer: if an SC (or VSC) came now: pit loss under it, the gain against a green stop, rejoin position, and the rivals within the window who would also gain. `active` says whether an SC or VSC is out, so the display expands.

### 7.8 `pit-sweep` → `pitSweep.car` (V15)
Params: our car and the next compound. Per lap L from the next lap to the end of the window: rejoin position, the cars within `trafficGapMs` in the first `trafficLaps` laps after the rejoin, projected finish time and position with no further stop, and whether the stint to the finish exceeds the compound's life.

### 7.9 `pit-window` → `pitWindow.car`, and the *window* moment
- **Latest lap:** when the current tyres reach their life (`tyre-life`).
- **Earliest lap per next compound:** the last lap minus that compound's life, so it reaches the finish.
- **The window** is from the earliest (over the allowed compounds) to the latest. Both `Known`; `insufficientData` until the fit has `minLaps`.
- **`race-moment`** gains the moment `window` between `neutralised` and `incident` (SP3 spec 7.2): active from `earliest − windowLeadLaps` until our car stops or the window closes. `cause.params`: `earliestLap`, `latestLap`.

### 7.10 `track-positions` → `trackPositions.geometry`, `trackPositions.cars`
- `trackPositions.geometry` (state, rarely): outline, corners with official turn labels, straights, pit exit, sector starts.
- `trackPositions.cars` (state, `maxHz` 10): per car its lap distance, map point and pit status; incident markers from `incidents.feed` (major entries of the last `markerLaps` laps) at their place. Placement is one `track-lookup` per car, budget in 10.3. Realism mode keeps positions (a real team has GPS).

### 7.11 `radio-window` → `radioWindow.car` (V34)
Per our car: on a straight now, seconds left on it, seconds until the next straight (from the car's speed and the distance; the stored median speed per bin when the car is slow).

### 7.12 `weather` → `weather.forecast`
The forecast samples of the current session type in time order, with the accuracy flag and the first sample at or above `rainPct` (`notApplicable` when none). The race moment's weather rule (SP3) is unchanged.

### 7.13 `crossover` → `crossover.field` (V19)
Per lap: the field's median lap time per tyre type (slick, intermediate, wet); the dry reference (the session's best green slick median); our latest lap as % of it; the 110 % line; the first car on the other type that is faster in a sector (car, sector, lap); payback laps = pit loss / (our lap time − the other type's lap time), `notApplicable` when the other type is not faster.

### 7.14 Changes to existing analyses
- **`incidents`:** `IncidentWhere` gains `turn: Known<string>` from `track-lookup` (`notApplicable` without a turn file, the sector stays).
- **`race-moment`:** the `window` moment (7.9).

## 8. Displays

### 8.1 Rules
As SP3 8.1: render and format only, sizes in character cells, compact and full mode, grey by default and colour only to highlight or distinguish, numbers only and no verdicts. Every value that rests on a prior or a default shows its source on hover (`measured · 6 stops`, `default · source`).

### 8.2 The displays
A display never shares its unit name with an analysis (one agent per unit, CLAUDE.md).

| Display | Decision | Reads | Shows |
|---|---|---|---|
| `pit-loss-table` (V33) | D21–D25 | `pitLosses.track` | loss per condition, samples, source; this session's stops |
| `stint-scatter` (V07) | D03, D11, D22 | `stintAnalysis.car` | lap time over tyre age per stint, excluded laps grey, fit and band |
| `raising-average-chart` (V08) | D01, D03 | `raisingAverage.car` | the curve for our cars and chosen rivals |
| `lap-overview-grid` (V09) | D03, D32 | `lapOverview.car` | one block per lap, heat within stint, in/out, bests, status strip |
| `crossing-order` (V03) | D21, D24 | `rejoin.car` | crossing order with the ghost per condition, gap ahead and behind |
| `gap-chart` (exists) | D21, D23 | `gaps.gapper`, `rejoin.car` | adds ghost lines per condition |
| `track-map` | D21, D33, race picture | `trackPositions.geometry`, `trackPositions.cars`, `rejoin.car` | outline with official turns, all cars, our cars white, incident markers, the ghost |
| `radio-clock` (V34) | all calls | `radioWindow.car` | per our car: straight now / seconds to the next |
| `undercut-card` (V13) | D23 | `undercut.car` | per neighbour: gap, Δ(1–3), margin, stop due |
| `sc-card` (V18) | D24, D25, D29 | `scCall.car` | one line in green running; the sheet under SC/VSC |
| `pit-sweep-table` (V15) | D21, D22 | `pitSweep.car` | one row per lap: rejoin, traffic, finish, life exceeded |
| `forecast-strip` | D26 | `weather.forecast` | samples with type, rain %, temperatures and trend |
| `crossover-chart` (V19) | D26 | `crossover.field` | lap times by tyre type, the 110 % line, payback laps |
| `incident-feed` (exists) | D33 | `incidents.feed` | adds the official turn |

### 8.3 UI kit pieces (supervisor, built first)
Pieces two displays share: a **track outline** canvas (map and, later, V26), a **ghost marker** style (crossing order, gap chart, map), a **source badge** (8.1). Others come from the mockups.

### 8.4 Mockups
As SP3 8.5: in level 0 the supervisor makes the mockups of all displays of 8.2 with the real kit and theme, checked by screenshot with the cached headless Chromium, for **one approval session** with the user before any display's test phase. They settle layouts, size modes and the workbooks.

## 9. Workbooks
Two new defaults, seeded when missing (the existing `car`, `quali`, `race` stay as the user has them):
- **`strategy`:** track map, crossing order, gap chart with ghosts, undercut card, SC card, pit sweep, forecast strip, radio window, timing tower.
- **`longrun`:** stint scatter, raising average, lap overview, pit-loss table, crossover chart.
The layouts come from the approved mockups, for the 24" main and the 14" side monitor.

## 10. Testing

### 10.1 Test data
- **Synthetic builders** for edge cases (SP3 11.1), extended with stops, flag phases, positions on a synthetic oval and a priors builder.
- **Segments** (≤ 1 MB, a few seconds to a lap) cut from the existing races, each around one behaviour (research task R2): a green stop, a VSC stop and an SC stop (`raceZandvoortUidReuse`, wet Singapore race), a clean lap of the full field (geometry), a wet crossover moment (Singapore).
- **No whole-recording fact checks** (memory rule "segment tests only"). Whole recordings only for determinism and reprocess.

### 10.2 Per layer
| Layer | Tests |
|---|---|
| simulators | unit and fast-check properties: with no stops and equal pace gaps hold (dirty air off); a car below the threshold never passes; a stop never gains position at the rejoin moment; adding a stop never shortens the race time; the forecast with no stops matches straight extrapolation |
| calculators | builders for edge cases (no clean laps, one sample, an SC that ends mid in-lap, a stint with all laps excluded); segments for a real stop, a real lap of the field |
| analyses | every output field becomes `unknown(reason)` when its input is missing; builders plus segments |
| priors | replaying a session twice leaves the store unchanged; pinned priors give identical topic streams; `aggregate` is order-independent |
| turn files | each file is valid; turns snap to detected corners in order where a recording exists |
| budgets | 10.3 |
| displays | gallery cases from the mockups, `fit.spec`, one baseline per display size within the cap (50) |

### 10.3 Budgets (benchmark tests, on a fixed field of 20 cars and 70 laps)
| Work | Budget |
|---|---|
| one `race-forecast` scenario | < 1 ms |
| `pit-sweep`, all scenarios | < 20 ms |
| each per-lap analysis | < 5 ms |
| `track-positions` placement of the field, per frame | < 50 µs |
| `degradation` update per lap | < 1 ms |

### 10.4 Acceptance
On segments of the real races (no whole-recording fact checks): the loss of a real green stop equals the TUM value computed by hand from the same laps and exceeds its pit-lane time; the geometry built from a clean lap of the field snaps every turn of the Zandvoort file; a VSC and an SC stop are classed by condition. Whole recordings only for determinism (the determinism set of `docs/testing.md`, pinned priors) and reprocess.

## 11. Error handling
- Missing data is `Known` (`insufficientData` below the minimum samples, `notApplicable` outside the race or for other cars, `realism` where realism hides an input). Never 0.
- A prior with no contributions is the default with source `default`; displays show it.
- `config.json` and turn files are strict (a bad file stops the bridge with a message, like ADR 0008). Priors sidecars are read leniently like config sidecars.
- A forecast with a car missing its model drops that car from the forecast and marks results that depend on it `insufficientData`.

## 12. Build order and parallel agents
As SP3 13: one unit per agent, test phase then implement phase, at most 8 agents, the test front runs ahead, the supervisor runs the big suites.

**Starts after the replay-speed fix is merged** (segment cuts and determinism need it).

### 12.1 Level 0 (supervisor)
Contracts and value types (Appendix A), priors and contributions (section 4), the simulator kind, the storage key fix, the benchmark harness, ADR 0015, the kit pieces (8.3), the mockups (8.4).

### 12.2 Levels
| Level | Units |
|---|---|
| 1 | `track-lookup`, `tyre-life`, `lap-model`, `track-geometry`, `pit-loss`, `degradation`, `weather`, `raising-average`, `lap-overview` |
| 2 | `race-forecast`, `pit-losses`, `stint-analysis`, `track-positions`, `radio-window`, `crossover`, `pit-window` with the `race-moment` change, `incidents` change |
| 3 | `rejoin`, `undercut`, `sc-call`, `pit-sweep` |
| displays | each right behind its analysis, after the mockups are approved |

### 12.3 Before the run (research tasks, not workers)
- **R1** FastF1 turn data: fields, F1 25 coverage, licence; the import script in its own repo; turn files for the league calendar.
- **R2** segments from the existing races (10.1).
- **R3** community defaults with sources (Appendix B): pit loss per track, dirty-air coefficients, overtaking threshold, wear limit, `γ`.

## 13. What 4b builds on
4b's DP optimiser calls `lap-model` and `race-forecast`; the plan board's triggers read the 4a topics; weather enters the model as a compound switch at lap N. The budgets of 10.3 are the baseline for its DP spike.

## 14. Open points
1. Does the game reuse `weekendLinkIdentifier` across weekends? Verify with the next league weekend; if it does, the weekend identity adds the date.
2. League rules (compounds, red-flag tyre change) are still unknown; the allowed compounds are config.
3. FastF1 licence (R1).
4. The overtaking threshold and dirty-air coefficients for F1 25 are defaults until sub-project 5 calibrates them.

## Appendix A: Contracts (sketch; the supervisor commits them as code in level 0)

### A.1 Domain additions
```ts
// packages/domain/src/knowledge.ts
export type Lifetime = 'reference' | 'track' | 'weekend';
export type KnowledgeSource = { kind: 'measured' | 'stored' | 'default'; samples: number; note?: string };

// packages/domain/src/tracks.ts (added)
export type TrackTurn = { number: number; letter: string | null; label: string; apexM: Metres };
export type TrackTurns = {
  trackId: number;
  source: string;              // e.g. "FastF1 get_circuit_info, 2025 Dutch GP, scaled 4259 m → 4252 m"
  turns: TrackTurn[];          // in lap order
  groups: { label: string; turns: string[] }[];  // e.g. a chicane
};

// packages/domain/src/analyses/track.ts
export type MapPoint = { x: number; z: number };
export type Corner = { entryM: Metres; apexM: Metres; exitM: Metres; direction: 'left' | 'right'; turn: Known<string> };
export type Straight = { startM: Metres; endM: Metres };
export type TrackGeometry = {
  trackId: number; lengthM: Metres; binM: Metres;
  centreline: MapPoint[];      // one per bin, index = floor(lapDistance / binM)
  corners: Corner[]; straights: Straight[];
  pitExitM: Known<Metres>; sectorStartsM: [Metres, Metres, Metres];
  lapsUsed: number;
};

// incidents.ts
export type IncidentWhere = { sector: Known<1 | 2 | 3>; turn: Known<string> };
// race-moment.ts
export type Moment = 'neutralised' | 'window' | 'incident' | 'weather' | 'battle' | 'carCare';
```

### A.2 Engine, calculator outputs and simulators
```ts
// packages/engine/src/calc/priors.ts
export type PriorsKey<P, C> = {
  key: string; lifetime: Lifetime; defaults: P;
  read(view: EngineView): P;
  aggregate(contributions: C[]): P;     // pure, order-independent
};
export function definePriors<P, C>(key: string, lifetime: Lifetime, defaults: P, aggregate: (c: C[]) => P): PriorsKey<P, C>;
// EngineView gains: priors: DeepReadonly<Record<string, unknown>>
// Feature gains: priors?: PriorsKey[]; contributions?: { calculator: CalculatorId; key: PriorsKey; pick(out): C | undefined }[]

// degradation
export type CompoundFit = { compound: ActualCompound; offsetToSoftMs: Known<Ms>; degMsPerLap: Known<{ mean: number; sd: number }>; laps: number; source: KnowledgeSource };
export type StintFit = {
  carId: CarId; firstLap: number; compound: ActualCompound; basis: 'wear' | 'age';
  baseMs: Known<Ms>; degMsPerLap: Known<{ mean: number; sd: number }>;
  wearPctPerLap: Corners<Known<number>>; msPerWearPct: Known<number>;
};
export type DegradationOut = { stints: StintFit[]; compounds: CompoundFit[]; gammaMsPerKg: { value: number; source: KnowledgeSource } };

// pit-loss
export type PitCondition = 'green' | 'vsc' | 'sc';
export type PitLossSample = { carId: CarId; lap: number; condition: PitCondition; lossMs: Ms; stationaryMs: Ms };
export type PitLossOut = { byCondition: Record<PitCondition, { lossMs: Known<Ms>; stationaryMs: Known<Ms>; source: KnowledgeSource }>; samples: PitLossSample[] };

// lap-model / race-forecast
export type CarModel = {
  baseMs: number; compoundOffsetMs: number; basis: 0 | 1;          // 0 = age, 1 = wear
  degMsPerLap: number; wearPctPerLap: number; msPerWearPct: number; wearPct: number; tyreAge: number;
  fuelKg: number; burnKgPerLap: number; gammaMsPerKg: number;
};
export type ForecastParams = { overtakeThresholdMs: number; minFollowGapMs: number; dirtyAirA: number; dirtyAirB: number; outLapPenaltyMs: number; pitLossMs: Record<PitCondition, number> };
export type ForecastField = { cars: CarModel[]; raceTimeMs: Float64Array; lap: Int16Array };
export type ForecastStop = { carIndex: number; lap: number; newTyres: CarModel; condition: PitCondition };  // newTyres: the model of the fitted set
export type ForecastResult = { laps: number; raceTimeMs: Float64Array; position: Int8Array };   // cars × laps, row-major
export function forecast(field: ForecastField, stops: readonly ForecastStop[], laps: number, p: ForecastParams): ForecastResult;
```

### A.3 Topics (value types in `packages/domain/src/analyses/`, topic files in `packages/contracts/src/topics/`)
| Topic | Params | Mode, maxHz | Value |
|---|---|---|---|
| `pitLosses.track` | none | state, 1 | `{ byCondition: …as PitLossOut; stops: PitLossSample[] }` |
| `stintAnalysis.car` | `CarParams` | state, 1 | `{ stints: { firstLap; lastLap; compound; basis; points: { lap; tyreAge; lapMs; correctedMs; used: boolean; excludedBy: Known<string> }[]; fit: Known<{ baseMs; degMsPerLap; sdMs }> }[]; compounds: CompoundFit[] }` |
| `raisingAverage.car` | `CarParams` | state, 1 | `{ points: { n: number; meanMs: Ms }[] }` |
| `lapOverview.car` | `CarParams` | state, 1 | `{ laps: { lap; lapMs; stint; compound; kind: 'normal' \| 'in' \| 'out'; best: 'none' \| 'personal' \| 'session'; heat: Known<Ratio>; status: 'green' \| 'vsc' \| 'sc' }[] }` |
| `rejoin.car` | `CarParams` | state, 1 | `{ conditions: { condition: PitCondition; lossMs: Known<Ms>; position: Known<number>; ahead: Known<{ carId; gapMs }>; behind: Known<{ carId; gapMs }>; order: { carId: CarId \| 'ghost'; gapToNextMs: Known<Ms> }[]; lapDistanceM: Known<Metres>; point: Known<MapPoint> }[]; ghostLines: { condition: PitCondition; byLap: { lap; gapMs: Ms }[] }[] }` |
| `undercut.car` | `CarParams` | state, 1 | `{ rivals: { carId; side: 'ahead' \| 'behind'; gapMs: Known<Ms>; deltaMs: [Known<Ms>, Known<Ms>, Known<Ms>]; marginMs: [Known<Ms>, Known<Ms>, Known<Ms>]; stopDue: boolean }[] }` |
| `scCall.car` | `CarParams` | state, 1 | `{ active: 'none' \| 'sc' \| 'vsc'; options: { condition: 'sc' \| 'vsc'; lossMs: Known<Ms>; gainVsGreenMs: Known<Ms>; position: Known<number>; alsoGain: CarId[] }[] }` |
| `pitSweep.car` | `{ carId; compound: ActualCompound }` | state, 1 | `{ rows: { lap; position: Known<number>; trafficCarIds: CarId[]; finishMs: Known<Ms>; finishPosition: Known<number>; exceedsLife: boolean }[] }` |
| `pitWindow.car` | `CarParams` | state, 1 | `{ latestLap: Known<number>; earliestByCompound: { compound; lap: Known<number> }[]; window: Known<{ from: number; to: number }> }` |
| `trackPositions.geometry` | none | state, 0.2 | `Known<TrackGeometry>` |
| `trackPositions.cars` | none | state, 10 | `{ cars: { carId; lapDistanceM; point: MapPoint; inPit: boolean }[]; incidents: { entryId; lapDistanceM; label: string }[] }` |
| `radioWindow.car` | `CarParams` | state, 4 | `{ onStraight: boolean; secondsLeft: Known<number>; secondsToNext: Known<number> }` |
| `weather.forecast` | none | state, 0.2 | `{ samples: ForecastSample[]; accuracy: 'perfect' \| 'approximate'; firstRain: Known<{ offsetMin; rainPct }> }` |
| `crossover.field` | none | state, 1 | `{ dryReferenceMs: Known<Ms>; ourRatioPct: Known<number>; byType: { type: 'slick' \| 'inter' \| 'wet'; byLap: { lap; medianMs: Ms }[] }[]; firstFaster: Known<{ carId; sector: 1 \| 2 \| 3; lap; type }>; paybackLaps: Known<number> }` |

## Appendix B: Config defaults (to calibrate in sub-project 5)
Sources are filled in by R3; values marked "pitwall estimate" are starting points.

| Unit | Key | Default | Source |
|---|---|---|---|
| `lap-model` | `gammaMsPerKg` | 30 | Bonomi et al. 2023 |
| `lap-model` | `dirtyAirA`, `dirtyAirB`, range | from Fieni 2026 (≈0.4 s close behind), 0.2–1.35 s | Fieni 2026, Bahrain |
| `race-forecast` | `overtakeThresholdMs` | R3 (TUM's real-F1 value as the start) | TUM |
| `race-forecast` | `minFollowGapMs` | 300 | pitwall estimate |
| `race-forecast` | `outLapPenaltyMs` | measured out-laps, else R3 | TUM |
| `tyre-life` | `wearLimitPct` | 70 | pitwall estimate |
| `tyre-life` | `ageLossLimitMs` | 2000 | pitwall estimate |
| `degradation` | `outlierSd`, process noise | 2.5, R3 | Cappello & Hoegh |
| `pit-loss` | `referenceLaps` | 3 | TUM |
| `pit-loss` | defaults per track and condition | R3 | community |
| `track-geometry` | `binM`, `cornerCurvature`, `straightMinM`, `turnSnapM` | 5, R3, 200, 40 | pitwall estimate |
| `undercut` | `undercutRangeMs` | 5000 | pitwall estimate |
| `pit-sweep` | `trafficGapMs`, `trafficLaps` | 1350, 3 | Fieni 2026 (dirty-air range) |
| `pit-window` | `windowLeadLaps`, `minLaps` | 2, 3 | research 06 §4 |
| `track-positions` | `markerLaps` | 2 | pitwall estimate |
