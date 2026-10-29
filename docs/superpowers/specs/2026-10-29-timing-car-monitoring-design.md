# Pitwall: Sub-project 3 "Timing + car monitoring", Design

Status: spec, awaiting user review · Date: 2026-10-29 · Brainstorm: in conversation (2026-10-29) · Dependency graph: [`2026-10-29-timing-car-monitoring/dependency-graph.html`](2026-10-29-timing-car-monitoring/dependency-graph.html) (open it in a browser; hover a box to see what it reads and what reads it)

## 1. Context

### 1.1 What this sub-project is for
The UI shell (sub-project 2) has one placeholder widget. Sub-project 3 delivers the **first working race-engineer panel**: car care and timing for practice, qualifying and the race, everything except strategy. After it, `pnpm desktop` is usable in a league weekend and in preseason training.

### 1.2 Goals
The ranked goals of the foundation spec (1.2) apply unchanged: clean code, extendable code, clean UI, intuitive UX, realism, findability, performance.

### 1.3 Decisions this spec builds on
- **UI shell spec** (`2026-10-28-ui-shell-design.md`): the extension model (analyses, displays, topic owners, write scopes), the display contract (`defineWidget`, sizes in character cells, panel-header states), the visual system (grey by default, colour only to highlight or distinguish, one colour per team in every chart, our cars white), realism mode and its `Known` fields.
- **Research 06** (`docs/research/06-engineer-decisions.md`): the decision and display catalogue (D01–D33, V01–V35), the escalation map (§4), numbers only and no verdicts, the two-second glance budget.
- **ADR 0008**: read-only calculator config, stored as a sidecar with each session.

### 1.4 Decisions made in this brainstorm (user, 2026-10-29)
1. **Scope C:** car care and timing together, in **one plan with two milestones** ("car", then "race"), ordered by the real dependencies so as many agents as possible work in parallel (section 13).
2. **Recordings:** unit and property tests are synthetic. Acceptance tests that need real car or race data wait for recordings the user will supply (a practice session and a full race, both planned, timing unknown); until then those tasks are open and the rest merges. The user's notification starts them.
3. **All three sessions:** timing covers practice, qualifying and the race. V08 (raising average) and V09 (lap overview heat map) move to sub-project 4, next to the stint/degradation scatter V07, because they serve the same decision (D03) and read the same stint data.
4. **Calibration is not in the MVP.** Sub-project 3 uses community figures and hand-set defaults in config, each with a source note. Calibration joins coaching in sub-project 5, renamed "training: calibration and coaching", because both happen in training, need per-lap channel traces and serve the same people. Appendix B lists every value to calibrate.
5. **`race.moment` is built here**, with every moment except the pit window (sub-project 4).
6. **`packages/strategy` is renamed `packages/analysis`** while it is empty.
7. **Displays render, analyses compute.** A widget formats and applies emphasis and nothing else. All maths lives in analyses, which combine calculators (and, from sub-project 4, simulators). There are no display-private calculations in new work.
8. **Bottom-up, shared first.** Calculators, then analyses, then displays. Anything two parallel developers would share (a calculator, an intermediate value, a UI component) is built first, so two display developers, or two analysis developers that share no intermediate value, never interact.
9. **Contracts first.** The dependency graph and every contract between the parts (Appendix A) are written down before the run, and the supervisor commits them as code before any test agent starts.
10. **Incident severity:** only major incidents change the race moment (section 7.3).

## 2. Scope

**In scope:**
1. Repository changes: the rename, domain and contract additions, a new ADR (section 3).
2. Five shared calculators and functions (section 4).
3. Six car care analyses including `alarms` (section 5), five timing analyses including `race-moment` (section 7), all publishing topics.
4. Twelve displays and the UI kit pieces they share (section 8).
5. Three workbooks: `car`, `quali`, `race` (section 9).
6. The first task fixed by the UI shell question Q5: gallery cells and baselines for the top bar and the shell overlays, and the e2e test "`pitwall dev` restores the moment" (section 10).

**Out of scope:**
- everything that needs pit loss, degradation fits, rejoin projection or a race simulation (sub-project 4): ghosts, undercut card, SC card, pit-lap sweep, the pit window moment
- V08 raising average, V09 lap overview (sub-project 4)
- calibration of the defaults, coaching, delta traces (sub-project 5)
- a track map (a later display); quali traffic and release tools (V12)
- the second driver's feed (ADR 0009): every analysis works per car, and "our cars" comes from `session.info` (`playerCar`, `teammateCar`), so a second feed needs no redesign

**Roadmap change:** the foundation spec's sub-project table (1.3) gets V08 and V09 under sub-project 4 and the new name of sub-project 5.

## 3. Repository changes (supervisor, W0)

### 3.1 Rename `packages/strategy` → `packages/analysis`
Package name `@pitwall/analysis`. Updated in one commit: the folder, every `package.json`, `pnpm-lock.yaml`, dependency-cruiser rules, the Stryker config, `guard-scope.sh` (`PITWALL_WORKER_UNIT` grants `packages/analysis/src/<name>/` and `packages/analysis/test/<name>/`), CLAUDE.md (map, dependency direction, unit folders), `docs/architecture.md`, ADR 0011 (paths). The dependency direction is unchanged: `analysis` imports `engine` and `domain`.

### 3.2 Where the contract types live
`contracts` may import only `domain`, and `analysis` may not import `contracts`. So the value types that an analysis computes and a topic publishes live in **`packages/domain/src/analyses/<name>.ts`** (one file per analysis, JSON-safe), and both sides import them. The topic file in `packages/contracts/src/topics/` names the type, params, mode and rate. Types internal to a calculator stay in its `packages/analysis/src/<name>/` folder.

