# Strategy model: the compute spike

The second proof of concept of SP4.3 (high-level spec `docs/superpowers/specs/2026-11-10-sp4.3-strategy-model-design.md` §8.2), run on 2026-11-11: what the model's three simulators cost and how fast the Monte Carlo's ranking settles. Throwaway code on branch `spike/4.3-compute` (never merged; worktree `../pitwall-wt/spike-4.3-compute`): the prototypes `spike/{rng,model,forecast,dp,mc,race,cases}.ts`, the experiments `spike/{check-dp,bench-forecast,exp-convergence,exp-ablation,exp-rules,exp-rank}.ts`, the raw tables `spike/out/{convergence-*,ablation,rules,ranking-rules}.md`. This file keeps the results; the numbers are measurements for the 4.3a and 4.3b specs, not decisions.

**Labels:** every number states the data behind it; **thin** marks a number resting on too few cases to be more than a hint. "Place" is one finishing position; E[pos] is the expected finishing position of the ranked car.

## 1. The prototype

**Generated race** (no recording): 20 cars × 70 laps, Texas (track id 15: its 9 braking zones from `data/tracks/15.json`; two DRS zones invented, into T1 and T12). Parameters from research 12 where it has them:

| Part | Value | Source |
|---|---|---|
| Base lap, pace spread | 96 s; 0.09 s per grid slot (1.7 s over the field) | assumed |
| Core scatter | AI 0.20 s; DR 0.27 s; Asymetrisch 0.80 s; lap-to-lap correlation about 0.15 | research 12 §2 |
| Mistakes | AI 2.4 % per lap, log-normal median 0.7 s, p90 1.6 s; spins 0.2 % per car-lap, 5–10 s; retirements 0.1 % per car-lap (Asym 0.6 % and 0.2 %); DR 4 % per lap median 1.0 s; Asym 15 % median 1.2 s | research 12 §2 |
| Tyres | wear per lap S 1.65, M 1.1, H 0.8 % (Texas scaled by 20/56 to a full-length race: **assumption**); humans × 1.4 (DR), × 1.8 (Asym); 0.05 s per % wear, convex beyond 40 %, unusable beyond 80 %; fresh offsets S −0.6, H +0.5 s (assumed so that two and three stops are close); cold tyres +0.41 / +0.10 s | research 12 §3 |
| Fuel | 100 kg, 1.4 kg per lap, γ 0.03 s/kg | research 12 §3 |
| Stops | green 20.5 s, SC 10.2 s, VSC 11.5 s; humans 0.5 s quicker stationary; jitter 0.3 s; double stack `max(0, 6.5 s − entry gap)` | research 12 §5 |
| Neutralisations | 0.5 SC per race (30 % of them from lap 1), 3–5 laps; 0.3 VSC per race, 1–3 laps; SC queue at 0.8 s; VSC freezes the order | TUM shape, rates assumed |
| Interaction | blocking (a held follower runs 0.3 s behind); pass hazard per lap held `0.9 / (1 + e^−(adv − 0.3)/0.5)` spread over the braking zones; DRS × 1.2; a pass costs the passed car 0.1 s; dirty air 0 | research 12 §4 |
| AI strategy | the DP's best plan for an AI car per start compound (M-24S-47S, S-24S-47M), a stop-lap draw N(0, 0.7 laps) (S24); SC rule: box if a stop is owed and within 10 laps of the window; never under VSC; no cover | research 12 §6 |
| Wet variant | rain in 70 % of scenarios from lap 15–45, wetness peak 0.35–0.85; wetness term per tyre type (crossover slick/inter about 0.28, inter/wet about 0.7); AI switches at 0.33 (0.25 under SC) | shapes assumed, **rough** |

Our two cars are teammates: DR (consistent) on P8, Asymetrisch (erratic) on P12; the ranked car is DR unless stated. The teammate follows its committed policy (its DP best with its SC trigger).

**race-forecast** (`forecast.ts`): per lap, cars sorted by line time; a car more than the battle range (1.5 s) from the car ahead at both ends of the lap takes one lap step, the others are stepped as groups braking zone to braking zone (blocking, one pass roll per braking zone where held, DRS on the straight before it); the mode is chosen anew every lap. SC: the queue behind the ghost car; VSC: delta laps; stops, cold tyres, double stack, retirements, the two-compound rule. The all-braking-zone fallback is the same code with every car in one group. All draws are keyed by (seed, scenario, car, lap, purpose) through a hash (`rng.ts`), never `Math.random`.

