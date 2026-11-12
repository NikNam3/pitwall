# Pass curve: the pooled fit

SP4.3a plan Task 13, 2026-11-12: `race-interaction`'s pass curve fitted on every F1 25 recording that passes the spec §5.5 filter, and the two O14 checks. Throwaway code on branch `spike/4.3a-pass-fit` (never merged; worktree `../pitwall-wt/spike-4.3a-pass-fit`, commit dba7f0da): `spike/extract.ts` (the engine over each recording, as `scan-situations`), `spike/filter.ts` with 9 builder tests, `spike/pass-fit.ts` (`followingEpisodes` and `excludedLap` from the unit, `fitPassCurve` with shrinkage 0 and DRS zones left out, Fisher errors and a race bootstrap of 1,000 reps), results in `spike/out/pass-fit.json` and `pass-fit.relaxed.json`. The values went into `packages/analysis/src/race-interaction/config.ts`.

**Labels:** every number states its data; **thin** marks too few cases.

## 1. Recordings

Kept (each classified by its chequered flag; none has a FinalClassification packet):

| Race | AI difficulty | Usable laps | Notes |
|---|---|---|---|
| Mexico 2026-10-30_15-20-41 | 62 | 1,048 | wet |
| Miami 2026-10-30_18-53-00 | 62 | 245 | wet |
| Texas 2026-11-05_00-13-26_car19 | 65 | 256 | dry |
| China 2026-11-02_15-17-14 | 90 | 144 | dry |

Dropped: no classification — Singapore 2026-10-29_00-04-08 (difficulty 90; SEND at lap 45 of 62) and Zandvoort 2026-10-29_23-00-37 (70; the stream ends after our retirement): the "relaxed" set; 0-lap races 2026-10-28_00-15-04, 2026-10-29_22-48-50, 2026-11-05_00-09-56; time trial 2026-10-27_23-31-43; qualifying 2026-10-28_23-53-34, 2026-11-05_00-05-11; practice 2026-10-29_22-39-31, 2026-10-29_22-54-58, 2026-10-30_18-26-27, 2026-11-04_23-32-45; no Session packet (menu, lobby) 2026-10-27_22-50-28, 2026-10-29_22-35-28_unknown-session. Singapore's flashback defect (research 12 §7) is gone.

## 2. Curves

Per braking zone, `p = cap / (1 + exp(−(level + slope · advantage)))`; slope per s = `slopePerMs` × 1000; cap fixed at 0.6; Fisher SE, bootstrap SE in brackets.

| Fit | Races | Episodes | Zones | Passes | Level | Slope per s | p at 0 / 0.5 / 1 / 2 s |
|---|---|---|---|---|---|---|---|
| Pooled, dry | 2 | 119 | 382 | 30 | −2.106 ± 0.32 (0.63) | 0.33 ± 0.36 (0.44) | 6.5 / 7.5 / 8.7 / 11.4 % |
| **Pooled, joint (wet term)** | 4 | 333 | 892 | 52 | **−2.267 ± 0.32 (0.48)** | **0.56 ± 0.35 (0.45)** | 5.6 / 7.2 / 9.2 / 14.4 % dry |
| Band 0–79, joint | 3 | 297 | 791 | 39 | −2.677 ± 0.41 (0.28) | 0.70 ± 0.42 (1.10) | 3.9 / 5.3 / 7.3 / 13.1 % dry |
| Band 80–110 (China) | 1 | 36 | 101 | 13 | −0.955 ± 0.56 | −0.54 ± 0.73 | 16.7 / 13.7 / 11.0 / 7.0 % |
| Relaxed pooled, joint | 6 | 459 | 1,509 | 62 | −3.065 ± 0.24 (0.46) | 0.74 ± 0.24 (0.18) | 2.7 / 3.8 / 5.4 / 10.3 % |

- **Bands:** China lies above Texas only at small advantages (z ≈ 2 at 0–0.5 s, nothing at 1 s or more), each band is one race on one track (track and difficulty confounded), and the 90 band's slope is negative; with Singapore and Zandvoort the bands differ by z ≤ 0.63 everywhere. **One curve** (ruling R39; T4: the bands share it, "AI difficulty 62–90" in its source).
- **Wet factor** 0.56 (bootstrap SE 0.28, 90 % 0.23–0.99; Mexico and Miami, 510 wet zones, 22 passes); relaxed 0.94 ± 0.39. Confounded with band 0–79. **Thin.**
- **Cap:** not identifiable (log-likelihood flat from 0.2 to 1.0); 0.6 stays assumed.
- **Slope** within 1–1.5 SE of zero in the spec set: the data barely see the pace advantage. **Thin.**
- **DRS** (outside the fit): dry DRS zones show about ×3.3 the passes the curve without DRS predicts (5 in 18 zones), ×4.9 in the relaxed set (22 in 110); the config has ×1.2. **Thin** — for 4.3b.

## 3. O14

- **The car ahead's loss while a faster car is held behind it:** lap residual against the share of segments a faster car sat within 0.52 s: +120 ms per fully held lap (bootstrap SE 324, 90 % +32 to +952; 881 laps, 19.3 held-lap equivalents); relaxed −136 ms (SE 170). Mexico, with the most held laps, +9 ms. No loss; TUM's 0.3 s not supported. `heldLossMsPerLap` 0. **Thin.**
- **Rejoin push-back:** 6 green rejoins with a car within 2 s (5 within 1 s, one of them passed); the 4 that stayed behind merged at 23, 360, 633, 787 ms and later came to a median 204 ms before the gap opened by pace. Nobody is pushed back to 0.4–0.5 s; `rejoinPushBackMs` 0. **Thin** (5 cases, 2 races).

## 4. What went into the config

`passLevel` −2.267, `passSlopePerMs` 0.000556, `passCap` 0.6 (assumed), `wetFactor` 0.56 (the spec set, 4 races), both difficulty bands on this one curve, `heldLossMsPerLap` 0, `rejoinPushBackMs` 0. Open for later fits: whether the §5.5 classification rule should admit Singapore and Zandvoort (smaller errors), DRS's pass factor, the per-track refinement through calibration sets as races come in.
