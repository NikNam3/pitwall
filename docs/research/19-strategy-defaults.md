# 19: strategy defaults (SP4.3b)

The 4.3b1 spikes behind the config literals: Task 12 (lap-model defaults and the rivals' rules, spike branch `spike/4.3b-defaults` bcd9774b) and Task 13 (the pass-curve refit, `spike/4.3b-pass-fit` 5f37b4ea), 2026-11-12. Applied in ea347bc3 (race-interaction) and the next commit (forecast-field, strategy). Supervisor rulings: the three wet values hold together (all applied); the rivals' SC rule applies to a rival with a stop still ahead (Spa: 3 of 4 cars that had met the rule boxed too); out-lap rows are skipped when reading what a car owes.

# Strategy defaults: the lap model's F6 values and the rivals' rule

SP4.3b1 plan Task 12, 2026-11-12. I checked the `forecast-field` lap-model defaults (spec §4.2 F6) and fitted the rivals' reaction rule (spec §7.2) on every F1 25 race recording. The code is throwaway, on branch `spike/4.3b-defaults` (never merged; worktree `../pitwall-wt/spike-4.3b-defaults`):

- `spike/extract.ts` drives the engine over each recording. It is copied from spike 4.3a and adds a weather timeline.
- `spike/neutralised.ts`, `convex.ts`, `rivals.ts` and `wet.ts` do the fits. `spike/common.ts` holds the shared loading and a seeded cluster bootstrap with 1,000 reps.
- The results are in `spike/out/{neutralised,convex,rivals,wet}.json`.

**Labels:** every number states its data. **Thin** marks fewer than about 30 cases, or fewer than 3 events behind a value. The AI is fitted on AI cars only; the human cars come from the car-driver spans and are left out.

## 1. Recordings

The race-phase sessions with at least 100 lap records are below. The engine runs with realism off, and every lap record is the current version (`currentLaps`).

| Race | Recording | Laps run / total | AI difficulty | Conditions | Neutralisations |
|---|---|---|---|---|---|
| Singapore | 2026-10-29_00-04-08 | 44 / 62 (SEND) | 90 | inter, then slick (laps 6–24), then inter | none |
| Zandvoort | 2026-10-29_23-00-37 | 14 / 72 (stream ends) | 70 | dry | VSC (10 s, became an SC), SC lap 12 |
| Mexico | 2026-10-30_15-20-41 | 71 / 71 | 62 | storm: wet, then inter from lap 4 | VSC lap 15 (81 s) |
| Miami | 2026-10-30_18-53-00 | 20 / 20 | 62 | storm: wet and inter side by side | VSC lap 2, SC laps 3–4, VSC lap 14 |
| China | 2026-11-02_15-17-14 | 10 / 10 | 90 | dry | none |
| Texas | 2026-11-05_00-13-26_car19 | 20 / 20 | 65 | dry | SC lap 12 |
| Spa | 2026-11-12_02-21-24 | 44 / 44 | 90 | dry | SC lap 20 |

Miami's practice of the same day (2026-10-30_18-26-27, dry, 20 cars) gives Miami's dry reference. The other recordings were not used: qualifying, practice, time trial, 0-lap races and menus, as in research 15 §1.

## 2. SC and VSC: pace, wear and fuel factors

**Method.**

- **Which laps:** every lap with an SC or VSC share above 0, excluding in-laps, out-laps and lap 1. Each is compared with the same car's green laps on the same set within 6 laps: no share, set age at least 2, valid, at least 2 such laps.
- **What is compared:**
  - lap time, fuel-corrected at 30 ms/kg, as a ratio to the median green lap;
  - worst-corner wear per lap (the lap model's wear), as a ratio to the mean on the green laps;
  - fuel burn per lap, as the same kind of ratio.
- **Fit:** a through-origin regression of the change on the share, `a = aref · (1 + share · (f − 1))`, over every lap with a share of at least 0.2. Full laps alone give the same answer.
- **Uncertainty:** SE from a bootstrap over the neutralisation events and over car-events.

| Value | Current | Measured | Counts | Recommendation |
|---|---|---|---|---|
| `scPaceFactor` | 1.6 (TUM) | **1.267** ± 0.018 (events), car-event 90 % 1.249–1.284. Dry 1.284 ± 0.009; Miami wet 1.213. By race: Zandvoort 1.32, Texas 1.27, Spa 1.29. The first SC lap (catching the queue) runs ×1.14, later laps ×1.26–1.42 | 123 laps (89 full), 58 car-events, 4 SCs, 4 races | **replace: 1.27**, "spike 4.3b-defaults (research 19 §2): 123 SC laps, 4 SCs in 4 races, ±0.02" |
| `scWearFactor` | 0.5 (estimate) | **0.355** ± 0.028 (events); dry 0.336 ± 0.016; Miami wet 0.44 | 123 laps, 58 car-events, 4 SCs, 4 races | **replace: 0.36**, "spike 4.3b-defaults (research 19 §2): 123 SC laps, 4 SCs, ±0.03" |
| `scFuelFactor` | 0.5 (estimate) | **0.568** ± 0.005 (events); every SC 0.56–0.59 | 123 laps, 58 car-events, 4 SCs, 4 races | **replace: 0.57**, "spike 4.3b-defaults (research 19 §2): 123 SC laps, 4 SCs, ±0.01" |
| `vscPaceFactor` | 1.4 (TUM) | **1.188** ± 0.011 (events), car-event 90 % 1.18–1.19. Every VSC was wet: a wet green lap is slower, so the ratio is lower than a dry VSC's would be (the SCs: wet 1.21 against dry 1.28) | 70 laps, mean share 0.36 (no full VSC lap), 44 car-events, 3 VSCs, 2 races (Mexico, Miami). **Thin** in events | **replace: 1.19**, "spike 4.3b-defaults (research 19 §2): 70 partial VSC laps, 3 VSCs, Mexico and Miami (wet only), ±0.01; thin" |
| `vscWearFactor` | 0.6 (estimate) | 0.24 ± 0.17 (events). Wear comes in whole %, so a 0.36 share is barely seen | 70 laps, 3 VSCs, 2 races. **Thin** | **replace: 0.35** (the SC's measured value; the VSC's own is 0.7 SE from it and 2.1 SE from 0.6), "spike 4.3b-defaults (research 19 §2): VSC 0.24 ± 0.17 (thin, 3 VSCs), SC 0.36" |
| `vscFuelFactor` | 0.6 (estimate) | 0.621 ± 0.028 (events) | 70 laps, 3 VSCs, 2 races. **Thin** in events | **keep: 0.6** (within 1 SE), "spike 4.3b-defaults (research 19 §2): 0.62 ± 0.03, 3 VSCs; thin" |

Only 3 human SC laps were seen (pace ×1.40, fuel ×0.82). That is too few to separate humans from the AI.

## 3. The convex wear coefficient

**Method.**

- **Model:** `t = a_stint + b_stint · w + c · max(0, w − 40)²`, where `w` is the worst-corner wear at mid-lap.
- **Fit:** within each stint, both `t` and the convex term are residualised against [1, w] (Frisch–Waugh), and `c` is pooled over the stints.
- **Laps:** AI only; green, valid laps, no in-lap or out-lap, set age at least 2; fuel-corrected; outliers beyond 4 MAD of the stint's own line dropped.
- **Uncertainty:** a bootstrap over stints.

The wet races are fitted two ways:

- **"common mode":** each lap minus the median of the other cars on its type and lap. This removes the track's evolution, but also part of the convexity, since the field wears alike. It biases `c` towards 0.
- **"raw":** the wetness drift stays in. The bias could go either way.

| Fit | Stints (past 40 %) | Laps past 40 % | Max wear | c (ms per %²) | SE | 90 % |
|---|---|---|---|---|---|---|
| Dry races | 118 (17) | 22 | 50 % | −3.7 | 62 | not identified |
| Wet types, common mode | 55 (25) | 271 | 55.5 % | 1.73 | 1.34 | −0.29 to 4.19 |
| Wet types, raw | 55 (25) | 279 | 55.5 % | 5.42 | 1.33 | 3.48 to 7.84 |
| Mexico inters, raw | 18 (17) | 247 | 55.5 % | 5.53 | 1.42 | 3.58 to 8.17 |

- **Dry:** convexity is invisible. No dry stint ran past 50 %, and only 22 dry laps passed 40 % (China mediums, Spa).
- **Wet (Mexico inters, Miami wets):** the two fits bracket c at 1.7–5.4 ms/%². The current 2.5 lies inside the bracket (+1 s at 60 %, +4 s at 80 %).
- **No dry slick past 55 %:** the data cannot say what happens there.

| Value | Current | Measured | Counts | Recommendation |
|---|---|---|---|---|
| `convexMsPerPct2` | 2.5 (flagged prior) | 1.7 ± 1.3 (lower bound) to 5.4 ± 1.3 (upper); dry not identified | 25 stints and 271 laps past 40 %, 2 races, wet types only. **Thin** in races | **keep: 2.5** (flagged), "spike 4.3b-defaults (research 19 §3): wet stints bracket 1.7–5.4 (25 stints past 40 %, Mexico and Miami); dry not identified (max 50 %)" |
| `convexFromPct` | 40 | not tested (fixed knot) | — | keep |

## 4. Inter and wet against the slick

**What can be measured.** The lap model writes a lap as `pace + offset[type] + s[type] · W`, where W is the slick's loss (so the slick's slope is 1). Fitting the four values `oI`, `sI`, `oW`, `sW` needs slicks running on a wet track at the same moment as wet tyres. That happened at only one crossover in the data, Singapore's drying at laps 4–6, and even there only 2 inter sector samples overlap the slicks. Mexico and Miami never ran slicks. So the data give three relations, not four values.

**Method.**

- Excess over a dry reference:
  - Singapore: each car's fuel-corrected slick laps 8–22 (median 96.3 s), taken as W = 0.
  - Miami: each car's best fuel-corrected lap in the same-day practice (median 94.3 s), assuming the practice slot is the same car.
- Per lap, the median over AI cars of each type.
- Sector samples in the crossover windows: clean sectors only (no out-lap; no in-lap third sector), relative to the car's own median of the sector.

**The three relations.**

1. **Slick and inter meet (Singapore drying).**
   - 13 of 19 AI cars switched to slicks at lap 4, 5 at lap 5 and 1 at lap 6, with inters at +7.7 s (lap 4) and +9.5 s (lap 3).
   - By lap 6 the slicks were 1.3 s per lap ahead of the last inter (in sectors; 2 inter samples, **thin**).
   - So the crossing lies at an inter excess of about **6–8 s** (W\* ≈ 7 s, about 7 % of the lap).
   - The model now puts it at `oI / (1 − sI)` = 10 s.
2. **Wet against inter (Miami, 14 green laps with both types):**
   - `e_wet = 6.38 s + 0.491 · e_inter` (SE 1.7 s and 0.12). So `sW / sI` = **0.49 ± 0.12**. The sector trends say 0.54 (inters gained 3.6 s, wets 1.9 s over laps 5–20).
   - The two meet at an inter excess of **12.5 s** (bootstrap over laps ±0.2 s; the systematic error from the car pairing is larger).
   - The model now puts it at 18.3 s, with `sW / sI` = 0.70.
   - Mexico has no dry reference. At its switch (lap 4) the inters were about 0.5 s faster than the wets (trend extrapolated, **thin**). This agrees with research 12's "about 1 s" in sign.
3. **Levels of inter excess seen:** Singapore +7.7 to +13.6 s (rain 37–91 %; storm laps 37–44 +10.5 to +11.0 s); Miami +11.7 to +16.1 s.

**Not measurable:** `sI`, the inter's slope. It needs an inter and a slick on the same track at two different wetnesses, and the data have only one such moment. It stays 0.5. With `sI` fixed, the three relations give:

| sI | oI = W\*·(1 − sI) | sW = 0.49·sI | oW (from the 12.5 s meeting) |
|---|---|---|---|
| 0.4 | 4.2 s | 0.20 | 8.4 s |
| **0.5** | **3.5 s** | **0.245** | **8.1 s** |
| 0.6 | 2.8 s | 0.29 | 7.7 s |

As a check at `sI` 0.5: Miami's wets at an inter excess of 16.1 s give a model wet excess of 14.3 s; measured, 15.0 s.

| Value | Current | Measured | Counts | Recommendation |
|---|---|---|---|---|
| `interOffsetMs` | 5000 (estimate) | 3500 (2800–4200 over sI 0.4–0.6) from the slick/inter crossing at 6–8 s | 1 crossover (Singapore, 19 AI switches), 2 overlapping inter samples. **Thin** | **replace: 3500**, "spike 4.3b-defaults (research 19 §4): Singapore's slick/inter crossover at 6–8 s inter excess, with interMsPerWetnessMs 0.5; one crossover, thin" |
| `wetOffsetMs` | 9000 (estimate) | 8100 (7700–8400 over sI 0.4–0.6) | Miami, 14 laps × (8–11 inter, 8–10 wet cars), 1 race. **Thin** | **replace: 8100**, "spike 4.3b-defaults (research 19 §4): Miami's wet/inter meeting at 12.5 s inter excess, with interOffsetMs 3500 and interMsPerWetnessMs 0.5; one race, thin" |
| `slickMsPerWetnessMs` | 1 (definition) | — | — | keep |
| `interMsPerWetnessMs` | 0.5 (estimate) | not identifiable | — | **keep: 0.5** (unmeasured), "pitwall estimate; not identifiable from the recordings (research 19 §4)" |
| `wetMsPerWetnessMs` | 0.35 (estimate) | 0.245 (0.49 ± 0.12 × sI) | Miami, 14 laps, 1 race. **Thin** | **replace: 0.25**, "spike 4.3b-defaults (research 19 §4): Miami sWet/sInter 0.49 ± 0.12 (14 laps) × interMsPerWetnessMs 0.5; one race, thin" |

These three replacements are one consistent set. They only make sense together with `sI` 0.5, so change all of them or none.

## 5. The rivals' rule (spec §7.2)

**Method.**

- **Owing a stop:** at each neutralisation start, an AI car owes a stop when it has run only one dry compound so far and no inter or wet. A stop made before the start counts, read from the first lap after its out-lap. Out-lap rows carry the old set's compound and age (research 12 §3); before this fix, Texas showed 5 false "owers" that were on their out-laps. A car in the pit lane, or on its out-lap, at the start is left out.
- **Tyre age:** the set age at the start of the lap in progress.
- **Boxed under it:** pit-lane entry between the neutralisation's start and end.
- **Fit:**
  - `aMin` is the youngest owing car that boxed; this is the maximum-likelihood value for a step rule.
  - `q` is the share boxed among owing cars at least `aMin` old.
  - The uncertainty comes from a bootstrap over SC events and over cars, plus a Wilson 90 % interval.

**Under an SC (AI cars owing a stop):**

| SC | Laps left | Owing | Boxed | Ages (B = boxed) |
|---|---|---|---|---|
| Zandvoort lap 12 | 61 | 16 | 13 | 15 × 10 laps (3 stayed out), 11B |
| Texas lap 12 | 9 | 3 | 3 | 10B 10B 10B |
| Spa lap 20 | 25 | 13 | 12 | 4B 5B 5B 5 6B 7B 7B 7B 8B ×5 |
| **Pooled** | | **32** | **28** | |

- **`q` = 28 / 32 = 0.875:** SC-event bootstrap SE 0.045 (90 % 0.83–0.95), car bootstrap SE 0.058, Wilson 90 % 0.75–0.94.
- **`aMin` = 4:** the youngest owing car that boxed. No owing car younger than 4 laps was seen under an SC, so `aMin` has no lower bound in the data (anything from 0 to 4 fits). Car-bootstrap band 4–5.
- **Cars that had already met the rule:**
  - On sets of 0–2 laps, none of 12 boxed (Texas 11, Spa car 17).
  - On sets of 5–6 laps, 3 of 4 boxed (Spa cars 6, 12 and 13, back to softs).
  - The AI boxes under an SC when it still has a stop ahead, not only when the compound rule demands one.
  - This explains the spec's "16 of 18 owed" for Spa: by the compound rule only 13 owed, and 16 boxed in all.
  - It is a modelling note for the supervisor, not a contract gap: the rule `q`/`aMin` applied to "a rival with a stop still ahead" (`rival-stops`) would fit Spa better than "owes the compound rule". **Thin:** 4 cases.
- **Wet SC (Miami lap 3):** 9 of 19 AI cars switched from wets to inters. That is a type change, not the compound rule (wet tyres waive it).

**Under a VSC:** 4 VSCs and 71 AI car-cases.

- Zandvoort's VSC lasted 10 s, with 16 owing cars; 0 boxed.
- Mexico's VSC (81 s, 17 cars) is wet, so no car owed the rule; 0 boxed.
- Miami's two VSCs (wet, 18–19 cars) saw 1 stop: car 6 at lap 13, inter to inter after front-wing damage (100 %), with 8.5 s stationary. That is a repair.
- **No AI car made a strategic stop under any VSC.** This confirms research 12 §6, Mexico included. There is no long dry VSC with owing cars, so it remains untested for a dry VSC.

**Reaction at the wet crossovers** (AI, per crossover):

| Crossover | AI switches | Switch laps | Against the type falling behind |
|---|---|---|---|
| Singapore drying, inter → slick | 19 | lap 4 ×13, lap 5 ×5, lap 6 ×1 | slicks ahead by lap 6 (1.3 s/lap); crossing about lap 5 ±1 → reaction −1 to 0 laps |
| Singapore rain returns, slick → inter | 17 | all at lap 25 | the slicks were still at +1.2 s (lap 24) and the inters at +12.6 s at lap 27: a pre-emptive switch on the forecast (rain 38 → 50 %), at least 1 lap before the slick fell behind |
| Mexico, wet → inter | 18 | lap 4 ×16, lap 5 ×2 | no overlap (all switched at once); inters about 0.5 s faster than wets right after |
| Miami, wet → inter (green) | 1 (lap 11) | — | inters ran level with or faster than wets from lap 15 (sector trends, 0.5–1 s); the 8 cars still on wets did not switch in the 6 laps left |
| Miami under the SC | 9 of 19 | lap 2–3 | "at once under an SC" |

The field switches in unison, within one lap of the crossover or before it, and never later where the crossing is seen. Where the gap stayed under about 1 s with 6 laps left (Miami), the AI did not switch.

| Value | Current | Measured | Counts | Recommendation |
|---|---|---|---|---|
| `rivalScBoxChance` (q) | 0.9 (placeholder) | **0.875** (28 / 32), SE 0.045 (events) / 0.058 (cars) | 32 owing cars, 3 SCs, 3 races. **Thin** in events | **replace: 0.88**, "spike 4.3b-defaults (research 19 §5): 28 of 32 AI cars owing a stop boxed under 3 SCs (Zandvoort, Texas, Spa), SE 0.05; thin" |
| `rivalScMinTyreAge` (aMin) | 6 (placeholder) | **4** (the youngest owing boxer; nothing younger seen; met-rule cars of 0–2 laps never boxed, 0 of 12) | 32 owing + 16 met-rule cars, 3 SCs. **Thin** | **replace: 4**, "spike 4.3b-defaults (research 19 §5): youngest AI car owing a stop that boxed under an SC (3 SCs); no younger owing car seen; thin" |
| VSC rule (never box) | never | 0 strategic stops | 71 AI car-cases, 4 VSCs, 3 races (16 owing, all in a 10 s VSC) | **keep** (never), "spike 4.3b-defaults (research 19 §5): no strategic AI stop under 4 VSCs incl. Mexico's; dry long VSC unseen" |
| `rivalReactionLaps` | 1 (placeholder) | **0** (−1 to 0 where seen; pre-emptive once) | 3 field crossovers, 54 AI switches, 2 races (plus Miami's 1). **Thin** in crossovers | **replace: 0**, "spike 4.3b-defaults (research 19 §5): AI switched within one lap of the crossover or before it at 3 crossovers (54 switches, Singapore and Mexico); thin" |

## 6. What could not be measured

- **`interMsPerWetnessMs` (sI):** inters and slicks never ran on the same track at two different wetnesses. The three wet replacements in §4 depend on 0.5.
- **The convex term on dry slicks:** no stint passed 50 % wear.
- **VSC wear and the dry VSC:**
  - Every VSC was short (10–81 s) and wet, so the wear factor rests on partial laps and whole-percent wear.
  - A dry VSC's pace factor is likely higher than 1.19 (compare the SCs: dry 1.28, wet 1.21).
- **`aMin` below 4:** no owing car on a younger set met an SC.
- **The exact crossing lap:** only Singapore's drying shows one, with 2 overlapping inter samples.
- **The AI's switch rule:**
  - The pre-emptive switch on the rain forecast (Singapore lap 25) is not something a lap-time crossover rule can produce.
  - Neither is Miami's non-switch at a small gap late in the race.
- **Human cars:** too few laps under neutralisation or past 40 % to fit them apart from the AI.


---

# Pass curve: the refit with DRS (SP4.3b1 Task 13, spec F5)

Throwaway spike, branch `spike/4.3b-pass-fit` (from `sp4.3b/integ` with Task 10's fit), commit 5f37b4ea, worktree `../pitwall-wt/spike-4.3b-pass-fit`. Code: `spike/extract.ts` (the current engine over each recording, as `scan-situations`, realism off), `spike/filter.ts` (spec 5.5 session filter, 9 tests pass), `spike/pass-refit.ts`; output `spike/out/pass-refit.json`.

## Method

- Episodes: `followingEpisodes` on the cut projection (simulated end or our retirement), DRS zones **included** (relative DRS, from lap 3, 1 s).
- Model per braking zone: `p = wet? · cap · σ(level + slope·adv + drsFactor·[DRS])`. (level, slope, DRS factor) by `fitPassCurve` with shrinkage 0, alternating with a 1-D maximisation of the wet factor (golden section) until stable. Cap fixed at 0.6; profile likelihood reported.
- Errors: Fisher (numeric Hessian of the log-likelihood) and a race bootstrap (300 reps, seed 19).
- Sets: **strict** = spec 5.5 filter (Mexico, Miami, Texas, China) plus Spa; **relaxed** = also Singapore and Zandvoort (no classification needed).
- Held-out: leave one race out. Every one of the 7 races is predicted by a fit on each set without it, so both sets are scored on the same zones. Log-loss is the mean per zone; Brier; calibration table of predicted vs observed passes by predicted-p bin. Yardstick: one constant pass rate fitted on the training races.

## Per race

| Race | Recording | AI | Laps | Set | Episodes | Zones | Passes | DRS episodes | DRS zones | DRS passes | Wet zones |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Mexico | 2026-10-30_15-20-41 | 62 | 71 | strict | 148 | 404 | 14 | 83 | 112 | 9 | 404 |
| Miami | 2026-10-30_18-53-00 | 62 | 20 | strict | 83 | 218 | 19 | 11 | 12 | 3 | 218 |
| Texas | 2026-11-05_00-13-26_car19 | 65 | 20 | strict | 94 | 334 | 20 | 9 | 11 | 2 | 0 |
| China | 2026-11-02_15-17-14 | 90 | 10 | strict | 37 | 109 | 17 | 4 | 8 | 4 | 0 |
| Spa | 2026-11-12_02-21-24 | 90 | 44 | strict | 122 | 596 | 48 | 42 | 69 | 22 | 0 |
| Singapore | 2026-10-29_00-04-08 | 90 | 44 | relaxed only | 94 | 430 | 17 | 33 | 73 | 11 | 48 |
| Zandvoort | 2026-10-29_23-00-37 | 70 | 14 | relaxed only | 39 | 280 | 10 | 12 | 20 | 6 | 0 |
| **Strict (5)** | | 62–90 | | | **484** | **1,661** | **118** | **149** | **212** | **40** | 622 (33 passes) |
| **Relaxed (7)** | | 62–90 | | | **617** | **2,371** | **145** | **194** | **305** | **57** | 670 (33 passes) |

Singapore and Zandvoort still fail the classification rule (no FinalClassification, no chequered flag).

## Fits (cap 0.6; Fisher SE, bootstrap SE in brackets)

| Set | Level | Slope per s | DRS factor (odds ×) | Wet factor | p dry at 0 / 0.5 / 1 / 2 s | with DRS |
|---|---|---|---|---|---|---|
| **Strict** | **−2.629 ± 0.19 (0.40)** | **1.044 ± 0.26 (0.40)** | **1.917 ± 0.30 (0.37), ×6.8** | **0.46 ± 0.09 (0.24)** | 4.0 / 6.5 / 10.2 / 22.1 % | 19.8 / 27.2 / 35.0 / 47.9 % |
| Relaxed | −2.763 ± 0.16 (0.26) | 0.558 ± 0.18 (0.33) | 1.951 ± 0.23 (0.32), ×7.0 | 0.60 ± 0.12 (0.36) | 3.6 / 4.6 / 6.0 / 9.7 % | 18.4 / 22.2 / 26.2 / 34.5 % |
| Strict, dry only (3 races, 1,039 zones, 85 passes, 88 DRS zones) | −2.614 | 0.895 | 2.271, ×9.7 | — | 4.1 / 6.2 / 9.1 / 18.3 % | |
| Relaxed, dry only (5 races, 1,701 zones, 112 passes, 180 DRS zones) | −2.748 | 0.398 | 2.204, ×9.1 | — | 3.6 / 4.3 / 5.2 / 7.5 % | |

- DRS is now clearly identified (≥ 5 SE from 0 in both sets) and much larger than the config's prior 1.2 (×3.3).
- Slope: strict 1.04 per s is ~2.6 bootstrap SE from 0 (research 15: 0.56, within 1.5 SE); relaxed halves it.
- Wet factor: all wet zones but 48 are Mexico and Miami (whole races wet), so it is confounded with those two tracks; **thin**.
- Cap profile (log-likelihood): strict −397.1 / −393.6 / −391.9 / −390.9 / −390.2 / −389.5 / −389.1 at cap 0.2 / 0.3 / 0.4 / 0.5 / 0.6 / 0.8 / 1.0; relaxed flat (−500.4 to −497.7). Caps from 0.4 up are not separable; 0.6 stays assumed.

## Held-out comparison (leave one race out, same zones for both)

| Scored on | Zones | Strict set: log-loss / Brier / predicted vs observed | Relaxed set: log-loss / Brier / predicted vs observed | Constant rate (strict / relaxed) |
|---|---|---|---|---|
| The 5 strict races | 1,661 | **0.2500** / 0.0646 / 136.0 vs 118 | 0.2556 / 0.0658 / 104.2 vs 118 | 0.2591 / 0.2594 |
| All 7 races | 2,371 | **0.2239** / 0.0573 / 205.7 vs 145 | 0.2257 / 0.0578 / 165.2 vs 145 | 0.2329 / 0.2323 |
| Singapore + Zandvoort | 710 | 0.1629 / 0.0402 / 69.7 vs 27 | **0.1556** / 0.0392 / 61.0 vs 27 | |

Per race (held-out log-loss; predicted vs observed passes):

| Race | Strict set | Relaxed set |
|---|---|---|
| Mexico | 0.1773; 43.6 vs 14 | 0.1795; 44.0 vs 14 |
| Miami | 0.3253; 7.1 vs 19 | 0.3449; 4.8 vs 19 |
| Texas | 0.2222; 23.7 vs 20 | 0.2233; 15.8 vs 20 |
| China | 0.4613; 11.0 vs 17 | 0.4807; 6.8 vs 17 |
| Spa | 0.2486; 50.5 vs 48 | 0.2515; 32.8 vs 48 |
| Singapore | 0.1663; 42.7 vs 17 | 0.1593; 37.6 vs 17 |
| Zandvoort | 0.1577; 27.0 vs 10 | 0.1499; 23.4 vs 10 |

Calibration (predicted vs observed passes by held-out predicted p), on the 5 strict races:

| Bin | Strict: zones, predicted, observed | Relaxed: zones, predicted, observed |
|---|---|---|
| 0–3 % | 138, 2.1, 9 | 196, 3.3, 15 |
| 3–6 % | 697, 33.9, 35 | 1,195, 50.2, 56 |
| 6–10 % | 548, 41.3, 24 | 62, 4.1, 7 |
| 10–15 % | 57, 7.3, 11 | 27, 3.6, 7 |
| 15–25 % | 154, 31.9, 24 | 70, 13.1, 22 |
| 25–100 % | 67, 19.5, 15 | 111, 30.0, 11 |

On all 7 races: strict 170/2.8/9, 1,007/48.5/37, 749/54.6/27, 108/13.7/14, 205/43.2/31, 132/42.9/27; relaxed 228/4.1/15, 1,686/72.0/60, 132/9.2/11, 35/4.7/7, 121/24.7/30, 169/50.5/22.

Reading: the strict set has the smaller held-out error on the strict races (−0.0056) and on all seven (−0.0018); admitting Singapore and Zandvoort only helps on those two themselves (−0.0073). Both curves beat a constant rate by only 3–4 % log-loss: race-to-race spread dominates (Mexico, Singapore and Zandvoort pass far less than predicted, Miami and China far more). Both sets over-predict the 25–100 % bin (DRS at large advantage). **Thin** at the race level (5 or 7 races).

## Recommendation

Keep the spec 5.5 classification rule (strict set: Mexico, Miami, Texas, China, Spa). Config literals for `race-interaction/config.ts`:

- `passLevel: -2.629` — Source: pooled fit over 5 F1 25 races (Mexico, Miami, Texas, China, Spa; AI difficulty 62–90; 484 following episodes, 1,661 braking zones, 118 passes), research 19; one curve for both bands; Fisher SE 0.19, race bootstrap 0.40.
- `passSlopePerMs: 0.001044` — Source: same fit (5 races, 484 episodes, 1,661 zones, 118 passes), research 19; Fisher SE 0.00026, bootstrap 0.00040.
- `drsPassFactor: 1.917` — Source: same joint fit, DRS zones in (149 DRS episodes, 212 DRS zones, 40 passes), research 19; odds ×6.8; Fisher SE 0.30, bootstrap 0.37.
- `wetFactor: 0.46` — Source: same joint fit, Mexico and Miami (622 wet zones, 33 passes), research 19; Fisher SE 0.09, bootstrap 0.24, thin.
- `passCap: 0.6` — unchanged, assumed: the profile likelihood cannot separate caps from 0.4 to 1.0 (research 19).

Held-out (leave one race out) log-loss: strict 0.2500 on the 5 strict races (0.2239 on all 7) vs relaxed 0.2556 (0.2257).


---

# Research 19 addendum: the fresh tyre set against the lap model (SP4.3b1 Task 11, cause 4)

Spike, 2026-11-12, branch `spike/4.3b-defaults` (never merged), with `sp4.3b/integ` merged in first, so the current `forecast-field`, `degradation` and `lap-model` code is used. Code in the worktree `../pitwall-wt/spike-4.3b-defaults`:

- `spike/capture.ts` runs a recording through the bridge pipeline (`recordingPipeline`, the default config, an empty data dir, no priors) and keeps the forecast-score job's last prepared input: the projection, the situation, the config and the track. Spa and Texas reuse the Task 11 captures; China and Zandvoort were captured here.
- `spike/freshset.ts` takes each AI green dry stop. At the frame that completes the in-lap, it builds the strategy's own starting point (`runAsOf(FORECAST_UNITS)` → `buildStartingPoint`). It then predicts every lap of the new set (lap on set 1 = the out-lap) and the old set's last three clean laps with `lapTimeMs`. The predictions use the car's `paceMs` and `degMsPerLap`, the fitted compound offsets and the cold-tyre terms as built. Each lap's **actual** start wear and fuel go in (the out-lap at wear 0), so only pace, degradation, offsets and the cold terms are tested. The same is done with the old stint's (α, ν) refitted by the same Kalman filter under other priors and settings, and with a plain OLS on wear.
- `spike/freshset-summary.ts` pools the rows; `spike/freshset-print.py` prints them. The rows are in `spike/out/freshset-<race>.jsonl` and the pooled numbers in `spike/out/freshset.json`.

**Labels.** Residual = actual − predicted, in ms. A mean is shown as mean ± SE (n laps). **Free air** is `freeAirLaps` at 1500 ms (the driver-noise and track-wetness rule). **All green** means green, valid laps, not an in-lap, traffic included. **Thin** marks fewer than about 30 laps or cases.

**Data.** 53 stops: Spa 34, Texas 17, China 1, Zandvoort 1. That is every dry race recording. Singapore has no slick-to-slick stop (0 of 38), and Mexico and Miami are wet, so they were not used. Every stint started from the config default ν prior: `degradation.defaultNuMsPerLap` 60 ± `defaultNuSdMs` 60 ms per lap of age, with no calibration. In practice the result is **Spa plus Texas**, mostly Spa, and mostly soft and medium; hard is not identified.

## 1. The fresh-set profile

Lap on set, the residual as the strategy builds the model. The cold terms in this build are lap 1 +410 and lap 2 +100.

| Lap on set | 1 (out-lap) | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| free air | n/a | −775 ± 231 (10) | −403 ± 236 (10) | −447 ± 186 (12) | −317 ± 152 (13) | −241 ± 152 (13) | −28 ± 140 (13) | +40 ± 134 (15) |
| all green | +15563 ± 496 (47) ¹ | −453 ± 148 (40) | −397 ± 167 (36) | −152 ± 154 (38) | −127 ± 138 (44) | +4 ± 138 (46) | +131 ± 130 (44) | +222 ± 121 (41) |
| all green, without the cold terms | +15973 | −353 ± 148 | (same from lap 3 on) | | | | | |
| Spa only, all green | +13713 (34) | −489 ± 151 (33) | −527 ± 162 (33) | −302 ± 153 (33) | −340 ± 133 (33) | −215 ± 114 (34) | −133 ± 122 (29) | +103 ± 127 (26) |
| Texas only, all green | +20109 (12) | −235 ± 572 (6) | +1026 ± 275 (3) | +839 ± 381 (5) | +511 ± 319 (11) | +624 ± 375 (12) | +641 ± 258 (15) | +430 ± 244 (15) |
| old set's last 3 clean laps (control) | | | | | | | | free air +53 ± 61 (40); all green +251 ± 86 (158) |

¹ The out-lap holds the out-lap share of the pit loss. It runs +3362 ± 355 ms (47) above `(1 − inLapLossShare) · green loss`, which is Task 11 causes 2 and 3 (Spa's 12.6 s green prior; Texas charges almost nothing on the in-lap). **So `coldTyreLap1Ms` cannot be identified from these data**, and it is kept.

Spa reproduces Task 11's profile: −0.49, −0.53, −0.30, −0.34 and −0.22 s on laps 2 to 6. Texas is **thin** and runs the other way from lap 3 on (n 3–15).

By compound on the new set, all green: soft lap 2 −583 ± 249 (15), medium −376 ± 186 (25). Hard has no lap 2 or 3 (n 0).

## 2. The stop gain

The actual step is the mean fuel-corrected time on new-set laps 3–5 minus the old set's last three clean laps. The model's step is ν/rate × the wear difference + the offset difference, with the actual wear and fuel. Gap = actual − model, which equals the mean new-set residual minus the mean old-set residual.

| Old stint's (α, ν) | Gap, all green, 38 stops (Spa 33, Texas 5) | Gap, free air, 12 stops (**thin**) | ms per % wear (53 stints) |
|---|---|---|---|
| as built (prior 60 ± 60 ms/lap) | **−450 ± 124** (actual −943 ± 130, model −493 ± 91) | **−446 ± 94** (actual −1297, model −852) | **34 ± 3** |
| refit on free-air laps only | −631 ± 205 (14) | −833 ± 179 (8) | 29 ± 3 (19) |
| no slow-lap down-weighting | −434 ± 126 | −425 ± 100 | 37 ± 3 |
| no α drift | −447 ± 124 | −440 ± 94 | 34 ± 3 |
| prior sd 150 | −271 ± 146 | −38 ± 134 | 45 ± 5 |
| prior sd 300 | −252 ± 155 | +72 ± 147 | 49 ± 6 |
| prior 120 ± 120 | −244 ± 141 | −49 ± 129 | 47 ± 4 |
| **prior 150 ± 100** | **−215 ± 136** | **−66 ± 125** | **50 ± 4** |
| prior 180 ± 120 | −189 ± 141 | +4 ± 132 | 52 ± 4 |
| OLS on wear (no prior) | −166 ± 140 | +218 ± 127 | 51 ± 6 |

**Cause.** ν is biased low. The cause is the **prior**, not the traffic.

- Each stint has 6–11 pace laps at an observation sd of 400 ms. Against that, the default ν prior of 60 ± 60 ms/lap pulls ν down to 126 ms/lap on soft (OLS × rate gives 205 ± 26, prior sd 300 gives 191 ± 22) and 92 on medium (122 ± 28).
- The model's degradation per % is 34 ms/%, against the stints' own OLS slope of 51. The ratio OLS/model is 1.47 ± 0.11 (46).
- The filter's other rules barely matter: the down-weighting of slow outliers changes the gap by ~20 ms, the α drift by ~0.
- Fitting on free-air laps only makes the gap worse (−631). The DRS trains are not what flattens ν through the filter: they shrink the fit to so few laps that the prior dominates even more.

**The DRS trains do leave a second, smaller gap.** All green, the stop gain splits by the old stint's share of free-air pace laps:

| Old stint | Actual | Gap as built | Gap, prior 150 ± 100 |
|---|---|---|---|
| free-air share ≥ 0.25 (13) | −1069 ± 236 | −301 ± 178 | **+7 ± 201** |
| free-air share < 0.25 (25) | −877 ± 157 | −528 ± 165 | **−330 ± 177** |

Spa car 7's first stint is one of these: 0 free laps of 8, OLS 13 ms/%, so the observed first stint is genuinely flat. There the gain at the stop is release from the train. The car's α is the train's pace, not its free pace, and no prior fixes that. This is about 1.9 SE, **thin**.

**No missing fresh-set term is identified.**

- The exponential `A·e^{−(j−2)/τ} + B` on the as-built residuals runs τ to the bound (6 laps; A −970 ± 291, B +526). That is a slow linear drift, the signature of a slope bias, not a peak.
- After the prior change (150 ± 100) it is A −594 ± 283 (all green, 289 laps, 35 cars), again with τ at the bound. On free air (86 laps) it is A −597 ± 365, τ not identified.

## 3. What is left on the first laps after the prior change

Prior 150 ± 100, residuals without the cold terms, against the old set's control:

| Lap on set | 2 | 3 | 4 | 5 | 6 | 7 | 8 | old-set control |
|---|---|---|---|---|---|---|---|---|
| all green | −172 ± 156 (40) | −257 ± 171 (36) | −50 ± 157 (38) | −68 ± 136 (44) | +28 ± 137 (46) | +114 ± 130 (44) | +160 ± 121 (41) | +76 ± 84 (158) |
| free air (**thin**) | −475 ± 261 (10) | −159 ± 251 (10) | −254 ± 198 (12) | −185 ± 153 (13) | −186 ± 155 (13) | −28 ± 151 (13) | −9 ± 141 (15) | −160 ± 66 (40) |
| all green, to soft | −330 ± 256 (15) | −369 ± 343 (13) | +310 ± 286 (16) | +6 ± 270 (16) | −127 ± 172 (16) | | | |
| all green, to medium | −78 ± 197 (25) | −193 ± 190 (23) | −372 ± 157 (20) | −294 ± 161 (22) | +56 ± 237 (24) | | | |

The free-air laps run about −160 below the fit on either set: a fit on all laps includes traffic. Relative to the control, lap 2 is −250 to −315 and lap 3 is −330 to 0. Both are within about 1.5 SE of zero. The configured +100 on lap 2 is +250 to +400 the wrong way, about 1.7 SE. A negative lap-2 term (a fresh-set peak) is suggested, but it is not established.

**The prior's effect early in a stint.** Fit the first k pace laps of a stint, then predict its next up-to-5 pace laps (1,100 predictions):

| Prior | k 2–3: bias / mean abs | k 4–5 | k 6–8 | k 9–20 |
|---|---|---|---|---|
| 60 ± 60 (now) | +467 / 797 | +639 / 803 | +589 / 668 | +283 / 551 |
| 60 ± 300 | +392 / 892 | +395 / 875 | +246 / 578 | +14 / 487 |
| **150 ± 100** | **+151 / 678** | **+308 / 613** | **+237 / 458** | **+34 / 459** |
| 150 ± 60 | +137 / 682 | +296 / 608 | +270 / 450 | +72 / 458 |
| 180 ± 120 | +54 / 665 | +222 / 612 | +183 / 461 | +3 / 459 |

A wide sd alone makes the early laps noisier: mean abs at k 2–3 rises 797 → 892. Moving the prior's mean helps at every k.

## 4. Recommendation

1. **The smallest change that removes most of the bias** is the `degradation` ν prior. It is two literals in `packages/analysis/src/degradation/config.ts`:
   - `defaultNuMsPerLap` 60 → **150**, source string: "spike 4.3b-defaults (research 19 §5): soft ~190–205, medium ~120 ms/lap at Spa and Texas (53 stints); 60 shrank ν to 0.67× the stints' own slope; thin: two tracks, no hard"
   - `defaultNuSdMs` 60 → **100**, source string: "spike 4.3b-defaults (research 19 §5): with mean 150, the stop-gain gap −450 → −215 ± 136 ms (38 stops), free air −446 → −66 ± 125 (12); later-lap bias at k 6–8 589 → 237 ms"

   Effects:
   - The stop-gain gap drops from −450 ± 124 to −215 ± 136 (all green, 38 stops) and from −446 ± 94 to −66 ± 125 (free air, 12 stops).
   - On stints not held in a train, the gap goes from −301 to +7 ± 201 (13).
   - Degradation becomes 50 ± 4 ms/%, against the stints' OLS slope of 51 ± 6.
   - Within a stint, forecasts improve at every k: mean abs at k 6–8 668 → 458 ms.

   Because the prior is per lap of age and soft wears faster than medium, a single value is a compromise; a per-compound or per-% wear prior would fit better. That is a code change and is not needed for this bias. Other readers of degradation's ν (tyre-life, pit-window, strategy) move with it. Calibration priors, when present, replace it.

2. **`coldTyreLap2Ms` 100 → 0**, source string: "spike 4.3b-defaults (research 19 §5): lap 2 on a new set −170 ± 156 ms (all green, 40), −475 ± 261 (free air, 10) without the term, after the ν prior change; a fresh-set peak not identified; thin". The lap-2 term's sign is contradicted by every subset, but its negative size is within 1.5 SE of 0, so a negative literal or a fresh-set term is not justified on these data. Re-check it with more dry races.

3. **Keep `coldTyreLap1Ms` 410.** It is not identifiable here: the out-lap is confounded with the pit-loss share (+3.4 s, causes 2 and 3).

4. **Not recommended now: an exponential fresh-set term** with fitted amplitude and decay. τ is not identified in any variant (it sits at the 6-lap bound).

5. **Not recommended now: fitting degradation on free-air laps only.** It makes the bias worse (−631 ± 205, 14), because it leaves the prior to dominate.

6. **Left open (thin, about 1.9 SE): the train-release gap**, −330 ± 177 on the 25 stops whose old stint had under 25 % free-air pace laps. The fix would be a code change in `forecast-field`'s pace stand-in: take a car's `paceMs` from its free-air laps, or the α a free-air-only refit gives, when its stint was mostly held. Re-score the undercut cases first (Task 11 causes 1, 2 and 4 together) before deciding.

Thin overall: two tracks carry the result (Spa 34 stops, Texas 17), Texas's new-set laps 3–8 run the other way (n 3–15), and hard has no data. Not re-scored: the undercut and rejoin cases of forecast-score under the new prior. That needs the Task 11 trace scripts (`t11/fresh.ts`, `rf-fixed.ts`), and it is the next check.


---

# Research 19 addendum: the Monte Carlo's wetness dynamics (Task 19b check)

Spike branch `spike/4.3b-defaults` (worktree `pitwall-wt/spike-4.3b-defaults`), never merged. Code: `spike/weather-scan.ts`,
`spike/wetness-capture.ts`, `spike/wetness-fit.ts`. Outputs: `spike/out/wetness/` (`*.weather.json` per recording,
`{singapore,miami,mexico}.tw.json`, `fit.json`).

## Data

- **Weather (all 15 recordings, protocol only, no engine):** per Session packet the weather (a value), the offset-0
  forecast sample's rain % (the rain now), every distinct forecast (this session's samples, as step 1 keeps them) and
  `forecastAccuracy`, stamped with session time and the leader's lap (LapData).
- **Rain at all:** only the three races Singapore (2026-10-29_00-04-08), Mexico (2026-10-30_15-20-41) and Miami
  (2026-10-30_18-53-00). Every other session (practice, qualifying, dry races) stays at clear / light cloud / overcast,
  rain % at most 19. Only Singapore changes between rain and dry. Mexico (storm, 91–94 %) and Miami (storm, 93 %)
  hold one state all race.
- **`forecastAccuracy` is `perfect` on every Session packet of every recording.** There is no approximate forecast.
- **track-wetness's state per lap:** each recording run through the bridge pipeline (`recordingPipeline`, every job a
  no-op), track-wetness's output recorded at each of its runs (one per completed lap), with the live weather at that frame.
- **Wetness on the model's scale** (the slick's loss, ms): per leader lap, the AI field's median fuel-corrected excess per
  tyre type (30 ms/kg) against a dry reference, mapped through the lap model's wet terms (forecast-field config):
  - slick: w = e;
  - inter: w = (e − 3,500) / 0.5;
  - wet: w = (e − 8,100) / 0.25.

  Clean laps only: no SC or VSC share, not lap 1, no in-lap or out-lap, valid. The dry references are as in research 19 §4:
  - Singapore: each car's median slick lap over laps 8–22 (light cloud, rain % 6–16, no rain).
  - Miami: each car's best slick lap in the same-day practice. The practice best lies below a race lap, so Miami's w is
    biased high by perhaps 0.5–1.5 s.

  Mexico has no dry reference.
- **SE:** cluster bootstrap over cars, 1,000 reps (400 per lap in the tables). It covers the car-to-car spread only. The
  systematic errors are larger: the inter/wet scale constants (3,500 / 0.5, 8,100 / 0.25, themselves thin), the dry
  reference, and **one event per value**. Every value below is **thin**: one recording, one event.

## What the game does (Singapore, the one race with changes)

| Leader lap | Weather | Rain % | w (ms) ± SE | Tyre | track-wetness state |
|---|---|---|---|---|---|
| 2 | lightRain | 89 | 12,927 ± 197 | inter (18) | 0 |
| 3 | lightRain | 89 | 11,999 ± 254 | inter (18) | −10 |
| 4 | lightRain | 77 | 8,470 ± 114 | inter (6) | −870 |
| 5 | lightRain → overcast at 60 % | 60 | stops | | −379 |
| 6 | overcast | 42 | 1,612 ± 343 | slick (12) | −379 |
| 7 | overcast | 26 | −418 ± 236 | slick (17) | −159 |
| 8–24 | overcast / lightCloud | 6–19 | −950 … +1,170 (tyre degradation, not removed) | slick | −23 … 550 |
| 25 | overcast | 19 | stops | | 125 |
| 26 | overcast → lightRain at 25 % | 30 | stops | | 125 |
| 27 | lightRain | 43 | 18,171 ± 239 | inter (17) | 41 |
| 28 | lightRain | 55 | 18,848 ± 193 | inter | 280 |
| 29 | lightRain | 66 | 19,611 ± 251 | inter | 194 |
| 30 | lightRain | 74 | 19,864 ± 303 | inter | −190 |
| 31 | lightRain | 74 | 20,182 ± 222 (peak) | inter | −29 |
| 32 | lightRain | 74 | 20,028 ± 278 | inter | 78 |
| 33 | lightRain | 75 | 18,947 ± 341 | inter | −184 |
| 34 | lightRain | 77 | 16,515 ± 433 | inter | −841 |
| 35 | lightRain | 79 | 14,398 ± 198 | inter | −1,352 |
| 36–40 | lightRain | 80–88 | 14,084 … 14,642 | inter | −1,226 … −230 |
| 41–44 | storm (from 88 %) | 90–91 | 14,784 … 15,081 | inter | −162 … 109 |

Miami (storm, 93 %, every lap): w falls from 25,545 ± 662 (lap 5, the first green lap) to 16,504 ± 950 (lap 20). The
slope is −392 ± 45 ms per lap over laps 5–20. The mean over laps 15–20 is 18,099 ± 699. Over the same laps
track-wetness's state reads 0 to 885.

Mexico (storm, 91–94 %, every lap; every AI car stops once, wet → inter at lap 4–5, then one 67-lap inter stint): the
field's inter pace against its own median is flat after lap 9, within ±0.5 s until degradation shows from lap ~47.
Slopes in inter ms per lap: laps 6–20 −42 ± 12, laps 20–71 +21 ± 3. Inter degradation pushes these upward, so a −slope
is the most drying the track can have done. Under a steady storm the track holds one level, apart from about 0.7 s of
inter (1.4 s of w) gained over laps 6–9.

Five findings:

1. **Wetness is no integrator of rain laps.** It tracks the rain intensity with a lag of about 1–2 laps, overshoots, and
   then settles. Under steady rain it settles at a level: Singapore 14.4–14.9 s at 80–91 %, Miami about 18 s at 93 %
   and still falling, Mexico flat. A longer rain does not make the track wetter.
2. **Drying starts while it still rains:** −2.2 s per lap over laps 2–4 under lightRain, as the rain % falls 89 → 70.
3. **Rain % is an intensity, not a per-lap chance of rain.** The weather is lightRain from 25 % rising and until 60 %
   falling, and storm from 88 %. The MC instead reads rain % as a per-lap chance (`uniform < rainPct`). At 75–93 % that
   draw is nearly always rain, so the MC pins the wetness at its ceiling.
4. **track-wetness's state is not on a dry scale.** Each stint's common mode is measured against the stint's own first
   free-air laps. A stint that starts wet therefore reads as dry:
   - Miami: ≤ 0.9 s on a track at w 17–26 s;
   - Mexico: −0.4 to +1.0 s over 71 laps of storm at 91–94 % (no dry reference to put w on);
   - Singapore: −1.4 to +0.3 s from lap 27 at w 14–20 s.

   The MC starts its rain timeline from this state
   (`start.wetness.wetnessMs`). On a wet start or after a type change it starts about 15–25 s too dry, and then climbs
   2.5 s per rain lap. **This error is larger than any of the constants below.** It is a code issue in track-wetness, not
   a literal.
5. **A perfect forecast is exact:**
   - 872 Singapore forecasts, the shift that best lines each one up with the rain % that came: 0.01 laps (sd 0.07).
     Mean error at zero shift: 0.1 %.
   - Mexico (11 forecasts): 0.14 laps (sd 0.21). Miami (3): 0.
   - Its timing error in laps comes only from the sample grid: 5 min (about 2.8 laps) up to 15 min ahead, then 15 and
     30 min. Read as `rainPctAt`'s nearest sample, the first sample with the new state lies after the real change:
     - drying at 483 s: +1.65 laps mean (214 forecasts, 0 to 2.8);
     - rain at 2,549 s: +3.0 mean, median 2.2 (429 forecasts, 0 to 8.4).

   Interpolating linearly between samples would remove most of it. That is a code change in forecast-field's mapping.

## The fits

Each fit is one event, so all are **thin**.

- **Rise per rain lap.** From lap 24 (slick, w 1,169) to lap 27 (inter, w 18,171). The rain started at the start of
  lap 26 (lightRain at 2,549 s; lap 26 starts at 2,538 s).
  - Over 2 rain laps (26, 27): **8,501 ± 109 ms/lap** (band 8,321–8,664).
  - Counting lap 25, when the rain % was already rising: 5,667 ± 73.
  - Afterwards only +504 ± 62 per lap up to the peak (laps 27–31). The rise is a step, not a slope.
- **Fall per dry lap.** The start dries: lap 3 inter w 11,999 → lap 7 slick w −418.
  - Over 4 laps: **3,104 ± 106 ms/lap**.
  - Lap 4 → lap 6: 3,429 ± 175.
  - Slick only, lap 6 → 7, near the floor: 2,030 ± 278.
  - This rests on the inter scale (3,500 / 0.5).
- **Ceiling, the level under sustained heavy rain:**
  - Singapore laps 36–40 (lightRain 81–88 %): 14,390 ± 166.
  - Singapore laps 41–44 (storm): 14,887 ± 154.
  - Miami laps 15–20 (storm): 18,099 ± 699, biased high by the practice reference.
  - Peaks: Singapore 20,182 ± 215 (lap 31, 5 laps after the onset); Miami 25,598 ± 825 (lap 5, the race started in
    the storm).

  In the MC the ceiling is the level a rain spell holds: at rain % 75–93 the per-lap draw rains on nearly every lap.
  So it should be the settled level, not the peak.
- **Approximate forecast's timing sd:** not measurable. No recording has an approximate forecast (all 15 are
  `perfect`). A perfect one is exact (shift 0.01 ± 0.07 laps, n = 872). The current 2 laps cannot be checked.