**strategy-dp** (`dp.ts`): per car and per compound sequence (up to three stops, two dry compounds, sets 2/2/2): a backward DP over laps with state (stint index, tyre age in quarter laps of wear: green 4, VSC 2, SC 1, neutralisation state: green, SC with 1–5 laps left, VSC with 1–3 laps left); cost the expected remaining race time over the SC/VSC chances; traffic as a cost per stop lap from the plain forecast (0.5 s per slower car within 1 s ahead of the rejoin, crude). The sequence fixes compound, second-compound-used and sets left, so the spec's state is covered. Out: the base plan per sequence (the green path), the SC trigger's lap range per remaining stop, and the root's box-now and stay-out values.

**race-monte-carlo** (`mc.ts`): about ten policies per case: the DP's five best sequences, the best and the second best with their SC triggers, and four rule-based candidates built on the best (mirror ahead, mirror behind, cover within 3 s, extend within 3 s; all within ±6 laps of the planned stop). Common random numbers (CRN) by the keyed draws; pools of every policy on every scenario kept as matrices so that convergence and allocation can be resampled; adaptive allocation (n0 100, batch 100; a policy is resolved when it is clearly worse than the best, `Δ − z·SE > 0`, or tied, `|Δ| + z·SE < band`, z = 2); the S5 ranking.

**Checks:** the DP equals brute force on small races: 60 cases (8 laps, high SC/VSC rates, 1–2-lap neutralisations, up to 2 stops, three cars, two start laps): closed-loop brute force over every action and outcome, max difference 0; open loop without neutralisations, every set of stop laps, max 2·10⁻¹³ s.

## 2. Time per piece

Machine: 22 cores (hybrid), 30 GB, Node 22.22. **Load:** the first pass ran quiet (load average 0.17); repeat passes after the pool runs ran with desktop applications busy (load 2–9) and came out 25–60 % slower. The table gives the quiet pass; the range in brackets is every pass. Best of 7 warm passes of 400 scenarios, ranked car on its best policy.

| Piece | Lap-1 start | Lap-35 start |
|---|---|---|
| race-forecast, mode switch, battle range 1.5 s | **0.48 ms** (0.48–0.76) | **0.20 ms** (0.20–0.34) |
| — battle range 1.0 s | 0.48 ms | 0.19 ms |
| — battle range 2.5 s | 0.53 ms | 0.21 ms |
| race-forecast, all braking-zone steps | 0.53 ms (0.53–0.79) | 0.23 ms (0.23–0.41) |
| race-forecast, lap steps only (ablation) | 0.32 ms | 0.15 ms |
| strategy-dp per car, ≤ 3 stops (34 sequences, 10.6 M state evaluations) | 188–194 ms (–273) | 79–80 ms (–120) |
| strategy-dp per car, ≤ 2 stops (10 sequences) | 56–63 ms | 24–30 ms |
| race-monte-carlo, single thread (scenario-policies per s; best of 5 passes of 3,300) | 1,600–1,850 | 2,050–2,950 (lap 25, lap-30 SC case) |
| bonus: 20 worker threads, whole pool incl. start-up | 11,000–13,400 (about 7 ×) | 21,300–21,500 |

- Cars in battle mode: 59 % of green car-laps from lap 1 (49 % at 1.0 s, 72 % at 2.5 s), 33 % from lap 35 (25 %, 47 %). The field is close (1.7 s of pace spread), so most cars are in battle most of the time.
- **The mode switch saves only 10–20 %** against all braking-zone steps (0.48 against 0.53 ms; 0.20 against 0.23 ms). Lap steps only would save 33 %.
- About 72 passes per race from lap 1, 14 from lap 35 (**assumed** pass hazard; not calibrated).
- The DP's cost is the 34 sequences; sequences that share a suffix could share their tables (not tried).

## 3. Convergence

Case lap 1 (P8), 11 policies; three more cases in `spike/out/convergence-*.md`. Reference: 50,000 scenarios, CRN. Levels: N scenarios per policy resampled 40 times from a separate pool of 250,000 scenarios (bootstrap: with CRN one shared index set, without CRN one per policy).

**The spread:** one policy's finishing position scatters by 2.55 places per race (lap 25: 1.90, lap-30 SC: 1.97; TUM's real-F1 figure about 1.5). The difference between a policy and the best scatters by 1.01 places with CRN (range 0.37–1.48 over the policies) against 3.61 without: **CRN needs 12.9 × fewer scenarios** (lap 25: 13.5 ×, SC case 8.3 ×, wide AI 12.1 ×). Research 11 guessed 5–10 ×.

