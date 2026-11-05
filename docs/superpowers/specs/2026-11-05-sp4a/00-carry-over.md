# SP4a re-spec: carry-over checklist

Status: working list for the SP4a re-spec brainstorm, 2026-11-05. It replaces the void SP4a spec of 2026-10-30, which is deleted: everything worth keeping from it is written out here, so nobody needs to read it. (For the record only: it is in git up to 1991eff as `docs/history/specs/2026-10-30-strategy-live-calls-design.md`.)

The new spec is written from the contract (`docs/architecture.md`) and the current code, not from the old text. This list says, for every item of the old spec and every SP4a input since, whether it carries over.

**Status words**

| Status | Meaning |
|---|---|
| **keep** | A user decision or product intent that the contract does not touch. The new spec takes it as it is. |
| **re-derive** | The intent stands; the mechanism (reads, inputs, types, cadence) is written fresh against the named clauses. |
| **open** | Needs a user decision or a contract check before it can be specced; may turn out to be a contract gap (C0). |
| **void** | Replaced or blocked by the named clause; not carried over. |
| **done** | Exists on main already. |
| **new** | An SP4a input from after 2026-10-30 (live test, mockup review). Scope still to decide. |

Every row ends up as *kept*, *changed (Cn)* or *void (Cn)* in the new spec.

## 1. User decisions (old §1.4, §1.5)

| # | Decision | Status | Note |
|---|---|---|---|
| D1 | SP4 is split. **4a live race calls**: estimation and forecast. **4b planning**: DP optimiser, strategy comparison V16, strategy overview V06, plan board V17, circle of doom V01, weather inside the strategy model (a compound switch at lap N) | keep | |
| D2 | Weather in 4a: a forecast strip and the crossover chart (V19) | keep | |
| D3 | The track map is in 4a: per-track geometry and corners, live map with cars, incident markers, the rejoin ghost, turn numbers in the incident feed. Per-turn deltas (V26) stay in SP5 and reuse the corner list | keep; mechanism **open** | see 4.3 (geometry from positions) and 4.4 (turn files) |
| D4 | Official turn numbers only (FastF1 circuit data); a track without a turn file shows sectors, never detected numbers | keep | source **open** (4.4) |
| D5 | Knowledge lifetimes: **track** (geometry, pit loss) across weekends, **weekend** (degradation, fuel sensitivity) so practice feeds the race. Every value shows its source and falls back to community defaults. The lifetime is a property of each piece of knowledge and the aggregation is replaceable (later: everything across weekends, weighted, as real teams do) | intent keep; mechanism **re-derive** | the priors store C62a (scopes weekend, track, season; computed from stored projections); also `view.weekend` (C62) gives the earlier sessions' projections directly |
| D6 | Rejoin ghost views: live crossing order (V03), ghost lines on the gap chart (V04), the ghost on the track map. V05 and V02 dropped; V01 (4b) replaces V02 | keep | gap chart also changes by N3 |
| D7 | Order the run by dependency level, not by content | keep | C81 says the same |
| D8 | Strategy core: one shared lap model and one field forecast, TUM's race simulation as the reference; every call is a query against them, so the cards cannot disagree; 4b's optimiser reuses them | keep | C50 (simulators), C43 (one judgement, one unit) |
| D9 | Compute budgets now, Rust only on a measured miss. Every strategy unit has a budget enforced by a benchmark test. Strategy runs **per lap or event, never per frame**. The forecast kernel takes plain arrays so it could become Rust/WASM at 4b's DP spike | budgets keep; cadence **open** | conflicts with N1 ("update as often as it stays correct"); the user decides which wins for strategy units |
| D10 | "The existing architecture stays; everything additive" | void | C0: the contract is the architecture now |
| D11 | Mockups for every display, approved in one session before any display's test phase | done | approved 2026-10-30, `docs/design/2026-10-30-sp4a-displays/`; new displays from N-rows need mockups |
| D12 | A forecast scoreboard is in 4a: `forecast-score` and the `pitwall score <recording>` report (§4.7) | intent keep; mechanism **open** | see 4.7 |
| D13 | The two-dry-compound rule is not used by 4a (rivals never stop in 4a; the engineer picks our compound); it enters with rival-stop prediction in SP5. The league races under the 2025 F1 sporting regulations | keep | the `compound-rule` sub-machine exists now (C17); 4a reads it only if a unit needs it |
| D14 | Rivals' predicted stops stay in SP5; nothing is pulled forward to beat Team Center | keep | |
| D15 | 4b's objective: expected finishing position per car, then expected league points, then minimum race time, each breaking the ties of the one before; with Aguad & Thraves' win probability (research 07 §2.5). Open for 4b: the tie margin or weights, position vs win probability, how two cars combine. Later: the best plan under each objective side by side; 4b's search must be able to score a plan under all three | keep | input for 4b only |