## Recommendation table

| Value | Current | Measured | Counts | Recommendation (literal and source) |
|---|---|---|---|---|
| `WETNESS_RISE_MS_PER_LAP` | 2,500 | 8,501 ± 109 ms/lap over the 2 onset laps (5,667 ± 73 counting lap 25); then +504 ± 62/lap to the peak | 1 onset (Singapore laps 24 → 27), 17 cars; **thin** | **`8_500`**, source: "spike 4.3b-defaults (research 19 wetness): Singapore's rain onset, slick lap 24 to inter lap 27, w +17.0 s over 2 rain laps: 8,501 ± 109 ms/lap (17 cars; 5,667 if lap 25 counts); one onset, thin; the inter scale (3,500 / 0.5) is assumed" |
| `WETNESS_FALL_MS_PER_LAP` | 1,000 | 3,104 ± 106 ms/lap (lap 3 → 7); 3,429 ± 175 (lap 4 → 6); 2,030 ± 278 slick only near the floor; −2,229 ± 248/lap already while lightRain fades (laps 2–4) | 1 drying (Singapore laps 2–7), 6–18 cars per lap; **thin** | **`3_000`**, source: "spike 4.3b-defaults (research 19 wetness): Singapore's drying start, inter lap 3 (w 12.0 s) to slick lap 7 (w −0.4 s): 3,104 ± 106 ms/lap (18 cars); one drying, thin; the inter scale is assumed" |
| `WETNESS_MAX_MS` | 25,000 | settled level under heavy rain: 14,390 ± 166 (Singapore lightRain 81–88 %), 14,887 ± 154 (Singapore storm), 18,099 ± 699 (Miami storm, biased high); peaks 20,182 (Singapore) and 25,598 (Miami race start) | 3 rain spells, 2 races (Mexico: no dry reference, but flat under storm); **thin** | **`16_000`**, source: "spike 4.3b-defaults (research 19 wetness): the level a heavy rain settles at: Singapore 14.4–14.9 s (laps 36–44, 17 cars), Miami 18.1 ± 0.7 s (laps 15–20, practice reference, biased high); peaks of 20–26 s fade within 3–10 laps; thin" |
| `APPROXIMATE_SHIFT_SD_LAPS` | 2 | not measurable: every Session packet of all 15 recordings has accuracy `perfect`; a perfect forecast is exact (best shift 0.01 ± 0.07 laps, 872 forecasts; Mexico 0.14 ± 0.21, 11) | 0 approximate | **keep `2`**, source unchanged and still flagged: "pitwall estimate (flagged; S12: wider when approximate); no approximate forecast in any recording (research 19 wetness: all 15 perfect), unchecked" |

## Left to the supervisor (code, not literals; contract-neutral, analysis only)

1. **track-wetness's state is relative to each stint's start** (finding 4). It reads about 0 on a track that is wet from
   the start (Miami, Mexico) or after a type change (Singapore from lap 27). The MC's rain timeline starts from it, so
   on a wet race it starts 15–25 s too dry. The fix belongs to track-wetness's measurement: an absolute level through
   the type's offset and slope against a dry reference (a track file's or a prior), instead of the stint's first laps.
   Without it the recommended constants only shape the curve after a too-dry start.
2. **Rain % is an intensity** (finding 3). In the MC a lap rains with a chance of `rainPct` %. The game rains from about
   25 % rising, dries from about 60 % falling, and storms from 88 %, each seen once or twice (Singapore). A
   deterministic threshold, or a wetness target that rises with rain %, would fit better. Thin: two transitions.
3. **The forecast is a step function on a coarse grid** (finding 5). Mapping the samples onto laps by linear
   interpolation would remove the +1.7 to +3 laps of lateness that `rainPctAt`'s nearest sample gives a perfect
   forecast.
4. **Contract gaps:** none.