| N per policy | CRN | top-1 exact | best within 0.05 | Kendall τ (median, p10) | mean abs E[pos] error |
|---|---|---|---|---|---|
| 100 | yes | 60 % | 88 % | 0.82, 0.69 | 0.22 |
| 100 | no | 20 % | 45 % | 0.49, 0.24 | 0.20 |
| 300 | yes | 63 % | 100 % | 0.92, 0.84 | 0.09 |
| 300 | no | 38 % | 68 % | 0.70, 0.53 | 0.12 |
| 1,000 | yes | 63 % | 100 % | 0.93, 0.88 | 0.07 |
| 1,000 | no | 38 % | 73 % | 0.78, 0.64 | 0.07 |
| 3,000 | yes | 45 % | 100 % | 0.95, 0.88 | 0.04 |
| 3,000 | no | 43 % | 88 % | 0.85, 0.75 | 0.04 |
| 10,000 | yes | 63 % | 100 % | 0.96, 0.92 | 0.02 |
| 10,000 | no | 50 % | 98 % | 0.93, 0.85 | 0.02 |

- "Top-1 exact" stays near 60 % because the two best policies are 0.005 places apart (the DP best with its SC trigger and "extend", which nearly coincide): a true tie, not a failure. The useful measure is the regret: with CRN the chosen policy is within 0.05 places of the best in every repeat from N = 300.
- Lap 25 and the lap-30 SC case: with CRN top-1 exact reaches 100 % at N = 1,000 and 3,000; within 0.05 at N ≥ 1,000 in every repeat. Without CRN 60–63 % exact even at 10,000.
- Every policy within 0.25 of the best: 100 % from N = 100 with CRN, in all cases: the 0.25 band is coarse for these candidate sets.
- **Winner's curse** with CRN at N = 1,000: the winner's estimate is 0.02 places off its fresh re-score (−0.032, −0.017, +0.019, −0.022 over four runs): small. Without CRN at N = 100 it is 0.35 places.
- **S24, narrow against wide AI windows** (stop-lap sd 0.7 against 3 laps, AI noise × 1 against × 2): the paired spread rises only from 1.01 to 1.07 places, about 12 % more scenarios for the same error. With CRN the AI's shared randomness cancels in the paired difference either way; what remains comes from neutralisations meeting our plan, our drivers and passes. **One case, thin.** The narrow windows matter in another way: rival stop draws are cheap.

**Adaptive allocation** (CRN, 40 repeats, own random order of the pool each):

| Band | Cap (single thread) | Evaluations used (median, max) | Capped | Winner within the band of the reference best |
|---|---|---|---|---|
| 0.25 | none | 1,100–1,300, max 4,100 | 0 | 100 % (all four runs) |
| 0.25 | 0.5 s (800–1,500 evaluations) | 1,100 | 10–55 % of repeats | 100 % |
| 0.05 | none | 2,400–3,100, max 7,100 | 0 | 20 of 20 (all runs) |
| 0.05 | 2 s | 2,200–3,400 | 0–8 of 20 | 19–20 of 20 |
| 0.05 | 1 s | 1,800–2,500 | 8–20 of 20 | 16–20 of 20 |
| 0.05 | 0.5 s | 1,100–1,600 | 19–20 of 20 | 17–20 of 20 |

- With the 0.25 band the run stops after the first 100 scenarios per policy in most repeats: everything near the top is "tied".
- Equal allocation with the same number of evaluations did as well as the adaptive allocation in every row: on these candidate sets the gain is the **stopping rule**, not the allocation (a few candidates near the top, the rest far behind). **Thin:** four cases with similar shapes.
- The rounds overshoot a cap by up to one batch per open policy (prototype).

## 4. What a time cap buys (single thread)

At the measured throughput (1,600–2,950 scenario-policies per s) for 11 policies:

| Cap | Scenarios per policy | Ranking at the cap |
|---|---|---|
| 0.5 s | 75–135 | best within 0.05 of the reference in 85–100 % of repeats |
| 1 s | 150–270 | 80–100 % |
| 2 s | 300–540 | 95–100 % |
| 5 s | 750–1,340 | 100 %; Kendall τ about 0.93 |

The cap must also hold the DP for both cars (2 × 190 ms at lap 1, twice for the two rounds of §3.6: about 0.8 s), so the DP is a large share of a 1–2 s job.

## 5. Mode switch and ablation (S11, S22)