## 2. Scope (old §2)

| Item | Status | Note |
|---|---|---|
| In: shared functions and two simulators (`lap-model`, `race-forecast`) | keep | 4.1 |
| In: three calculators `track-geometry`, `degradation`, `pit-loss` | keep | 4.2, 4.3 |
| In: thirteen analyses, changes to `incidents` and `race-moment` | keep | 4.5; `radio-window` was dropped, so twelve; N9 adds a radio indicator back |
| In: twelve displays plus gap-chart ghost lines and incident-feed turns | keep | 4.8 |
| In: two default workbooks `strategy`, `longrun` | keep | 4.9 |
| In: turn files for the league calendar, produced outside the run | keep; **open** | 4.4 |
| In: the forecast scoreboard | **open** | 4.7 |
| Out (4b): optimiser, V16, V06, V17, V01, weather in the strategy model | keep | |
| Out (SP5): Monte Carlo and SC probabilities, rivals' predicted stops and the compound rule, a live view of forecast scores, calibration of defaults (dirty air, overtaking threshold, tyre bands), per-turn deltas V26, quali tools V11, V12 | keep | |
| Out: the second driver's feed; every unit works per car, "our cars" from `session.info` | **re-derive** | C1a: nothing assumes one feed; `session.info` has `playerCar`, `teammateCar` |
| Roadmap: the foundation table splits SP4 into 4a and 4b, the track map moves into 4a, V26 to SP5 | keep | update the roadmap where it lives now |

## 3. Repository changes (old §3)

| Item | Status | Note |
|---|---|---|
| Priors and contributions, `definePriors`, `Feature.priors`, `Feature.contributions`, knowledge table, `--fresh-priors` | void | C62a: priors are season-wide aggregates computed from stored projections; units declare entries with key, scope and a pure `aggregate`; only the bridge writes, between runs; `view.priors` fixed per run, sidecar. `view.priors` is `{}` on main until the store exists |
| Contributions written per session at every lap, "replaced only by one covering more laps", replay and dev never write | void | C62a computes from stored projections; whether replay may write is answered by C62a ("only the bridge writes, between runs: session end, rebuild") |
| The simulator kind | done in the contract (C50); code **re-derive** | `gen:catalogue` does not list a simulator kind yet |
| Storage keyed by `(session_uid, weekend_id)`, `SCHEMA_VERSION` 2 → 3 for the knowledge table | partly done, rest void | C60: keyed by session uid, weekend id and the feed's player car; the priors store is a second database (C62a), not a table |
| Benchmark harness `test-support/bench.ts` (`withinBudget`, median after warm-up) | **re-derive** | not built; C31's proof counts projection entries, no timer; time budgets for simulators are not forbidden, but see memory rule "fix slowness, not timeouts" |
| Domain additions (knowledge types, turn file type, value types, topic files), `IncidentWhere.turn`, `Moment` gains `window` | **re-derive** | C78/C81: supervisor commits contracts first; current `Moment` has no `window`, `IncidentWhere` only `sector` |
| ADR 0015 (priors), ADR 0014 line, architecture.md (priors, simulators) | void | ADR 0015 is now the contract's; the contract already has C50 and C62a; a priors ADR, if any, is 0016 |

