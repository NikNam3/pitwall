# DRAFT: strategy fixes after the Silverstone live test, structurally

**Status: draft by the supervisor, 2026-11-14; not brainstormed, not approved.** Input for the brainstorm of Q1 in `docs/superpowers/plans/2026-11-14-live-test-triage-questions.md`. Evidence: research 21 §2, §9, §12; research 22; the triage file's T-numbers.

**The rule (user, 2026-11-14): the code stays clean; the strategy is improved structurally, never by a workaround.** So every fix names the one module that owns the judgement (C43: a judgement several units need is one calculator) and lists what it deletes. A fix that only makes Silverstone come out right is not on this list.

## 1. Why the symptoms happened: one judgement, several owners

| Judgement | Owners today | Symptom at Silverstone |
|---|---|---|
| A car's tyre terms per compound (wear rate, ν, offset) | `degradation` (ν prior `defaultNuMsPerLap` 150), `driver-noise` (`humanWearRatePct`, `defaultWearRatePct` 2.0), `tyre-life` (age basis, `ageLossLimitMs`), `forecast-field` (`minWearRatePctPerLap`, compound offsets from the track file), `dp-input.ts:84–85, 100` (the fitted set's rate and ν copied to every compound) | the medium inherited the drying inters' negative ν; the fresh inter's 13.3-lap life came from a default; no unit used the game's own tyre data (research 22) |
| The dry pace of the track | `track-wetness/dry-reference.ts` (own laps, field, `view.weekend`), `crossover/calculator.ts:107` `dryRefOf` (lowest slick median so far) | both had none after the restart; two answers could disagree when both exist |
| The weather the plans are judged in | `strategy-dp` (today's wetness on every lap, `dp-input.ts:109`), `race-monte-carlo` (rain every lap or never, per scenario, `weather.ts:25–39`) | the DP chose the candidates in a dry world, the MC scored them in a 77 % wet one; 58 s apart |
| A plan's SC/VSC triggers | `strategy-dp/thresholds.ts` for the best plan; `candidates.ts:71, 82–83` copies them to other plans | the no-stop plan carried "box for mediums" |
| Which plans reach the MC | `candidatesOf`: one top-8 list over all sequences, then variations of the best | the no-stop plan was cut although the DP built it |

## 2. The structure

### 2.1 One tyre model: `tyre-model` (new calculator)

**Owns:** per car and compound (and corner where it matters), with a source tag (`measured`, `profile`, `game`, `default`) per term:
- wear rate: the stint's own cumulative rate once it has 3 gain laps and 5 % (research 21 §2), else the game prior `k × 70 / usableLife` (research 22: AI k 0.86; a human's k from the driver profile, else a config default), else the config default;
- ν: the stint's own fit, else the game's ms per % × the rate, else the default;
- fresh-set offset against the medium: the game's `lapDeltaMs` between fresh sets, else the track file;
- life to the limit, from the rate (the age basis only where wear is hidden, research 21 §2; under realism a rival's wear is hidden, so its rate comes from our own car's game prior on that compound, research 22 §2).

**Reads:** `tyres` (live sets), `degradation`'s stint fits, `decisions` and `view.drivers` (the profile's k), config. Behaviour table over `car-activity-race`, `car-driver` (C44).

**Readers:** `tyre-life`, `pit-window`, `forecast-field` (and through it the DP and the MC), `rival-stops`, `driver-noise` (residuals only).

**Deletes:** `driver-noise`'s wear defaults and its wear-rate output; `degradation`'s ν prior as a model term (the fit keeps its filter prior); `tyre-life`'s own age-basis life and its fresh-life table; `forecast-field`'s per-compound guesses and `minWearRatePctPerLap`; `dp-input.ts`'s copy of one rate to every compound; the per-lap median wear rule in `shared/wear-rate.ts` (fuel and ERS keep `per-lap-rate` and the user's `minSamples` 2 ruling; wear leaves it, which the user decides). The driver profile's absolute wear entry becomes a factor k (scale-free, research 21 §13, 22 §1.3), so the race-distance table of research 21 §13 is never built.

**Covers:** T3, T6, T7, T21a–c, research 21 §10's prior rows.

### 2.2 One track condition: `track-wetness` owns the dry pace and the wetness

