# Consolidation map: one owner per judgement

**Status: survey result and proposal by the supervisor, 2026-11-14; not brainstormed, not approved.** Asked by the user: "the cleaner the code the better (as long as it still stays correct); consolidating models makes future iterative improvements a lot easier." It merges six read-only surveys of the whole codebase (reports with every file:line in `~/dev/personal/pitwall-research/consolidation-survey/01–06`) and the strategy-fixes draft (`2026-11-14-strategy-fixes-DRAFT.md`, which becomes slices O1–O3 and O8–O9 below). The supervisor re-read the strongest claim of each survey in the code; "verified" below means read in the code, "inferred" means the methods differ but no case shows a different answer.

The rule: every judgement has one owner (C43); every other place reads the owner; each consolidation lists what it deletes. No workaround is on this list.

## 1. Breaks of the contract or the spec in today's code (fixed in any case)

| # | What | Where | Clause | Status |
|---|---|---|---|---|
| B1 | The display computes a tyre-life marker (rate × game life span) | `apps/ui/src/widgets/tyre-life-bar/rows.ts:49` | C65 | verified |
| B2 | The bridge judges span membership from frame ranges (human laps of a driver) | `apps/bridge/src/drivers/links.ts:32–36` | C26, C28 | verified |
| B3 | Two dry references: `crossover`'s lowest slick median and `track-wetness`'s | `crossover/calculator.ts:107`, `track-wetness/dry-reference.ts` | C43 | verified |
| B4 | `pit-window` says a stop is needed after two dry compounds (the sub-machine has only `required` / `waived`); `race-moment`'s window moment follows it | `pit-window/calculator.ts:123, 131` vs `shared/compound-rule.ts:24` | C43, spec | verified |
| B5 | Strategy candidates drop a whole stop count; the DP plans on today's wetness; every compound gets the fitted set's terms | `strategy/candidates.ts:73–76`, `dp-input.ts:109, 84–85` | SP4.3b spec §6 | verified |
| B6 | `driver-noise` counts slow mini-sectors under SC and in the pit lane as human time loss; `incidents` excludes them | `driver-noise/residuals.ts:256` | C43 | verified |
| B7 | An unconfirmed (C18) neutralisation still blocks a new SC start in `race-hazard`; `shared/neutralised.ts` treats it as none | `race-hazard/asof.ts:88` | C18, C43 | verified by survey |
| B8 | One table mixes two rejoin models (box-now row from `rejoin`, later rows from the simulator) | `pit-sweep/rows.ts:61`, `undercut/cases.ts:83`, `sc-call/job.ts:102` | C43 | verified |
| B9 | Possible double fuel count: a stint fitted without fuel (`fuelCorrected: false`, e.g. a rival's hidden fuel) gives a base pace with fuel in it, and the lap model adds fuel again | `degradation/stint-fit.ts:117`, `forecast-field/index.ts:241–244` | C3 | **open: to check** |

## 2. The owners

| # | Owner | Owns | Readers move onto it, deleting | Survey |
|---|---|---|---|---|
| O1 | **`tyre-model`** (new calculator, with an as-of form) | per car and compound: wear rate (measured cumulative rate, else the game prior k × 70 / `usableLife`, research 22), ν, fresh-set offset, life to the limit, with a source tag | `driver-noise`'s wear output and defaults; `degradation`'s per-stint wear rate and ν default as a model term; `tyre-life`'s age basis and fresh-life table (it becomes a reader); `forecast-field`'s ν, floor and offsets; `stint-analysis/pool.ts`'s ν as a model term; `dp-input.ts` and `race-forecast/field.ts`'s per-car copies; `shared/wear-rate.ts`; the three worst-corner rules | 4, 1 |
| O1a | a **tyre-set fact** (recorder, supervisor) | `usableLifeLaps` per car and compound and the fresh-set `lapDeltaMs` at each stint start, so the projection (as-of builds, calibration, profiles) carries the game prior | — (new; rules version changes, C61) | 4 |
| O2 | **`degradation`** owns a car's pace | the fuel-corrected base pace, its line and residuals | the `pace` unit (no reader, never runs); `forecast-field`'s raw-lap fallback; `race-interaction`'s own pace advantage (from `degradation` residuals) | 1 |
| O3 | **`track-wetness`** owns track condition | the dry reference, the wetness state, `wet` (one rule, not `> 0`), the slick scale from the lap model's parameters, and the **weather worlds** every planner uses | `crossover`'s `dryRefOf`; three `wetness > 0` tests; `dry-reference.ts`'s private offsets; `dp-input.ts`'s constant fill; `race-monte-carlo/weather.ts`'s own timeline | 2 |
| O3a | **`rain-outlook`** owns reading the forecast | "rain is coming" (one threshold), the highest chance per remaining lap, the samples ahead | `strategy`'s `rainCanCome` forecast half and `rainCandidatePct`; `weather`'s copy of the filter (it binds `rain-outlook`'s samples) | 2, 5 |
| O4 | **`lap-model`** owns the lap-time formula | the compound and wetness term (exported), compound → tyre type (to `domain`, used by `crossover` too) | `race-monte-carlo/rivals.ts`'s `typeMs` and `TYPE_OF`; `crossover/tyre-type.ts`'s table | 2 |
| O5 | **one tyre-type switch rule** (in `rival-stops`, beside its stop windows) | when a car switches type: the game's delta of the other type (research 22) where known, else the lap model at the world's wetness | `race-monte-carlo/rivals.ts`'s first-faster rule; the DP keeps its own threshold only as "when we should", and `crossover` shows the observed line | 2, research 22 |
| O6 | **`shared/neutralised.ts`** owns neutralisation | open, last, confirmed only, ending, leader progress; the time-loss exclusion by frames | five local `kind === 'SC'` checks (`race-hazard`, `sc-call`, `alarms`, `forecast-score` ×2); `race-hazard`'s leader lap; `incidents`' own merge and `driver-noise`'s empty exclusion; `race-monte-carlo/scenarios.ts`'s second start block | 2, 5 |
| O7 | **`lap-classes`** owns which laps count | the neutralised-lap rule (built on O6), the lap-1 and pending-phase rows, one in-session row set (`shared/car-status.ts`) | `race-interaction`'s and `forecast-score`'s own lap filters; ~13 private `isRace` rows; the copied `IN` car-status rows; `car-status.ts`'s unused helpers | 1, 5, 6 |
| O8 | **one stop-and-rejoin model** (`race-forecast`, through the starting point) | a stopper's rejoin and the stop cost (in-lap share, human saving, double stack, pit-exit yield) | `rejoin`'s private rule (the unit calls the shared one); the DP's `trafficOf` rejoin; `strategy-dp/thresholds.ts:151`'s inline stop cost; the mixed rows | 3 |
| O9 | **one rival plain policy** (`race-monte-carlo/rivals`, from `rival-stops`) | a rival's next stop lap and compound under a scenario | `dp-input.ts`'s `plainRoad` policies; `forecast-score`'s `forecastPolicies`; `rivalNextCompound` ignoring the odds | 3 |
| O10 | **`gaps`** owns gaps, order and leader progress now | gaps between cars, the race order | `forecast-field`'s now-gaps and `orderOf` (it extrapolates only in as-of builds); `session-remaining`'s leader | 3, 5 |
| O11 | **`shared/compound-rule.ts`** | owes a second dry compound | `pit-window`'s `ruleRequired` decision (B4) | 3, 5 |
| O12 | **`pace-delta`** owns the reference pace before an event | | `pit-loss/loss.ts`'s own reference | 1 |
| O13 | **`race-interaction`** owns "can a car pass" | the pass curve | `battle`'s fixed 1,000 ms margin reads it; one DRS rule and key | 1, 3 |
| O14 | **`lap-times`** owns bests | | `lap-overview`'s loop | 1 |
| O15 | **`shared/fuel-burn.ts`** through the starting point | the burn the simulators use | three `fuel ÷ laps left` formulas | 1 |
| O16 | **`tyre-wear`** owns the life-span marker | wear at the game's life span per corner | the display's multiplication (B1) | 6 |
| O17 | **`driver-noise`** declares a sample count | human laps of a profile entry, membership through the projection module | the bridge's `humanLapCount` (B2) | 6 |

**Helpers and vocabulary** (no unit logic): `shared/stats.ts` (median, lower median for places, MAD; deletes 10 copies); `domain` helpers `ourCars` (four definitions, only one handles teammate = player), `pointAt` (two), one `DrsOffReason`, `WeekendPhase` only (deletes `SessionKind`); `kit/values/format.ts` for weekend-phase names (three tables) and ms↔s; engine owns the game's wheel order. **Config:** one key per threshold (DRS range, traffic gap, close gap with `COVER_GAP_MS`, `rivalRules`). **Dead code:** `shared/penalties.ts` (game codes in analysis, no caller), the `pace` unit.

## 3. Already clean (no change)

Step 1, the sub-machines and recorders (convert once, re-fit nothing); the bridge's priors and profile runners and every `register.ts` (wiring only); SC/VSC chances (`race-hazard` only); the four strategy jobs' starting point (`strategyInputFrom`); the plain forecast and the MC field (one simulator, `raceForecast`); `damageChange` events against `shared/damage-jumps.ts`.

## 4. Contract

No owner needs a contract change: each is a calculator, a shared pure function or a domain helper (C1, C43, C50). The supervisor-owned parts (C78): `domain` types (per-compound starting point, `tyre-model` output, the tyre-set fact, helpers), the recorder (rules version changes, C61, stored sessions rebuild), contracts (topics whose source moves), config declarations, and the migration of stored driver-profile overrides (`driverNoise.wearRatePct.*` → the factor k, under `PITWALL_DATA_DIR/drivers/`). The restart (Q2 D) and the gap-chart join origin (Q7) stay as in the triage file.

## 5. Order (C81: shared first, then bottom-up)

1. **Vocabulary and helpers:** `shared/stats.ts`, the domain helpers, format, one config key per threshold, dead code. No behaviour change; tests ported.
2. **Owners without new models:** O6 neutralisation, O7 lap classes, O11 compound rule, O12, O14, O16, O17, O10 gaps; fixes B1, B2, B4, B6, B7.
3. **Domain and the fact (supervisor):** per-compound starting point, the tyre-set fact (O1a), `tyre-model`'s type; rules version.
4. **The models:** O1 `tyre-model`, O2 pace, O3 / O3a track condition and forecast, O4 lap model, O13 passing, O15 fuel.
5. **The simulators and jobs on them:** O8 rejoin, O9 rival policy, O5 switch rule, the DP over the weather worlds with plans carrying their own triggers (B5).
6. **Displays and tooling:** wording, track map (Q6), gap chart (Q7), `pitwall strategy --runs`.

Each step is one sub-project slice with its own spec section, two phases per task (C82), and a guard test against a new second owner (a completeness test over the units' `reads`: only the owner reads the raw source of its judgement).

## 6. Validation

- Every step except 3–5 changes no number that is not a bug: the existing tests, ported, and the acceptance suite stay green.
- Steps 3–5: Silverstone laps 36–52 (no stop among the DP's own base plans from lap 38), the Spa score no worse than at the end of SP4.3b, research 22's wear-prior error reproduced on synthetic sets, the strategy reference regenerated once at the end.

## 7. Open for the brainstorm

1. One sub-project in six slices, or step 1–2 first as a clean-up before 4.3c and steps 3–5 as the strategy fix?
2. `tyre-model` as a new unit or `degradation` grown into it (the tyre survey: degradation's filter prior from `tyre-model` would be a cycle; a shared pure prior function avoids it)?
3. The pit window and rival windows (a 70 % limit) against the DP and MC (a convex cost, no limit): one life model, or a stated reason for two answers?
4. B9: check, then fix in step 4.
5. The game's inter and wet offsets: tuned together with the wetness slopes (research 21 §7); replace them only with a refit.