20,000 scenarios per policy, CRN, the same scenario ids in every variant; six cases (lap 1, lap 25 near the window, SC at lap 30 after the stop, SC at lap 22 before the stop, teammate 0.5 s behind on lap 15, a wet race from lap 1). The candidate set is the full model's. The **noise floor** is the full model on a second, disjoint set of 20,000 scenarios: top-1 the same in 6 of 6, τ 0.93–1.00, the S5 winner the same in only 2 of 6. Δ: the full model's top-1 against the variant's top-1, paired, under the variant.

| Part switched off | Top-1 changed | Largest Δ (places) | τ against full | Verdict |
|---|---|---|---|---|
| braking-zone steps: all braking zone (fallback) | 2 of 6 | 0.010 ± 0.013 | 0.93–1.00 | the same ranking; the fallback changes time only |
| braking-zone steps: lap steps only | 2 of 6 | 0.028 ± 0.012 (SC at lap 22) | 0.89–0.99 | one small significant change |
| wetness term (wet case) | 1 of 1 | 5.49 ± 0.06 | −0.36 | decisive whenever rain is possible |
| mistake process | 1 of 6 | 0.002 ± 0.005 | 0.95–1.00 | no decision change |
| dirty air 0 → 0.15 s inside 0.5 s | 2 of 6 | 0.008 ± 0.012 | 0.93–1.00 | no decision change |
| rivals' SC rule | 1 of 6 | 0.024 ± 0.004 (lap 1) | 0.87–1.00 | one small significant change |
| double stack | 1 of 6 | 0.009 ± 0.014 | 0.93–1.00 | no decision change; **thin**: the teammate's plan rarely shares a stop lap with ours |

- **Every change but the wetness term is below 0.03 places**, i.e. far inside any tie band. By S22's rule only the wetness term clearly earns its place on these cases; braking-zone steps and the rivals' SC rule change a top-1 by a significant but tiny amount.
- These are rankings of a **fixed candidate set**. The parts change the absolute numbers (E[pos], position quantiles, P(gain)) that the displays show, and the DP's own plans would differ under a different lap model; neither is measured here.
- The wet case is rough (the rain process and the wetness term are invented shapes), so only "the term decides" is a finding, not its size.

## 6. Rule-based candidates (S21)

13 cases (the six above minus the wet one, plus lap 1 from P4, P12, P16, Asymetrisch ranked, lap 20 from P4, P8, P12, lap 35), 20,000 scenarios, CRN. Δ: best rule minus best DP candidate.