**Owns:** the dry reference (as today, plus a calibration priors entry, C62a, and the game's slick delta as a reading when no slick lap exists, research 22 §1.9: a reading, not ground truth); the wetness state; the **wetness path** forward: one function of the state and the rain forecast that gives the weather worlds (scenarios) every planner uses.

**Readers:** `crossover` (reads the dry reference and the 110 % line from it instead of computing `dryRefOf`), `forecast-field`, `strategy-dp`, `race-monte-carlo`.

**Deletes:** `crossover`'s `dryRefOf`; `dp-input.ts`'s constant wetness fill; `race-monte-carlo/weather.ts`'s own rain timeline (it draws from the shared worlds instead).

**Covers:** T2, T8, deferred item 11 (the DP's expectation over the same worlds the MC samples, so the two cannot disagree on the weather), the settled-wetness proposal later as a change inside this one function.

### 2.3 Plans with their own triggers: `strategy-dp` and `strategy`

- **`strategy-dp` returns base plans as spec §6 says:** the best per stop count and compound sequence, **each with its own trigger thresholds** (a plan's SC/VSC range, damage and rain thresholds are properties of that plan, computed by the DP for it). "Box this lap" and "continue" are named outputs with names that say what they mean (T5).
- **`strategy` selects, it does not edit:** candidates come from named sources: base plans (one per stop count always; the top-K bound of R49 applies within a stop count), stop-lap neighbours, the rule families (mirror ahead and behind with the rival's lap **and compound**, deferred item 12; cover; extend), the committed policy. No candidate copies another's triggers.

**Deletes:** `candidates.ts`'s trigger copying (lines 71, 82–83) and the single global top-8 cut.

**Covers:** T1, T4, T5, deferred item 12.

### 2.4 Field behaviour

`rival-stops` predicts a car's tyre-type switch from the tyre model's game delta of the other type (research 22 §1.7: the AI switches on the lap it turns negative), beside its dry-stop windows. One rule in one unit; `crossover` shows the same value from the tyre model, it does not decide it again.

**Covers:** T21d.

## 3. Fixes that are structural already

- T9 restart: the session's recording continues (Q2 D): one file per session, every reader unchanged.
- T12 gap chart: `gaps` defines a join origin for a race joined after lights out (Q7 A), one rule in the unit that owns the race start.
- T13/T14 track maps: the ghost's map point gets its own quick unit at the frame cadence (Q6 A), the display only draws.
- T19 `pitwall strategy --runs`; T10 the track-data generator's dry-year fallback (aux repo).

## 4. Order (C81)

1. Contracts and domain (supervisor): `tyre-model`'s output type and config, the profile entry (k per compound), the wetness worlds' type, the DP's plan type with thresholds per plan.
2. Calculators: `tyre-model`; `track-wetness` (dry pace, worlds); `gaps` join origin; the ghost unit.
3. Readers moved onto them, deleting their own copies: `tyre-life`, `pit-window`, `crossover`, `driver-noise`, `forecast-field`.
4. Simulators and analyses: `strategy-dp` (plans with triggers, over the worlds), `race-monte-carlo` (the shared worlds), `strategy` (named candidate sources), `rival-stops`.
5. Displays and tooling: strategy wording, track map; T19.

## 5. Validation

- Silverstone `2026-11-14_00-04-26` laps 36–52: "no stop" ranked by the DP itself among the base plans from lap 38; the MC's best from lap 39 or earlier.
- The Spa score (`pitwall score`): no worse at h3 / h5 than at the end of SP4.3b.
- Research 22's leave-one-race-out wear-prior error reproduced by `tyre-model` on synthetic sets (no recording facts in tests, C84).
- A test that fails if a second module computes a dry reference or a wear rate (a completeness test over the units' reads: only `tyre-model` reads `tyres.sets` for rates; only `track-wetness` reads slick medians for a dry pace).
- Budgets: the DP over several weather worlds gets a tested speed target in the spec (it multiplies the DP's work).

## 6. Open for the brainstorm

1. Is `tyre-model` one new unit, or `degradation` grown into it? (One owner either way; a new unit keeps `degradation` a fitter.)
2. How many weather worlds does the DP solve (2: dry and the forecast's rain; or a few quantiles), and inside which budget?
3. Wear leaving the user's `minSamples` 2 ruling (fuel and ERS keep it).
4. The game's lap delta as a wetness reading: in `track-wetness` only, never as a second dry reference.
