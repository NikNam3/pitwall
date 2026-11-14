# 21. Tyre data for the strategy model

2026-11-14. What the recordings say about the strategy model's tyre terms: the wear rate and how many laps it needs, wear against wetness, track, track temperature and driver, degradation, warm-up, the wet slopes, the compound offsets, and the Silverstone race of 2026-11-14 read with all of it. Written after research 20 and the live test of 2026-11-14 (`docs/acceptance/live-checklist.md`, "2026-11-14: live test notes").

**Data and code.** The 1 Hz samples and car-laps of research 20's spike (55 recordings of `recordings/` and `~/.local/share/pitwall/recordings/`, decoded with `packages/protocol`, flashback-undone samples dropped). The new scripts are in the session scratchpad, `/tmp/claude-1000/-home-nklx-dev-personal-pitwall/920b5a33-0c6c-4ebb-ace7-acdbabd0122b/scratchpad/tyre-spike/strategy/` (cited `strategy/<script>`; the scratchpad can be cleared, this file keeps the results). One harness (`strategy/capture.ts`) replays the Silverstone recording through the bridge pipeline as `pitwall strategy` does and logs the strategy job's view; nothing is stored.

**Conventions.**
- A **gain** is one green lap's own wear increase at a corner (end of lap minus end of the lap before, same set). Green: no pit, no SC or VSC, not an in-lap or out-lap, not lap 1. Rates are of the **worst corner** unless a corner is named.
- **Lap time** is fuel-corrected at 30 ms/kg (`degradation.gammaMsPerKg`).
- **w** is track wetness on the lap model's slick scale (ms): the AI field's median fuel-corrected lap per tyre type against a dry reference, through the lap model's terms (slick w = excess; inter w = (excess − 3,500) / 0.5; wet w = (excess − 8,100) / 0.25), as in research 19. Dry references (AI, fuel-corrected): Singapore 96.37 s (slick laps 8–22), Silverstone 92.99 s (slick laps 23–29 of the first recording), Miami 94.77 s (practice bests). Mexico has none.
- **Thin** marks fewer than about 30 cases or one event. Everything in §10 is a proposal for the user, not a ruling.

Who drove (research 12 §1): Ferrari cars mainly DR, Mercedes cars mainly Asymetrisch ("Asym" below).

| Race | Recording | Laps run / set | Full race | Conditions |
|---|---|---|---|---|
| Singapore | `2026-10-29_00-04-08` | 44 / 62 | 62 | inter, slick (laps 6–24), inter |
| Zandvoort | `2026-10-29_23-00-37` | 14 / 72 | 72 | dry, SC |
| Mexico | `2026-10-30_15-20-41` | 71 / 71 | 71 | steady storm, wet then inter |
| Miami | `2026-10-30_18-53-00` | 20 / 20 | 57 | steady storm, inter and wet side by side |
| Shanghai | `2026-11-02_15-17-14` | 10 / 10 | 56 | dry |
| Texas | `2026-11-05_00-13-26` | 20 / 20 | 56 | dry, SC lap 12 |
| Suzuka | `2026-11-06_22-23-46` | 6 / 19 | 53 | dry |
| Suzuka | `2026-11-07_00-00-21` | 11 / 53 | 53 | dry |
| Spa | `2026-11-12_02-21-24` | 44 / 44 | 44 | dry, SC lap 20 |
| Silverstone | `2026-11-13_23-41-39` (laps 22–31), `2026-11-14_00-04-26` (laps 36–52) | 52 / 52 | 52 | dry, rain from lap ~31, inters from lap ~34, drying |

The set race length is the Session packet's `totalLaps` (`strategy/totallaps.ts`); "full race" is the real Grand Prix's.

## 1. Findings