- A rule beats every DP candidate **outside the 0.25 band: 0 of 13**. Significantly but inside the band: 2 of 13 ("extend": lap 1 from P4, −0.026 ± 0.006; SC at lap 22, −0.028 ± 0.012). The S5 winner is a rule in 3 of 13, all within the band.
- The best rule is "extend" in 12 of 13; it differs from the DP best only in the few scenarios where the car ahead has not yet stopped.
- **Mirror ahead, mirror behind and cover give identical results** in most cases (the same E[pos] to three decimals on 50,000 scenarios, also with wide AI windows): the cars just ahead and just behind stop in the same lap cluster as the field, so each of them means "box the lap after the neighbours".
- **The SC trigger is worth more than any rule:** the DP plan with its SC trigger beats the same plan without by 0.04–0.29 places in 12 of 13 cases (0.29 when an SC comes before the stop; Asymetrisch's three-stop plan 0.016 ± 0.011, not significant).

## 7. The S5 ranking rule (supervisor addition)

The convergence runs showed the S5 winner matching its own reference only 0–33 % of the time even at 10,000 scenarios while the E[pos] best was stable. Ranking rules compared on the cached pools (four case runs, 40 repeats per level, CRN). Stability: the rule picks what it picks on the 50,000-scenario reference. Regret: the chosen policy's reference E[pos] minus the reference best.

| Rule | Stability at N = 1,000 / 10,000 | Mean regret at N = 1,000 / 10,000 (places) | Max regret |
|---|---|---|---|
| (a) S5 as specified: bands 0.25 / 0.5, then median race time | 0–25 % / 3–33 % | 0.06–0.11 / 0.05–0.11 | 0.21 |
| (b) E[pos] only | 58–100 % / 70–100 % | ≤ 0.004 / ≤ 0.002 | 0.12 (N = 300) |
| (c) tie when the paired Δ is within 2 SE, then E[points] (the same paired test), then mean race time | 55–100 % / 50–100 % | ≤ 0.003 / ≤ 0.003 | 0.10 (N = 300) |
| (c′) the same with 1 SE | 30–98 % / 35–100 % | ≤ 0.004 | 0.19 (N = 300) |
| (d) E[points] only | 68–78 % / 68–95 % | 0.002–0.015 / ≤ 0.004 | 0.40 (N ≤ 1,000) |
| (e) score E[pos] − 0.1 · E[points] | 48–93 % / 73–100 % | ≤ 0.003 | 0.08 |

- **(a) has a regret that does not shrink with N**: about 0.1 places, structural. A fixed 0.25 band ties policies that are clearly different (0.08–0.13 places apart, resolved at ±0.02), the 0.5-point band ties almost everything for a midfield car (E[points] 0.4–1.0), and the last key then picks among them.
- (c) is as good as (b) and keeps S5's order of keys; its instability on lap 1 is the true 0.005-place tie between the two best policies, at a regret of 0.003.
- **Why several policies share one median race time (7,007.4 s):** not a coarse time grid (race times are stored as 32-bit floats, about 0.5 ms resolution at 7,000 s). The policies take identical actions in 90–96 % of scenarios (an SC trigger or a rule fires only in some), and with CRN an identical action sequence gives a bit-identical race; so the median is the same scenario's time for every policy that differs only in rare branches. Real, and inherent: **the median cannot see a difference that lives in fewer than half the scenarios**, which is exactly where triggers differ. The mean of the paired difference sees it.

## 8. Consequences for the 4.3 spec

Proposals (for the user's approval before the 4.3a and 4.3b specs; each with its evidence):

1. **S5 ranking (§3.5):** rank by E[pos]; two policies tie only when their paired (CRN) difference is within 2 standard errors of the Monte Carlo (and below a small practical band, proposal 0.05 places, never below the MC's own error); within a tie by E[points] with the same paired test; then by the **mean** paired race time, not the median. Evidence §7: regret ≤ 0.003 against 0.05–0.11 for the fixed bands; the median is blind to rare-branch differences. The displays still show all three numbers.
2. **Common random numbers are required**, keyed as built here: 8–13 × fewer scenarios, and without them the ranking has τ 0.49 at N = 100. (§3)
3. **Run counts (O1):** a time cap, not a count. The adaptive stop with z = 2 and the band 0.05 used 2,400–3,100 scenario-policies (median, 11 policies) and found the best within 0.05 every time; n0 = 100, batch = 100. Proposed `strategy` job cap: **2 s single thread** at lap 1 (300–540 scenarios per policy plus the DP), with a test that the winner at the cap lies within 0.05 of a 50,000-scenario reference on the test race. 1 s is the floor (80–100 %). (§3, §4) *Updated in §10.6:* on the follow-up model 2 s still holds for up to about 15 policies (18–20 of 20 within 0.05); with the stop-lap neighbours of proposal 11 (about 17–20 policies) **3 s**.
4. **Re-scoring the winner** on 1,000 fresh scenarios costs about 0.5 s and corrects about 0.02 places with CRN: cheap enough to keep, of small value; keep it for the shown numbers, not for the choice. (§3)
5. **Step mode (§3.3, S11): all braking-zone steps for every car.** The mode switch saves only 10–20 % on a close F1 25 field (59 % of car-laps are in battle anyway) and changed no ranking; one code path is simpler. Budgets: `race-forecast` **1 ms per scenario** from lap 1 and 0.5 ms from lap 35 (measured 0.53–0.79 and 0.23–0.41). The battle range is then moot; if the switch is kept, 1.5 s. *Updated in §10.6:* on the follow-up model all braking-zone steps take 0.82–1.10 ms from lap 1 and 0.38 ms from lap 35 (the switch saves 9–21 %); proposed budgets **1.5 ms** and **0.6 ms**.
6. **`strategy-dp` budget: 300 ms per car** from lap 1 with up to three stops (measured 188–273 ms), 100 ms with up to two (56–63). Sharing tables between sequences with a common suffix is the first optimisation if the 2 s job cap gets tight. Keep three stops: Asymetrisch's best plan has three.
7. **The SC trigger (§3.4 table)** needs a lap range **per remaining stop**, and the DP sets it from "box during this SC against stay out past it" (the SC's last lap), not from the first SC lap, which favours waiting within the SC. It is the most valuable trigger: 0.04–0.29 places in 12 of 13 cases. (§6)
8. **Rule-based candidates (S21):** keep "extend" (best rule in 12 of 13 cases, significantly ahead twice, never outside the band); score mirror ahead, mirror behind and cover only after removing duplicates by outcome (they coincide when the neighbours stop in the field's cluster). (§6)
9. **Ablation (S22, O11):** on these cases only the wetness term changes a decision by more than 0.03 places. Proposal: keep braking-zone steps (they come with proposal 5 for free), the rivals' SC rule (significant, cheap, and research 12 shows the behaviour) and the wetness term; dirty air stays 0 (research 12); the mistake process and the double stack change no ranking here but do change the shown distributions and a split-or-stack call (D27) that these cases did not test: keep them pending a dedicated stack case in the 4.3b spec. S22 as written judges a part only by rankings; the 4.3a spec should say whether the shown numbers count too. *Updated in §10:* blocking earns its place (switching it off changes the top-1 in 4 of 6 follow-up cases); the pass chance is the most decision-relevant parameter of all (O5); relative DRS and pace uncertainty change the shown numbers, not the choice.
10. **S24:** the near-deterministic AI does not cut the scenario count much under CRN (about 12 %, one case, thin); its edge is that rival stop windows are cheap to draw.

## 9. Limits

- The race is generated, with several invented numbers (pass hazard, SC rates, tyre offsets, rain); compute numbers carry over, ranking numbers only as shapes.
- Candidate sets come from the full model's DP; the ablation does not re-run the DP per variant.
- The traffic term in the DP is crude; the DP's "box now" plan is the base plan's path, not forced (prototype bug, so no box-now candidate appeared mid-race).
- Timings vary 25–60 % with desktop load; budgets above leave that room.
- One worker thread per job is assumed (C51 as written); the 7 × multi-thread figure is a bonus only.
- Follow-up: one draw of the qualifying noise for every case; the rejoin train is placed by hand; the passes and the train losses are calibrated against six races only.

## 10. Traffic, DRS trains and pace uncertainty (follow-up)

A follow-up run on 2026-11-11, approved by the user, who doubted that pitting into traffic barely matters. The first run's cases had the grid sorted exactly by pace, our humans on their slot's pace, DRS only as a factor on the follower's pass chance, and a crude DP traffic term; and no ablation removed blocking. Raw tables: `spike/out/traffic.md`, `traffic-shifts.md`, `convergence-v2-{0,5}.md`, `ranking-rules-v2.md`.

### 10.1 Model changes (the "v2" model; every number an assumption unless cited)

| Part | First run | Follow-up |
|---|---|---|
| DRS | the follower's pass chance × 1.2 on DRS straights | **relative:** every car within 1 s of the car ahead at the start of a DRS straight gains 0.25 s on it (a straight-line gain, so a train's cars all gain and it cancels); the × 1.2 on the pass chance only if the car ahead is not itself in DRS |
| Grid | exactly the race-pace order | qualifying pace = race pace + N(0, 0.25 s); three AI cars (race-pace ranks 2, 6, 10) qualify 1.2 s off their pace; one draw of the noise for every case |
| Our drivers | their slot's pace | own race pace: DR 0.3 s faster than its slot (P8), or 0.3 s slower; Asymetrisch 0.3 s slower than P12 |
| Pace uncertainty | none | each scenario draws every car's true race pace around its estimate: σ 0.25 s at a lap-1 start, 0.08 s from lap 20 on, linear in between; the forecast's plain run and the DP use the estimate |
| DP traffic term | 0.5 s per slower car within 1 s ahead of the rejoin | also **train-aware:** the car we rejoin behind (within 1.5 s) and every car chained ahead of it within 1 s; cost = our fresh-tyre advantage over the train's front car × the expected laps stuck (Σ 1 / pass hazard per car), capped by the laps left |
| Plain forecast passes | at u = 0.5 per braking zone, so **never** (the per-zone chance is below 0.5): a bug of the first run, which made the plain forecast's trains permanent | when the held car's summed hazard reaches ln 2 (the median pass time) |

Six cases (`TRAFFIC_CASES`): lap 1 with DR faster than its slot; lap 1 with DR slower; lap 25 near the window; SC at lap 22; teammate 0.5 s behind at lap 15; and a **rejoin case** at lap 20: the five slowest AI cars, given one equal pace and their stops moved 15 laps later, form a train 1 s apart that our car's stop at about lap 27 rejoins into, with other cars moved away from it. Candidates: the DP's plans under both traffic terms, merged, plus the SC-trigger and rule variants (11–17 policies). 20,000 scenarios per policy, CRN, the same scenario ids in every variant.

### 10.2 Traffic in the model against research 12 (sanity check)

| Measure | Model (six cases) | Research 12 (§4) |
|---|---|---|
| Passes per lap | 2.0 from lap 1 (lap 1 included); 1.1–2.0 from mid-race starts (lap 25: 1.1, lap 22 SC: 1.6, lap 15: 1.5, lap 20 rejoin: 2.0); with pass chance × 0.5: 1.2 from lap 1 | 1.28 (228 clean passes, 178 race laps; lap 1, stops and SC removed) |
| Faster follower (> 0.5 s per lap) | 0.78–1.25 s lost per lap of following; episode median 1–2 laps, p90 3–5, 0.2–2 % of episodes ≥ 10 laps | 0.3–0.67 s per lap at 0–1 s (75 laps); median 0.9 laps following before a pass; 9 of 142 followed 2 laps or more |
| All following episodes | median 2–3 laps, p90 9–12, 9–15 % ≥ 10 laps | long trains of 10–16 laps are cars of equal pace |
| Trains of 3+ cars | 0.9–1.6 per lap, mean size 3.4–4.3; a car 2nd or later loses 0.41–0.67 s per lap to blocking | — |
| Held in the 3 laps after a stop | 0.3–1.1 s per stop in the ordinary cases; 1.7–2.9 s into the train; 3.8–4.8 s into the train at pass chance × 0.5 and × 0.25 | not measured (no clean rejoin cases) |

- The pass count matches the data within the range pass chance × 0.5 to × 1 (the data leaves lap 1 out; mid-race the model is at the top of that range or above). **Thin:** six races, mostly AI.
- A held faster car loses about twice the data's time per lap (the model holds it fully to the leader's pace) but gets past about as fast.
- **Relative DRS made trains less stable, not more:** passes per race rose from 91 to 141 (lap-1 case) against the first run's factor, and the time held per race doubled (8 → 15 s), because the follower's straight-line gain closes it up on the car ahead before the next braking zone. The "brutal DRS train" appears only with a lower pass chance (× 0.5: the loss per lap in a train 0.55–1.14 s; × 0.25: 0.66–1.31 s).

### 10.3 Does traffic change the plan?

| Variant | Top-1 changed (of 6) | Δ of the full model's choice under the variant (places) | τ against full |
|---|---|---|---|
| noise floor (other scenarios) | 2 (0.014 ± 0.011, 0.004 ± 0.004: noise) | — | 0.85–0.99 |
| DRS as in the first run | 0 | — | 0.64–1.00 |
| no pace uncertainty | 1 (0.001 ± 0.004: noise) | — | 0.85–1.00 |
| **no blocking** | **4** | 0.021 ± 0.007 to 0.065 ± 0.017 (all significant) | 0.56–0.92 |
| pass chance × 0.5 | 6 | 0.000 to 0.095 ± 0.013 | 0.67–0.90 |
| **pass chance × 0.25** | **6** | **0.014 to 0.375** (five of six above 0.2) | 0.48–0.75 |

- **Blocking changes the choice**, by 0.02–0.07 places at the measured pass chance: small but real; the first run's conclusion ("traffic barely matters") rested on blocking that never was switched off.
- **The pass chance is the most decision-relevant parameter** measured in this spike: at a quarter of the measured hazard every case picks another policy and the full model's pick loses up to 0.38 places.
- **Stop-lap neighbours in the rejoin case** (`traffic-shifts.md`; the DP's best plan with its first stop moved −3 to +3 laps):

  | Pass chance | Best first stop vs the DP's | The DP's plan loses | Stopping into the train (2–3 laps early) loses |
  |---|---|---|---|
  | × 1 | +0 / +1 (the DP's) | 0 | 0.09–0.21 |
  | × 0.5 | +2 | 0.07 | 0.29–0.47 |
  | × 0.25 | +3 | **0.37** | 0.94–1.29 |

  At lap 25 (no train) the neighbours are within 0.03 of each other at ±1 lap; from lap 1, two laps later is 0.04 better.
- **The train-aware DP term** changed the DP's best plan in 3 of 6 cases; the Monte Carlo preferred its plan once (DR slower, −0.099 ± 0.013) and the simple term's twice (lap 25 +0.151 ± 0.012, rejoin +0.074 ± 0.012). At pass chance × 0.5 and × 0.25 it moves the rejoin stop later (laps 32 and 31, against 29 and 27 with the simple term), towards the Monte Carlo's best (31 and 30). It points the right way where trains are sticky and overshoots where they are not: the DP's traffic estimate is not good enough to choose by; the Monte Carlo is.

### 10.4 Pace uncertainty

Spread of the full model's top-1 policy, with against without pace uncertainty (q10 / median / q90 of the position, P(gain) = finishing ahead of the start position):

| Case | With | Without |
|---|---|---|
| lap 1, DR faster (from P8) | E 9.16; 5 / 9 / 13; P(gain) 32 % | E 9.21; 7 / 9 / 11; 17 % |
| lap 1, DR slower (from P8) | E 13.50; 10 / 13 / 18; 1 % | E 13.57; 11 / 13 / 16; 0 % |
| lap 25 (from P3) | 6 / 7 / 9; 0 % | 6 / 7 / 9; 0 % |
| SC at lap 22 | 6 / 8 / 10; 48 % | 6 / 7 / 10; 52 % |
| teammate, lap 15 | 6 / 8 / 10; 36 % | 7 / 8 / 9; 30 % |
| rejoin, lap 20 | E 7.06; 5 / 6 / 9; 77 % | E 6.96; 5 / 6 / 9; 82 % |

It changes no decision (one flip, inside the noise) but **doubles the shown P(gain) and widens the q10–q90 range from 4 to 8 places at a lap-1 start**; mid-race it barely shows. It earns its place for the displayed distribution, not for the ranking.

### 10.5 Compute on the follow-up model

- One policy's position scatters by 3.60 places per race from lap 1 (first run 2.55) and 2.92 in the rejoin case; the paired difference to the best by 1.44 and 1.30 (first run 1.01): about **twice the scenarios** for the same error. CRN still cuts them 12.6 × and 10.2 ×.
- `race-forecast` from lap 1, single thread, load average about 1: all braking-zone steps 0.82 ms (0.82–1.10 over two passes), mode switch 0.76 ms; from lap 35 0.38 and 0.30 ms. 69 % of green car-laps in battle from lap 1 (first run 59 %).
- The Monte Carlo: 1,100–1,300 scenario-policies per s single thread (15–17 policies).
- Adaptive with the 0.05 band: full resolution took 4,000–10,700 evaluations (median; max 21,200) because five policies lie within 0.01 of each other; at a 2 s cap (2,200–2,800) the winner lay within 0.05 of the reference in 18–20 of 20 repeats, at 1 s in 13–19 of 20, at 0.5 s in 18–20 of 20 (the cap rows overshoot to n0 · P = 1,500–1,700).
- Ranking rules (§7) on the follow-up model: S5 as specified has a regret of 0.12–0.14 places (max 0.15) in the rejoin case and 0.017 → 0.001 from lap 1 (where the top five are within 0.01); E[pos] only and the paired tie test stay at 0.002 or less. **Proposal 1 holds.**

### 10.6 What changes in the proposals (§8)

- **Still hold:** 1 (paired-tie ranking), 2 (CRN), 4 (re-scoring), 6 (DP budget), 7 (SC trigger per stop), 8 (rule candidates), 10 (S24).
- **3 (cap):** 2 s still holds for about 15 policies; with the neighbours of proposal 11 about 17–20 policies, proposed **3 s single thread**.
- **5 (step mode):** all braking-zone steps still; budgets **1.5 ms per scenario from lap 1, 0.6 ms from lap 35**.
- **9 (ablation):** blocking stays (it changes choices); relative DRS stays (it changes the held time and the pass count by 2 ×, i.e. the numbers shown; no choice changed); pace uncertainty stays for the shown spread.
- **New 11. Stop-lap neighbours as candidates:** besides the DP's plans, score each DP plan's next stop moved by ±1 to ±3 laps (about six more candidates for the best plan). The DP's traffic term (simple or train-aware) does not judge traffic well enough to choose a stop lap; the Monte Carlo does, and the clear-air stop is worth up to 0.37 places when trains are sticky. Keep the simple term in the DP or the train term: the evidence does not separate them (one better, two worse).
- **New 12. The pass chance is the first thing to calibrate (O5):** it changes the plan choice by up to 0.38 places between × 1 and × 0.25, more than any model part. The data's pass count fits × 0.5 to × 1 (thin); the 4.3a `race-interaction` calibration should report the hazard with its uncertainty, and the strategy job should not be trusted for traffic calls before it is calibrated on F1 25 recordings.
- **New 13. The plain forecast passes at the median pass time** (summed hazard ln 2), not at a fixed draw: otherwise its trains never break (a first-run bug, which also fed the DP's traffic term).
- **New 14. Pace uncertainty** as a per-scenario draw of each car's race pace around its estimate (σ falling with the laps seen), part of the scenario from 4.3a; its σ should come from `degradation`'s standard errors rather than the assumed 0.25 / 0.08 s.
