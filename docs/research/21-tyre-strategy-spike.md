# 21. Tyre data for the strategy model

2026-11-14. What the recordings say about the strategy model's tyre terms: the wear rate and how many laps it needs, wear against wetness, track, track temperature and driver, degradation, warm-up, the wet slopes, the compound offsets, and the Silverstone race of 2026-11-14 read with all of it. Written after research 20 and the live test of 2026-11-14 (`docs/acceptance/live-checklist.md`, "2026-11-14: live test notes").

**Data and code.** The 1 Hz samples and car-laps of research 20's spike (55 recordings of `recordings/` and `~/.local/share/pitwall/recordings/`, decoded with `packages/protocol`, flashback-undone samples dropped). The new scripts are in the helper repo, `~/dev/personal/pitwall-research/tyre-spike/strategy/` (cited `strategy/<script>`). One harness (`strategy/capture.ts`) replays the Silverstone recording through the bridge pipeline as `pitwall strategy` does and logs the strategy job's view; nothing is stored.

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
4. **The game scales wear with the race-distance setting** (the menu's race length, Session `m_sessionLength`; user correction 2026-11-14). Medium long wears about 2.1 × faster than full at Suzuka (same track, compound, temperature); across tracks 1.6–1.9 ×, confounded by the track. Practice follows the weekend race's setting. Calibration sets and driver profiles pool settings without knowing it (§13).
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
13. **The no-stop plan was cut by the candidate cap, against the spec (§12).** The DP built it but, planning on a dry track at every lap, ranked it 15th–18th of 83; `dpPlansMax` 8 then dropped it, while spec §6 asks for the best plan per stop count. At 4,000 runs on lap 39 it wins 41–46 % (E[pos] 2.6–2.8), against 2.4–3.3 % for the L47 medium stop the panel showed.

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
- **The race-distance setting doubles the rate at medium long, about a third of the distance (§13):**
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

**Does the 2.0 %/lap default (`driverNoise` config `humanWearRatePct` and `defaultWearRatePct`; a profile's own value is `driverNoise.wearRatePct.<compound>`) hold?** Only as an average over full-length races:

| Race length | Inters | Slicks |
|---|---|---|
| Full | 1.3–1.6 (Mexico, Singapore) | 1.8–4.4 (Singapore 2.1, Spa 3.15 and 1.8, Suzuka 4.4) |
| About a third | 3.3 (Miami) | 3.3–7.3 (Texas, Suzuka 19 laps) |

The default is used where the car has no own rate on a compound: for a human, the next compound after a stop. There it misses by up to 3.6 ×.

**Proposal:** a human without a profile rate takes the AI field's measured rate on that compound this session × a driver factor (default 1.5; DR 1.25, Asym 1.65 as profile values); the 2.0 only when no car has run the compound. Profiles and calibration sources keep the race-distance setting (`m_sessionLength`; practice: the weekend race's) and normalise the rate to full length, or are kept per setting (§10, §13).

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
1. **The dry wetness prior** (replay above): with no dry reference, the medium looks 3.5 s/lap faster than the inter. This is the largest in the ranking; the candidate cap then drops the no-stop plan that ranking puts low (§12).
2. The DP and the MC take one wear rate (the fitted compound's) and one `degMsPerLap` (its ν / rate) for every compound (`shared/strategy-input/dp-input.ts`, `race-forecast/field.ts` `fitStop`). With ν at the prior, the inter's 75 ms per % weighs against it. Once ν went negative (§5), a medium inherited a negative degradation too.
3. The DP holds the wetness at today's value for every lap (`wetnessByLap` filled with the current state).
4. `crossover`'s 110 % line read 108–109 % as "slicks faster", 2–3 % early for this game (§7).

In the replay "no stop" is the best plan from lap 40; on laps 37–39 it is not among the top 6. §12 traces why: the DP ranks it 15th–18th on a dry track and the `dpPlansMax` cap drops it.

**The cause of the wear (user: setup and drying, both).** Drying alone raised the AI's inter rate × 1.7 (1.06 → 1.84). Car 19's went × 1.9 (2.0 → 3.7), so its excess over the AI held at 1.9–2.0 × against DR's normal 1.25 ×. Part of the excess is the overheat that research 20 §7.3 measured; how much is setup is not measurable. For profiles and sets: this stint is 1.5 × DR's usual factor, and an exclusion as the checklist proposes is consistent with the data.

## 10. Proposals

For the user to decide; no code here.

| Model term | Now | Proposed | Evidence | Confidence |
|---|---|---|---|---|
| Live wear rate (`per-lap-rate` median of gains, `wearRatePerCorner`) | median of the newest ≤ 5 whole-percent gains, from 2 gains | cumulative gain over the newest ≤ 5 green laps / laps (or a least-squares slope of wear on age) | median stays 15–27 % off at every n; cumulative 6 % at n = 3 on slicks (§2) | high: 10 races, 177 slick and 65 inter stints |
| Minimum before a rate is used (`tyre-life.minLaps`, `per-lap-rate.minSamples`) | 3 stint laps, 2 gains | 3 gain laps **and** 5 % accrued at the worst corner; before that a prior (next row) | 5 % / 12 % error on slicks, 7 % / 25 % on inters at that point (§2) | high (slicks), medium (inters) |
| Wear prior without a measured rate | none (age basis) for `tyre-life`; 2.0 %/lap in `driver-noise` | the AI field's rate on the compound this session × the driver factor; then the calibration set's; then a per-compound default × the race-distance setting's factor (§13) | AI rates per compound and track (§4) | medium |
| Fresh-set and fitted-set life on the age basis (`ageLossLimitMs` / ν) | used whenever there is no wear rate; the default ν gives 13.3 laps | `insufficientData` (or flagged) while ν is the prior; never the age basis for inters and wets | the 13.3 = 2,000 / 150; inter ν 11 ms/lap at steady wetness (§2, §5) | high |
| `driverNoise.humanWearRatePct` / `defaultWearRatePct` | 2.0 %/lap, any compound | a driver factor on the AI's measured rate: default 1.5; profile entries DR 1.25, Asym 1.65 | 13 human stints in 8 races; human rates 1.3–7.3 %/lap (§4) | medium (DR 4 normal stints, Asym 8) |
| Profile and calibration wear entries | pooled over every race | keep the race-distance setting (`m_sessionLength`; practice: the weekend race's) with each source; normalise by a measured table per setting (full 1.0, medium long 2.1, others unknown and not pooled) | §13 | high that it exists; medium on its size away from Suzuka |
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

## 12. The missing no-stop plan and the lap-39 win chance

Recording `2026-11-14_00-04-26_…_car19` (Silverstone, laps 36–52, sidecars: set `pitloss-22`, no profiles). Tooling in `~/dev/personal/pitwall-research/tyre-spike/strategy2/`: `capture-inputs.ts` replays the recording through the bridge pipeline as `pitwall strategy` does and saves the `strategy` job's input (`StrategyInput`) at the first prepare after car 19 completes each lap (`inputs/lapN.v8`); `dp-trace.ts` runs car 19's DP and `candidatesOf` on a saved input; `mc-many.ts` runs the job as it is, then scores the final call's candidates plus two no-stop plans together on N common scenarios (`race-monte-carlo`'s `scoreAll`, nothing dropped), with env switches `RAIN_PCT`, `WET_MS`, `NO_STOP_11`, `PACE11_AS_19`.

"Lap N" means the job's run once car 19 has completed lap N, planning from lap N + 1. §9's "lap 37–39" rows are laps 38–39 here (the first prepare at lap 37 has no starting point yet).

### Question A: why the no-stop plan was missing on laps 37–39

**Short answer.** The DP builds the zero-stop plan; the candidate cap throws it away, because the DP ranks it 15th to 18th of 83 plans. It ranks it that low because it plans on a dry track (w = 0 on every lap), where a medium stop is 34–35 s faster than staying out. The Monte Carlo, which rains in 77 % of its scenarios, would have ranked no-stop first by a wide margin. The DP picks the candidates in one world and the MC scores them in another. Inter → inter is built and scored, and correctly loses.

**The code path.**

1. `feasibleSequences` (`packages/analysis/src/strategy-dp/state.ts:102–119`) emits the empty sequence whenever `ruleMet` holds (`state.ts:73–74`). The rule is waived here (`owesSecondCompound` false, from `field.owesStop`, `shared/strategy-input/dp-input.ts:105`), so the zero-stop plan is always among the DP's plans; the same holds once the rule is met. Inter → inter is a sequence too (car 19 had 3 new inter sets, `dp-input.ts:87–88`).
2. `plansOf` (`state.ts:440–447`) gives one plan per sequence, 83 here, sorted by expected time.
3. `candidatesOf` (`packages/analysis/src/strategy/candidates.ts:73–76`) keeps the best `dpPlansMax` = 8 (`strategy/config.ts:13`, Task 23a ruling) by `expectedMs`, then adds box-now and stay-out (`candidates.ts:82`).
4. `stayOut` is **not** "no stop to the flag": it is the best closed-loop play without a stop at the end of this lap (`strategy-dp/index.ts:11–13, 71`), here "box next lap for mediums". Nothing puts the zero-stop plan back once the cap has cut it.
5. The neighbour and rule candidates (`candidates.ts:86–108`) move the best plan's stops, so they too are medium stops.
6. The rain filter (`rainCanCome`, `candidates.ts:52–58, 72`) is not the cause: 76–77 % rain passes `rainCandidatePct` 25.

**What the DP saw:**

| Lap | DP `degMsPerLap` | Rate (%/lap) | DP best | No-stop: rank / gap | Inter → inter: rank / gap | Zero-stop among candidates |
|---|---|---|---|---|---|---|
| 38 | 75 | 2 | L39 medium | 18 of 83 / +35.2 s | L43 inter: 33 / +43.3 s | 0 of 14 |
| 39 | 98 | 1.5 | L40 medium | 15 / +34.4 s | L43 inter: 26 / +41.4 s | 0 of 14 |
| 40 | 44 | 2 | L41 medium | **8** / +24.0 s | L44 inter: 16 / +38.2 s | 1 of 13 (cap's edge) |
| 41 | 6 | 2 | L42 medium | 3 / +14.6 s | L50 inter: 16 / +34.7 s | 1 of 13 |
| 42 | −17 | 2 | L43 medium | 3 / +7.3 s | L51 inter: 10 / +28.5 s | 1 of 13 |
| 44 | −80 | 2 | no stop | 1 | L51 inter: 4 / +23.8 s | 2 of 9 |

- **The DP's wetness is 0 on every lap.** `start.wetness` is `{ wetnessMs: 0, sdMs: 1500 }`, the dry prior `forecast-field` gives without a track-wetness state (`shared/forecast-field/index.ts:360–363`), and `dpInputOn` copies it to every lap (`dp-input.ts:109`). On a dry track the inter is 3.5 s/lap behind the medium (`compoundOffsetMs.inter` 3,500), so every sequence starting with a dry stop beats staying out, including pointless ones ("L39 medium, L46 medium" +14 s, "L39 medium, L51 inter" +23 s). They fill the 8 slots.
- No-stop reached the cap on lap 40 only because the inter's `degMsPerLap` fell (98 → 44 → 6 → −17 ms/lap, the stint fit taking the drying, §5) and the race got shorter. The medium inherits that `degMsPerLap` and wear rate (`dp-input.ts:84–85, 100`).
- **The MC disagrees with the DP by about 58 s.** At lap 39 its mean race time puts no-stop 23.5 s ahead of the L47 medium stop (1,465.9 against 1,489.4 s, 4,000 scenarios); the DP puts the L40 medium 34.4 s ahead of no-stop. The MC's rain timeline (`race-monte-carlo/weather.ts:25–39`) draws one uniform per scenario: in about 77 % it rains every lap (track 0 → 8.5 → 16 s, `constants.ts:32, 39`) and inters win; in about 23 % it stays dry and the medium wins. The DP sees only the second world.
- The no-stop plan the job would score carries the best plan's neutralised triggers (`candidates.ts:71, 82–83`, `thresholds.ts:52–87`): "box for mediums under any SC or VSC on laps 40–50", the checklist's SC/VSC "box for mediums". In the MC that costs 0.24–0.26 places.
- **Inter → inter is a correct result:** generated, ranked 10th–33rd, 24–43 s behind. On a known wet track (`WET_MS=15000`, lap 39) it is second, 8 s behind no-stop; fresh inters pay 22 s of pit loss for little gain.

**Verdict.**
- The cap dropping the zero-stop plan is a **bug against the spec**: SP4.3b spec §6 asks for "the best base plan per stop count (0 to 3)", §8.1 for the DP's base plans as candidates. The Task 23a cap (best 8 of all sequences) can drop a whole stop count.
- The DP's constant wetness (`dp-input.ts:109`) contradicts spec §6 ("the plain forecast's wetness path") and `strategy-dp/types.ts:36–37`: a **bug**, and deferred item 11.
- The dry prior after the restart (§9) and the inter's ν and wear inherited by the medium (§10): **input and spec gaps**.

### Question B: the lap-39 win chance with many more runs

`pitwall strategy` has no run-count flag: a replay takes `n0` and `maxScenarioPolicies` from the recording's config sidecar (`apps/bridge/src/feature-config.ts:175–185`, C47), and the search stops once the leader is clear, so the job showed 80 scenarios. The runs below call `scoreAll` on the saved job input. Car 19 led car 11 by 0.35 s, teammate car 0 in P3 12.8 s behind.

| Plan (lap 39) | Runs | E[pos] | P1 (± SE) | P2 | P3 | P ≥ 4 | p10 / p50 / p90 |
|---|---|---|---|---|---|---|---|
| Live (the panel) | 80 | 3.96 | 0.05 | | | | P50 P3 |
| L47 medium, the job's best (replay, seeds 1 / 7) | 80 | 4.22 / 4.54 | 0.025 / 0.025 | 0.15 / 0.13 | | | 4 |
| L47 medium | 4,000 (seed 1) | 4.09 | 0.024 ± 0.002 | 0.138 | 0.246 | 0.591 | 2 / 4 / 6 |
| L47 medium | 4,000 (seed 7) | 4.08 | 0.033 ± 0.003 | 0.132 | 0.260 | 0.576 | 2 / 4 / 6 |
| L40 medium (box now) | 4,000 | 5.88 | 0.074 ± 0.004 | 0.127 | 0.030 | 0.768 | 2 / 6 / 9 |
| **No stop, with the SC/VSC "box medium" triggers** | 4,000 (seeds 1 / 7) | **2.81 / 2.81** | **0.410 / 0.406 ± 0.008** | 0.190 | 0.137 | 0.263 | 1 / 2 / 5 |
| No stop, pure | 4,000 (seeds 1 / 7) | 2.57 / 2.55 | 0.462 / 0.462 ± 0.008 | 0.203 | 0.135 | 0.200 | 1 / 2 / 5 |

About 1.7–1.9 % of scenarios end in a retirement (counted as P20).

**The 5 % holds, for the plan it was given** (2.4–3.3 % at 4,000 runs; the live 0.05 was 4 of 80). It is an artefact of the candidate set: staying out, which the MC never saw, wins in 41–46 % with E[pos] 2.6–2.8.

**Laps 38–41, 4,000 common scenarios each:**

| Lap | No stop, pure: E[pos] / P1 | No stop with triggers | The job's best as shown | That plan at 4,000 |
|---|---|---|---|---|
| 38 | 2.26 / 0.691 | 2.48 / 0.633 | L46 medium (80 runs): 3.66 / 0.138 | 3.60 / 0.131 |
| 39 | 2.57 / 0.462 | 2.81 / 0.410 | L47 medium (80): 4.22 / 0.025 | 4.09 / 0.024 |
| 40 | 2.12 / 0.553 | 2.38 / 0.496 | no stop with triggers (40): 2.23 / 0.550 | 2.38 / 0.496 |
| 41 | 1.77 / 0.669 | 2.03 / 0.611 | no stop with triggers (40): 2.00 / 0.650 | 2.03 / 0.611 |

**What moves the lap-39 answer** (2,000 runs each, ± 0.011; no stop pure / with triggers):

| Variant | E[pos] | P1 | Reading |
|---|---|---|---|
| As recorded | 2.57 / 2.81 | 0.46 / 0.41 | |
| Rain every lap (`RAIN_PCT=100`) | 2.00 / 2.46 | 0.59 / 0.51 | the dry 23 % costs about 0.13 of P1 |
| Never rain (`RAIN_PCT=0`) | 5.07 / 4.42 | 0.03 / 0.05 | in a dry world the L40 medium wins: 2.16 / 0.356 |
| Track at w 15 s from the start (`WET_MS=15000`) | 2.50 / 2.49 | 0.47 / 0.45 | triggers box for inters and cost nothing; the DP's own best becomes "no stop" |
| Car 11 does not stop (its `rival-stops` window was L43–51; it never stopped) | 2.87 / 3.07 | **0.29 / 0.26** | the predicted 22 s stop of the car behind adds about 0.17 of P1 |
| Car 11 no stop, pace equal to car 19's (it was 0.40 s/lap faster) | 2.80 / 3.01 | 0.35 / 0.31 | |

**What limits the answer:**
- **The candidate set** (Question A): the largest effect, 4 % against 41–46 %.
- **3 laps of history per car after the restart:** car 11's pace (0.40 s/lap faster, `paceSdMs` 500) and stop window, car 19's ν (a drying-track stint fit), and car 19 on the human defaults (no profile: σ 450 ms, 5.3 % mistakes per lap, against car 11's 200 ms and 2.4 %) swing P1 between 0.26 and 0.59.
- **The first recording cannot be joined.** A restart is a new run with an empty log (C21); `view.weekend` holds only earlier sessions (C62); storage keeps only the second run of the session uid. Laps ~22–36 (`2026-11-13_23-41-39_…`) held the slick laps `track-wetness` needed as its dry reference, and about 15 more laps of pace, ν and wear per car. Joining them is a contract change.
- **The model's wetness:** a dry prior at the start, and rain read as "every lap or never" (research 19); the truth, a track settling at w ≈ 10.7 s, is neither of the MC's worlds.
- **The result:** car 19 finished P2, passed by car 11 on lap 50; one draw, consistent with a P1 of 0.3–0.5.

### Proposals

For the user to decide; no code here.

| # | Proposal | Evidence | Where |
|---|---|---|---|
| 1 | Always keep the DP's best plan of each stop count (0 to 3) among the candidates, besides the `dpPlansMax` best; the zero-stop plan whenever the rule is waived or met | spec §6 / §8.1; cut at ranks 18 and 15 on laps 38–39 | `candidates.ts:73–76` |
| 2 | Give the zero-stop and stay-out candidates their own SC/VSC thresholds (or none), not the best plan's "box for mediums"; score a pure stay-out row too | 0.24–0.26 places at laps 39–41 | `candidates.ts:71, 82–83`; `thresholds.ts:52–87` |
| 3 | Feed the DP the wetness path the spec names (the plain forecast's, or the MC's expected path), not today's value on every lap; or run the DP once per weather world and take both worlds' candidates | DP and MC 58 s apart at lap 39 | `dp-input.ts:109`; deferred item 11 |
| 4 | A dry-reference prior for track-wetness after a restart or a wet start (§10) | with `WET_MS=15000` the DP's best is "no stop" | `forecast-field/index.ts:360–363` |
| 5 | Per-compound ν and wear after a stop (§10) | laps 40–44: the no-stop rank moves with the inter's ν alone | `dp-input.ts:84–85, 100` |
| 6 | Rename or redefine "stay out": it means "not this lap", the panel reads "to the flag" | `strategy-dp/index.ts:11–13` | display wording or DP output |
| 7 | A rival stop window for a car on inters in steady rain with low wear needs evidence | car 11's L43–51 window moved P1 by 0.17 | `rival-stops` |
| 8 | Resume a session after a bridge restart: join the earlier recording of the same session uid | 3 laps of history; no dry reference | bridge, storage; contract change (C21, C62) |
| 9 | A `--runs n` (or `--config`) override for `pitwall strategy`, for checks like this | Question B | `apps/bridge/src/cli/commands/strategy.ts` |

## 13. Wear against race length

**Correction (user, 2026-11-14): the wear scale follows the race-distance setting chosen in the game's menu, not the race length as such.** The setting is the Session packet's `m_sessionLength` (Structs.txt:164: 0 none, 2 very short, 3 short, 4 medium, 5 medium long, 6 long, 7 full). In our race sessions: 7 full (12 sessions), 5 medium long (28 sessions, 19–20 laps), 6 long (1, a 10-lap sprint, Shanghai), 3 short (1, 5 laps); practice and qualifying carry 0, so their setting comes from the weekend's race session. Everything below measured the "fraction" of the set laps; read each fraction as its setting: 35 % = medium long (5), 100 % = full (7). The factor is per setting: **full 1.0, medium long ≈ 2.1** (Suzuka); very short, short, medium and long are not measured. A table keyed on `m_sessionLength` is the right form (proposal 2); the power-law fit in fraction is only a description of two settings.

The question: does F1 25 scale tyre wear with the set race length, by how much, and is it the race length or something else? This section re-checks §4's claim, which rested on one same-track pair (Suzuka).

**Data and code.** The same 1 Hz samples and car-laps as §2–§4 (`strategy/B.pkl`). New scripts in `~/dev/personal/pitwall-research/tyre-spike/racelength/`:
- `settings.ts` decodes one populated Session packet per recording (the first one with the weekend structure set; the very first packets carry zeros for the settings) → `settings.jsonl`.
- `pooled.py`: rates per recording and compound.
- `pairs.py`: same-track pairs, with a car-stint bootstrap.
- `fit.py`: the cross-session fit.

**Measure.** AI cars only unless stated. The rate is the pooled mean gain per green lap at each corner (green as in §2: no pit, no SC or VSC, no in-lap or out-lap, tyre age ≥ 2), so every lap carries the same weight. The worst corner is the corner with the highest pooled mean (a rear in every AI case here). The race-length fraction is set laps ÷ the real Grand Prix's laps.

### Session settings

The Session packet carries no tyre-wear setting. The settings that could matter are the same in every race and practice session used here: car damage `Simulation` (3), damage rate `Simulation` (2), surface `Realistic`, tyre temperature `Surface & Carcass`. These do vary:

| Setting | Values seen |
|---|---|
| `aiDifficulty` | 62–110 |
| `networkGame` | Zandvoort and the 2026-11-10 Suzuka weekend are online |
| `lowFuelMode` | 1 at Singapore, Shanghai, Spa, Silverstone; 0 elsewhere (both Suzuka weekends 0) |
| `sessionLength` | 7 full, 5 at the 35 % races, 6 at the Shanghai sprint, 3 at the 5-lap race |

**A practice session's packet does not carry the race length:** `sessionLength` 0, `totalLaps` 1–2. The weekend's race length is known only from the race session with the same `weekendLinkIdentifier`.

### Same track, different length (the clean comparison)

Suzuka is the only track recorded at two lengths. It was run in three weekends:

| Weekend | Recordings | AI difficulty | Online |
|---|---|---|---|
| 19 laps | practice `2026-11-06_01-35-27` | 65 | no |
| 19 laps | race `2026-11-06_21-58-52`, `_22-09-23`, `_22-23-46` (restarts of one race, laps 3–5) | 90 | no |
| 19 laps | practice `2026-11-10_23-22-46` | 80 | yes |
| 53 laps | practice `2026-11-06_23-11-26`; race `2026-11-07_00-00-21`, `_00-24-06` (laps 3–10) | 80 | no |

Short ÷ full, AI, 95 % interval from a car-stint bootstrap:

| Comparison | Compound | Short | Full | Worst | Rear | Front | Stints (gain laps), short / full |
|---|---|---|---|---|---|---|---|
| Race 19 / race 53 | C2 | 3.93 | 1.88 | **2.09** [1.99, 2.19] | 2.10 | 2.27 | 29 (56) / 12 (60) |
| Race 19 / race 53, laps 3–5 only | C2 | 3.93 | 1.90 | 2.07 [1.96, 2.20] | 2.13 | 2.14 | 29 (56) / 12 (30) |
| Race 19 / race 53 | C3 | 4.67 | 2.26 | **2.06** [1.98, 2.14] | 2.05 | 2.12 | 9 (18) / 26 (125) |
| Race 19 / race 53, laps 3–5 only | C3 | 4.67 | 2.28 | 2.05 [1.96, 2.15] | 2.05 | 2.07 | 9 (18) / 25 (61) |
| Practice, 19-lap weekend / 53-lap weekend, both AI 80 | C2 | 3.37 | 1.60 | **2.11** [1.88, 2.27] | 2.12 | 2.01 | 9 (19) / 7 (15) |
| Practice, 19-lap weekend (AI 65) / 53-lap weekend (AI 80) | C2 | 3.00 | 1.60 | 1.88 [1.70, 2.00] | 1.88 | 1.82 | 5 (10) / 7 (15) |
| Practice, 19-lap weekend / 53-lap weekend | C3 | 4.00 | 2.10 | 1.90 (thin) | 1.88–2.00 | 1.58 | 2–3 (2–3) / 10 (10) |

**Within one weekend, practice against its own race:**

| Weekend | Compound | Practice ÷ race |
|---|---|---|
| Suzuka 53 laps | C2 | 0.85 |
| Suzuka 53 laps | C3 | 0.93 |
| Suzuka 19 laps | C2 | 0.82 |
| Suzuka 19 laps | C3 | 0.86 |
| Texas 20 laps | C3 | 0.94 (11 / 19 stints) |

- **At Suzuka, 35 % of the distance wears 2.05–2.11 × faster than full distance**, on C2 and C3, at every corner (front 2.0–2.3, rear 2.0–2.1). The intervals are narrow, but the 19-lap race laps come from three restarts of one race with the same 19 cars, so the true uncertainty is wider. Read it as about 2.1, ± 0.15.
- **Practice is scaled by the weekend's race length too**, by the same factor (2.1 at the same AI difficulty), although its own packet shows no race length. Practice wears about 0.85–0.94 × its own race at either length, so the scale applies to the whole weekend, not to the race session alone.
- **It is not `rate × fraction = const`.** Full scaling would give 1 / 0.358 = 2.79 ×, and every interval above stays under 2.4. As a power law `rate ∝ fraction^−k`, Suzuka gives **k = 0.70 [0.65, 0.73]** (10 session-compound cells, rms log residual 0.02).

### Across tracks

| Race (recording) | Fraction | Compound: AI worst-corner rate (stints) |
|---|---|---|
| Singapore (`2026-10-29_00-04-08`) | 1.00 | C3 1.38 (7), C4 1.59 (12), inter 1.06 (36) |
| Zandvoort (`2026-10-29_23-00-37`) | 1.00 | C4 1.86 (18) |
| Mexico (`2026-10-30_15-20-41`) | 1.00 | inter 0.83 (18) |
| Spa (`2026-11-12_02-21-24`) | 1.00 | C3 2.43 (25), C4 3.46 (44) |
| Silverstone (`2026-11-13_23-41-39`, `2026-11-14_00-04-26`) | 1.00 | C3 1.93 (8), C4 2.20 (10), inter laps 34–41 1.06 (17) |
| Suzuka 53 (`2026-11-07_00-00-21`) | 1.00 | C2 1.88 (6), C3 2.25 (13) |
| Texas (`2026-11-05_00-13-26`) | 0.357 | C1 2.11 (7), C3 3.16 (19), C4 4.56 (12) |
| Miami (`2026-10-30_18-53-00`) | 0.351 | inter 1.88 (11), wet 2.86 (10) |
| Suzuka 19 (3 restarts) | 0.358 | C1 3.1–3.3, C2 3.7–4.0, C3 4.7 |
| Shanghai sprint (`2026-11-02_15-17-14`) | 0.179 of the race, 0.526 of the sprint (19 laps) | C3 4.40 (18) |

Fit `log rate = compound + k · (−log fraction)`, no track term, weighted by stints, sessions bootstrapped:

| Set | k | Factor at 35 % | rms log residual |
|---|---|---|---|
| Slicks, without Shanghai (10 sessions, 20 cells) | 0.53 [0.37, 0.83] | 1.74 | 0.21 |
| Slicks, Shanghai as 10/56 | 0.47 [0.37, 0.75] | 1.64 | 0.22 |
| Slicks, Shanghai as 10/19 | 0.58 [0.40, 1.02] | 1.85 | 0.22 |
| Inters (Mexico, Singapore, Silverstone dry-phase laps excluded, Miami) | 0.60 [0.54, 0.78] | 1.88 | 0.10 |

- **Across tracks the factor is 1.6–1.9, with wide intervals.** The track spread is just as large: C3 runs 1.38–2.43 over four full races, 1.8 ×. With only Suzuka at two lengths, the track term cannot be separated elsewhere. Texas and Miami fit a factor of about 2 only if their tracks wear like the average track.
- **Shanghai cannot say which base the game uses for a sprint.** Its C3 4.40 is 1.8–3.2 × the full-race C3 range. k = 0.7 predicts 3.3 × on the race base and 1.6 × on the sprint base, so the data fits neither clearly. One session, a sprint weekend, no full-length Shanghai to compare with: thin.
- **The form is not identified.** The data has only three lengths: 100 %, about 35 % and one sprint. A power law and a fixed factor per length setting (`sessionLength` 5 → about 2.1) fit equally well. Nothing can be said about 25 % or 50 %.

### Is it race length, or something else?

| Candidate | Evidence | Verdict |
|---|---|---|
| AI difficulty | At AI 80 in practice, the 19-lap weekend wears 2.11 × the 53-lap one. In the 19-lap weekends, AI 65 practice gives C2 3.00 and AI 80 gives 3.37 (1.12 ×; online vs offline and 20 vs 27 °C confound it). The 19-lap race at AI 90 and the 53-lap race at AI 80 differ 2.1 ×, the same as the same-difficulty practice pair. | Not the cause; at most about 10 % |
| Track | Same track in every Suzuka comparison | Excluded at Suzuka |
| Weather / track temperature | All dry; 22–28 °C at Suzuka (the online practice at 20 °C wore *more*). §4 found no temperature effect. | Not the cause |
| Fuel load | The 19-lap race runs laps 3–5 at 35 kg, the 53-lap race at 103 kg. Within a full race wear stays linear while fuel falls by about 100 kg (§2), and a lighter car would wear less, not more. Practice (free fuel) shows the same factor. | Not the cause |
| Lap position in the stint | Restricting both races to laps 3–5 changes nothing (2.07, 2.05) | Not the cause |
| A tyre-wear setting | The Session packet has none; damage, surface and tyre-temperature settings are the same in all sessions | None exists in the telemetry |
| Low-fuel mode, online | The same in each Suzuka pair, or the factor holds across it (the online practice pair gives 2.11) | Not the cause |

**Race length is the only setting that differs between the Suzuka weekends, and it moves wear by 2.1 × in races and in practice alike.** Confidence: high that the effect exists at about 2 × at 35 %; medium on its size off Suzuka; none on its shape at other lengths.

**Humans (secondary check).** Asym's C3 at Suzuka:

| Race | Gain laps | Rate | Factor |
|---|---|---|---|
| 19 laps (3 restarts) | 6 | 7.0 | 1.6–2.0 × |
| 53 laps | 7, 2 | 4.29, 3.50 | |

That fits the AI factor (§4 already shows Asym 1.57 × the AI in the 19-lap race and 1.97 × in the 53-lap one). Every other human same-track comparison has 1–4 gain laps. Thin.

**For the strategy model.** A full-length C2 at Suzuka reaches 70 % in about 37 laps (70 % of the race). At 35 % it reaches 70 % in about 18 laps, 94 % of the race. A short race is therefore much closer to a no-stop race than "same life in laps ÷ 2.79" would suggest: the tyre lasts longer as a share of the distance.

### Consequence for calibration sets and driver profiles

- **An absolute wear rate is only valid at the race length it was measured at.** Pooling a 35 % session with a full-length one mixes values about 2 × apart. In this data that is larger than the track effect for a compound (1.8 ×) and larger than the human factor (1.2–2.0 ×).
- **Practice sessions need the weekend's race length.** Their own packet does not carry it. It comes from the race session with the same `weekendLinkIdentifier`, which a live practice does not know yet, and which a weekend recorded without its race never gives.
- **A ratio against the AI field in the same session cancels the scale.** Human ÷ AI on the same compound and session does not depend on the race length (DR and Asym factors in §4 are such ratios). The AI field runs in every offline session.

### Proposals (for the user to decide)

1. **Store the race-distance setting with every calibration source and every profile session:**
   - `m_sessionLength` of the race session (the key of proposal 2);
   - for practice and qualifying, the setting of the weekend's race session (same `weekendLinkIdentifier`), else `unknown`;
   - set laps and the track's full race laps, as a description only.
2. **Normalise absolute rates to full length with a measured table keyed on the length setting, not a formula:** 100 % → 1.0, 35 % (`sessionLength` 5) → 2.1, from Suzuka. Other lengths (25 %, 50 %, 5 laps, sprints) stay `unknown` until recorded: do not pool them, or pool them only through proposal 3. If one formula is wanted between the measured points, `rate_full = rate × fraction^0.7` (k 0.65–0.73 at Suzuka, 0.5–0.6 across tracks) is the best available, and is unverified away from 35 %.
3. **Keep the driver factor as human ÷ AI in the same session (and compound), not as an absolute rate.** It needs no length normalisation. A profile's absolute rate is then the session's AI rate × the factor.
4. **Live, prefer the session's own AI field rate on a compound over any stored absolute rate**, because it already carries the session's length scale. A calibration set's rate at full length × the table factor is the fallback before the AI field has 3 gain laps.
5. **Record to fill the gaps.** In priority order:
   - a full-length race at Texas or Miami (gives a second same-track pair);
   - one session at another length (25 % or 50 %) at Suzuka or Silverstone (gives the shape);
   - a full Shanghai race (settles the sprint base);
   - a practice of a full-length weekend at the same AI difficulty as a short one (repeats the practice result).
6. ~~Change the research doc's earlier wording (§1 finding 4, §4).~~ Done: §1 finding 4 and §4 now name the setting and the Suzuka 2.1 ×.