## 4. Units

### 4.1 Functions and simulators (old §5)

| Unit | Content to keep | Status | Contract checks |
|---|---|---|---|
| `lap-classes`, `per-lap-rate` | exist, unchanged | done | |
| `track-lookup` | on a track geometry: corner or straight at a lap distance, next straight, map point of a lap distance, turn label at a lap distance | **re-derive** | shared pure helper (`analysis/src/shared/`) |
| `tyre-life` | the lap at which a stint reaches its limit: wear at `wearLimitPct` (wear visible) or the age at which predicted loss reaches `ageLossLimitMs` (wear hidden) | **re-derive** | C43: a judgement several analyses need (pit-window, pit-sweep, undercut's `stopDue`) is one calculator, not a function each calls |
| `forecast-field` | builds the forecast field and params from the view and the outputs of `degradation` and `pit-loss`; the one place that turns calculator outputs into car models | keep | C50 names it as the one shared builder |
| `lap-model` (simulator) | `T_lap = baseMs + compoundOffsetMs + ΔT(wear)` (wear visible: wear grows by the fitted rate) or `ΔT(age) = degMsPerLap · age` (wear hidden: restricted or realism) `+ γ · fuelKg` (γ default 0.03 s/kg, Bonomi) `+ dirtyAir(gap)` (Fieni: `a · gap + b` for gap in 0.2–1.35 s, else 0) `+` in/out-lap and cold-tyre penalty on stop laps. Fills an output array without allocating; one-lap variant | keep model; shape **re-derive** | C50: pure, plain inputs, no reads/cadence/topic, only analyses and job modules call it; C2 |
| `race-forecast` (simulator) | steps the field lap by lap: lap time from `lap-model` with dirty air from the gap at lap start; a stop adds that condition's pit loss, resets the tyre (new compound, age 0, out-lap penalty); a faster car passes only if its pace advantage exceeds `overtakeThresholdMs`, else stays `minFollowGapMs` behind; positions and gaps update. Output race time and position per car per lap (typed arrays, cars × laps). Rivals do not stop in 4a; a rival past its tyre life within the forecast is marked `stopDue` | keep model; shape **re-derive** | C50; C51 if it runs as a job |

### 4.2 Calculators `degradation`, `pit-loss` (old §6.1, §6.2)

| Unit | Content to keep | Status | Contract checks |
|---|---|---|---|
| `degradation` | Kalman filter per car and stint (Cappello & Hoegh): state tyre pace `α` and degradation per lap `ν`, observation the fuel-corrected lap time; a stop starts a new filter from the compound's prior; only `forPace` laps; slow outliers beyond `outlierSd` down-weighted, faster laps never. Wear part: wear per lap per corner from `wearAtEndPct` with `per-lap-rate`, lap-time cost per wear %. Fuel sensitivity `γ` a weekend prior, refined from stints of known fuel. Output per car and stint: base pace, `ν` with sd, basis (`wear`/`age`), wear rates; per compound the weekend aggregate. Realism hides rivals' wear → basis `age` | keep model; **re-derive** | reads projection lists (C28, C41); quick or incremental needs the C31 proof; the weekend aggregate comes from priors (C62a) or `view.weekend` (C62); C8: rivals' wear is `unknown('realism')` |
| `pit-loss` | per stop of every car: loss = (in-lap + out-lap) − 2 × the car's racing lap around the stop (median of its `forPace` laps within `referenceLaps` before), TUM's definition. Condition green, VSC, SC. Stationary time kept apart; loss stored minus the stationary time above the median. Output per condition: median loss, samples, source (`measured`, `stored`, `default`), median stationary time | keep model; **re-derive** | old reads `flagPhases`: void (C20); condition from `PitStopRecord.flag` (exists) or membership (C26); track scope priors (C62a) |

### 4.3 Calculator `track-geometry` (old §6.3)

Content: centreline from every car's world position binned by lap distance (`binM`), median per bin over clean laps of any car (one lap of a full field fills it); corners from the curvature of the centreline (works in realism mode), with entry, apex, exit and direction; straights longer than `straightMinM`; pit exit as the median lap distance at pit-lane exit; turn labels only from the turn file. `Known` until the first full lap; quality = laps used. Refined across sessions (track scope).

Status: **open**. It reads per-frame positions. C31(2) forbids frame data in an accumulator, a quick unit sees only the current frame, and C62a priors are computed from stored projections, which hold no positions. Options to put to the user: a recorder that records position samples as facts (C10; grows the log and storage; rules version C61), committed reference geometry per track, or a contract change.

### 4.4 Turn files (old §6.4)

Content: `data/tracks/<trackId>.json`, committed, supervisor-owned: each official turn with number, letter, label (`T6a`), apex lap distance, a source note, and groups (a chicane). Source: FastF1 `get_circuit_info()` corners scaled by the game's track length over the real one; the import script lives in its own repo (`~/dev/personal/pitwall-trackdata`, memory rule "keep aux tools separate"). A test checks each file against geometry where a recording exists (each turn within `turnSnapM` of a detected apex, in lap order). Reverse layouts get no file.

Status: **open**. C39 lists everything a unit may see, and committed reference data is not in it (not config, not priors computed from projections). Also open from before: FastF1's coverage of the F1 25 tracks and whether its data may be committed (R1).

### 4.5 Analyses (old §7)

General rule of the old spec: car topics only for our cars (`playerCar`, `teammateCar`), another car `notApplicable`; except `raisingAverage.car` and `lapOverview.car`, which answer every car (mockups Q13). Track and field topics cover every car. Cadence: `lapCompleted`, `pitStop`, `flagChange`, plus 1 Hz, never per frame. **Status:** our-cars rule keep; cadence **open** (D9 vs N1); triggers **re-derive** from change tags (C40, C41).

| Analysis → topic (V) | Content to keep | Status | Contract checks |
|---|---|---|---|
| `pit-losses` → `pitLosses.track` (V33) | loss per condition with samples and source; this session's stops (car, lap, condition, loss, stationary) | keep | C56 names |
| `stint-analysis` → `stintAnalysis.car` (V07) | per stint each lap's tyre age, lap time, fuel-corrected time, used by the fit or why not, down-weighted, the fit line with its band; per compound the weekend aggregate; compound letters (`visual`) | keep | reads `degradation` |
| `raising-average` → `raisingAverage.car` (V08) | mean of the best X valid laps for X = 1…n; every car | keep | |
| `lap-overview` → `lapOverview.car` (V09) | per lap: time, stint, compound, in/out, personal or session best, heat within its stint (0 best, 1 worst `forPace` lap), track status green/VSC/SC; every car | keep; status **re-derive** | track status per lap from membership (C26), not a judged flag |
| `rejoin` → `rejoin.car` | if our car boxes at the end of this lap, per condition (green, VSC, SC): rejoin position, the cars directly ahead and behind with gaps, the crossing order with the ghost (V03; position and interval per row), the ghost's lap distance and map point, ghost lines for the gap chart (our gapper value plus the loss, last `ghostLaps` = 6 laps), loss source | keep | reads `gaps`, `pit-loss`, `degradation`, `track-geometry`; calls `race-forecast` |
| `undercut` → `undercut.car` (V13) | per neighbour within `undercutRangeMs`: gap now; `Δ(N)` for N = 1–3 (our gain if we stop now and the rival N laps later, two forecasts); margin `Δ(N) − abs(gap)`; `stopDue`; the car behind's row is the mirror (cover: the rival's gain if it stops now and we stop N later) | keep; signs **open** | N2 (one sign rule, positive = good for us) may change the mirror row |
| `sc-call` → `scCall.car` (V18) | standing answer: if an SC or VSC came now: loss under it, gain against a green stop, rejoin position, rivals within the window who would also gain, loss source; `active` (none, SC, VSC) | keep; `active` **re-derive** | whether an SC/VSC is out is a situation (C20, race-control sub-machine); the display's layout switch is a presentation table (C66) |
| `pit-sweep` → `pitSweep.car` (V15) | params our car and next compound; per lap L to the end of the window: rejoin position, cars within `trafficGapMs` in the first `trafficLaps` laps, finish time and position with no further stop, finish delta to the fastest row, whether the stint exceeds the compound's life | keep | |
| `pit-window` → `pitWindow.car` + `window` moment | latest lap = current tyres reach their life; earliest per next compound = last lap minus that compound's life; next compounds = dry compounds among our available sets (`CarTyres.sets`), `notReceived` until they arrive; window earliest–latest; `insufficientData` until `minLaps`. `race-moment` gains `window` between `neutralised` and `incident`, active from `earliest − windowLeadLaps` until we stop or it closes | keep | C46 lists `window` as a judgement moment |
| `track-positions` → `trackPositions.geometry`, `trackPositions.cars` | geometry (outline, corners with official labels, straights, pit exit, sector starts), rarely; cars (10 Hz): lap distance, map point, in-pit; incident markers (major entries of the last `markerLaps` laps) with point and kind; marshal zones with flags; per car its flag (blue). Realism keeps positions | keep; inputs **re-derive** | old read `marshalZones` and `fiaFlag` directly: void (C12, C13: signals); zones from `zone-flags`, blue from `car-flags`, in-pit from `car-location` (C20) |
| `radio-window` | dropped 2026-10-30 | void | superseded by N9 |
| `weather` → `weather.forecast` | forecast samples of the current session type in time order, accuracy flag, first sample at or above `rainPct` (`notApplicable` if none); race moment's weather rule unchanged | keep | samples are values (`SessionState.forecast`) |
| `crossover` → `crossover.field` (V19) | per lap the field's median lap time per tyre type (slick, inter, wet); dry reference (the session's best green slick median); our latest lap as % of it; the 110 % line; first car on the other type faster in a sector; payback laps = pit loss / (our lap − other type's lap), `notApplicable` when not faster | keep; "green" **re-derive** | green laps from membership (C26) |
| `incidents` (change) | `IncidentWhere` gains `turn` from `track-lookup`, `notApplicable` without a turn file | keep | depends on 4.4 |
| `race-moment` (change) | the `window` moment | keep | C46 |

### 4.6 Error handling (old §11)

| Item | Status | Note |
|---|---|---|
| Missing data is `Known` (`insufficientData`, `notApplicable`, `realism`), never 0 | keep | C3 |
| A prior with no data is the default with source `default`; displays show it | keep | |
| `config.json` and turn files strict; priors sidecars lenient | **re-derive** | C47, C62a |
| A forecast with a car missing its model drops that car; dependent results `insufficientData` | keep | |

### 4.7 Forecast scoreboard (old §7.15)

Intent (keep): score 4a's forecasts against what happened in a recorded race, so a model change shows whether it helped; a report for the user, not a topic and not a test. Content: lap forecasts at horizons 1, 3, 5, 10 laps (time error, position error); pairs excluded when the car stopped, a VSC/SC was out within the horizon, or the car never reached the lap (counted by reason); errors split by basis (wear, age); rejoin predictions against our real position at pit exit; undercut `Δ(N)` against the real gain (gap before our in-lap minus gap after the rival's out-lap), cover rows the same. Output table per horizon and basis (count, bias, MAE, p90, share of positions right), excluded counts, one row per scored stop and undercut; `--json`; `--priors <file>` to compare model versions on equal input; stores nothing; no test asserts a recording's scores.

