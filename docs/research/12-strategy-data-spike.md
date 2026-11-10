# Strategy model: the data spike

The first proof of concept of SP4.3 (high-level spec `docs/superpowers/specs/2026-11-10-sp4.3-strategy-model-design.md` §8.1), run on 2026-11-10: what the recordings say about the model's parts. Throwaway code on branch `spike/4.3-data` (never merged; worktree `../pitwall-wt/spike-4.3-data`): the extraction `spike/extract.ts`, the analyses `spike/analysis/{drivers,tyres,battles}/`, the full findings `spike/out/findings-*.md`, the datasets and their `SCHEMA.md` and `INVENTORY.md` in `spike/out/`. This file keeps the results; the numbers are inputs for the 4.3a and 4.3b specs, not decisions.

**Labels:** every number states the data behind it; **thin** marks a number resting on too few cases to be more than a hint.

## 1. Data

The extraction drives the engine as `scan-situations` does (decode, session tracker, session runner, realism off), dumps the projection at session end and samples live state once per lap (weather, gaps, wear, fuel).

| Session | Laps (all cars) | Humans | Notes |
|---|---|---|---|
| Singapore race, wet then drying then wet (44 laps) | 812 | car 19 (DR, Ferrari) | the only race with changing weather; engine defect after the lap-5 flashback (§7) |
| Zandvoort race (14 laps) | 276 | two online: car 0 (Asymetrisch, Mercedes), car 1 (DR, Ferrari, named) | 14 stops under SC; ends without SEND |
| Mexico race, constant storm, VSC (70 laps) | 1,275 | car 19 (Mercedes: Asymetrisch, to confirm) | no SC stops |
| China race (10 laps) | 184 | car 19 (DR, Ferrari) | not in `fixtures/index.json`; one stop |
| Miami race, constant storm (20 laps) | 392 | car 19 (Asymetrisch, Mercedes; the friend's game over VPN) | 9 stops under SC, one under VSC |
| Texas race (20 laps) | 400 | car 19 (Asymetrisch, Mercedes; VPN) | the only clean dry green stops; SC on lap 12 |
| Miami and Texas practice | 94 and 73 | Asymetrisch | long runs of 3–6 laps |

Who drove: the user, 2026-11-10: Mercedes cars mainly Asymetrisch (the more erratic driver), Ferrari cars mainly DR. Every human car is one of the two teams; the Zandvoort names agree.

Mostly AI against AI, at difficulty 62–90. Only 5 human car-sessions have 8 or more fitted laps.

## 2. Driver noise

**AI** (2,639 laps, 133 car-sessions):
- The core spread is symmetric (quartile skew 0.06) and small: median σ 138 ms (Singapore), 257 ms (Mexico), 0.13–0.26 % of lap time; in free air 94 and 195 ms. The short races (10–20 laps) give 300–550 ms, which mostly measures cars in trains.
- **A driver's σ does not carry over between races** (correlation of a driver's relative σ between races −0.06 over 242 race pairs; the session explains 51 % of the variance). One field-level AI default, adjusted per session, not a value per AI driver.
- The slow tail is mostly battles, not mistakes: laps beyond 3σ are 9.2 % near another car (167 of 1,808), 2.4 % in free air (17 of 710).
- Free-air mistakes: 2.4 % per lap at k = 3; size median 0.70 s, p90 1.6 s, max 3.1 s; log-normal fits.
- Big events across the AI field: 8 retirements and 6 green laps more than 5 s slow in six races, about 2.3 per race (the user's estimate: 1–2), about 0.5 % per car-lap. 14 events: ±50 %.
- Slow laps cluster (a lap beyond 3σ is followed by another in 27 % of cases against 5.4 %); residuals are correlated from lap to lap (0.14 pooled, 0.28 Mexico).

**Humans:**

| | DR (Ferrari) | Asymetrisch (Mercedes) |
|---|---|---|
| Core σ | 205–331 ms where fitted (Zandvoort, Singapore; China thin), 2.4 × AI in Singapore | 765 ms (Mexico, 59 laps), 885 ms (Texas, 15 laps); about 2 × DR |
| Laps with aero damage ≥ 10 % | 3 of 68 (4 %) | 20 of 140 (14 %) |
| Laps with a collision | 3 of 68 (4 %) | 30 of 140 (21 %) |

The data agrees that Asymetrisch is the more erratic driver. A human's mistakes show as **contact and damage**, not as slow green laps: beyond 3σ only 0.8 % of human laps, since the wide core swallows small mistakes. **Thin:** a few dozen laps per person; practice runs too short for a σ.

**Wet:** no clear effect on mistakes. But in the wet a **field-wide common mode** (every car on a tyre type faster or slower together) dominates raw residuals: removing it takes Singapore's AI σ from 305 to 138 ms.

## 3. Tyres, fuel, wet

**Wear against age** (864 clean dry laps, 73 stints of 6 or more laps):
- Within a stint, age and mean wear correlate at 0.9998: the same variable. One-lap-ahead error (473 AI predictions, shape from other cars, intercept from the stint's own laps): age linear 0.511 s, wear linear 0.510 s, wear quadratic 0.502 s, last lap repeated 0.540 s; a fit on the stint's own laps only 0.60–0.79 s.
- **Wear matters when a slope moves between cars.** Humans wore tyres 1.4–2.0 × faster than the AI in all 6 comparisons on the same compound and race (Texas medium 6.1 against 3.0 % per lap). In China the AI's slope per % wear predicted the human's last 3 laps with +0.02 s bias; per lap of age +0.27 s. **Thin:** 3–5 human predictions.
- Wear rate, worst corner (always a rear): Texas soft 4.5, medium 3.0, hard 2.2 % per lap (1.5 : 1 : 0.74; Fieni 1.3 : 1 : 0.75); China medium 4.4; Zandvoort soft 1.9; inters 0.84 (Mexico) to 1.9 (Miami); wets 2.7. Wear is linear in the lap; a fuel effect on wear at most about 15 %, not separable.
- Degradation 0.06–0.21 s per lap net of fuel, or 0.04–0.10 s per % wear (per % wear varies less across tracks and compounds; the size matches Fieni). Convexity is invisible in the dry (wear ≤ 40 %); Mexico's 66-lap inter sets (wear to 56 %) show it.
- Fresh-set compound offsets, Texas only (229 laps): soft −0.88 s, hard +1.28 s against medium; the soft's edge is gone after about 6 laps. The track file says soft +0.118, hard +0.816 s: its soft has the opposite sign, being a median real-F1 lap at any tyre age, not a fresh-set offset (a finding for `pitwall-trackdata`). The Texas hard rests on post-SC laps only.
- Data quirks: the game's `tyreAgeAtStart` jitters (6, 6, 7, 7: count laps since the stint start); out-lap rows carry the old set's compound and wear; wear comes in whole percent (about 0.3 % noise).

**Fuel γ:** not identifiable within a stint (collinear with age). Texas, from the tyre reset at stops: 0.020 s/kg (90 % range −0.002 to 0.042); Mexico gives only γ ≥ 0.021. A fixed prior of 0.03 s/kg stays (Bonomi; research 11 §5).

**Cold tyres:** first flying lap on a new set +0.41 s dry (Texas, 5 laps), +1.4 s on inters (Mexico, 2 laps, **thin**); a quarter of it on the second lap; gone by the third. After an SC in the wet +2.1 then +1.2 s; after a VSC +0.25 s.

**Wet:**
- Singapore: inters ran 111–112 % of dry pace at 85–89 % rain; the AI moved to slicks with inters at about 106–109 %; when rain returned, slicks lost 5.9 % in sectors 1 and 2 on the first damp lap. Inters were about 3 s slower while the track was getting wetter (49–74 % rain) than in the later full storm: **the same rain % gives different lap times.**
- Mexico (constant storm): inters about 1 s faster than wets from the start. Miami (constant storm): wets led inters by 1–2 s early, met at about 112 % of dry, and both got 2–4 s faster while the reported weather stayed the same.
- So the track's wetness is a **hidden state inferred from the field's lap times per tyre type**, not from the weather type or rain %. The 110 % rule is compatible but not confirmed (one race per transition, and those are AI decisions).

## 4. Dirty air, blocking, passes

**Dirty air** (2,579 residual laps, 2,509 AI): median residual by gap to the car ahead at lap start, no stop and no position change in the lap:

| Gap | 0–0.5 s | 0.5–1 s | 1–1.5 s | 1.5–2.5 s | > 2.5 s |
|---|---|---|---|---|---|
| Residual | +81 ms | −103 ms | −120 ms | −239 ms | −96 ms |
| Laps | 190 | 414 | 172 | 288 | 773 |

- Cars of equal pace (±0.3 s) following steadily: +29 ms inside 0.5 s against −109 ms in free air: about +0.14 s inside 0.5 s, nothing from 0.5 to 2.5 s. A slower follower loses nothing at any gap.
- A **faster follower loses 0.3–0.67 s per lap at 0–1 s** (75 laps): being held up, not dirty air.
- The 1.5–2.5 s bin is faster in every race: cars closing in (a selection effect), not a tow. DRS on and off give the same shape.
- **Agrees with Joshi** (research 11 §5): no net dirty-air loss beyond about 0.15 s inside 0.5 s. The time that matters is lost to blocking.

**Passes** (from mini-sector crossings; 755 order changes, 228 clean passes after removing stops, SC, retirements and lap 1):
- The game's overtake events are 2–4 × the real passes: unusable as passes.
- 40–93 % of passes fall within one segment of a braking zone (40–64 % of all segments): concentrated, not exclusive.
- The passer's pace advantage: median 0.67 s (IQR 0.02–1.48, n = 164), 0.37 s where both paces come from free air (n = 53). **23 % of passers were slower** than the car they passed. Median tyre-age difference 0.
- Share of following episodes within 1 s (636) that end in a pass, by pace advantage: ≤ 0 s 15–28 %; 0–0.5 s about 40 %; 0.5–1.5 s 54–67 %; > 1.5 s 76–81 %. Median time following before a pass 0.9 laps.
- Stuck cars: of 142 cars faster by more than 0.5 s, 33 % never passed, but only 9 followed for 2 laps or more. Long trains (10–16 laps) are cars of equal pace.
- DRS (advantage > 0.5 s): 0.71 passes per lap of following with DRS against 0.58 without (n = 41, 101): about × 1.2.
- **The AI passes far more easily than TUM's 2 s threshold.** A pass is a chance at each braking zone rising with the pace advantage, with a random part.

## 5. Pit loss and stops

| Stops | Measured | Track file |
|---|---|---|
| Texas green (16) | 20.5 s (TUM's in + out − 2 × reference; IQR 19.1–30.1); 18.7 s against cars that stayed out | 20.2 s |
| Mexico, Singapore green | 25.9 s, 32.5 s: inflated by the weather crossover and double stacks | 21.2 s, 22.0 s |
| Zandvoort SC (14) | 10.1 s (IQR 9.1–10.7), against the same laps of cars that stayed out | 7.7 s |
| Texas SC (4) | 11.4 s | 9.1 s |
| Miami SC (8) | 4.6 s, mostly a VSC lap | none |

- Green confirmed by Texas; **SC about 0.5 × green**, above the track files' 0.38–0.45. No strategic VSC stop in the data (one repair).
- Stationary time: AI 3.31 s (n = 86), human 2.50 s (n = 4, **thin**); 11 stops of 7.7–8.6 s (repairs, stop-go penalties).
- **Double stack** (n = 11): the second car entering less than 3 s after its teammate lost 4.1–6.4 s; 5–11 s after, 0.3–3 s. Roughly `wait ≈ max(0, 6.5 s − entry gap)`.

## 6. AI strategy behaviour

- **No covering.** After a car within 3 s boxes, the AI boxes within 2 laps 11 of 29 times (38 %); a baseline matched on race and tyre age expects 39 %. Stops cluster by tyre age anyway. (Car behind boxed: 8 of 13 against 42 %, **thin**.)
- **SC:** the AI boxes when it still owes a stop. Zandvoort (60 laps left, 10-lap softs, a stop owed): 13 of 17 boxed. Texas (8 laps left): exactly the 3 AI cars still owing a stop boxed; none of the 16 that had stopped, four of them on 10–11-lap mediums. Miami (wet): 9 of 19 switched from wets to inters under the SC.
- **VSC:** no AI car boxed (one repair).
- **Stop window: close to deterministic** per race and compound. Texas: laps 8–11, tyre age 7–10, maximum wear 30–46 %. Each car's stop lap from its peers' median age misses by 0.2–0.8 laps on average; from median wear by 0.4–1.5 laps.

**Undercuts** (natural experiments, §3.7 of the spec): 29 pairs of nearby cars stopping on different laps, but 26 are weather crossovers or team double stacks. Where the first stopper was behind, its median gain was −2.3 s and 2 of 14 came out ahead. Clean dry pairs: 3–4, all Texas soft to medium, 1–2 laps apart, gains −0.7 to +2.2 s; fresh-tyre advantage 0.22 s per lap. **Too few to test any undercut predictor.**

## 7. Engine defects found

1. **Singapore flashback.** On the frame after the lap-5 flashback (target 630.958 s) the engine marks car 19 retired with terminal damage and opens an SC span 631.0–653.6 s. The flashback undid both; the race had no SC. The projection then records no laps of car 19 after lap 5, and 4 green stops get the flag `sc`. A rewind-exactness violation (C27, C33).
2. **Singapore stints.** The stint list misses the stops voided around the same flashback (car 1 shows "inter 1–25" but ran mediums on laps 6–25). Probably the same defect.

## 8. Consequences for the 4.3 spec

Proposed changes (for the user's approval before the 4.3a spec):

1. **`race-interaction`: blocking and a pass chance, no pass threshold.** Dirty air 0 by default (at most about 0.15 s inside 0.5 s); a follower is held to the leader's pace until it passes; a pass is a chance per braking zone rising with the pace advantage, with DRS as a factor and a random part. The spec's "pass threshold" (§3.1, §3.3) and the property "below the pass threshold nobody passes" (§7.1) become: a pass chance of zero means no pass; the chance never falls as the advantage grows.
2. **`driver-noise`:** estimated on free-air laps after the field's common mode is removed (else battles count as mistakes, about four times too often); AI one field default plus a session adjustment; a human's mistake rate from contact, damage and time-loss incidents, not from the lap-time tail; a lap-to-lap correlation or a short level shift after a mistake.
3. **Driver profiles gain a wear-rate factor** (humans 1.4–2 × the AI) beside scatter and mistakes (C62c's entries are declared by units: no contract change).
4. **`lap-model`:** tyre term per % wear, linear, Fieni's convex shape as the prior beyond about 40 % (flagged); age scaled by a per-car wear rate where wear is hidden; fresh-set compound offsets fitted from F1 25 laps, the track file a weak prior; γ fixed at 0.03 s/kg; cold-tyre terms for the first two laps.
5. **`track-wetness`:** a hidden state filtered from the field's lap times per tyre type (the common mode of §2), not from weather or rain %.
6. **`rival-stops` and the rivals' rules:** the stop lap from the race's peers' tyre age; under SC a rival boxes if it still owes a stop and is in or near its window; never under VSC; in the wet it takes the crossover under SC. **No cover rule** (O8 answered: the AI does not cover).
7. **`pit-loss`:** SC about 0.5 × green where unmeasured; the double-stack wait from the entry gap; stationary time per driver type.
8. **Natural experiments (O12)** need dry races with stops spread over several laps; weather crossovers and team double stacks are excluded. With today's recordings the scoreboard's decision part has almost no cases.

## 9. Recordings wanted

- Dry races of 50 % length or more with spread-out stops (undercut pairs, degradation beyond 40 % wear, convexity).
- Several races of each human, also in practice long runs of 8 laps or more (core σ per person).
- Races with a VSC in a pit window (VSC stop cost).
- A race where rain arrives on a dry track and one where it dries (crossovers measured rather than AI decisions).