### 3.3 Domain changes
- `UnknownReason` gains `'insufficientData'`: too few laps or samples for a rate or a mean yet. It renders as an empty cell with the reason on hover, like every other reason.
- `LapRecord` gains the lap-end samples (Appendix A.1). The engine fills them where it writes the record today (`packages/engine/src/history/`), so no second calculator re-detects lap ends. They are stored in SQLite with the record, which also serves sub-projects 4 and 5.

### 3.4 `race.moment` → `raceMoment.current`
Topic names start with their owner (UI shell spec 3.2), so the top bar's reserved name becomes `raceMoment.current`, owned by the `race-moment` analysis. The top bar's `Moment` segment is updated to read it (W0).

### 3.5 ADR 0014 "Displays render, analyses compute"
It records decisions 7 and 8 of 1.4. It amends ADR 0011: the display-private feature folder stays possible in the code but is not used in new work; maths that only one display needs is still an analysis. CLAUDE.md's Workflow section gets the rule in one line.

## 4. Shared calculators and functions

All pure, in `packages/analysis/src/<name>/`, built first (levels 0 and 1, section 13.3). A **function** is imported by the analyses that use it. A **calculator** is an engine calculator (`reads`, run in dependency order) registered once by its own bridge feature with no topics, and its output is read by other calculators through `reads: [{ calculator }]`.