Mechanism: **open**. The old one (a `forecast-score` calculator with no topic and no reader, run by the demand rule; a FeedPipeline output tap collecting outputs with session times; `scoreForecasts(log, history)`) is written against the old architecture. To check: C49 (a unit runs only on demand), C45 (a record is built from the projection, never from outputs), C43 (the bridge makes no judgement), C35 (race clock, not session time), C28 (history = the projection).

### 4.8 Displays (old §8)

Rules (keep): render and format only, sizes in character cells, compact and full mode, grey by default, colour only to highlight or distinguish, numbers only, no verdicts; every value resting on a prior or default shows its source on hover. A display never shares its name with an analysis. **re-derive** against C65, C66 (presentation tables for displays reading sub-machines or `raceMoment`), C68, C69.

| Display (V) | Decisions | Reads | Shows | Status |
|---|---|---|---|---|
| `pit-loss-table` (V33) | D21–D25 | `pitLosses.track` | loss per condition, samples, source; this session's stops | keep |
| `stint-scatter` (V07) | D03, D11, D22 | `stintAnalysis.car` | lap time over tyre age per stint, excluded laps grey, fit and band | keep |
| `raising-average-chart` (V08) | D01, D03 | `raisingAverage.car` | the curve for our cars and chosen rivals | keep |
| `lap-overview-grid` (V09) | D03, D32 | `lapOverview.car` | one block per lap, heat within stint, in/out, bests, status strip | keep |
| `crossing-order` (V03) | D21, D24 | `rejoin.car` | crossing order with the ghost per condition, gap ahead and behind | keep |
| `gap-chart` (exists) | D21, D23 | `gaps.gapper`, `rejoin.car` | adds ghost lines per condition | keep; plus N3 |
| `track-map` | D21, D33 | `trackPositions.*`, `rejoin.car` | outline with official turns, all cars, ours white, incident markers, ghost | keep |
| `undercut-card` (V13) | D23 | `undercut.car` | per neighbour: gap, Δ(1–3), margin, stop due | keep |
| `sc-card` (V18) | D24, D25, D29 | `scCall.car` | one line in green running; the sheet under SC/VSC | keep |
| `pit-sweep-table` (V15) | D21, D22 | `pitSweep.car`, `pitWindow.car` (compound selector) | one row per lap: rejoin, traffic, finish, life exceeded | keep |
| `forecast-strip` | D26 | `weather.forecast` | samples with type, rain %, temperatures, trend | keep |
| `crossover-chart` (V19) | D26 | `crossover.field` | lap times by tyre type, the 110 % line, payback laps | keep |
| `incident-feed` (exists) | D33 | `incidents.feed` | adds the official turn | keep; plus N4 |