1. **Wear accumulates linearly in age on every tyre type, up to 56 %.** No acceleration past 40 % in wear itself. The lap-time convex term (research 19 §3) is a different question and is not re-identified here.
2. **The live wear rate rule is the weak point, not the number of laps alone.** The median of whole-percent per-lap gains (`per-lap-rate`, window 5, minimum 2) stays 15–27 % off the stint's later rate however many laps it sees. The cumulative rate (wear gained over the laps, divided by the laps) reaches 6 % median error on slicks after 3 laps and 5 % once 5 % wear has accrued.
3. **The "13-lap inter life from one lap" is the age basis on the default ν, not a wear rate.** 13.3 laps = `ageLossLimitMs` 2,000 / `defaultNuMsPerLap` 150. Inters at steady wetness lose about 11 ms per lap of age (Mexico), so on the age basis an inter's life is about 180 laps, and no wear-free life is meaningful.
4. **The game scales wear with race length.** The same track, compound and track temperature wear 2.0–2.1 × faster in a 19-lap race than in a 53-lap one (Suzuka). The 35 % races (Texas, Miami) wear about 2 × the full-length ones on every type. Calibration sets and driver profiles pool races of different lengths without knowing it.
5. **Inters wear faster as the track dries:** +0.076 ± 0.006 %/lap per second of w lost (AI, 3 races), about +6 % of the rate per second. At Silverstone the AI inters went 1.06 → 1.84 %/lap as w fell 18 → 10.5 s. At steady wetness the inter rate is flat in age (Mexico, 67 laps).
6. **Track temperature has no measurable effect; the track does.** The AI's C3 runs 1.5–2.6 %/lap across full-length races. Within a track (Suzuka 20–25 °C, Texas practice 40 °C against the race at 32 °C) the rate does not follow track temperature.
7. **Humans wear 1.2–2.0 × the AI, and DR and Asym differ.** DR 1.21–1.34 × on normal stints (Silverstone's drying inters 1.86 ×), Asym 1.46–1.97 ×. Humans wear the fronts hardest on slicks (7 of 10 stints), the AI the rears (97 %). The flat 2.0 %/lap default fits a full-length average only: human slick rates run 1.4–7.3 %/lap.
8. **On a drying track a stint's own ν goes negative** (Silverstone inters −331, Singapore inters −201 ms/lap): the lap-time fit takes the drying as negative degradation.
9. **The fresh-set laps are not slower in the dry; inters are slower for 2–3 laps.** Dry AI, laps 2–3 on a new set against the set's own line: medium about 0, soft (Spa) −1.8 to −2.3 s. Inters after the Mexico switch: +0.8, +0.65, +0.5 s on laps 2–4 (confounded with the track). The model's +410 ms sits on the out-lap, which the measured pit loss already contains.
10. **The wet slopes cannot be re-fitted:** no recording since research 19 adds slicks and inters on track together. Silverstone adds one point for the rain model: under light rain at 77–78 % the track settled at w ≈ 10.7 s.
11. **Track-file soft offsets have the wrong sign at 3 of 4 tracks checked, and Silverstone's hard (+6,956 ms) is wrong.** Fresh-set softs in the game run 0.3–1.2 s faster than mediums. DR on 15–21-lap hards at Silverstone was 0.5–1.9 s faster than the AI on mediums.
12. **Silverstone, laps 39–47: staying out on inters was right.** The inters reached the flag at 50 % (limit 70 %). From lap 45 the track stopped drying at a level where, on the lap model's own constants, inters were 1.2–2.6 s/lap faster than slicks; mediums on lap 47 would have lost about 28–35 s.
    - The replay shows why the model said mediums: track-wetness had no state after the restart, so the forecast took the track as dry.
    - The 110 % crossover line sits 2–3 % too high for F1 25.

## 2. Wear rate: shape and reliability (question 1)

### Shape

Each gain divided by its stint's mean gain, binned by the corner's wear at the lap's start, race stints with 8 or more gain laps (`strategy/q1.py`):

| Type, driver | 0–10 % | 10–20 | 20–30 | 30–40 | 40–50 | 50–60 | Gain laps |
|---|---|---|---|---|---|---|---|
| slick, AI | 0.99 | 1.01 | 1.01 | 1.00 | 0.87 (4) | | 1,399 |
| slick, human | 1.04 | 1.00 | 0.96 | 1.01 | 1.01 (3) | | 78 |
| inter, AI | 0.91 | 1.07 | 1.04 | 1.03 | 1.04 | 1.03 | 1,726 |
| inter, human | 0.92 | 1.09 | 1.05 | 1.10 | 0.85 | 0.71 (2) | 91 |
| wet, AI | 0.92 | 1.02 | 1.01 | 1.02 | 1.02 | | 113 |

A quadratic in age, pooled within stints, gives the slope's change over 20 laps: AI inters +5 % (61 stints, to 56 % wear), AI slicks −7 % (150 stints, to 51 %), AI wets −22 % (9 stints, Miami, where the track dried), humans −5 to −10 % (thin). **Wear is linear in age.** Only the first laps of a wet-tyre set (0–10 %) wear about 9 % less than the rest.

**Per corner.** The AI's worst corner is a rear in 97 % of slick stints (213) and every inter and wet stint; its fronts wear 0.74 × its rears on slicks and 0.43 × on inters and wets. Our cars' worst slick corner is a front in 7 of 10 stints (front/rear 1.15). Every inter stint wore a rear worst, AI and human. The AI's per-compound rates by track are in §4.

### How many laps a rate needs

For every stint, from several start points (as after a restart), a rate from n gain laps is compared with the stint's rate over its remaining laps (at least 5). Two estimators: **median**, the current rule (median of the newest ≤ 5 gains); **cumulative**, (wear now − wear n laps ago) / n. Absolute relative error p50 / p90, and the error of the laps to 70 % it implies, in laps p50 / p90 (`strategy/q1c.py`; 10 races, AI and human):

| n | Slick median | Slick cumulative | Slick life error (cum.) | Inter median | Inter cumulative | Inter life error (cum.) |
|---|---|---|---|---|---|---|
| 1 | 17 % / 38 % | 17 % / 38 % | 4.2 / 17 laps | 15 / 33 % | 16 / 72 % | 7 / 25 laps |
| 2 | 8 / 25 | 8 / 23 | 2.0 / 6.7 | 15 / 32 | 18 / 44 | 8 / 44 |
| 3 | 18 / 33 | **6 / 17** | 1.3 / 6.0 | 15 / 33 | 19 / 33 | 9 / 21 |
| 5 | 23 / 33 | 4 / 13 | 1.0 / 4.8 | 15 / 36 | 11 / 29 | 5.5 / 21 |
| 8 | 27 / 40 | 4 / 10 | 1.2 / 4.0 | 15 / 22 | **4 / 25** | 1.9 / 15 |

Cases: slicks 306 (n = 1, 177 stints) to 59 (n = 8, 24 stints); inters 426 (65 stints, 4 races) to 306 (54 stints).

- **The median rule does not converge.** Gains are whole percent (research 20 §6), so a true 2.4 %/lap gives gains of 2 and 3 and a median of 2 or 3: 15–27 % off at any n. The cumulative rate uses the same wear without the rounding of each lap.
- **What sets the error is the wear accrued**, not the laps: with the cumulative rate, at least 3 laps and at least 5 % accrued give slicks 5 % / 12 % (791 cases, 135 stints; life error 1.4 / 4.2 laps) and inters 7 % / 25 % (1,804 cases, 63 stints; 3.1 / 14 laps).
- Inters need about 5–8 laps to reach 5 % at 0.7–1.0 %/lap, and their remaining rate moves with the wetness (§3).
- **Humans** are noisier: cumulative at n = 3, 11 % / 33 % (35 cases, 10 stints).

**Proposal:** compute the live rate as the cumulative gain over the newest green laps of the stint, (wear now − wear k laps ago) / k with k up to the window of 5, or a least-squares slope of wear on age. Give `insufficientData` until **3 gain laps and 5 % accrued at the worst corner**. A window keeps the rate recent when the wetness moves it (§3). Until then, use a prior: the calibration set's rate, else the AI field's rate on the compound this session × the driver factor (§4).

### The "13-lap life from one lap" (live checklist)

`pit-window`'s `lifeLaps` 13.3 is `freshLifeLaps.inter`. Without a calibration wear rate, a fresh set's life is the age basis, `ageLossLimitMs / ν`. Before the stint has pace laps ν is the prior: 2,000 / 150 = 13.33 laps. 13.3 laps from the lap-34 fitting is lap 47. The replay (§9) shows exactly 13.33 on laps 37–39, while the fitted set's own laps to the limit were still `insufficientData`. So the number rested on no lap at all.

The age basis is wrong for inters: their ν at steady wetness is about 11 ms/lap (§5), so the age basis gives them about 180 laps. Their life must come from wear.

## 3. Wear against wetness (question 2)

AI gain laps against the lap's w, race and car-stint fixed effects, SE clustered by car-stint (`strategy/wet.py`, `strategy/q2.py`):

| Type | Race | Gain per s of w lost (%/lap) | Laps, car-stints | w range | Mean gain |
|---|---|---|---|---|---|
| inter | Silverstone 2026-11-14 | +0.108 ± 0.006 | 251, 17 | 18.2 → 10.1 s | 1.53 |
| inter | Singapore | +0.054 ± 0.005 | 307, 19 | 20.4 → 7.1 s | 1.16 |
| inter | Miami | +0.058 ± 0.010 | 120, 10 | 24.8 → 16.8 s | 1.94 |
| inter | **pooled** | **+0.076 ± 0.006** | 678, 46 | | 1.15 |
| wet | Miami | +0.029 ± 0.011 | 118, 10 | 26.1 → 13.5 s | 2.95 |
| inter, DR | Silverstone | +0.26 | 14, 1 | | 2.86 |

- **Relative to the rate, 3–9 % per second of drying** (Miami 3, Singapore 5, Silverstone 7–10).
- **At steady wetness the inter rate is flat:** Mexico's AI inters lose 0.0019 %/lap per lap of age (1,041 laps), 0.9–1.0 %/lap from lap 7 to 69.
- Silverstone by laps, AI (DR):

  | Laps | 34–37 | 38–41 | 42–44 | 45–47 | 48–52 |
  |---|---|---|---|---|---|
  | w | 18.2 s | 16.9 | 13.1 | 10.8 | 10.7 |
  | AI gain | 1.06 | 1.12 | 1.51 | 1.84 | 1.83 |
  | DR gain | | 2.00 | 2.00 | 3.67 | 3.75 |

- **Slicks on a damp track: not measurable.** Every slick lap in the data has w ≤ 1.5 s (Singapore laps 7–8 and 24, Silverstone lap 30), and their rate equals the dry laps'. The field leaves slicks within a lap of the rain.
- **Wets on a drying track:** +0.03 %/lap per s (Miami only, thin).

**Proposal:** a wetness term for inter wear in the forecast, `rate(w) = rate_now × (1 + 0.06 × (w_now − w))` per second of w (inters only, about ±0.03), read from track-wetness's state and its forecast. The live rate already contains today's wetness; the term only changes the laps ahead. No term for slicks (no data) or wets (thin).

## 4. Wear by compound, track, temperature and driver (question 3)

### Track and compound

AI, median worst-corner rate of race stints with 3 or more gain laps (`strategy/q3.py`); "×" is the session's rate against its medium:

| Track (set length) | Hard | Medium | Soft | Track °C |
|---|---|---|---|---|
| Singapore (full) | C3 1.50 (0.86 ×) | C4 1.74 | | 28 |
| Silverstone (full) | | C3 2.00 | C4 2.36 (1.18 ×) | 32 |
| Zandvoort (full) | | | C4 2.00 | 19 |
| Spa (full) | | C3 2.60 | C4 3.60 (1.38 ×) | 24–25 |
| Suzuka (53 laps, full) | | C2 2.00 | C3 2.25 (1.12 ×) | 25 |
| Suzuka (19 laps) | C1 3.00 | C2 4.00 | C3 4.67 (1.17 ×) | 24 |
| Texas (20 of 56) | C1 2.20 (0.69 ×) | C3 3.17 | C4 4.67 (1.47 ×) | 31–32 |
| Shanghai (10 of 56) | | C3 4.57 | | 28 |
| inters: Mexico (full) 0.97, Singapore (full) 1.12, Silverstone (full) 1.06 → 1.84 drying, Miami (20 of 57) 2.00; wets: Mexico 1.0 (2 laps), Miami 2.9 | | | | |

- **Soft 1.12–1.47 × medium, hard 0.69–0.86 ×.**
- **The track spreads the same compound:** C3 1.5 (Singapore) to 2.6 (Spa) in full races, 1.7 ×; 3 × with the short races. That is what `tyreLife.wearPerLapPct.<compound>.<corner>` per track is for.
- **Race length doubles the rate at about a third of the distance:**
  - Suzuka 19 laps against 53 laps, same track and temperature: C2 4.00 against 2.00, C3 4.67 against 2.25 (×2.0, ×2.1; 15 and 19 AI stints).
  - Miami's inters (35 %) 2.0 against 0.97–1.12 in three full races.
  - Texas (36 %) C3 3.17 against 1.5–2.6 in full races.
  - Lap-time loss per lap did not double with it (§5): per % wear, the short races degrade less.
- **Track temperature: not measurable.**
  - Across sessions the rate does not follow it (C3 corr −0.22 over 7 sessions, C4 +0.27 over 6), and the track dominates.
  - Within a track: Suzuka C2 3.33 / 4.00 / 2.00 at 20 / 24 / 25 °C (the 4.00 is the short race); Texas C3 3.17 in practice at 40 °C and in the race at 32 °C (2 practice stints, thin).

### Human against AI

Our stint's worst-corner rate against the AI median on the same compound in the same race (`strategy/q3.py`):

| Driver | Race | Compound | Laps | Human | AI | × |
|---|---|---|---|---|---|---|
| DR | Singapore | C4 medium | 17 | 2.12 | 1.74 | 1.22 |
| DR | Singapore | inter | 17 | 1.41 | 1.12 | 1.26 |
| DR | Shanghai | C3 medium | 7 | 6.14 | 4.57 | 1.34 |
| DR | Spa | C3 medium | 13 | 3.15 | 2.60 | 1.21 |
| DR | Silverstone | inter (drying) | 14 | 2.86 | 1.53 | 1.86 |
| Asym | Mexico | inter | 18, 39 | 1.61, 1.41 | 0.97 | 1.67, 1.46 |
| Asym | Miami | inter | 4, 3 | 3.25, 3.33 | 2.00 | 1.62, 1.67 |
| Asym | Texas | C1 hard / C3 medium | 9 / 5 | 3.33 / 6.00 | 2.20 / 3.17 | 1.52 / 1.89 |
| Asym | Suzuka 19 / 53 laps | C3 soft | 3 / 7 | 7.33 / 4.43 | 4.67 / 2.25 | 1.57 / 1.97 |

Asym is the Mercedes car (mainly Asymetrisch). DR's Spa hard (C1, 1.80), Silverstone hard (C2, 2.29) and Zandvoort stints had no AI on the compound.

- **DR 1.21–1.34 × on 4 normal stints (median 1.24); Asym 1.46–1.97 × on 8 (median 1.65).** Silverstone's 1.86 is the drying-and-overheat outlier (research 20 §7.3).
- **Corners differ:** on slicks our cars wear the fronts relatively harder, so the factor at a front corner is about 1.5 × the factor at the worst corner the AI shows.

**Does `driverNoise.wearRatePct` 2.0 %/lap hold?** Only as an average over full-length races:

| Race length | Inters | Slicks |
|---|---|---|
| Full | 1.3–1.6 (Mexico, Singapore) | 1.8–4.4 (Singapore 2.1, Spa 3.15 and 1.8, Suzuka 4.4) |
| About a third | 3.3 (Miami) | 3.3–7.3 (Texas, Suzuka 19 laps) |

The default is used where the car has no own rate on a compound: for a human, the next compound after a stop. There it misses by up to 3.6 ×.

**Proposal:** a human without a profile rate takes the AI field's measured rate on that compound this session × a driver factor (default 1.5; DR 1.25, Asym 1.65 as profile values); the 2.0 only when no car has run the compound. Profiles and calibration sources keep the race length (set laps / full laps) and normalise the rate to full length, or are kept per length band (§10).

## 5. Degradation (question 4)

Per AI stint, least squares of lap time on age (clean laps, age ≥ 2, outliers beyond 3 MAD dropped; `strategy/q4.py`). Per-% columns are on worst-corner wear.

| Track | Compound | Stints, laps | ν (ms/lap), median (IQR) | ms per % wear | Rate (%/lap) |
|---|---|---|---|---|---|
| Spa | C3 medium | 22, 222 | 127 (108–155) | 53 | 2.42 |
| Spa | C4 soft | 38, 279 | 225 (135–299) | 64 | 3.47 |
| Silverstone | C3 medium / C4 soft | 8 / 10, 127 | 201 / 241 | 100 / 103 | 2.0 / 2.2 |
| Singapore | C3 hard / C4 medium | 6 / 12, 280 | 113 / 150 | 82 / 98 | 1.4 / 1.6 |
| Suzuka (53 laps) | C2 medium / C3 soft | 6 / 12, 140 | 85 / 143 | 43 / 61 | 1.8 / 2.2 |
| Zandvoort | C4 soft | 18, 150 | 183 | 103 | 1.85 |
| Texas (36 %) | C3 medium / C4 soft | 17 / 9, 170 | 172 / 155 | 55 / 33 | 3.1 / 4.5 |
| Shanghai (18 %) | C3 medium | 17, 114 | 351 | 81 | 4.4 |
| Mexico | inter, steady storm | 18, 952 | **11** (8–14) | 14 | 0.84 |
| Singapore | inter, rain returning then steady | 17, 282 | −201 | −185 | 1.0 |
| Silverstone | inter, drying | 17, 244 | **−331** | −216 | 1.46 |
| Miami | inter / wet, drying slowly | 10 / 10 | −197 / −105 | | 1.9 / 2.8 |

- **Dry slicks:** C3 159, C4 189 ms/lap (82 and 87 stints, 5–6 races); 64–81 ms per % wear. That is close to research 19's prior of 150 ± 100 and its stints' OLS of 51 ± 6 ms/%.
- **Race length:**
  - Full races 158 ms/lap and 74 ms/% (132 stints, 5 races); the short races 191 ms/lap and 48 ms/% (50 stints, Texas and Shanghai).
  - So the lap-time loss per lap barely grows when wear doubles. Per-% degradation from a short race does not carry over to a full one (thin: two short races, different tracks).
- **Net of the track's trend:** lap × type and car-stint fixed effects, identified from cars wearing at different rates (`strategy/q4b.py`):

  | Race | Type | ms per % wear | Laps, stints |
  |---|---|---|---|
  | Spa | slick | +55 ± 15 | 551, 69 |
  | Texas | slick | +48 ± 26 | 225, 37 |
  | Singapore | slick | +113 ± 48 | 300, 19 |
  | Suzuka (53 laps) | slick | +145 ± 38 | 139, 19 |
  | Mexico | inter, steady | **−41 ± 37** | 969, 18 |
  | Singapore | inter | +16 ± 52 | 292, 36 |
  | Silverstone | inter, drying | **+124 ± 84** | 226, 17 |

  Inters at steady wetness lose nearly nothing to wear up to 50 %. On the drying track they lose about 120 ms per %: they overheat (research 20 §6). That is about 1.5 SE apart, thin.
- **Wear or carcass heat? Not separable.**
  - Our cars' lap minus the field's median, against our wear minus the field's and our rear carcass above Tref: Spa DR slicks +58 ± 11 ms/% with −43 ± 15 ms/°C (34 laps), Singapore DR slicks +112 ± 40 ms/% (17), Texas Asym +81 ± 60 ms/% (14).
  - The temperature sign is negative wherever it is significant: faster laps heat the tyre (research 20: +0.5 °C per 1 s faster), not the other way round.
  - At Silverstone, wear and overheat correlate at +0.95 over DR's 14 laps.
  - So **wear % is the variable to keep**; carcass heat explains wear (research 20 §6: +0.042 %/lap per °C on inters), not lap time beyond it.
- **ν on a drying track:** the stint's own fit gives −331 ms/lap at Silverstone, and the degradation filter (prior 150 ± 100, observation sd 400) follows the data after a few laps (§9). `forecast-field` then divides ν by the wear rate: a negative `degMsPerLap`, a tyre that gets faster as it wears.

## 6. Warm-up (question 5)

New-set laps against the set's own line, which is fitted on laps 4–12 of the set relative to the AI field's median of the same lap and type (cars on sets of age 3 or more; Mexico raw). Mean ± SE (median) (`strategy/q5.py`):

| Condition | Cars | Lap on set 2 | 3 | 4 | Stints, races |
|---|---|---|---|---|---|
| dry, medium (C3), Spa 19 and Texas 3 | AI | −51 (+15) | −70 (−72) | −16 (−37) | 22, 2 |
| dry, soft (C4), Spa | AI | −2,113 (−1,798) | −1,971 (−2,268) | −97 (−93) | 10, 1 |
| of which Texas (C3) | AI | −1,858 ± 776 | −1,238 ± 176 | | 3, 1 (thin) |
| inter, steady storm (Mexico, after wet → inter) | AI | **+776 ± 243** | **+652 ± 174** | +487 ± 113 | 18, 1 |
| inter, Mexico | Asym | +2,557 / −13 | +549 / −259 | −496 / +537 | 2, 1 (thin) |
| slick after drying (Singapore laps 6–9) | AI | −851 (1) | −467 ± 184 | −175 ± 80 | 6–18, 1 |
| drying, inters | | | | | no stop in the recorded part of Silverstone |

The out-lap runs 14.1 s (Spa) and 17.2 s (Texas) above the line. That is the pit lane; it cannot be split from a cold-tyre term (research 19 addendum §1).

- **Dry: no cold-tyre loss on the first flying laps.** Mediums sit on their line; Spa's softs run about 2 s faster on laps 2–3 than the line through laps 4–12, a fresh-set peak (research 19 addendum: −0.58 s on lap 2 to soft). Thin: one track.
- **Inters: slower for 2–3 laps**, about +0.8, +0.65, +0.5 s. Mexico's track also gained about 0.7 s over laps 6–9 after the switch (research 19), so part of this is the track. Our cars' carcass needs 2–4 laps to settle and 12–15 min on a drying track (research 20 §6).
- **Damp and drying: not measurable.** No stop of our cars on a damp or drying track with clean laps after it.
- **The model:** `coldTyreLap1Ms` 410 and `coldTyreLap2Ms` 0, × `coldTyreWetFactor` 3.4 on a wet track.
  - `lapOnSet` 1 is the out-lap (`race-forecast/field.ts` `fitStop`), so the 410 (1.4 s wet) lands on the out-lap.
  - The pit loss is measured from the in-lap and the out-lap (research 12 §5), so it already holds the out-lap's cold tyres.
  - Research 12's +0.41 s was measured on the first flying lap, which the model gives 0.

## 7. Wet slopes and offsets (question 6)

**No re-fit is possible.** The four values need slicks and inters (or inters and wets) on track together at two wetness levels. Since research 19 no recording adds one:
- Silverstone has no slick lap after lap 30 and no inter lap before lap 37 (laps 32–36 fall between the two recordings).
- Mexico's wets and inters never overlap on clean laps.

The values and their research-19 uncertainty stand:

| Value | Now | Uncertainty | From |
|---|---|---|---|
| `interMsPerWetnessMs` (sI) | 0.5 | not identifiable | estimate |
| `interOffsetMs` (oI) | 3,500 | 2,800–4,200 over sI 0.4–0.6 | Singapore's crossing at 6–8 s inter excess, 1 crossover |
| `wetMsPerWetnessMs` (sW) | 0.25 | ± 0.06 (sW/sI 0.49 ± 0.12) | Miami, 14 laps |
| `wetOffsetMs` (oW) | 8,100 | 7,700–8,400 over sI 0.4–0.6 | Miami's wet/inter meeting at 12.5 s |

**Checks Silverstone adds:**
1. **The stay-out.** The AI field ran inters at 109.2–109.8 % of the dry reference (excess 8.5–9.0 s) on laps 45–51, with 7 or fewer laps left, and no car switched. On the lap model, an inter excess of 8.75 s means w = 10.5 s, where a slick runs 10.5 s over dry: **1.75 s/lap slower than the inter** (sI 0.4: 2.6 s; sI 0.6: 1.2 s). Consistent with every sI.
2. **The crossing in lap-time terms:** slick and inter meet at an inter excess of oI / (1 − sI) = 7 s, **107.5 %** of Silverstone's dry reference and 107 % of Singapore's. Singapore's AI switched with inters at 107–110 % (the forecast rain was falling). `crossover`'s line is 110 %.
3. **A settled level for the rain model** (research 19 wetness addendum, its proposal 2: a wetness target that rises with rain %):

   | Rain % | Weather | Settled w | Where |
   |---|---|---|---|
   | 77–78 | light rain | **10.7 s** (10.0–11.2) | Silverstone laps 45–51, 17 cars |
   | 80–88 | light rain | 14.4 s | Singapore |
   | 90–91 | storm | 14.9 s | Singapore |
   | 93 | storm | ~18 s, biased high | Miami |

   The drying stopped on lap 45 at the level the steady rain held.

## 8. Compound pace offsets (question 7)

Fresh-set offset against medium: each AI stint's line (clean laps, age ≥ 2) taken to age 0. "Within" compares the two sets of one car; "between" compares the medians of the cars on each compound (car pace spread included). Values in ms (`strategy/q7b.py`):

| Track | Compound | Within (cars) | Between (stints) | Track file | Verdict |
|---|---|---|---|---|---|
| Spa | soft C4 | −297 ± 169 (18) | −294 ± 422 (44 / 24) | none | soft about −0.3 s |
| Texas | soft C4 | −330 ± 528 (11) | −330 ± 918 | +118 | sign wrong (research 12: −0.88 s) |
| Texas | hard C1 | +2,432 ± 197 (7) | +3,026 ± 607 | +816 | hard stints are post-SC, ν −125: biased, thin |
| Singapore | hard C3 | | +931 ± 453 (7 / 12) | −25 | file too low |
| Suzuka (53 laps) | soft C3 | | −1,196 ± 589 (13 / 6) | +411 | sign wrong |
| Silverstone | soft C4 | | +86 ± 425 (10 / 8) | +462 | within noise, thin |
| Silverstone | hard C2 | | no AI on hard | **+6,956** | wrong (below) |

- **Silverstone's hard.** DR's C2 hards, 15–21 laps old, ran 91.6–92.4 s on laps 24–30, against 92.5–94.2 s for the AI on mediums: 0.5–1.9 s faster. DR runs 1.3–3.1 s faster than the AI median on a shared compound (Singapore, Spa), so the hard was at most about +1 s against the medium. The file's +6,956 ms is a wet race's hard laps (2025 British GP, 20 laps), as the calibration list suspected.
- **The pattern:** the files' soft offsets are positive at Texas, Suzuka, Zandvoort and Silverstone (+118 to +462) and the game's fresh softs are 0.3–1.2 s faster. The files take median real-F1 race laps at any age (research 12 §3), not fresh-set offsets.
- **Proposals:**
  - treat the files' `compoundOffsetsMs` as a weak prior only (now `compoundOffsetPriorSdMs` 500);
  - replace Silverstone's hard with the config default (+500) until a dry year is used (`pitwall-trackdata`);
  - use calibration sets' `degradation.alphaOffsetMs.*` where we have races.

## 9. Silverstone 2026-11-14, laps 39–47 (question 8)

What happened (`strategy/wet.py`, research 20 §7.3):
- Car 19 (DR) on inters from lap 34; forecast light rain 77–78 % to the flag (a perfect forecast).
- The field's w fell 18.2 s (lap 37) → 10.8 s (lap 45), then held at 10.0–11.2 s to lap 51.
- RL wear 10 % (lap 39), 31 % (lap 47), 50 % at the flag (lap 52).
- No car of the top 5 stopped; car 19 was passed on lap 50 and finished P2.

### What the model said (replay)

`strategy/capture.ts` replays the stored recording (laps 36–52, its sidecars: calibration set `pitloss-22`, no profiles) through the bridge pipeline:

| Lap | track-wetness state | Car 19's ν (ms/lap) | RL wear, rate | Laps to limit | Fresh inter life | Best plan (runs) |
|---|---|---|---|---|---|---|
| 37–38 | insufficientData | 150 (the prior) | 7–9 %, none | insufficientData | **13.3** | L47 medium (40); no stop not in the top 6 |
| 39 | insufficientData | 146 | 10 %, 1.5 | 40 | 13.7 | L47 / L43 medium (80, 160) |
| 40 | insufficientData | 87 | 12 %, 2 | 29 | 22.9 | **no stop**, E[pos] 1.8–4.0 (40) |
| 41 | insufficientData | 12 | 14 %, 2 | 28 | 168 | no stop |
| 42–46 | insufficientData | −35 … −184 | 16–28 %, 2 | 27 → 21 | insufficientData (ν ≤ 0) | no stop; next best L51 inter |
| 47 | insufficientData | −184 | 32 %, 3 | 12.7 | insufficientData | no stop, E[pos] 1.2–1.9; L48 medium 5.6–6.1 |
| 49–52 | insufficientData | −143 … −86 | 39–50 %, 4 | 7.8 → 5 | insufficientData | no stop |

Each probability is a multiple of 1/40 at most laps (40 runs).

- **track-wetness never had a state.** After the restart the log holds no slick lap of the session and no earlier session gives a dry reference. So `forecast-field` used its dry prior, w = 0 ± 1.5 s, on a track at w 10.5–18 s.
  - On a dry track the lap model puts the medium 3.5 s/lap ahead of the inter.
  - The MC's rain timeline then reads 77–78 % as a per-lap chance of rain (research 19 wetness finding 3) and wets the track towards its ceiling.
  - Neither picture is the measured track.
- **The plan flipped to "no stop" on lap 40,** as ν fell from the prior towards the drying track's negative slope (146 → 87 → 12 → −35) and the fitted set's life became known. Lap 39 is what the live test saw: every candidate a medium stop.
- **The fresh inter life was 13.3 laps on laps 37–39**, the prior ν (§2). It became 168 laps on lap 41 and `insufficientData` once ν went negative.
- **The median rule lagged the drying:** RL 2 %/lap from lap 40 to 46 while the gains were 2, 2, 2, 4, 3, 4. At lap 39 its 1.5 %/lap gave 40 laps to the limit; the set's remaining rate (2.9 %/lap on average) gives 21.

### What it should have said

| Lap | Tyre life (inters) | Pit window | Strategy |
|---|---|---|---|
| 39 | RL 10 % at age 5. Cumulative rate 2.0 %/lap: 30 laps to 70 %. With the drying term (§3) and DR's 1.25–1.9 ×: about 3–3.5 %/lap once dry, 17–20 laps. Either way past the flag (13 laps left). | `stopNeeded: false`. The fitted set reaches the flag with ≥ 4 laps of margin. A fresh-life figure for inters only from wear (AI inter rate × driver factor: 1.3–2.0 %/lap at this wetness, 35–55 laps), never 2,000 / 150. | no stop, the best plan. Inter → inter has no gain (fresh inters lose 0.8 + 0.65 s on their first laps, §6) |
| 43 | RL 18 %, rate 2.0 rising. 3.3 %/lap from here: 16 laps (lap 59) | as lap 39 | no stop: on the lap model slicks were 2–4.5 s/lap slower at w 13 s (sI 0.6–0.4) |
| 47 | RL 31 %, 3.7 %/lap: 10.5 laps to 70 % (lap 57), 5 laps left. The flag at about 50 %. | no stop | no stop. Mediums on lap 47: pit loss 22.0 s (`pitloss-22`) + 1.2–2.6 s/lap × 5 laps + the medium's warm-up on a damp track ≈ **28–35 s lost**; only a full drying (w < 7 s within 1–2 laps) would pay back. Under steady 78 % light rain the track had already settled (§7). |

**Why "mediums on lap 47" and no stay-out plan.** The model's own constants give inters the edge at w 10.5 s (§7). A plan that prefers mediums must see a drier track than the lap times say, or a slower inter. Four model parts push that way:
1. **The dry wetness prior** (replay above): with no dry reference, the medium looks 3.5 s/lap faster than the inter. This is the largest.
2. The DP and the MC take one wear rate (the fitted compound's) and one `degMsPerLap` (its ν / rate) for every compound (`shared/strategy-input/dp-input.ts`, `race-forecast/field.ts` `fitStop`). With ν at the prior, the inter's 75 ms per % weighs against it. Once ν went negative (§5), a medium inherited a negative degradation too.
3. The DP holds the wetness at today's value for every lap (`wetnessByLap` filled with the current state).
4. `crossover`'s 110 % line read 108–109 % as "slicks faster", 2–3 % early for this game (§7).

In the replay "no stop" is the best plan from lap 40; on laps 37–39 it is not among the top 6. Why the candidate set or the ranking left it out there was not traced.

**The cause of the wear (user: setup and drying, both).** Drying alone raised the AI's inter rate × 1.7 (1.06 → 1.84). Car 19's went × 1.9 (2.0 → 3.7), so its excess over the AI held at 1.9–2.0 × against DR's normal 1.25 ×. Part of the excess is the overheat that research 20 §7.3 measured; how much is setup is not measurable. For profiles and sets: this stint is 1.5 × DR's usual factor, and an exclusion as the checklist proposes is consistent with the data.

## 10. Proposals

For the user to decide; no code here.

| Model term | Now | Proposed | Evidence | Confidence |
|---|---|---|---|---|
| Live wear rate (`per-lap-rate` median of gains, `wearRatePerCorner`) | median of the newest ≤ 5 whole-percent gains, from 2 gains | cumulative gain over the newest ≤ 5 green laps / laps (or a least-squares slope of wear on age) | median stays 15–27 % off at every n; cumulative 6 % at n = 3 on slicks (§2) | high: 10 races, 177 slick and 65 inter stints |
| Minimum before a rate is used (`tyre-life.minLaps`, `per-lap-rate.minSamples`) | 3 stint laps, 2 gains | 3 gain laps **and** 5 % accrued at the worst corner; before that a prior (next row) | 5 % / 12 % error on slicks, 7 % / 25 % on inters at that point (§2) | high (slicks), medium (inters) |
| Wear prior without a measured rate | none (age basis) for `tyre-life`; 2.0 %/lap in `driver-noise` | the AI field's rate on the compound this session × the driver factor; then the calibration set's; then a per-compound default × race length | AI rates per compound and track (§4) | medium |
| Fresh-set and fitted-set life on the age basis (`ageLossLimitMs` / ν) | used whenever there is no wear rate; the default ν gives 13.3 laps | `insufficientData` (or flagged) while ν is the prior; never the age basis for inters and wets | the 13.3 = 2,000 / 150; inter ν 11 ms/lap at steady wetness (§2, §5) | high |
| `driverNoise.humanWearRatePct` / `defaultWearRatePct` | 2.0 %/lap, any compound | a driver factor on the AI's measured rate: default 1.5; profile entries DR 1.25, Asym 1.65 | 13 human stints in 8 races; human rates 1.3–7.3 %/lap (§4) | medium (DR 4 normal stints, Asym 8) |
| Profile and calibration wear entries | pooled over every race | keep the race length (set laps / full laps) with each source; normalise to full length or key by length band | Suzuka 19 vs 53 laps ×2.0–2.1; 35 % races ×2 (§4) | medium: one same-track pair, plus 3 races consistent |
| Inter wear against wetness (forecast) | none | `rate × (1 + 0.06 × (w_now − w))` per s of w, inters only | +0.076 ± 0.006 %/lap per s, 3 races, 46 car-stints (§3) | medium (the relative form ranges 0.03–0.09) |
| Slick wear on damp; wet wear against wetness | none | none (keep) | no slick lap at w > 1.5 s; wets +0.03 %/lap per s, Miami only | n/a |
| Track temperature in wear | none | none (keep) | no relation across or within tracks (§4) | medium |
| Corner factors for humans | one factor on the worst corner | per-corner rates from the human's own stints; on slicks the fronts' factor ~1.5 × the rears' | 7 of 10 human slick stints front-worst, AI 3 % (§2) | medium |
| `degradation.defaultNuMsPerLap` for inters and wets | 150 ± 100 ms/lap (all compounds) | inter 15 ± 30 ms/lap at steady wetness; wet not measured | Mexico 11 ms/lap (18 stints, 952 laps); per % −41 ± 37 net of the trend (§5) | medium: one steady race |
| ν on a drying or wetting track | the stint fit takes the track trend: −331 ms/lap at Silverstone | fit inter and wet stints on laps minus the field's common mode per type (as `driver-noise` does), or hold ν at its prior while track-wetness moves | §5; the per-% loss net of the trend is +124 ± 84 ms/% drying, −41 ± 37 steady | medium |
| `degMsPerLap` and wear rate after a stop to another compound (DP, MC) | the fitted set's for every compound | per compound: that compound's rate (prior row) and its ν (calibration, or the per-compound prior) | §4, §5; Silverstone's medium inherited the drying inter's terms (§9) | high that it is wrong; the size not measured |
| track-wetness without a dry reference (after a restart; a race that starts wet) | no state, so `forecast-field` takes a dry track (0 ± 1.5 s) | a per-track dry-reference prior (a calibration entry, or the newest stored dry session of the track), so the state is known from the first inter lap | §9 replay: no state on any lap at w 10.5–18 s | high that it matters; the source is a design choice |
| DP wetness over the race | today's state on every lap | track-wetness's forecast per lap (the MC's rain timeline) | §9; Silverstone settled at w 10.7 s under 78 % rain (§7) | medium |
| `coldTyreLap1Ms` (out-lap) | 410 ms (× 3.4 wet) | 0 where the pit loss is measured from in + out laps; move the wet cost to laps 2–3 | the out-lap is in the measured pit loss; research 12's 0.41 s was a flying lap (§6) | medium |
| `coldTyreLap2Ms` and a lap 3 term | 0; no lap 3 | dry 0 (keep); inters +800 (lap 2), +650 (lap 3), replacing the wet factor | Mexico, 18 AI stints, confounded with the track (§6); Spa soft −2 s fresh peak not adopted | low (one wet race) |
| `crossover.line110` | 1.10 | 1.075, or the lap model's own crossing oI / (1 − sI) on the dry reference | Singapore crossing at 6–8 s (106–108 %); Silverstone stay-out at 109–110 % (§7) | low: one crossover, one stay-out |
| `interMsPerWetnessMs`, `interOffsetMs`, `wetMsPerWetnessMs`, `wetOffsetMs` | 0.5, 3,500, 0.25, 8,100 | keep; no new overlapping data | §7 | low (as research 19) |
| Settled wetness under steady rain (research 19 wetness proposal 2) | MC rains with chance rain %; ceiling 16 s | a target level by rain %: 78 % → ~10.7 s, 80–88 % → ~14.4 s, storm → ~15 s | Silverstone, Singapore (§7) | low: three spells, two races |
| `convexFromPct` 40, `convexMsPerPct2` 2.5 | flagged prior | keep; wear is linear in age (the term is on lap time) | §2; research 19 §3 | n/a |
| Track-file `compoundOffsetsMs` | prior with sd 500 ms | Silverstone hard → config default (+500) until the generator uses a dry year; flag soft offsets > 0 | §8: Silverstone hard ≤ ~+1 s; soft −0.3 to −1.2 s where measured | high (Silverstone hard), medium (soft sign) |
| Excluding Silverstone 2026-11-14 inters from DR's profile and the Silverstone set | live checklist idea | exclude (or keep with its wetness and the race length) | DR's factor 1.86 × against 1.21–1.34 normally (§4, §9) | medium |

## 11. Not measurable, and recordings wanted

**Not measurable:**
- Slick wear and warm-up on a damp track: no slick lap at w > 1.5 s.
- The inter's wetness slope (sI) and so the four wet values.
- Track temperature against wear: no hot and cool session at one track with one race length.
- Wear against carcass heat on slicks, and against setup pressure (research 20 §8).
- The race-length curve: one same-track pair (19 vs 53 laps).
- The cold-tyre term on the out-lap: confounded with the pit lane.
- A drying stop: no car stopped in the recorded part of Silverstone.

**Recordings wanted** (beside research 20 §8):
- **One track, two race lengths** (for example 25 % and 100 %), dry, same compounds: the race-length factor for wear and ν.
- **A drying race where a car stops for slicks while others stay on inters:** sI, the crossover, and slick warm-up on a damp track.
- **A full race at the same track as a calibration set's short races:** to check that a normalised rate carries over.
- **Long dry stints of our cars on each compound** (8+ laps), to fix DR's and Asym's factors per compound and corner.