| Name | Kind | Computes |
|---|---|---|
| `lap-classes` | function | Per `LapRecord`: `forPace` (valid lap, no in/out lap, `scShare` and `vscShare` 0, not lap 1 of a race), `forRate` (no in/out lap, `scShare` and `vscShare` 0), `forBest` (per sector: the sector is valid; lap: the lap is valid). The one definition of "which laps count". |
| `per-lap-rate` | function | Theil–Sen slope (median of pairwise slopes, robust against one odd lap) of `{ lap, value }` samples over the last `window` samples; `unknown('insufficientData')` below `minSamples`. `lapsUntil(rate, now, target)`: laps until the value reaches `target`, `notApplicable` when the rate moves away from it. |
| `pace-delta` | function | Time lost per lap after an event: mean of the `forPace` laps after it minus mean of those before it, at least two on each side, otherwise `insufficientData`. |
| `session-remaining` | calculator | For the session: laps left as a fraction (race: `totalLaps` minus the leader's completed laps and lap fraction) or time left (timed sessions: `timeLeftMs`), with the basis `laps` or `time`. |
| `pace` | calculator, reads `lap-classes` | Per car: mean of the last `window` `forPace` laps, and the mean of the current stint's `forPace` laps. No fuel correction: that belongs to sub-project 4's degradation model. |

Defaults: Appendix B.

## 5. Car care analyses

All run in practice, qualifying and the race, for every car whose data is visible. Rival data hidden by realism arrives as `unknown('realism')` and passes through unchanged. Each publishes one per-car topic with `CarParams` (`{ carId }`). Types: Appendix A.2.

### 5.1 `tyre-wear` → `tyreWear.car`
Reads `per-lap-rate`, the lap history (`wearAtEndPct`) and the car state. Per corner: wear now, rate in %/lap over the `forRate` laps of the current stint, laps until the wear limit (config). Also the fitted set's game life span (`TyreSet.lifeSpanLaps`) as a reference marker, labelled as the game's figure.

### 5.2 `fuel` → `fuel.car`
Reads `per-lap-rate`, `session-remaining`, the lap history (`fuelAtStartKg`, `fuelAtEndKg`) and the car state. Fuel now, burn in kg/lap over `forRate` laps, laps of fuel (`kg / burn`), laps left, **margin in laps** (`lapsOfFuel − lapsLeft`), and the **save target** in kg/lap when the margin is negative (`burn − kg / lapsLeft`; `notApplicable` otherwise). The game's `remainingLaps` is published separately as `gameRemainingLaps`, because its meaning is unverified (research 06 §5, item 3).

### 5.3 `ers` → `ers.car`
Reads `per-lap-rate`, the lap history (`ersStoreAtEndJ`) and the car state. Store now and capacity, deployed and harvested this lap against the per-lap deploy limit, store trend in J/lap, the attack level (config) and laps until the store reaches it, and the ERS mode.

### 5.4 `car-bands` → `carBands.car`
Reads the car state and config. Per channel (tyre surface, carcass and pressure per corner; brake temperature per corner; engine temperature): the value, its state (`below`, `in`, `above`), since when it is out of band, and whether it has been out for a full lap. Tyre bands are per compound. A state change needs the value to cross the band edge by the hysteresis margin, so a value on the edge does not flicker.

### 5.5 `damage` → `damage.car`
Reads `pace`, `pace-delta`, the lap history and the car state. Damage per part now (wings, floor, diffuser, sidepod, gearbox, engine), tyre and brake damage per corner, the faults (DRS, ERS), and the **jumps**: a part's damage rising by at least the jump threshold within a short window. Per jump: when, which parts, by how much, and the measured lap-time loss via `pace-delta`, `insufficientData` until there are two `forPace` laps after it.

### 5.6 `alarms` → insights
Reads the five analyses above and the car state. It raises `Insight`s (domain type, existing). The `critical` ones are tier-1 alerts in the top bar until acknowledged (UI shell spec 7.7). The alarm list shows all of them. Rules (thresholds in config):

| Rule | Severity | Category |
|---|---|---|
| a channel out of band for a full lap | `critical` | `tyres` (tyre channels), `damage` (brakes, engine) |
| a channel out of band, less than a lap | `advisory` | as above |
| laps until the wear limit below the threshold | `critical` | `tyres` |
| fuel margin below zero | `critical` | `energy` |
| a damage jump | `critical` | `damage` |
| one corner-cutting warning left before a penalty | `advisory` | `race` |
| a new penalty for our car | `critical` | `race` |

Alarms are raised for our cars only. Each is resolved when its condition ends. Muting works per category, as built in the UI shell.

## 6. Timing analyses

### 6.1 `gaps`
Reads the mini-sector history (`MiniSectorCrossing`, 50 per lap) and the car state. **All gaps come from the crossings**, never from the game's `gapToCarAheadMs`: the game gives only "to ahead" and "to leader", and two sources would show two numbers for the same gap. The gap of car A behind car B is A's crossing time minus B's crossing time at the same lap and segment, taken at A's latest crossing. It updates 50× per lap and works for any pair. A car B has not yet reached is behind. Laps down follow from the total distance. Runs in every session. It is an incremental calculator over the history delta and handles `truncated` (flashback) by restarting from the truncated history.

Topics:
- `gaps.intervals`: per car, to the leader, to the car ahead, to the car behind, laps down.
- `gaps.toCar` (`CarParams`): every car's signed gap to one car (positive = behind it), and laps down.
- `gaps.gapper` (`{ reference }`): per car, per completed lap, the gap to a virtual car at constant pace. `reference` is `{ kind: 'leaderAverage' }` (default: the leader's mean lap so far, recomputed every lap, so the lines shift as the race goes on), `{ kind: 'carAverage', carId }` or `{ kind: 'fixed', lapMs }`.
- `gaps.neighbourhood`: per our car, the cars within ±1 position or ±`neighbourhoodMs` of it.

### 6.2 `lap-times`
Reads `lap-classes`, `pace`, the lap history, the mini-sector history and `session.info`. Runs in every session.
- `lapTimes.board` (`{ referenceCarId }`): per car, the last lap, the personal-best lap and sectors, the theoretical best (sum of best sectors) and the deltas of all of them to the reference car. Per sector of the latest lap, a status `sessionBest`, `personalBest` or `none`, so the display only maps a status to a colour. Plus the session-best lap and sectors with their holder.
- `lapTimes.projection` (`CarParams`): for a car on a lap that is not an in or out lap, the **projected lap** = elapsed time at its latest crossing k + (its best lap − its best lap's time at crossing k), the live delta to its best, and its projected position. In qualifying also the **cut-off**: the position that is knocked out, the cut-off time and our margin to it. In timed sessions the **finish margin**: the time left on the clock when the car will cross the line, positive if another lap can still start (this replaces V11's dot on a track map).

### 6.3 `battle` → `battle.cards` (`CarParams`)
Reads `gaps`, `pace`, `per-lap-rate` and the car state. Race only. For each of our cars, the car ahead and the car behind:
- gap now
- closing rate in ms/lap (`per-lap-rate` over the gap at each line crossing)
- laps to DRS range (`drsRangeMs`)
- pace delta (`pace`)
- the pace delta's margin over the overtaking threshold (config)
- compound and tyre age of both cars
- the rival's ERS store when visible

Numbers only, no "can pass".

### 6.4 `incidents` → `incidents.feed`
Reads `gaps` (the neighbourhood and the gaps before and after), `damage`, `pace-delta`, the events, the flag phases and the mini-sector history. Race only. One entry per incident to our cars or a car in their neighbourhood at that moment:

| Kind | Source | Severity (default) |
|---|---|---|
| `collision` | `collision` event | major |
| `retirement` | `retirement` event | major |
| `damage` | a `damage` jump | major |
| `timeLoss` | a mini-sector more than `timeLossMs` slower than the car's median for that segment over its last laps: the only way to see a spin or an off, since the game sends no event for them | major |
| `warning` | `cornerCuttingWarnings` increases | minor |
| `penalty` | `penalty` event | minor |
| `neutralised` | an SC, VSC or red phase starts | minor |

Per entry: when, lap, kind, severity, the cars involved, the time lost (from the mini-sector at once, then `pace-delta` once there are laps), and **what changed for us**: per our car, the position and the gap to the involved car before and after. An entry updates as its time lost resolves, so the topic is a `state` topic with the last `feedLength` entries, newest first. Which kinds are major is config, so warnings can be moved up later.

## 7. The race moment

### 7.1 `race-moment` → `raceMoment.current`
Reads the flag phases, `incidents`, `battle`, the active insights from `alarms` and `session.info`. Race only, `notApplicable` in other sessions. Publishes the current moment, since when, the rule that set it, and every moment that is active underneath.

### 7.2 Moments, highest priority first
1. **neutralised:** an SC, VSC or red phase is active.
2. **incident:** a major incident entry within the last `incidentHoldMs`.
3. **weather:** a forecast sample within `weatherHorizonMin` has `rainPct` at or above `weatherRainPct`.
4. **battle:** a battle card has laps to DRS range at or below `battleLaps`, or a gap at or below `drsRangeMs`.
5. **carCare:** the default.

Sub-project 4 adds the pit window between 1 and 2.

### 7.3 Why only major incidents count
Track-limit warnings and penalties are frequent with friends driving and AI cars around. If every feed entry set the moment, it would sit on "incident" for much of the race and hide "battle" and "car care". A highlight that is always on stops being a highlight. Warnings and penalties still reach the engineer: those for our car are alarms (5.6) and therefore tier-1 alerts.

### 7.4 How displays use it
A display may read `raceMoment.current` as an optional topic, and its emphasis functions decide which of its values light up in which moment. The layout never changes with the moment (research 06 §1.3, point 5).

## 8. Displays

### 8.1 Rules for every display
- It reads only analysis topics and core topics. It formats and applies emphasis, nothing else. Emphasis lives in `emphasis.ts` as pure functions from states in topic values to theme roles, and is tested.
- Hidden or missing values are empty cells with the reason on hover. Estimates, staleness and errors work as built in the UI shell.
- Each has a compact and a full size mode in character cells. Column priorities and exact sizes come from the approved mockups (8.4).

### 8.2 Car care displays (all sessions; milestone "car")

| Display | Reads | Shows | Lights up |
|---|---|---|---|
| `corner-block` (V22) | `carBands.car`, `tyreWear.car`, `car.detail` | `CornerGrid`: per corner surface and carcass temperature, pressure, brake temperature, wear; engine temperature | a channel out of band (warning), out for a full lap (critical) |
| `tyre-life-bar` (V21) | `tyreWear.car`, `car.detail` | per corner a `Bar`: wear, rate, laps to the limit; the game's life span as a marker; `CompoundMark` and age | laps to the limit below the alarm threshold |
| `fuel-gauge` (V20) | `fuel.car` | margin in laps (main number), burn per lap, save target, the game's estimate dimmed | margin below zero |
| `ers-budget` (V23) | `ers.car`, `raceMoment.current` (optional) | store `Bar` with the attack-level line, deployed this lap against the limit, laps to the attack level | in the battle moment: store and laps to the attack level |
| `damage-card` (V31) | `damage.car` | damage per part, tyre and brake damage per corner (`CornerGrid`), faults, the last jump with its Δ and measured loss per lap | a new jump |
| `alarm-list` (V25) | `insights`, `ui.alerts` | active alarms by severity with acknowledge and mute by category, each as an insight line | severity by theme role |

### 8.3 Timing displays (milestone "race")

| Display | Sessions | Reads | Shows | Lights up |
|---|---|---|---|---|
| `timing-tower` (V29) | all | `cars.overview`, `gaps.intervals`, `gaps.toCar`, `lapTimes.board`, `stints`, `pitStops`, `raceMoment.current` (optional) | position and change, car, interval, gap to our car, last lap, compound and age, stops, warnings and penalties, pit status | sector and lap status (rule from the mockups), our cars, the neighbourhood in the incident moment |
| `gap-chart` (V04) | race | `gaps.gapper`, `flagPhases` | gapper line per car with SC/VSC phase bands; the reference in the panel header | our cars white, every other car in its team colour (UI shell rule) |
| `lap-analysis` (V28) | all | `lapTimes.board` | best lap and sectors per car as deltas to the reference car, theoretical best | session and personal bests |
| `projected-lap` (V10, V11) | practice, quali | `lapTimes.projection`, `session.info` | projected lap, delta to best, projected position; in quali the cut-off and our margin; in timed sessions the finish margin | projection beyond the cut-off (critical), finish margin below zero |
| `battle-cards` (V14) | race | `battle.cards`, `raceMoment.current` (optional) | ahead and behind: gap, closing rate, laps to DRS, pace delta and its margin, tyres, rival ERS | in the battle moment: the card at or below `battleLaps` |
| `incident-feed` (V35) | race | `incidents.feed`, `raceMoment.current` (optional) | one line per incident: lap, cars, what, time lost, what changed for us (`P7→P9`, gap); minor entries dimmed | in the incident moment: the newest major entry |

### 8.4 UI kit pieces, built first (supervisor)
Each is used by two or more displays, so it is built in W0 (13.2), before any display, and its props are part of the contracts (Appendix A.4). Two agents build them: one the car care group, one the timing group.

| Piece | Where | Used by | Group |
|---|---|---|---|
| `CornerGrid` | `kit/corners/` | corner-block, tyre-life-bar, damage-card | car care |
| `Bar` | `kit/bar/` | tyre-life-bar, fuel-gauge, ers-budget | car care |
| unit formats (°C, psi, %, kg, laps, J) | `kit/values/format.ts` | every car care display | car care |
| insight line (moved out of the top bar) | `kit/insight/` | alarm-list, top bar | car care |
| `CompoundMark` | `kit/compound/` | tyre-life-bar, timing-tower, lap-analysis, battle-cards | car care |
| `CarLabel` | `kit/car/` | every timing display | timing |
| position mark (`▲2`, `P7→P9`) | `kit/values/` | timing-tower, incident-feed | timing |
| phase bands (SC/VSC background) | `kit/chart/` | gap-chart (sub-project 4's charts later) | timing |
| our-cars highlight | `kit/car/` + `emphasis/` | timing-tower, gap-chart, lap-analysis | timing |
| sector status emphasis | `emphasis/` | timing-tower, lap-analysis, projected-lap | timing |

### 8.5 Mockups
In W0 the supervisor makes the mockups of all twelve displays with the cached headless Chromium, checked by screenshot, and the user approves them in one session before any display's test phase starts. They settle the column layout and size modes of every display, and the two open colour questions of the UI shell spec (13): **compound as a letter or a letter plus colour**, and **which personal-best sectors light up**. Both become theme variants, as the UI shell spec planned.

## 9. Workbooks
Shipped as defaults in `PITWALL_DATA_DIR/ui/workbooks/` when missing, never overwriting a user's file. The layouts come from the approved mockups, for the 24" main and the 14" side monitor.
- **`car`** (milestone "car"): the six car care displays. Usable in preseason training before the timing displays are done.
- **`quali`** and **`race`** (milestone "race"): `quali` for practice and qualifying (tower, lap analysis, projected lap plus car care), `race` for the race (tower, gap chart, battle cards, incident feed plus car care).

## 10. First task (UI shell question Q5)
In W0, in parallel with the kit pieces and right after the contracts (13.2): gallery cells and screenshot baselines for the top bar and the shell overlays (palette, key overview, settings popover, inspector), and the e2e test "`pitwall dev` restores the moment after a feature change" (UI shell spec 9.3).

## 11. Testing

### 11.1 Test data
`test-support/` gets plain builders with defaults (W0, 13.2):
- `lap({ carId, lapNumber, lapTimeMs, … })`
- `crossings(carId, lap, lapTimeMs)` (50 evenly spaced crossings)
- `event({ kind, carId, at, … })`
- `flagPhase({ kind, start, end })`
- `field({ cars, laps, paceMs })`, which strings laps and crossings together for N cars

A test builds a pit stop, an SC or a collision by overriding fields or appending an entry, and a flashback by truncating the arrays. No scenario library, no seeds, no noise model.

### 11.2 Per layer

| Layer | Tests |
|---|---|
| Shared functions and calculators | Unit tests and fast-check properties. `per-lap-rate`: a linear series gives its slope; adding a constant changes nothing; one outlier changes little; `insufficientData` below the minimum. `lap-classes`: an SC lap never counts for pace or rate. `pace-delta`: symmetric in sign. |
| Analyses | Unit tests on builder data. Property tests: `gaps` gives gap(A,B) = −gap(B,A), and gap(A,C) = gap(A,B) + gap(B,C) at a segment all three have crossed. For every incremental analysis, **after a flashback the output equals a fresh run over the truncated history**. Replay determinism: the same recording and config sidecar give the same topics. |
| Displays | As in the UI shell: gallery cases (typed by the committed contracts), emphasis tests, fit tests at every size mode, screenshot baselines through Electron. |
| Mutation | Stryker over `packages/analysis` and the new `emphasis.ts` files, at least 80 %. Once at the end of the run, not per task. |
| End-to-end | Milestone "car": bridge + `ttZandvoort` replay → the `car` workbook shows the corner block with values. Milestone "race": `raceSingapore` → the `race` workbook shows a tower with 20 rows and incident entries. |

### 11.3 Acceptance on real recordings
**What the time trial holds fixed** (checked 2026-10-29 by replaying `ttZandvoort` lap by lap): tyre wear 0 %, tyre surface and carcass temperature 93 °C from lap 2, pressure 30.16 psi, engine temperature 110 °C, ERS store 4 MJ with nothing deployed or harvested, fuel 10.0 kg. Only the lap and sector times and the brake temperatures (309–355 °C) change. So it cannot check the car care model.

- **Now:** `ttZandvoort` (15 laps, one car) covers lap times, the projection and the brake temperature band, and checks that every car care analysis gives a zero rate and a steady state on fixed inputs (no false alarm, no division by zero). `raceSingapore` (79 s, 20 cars) covers gaps at the start and incidents: its COLL ×4 and PENA ×6 events appear as feed entries of the right kind and severity.
- **When the user's practice recording arrives** (10–15 laps on one set, normal fuel and wear): wear rate and laps to the limit, fuel burn and margin, the ERS trend, temperature and pressure bands against the defaults, so Appendix B's car care defaults can be compared with what the game actually sends. Until then this task is open.
- **When the user's race recording arrives:** our gaps against the game's `gapToCarAheadMs` and `gapToLeaderMs` within a tolerance, the gapper lines, battle closing rates, race-moment transitions, and the car care checks again over a full race. Until then this task is open.
- The plan merges without these open tasks.

## 12. Error handling
- Expected gaps are values: `insufficientData` (too few laps), `notApplicable` (wrong session, carcass temperature in surface-only mode, save target with a positive margin), `realism`, `notReceived`.
- A calculator that throws is a bug. The scheduler already marks it failed and skips the calculators that read it, and the panel header shows `errored`, never old or invented numbers.
- A session change resets every analysis. A flashback truncates the history, and every incremental analysis restarts from the truncated history (11.2).
- Config: new keys follow ADR 0008. A wrong value in `config.json` stops the bridge with a clear message; sidecars are read leniently.

## 13. Build order and parallel agents

One plan with two milestones. The order follows the real dependencies, not the car care / timing split: the timing analyses barely depend on car care (`gaps` reads only the mini-sector history), so building car care first and timing second would leave agent slots idle for half the run. The [dependency graph](2026-10-29-timing-car-monitoring/dependency-graph.html) shows the same levels.

### 13.1 The life of a unit
Every analysis, calculator and display goes through the same five steps (CLAUDE.md, Workflow):
1. **Test phase:** a test agent writes the failing tests against the committed contracts and commits them.
2. **Ruling:** the supervisor answers the assumptions the test agent listed, before the implementer starts.
3. **Implement phase:** an implementation agent makes the tests pass without touching them.
4. **Review:** a reviewer agent; fixes go back to the implementer.
5. **Merge** to the integration branch as soon as the review is clean.

Steps 1, 3 and 4 each take one agent slot.

### 13.2 W0: the only serial stretch (supervisor)
Done in this order, so the parallel part can start as early as possible:
1. **Rename** `packages/strategy` → `packages/analysis` (3.1). It touches everything, so it goes first, alone.
2. **Contracts as code:**
   - the domain additions (3.3)
   - every value type and topic file (Appendix A)
   - the `LapRecord` lap-end samples in the engine
   - `raceMoment.current` in the top bar (3.4)
   - every config key with its default and source note (Appendix B)
   - ADR 0014 and CLAUDE.md (3.5)
3. **Then, in parallel:**
   - **agents:** the first task (section 10: overlay gallery and the `pitwall dev` e2e test), the test builders (11.1), and the kit pieces (8.4: all ten, in two agents, one for the car care pieces and one for the timing pieces)
   - **supervisor:** the mockups of **all twelve displays**, checked by screenshot, for **one approval session** with the user (8.5). One wait instead of two, and no display waits on a second session.

As soon as the contracts and the test builders are merged, the analysis test phases can start, while the kit and the mockups are still in progress.

### 13.3 Levels
A unit's implementation can start once every unit it reads is merged. Grouped by the earliest point that happens:

| Level | Analyses and calculators | Displays |
|---|---|---|
| 0 | `lap-classes`, `per-lap-rate`, `pace-delta`, `session-remaining`, `gaps`, `car-bands` | `alarm-list` (reads only core topics) |
| 1 | `pace`, `tyre-wear`, `fuel`, `ers` | `gap-chart` |
| 2 | `damage`, `lap-times`, `battle` | `corner-block`, `tyre-life-bar`, `fuel-gauge`, `ers-budget` |
| 3 | `incidents`, `alarms` | `damage-card`, `timing-tower`, `lap-analysis`, `projected-lap`, `battle-cards` |
| 4 | `race-moment` | `incident-feed` |

A display also needs the kit pieces it uses (8.4) and the approved mockups. Levels are for reading only. There is no barrier between them: a unit starts the moment its own inputs are merged, not when its level is done.

**Critical path:** `lap-classes` → `pace` → `damage` → `incidents` → `race-moment` and `incident-feed`. Any delay there delays the end of the run, so it always goes first.

### 13.4 Two fronts
- **The test front runs ahead.** The contracts exist from W0, so a test agent needs nothing merged except the contracts and the builders. Upstream outputs are stubbed through the contract types. Every slot not needed for implementation writes tests for later levels.
- **The implementation front follows the levels**, strictly bottom-up (1.4, item 8).

A display's test phase also waits for the approved mockups, because its gallery cases and fit expectations come from them.

### 13.5 Scheduler rule
At most **eight agents** at a time, reviewers included (user, 2026-10-29; the supervisor's own work does not count). Eight is about the useful parallelism of this plan: roughly 100 agent slots of work over a critical path of about 14. Each agent runs only the tests its lane needs; the supervisor runs every larger suite. When a slot frees up, the supervisor gives it to the first item that applies:
1. a ready implementation on the critical path
2. any other ready implementation, the one with the longest chain of readers after it first
3. a pending review
4. the next test phase, lowest level first; analyses before displays at the same level

### 13.6 Milestones and the end
- **Milestone "car":** `alarms` and the six car care displays are merged. The supervisor adds the `car` workbook and the car care e2e test (11.2). Usable in preseason training from here.
- **Milestone "race":** everything else is merged. The supervisor adds the `quali` and `race` workbooks and the timing e2e test.
- **At the end, once:** `pnpm check`, `pnpm test:ui`, Stryker (11.2), acceptance on `ttZandvoort` and `raceSingapore` (11.3), a final review of the whole diff (split by area if it exceeds about 300 KB), and the re-review of its fix wave.
- **Open tasks:** the practice-recording and race-recording acceptance tasks (11.3) stay open until the user's recordings arrive. The plan merges without them.

### 13.7 Lessons from the UI shell run that apply
- Merge each unit as soon as its review is clean, and start its readers from the integration branch.
- Run `pnpm check` on the integration branch after every few merges: it catches breaks between units.
- Use named sets in tests, not "exactly N".
- Implementers also run `pnpm depcruise`.
- Tests that spawn processes kill them in `finally`.
- Never run a gate (acceptance, Stryker) while an agent is editing source.
- Workers list changes to supervisor-owned files in their report. The supervisor batches them between merges, so two workers never edit a shared file.

## 14. Open points
1. **The recordings** (1.4, item 2): a practice session for the car care acceptance (11.3), and a full race for the timing acceptance, which also closes F8 for sub-project 4 (a pit stop; an SC if one happens). Both are planned by the user; the timing is unknown.
2. **Tyre pressure default:** the time trial reports a fixed 30.16 psi, far above the default band 21.5–25 psi. Time-trial values prove nothing, but this default gets the closest look in the W0 source check.
3. **League rules** (research 06 §5): the number of warnings before a penalty and the quali format feed `warningsBeforePenalty` and `quali.eliminatedPerPart`. The defaults (Appendix B) are F1 25's standard settings until the league confirms.
4. **The two colour questions** are settled by the car care mockups (8.5).

## Appendix A: Contracts

These are the shapes the supervisor commits as code in W0 (13.2). Field names and units here are binding. Doc comments, helper types and the exact file split may be refined while committing, as long as the meaning stays.

### A.1 Domain additions

```ts
// packages/domain/src/known.ts
export type UnknownReason = 'restricted' | 'notReceived' | 'notApplicable' | 'realism' | 'insufficientData';

// packages/domain/src/records.ts: LapRecord gains, sampled at the lap end
wearAtEndPct: Corners<Known<Percent>>;
ersStoreAtEndJ: Known<Joules>;
ersDeployedJ: Known<Joules>;      // deployed during this lap
ersHarvestedJ: Known<Joules>;     // MGU-K + MGU-H, harvested during this lap
damageAtEnd: Known<DamageParts>;

// packages/domain/src/analyses/damage.ts (shared with LapRecord)
export type DamageParts = {
  frontLeftWingPct: Percent; frontRightWingPct: Percent; rearWingPct: Percent;
  floorPct: Percent; diffuserPct: Percent; sidepodPct: Percent;
  gearboxPct: Percent; enginePct: Percent;
};
```

### A.2 Shared calculator outputs and functions (`packages/analysis`)

```ts
// lap-classes
export type LapClass = { forPace: boolean; forRate: boolean; forBest: { lap: boolean; sectors: [boolean, boolean, boolean] } };
export function classifyLap(lap: LapRecord, session: { isRace: boolean }): LapClass;

// per-lap-rate
export type Rate = { perLap: number; samples: number };
export function perLapRate(samples: { lap: number; value: number }[], opts: { window: number; minSamples: number }): Known<Rate>;
export function lapsUntil(rate: Known<Rate>, now: number, target: number): Known<number>;

// pace-delta
export function paceDelta(beforeMs: Ms[], afterMs: Ms[]): Known<Ms>; // positive = slower after

// session-remaining (calculator output)
export type SessionRemaining = { basis: 'laps' | 'time'; lapsLeft: Known<number>; timeLeftMs: Known<Ms> };

// pace (calculator output)
export type Pace = { byCar: Record<CarId, { recentMs: Known<Ms>; stintMs: Known<Ms>; samples: number }> };
```

### A.3 Topics (value types in `packages/domain/src/analyses/`, topic files in `packages/contracts/src/topics/`)

| Topic | Params | Mode | maxHz | Value |
|---|---|---|---|---|
| `tyreWear.car` | `CarParams` | state | 4 | `TyreWear` |
| `fuel.car` | `CarParams` | state | 4 | `FuelState` |
| `ers.car` | `CarParams` | state | 4 | `ErsState` |
| `carBands.car` | `CarParams` | state | 4 | `CarBands` |
| `damage.car` | `CarParams` | state | 4 | `DamageState` |
| `gaps.intervals` | none | state | 4 | `Interval[]` |
| `gaps.toCar` | `CarParams` | state | 4 | `GapToCar[]` |
| `gaps.gapper` | `{ reference: GapperReference }` | state | 1 | `GapperLines` |
| `gaps.neighbourhood` | none | state | 2 | `Neighbourhood[]` |
| `lapTimes.board` | `{ referenceCarId: CarId }` | state | 4 | `LapBoard` |
| `lapTimes.projection` | `CarParams` | state | 10 | `Projection` |
| `battle.cards` | `CarParams` | state | 2 | `BattleCard` |
| `incidents.feed` | none | state | 4 | `IncidentEntry[]` |
| `raceMoment.current` | none | state | 4 | `Known<RaceMoment>` |

`alarms` publishes no topic of its own: its insights reach the existing `insights` topic. The shared calculators publish none.

```ts
export type TyreWear = {
  corners: Corners<{ wearPct: Known<Percent>; ratePctPerLap: Known<number>; lapsToLimit: Known<number> }>;
  limitPct: Percent;
  gameLifeSpanLaps: Known<number>;
};

export type FuelState = {
  kg: Known<Kg>;
  burnKgPerLap: Known<Kg>;
  lapsOfFuel: Known<number>;
  lapsLeft: Known<number>;
  marginLaps: Known<number>;          // negative = short of fuel
  saveTargetKgPerLap: Known<Kg>;      // notApplicable when marginLaps >= 0
  gameRemainingLaps: Known<number>;   // the game's MFD figure, meaning unverified
  mix: Known<'lean' | 'standard' | 'rich' | 'max'>;
};

export type ErsState = {
  storeJ: Known<Joules>;
  capacityJ: Joules;
  deployedThisLapJ: Known<Joules>;
  deployLimitJ: Joules;
  harvestedThisLapJ: Known<Joules>;
  storeTrendJPerLap: Known<number>;
  attackLevelJ: Joules;
  lapsToAttackLevel: Known<number>;
  mode: Known<'none' | 'medium' | 'hotlap' | 'overtake'>;
};

export type BandState = 'below' | 'in' | 'above';
export type BandReading = {
  value: Known<number>;
  state: Known<BandState>;
  band: { lo: number; hi: number };
  outSince?: SessionTime;
  outForFullLap: boolean;
};
export type CarBands = {
  tyres: Corners<{ surfaceC: BandReading; carcassC: BandReading; pressurePsi: BandReading }>;
  brakesC: Corners<BandReading>;
  engineC: BandReading;
};

export type DamageJump = { at: SessionTime; lap: number; parts: (keyof DamageParts)[]; deltaPct: Percent; lossMsPerLap: Known<Ms> };
export type DamageState = {
  parts: Known<DamageParts>;
  corners: Corners<{ tyrePct: Known<Percent>; brakePct: Known<Percent> }>;
  drsFault: Known<boolean>;
  ersFault: boolean;
  jumps: DamageJump[];
};

export type Interval = { carId: CarId; toLeaderMs: Known<Ms>; toAheadMs: Known<Ms>; toBehindMs: Known<Ms>; lapsDown: number };
export type GapToCar = { carId: CarId; gapMs: Known<Ms>; lapsDown: number }; // positive = behind the params car
export type GapperReference = { kind: 'leaderAverage' } | { kind: 'carAverage'; carId: CarId } | { kind: 'fixed'; lapMs: Ms };
export type GapperLines = { referenceLapMs: Known<Ms>; cars: { carId: CarId; byLap: { lap: number; gapMs: Ms }[] }[] };
export type Neighbourhood = { ourCarId: CarId; carIds: CarId[] };

export type SectorStatus = 'sessionBest' | 'personalBest' | 'none';
export type LapBoardRow = {
  carId: CarId;
  lastLapMs: Known<Ms>;
  lastSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>];
  lastSectorStatus: [SectorStatus, SectorStatus, SectorStatus];
  lastLapStatus: SectorStatus;
  bestLapMs: Known<Ms>;
  bestSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>];
  theoreticalBestMs: Known<Ms>;
  deltaToReference: { bestLapMs: Known<Ms>; bestSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>]; theoreticalBestMs: Known<Ms> };
};
export type LapBoard = {
  referenceCarId: CarId;
  rows: LapBoardRow[];
  sessionBest: { lap: Known<{ ms: Ms; carId: CarId }>; sectors: [Known<{ ms: Ms; carId: CarId }>, Known<{ ms: Ms; carId: CarId }>, Known<{ ms: Ms; carId: CarId }>] };
};
export type Projection = {
  carId: CarId;
  onLap: boolean;                      // false on in and out laps: everything below is notApplicable
  projectedLapMs: Known<Ms>;
  deltaToBestMs: Known<Ms>;
  projectedPosition: Known<number>;
  cutOff: Known<{ position: number; timeMs: Ms; marginMs: Ms }>;   // quali only; positive margin = inside
  finishMarginMs: Known<Ms>;           // timed sessions only; positive = another lap can start
};

export type BattleSide = {
  carId: CarId;
  gapMs: Known<Ms>;
  closingMsPerLap: Known<number>;      // positive = the gap shrinks
  lapsToDrs: Known<number>;
  paceDeltaMs: Known<Ms>;              // positive = we are faster
  overtakeMarginMs: Known<Ms>;         // paceDelta minus the overtaking threshold
  ours: { compound: VisualCompound; age: number };
  theirs: { compound: VisualCompound; age: number };
  theirErsStoreJ: Known<Joules>;
};
export type BattleCard = { carId: CarId; ahead: Known<BattleSide>; behind: Known<BattleSide> };

export type IncidentKind = 'collision' | 'retirement' | 'damage' | 'timeLoss' | 'warning' | 'penalty' | 'neutralised';
export type IncidentEntry = {
  id: string;
  at: SessionTime;
  lap: number;
  kind: IncidentKind;
  severity: 'major' | 'minor';
  carIds: CarId[];
  timeLostMs: Known<Ms>;
  forUs: { ourCarId: CarId; positionBefore: number; positionAfter: Known<number>; gapBeforeMs: Known<Ms>; gapAfterMs: Known<Ms> }[];
};

export type Moment = 'neutralised' | 'incident' | 'weather' | 'battle' | 'carCare';
export type RaceMoment = { moment: Moment; since: SessionTime; cause: { rule: string; params: Record<string, number | string> }; active: Moment[] };
```

### A.4 Kit components (props)

```ts
// CornerGrid: lays out four corner cells as FL FR / RL RR; the cell content is a snippet
type CornerGridProps<T> = { corners: Corners<T>; cell: Snippet<[T, keyof Corners<T>]> };

// Bar: a value in text cells, with optional limit, marker and reserve line; role from emphasis
type BarProps = { value: Known<number>; min: number; max: number; cols: number; limit?: number; marker?: Known<number>; reserve?: number; role: ThemeRole };

// CompoundMark: letter or letter plus colour, chosen by the theme variant
type CompoundMarkProps = { compound: VisualCompound; age?: number };

// CarLabel: the three-letter code (or number), our cars marked
type CarLabelProps = { carId: CarId; ours: boolean };

// PositionMark: change since the start or a before/after pair
type PositionMarkProps = { change: number } | { from: number; to: Known<number> };

// InsightLine: one insight as the top bar renders it, with acknowledge and mute
type InsightLineProps = { insight: Insight; acknowledged: boolean };

// Chart phase bands: extra prop of kit/chart
type PhaseBand = { from: number; to: number; kind: 'sc' | 'vsc' | 'red' };
```

`kit/values/format.ts` gains `formatCelsius`, `formatPsi`, `formatPercent`, `formatKg`, `formatLaps`, `formatJoules` and `formatDeltaMs` (signed). `emphasis/` gains `sectorStatusRole(status, focus)` and `ourCarRole(ours)`.

## Appendix B: Config defaults, values to calibrate in sub-project 5

Every key is declared with `defineConfig` (ADR 0008) by the unit named in the first column, with a source note in the declaration. In W0 the supervisor checks each default against a community source for F1 25 (or F1 24 where F1 25 has none), adjusts it if that source differs, and records the source. Values without one keep "pitwall estimate" as the source. Sub-project 5 calibrates all of them in training.

| Unit | Key | Default | Initial source |
|---|---|---|---|
| `per-lap-rate` | `window`, `minSamples` | 5, 3 | pitwall estimate |
| `pace` | `window` | 3 laps | pitwall estimate |
| `tyre-wear` | `limitPct` | 70 % | community (performance drops sharply beyond it) |
| `car-bands` | `tyreSurfaceC` | dry 85–105, inter 60–90, wet 50–80 | community |
| `car-bands` | `tyreCarcassC` | dry 85–110, inter 60–95, wet 50–85 | community |
| `car-bands` | `tyrePressurePsi` | 21.5–25.0 | community |
| `car-bands` | `brakeC` | 300–1000 | community |
| `car-bands` | `engineC` | up to 125 | community |
| `car-bands` | `hysteresis` | 2 °C, 0.2 psi | pitwall estimate |
| `ers` | `deployLimitJ`, `capacityJ` | 4 000 000, 4 000 000 | real F1 regulation (2014–2025), used by F1 25 |
| `ers` | `attackLevelJ` | 2 400 000 | Avella et al. 40 % margin (research 07), pitwall estimate |
| `damage` | `jumpPct`, `jumpWindowMs` | 5 %, 2000 | pitwall estimate |
| `alarms` | `wearLapsWarning` | 3 laps | pitwall estimate |
| `alarms` | `warningsBeforePenalty` | 3 | F1 25 default setting; league rule open |
| `gaps` | `neighbourhoodMs` | 3000 | research 06 §4 |
| `lap-times` | `quali.eliminatedPerPart` | 5 (Q1), 5 (Q2) | F1 format with 20 cars |
| `battle` | `drsRangeMs` | 1000 | F1 regulation |
| `battle` | `overtakeThresholdMs` | 1000 | real F1 (1–2 s, research 06 §5 item 6) |
| `incidents` | `timeLossMs` | 2000 | pitwall estimate |
| `incidents` | `majorKinds` | collision, retirement, damage, timeLoss | this spec (7.3) |
| `incidents` | `feedLength` | 50 | pitwall estimate |
| `race-moment` | `incidentHoldMs` | 30 000 | research 06 §4 |
| `race-moment` | `battleLaps` | 2 | research 06 §4 |
| `race-moment` | `weatherRainPct`, `weatherHorizonMin` | 40 %, 10 | pitwall estimate |
