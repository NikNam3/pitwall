# DRAFT: strategy fixes after the Silverstone live test

**Status: draft written overnight 2026-11-14 by the supervisor, not brainstormed, not approved.** It exists only so that, if the user answers Q1 A of `docs/superpowers/plans/2026-11-14-live-test-triage-questions.md`, the spec can be written fast. Every item is a proposal; the user's answers decide.

Evidence: research 21 §2, §9, §12; research 22; the triage file's T-numbers.

## Items, by unit

| # | Unit (folder) | Change | Clauses | Test idea |
|---|---|---|---|---|
| T1 | `strategy` (`candidates.ts`) | Keep the DP's best plan of each stop count (0–3) besides the `dpPlansMax` best; the zero-stop plan whenever the compound rule is waived or met | C43; spec SP4.3b §6, §8.1 (restores them; R49's cap stays as the top-K bound) | a DP result whose zero-stop plan ranks 15th of 83: it is among the candidates |
| T2 | `shared/strategy-input` (`dp-input.ts:109`) | `wetnessByLap` from the forecast's wetness path (the MC's expected path, or one DP per weather world, both worlds' candidates) | spec §6 input; deferred item 11 | a rain forecast of 77 %: the DP's wetness rises over the laps |
| T3 | `shared/strategy-input` (`dp-input.ts:84–85, 100`), `race-forecast/field.ts` `fitStop` | Per compound wear rate and ν after a stop: the game prior (T21) for compounds without a measured stint, the measured one for the fitted compound | spec §6 input "the wear rate per compound" | after a stop to mediums the medium's own rate and ν, not the inter's |
| T4 | `strategy` (`candidates.ts:71, 82–83`), `strategy-dp/thresholds.ts` | The zero-stop and stay-out candidates with their own SC/VSC thresholds (or none), plus a pure stay-out row | spec §8.1 (clarify whose thresholds) | the zero-stop candidate carries no "box for mediums" trigger |
| T5 | `strategy-dp` output, strategy display text | Name "not this lap" and "to the flag" apart | C68 (wording in `text.ts`) | wording only |
| T6 | `tyre-life` (`as-of.ts:85–111`) | No age-basis life while ν is the prior; never for inters and wets; the game prior's life (`usableLife` scaled by k) instead | C3 | a fresh inter at lap 0 of its stint: life from `usableLife`, not 2,000 / 150 |
| T7 | `shared/wear-rate.ts` (not `per-lap-rate`, which fuel and ERS share) | Live wear rate = cumulative gain over the newest ≤ 5 green laps; `insufficientData` until 3 gain laps and 5 % accrued at the corner, the prior until then | C43 (one wear rate); **overrides the user ruling of 2026-10-30 behind `minSamples` 2 for wear only** | gains 2, 3, 2, 3, 2 give 2.4, not 2 |
| T8 | `track-wetness`, `crossover` | A dry reference without a slick lap: a priors entry (C62a) from the set's sources, else the game's slick delta (research 22) as the wetness reading until a dry lap exists | C62a, C41 (reads `tyres`) | a race joined on inters: the state is known from the first lap |
| T21 | `driver-noise` (defaults), `degradation` (ν prior), `forecast-field` (compound offsets) | Wear prior k × 70 / `usableLife` (AI 0.86, human 1.3, profile entry `driverNoise.wearFactor.<compound>` as the person's k); ν prior = the game's ms per % × the rate; fresh-set compound offsets from `lapDeltaMs` against the medium, the track file only as fallback | C41 (reads `tyres`), C62c (a new profile entry), C8 (rivals' sets hidden under realism: our car's values for the field) | research 22's leave-one-race-out numbers as a fixture-free unit test on synthetic sets |
| T21b | `rival-stops`, `crossover` | The AI field's tyre-type switch from the game's delta of the other type (switch on the lap it turns negative) | C43 (one calculator both read) | Singapore segment: the predicted switch lap equals the recorded one |
| T19 | bridge CLI (`cli/commands/strategy.ts`) | `--runs n` overriding `n0` and `maxScenarioPolicies` for one call | C47 (replay keeps the sidecar's config otherwise) | the flag reaches the job's config |
| T10 | `pitwall-trackdata` (aux repo) | Dry-year fallback for pit loss and compound offsets (Silverstone 2025 was wet) | C62b (files made outside pitwall) | the generator's own test |
| T12 | `gaps` | Join origin for a race joined after lights out (Q7 A) | C3, C31, C43; timing spec §6.1 | a race whose `racing` span is `joinedAt`: lines from the leader's first crossing |
| T13/T14 | new quick unit beside `rejoin`; `track-map` display | Ghost map point from "now − loss" every frame at 10 Hz; driver codes on the full-size map (Q6 A) | C41, C53, C65, C66, C68; SP4.2 §3.2, timing spec §7.2 | ghost moves every frame; label layout case in the gallery |

## Order (C81: shared first)

1. Domain and contracts (supervisor): the profile entry key, any new topic (ghost map point), config declarations (T7 minimum, T21 k values).
2. Calculators: `shared/wear-rate.ts` (T7), the game priors (T21) in `driver-noise` / `degradation` / `forecast-field`, `track-wetness` (T8), `gaps` (T12), the ghost unit (T13).
3. Analyses and simulators: `tyre-life` (T6), `strategy-input` (T2, T3), `strategy` and `strategy-dp` (T1, T4, T5), `rival-stops` and `crossover` (T21b).
4. Displays: `track-map` (T13/T14), strategy wording (T5).
5. Tooling: T19; aux repo T10 in parallel.

## Validation

- Replay Silverstone `2026-11-14_00-04-26` laps 36–52 (`pitwall strategy --runs 4000` once T19 exists): "no stop" among the rows on laps 38–41, and the best from lap 39 or earlier.
- The Spa score (`pitwall score`): no worse at h3 / h5 than at the end of SP4.3b.
- The strategy good-selection reference (`fixtures/`) regenerated once at the end (as R46).
- Budgets: `strategy`'s per-call budget with the extra candidates (≤ 4 more per car).