Kit pieces shared by displays (supervisor first): track outline canvas, ghost marker style (B1), source badge (`ˢ` stored, `ᵈ` default, hover text). **keep.**

Mockups: approved 2026-10-30, `docs/design/2026-10-30-sp4a-displays/` (sizes, column priorities, colour decisions, ghost B1, map flags, source badge). **keep** as design input. Its table "Contract and theme changes for Task 1" (17 rows) was written against the old Appendix A: **re-derive** each row against the new topic types. Theme role `opportunity` (`#3fd8e8`) does not exist yet.

### 4.9 Workbooks (old §9)

Two new defaults, seeded when missing: **`strategy`** main = tower, crossing order, map, gap chart, undercut card, SC card, pit sweep; side = forecast strip plus the `race` car-care set (tyre life, corners, fuel, ERS, alarms, damage). **`longrun`** main = stint scatter, raising average, lap overview, tower; side = pit-loss table, crossover chart. From the approved layouts, 24" main and 14" side. **keep**; automatic switching (if any) **re-derive** against C67.

### 4.10 Config defaults (old Appendix B; to calibrate in SP5)

**keep** as starting values; each moves into its unit's `config.ts` (C47). R3 (community defaults with sources) is still to do.

| Unit | Key | Default | Source |
|---|---|---|---|
| `lap-model` | `gammaMsPerKg` | 30 | Bonomi et al. 2023 |
| `lap-model` | `dirtyAirA`, `dirtyAirB`, range | Fieni 2026 (≈0.4 s close behind), 0.2–1.35 s | Fieni 2026, Bahrain |
| `race-forecast` | `overtakeThresholdMs` | R3 (TUM's real-F1 value to start) | TUM |
| `race-forecast` | `minFollowGapMs` | 300 | pitwall estimate |
| `race-forecast` | `outLapPenaltyMs` | measured out-laps, else R3 | TUM |
| `tyre-life` | `wearLimitPct`, `ageLossLimitMs` | 70, 2000 | pitwall estimate |
| `degradation` | `outlierSd`, process noise | 2.5, R3 | Cappello & Hoegh |
| `pit-loss` | `referenceLaps`; defaults per track and condition | 3; R3 | TUM; community |
| `track-geometry` | `binM`, `cornerCurvature`, `straightMinM`, `turnSnapM` | 5, R3, 200, 40 | pitwall estimate |
| `undercut` | `undercutRangeMs` | 5000 | pitwall estimate |
| `pit-sweep` | `trafficGapMs`, `trafficLaps` | 1350, 3 | Fieni 2026 |
| `pit-window` | `windowLeadLaps`, `minLaps` | 2, 3 | research 06 §4 |
| `track-positions` | `markerLaps` | 2 | pitwall estimate |
| `rejoin` | `ghostLaps` | 6 | mockups Q6 |
| `forecast-score` | `scoreHorizons` | [1, 3, 5, 10] | Team Center note Q1 |

## 5. Testing, budgets, build order (old §10, §12)

| Item | Status | Note |
|---|---|---|
| Test data: builders for edge cases (stops, flag phases, positions on a synthetic oval, priors); segments ≤ 1 MB per behaviour: a green stop, a stop onto the same compound (`raceWetVscMexico`), a VSC or SC stop (`raceZandvoortUidReuse`, `raceSingaporeWet`), a clean full-field lap (`race-zandvoort-full-lap`); `crossover` by builders and a user check on the wet races | **re-derive** | C84; the 2026-11-05 race (SC on lap 12) is a new candidate; "flag phases" are now spans |
| Per-layer tests (simulator properties: no stops and equal pace keep gaps; below the threshold never passes; a stop never gains position at the rejoin; adding a stop never shortens race time; no stops = straight extrapolation; calculator edge cases; analyses give `unknown(reason)` on missing input; priors tests; turn files valid and snapping) | keep the properties; **re-derive** the rest | `docs/testing.md`, C85–C87, C41 guarded views, C44 behaviour tables, C31 if incremental |
| Budgets on 20 cars × 70 laps: one forecast scenario < 1 ms; `pit-sweep` all scenarios < 20 ms; each per-lap analysis < 5 ms; `track-positions` placement per frame < 50 µs; `degradation` update per lap < 1 ms | keep the targets; **re-derive** cadence | D9 vs N1; the long-race builder exists (`test-support/builders/long-race.ts`) |
| Acceptance on segments: a real green stop's loss = the TUM value by hand and exceeds the pit-lane time; geometry from a clean lap snaps every turn of the Zandvoort file; VSC and SC stops classed by condition | keep | C84 |
| Build order: level 0 supervisor (contracts, priors, simulator kind, harness, kit pieces, mockups); level 1 `track-lookup`, `tyre-life`, `lap-model`, `track-geometry`, `pit-loss`, `degradation`, `weather`, `raising-average`, `lap-overview`; level 2 `race-forecast`, `forecast-field`, `pit-losses`, `stint-analysis`, `track-positions`, `crossover`, `pit-window` + `race-moment`, `incidents`; level 3 `rejoin`, `undercut`, `sc-call`, `pit-sweep`; level 4 `forecast-score`; displays right behind their analysis | void | written again by writing-plans from the new spec (C81, C82); the old plan is void |
| Research before the run: R1 FastF1 turn data (fields, F1 25 coverage, licence, import script, files for the league calendar); R2 segments; R3 community defaults with sources | keep | not done |

## 6. Old open points (old §14)

| # | Point | Status |
|---|---|---|
| 1 | Does the game reuse `weekendLinkIdentifier` across weekends? (Checked 2026-10-30: offline GP weekends send a real id, only time trial sends 0.) | keep open; check on the next league weekend |
| 2 | League rules: 2025 F1 sporting regulations, the compound rule applies, used from SP5; next compounds from our tyre sets | keep |
| 3 | FastF1 licence | keep open (R1) |
| 4 | Overtaking threshold and dirty-air coefficients are defaults until SP5 calibrates them | keep |

## 7. New inputs since 2026-10-30

From `docs/acceptance/live-checklist.md` (live test 2026-11-04/05, user answers for the re-spec), the mockup README and the live-test fixes plan ("Not in this plan (SP4a re-spec)"). Most change SP3 units; whether each goes into SP4a or its own small task is a scope decision.

| # | Input (user) | Status |
|---|---|---|
| N1 | **Everything updates as often as it can while staying correct.** The default for every unit and topic is the finest granularity whose value is still right; per-lap needs a reason; each unit's spec states its granularity and why; each topic's `maxHz` is set from what its display can use. A spec rule, not a contract clause, for now | new; conflicts with D9 for strategy units |
| N2 | **Battle card:** numbers only, no verdict; one sign rule for every battle number, **positive = good for our car**; PACE Δ (and MARGIN) updated every mini-sector (the two cars' times over the same rolling 50 mini-sectors, pit, SC and VSC segments left out); MARGIN gets a unit (`s/lap`) or a clearer label; CLOSING and PACE Δ can disagree with no hint which to trust | new |
| N3 | **Gap chart:** grey the field, zoom to our window, a pit-loss line, lines moving per mini-sector, and drivers outside our window not drawn | new; touches D6's ghost lines |
| N4 | **Incident feed** names each of our cars by driver code (`RUS P6→P7`), not `us`; a collision warning shows by its kind, not a plain `warning` without `n/3` (needs the warning's infringement on the incident entry) | new |
| N5 | **Sectors as they finish:** S1 at the end of sector 1, S2 at sector 2, S3 and the lap at the line, with personal and session best colours per sector | new |
| N6 | **Fuel gauge:** the fuel amount in kg always shows; "lasts", burn and margin wait for 2 rate laps | new |
| N7 | **Damage:** show that the loss is being measured ("measuring, 0/2 laps") and a first estimate from the mini-sectors since the jump, marked as an estimate; smarter loss later (research 06, D10) | new |
| N8 | **Projected lap:** the finish margin as `m:ss.s` once a minute or more | new |
| N9 | **Radio indicator in the top bar:** colour shows whether now is a good moment to talk: on a straight, not in or just before a braking zone ("no talking under braking"); braking zones from the car's own brake and speed by lap distance on earlier laps, per driver and track. "On a straight" is a judgement: an analysis decides it (C43), the top bar renders its topic (C65) | new; depends on 4.3 and on per-frame brake data (same C31(2) question) |
| N10 | **No way to bring back a closed panel:** an "add panel" command | new; shell (C72) |
| N11 | Sector and corner times over the laps (practice): confirms the planned per-turn analysis (V26, SP5) | new; keep in SP5 unless the user pulls it in |
| N12 | Recording size ~150 MB/h practice, ~290 MB/h race: watch it | new; note only |
| N13 | AI teammate reads a flat 90 °C carcass: band alarms for an AI car may be meaningless | new; note for the car-care units |

## 8. Reference material that stays

- `docs/history/notes/2026-10-30-strategy-quality-vs-team-center.md`: Team Center's weaknesses and the user's Q1–Q5 answers (D12–D15 above).
- `docs/research/03`, `06`, `07`: strategy models, engineer decisions D01–D33 and displays V01–V35, strategy literature (TUM, Fieni, Cappello & Hoegh, Bonomi, Aguad & Thraves).
- `docs/design/2026-10-30-sp4a-displays/`: the approved mockups.
