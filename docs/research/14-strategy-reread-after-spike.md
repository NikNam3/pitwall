# Strategy model: the reread after the compute spike

Research done on 2026-11-11, after the compute spike and its follow-up ([13](13-strategy-compute-spike.md) §10): every strategy paper read again with the spike's questions (overtaking and blocking, DRS trains, pitting into traffic, pace uncertainty, ranking under noise, driver differences), by three readers. This file adds to [11](11-strategy-model-reread.md) and does not repeat it; where they disagree, this file is right (corrections in §3). Parts A–D are the readers' reports as written; §1–§5 merge them.

**Labels:** 🟢 stated by the source · 🟡 read off a figure (about ±10 %) · 🔵 pitwall's own inference.

**Read:** Part A, the TUM work: Heilmeier et al. 2020 (Appl. Sci. 10, 4229, full text), the dissertation (TUM 2022, all 205 pages), the TUMFTM/race-simulation code with all 121 parameter files. Part B, operations research and data mining: Aguad & Thraves 2024 (EJOR, main text; appendices not read), Tulabandhula & Rudin 2014 (full), Bonomi, Turri & Iacca 2023 (GECCO, full); `external/s10100-022-00810-8.pdf` is only a one-page correction to Carrasco Heine & Thraves 2023, whose full text is still unreachable. Part C, the arXiv papers (Fieni et al. 2025 and 2026, Joshi 2026, Wüthrich et al. 2026, Cappello & Hoegh 2025, all full text) and the ranking-and-selection literature (Eckman & Henderson 2018 and Chick, Branke & Schmidt 2007 full text; Nelson & Matejcik 1995, Kim & Nelson 2001, Chen et al. 2000, Law ch. 10–11 from standard knowledge, labelled 🔵).

## 1. What the papers say about the spike's findings

- **Passing is per track, and hard.** TUM passes by a fixed per-track threshold (Suzuka 1.26 s to Monaco, Singapore, Montreal 3.75 s), lowered by top-speed advantage; with its lap scatter that is a per-lap pass chance of about 6 / 16 / 34 / 57 % at 0.5 / 1 / 1.5 / 2 s advantage at Austin 🔵 (A §1): the spike's "× 0.25" regime, where the plan choice moved most. Tulabandhula & Rudin find overtaking "race-specific rather than racer-specific" (B §1). No paper has a pass hazard fitted to anything we can borrow (C §1). → the pass chance per track with a pooled prior, its slope tied to the lap scatter, fitted on F1 25 recordings.
- **Blocking matters; dirty air stays 0.** TUM holds a car at 0.5 s and charges both cars 0.3 s per lap within 0.5 s (A §1); Wüthrich: held behind a car 0.5 s per lap slower after a stop costs 6.87 s (C §1). The dirty-air terms in the ETH papers are heuristic, Joshi's evidence is weak (C §1, §7); Tulabandhula & Rudin's "fresh air" mixes in car pace (B §7).
- **DRS is relative to the car directly ahead** in TUM, as in the spike's follow-up; TUM's deterministic run has the same never-breaking pairs the spike fixed (A §2). Aguad's DRS gain (mean 0.28 s) is as assumed as the spike's 0.25 s (B §2); its appendix L gives no source for it at all (D). The undercut turns on the 1 s DRS line (Aguad fn. 15).
- **No paper solved traffic in the optimiser.** TUM's optimiser assumes a free track and its agents could not place stops into free air (A §3); Fieni 2026's agent answers a rival by shifting stop laps, Wüthrich finds the local minima in the pit choice (C §3); a short stop keeps its places only with slower cars behind as a shield (Tulabandhula & Rudin Fig. 8, B §3), which the DP's look-ahead traffic term cannot see. → stop-lap neighbours as candidates, scored by the Monte Carlo; TUM proposes showing a pit window of every lap within 1–2 s of the optimum (A §3).
- **Pace uncertainty is drawn by nobody.** TUM draws lap scatter, start, stop times and events, never its parameter errors; its biggest errors are per driver and in the degradation slope (A §4). Cappello's slope stays ±0.11–0.13 s per lap wide after a full stint (C §4). → draw a per-car degradation-rate factor besides the pace level.
- **Ranking.** TUM ranks by mean position over 10,000 runs, no CRN, and redraws invalid races, which biases each strategy's sample differently (A §5). Ranking by win probability gambles (Aguad: same win rate, final-gap sd 2.00 → 5.17 s; B §5). The ranking-and-selection literature (C §5): near-ties need "good selection", not "correct selection"; compare every policy with the leader, not pairwise (pairwise ties are not transitive); a tie is `Δ < max(0.05, z·SE)`, not "not shown different"; with 15–30 candidates looked at after every batch, elimination needs z ≈ 2.7–2.9; Kim–Nelson at 0.05 needs 8,000–10,000 scenarios per policy, so a cap with measured good selection is the right frame.
- **Rivals reacting.** Equal strategic cars mirror each other; Aguad's undercut is worth +18 points of win rate only against a rival that does not react (B §3). The F1 25 AI does not cover (research 12 §6), but the dependence is worth an ablation.

## 2. The spike's proposals after the reread

The user set the `strategy` job cap to **5 s** (2026-11-11), replacing the spike's 2–3 s.

| # | Proposal (13 §8, §10) | Verdict | Change from the reread |
|---|---|---|---|
| 1 | Ranking by E[pos], paired tie, points, mean time | agree, sharpen | Ties against the E[pos] leader only, tie when `Δ < max(0.05, z·SE)` (z = 2); the same rule for E[points]; then mean race time; a near-tie unresolved at the cap shown as such; never discard or redraw a scenario for one policy |
| 2 | Common random numbers required | agree | Also lets identical policies be merged exactly |
| 3 | Time cap | sharpen | **5 s** (user). About 4,600–5,500 scenario-policies after the DP; n0 30–50 when there are 25–30 candidates; elimination at z ≈ 2.7–2.9; the good-selection test (within 0.05 of a 50,000 reference) at the largest candidate count |
| 4 | Re-score the winner | sharpen | Re-score the shown top few together on the same fresh scenarios (inside the cap) |
| 5 | All braking-zone steps | agree | TUM names zone-dependent overtaking as its next step |
| 6 | DP 300 ms per car, up to 3 stops | agree | — |
| 7 | SC trigger per remaining stop | agree | — |
| 8 | Keep "extend", dedupe rule candidates | agree, add | Merge any candidates whose outcomes are identical on every scenario after the first batch |
| 9 | Blocking, relative DRS stay; dirty air 0 | agree | — |
| 10 | S24 | no evidence | — |
| 11 | Stop-lap neighbours ±1–3 laps | agree, supported | Fieni 2026, Wüthrich, TUM's admission, the shield effect; show a pit window (laps within a margin of the best) in 4.3b |
| 12 | Calibrate the pass chance first | agree, sharpen | Per track with a pooled prior; slope tied to the lap scatter; TUM's thresholds as a shape prior only |
| 13 | Plain forecast passes at the median time | agree | TUM shows the same artefact |
| 14 | Pace uncertainty in each scenario | sharpen | Draw the degradation slope as well as the level, σ from `degradation`'s standard errors; re-test, it may move stop laps |
| 15 | *new:* rivals' reaction to our stop | suggest | An ablation in the 4.3b spec: how much the plan relies on rivals not covering |

Checks for the 4.3a calibration (A §7): whether the car ahead loses time when a faster car is within 0.5 s (TUM: 0.3 s per lap; research 12 never measured it), and TUM's rejoin rule (the car just behind a rejoining car is pushed back to 0.5 s). For the displays (B §7): a shown chance to gain a place is measured at the finish or after the field's stops, never mid-stop.

## 3. Corrections to research 11

From Part C §7: §5 "DRS, the tow and effort swamp it" is not Joshi's wording; §5 Wüthrich's dirty-air hump is heuristic, not fitted; §4 "RL 4.96 s off" is Fieni 2025's agent, while Wüthrich's standalone RL is +1.170 s against a 3.370 s MINLP; §5 misses Cappello's skew prior λ ~ N(0.5, 0.1²) and the RMSPE totals.

## 4. The two late sources (Part D)

Read after the user downloaded them (2026-11-11): Aguad & Thraves' supplement and Carrasco Heine & Thraves 2023 in full.

- **SC/VSC rates per circuit (Aguad Appendix A, O6):** the share of races with at least one SC (2000–2023) and one VSC (2015–2023), with race counts, for 25 circuits; source Trotman 2024 (Kaggle "Formula 1 Race Events"). Copied exactly to [`14-aguad-appendix-a.csv`](14-aguad-appendix-a.csv) with an F1 25 track id column. Overall SC 0.47 (455 races), VSC 0.30 (185); as Poisson counts 0.63 SC and 0.36 VSC per race, so the spike's 0.5 SC was about 20–30 % low. The spread matters more than the mean: Catalunya 0.21, Hungaroring 0.25 up to Marina Bay 0.93. Caveats: "at least one" not a count (`race-hazard` still needs TUM's shape for counts, starts, durations); the SC window predates the VSC (era bias); Miami, Las Vegas and Losail missing; Zandvoort, Jeddah, Imola rest on 3 races; the printed totals do not match their rows. Proposal: the track-file default with its source and race count (a domain type change, C78), recomputed over 2015–2025 by `pitwall-trackdata`.
- **Calibrating the rates (C62a):** it works if the aggregate counts each race session once and only races with a known lobby safety-car setting; at about one race per track per season the real prior dominates for years. **Possible contract gap for the 4.3b spec:** the useful learning is one F1 25 factor pooled over all tracks, while a calibration set belongs to one track (C62a); as a `race-hazard` config value (C47) it stays within the contract.
- **Rejoin rule confirmed twice:** Aguad's Appendix G pushes the car behind a rejoining car back to 0.4 s, as TUM's 0.5 s rule: a 4.3a calibration check.
- **Planning for SC chances pays mostly at street circuits:** Carrasco Heine & Thraves (one car, VSC only, nothing fitted) gain about 0–0.03 s per race at a yellow chance ≤ 0.5, 0.1 s at 0.7, 0.4 s at 0.9, 0.65–1.05 s at 0.95 🟡: about 0.1 s at an average track and 0.5–1 s at Marina Bay. Their baseline (deterministic DP re-solved on a yellow) is the spike's SC trigger (proposal 7). Their mean and their win count disagree (rare big gains against frequent small losses), which supports ranking by the mean (proposal 1).
- **Planning against the rival** gains 10–20 points of win rate in three more instances (Aguad Appendix K), and the win-probability objective always gambles: supports proposals 1 and 15.
- **Runtimes for scale:** Aguad's two-car DP 20.5 billion states, 5.5 h; Carrasco Heine's one-car stochastic DP 636 s (Julia, 6 cores). Pitwall's per-car DP without rivals in the state stays in the 300 ms budget.

## 5. Still to get

Both sources of research 11 §9 are now read (§4, Part D). Still missing: Stahn's and Faist's TUM theses on fitting the overtaking model and the parameters are unpublished.


## Part A: the TUM work


Reader: TUM papers and code. 2026-11-11. Builds on research 11; what research 11 already says is cited, not repeated.

**Labels:** 🟢 stated by the source (page / section / file:line) · 🟡 read off a figure · 🔵 my inference.

**Read:**

| Source | How |
|---|---|
| Heilmeier et al., Appl. Sci. 2020, 10, 4229 ("MC paper") | full text, `pdftotext` of `external/applsci-10-04229-v3.pdf`; pages are the paper's "x of 21" |
| Heilmeier, dissertation, TUM 2022 ("Diss") | full text, 205 pp., downloaded from mediaTUM; pages are the **printed** page numbers (PDF page − 12). Bound papers read inside it: Heilmeier et al. 2018 race simulation (IEEE ITSC, Diss pp. 78–84), the VSE paper (Diss §4.5.1, pp. 112–145) |
| TUMFTM/race-simulation (GitHub, `main` as cloned today) | `racesim/src/race.py` (lap step, DRS, overtaking, pit out/in lap, min distances), `driver.py`, `vse.py`, `tireset.py`, `main_racesim.py`; all 121 `pars_<track>_<year>.ini` and `pars_mcs.ini` |
| heilmeiera/time-discrete-race-simulator (Diss ref. [182], p. 169) | skimmed only: `state_handler.rs`, `race.rs`, the example parameter file |

Not read: Stahn's semester thesis (Diss ref. [169], the overtaking model's fitting) and Faist's master thesis (ref. [171], the automated parameter determination); both unpublished.

### 1. Overtaking and blocking

**The model (code, `race.py` `__handle_overtaking_track`, lines 847–970):**
- 🟢 Once per lap, after every car's tentative lap time: front to back, pair by pair. The follower passes if `racetime_front − racetime_back ≥ t_gap_overtake_tot`, i.e. if after this lap it would be **ahead** of the car in front by the threshold. Otherwise, if it would be closer than `min_t_dist` (0.5 s), its lap time is raised so it ends exactly 0.5 s behind: **held to the leader's pace**. The loop repeats until no position changes (several passes per lap possible; more than 20 iterations marks the race invalid, status 10).
- 🟢 `t_gap_overtake_tot = t_gap_overtake (per track) + t_gap_overtake_vel · (vel_max_back − vel_max_front) + t_teamorder` (same team only). `vel_max` is each driver's qualifying top speed (driver parameters).
- 🟢 Costs: when two cars end a lap within 0.5 s of each other (overtaking allowed), **both** get `t_duel` = 0.3 s, once per car per lap; the passed car gets another `t_overtake_loser` = 0.3 s. Every one of the 121 files has 0.5 / 0.3 / 0.3.
- 🟢 No random pass draw anywhere. The only randomness reaching passes is the lap scatter N(0, σ²) per driver and lap (`driver.py:165`), σ 0.458–0.855 s (`pars_mcs.ini`, research 11 §2).
- 🔵 **Effective pass chance.** A held car starts the lap 0.5 s behind and (from lap 3) gets the full DRS gain (§2). It passes if `Δpace + |t_drs| − 0.5 + ε ≥ t_gap_overtake`, where ε is the difference of two lap scatters (sd about 0.85 s for two drivers at σ 0.6). So the threshold plus Gaussian scatter is a **probit hazard per lap**: P(pass) = Φ((Δpace − Δ*) / 0.85) with Δ* = t_gap_overtake + 0.5 − |t_drs|. Austin: Δ* = 1.83 + 0.5 − 0.49 = 1.84 s, giving 6 % per lap at 0.5 s of pace advantage, 16 % at 1.0 s, 34 % at 1.5 s, 57 % at 2.0 s. Research 12 §4 sees about 40 % of F1 25 following episodes end in a pass at 0–0.5 s and 54–67 % at 0.5–1.5 s (median 0.9 laps): the F1 25 AI passes far more easily than TUM's real-F1 model, as research 12 already concluded, now with a number on TUM's side.

**Per-track difficulty** (🟢 the 121 parameter files; one value per track, identical in every season 2014–2019):

| t_gap_overtake (s) | Tracks |
|---|---|
| 1.26–1.50 | Suzuka 1.26, Silverstone 1.35, Sakhir 1.38, Shanghai 1.50 |
| 1.56–1.83 | Hockenheim 1.56, Baku 1.62, Le Castellet 1.635, Monza 1.755, Austin 1.83, Spa 1.83 |
| 2.01–2.42 | Spielberg 2.01, São Paulo 2.025, Mexico 2.055, Yas Marina 2.07, Kuala Lumpur 2.085, Sochi 2.13, Catalunya 2.31, Budapest 2.415 |
| 2.70–3.75 | Melbourne 2.70, Monaco 3.75, Singapore 3.75, Montreal 3.75 |

- 🟢 Source: "PR – previous races" (2018 paper, Table II, Diss p. 83); "a measure of how easy it is to overtake on the track … primarily depends on the track layout" (Diss p. 82). The fitting procedure is in Stahn's unpublished thesis (Diss p. 86).
- 🔵 Three tracks share exactly 3.75 s, Montreal among them, an easy track to pass on: it looks like a cap or default for tracks where the fit failed, not a measurement. The values never change between seasons although cars and DRS rules did.
- 🟢 The values grew from the 2018 paper's example (Yas Marina 2017: t_gap,overtake 1.0 s, t_gap,front 0.95 s, t_overtake,win 0.1 s, t_overtake,lose 0.6 s, Diss p. 83) to the repository's (2.07, 0.5, duel 0.3 both, loser 0.3).
- 🟢 How long cars are held: not measured. The model holds a car until scatter or degradation opens Δ* (no give-up, no backing off).
- 🟢 Diss p. 156 (China 2019): with similar pace, "the simulated DRS effect causes them to stick closely together without the attacker being able to overtake"; in reality the attacker drops back out of turbulent air. "This … occurs less frequently and for shorter periods if probabilistic effects are taken into account." The deterministic run keeps them locked for the whole stint.
- 🟢 Blocking decides results: in China the simulated Verstappen undercut works (it did not in reality) and "Vettel then gets stuck behind Verstappen in his second stint, which changes his subsequent race course the most compared to reality" (Diss p. 157). Hand-tuning used a team-order modifier "at the level of the overtaking threshold" so Vettel passes Leclerc "as soon as he is slightly faster" (Diss p. 157).
- 🟢 Future work: "overtaking maneuvers could be modeled depending on the course of the race track and the DRS zones", which needs time-based discretisation (Diss p. 169). The time-discrete prototype (ref. [182]) does it: per-track `overtaking_zones` (distance ranges) and `drs_measurement_points`; outside a zone the follower is held to `min_t_dist`, inside it may pass; `t_duel` is spread over the zones' lap fraction (`race.rs:243`). 🔵 That is the spike's braking-zone stepping in another form.

### 2. DRS and DRS trains

- 🟢 Code (`race.py:623–655`): from `drs_allow_lap` = 3 and not for `drs_sc_delay` = 2 laps after an SC, a car within `drs_window` = 1.0 s of the car **directly ahead** gets `t_drseffect / 2` twice per lap: once judged on the order before pit out-laps ("start-finish straight"), once after ("elsewhere"). No DRS behind a car that just pitted (first half). It is a lap-time gain only; it does not enter the pass threshold.
- 🟢 Values per track −0.133 s (Montreal) to −0.917 s (Singapore); Austin −0.49, Shanghai −0.553 (files). Diss p. 152: China 2019 from timing data 0.553 s, from the lap-time simulation 0.416 s.
- 🔵 In every file `t_drseffect / t_gap_overtake_vel` is 14.6–15.4 km/h: both come from one track sensitivity (seconds per km/h of top speed), and DRS is taken as about 15 km/h of top speed (Diss p. 11 cites 5–15 km/h).
- 🟢 Trains: the DRS check never asks whether the car ahead itself has DRS, so in a train every follower gains on the car directly ahead and the gains cancel between followers (the spike's v2 "relative DRS"). TUM names DRS trains only as a validation error source (China, research 11 §7) and as the "stick closely together" effect above. 🔵 With a 1.3–3.75 s threshold and DRS of 0.13–0.92 s, DRS alone never causes a pass in TUM's model; it only keeps equal-pace cars inside 0.5 s, where both pay the 0.3 s duel every lap: **a train in TUM slows down as a whole by 0.3 s per lap**, the front car included.
- 🔵 Research 12 §4 finds no loss for an equal-pace follower beyond about 0.14 s inside 0.5 s; the leader's loss was not measured. TUM's duel cost on the car ahead is an assumption ("PR" source, no fit shown).

### 3. Pitting into traffic, clear air, stop laps

- 🟢 Rejoin (code, `__handle_pitstop_outlap`, `race.py:456–531`): the pit loss (pit-lane drive, standstill drawn from a Fisk per team, cheaper under FCY when covered) is added to the out-lap; the order is re-sorted by `previous race time + pit loss` (ties by previous position), then 0.5 s minimum gaps are enforced front to back: **the car the pitter rejoins just ahead of is pushed back**, the pitter rejoining just behind is held. On the out-lap a fresh-tyre car behind a slower one must beat the full threshold; the out-lap carries `t_add_coldtires` = 1.0 s (Austin files, `tireset.py:116`). 🔵 So a stop into a train costs the full held time until scatter or the tyre advantage clears Δ*, typically 1.3–2.4 s per lap of pace advantage.
- 🟢 Strategy sources and traffic:
  - The basic strategy optimiser (BSO) optimises stint lengths "for a race without opponents" on a "free track" (Diss pp. 139, 160); "it can hardly play out its optimality here (it was determined for a free track and without FCY phases)" (Diss p. 139).
  - The supervised VSE sees `close ahead` (the car behind within 1.5 s) and "tire change of pursuer" (Diss p. 123; `vse.py:477, 540`) for defending undercuts, but "we were also unable to create features that lead the VSE to make active use of advanced tactical opportunities such as undercuts. A possible feature that we did not consider is that pit stops are in reality, if possible, placed in such a way that the driver can drive freely afterward" (Diss p. 140).
  - The RL VSE adds an estimated position loss: the number of cars within one pit loss behind, "based on the assumption that none of the following drivers will pit" (Diss p. 146; `vse.py:484–510`). It is a count of cars passed in the pit lane, **not** a measure of traffic ahead at the rejoin. Still, it "can learn to make use of advanced strategic opportunities … the undercut" (Diss p. 147, citing Thomaser p. 57ff.).
- 🟢 Undercut preconditions (Diss p. 6): "A must not be stuck in traffic after his pit stop … driving in free air"; an early stop on a softer start compound "can throw the driver back into traffic and negate the advantage" (Diss p. 4).
- 🟢 **Size of the traffic effect on stop timing: not measured** anywhere in TUM's work.
- 🟢 Neighbours of the optimum: the pit window comes from what-if degradation: A4 degradation ±15 % moves Leclerc's optimal in-lap by **2 laps** each way (window laps 15–19), found by a full-factorial run over every in-lap in the single-car simplified RS (Diss p. 162, Fig. 4.10). Proposed but not done: the window as every in-lap within "one or two seconds of the minimum race duration", for when "one wants to come into the pits earlier or later than initially planned, for example, for an undercut" (Diss p. 162). 🔵 TUM searches stop laps around the optimum only without opponents; with traffic they trust the VSE, not a neighbour search.

### 4. Pace and pace uncertainty

- 🟢 Where pace comes from (Diss pp. 86–88, automated fit by Faist): `t_base = t_Q + t_racepace`; `t_Q` the fastest qualifying lap of all sessions; `t_racepace` from the fastest race lap of the race itself minus that driver's best qualifying lap ("usually in the range of two to three seconds"); `t_car` the team's best qualifying lap against the session best, `t_driver` the gap to the teammate, each **averaged over Q1–Q3** "since, especially for drivers and cars with similar speeds, chance often determines whether they were faster or slower in the decisive session" (Diss p. 87). Degradation: linear per compound, fitted **per team** from the race's own stints (fuel removed, gaps < 0.8 s, FCY, pit laps and stints under 5 laps removed); quadratic or cubic overfit (Diss p. 88). A compound a team did not run is fitted on the whole field.
- 🟢 Even the "before the race" case study uses parameters fitted from the race itself: "the data situation from an external point of view is not sufficient to allow a parameterization based on data from before the race" (Diss p. 160). Hindcast, not forecast.
- 🟢 **No parameter uncertainty inside the Monte Carlo.** The code's only random draws are lap scatter (Gaussian, independent per lap), start performance, Fisk standstill time, and the FCY and retirement events (`grep random` over `racesim/src`). Pace, degradation, DRS and the overtaking threshold are fixed per run. Uncertainty of the estimate appears only as hand-made what-if runs (±15 % degradation, Diss p. 162) and in-race re-optimisation "if the tire degradation deviates strongly" (Diss p. 160).
- 🟢 How big the estimate errors are (hindcast, so a lower bound for a forecast): auto-fitted China 2019 ran about 62 s fast, "slightly more than 1 s" per lap in `t_racepace`, common to all cars and so irrelevant to the order (Diss p. 156); the remaining errors are per driver: per-team degradation (Bottas degraded more than Hamilton in reality, Vettel's third stint too steep), one model per compound for stints 1 and 3, an absurd A6 one-stop from a compound Ferrari never ran (Diss pp. 156–157, 161). Timing data against the lap-time simulation for the same race: `t_racepace` 1.812 vs 1.360 s, S_mass 0.031 vs 0.053 s/kg, t_drs 0.553 vs 0.416 s (Diss Table 4.4, p. 152). Abu Dhabi 2017 deterministic: race time −4.1 to +1.6 s per driver (research 11 §7).
- 🔵 TUM's lap scatter σ is fitted on residuals of a quadratic per stint with only laps 1–2, pit and FCY laps removed (MC paper p. 4), so **battle laps stay in σ**, whereas the same work removes gaps < 0.8 s for S_mass and degradation (Diss p. 88). Research 12 §2 shows battles make most of the slow tail; TUM's σ 0.46–0.86 s is likely inflated by interaction, and independent per lap (research 12 measures a lap-to-lap correlation of 0.14–0.28).

### 5. Ranking strategies under noise

- 🟢 TUM compares strategies by **mean finishing position** over 10,000 runs (`mcs_analysis.py` prints mean positions; Diss Tables 4.2, 4.8, 18/19), sometimes with the mean race time beside it (Table 4.8), and by eye on position histograms (MC paper Fig. 11, p. 16: moving Verstappen's stop from lap 14 to 19 shifts mass to P3). No tie rule, no paired difference, no confidence interval on a comparison, no ranking-and-selection, no common random numbers, no seeds (research 11 §1).
- 🟢 Deterministic and Monte Carlo disagree: Leclerc deterministic P5 against a mean of 3.7 when rivals use the RL VSE; "the fifth position is an edge case in the deterministic simulation" (Diss Table 4.8, p. 161). Mean race times 5,516 vs 5,484 s. Verstappen ahead of Leclerc deterministically but in only 43 % of runs (Diss p. 158).
- 🟢 The strategy-source comparison (Table 4.2, p. 147) picks a random driver of 20 per run, so each mean pools 20 drivers; the BSO–RL differences are 0.0 to 0.7 positions. 🔵 With a per-race spread of about 5.5 positions over random drivers, the standard error of each mean is about 0.055: the 0.4–0.7 differences are real, the 0.0 (China) a tie; TUM does not say.
- 🟢 Runtime and count: 10,000 runs, about 75 s for 6 cars and 285 s for 20 (Diss p. 158); "10,000 simulation runs offer a good compromise" (MC paper p. 17, Table 8). No time cap, no adaptive stop.
- 🟢 **Invalid races are redrawn** (`main_racesim.py:106–118`); invalid includes status 15, "driver did not use two different compounds", and status 10, the overtaking loop (`race.py:29–38`). 🔵 A policy-dependent discard conditions each policy's sample differently and breaks pairing; pitwall must score every scenario for every policy (an illegal plan gets its penalty, not a redraw).

### 6. Driver differences

- 🟢 Per driver: `t_driver` (qualifying gap to the teammate), lap scatter σ (0.458 Vettel to 0.855 Chilton; "unknown" 0.625), start performance N(µ, σ²), accident probability (Beta-Bernoulli), `vel_max`, `t_teamorder` (files; research 11 §2). Per team: `t_car`, failure probability, Fisk pit-stop parameters, **degradation** (both drivers pooled for data, Diss p. 88). No per-driver wear rate, no consistency other than σ, no mistake process.
- 🟢 The RL VSE takes "the driver's name since it adapts its strategy for each driver individually" (Diss p. 146).
- 🟢 Pooling degradation per team is named as an error source (Diss p. 156); TUM decided per-driver and fuel-dependent degradation is beyond what the data allows (Diss p. 157). 🔵 This supports research 12 proposal 3 (a wear-rate factor per driver profile): TUM's main residual error is exactly a per-driver degradation difference.
- Human vs AI: not covered (real F1 only).

### 7. What contradicts or sharpens the spike

1. 🔵 **Equal-pace lock-ups come from the threshold model, not from DRS.** TUM's "stick closely together" (Diss p. 156) and the spike's first-run permanent trains (§10.1, plain forecast never passing) are the same artefact of a deterministic pass rule without scatter. TUM says scatter shortens it; the spike's proposal 13 fixes it for the plain forecast. Agreement.
2. 🔵 **The spike's logistic hazard and TUM's threshold are one family.** TUM's threshold plus lap scatter gives a probit in the pace advantage whose slope is set by the scatter (sd about 0.85 s) and whose midpoint is Δ* (1.2–4.0 s by track). The spike's `0.9 / (1 + e^−(adv − 0.3)/0.5)` per lap held has its midpoint at 0.3 s: on real F1 terms a very easy track. Its × 0.25 variant (§10.3) is the regime where TUM's real-F1 tracks live (6–16 % per lap at 0.5–1 s). So the "brutal" sensitivity of §10.3 is not hypothetical: it is how TUM models every real circuit.
3. 🔵 **Per-track difficulty is a first-order parameter** in TUM (3:1 between Suzuka and Monaco), fitted per track and never per season. Proposal 12's calibration should report the hazard per track, not only per field; until F1 25 tracks are calibrated, a track's position in TUM's ordering is at best a weak prior on its relative difficulty (the game's AI is not real F1).
4. 🔵 **TUM charges the car ahead in a fight too** (0.3 s per lap for both while within 0.5 s); the spike charges the passed car 0.1 s per pass and nothing per lap. Research 12 never measured the leader's loss when followed. A cheap check for the 4.3a `race-interaction` calibration: the leader's residual when a faster car is within 0.5 s.
5. 🔵 **Rejoin push-back.** TUM's minimum-gap rule after a stop pushes back the car the pitter emerges just ahead of; if the spike places the rejoiner without that, a stop that emerges 0.1 s ahead keeps the place for free. Worth one row in the 4.3a rejoin tests.
6. 🔵 **Pace uncertainty drawn per scenario (proposal 14) goes beyond TUM**, which never draws it. TUM's own evidence shows the estimate errors are per driver and in the **slope** (degradation), not only the level: its window comes from ±15 % degradation, which moved the optimal stop by 2 laps. Proposal 14 draws a race-pace level only.
7. 🔵 **TUM's σ is not a clean-air σ** (battle laps included, §4); do not use 0.46–0.86 s as a prior for the core scatter. Research 12's free-air AI σ (94–195 ms) is the right base.

### Consequences for the spike's proposals (research 13 §8, §10.6)

| # | Verdict | Why (TUM) |
|---|---|---|
| 1 Paired-tie ranking by E[pos] | **agree** | TUM ranks by mean position and shows distributions, with no tie rule or paired test; nothing against. Sharpen: never discard or redraw a scenario per policy (TUM redraws invalid races, `main_racesim.py`), or the pairing breaks. |
| 2 CRN required | agree | TUM has none; it is not evidence either way. |
| 3 Time cap 2–3 s | not covered | TUM: fixed 10,000 runs, 75–285 s. |
| 4 Re-score the winner | not covered | |
| 5 All braking-zone steps | **agree** | Diss p. 169 names zone- and DRS-zone-dependent overtaking as the improvement over lap steps; TUM's own time-discrete prototype holds cars outside overtaking zones and passes inside. |
| 6 DP budget | not covered | TUM's BSO: 15 ms (case study), free track. |
| 7 SC trigger per stop | agree | Research 11 §3 (VSE gains only with FCY); nothing new. |
| 8 Rule candidates, dedupe | agree, sharpen | TUM's pursuer-pitted feature uses 1.5 s, not 3 s; the F1 25 AI does not cover anyway (research 12 §6). |
| 9 Ablation: blocking stays, relative DRS stays | **agree** | TUM holds cars at 0.5 s and its largest China deviation is a car stuck in traffic (Diss p. 157); its DRS is relative to the car directly ahead, the same as v2. |
| 10 S24 | not covered | |
| 11 Stop-lap neighbours | **agree, sharpen** | TUM never measured traffic on stop timing and admits its decision tools cannot place a stop into free air (Diss p. 140); the BSO's optimum is a free-track one. Its window (±2 laps from ±15 % degradation; proposed: every lap within 1–2 s of the optimum, Diss p. 162) supports scoring ±1 to ±3 laps and suggests showing that window. |
| 12 Calibrate the pass chance first | **agree, sharpen** | TUM's implicit hazard per lap at 0.5–1.5 s of pace advantage is 6–34 % (Austin), i.e. the spike's × 0.25 regime, where the plan choice moves by up to 0.38 places. Calibrate per track; tie the hazard's slope to the lap scatter (a threshold plus scatter is a probit); TUM's thresholds are a shape prior only (one 3.75 s value looks like a cap). |
| 13 Plain forecast passes at the median time | **agree** | TUM's deterministic run shows the same never-breaking pairs (Diss p. 156). |
| 14 Pace uncertainty per scenario | **agree, sharpen** | TUM draws none; its errors are per driver and in degradation slope (Diss pp. 156–157, 162). Draw a per-car degradation-rate factor besides the pace level, with σ from `degradation`'s standard errors. |

## Part B: operations research and data mining


Reader: papers Aguad & Thraves (EJOR 2024), the CEJOR file, Tulabandhula & Rudin (Big Data 2014), Bonomi, Turri & Iacca (GECCO '23 Companion). Questions from the brief (research 13 §7, §8, §10). Where research 11 already covers something, it is cited and not repeated.

**Labels:** 🟢 stated by the source (page, section, equation, figure) · 🟡 read off a figure or a garbled table · 🔵 my inference.

### Sources and how they were read

| Source | How | Notes |
|---|---|---|
| Aguad & Thraves, EJOR 319(3) 908–919, 2024 | full main text (`pdftotext`), pp. 908–919 | Appendices A–P (online supplement) **still not read**: Appendix G (minimum gap Δ), L (parameter sources), M (state counts) would matter here |
| `s10100-022-00810-8.pdf` | full text (1 page) | **Not the paper.** It is the *Correction* (CEJOR 30:1513, 2022) to Carrasco Heine & Thraves, doi 10.1007/s10100-022-00806-4: it only corrects the first author's name to "Oscar F. Carrasco Heine" |
| Carrasco Heine & Thraves, CEJOR 31(1) 239–268, 2023 | **abstract only** | SSRN 3769652 answers 403 to automated fetches; IDEAS/RePEc lists no free version; Bohrium blocks with a WAF. Nothing beyond research 11 §3 |
| Tulabandhula & Rudin, Big Data 2(2) 97–112, 2014 | full text, read completely | The series name is blanked out in the PDF's text layer; 🔵 it is NASCAR (2012 season; ref. 18 is about the Sprint Cup) |
| Bonomi, Turri & Iacca, GECCO '23 Companion, pp. 1925–1932 | full text | Single-car model, see below |

### 1. Overtaking and blocking

**Aguad & Thraves** (two cars only)
- 🟢 No explicit pass event and no pass probability. A pass happens when the gap state changes sign (§3, after eq. 5: `g_n · g_{n+1} < 0`).
- 🟢 Blocking comes only from the asymmetric interaction term (eq. 14, eq. 23): the car ahead pays `e^(−λ|ε|) · Z1` and the car behind pays `e^(−λ|ε|) · Z2`, with Z1 < Z2. "even if the follower is fast enough to catch the leader, it may still occur that the overtaking maneuver does not take place" (p. 912). ε is the gap **at pit exit** (eq. 13, eq. 22), so the term also covers a car that rejoins close to the other one.
- 🟢 Instance values (p. 915): λ = 2.0 per s; Z1 ∈ {0.2, 0.4, 0.6} s and Z2 ∈ {0.5, 0.7, 0.9} s, each value equally likely, drawn anew every lap (random vector W_n, §4.3). Pace difference between the cars 0.02 s per lap (d0 97.22 against 97.24 s). The choice of values is explained in Appendix L, which I have not read. **Nothing is fitted to data** in the main text.
- 🟢 Extension "minimum time gap Δ > 0 at a point of the circuit", Δ = 0.4 s in the instance (p. 913, Appendix G): "some parts of the circuit in which cars cannot be arbitrarily close to each other". This is a second blocking mechanism. Its exact form is in Appendix G, which I have not read.
- 🔵 **What the numbers imply.** Close behind, the follower's net gain per lap is roughly `pace advantage + T_DRS − (Z2 − Z1) · e^(−λε)`. The means are E[Z2 − Z1] = 0.3 s and E[T_DRS] = 0.28 s, so at contact the DRS and the "follower pays more" term almost cancel. In this instance a car needs only a few hundredths of a second per lap of pace advantage to pass on average, but the draw of Z each lap lets it fail. That is weak blocking, close to the spike's "pass chance × 1" end, not the sticky trains of × 0.25.
- 🟢 No per-track overtaking difficulty: the paper has one generic instance with one DRS zone, on the pit straight (p. 911, Fig. D.1).

**Tulabandhula & Rudin** (NASCAR, 17 races, 119,178 laps, 2,932 outings, about 40 cars, 3–14 cautions per race; p. 100)
- 🟢 No pass model. Rank change over the outing is the target of a regression (ridge, SVR, LASSO, random forest), which aggregates passing and blocking.
- 🟢 **"Protection"** (p. 105, Fig. 8): a car that gains places by a short stop (two tyres) keeps them only if the cars just behind it are also slow. In the example, cars on ranks 13–19 took two tyres. "About half" of them held their positions (ranks 8–11), and the rest were passed by four-tyre cars and fell to ranks 17–27. Their explanation: a faster car "would need to pass several other cars before passing him". 🔵 This is a train acting as a shield: the cars that matter are the ones you rejoin *in front of*, not only the ones you rejoin behind.
- 🟢 **Overtaking difficulty is race-specific** (p. 106): the races split into Group A (6 races: two-tyre cars typically lose places) and Group B (11 races: they keep them). The split was made from lap and position data, not from track features. "our observations are race-specific rather than racer-specific", which "indicates that properties of the track, tires, and weather matter more than racer-specific details". The group "can be done using data from practice and qualifying" on the same track. In Group A the LASSO weight of the two-tyre indicator is positive (lose places), in Group B negative, and the effect grows with the outing's length (Fig. 11).
- 🟢 Expert comments matched the grouping 5 of 5 (p. 110): three "tyres don't matter" quotes were all Group B tracks, and the two others were Group A.

**Bonomi et al.:** not covered. The model has one car and no opponents. The fitness is the sum of lap times (eq. 1).

**CEJOR (abstract):** not covered. The model is a single car without interaction (also stated by Aguad & Thraves, p. 910).

### 2. DRS and DRS trains

- 🟢 **Aguad & Thraves:** DRS cuts the follower's lap time by T_DRS when the gap at the start of the lap is in [0, 1] s (eq. 11, eq. 21). T_DRS ∈ {0.1, 0.3, 0.5} s with P 0.2 / 0.7 / 0.1 (p. 915), so 🔵 E[T_DRS] = 0.28 s. It applies only on the lap segment before pit exit (p. 912). DRS is off on laps 1–2 and for k = 2 laps after a VSC or SC (state y_DRS, eq. 30–31). It changes the follower's time directly; there is no pass-probability factor.
- 🟢 Trains: "at most, there will be one car using the DRS at each time" (p. 912). That holds because there are two cars. With two cars no train can form.
- 🟢 Footnote 15 (p. 917): after the undercut, B is "more than a second" behind and "cannot activate the DRS, and therefore is harder for B to overtake A". 🔵 In this model the 1 s line is the main edge of clear air: the undercut sticks once it puts the rival outside DRS.
- Tulabandhula & Rudin, Bonomi, CEJOR: not covered. NASCAR has no DRS, and Bonomi has no opponents.

### 3. Pitting into traffic and clear air

**Aguad & Thraves**
- 🟢 The rejoin is modelled for one rival. The pit-exit gap is `ε = g + p_A·1{A pits} − T_DRS·1{…} − p_B·1{B pits} − …` (eq. 13 / eq. 22), and the interaction term for the rest of the lap is a function of that gap. So "rejoining just behind the rival" costs time at once.
- 🟢 **The undercut appears as an equilibrium effect** (§5.3, Fig. 4): when B ignores the interaction, A stops one lap earlier (lap 19 against 20), and B comes out more than 1 s behind and never passes again. Against a rival who ignores the interaction, A's win rate rises from 66.01 % to 84.09 % (Table 2: time-gap objective; win-probability objective 84.80 %). 🔵 That gain is large because the instance is a near-tie (0.02 s per lap, 0.2 s of pit loss). It measures what interaction-aware timing is worth when two cars are otherwise equal, not a typical value.
- 🟢 With both drivers strategic, in Fig. 4 left both cars stop on the same laps for the same compounds, and B passes twice on track (laps 14 and 48). 🔵 Covering (mirroring) is the equilibrium answer when the cars are equal. This agrees with research 13 §6: mirror and cover coincide with the field's cluster.
- 🟢 No search over neighbouring stop laps: the DP is exact over its states (the gap grid ±35 s, 0.04 s steps), so the optimum already includes the interaction. It is then scored by simulation (research 11 §3).

**Tulabandhula & Rudin**
- 🟢 **Out-of-sequence green-flag stops corrupt positions** (p. 101): a car that stays out while the 19 ahead pit is "artificially" first. They shorten each epoch so that it "aims to contain only the laps for which cars in front of the racer had not gone into the pit" (p. 105). 🔵 A position-based target (E[pos] at a horizon) must be read after the pit cycle completes; a mid-cycle position is not a gain.
- 🟢 Green-flag stops and caution stops differ: after green-flag stops "the racers are more spread out", while caution stops are "similar to a race restart" (p. 102). An indicator for "pit in caution" is a feature.
- 🟢 **The outing's length is not an important predictor once the outing is long enough** (p. 109, Fig. 11, where the weights stabilise). Their explanation: "after the initial few laps of a long outing, the racers are typically sufficiently spaced apart on the track so that the change in rank position remains relatively constant". 🔵 The places won or lost to traffic are settled in the first laps after a stop. This matches the spike's "held in the 3 laps after a stop" measure (research 13 §10.2) as the right window.
- 🟢 The "fresh air" effect (p. 100, Fig. 4): sorted by position, lap time rises "linearly" with rank at lap 50 in two races (about 40 cars each). The slope of tyre degradation against rank is U-shaped, fitted by a degree-2 polynomial: higher at the front and the back (Fig. 5). 🔵 **Caution:** this mixes car speed with clear air (fast cars run at the front). The paper does not separate them, so it is no measurement of a dirty-air or clear-air time loss. It does not contradict research 12's "dirty air 0".
- 🟢 The size of the effect: a two-tyre stop saves "about 6 seconds on average" against four tyres. Pit-time histogram peaks at about 4, 7 and 14 s (Fig. 1). Extreme rank changes over one outing were 17, 13, 5 and 10 places (Table 2). Effects in seconds of traffic per stop: not reported.

**Bonomi, CEJOR:** not covered (no other cars).

### 4. Pace and pace uncertainty

- 🟢 **Aguad & Thraves:** the pace is fixed. The "ghost lap" is `d0 + p0·1{stop} + β(compound, wear) − h·n` (eq. 12), with h = 0.02 s per lap for fuel. It has no lap-time noise and no uncertainty in the parameters; the only lap-level randomness is Z1, Z2 and T_DRS (§4.2.3). β comes from their Fig. 1 (tyre life S 30, M 40, H 50 laps). Where the values come from: Appendix L, not read.
- 🟢 **Tulabandhula & Rudin:** "pace" enters only as features: lap-time slope per outing (linear fit per outing, Fig. 3), previous ranks, and pooled data from earlier races of the same group. Pooling helps most at the race's start, where there is no in-race history: "Using another race's data is better than the alternative, which is no data at all" (p. 106). Naive pooling across all races fails; pooling within the group works. No Monte Carlo, so no draw of parameter uncertainty.
- 🟢 Their test set is the later outings, and those differ: "racers are closer to the finish line … risk profiles change, leading to more aggressive driving, and typically there are a higher number of cautions" (p. 108).
- 🟢 **Bonomi:** pace from free-practice telemetry in F1 2021, by an amateur driver: "we cannot rule out the possibility that the results … have been affected by the driver abilities" (p. 1928). Fits are linear (research 11 §5). Weather is a deterministic per-lap rain forecast, an integer from 0 to 100 (0 mm to ≥ 5 mm), not drawn (§2, Fig. 1). No uncertainty at all.
- CEJOR: rain appears in the stochastic model (abstract); how it does is unknown.

### 5. Ranking strategies under noise

- 🟢 **Aguad & Thraves:** the objective is either the expected final gap (zero-sum) or the win probability (eq. 42). Draws count one half, "decided by a fair coin toss" (p. 915). Policies are scored on 10,000 simulated races with a normal-approximation binomial CI, `p̂ ± Φ⁻¹(0.975) · √(p̂(1−p̂)/(10000−1))` (footnote 12): 66.53 % [65.61, 67.45] against the DP's own 67.16 %. They compare the two objectives by mean gap, sd and conditional means (Table 2): the gap objective gives sd 2.00 s and the win objective 5.17 s at nearly the same win rate (66.01 against 66.53 %). The win objective gambles (Fig. 3: B stretches a soft stint waiting for a yellow and loses by 30 s instead of 2.9 s). No common random numbers, no ranking-and-selection, no paired test.
- 🟢 **Tulabandhula & Rudin:** decisions are ranked by the predicted rank change over the next outing for each choice (0, 2 or 4 tyres), "myopic" (p. 103, p. 107). They chose rank over lap time because "improvement in rank is really the goal of the team rather than improvements in, for instance, lap time" (p. 103). Evaluation: R², RMSE and sign accuracy. "It is hard to beat the baseline initial rank with respect to the RMSE" (p. 109): zero change happens about 20 % of the time, so the best sign accuracy is about 80 %. Cross-validation: 5 folds, repeated 10 times, "used the same set of folds for all the models used (to control for split variance)" (p. 108). 🔵 That is common random numbers in another guise: compare candidates on the same splits, as proposal 2 does with the same scenarios.
- 🟢 Their predictions shrink the extremes: predicted against true rank change −10.36 / −17, 6.11 / 13, −2.88 / −5, 3.77 / 10 (Table 2), about half the true size. 🔵 That is a warning for the displayed spread (§10.4): a model fitted on average behaviour understates the tails.
- 🟢 **Bonomi:** a deterministic fitness (total race time). 30 GA runs per case; they report best, mean and sd (research 11 §4). They merge strategies with the same number of stops "in order to provide a pit-window as Pirelli does" (p. 1928). In the Barcelona table the top strategies of different compound sequences lie within about 0.12–0.14 s of the fastest (🟡, the table is garbled in the text layer). 🔵 Even deterministic race time leaves many near-equal plans, which supports showing a stop **window** and a tie band rather than one lap.
- Runtimes 🟢: Aguad & Thraves solve in "a few hours" on 15 CPUs (2.10 GHz, parallel C) with hundreds of millions of states per lap past lap 15. Bonomi's GA makes 1.5–2.5 iterations per s and reaches its minimum in under 1 min (game data), or about 5 s at 9–12 iterations per s (Pirelli data), single-threaded.

### 6. Driver differences

- 🟢 Tulabandhula & Rudin: "race-specific rather than racer-specific" (p. 106; research 11 §6). Out-of-sequence stops and races with "irregularities" (crashes, spins, running out of fuel, penalties) are filtered as noise (p. 102). Rule effects such as the free pass add to the noise.
- 🟢 Aguad & Thraves: drivers differ only by d0 (0.02 s per lap) and pit loss (20.2 against 20.0 s); no consistency term. "In reality, the performance of cars are not equal, even if the two cars belong to the same team" (footnote 11).
- 🟢 Bonomi: one amateur driver in the game, whose skill may bias the results (p. 1928). That is the only paper here that uses F1 game data. 🔵 It confirms that game telemetry from a human gives usable linear fits but says nothing about the AI's pace or consistency.
- 🔵 No paper here bears on the spike's AI, DR and Asymetrisch scatter values or on the human wear factors (× 1.4, × 1.8).

### 7. Contradictions and sharpenings of the spike

1. **Per-track pass difficulty (sharpens proposal 12).** Tulabandhula & Rudin's main finding is that whether a short stop holds its places depends on the race (track, tyres, weather), not the driver, and that the split shows in the data and could be set from practice and qualifying. 🔵 The pass hazard that proposal 12 calibrates should be **per track** (the track file or the calibration set), with a pooled prior across tracks for tracks with little data. One global hazard would average a Group A and a Group B track, which is exactly the parameter the spike found most decision-relevant.
2. **Protection by the cars behind (sharpens proposals 11 and 13).** A rejoin is judged both by the train ahead (the spike's train-aware term) and by whether slower cars rejoin *behind* us and shield us from faster ones. 🔵 The Monte Carlo captures this by construction. The DP's train-aware term (§10.1) looks only ahead, which is one more reason proposal 11 lets the Monte Carlo pick the stop lap.
3. **DRS size (supports §10.1's relative DRS).** Aguad & Thraves' E[T_DRS] = 0.28 s per lap within 1 s is close to the spike's 0.25 s gain. Both are assumptions (theirs explained in an Appendix L I have not read), so this is agreement between two guesses, not calibration (research 11 §7, point 5).
4. **The 1 s DRS line is what makes an undercut stick** (Aguad, footnote 15). 🔵 This sharpens proposal 11: the stop-lap neighbours matter most when one lap decides whether we rejoin inside or outside 1 s of the rival. A display could show "rejoin gap to car X" next to the candidates.
5. **Objective choice changes behaviour (supports proposal 1).** In Aguad & Thraves, maximising P(win) at the same win rate raises the final-gap sd from 2.00 to 5.17 s and produces "wait for a yellow" gambles. 🔵 By analogy, ranking by E[points] or P(gain) as the *primary* key would favour gambles for a midfield car. Proposal 1's order (E[pos] first, E[points] only inside a tie) avoids that. Tulabandhula & Rudin also chose rank over time as the target.
6. **Mirroring is the equal-car equilibrium (agrees with proposal 8).** With both cars strategic, Aguad & Thraves' cars stop on the same laps (Fig. 4 left), and the undercut appears only against a non-reacting rival. This agrees with research 13 §6, where "mirror" equals "box with the field's cluster". 🔵 Note that the spike's AI does not react to our stop (no cover). Aguad's +18 pp shows that an undercut's value depends strongly on whether the rival reacts. That makes the rivals' reaction rule (research 12 §6) a parameter to test, like the pass chance.
7. **Positions mid-pit-cycle are not gains (a caution for the displays).** Tulabandhula & Rudin had to cut their epochs so that positions inflated by others' stops did not count. 🔵 Any shown "positions gained" or P(gain) should be measured at the finish or after the field's stop cycle, never at a mid-cycle lap.
8. **Traffic losses happen early in the stint** (Tulabandhula & Rudin: the outing's length does not matter after the first laps). That supports measuring traffic as "held in the first laps after a stop" (§10.2) and calibrating the rejoin cost from those laps only.
9. **Fresh air ≠ dirty air (no contradiction).** Tulabandhula & Rudin's linear lap-time-against-rank effect mixes in car pace. It is no evidence against research 12's "dirty air 0"; I mention it only so that nobody cites it as a dirty-air number.
10. **Shrunk tails (a caution for proposal 14).** Their regression predicts about half the true extreme rank changes. 🔵 That supports drawing the pace uncertainty inside the Monte Carlo (proposal 14) rather than trusting point estimates, and checking the shown q10–q90 against recordings (CRPS, research 11 §7).
11. **The SDP's planned delay (CEJOR, abstract only).** "tends to delay pit stops" to use a possible yellow. The spike's DP already carries the SC/VSC state and the expectation over them (§1), so it is an SDP in this sense; nothing new without the full text.

### Consequences for the spike's proposals

| # | Verdict | Why (this reread) |
|---|---|---|
| 1 Paired-tie ranking, E[pos] first | **agree** | The win-probability objective gambles (Aguad Table 2, sd 2.00 → 5.17 s); rank was also Tulabandhula & Rudin's target |
| 2 CRN | **agree** | The same cross-validation folds for every model (Tulabandhula & Rudin) is the same idea; no paper here uses CRN in simulation |
| 3 Time cap | no evidence | No paper reports convergence of a ranking |
| 4 Re-score the winner | no evidence | — |
| 5 All braking-zone steps | no evidence | Aguad splits the lap at pit exit only |
| 6 DP budget, keep 3 stops | agree (research 11) | Bonomi's 3-stop Montreal case |
| 7 SC trigger per stop | agree | The SDP delays stops for yellows (CEJOR abstract; Aguad Fig. 3) |
| 8 "Extend", dedupe mirror/cover | **agree** | Equal strategic cars mirror each other (Aguad Fig. 4) |
| 9 Ablation (blocking stays, DRS relative) | **agree, sharpen** | Blocking and DRS are the whole interaction model in Aguad; their DRS mean 0.28 s is close to 0.25 s (both assumed) |
| 10 S24 | no evidence | — |
| 11 Stop-lap neighbours | **agree, sharpen** | The undercut turns on the 1 s DRS line (Aguad fn. 15); protection by cars behind (T&R Fig. 8) is invisible to the DP's ahead-only train term; windows rather than single laps (Bonomi, Pirelli) |
| 12 Calibrate the pass chance first | **agree, sharpen** | Make it **per track** with a pooled prior: overtaking difficulty is race-specific, not driver-specific (T&R Groups A/B, p. 106) |
| 13 Plain forecast passes at ln 2 | no evidence | — |
| 14 Pace uncertainty in the scenario | **agree** | No paper here draws parameter uncertainty; T&R's point predictions halve the extremes (Table 2) |
| new | **suggest** | The rivals' reaction to our stop (cover or not) is worth an ablation: Aguad's undercut is worth +18 pp only against a rival who does not react |

### Still open

- Aguad & Thraves' supplement (doi 10.1016/j.ejor.2024.07.011): Appendix G (the minimum-gap Δ = 0.4 s mechanism), L (where Z1, Z2 and T_DRS come from), A (SC/VSC rates per circuit). Needs a download by the user (research 11 §9).
- The Carrasco Heine & Thraves full text: SSRN 3769652 refuses automated fetches (403); it needs a browser download.

## Part C: the arXiv papers and the ranking methodology


Reader agent, 2026-11-11, after the compute spike (research 13). Read-only.

**Labels:** 🟢 stated by the source (section, table, figure) · 🟡 read off a figure · 🔵 my inference. Numbers quoted as printed.

**What I read**

| Source | How |
|---|---|
| Fieni et al. 2025, *Benchmarking Learning-Based F1 Race Strategies* (arXiv 2512.21570v2) | full PDF text; relevant parts (intro, §5, conclusion) read closely, model sections skimmed: research 11 §4–5 already covers them |
| Fieni et al. 2026, *Learning-based Multi-agent Race Strategies in F1* (arXiv 2602.23056v2) | full PDF text |
| Joshi 2026, *The Persistence of the Dirty Air Penalty* (arXiv 2608.03192) | **full PDF text, every section** (no arXiv HTML exists for it); its figures are not in the text layer, so no bin values |
| Wüthrich et al. 2026, *Bridging RL and MPC for mixed-integer optimal control…* (arXiv 2604.00826v2) | **full PDF text, every section** |
| Cappello & Hoegh 2025 (arXiv 2512.00640) | full PDF text |
| Eckman & Henderson, *Guarantees on the probability of good selection*, WSC 2018 tutorial | full text (author's site) |
| Chick, Branke & Schmidt, WSC 2007 (paper 033) | full text; Branke, Chick & Schmidt, *Mgmt Sci* 53(12) 2007, abstract only (behind a bot wall) |
| Nelson & Matejcik 1995; Kim & Nelson 2001 (KN); Chen et al. 2000 (OCBA); Law 5th ed. | **not fetched** (paywalled or a book): from standard knowledge, labelled 🔵 unless confirmed through Eckman & Henderson. Note: in Law's 5th edition, selecting the best is ch. 10 ("Comparing alternative system configurations"); ch. 11 is variance reduction, where CRN is |

**The short version.** None of the five papers models a field: Fieni 2025 has one car, Fieni 2026 and Wüthrich two, Joshi and Cappello model no strategy. None models DRS, a pass probability, pace uncertainty inside a Monte Carlo, or ranking under noise. All three ETH papers are deterministic. So they do not calibrate anything in research 13 §10. They do support three things qualitatively: stop timing shifts around a fixed compound sequence in reply to traffic (proposal 11); traffic after a stop costs several seconds (blocking, proposal 9); and the discrete stop choice is where the local minima are. The ranking methodology (Q5) sharpens proposal 1 in four places.

### 1. Overtaking and blocking

- **Fieni 2025:** not covered. One car, no opponents. Traffic is named only as an anecdote (Schumacher, France 2004, §1 🟢) and as future work ("probabilistic models, such as pit stop timing, traffic or weather", §6 🟢).
- **Fieni 2026:** there is no pass model. 🟢 §II-C eq. 7–8: each car has a gap state, `t_gap[k+1] = t_gap[k] + (T_lap^i − T_lap^1)`, and a pass is just the gap changing sign. Nobody defends and there is no pass roll or threshold. The only coupling is `ΔT_int = a·t_gap + b` for 0.2–1.35 s, else 0, paid by the car behind (eq. 6). 🟢 "a and b are track-dependent fitting coefficients", fitted to the numerical two-car solution of their ref. [16] at Bahrain. "For many circuits (not shown here)" the linear form fits. At Monza drag reduction dominates and the follower *gains*. The coefficients are not printed; Fig. 3 runs from about 0.33 to 0.16 s (🟡, research 11 §5).
  - How long a car is held: nobody is held by force, but a car can *choose* to hold back. 🟢 §IV-B: A "maintains a gap of approximately 1.6 s, staying outside the wake effect region" for the first third (to lap 19). 🔵 That only happens because the wake costs time; with dirty air 0 (research 12 §4) it would not.
  - Per-track difficulty: only through the track-dependent a and b, and the sign flips between Bahrain and Monza 🟢.
- **Wüthrich 2026:** no pass model either. 🟢 §IV-C eq. 14–15: a gap state `T_gap(j+1) = T_gap(j) + T_lap,traffic(j) − T_lap,opp(j)`, starting at 2 s on the lap of the first stop. The opponent laps "0.5 s slower than the lap time in a nominal scenario". The penalty `T_lap,penalty(T_gap)` is "a heuristic function" (Fig. 3): a peak of about 0.5 s at a 0.6 s gap, 0 when side by side, 0 beyond 2.5 s. It is **not fitted to anything** 🟢; research 11 §5 omits that it is heuristic.
  - 🔵 The hump is a hidden blocking threshold. With the follower 0.5 s per lap faster and the penalty peaking at about 0.5 s, the gap stops closing near the peak. The follower is held until energy deployment (or the leader's tyres) tips the balance. That is TUM's threshold idea with a 0.5 s threshold instead of 2.01 s.
  - How long: the nominal car (no traffic model) "eventually overtakes by virtue of the competitor being slower. However, this happens only much later", losing **6.87 s** against the traffic-free race (🟢 §IV-C). From Fig. 4 the held period runs from the first stop (about lap 18) over many laps (🟡; the lap of the pass cannot be read reliably).
- **Joshi 2026:** not covered. The dataset has "running position" (§2.1 🟢), but no pass or position change is analysed. 🔵 Laps with a position change are not filtered out (§2.2 lists only the green-flag, no-pit and dry-compound filters). So a faster car closing up and passing lands in the small-gap bins, which is the selection effect research 12 §4 found in its 1.5–2.5 s bin.
- **Cappello & Hoegh:** not covered. Being "stuck behind a slower car" is one reason for the heavy tail (§3.3.3 🟢). Hamilton "was minimally impeded" in the race used (§4.5 🟢). Proposed fix: a gap-to-car-ahead covariate, or a multivariate model of all drivers (§4.5 🟢).

### 2. DRS and DRS trains

- **No paper models DRS.** The word does not occur in any of the five texts (checked by search) 🟢.
- Fieni 2026 models the slipstream's drag reduction only implicitly, inside the Monza sign of ΔT_int (§II-C 🟢). It names, without modelling, faster tyre degradation, brakes and engine cooling behind another car 🟢.
- **Trains:** not covered anywhere. Two cars at most.
- **Correction to research 11 §5:** "DRS, the tow and effort swamp it" is not Joshi's wording. Joshi names neither DRS nor the tow. He blames "tyre strategy, driver behavior, and race context" (§5.2, §7 🟢) and, for the U shape, "drivers try harder when they race actively in the middle following distances", unconfirmed (§5.3 🟢). 🔵 Joshi's sample keeps DRS laps, so DRS sits inside his slope. That is consistent with research 12's "DRS on and off give the same shape", but Joshi cannot separate them.

### 3. Pitting into traffic and clear air

- **Fieni 2026:** this is the paper's main result, for two cars. 🟢 §IV-B: A (M0, S19, S33) against B (M0, S22, S49). "After pitting on lap 19, A rejoins the track outside the wake of B", closes up on fresh softs, and "when B pits at lap 22, it rejoins behind". "Just before being overtaken, A pits again at lap 33, avoiding the disadvantage of the aerodynamic interaction." A wins by **12.82 s** 🟢.
  - 🟢 §IV-C: "A consistently adopts a two-stop strategy (M, S, S), modifying the pit-stop laps to react to the opponent … variations in the pit stop timing are performed to react to the competitor's response, while preserving the underlying strategy."
  - The other agents switch between one, two and three stops depending on the opponent and who starts ahead 🟢.
  - Size: the interaction-module agents beat the single-agent policy by about 12–20 s when starting behind, for initial gaps of 0–2.4 s (🟡 Fig. 7). That figure mixes energy allocation with stop timing and is not split 🟢 ("race outcomes are not only determined by pit-stop decisions").
  - Rejoin position: from the gap state and the in- and out-lap times of the lap-time maps. No field, so no train to rejoin into.
- **Wüthrich 2026:**
  - The traffic is imposed: it "arises when a pit stop takes longer than expected and the driver rejoins behind slower competitors" (§IV-C 🟢), and is placed after the first stop.
  - 🟢 "Both implementations keep the pit stop strategy identical to the traffic-free scenario … confirming that an additional stop is not beneficial". 🔵 **This is not a test.** The stop decisions come from the RL actor, which was not retrained and has no gap in its observation; the MPC optimises only the continuous energy inputs (§III-A, §IV-C). The stop could not have moved.
  - 🟢 Size: traffic behind a car 0.5 s per lap slower costs **6.87 s** without a traffic model. With it, the MPC harvests battery and then deploys it "aggressively to overtake", finishing **5.19 s** ahead of the nominal variant.
  - 🔵 F1 25 humans can do the same with overtake mode, but pitwall does not plan energy (research 11 §4), so for pitwall this is a time loss to model, not a lever to plan.
- **Fieni 2025:** not covered.
- **Neighbours against trusting the optimiser:**
  - Fieni 2025 and 2026 trust the MINLP (BONMIN) or the policy.
  - Wüthrich 🟢 §IV-B: "Local minima arise primarily from the discrete pit stop decisions". The NLP gives "a local rather than a guaranteed global optimum" (§IV-A).
  - 🔵 That supports enumerating stop laps (the DP plus the neighbours of proposal 11) rather than a local search, and Fieni 2026 §IV-C is the closest published analogue of "same compounds, shifted stop lap" as the reply to a rival.
  - Nobody measures how much traffic moves the optimum stop lap in a field.

### 4. Pace and pace uncertainty

- **Fieni 2025, Fieni 2026, Wüthrich:**
  - Pace comes from lap-time maps of a lap-time solver (research 11 §5), identical for both cars in Fieni 2026 (🔵: "structurally identical agents", same model, both start on mediums, §IV 🟢).
  - **Everything is deterministic**: "deterministic transition function" (Fieni 2026 §II-E 🟢), "deterministic, discrete-time systems" (Wüthrich §II-A 🟢).
  - The only randomness anywhere is the initial gap drawn per training episode (Fieni 2026 §III-B 🟢).
  - There is no qualifying, practice or previous-race pace, no lap noise and no parameter uncertainty. Fieni 2026 lists safety cars, weather and "traffic through probabilistic representations" as future work (§V 🟢).
- **Cappello & Hoegh:**
  - Pace comes from the race's own laps, filtered.
  - Priors: α_reset from Leclerc's FP2 long run (research 11 §5); skew prior λ ~ N(0.5, 0.1²) (§3.3.3 🟢, missing from research 11).
  - The uncertainty is parameter uncertainty (the full Stan posterior) plus observation noise. The one-step-ahead predictive intervals are asymmetric, with the 99 % interval extending further on the slow side (Fig. 4 🟢). The intervals "almost always contain the observation" (Fig. 5 🟢).
  - **How big:** after a full stint the degradation slope is still wide. ν hard 0.054 s per lap (95 % 0.004–0.133), medium 0.060 (0.009–0.120) (Table 3 🟢). The growth β is 0.011 (0.003–0.020) and 0.010 (0.002–0.018) (Table 4 🟢).
  - 🔵 A 95 % width of 0.11–0.13 s per lap means an sd of about 0.03 s per lap. Projected 20 laps ahead that is about 0.6 s at the stint's end, or 0.3 s averaged over the stint. That is a *slope* uncertainty, which grows with the laps ahead. The spike's σ (0.25 s at lap 1, 0.08 s from lap 20) is a *level* uncertainty that does not.
  - Total RMSPE (Table 1 🟢, the totals research 11 omits): ARIMA 1.520, base 1.169, ext. 1 1.187, ext. 2 1.218, skewed t 1.082.
- **Joshi:** not covered as an estimate. Collinearity shows in his correction (Table 1 🟢):

  | Compound | TyreLife (s per lap) | LapNumber (s per lap) |
  |---|---|---|
  | hard | +0.072 | −0.247 |
  | medium | −0.103 | −0.139 |
  | soft | −0.321 | −0.056 |

  The pooled Table 2 gives TyreLife +0.082 and LapNumber **+0.087** 🟢. 🔵 A soft getting 0.32 s per lap *faster* with age, and the fuel proxy flipping sign between tables, show that age and lap cannot be separated by a linear fit within stints. This confirms research 11 §5 and research 12 §3 (γ fixed from a prior), and it also lowers my confidence in Joshi's corrected lap times as a whole.

### 5. Ranking strategies under noise

#### What the papers do

- **Fieni 2025, Wüthrich:** deterministic, so they rank by race time against the MINLP; no noise. Wüthrich's standalone RL is **+1.170 s** off a 3.370 s MINLP (Table I 🟢). Research 11 §4's "RL 4.96 s off" is Fieni 2025's agent (§5.1 🟢), not Wüthrich's.
- **Fieni 2026:** ranks *agents*, not strategies, by **Elo** over pairwise duels 🟢 §III-A. The reason given is that "an agent with suboptimal pace may still win under favorable initial conditions". The arena has m = 4 agents, Elo A 1970, B 946, C 914, D 970 (Table II 🟢).
  - 🟢 §I: teams "compute a large number of Monte Carlo simulations to prepare three to four baseline strategies".
  - 🟢 §IV-C: "selecting among multiple strategies with comparable race times remains challenging."
  - Nothing on run counts, ties, CRN or time.
- **Cappello:** compares forecasters by RMSPE and CRPS under rolling origin, which is relevant for scoring the shown distribution (research 11 §7), not for choosing a policy.
- **Joshi:** not covered.

#### What the simulation literature says, against proposal 1 and the 5 s cap

**a) Indifference zone against good selection.**
- The classical guarantee (Bechhofer; Rinott; KN) is a probability of *correct* selection P(CS) ≥ 1 − α *only when the best beats the second by at least δ* (the preference zone). It "say[s] nothing about the performance of a selection procedure when the configuration is not in the preference zone" (Eckman & Henderson §2 🟢).
- Real instances with many alternatives are "unlikely to belong to the preference zone" 🟢.
- The better target is the **probability of good selection**: P(selected within δ of the best) ≥ 1 − α (🟢 E&H). Procedures that use common random numbers, such as Nelson & Matejcik 1995, have been shown to deliver it (E&H §3.2 🟢).
- Whether the fully sequential KN procedure delivers good selection is "an open question" (E&H §5 🟢).
- 🔵 Research 13 is already in good-selection territory: its measure "winner within 0.05 of the 50,000-scenario reference" *is* good selection with δ = 0.05, and the cases have five policies within 0.01 (§10.5), exactly where a correct-selection guarantee is void. Proposal 3's test should be stated as good selection: P(winner within 0.05) ≥ 0.95 over repeats at the cap.

**b) "Tie within 2 SE" is the wrong kind of tie.**
- 🔵 Proposal 1 ties two policies when the paired difference is *within 2 SE*. That is "not shown different" (failing to reject), and it widens as the sample shrinks: at a tight cap everything ties and the secondary keys decide.
- The equivalence form is "shown within δ": `|Δ| + z·SE < δ` (a TOST-style test). The spike's own adaptive stop already uses it ("tied, `|Δ| + z·SE < band`", research 13 §1).
- The literature's indifference zone means the second form. The parenthesis "and below a small practical band, 0.05 places, never below the MC's own error" can be read as either, so the spec should say which.
- 🔵 Recommendation: a policy is in the **tie set** when its paired Δ to the E[pos] leader satisfies `Δ < max(δ, z·SE)` with δ = 0.05. The secondary keys then act only inside that set. When the set is large only because SE is large, the run is budget-limited, and the panel should say "not separable at this budget" rather than present a points-based pick as a finding.

**c) Pairwise ties are not transitive: compare with the best.**
- 🔵 With pairwise ties, A can tie B and B tie C while A beats C, so "rank by E[pos], ties broken by E[points]" has no well-defined order.
- Multiple comparisons with the best (Hsu; the intervals Nelson & Matejcik pair with selection, 🔵) compare every policy with the current best, which gives one tie set and one order.
- Proposal 1 should define the tie set against the E[pos] leader, then the E[points] leader within it, then the mean time.

**d) Multiplicity and repeated looks.**
- 🔵 KN controls error over k − 1 comparisons (its constant uses 2α/(k−1)) and over every look (a triangular continuation region). The spike uses z = 2 at every batch for every pair.
- Bonferroni-level z at α = 0.05 is 2.58 (k = 11), 2.69 (k = 15), 2.79 (k = 20), 2.92 (k = 30) (computed 🔵).
- With z = 2, repeated looks raise the chance of wrongly calling a policy "clearly worse". It costs little where the eliminated policies are far behind (research 13 §3), but it grows with the candidate count.
- 🔵 Use z ≈ 2.7–2.9 for elimination with 15–30 candidates; z = 2 can stay for the tie test (b), where an error only costs a tie-break.

**e) What KN would need, and why a cap.**
- 🔵 KN's maximum stage per pair is `h²·S²/δ²` (S² the paired variance). With α = 0.05, n0 = 100 and δ = 0.05, h² ≈ 9.7 (k = 11), 10.4 (15), 11.1 (20), 12.0 (30). Per policy that gives:

  | Paired sd | Maximum stage per policy |
  |---|---|
  | 0.37 (near-identical plans) | 530–660 |
  | 1.0 | 3,900–4,800 |
  | 1.44 (research 13 §10.5) | 8,000–10,000 |

- A fixed-confidence procedure at δ = 0.05 cannot finish in 5 s when two genuinely different plans are close. Research 13 §10.5 measured exactly this: full resolution up to 21,200 evaluations.
- 🔵 So a time cap with good selection *measured* (proposal 3's reference test) is the right frame, not a guaranteed procedure.
- Chick, Branke & Schmidt (WSC 2007 🟢): fixed-budget ("S") stopping is less efficient than adaptive stopping rules. To reach a PICS of 0.005 one allocation needed about 115 / 125 / 172 samples under the EOC-Bonferroni / Slepian / fixed rules.
- Branke, Chick & Schmidt 2007 (abstract 🟢): the most efficient procedures are OCBA- and EVI-type allocations "together with new adaptive stopping rules".
- 🔵 That matches the spike's finding that the gain came from the stopping rule, not the allocation (research 13 §3). Keep the adaptive stop under the cap.

**f) OCBA and CRN.**
- 🔵 Chen et al.'s OCBA allocates a fixed budget in proportion to (σ_i/Δ_i)², assuming independent sampling.
- With CRN, the variance that matters is that of the paired difference to the best. Correlated-sampling variants exist (Fu et al. 2007, not read). Plugging paired variances into the OCBA ratios is the usual heuristic.
- The spike found equal allocation as good on its shapes, so OCBA is optional.
- 🔵 One cheap gain specific to CRN: policies whose action sequences are identical in a scenario give a bit-identical race (research 13 §7). Two policies with a paired difference of exactly 0 on all n0 scenarios can be merged before further sampling. This de-duplicates proposal 8's mirror and cover rules, and many neighbours of proposal 11, automatically.

**g) The 5 s cap in numbers** (🔵 from research 13 §10.5).
- Budget: 1,100–1,300 scenario-policies per s single thread; the DP for two cars and two rounds takes about 0.8 s at lap 1. That leaves about 4.2 s, or 4,600–5,500 evaluations (4,000–4,900 if the 0.5 s re-score of proposal 4 is inside the cap).
- Scenarios per policy at equal allocation: 15 policies 270–365, 20 policies 200–275, 30 policies 135–180.
- n0 = 100 for 30 policies alone is 3,000 evaluations, 55–65 % of the budget. Law's normal-theory two-stage procedures suggest n0 ≥ 20 (🔵 recollection). With 25–30 candidates, use n0 of about 30–50, then the merge of (f), then eliminate.
- The SE of a paired difference at n scenarios is 2·sd/√n for the 2 SE band:

  | Paired sd | n = 300 | n = 1,000 | n = 3,000 |
  |---|---|---|---|
  | 0.37 | 0.043 | 0.023 | 0.014 |
  | 1.44 | 0.166 | 0.091 | 0.053 |

- Proving equivalence at δ = 0.05 needs 2SE < 0.05: about 220 scenarios for near-identical plans and 3,300 for different plans.
- 🔵 So within 5 s, near-ties between variants of one plan (trigger or neighbour) resolve. Near-ties between different plans usually do not, and they will fall to the secondary keys. Proposal 3's reference test must be run at the largest candidate count (17–30) under the 5 s cap, because 2 s was only shown for about 15.

**h) The winner's curse.**
- 🔵 The selected policy's sample mean is biased optimistically. For m exactly tied contenders the bias is about SE × E[max of m standard normals]: 0.56 (m = 2), 0.84 (3), 1.16 (5), 1.54 (10) (computed). For five near-ties with paired SE 0.02 that is about 0.02 places, which matches the spike's measured −0.03 to +0.02 (research 13 §3).
- The standard remedy is to estimate after selecting, on fresh replications: proposal 4. 🔵 But re-scoring **only the winner** makes the *shown gap* between the winner and the others inconsistent: the others keep their optimistic or pessimistic selection-sample values.
- Either re-score the shown top few together on the same fresh scenarios (paired), or show the gaps from the selection run with intervals against the best (MCB-style).

**i) E[points] as the second key.**
- 🔵 Points are a step function of position. For a midfield car E[points] rests on the P(top 10) tail, which converges slower than the mean (research 11 §1 pitfalls). Its paired SE is larger per scenario relative to the differences, so it ties more often.
- That is fine as a tie-breaker, but its own tie set should use the same "compare with the leader" rule (c).

### 6. Driver differences

- **Fieni 2025, Fieni 2026, Wüthrich:** not covered. Identical cars and lap-time maps; "consistency" in Fieni 2026 means an agent's race time varying little across opponents (§IV-C 🟢). There is no driver noise, no human/AI split and no per-driver wear.
- **Cappello:**
  - Mistakes are a positive skew. A mistake "could lead to an increase of several tenths" before the driver returns "to the target times given by the team" (§3.3.3 🟢).
  - df is fixed at 2 for the heavy tail and for fit speed (🟢; research 11 covers df).
  - New: drivers "are not driving at the absolute limit and are actively trying to manage their degradation rates. This partly explains why we tend to see a linear decay" (§4.3 🟢). 🔵 In F1 25 the linear wear (research 12 §3) has a different cause: a game wear model and AI that may not manage tyres. Humans' 1.4–2 × wear (research 12 §3) is the opposite of management. Do not import Cappello's linear-decay reasoning as evidence about F1 25 drivers.
- **Joshi:**
  - "All of the mean residuals for driver-level effects were under 1 second. Driving style is not a material confounder here" (§3.1 🟢). 🔵 Under 1 s is not small for this question: the whole following effect is about 0.02 s per second of gap.
  - Baku and São Paulo show "substantially higher variance" (§3.1 🟢): variance per track, in line with research 12's per-session σ.
  - Driver and compound heterogeneity "left for future work" (§6 🟢).
- Nothing in these papers bears on the spike's DR and Asymetrisch scatter, mistake rates or wear factors. Those stand on research 12 alone.

### 7. What contradicts or sharpens a spike finding

1. **Proposal 11 (stop-lap neighbours): sharpened in its favour.**
   - Fieni 2026's strongest agent keeps its compound sequence and shifts its stop laps in reply to the opponent (§IV-C 🟢). Its undercut and its "pit before being overtaken" are wake-driven timing moves.
   - Wüthrich: the local minima lie in the discrete pit choice (§IV-B 🟢).
   - Both point to enumerating stop laps around the plan rather than trusting one optimiser's lap.
2. **Proposal 9 update (blocking stays): supported.** Wüthrich's single rejoin behind a car 0.5 s per lap slower costs 6.87 s (🟢). That is the same order as the spike's rejoin-train losses (1.7–4.8 s in the first 3 laps, research 13 §10.2), though it is reached through a heuristic wake rather than a pass hazard.
3. **Dirty air 0 (proposal 9): unchanged, and one ETH behaviour should not be copied.**
   - Fieni's "hold 1.6 s back outside the wake" (§IV-B) exists only because the model has a wake loss.
   - Fieni 2026's own term is fitted to a simulation and changes sign by track. Wüthrich's is heuristic.
   - Joshi's real-timing slope points the other way (closer is faster: +0.0137 s per s of gap, p = 0.073, Table 2 🟢). Of his season-level causal-forest effects only 2025 is negative (−0.0052, Table 4 🟢).
   - 🔵 Joshi is weak evidence (sign-flipping corrections, §4; no position-change filter, §1; untestable unconfoundedness, §6 🟢). It neither confirms nor refutes research 12.
4. **Relative DRS and trains (research 13 §10.1): no evidence either way.** No paper models DRS or trains.
5. **Proposal 12 (calibrate the pass chance first): reinforced by absence.** No paper has a pass hazard, so there is nothing to borrow. The 4.3a `race-interaction` calibration on F1 25 recordings is the only source.
6. **Proposal 14 (pace uncertainty): sharpen.**
   - Cappello shows the *degradation slope* stays uncertain after a whole stint: 95 % width 0.11–0.13 s per lap (Table 3 🟢).
   - 🔵 Draw the slope per scenario as well as the level, both from `degradation`'s filter covariance. A level-only σ of 0.08 s from lap 20 understates the spread of a long remaining stint.
   - This may change *choices* as well as the shown spread, because the slope decides the stop lap. The spike's "changes no decision" (§10.4) tested a level draw only.
7. **Proposal 1 (ranking): sharpen.** See §5 b–d and i:
   - the tie set is "within max(δ, z·SE) of the leader", against the best, not pairwise;
   - the tie is defined in the equivalence sense, and the spec says which reading of the parenthesis it means;
   - elimination uses a Bonferroni-level z (2.7–2.9 for 15–30 candidates).
   - The mean paired time as the last key is right (research 13 §7); nothing in the literature argues for the median.
8. **Proposal 3 (cap) under the user's 5 s:**
   - 5 s fits 4,600–5,500 evaluations, enough for 15–20 candidates at 200–365 scenarios each.
   - With up to 30, lower n0 to about 30–50 and merge identical policies after the first stage (§5 f–g).
   - State the test as good selection (≥ 95 % of repeats within 0.05 of the reference) at the largest candidate count.
9. **Proposal 4 (re-scoring):** agree with re-scoring, but re-score the shown top few together on paired fresh scenarios, or the shown gaps carry the selection bias (§5 h). If the 0.5 s is inside the 5 s cap, subtract it from the budget in (g).
10. **Corrections to research 11:**
    - §5 Joshi: "DRS, the tow and effort" is not his wording (§2 above).
    - §5 Wüthrich: the hump is heuristic, not fitted.
    - §4: "RL 4.96 s off" is Fieni 2025's agent; Wüthrich's standalone RL is +1.170 s against a 3.370 s MINLP.
    - §5 Cappello: add the skew prior λ ~ N(0.5, 0.1²), the RMSPE totals and the "drivers manage degradation" explanation of linear decay.

### Consequences for the spike's proposals

| # | Verdict | Why |
|---|---|---|
| 1 ranking | **sharpen** | tie set relative to the E[pos] leader (not pairwise, which is non-transitive); tie means `Δ < max(δ, z·SE)` with δ = 0.05, and the spec says which reading; "unresolved at the cap" shown as such; same rule for E[points]; mean time last (agree) |
| 2 CRN | agree | standard; also enables exact merging of identical policies (§5 f) |
| 3 cap | **sharpen** | under 5 s: 4,600–5,500 evaluations; n0 30–50 for 25–30 candidates; Bonferroni-level z (2.7–2.9) for elimination; good-selection test at the largest candidate count |
| 4 re-score | sharpen | re-score the shown top few together on paired fresh scenarios, or show gaps with intervals against the best; count the 0.5 s in the cap |
| 5 step mode | no evidence | the papers model no braking zones |
| 6 DP budget | no evidence | — |
| 7 SC trigger | no evidence | no paper models SC (Fieni 2026 lists it as future work) |
| 8 rule candidates | agree, add | merge by identical outcomes under CRN automatically |
| 9 ablation | agree | blocking matters (Wüthrich 6.87 s); dirty air stays 0 (ETH terms are simulated or heuristic; Joshi weak) |
| 10 S24 | no evidence | — |
| 11 neighbours | **agree, supported** | Fieni 2026 (stop-lap shifts as the reply to a rival), Wüthrich (local minima in the pit choice) |
| 12 pass chance first | agree | no paper has a pass hazard to borrow; F1 25 calibration only |
| 13 plain forecast at ln 2 | no evidence | — |
| 14 pace uncertainty | **sharpen** | draw the degradation slope too (Cappello: slope 95 % width 0.11–0.13 s per lap after a full stint); may change stop-lap choices, not only the spread; re-test |

## Part D: Aguad & Thraves' supplement and Carrasco Heine & Thraves 2023


Reader D, 2026-11-11. Adds to research 14 (Part B read only Aguad's main text and the CEJOR abstract) and research 11 §2–§3; nothing here repeats them.

**Labels:** 🟢 stated by the source · 🟡 read off a figure (about ±10 %) · 🔵 my inference.

### Sources and how they were read

| Source | How | Notes |
|---|---|---|
| Aguad & Thraves 2024, EJOR, supplementary material (`external/1-s2.0-S0377221724005484-mmc1.pdf`, 15 pp., Appendices A–P) | full, `pdftotext -layout` | A (SC/VSC rates), C (notation), G (minimum gap), J (instance values), K (other instances), L (parameter sources), M (state counts), N–P (example races, start-tyre equilibrium) |
| Carrasco Heine & Thraves 2023, CEJOR 31:239–268 (`external/s10100-022-00806-4.pdf`, 30 pp.) | full, `pdftotext -layout`; Fig. 5 viewed as an image | Code: github.com/FCarrascoHeine/F1DP (fn. 12, not read) |

Appendix A's table is in `aguad-appendix-a.csv` next to this file. It holds every row exactly as printed, plus one column I added: the F1 25 track id (`packages/domain/src/tracks.ts`), left empty for circuits that are not in F1 25. A check script confirmed that every fraction equals a whole number of races divided by the printed race count, to ±0.005.

### 0. The SC/VSC rates per circuit (Appendix A), against the spike and the plan

**What Table A.1 is** 🟢 (supp. p. 1):
- "the proportion of races that have had a VSC and SC", with the number of races in parentheses.
- VSC from races 2015–2023, SC from races 2000–2023, "based on data availability".
- Data: Trotman (2024), "Kaggle: Formula 1 Race Events", accessed January 2024.
- 25 circuits, plus a total row: VSC 0.30 (185 races), SC 0.47 (455 races), ratio 0.41.
- "there is heterogeneity among circuits in their probabilities of experiencing VSC and SC".

| F1 25 id | Circuit | VSC (n) | SC (n) |
|---|---|---|---|
| 0 | Albert Park | 0.29 (7) | 0.68 (22) |
| 17 | Red Bull Ring | 0.33 (9) | 0.64 (14) |
| 20 | Baku | 0.33 (6) | 0.57 (7) |
| 3 | Bahrain | 0.22 (9) | 0.37 (19) |
| 10 | Spa | 0.11 (9) | 0.64 (22) |
| 16 | Interlagos | 0.17 (6) | 0.52 (21) |
| 6 | Montreal | 0.29 (7) | 0.57 (21) |
| 2 | Shanghai | 0.00 (5) | 0.44 (16) |
| — | Paul Ricard | 0.75 (4) | 0.50 (4) |
| — | Hockenheim | 0.33 (3) | 0.36 (14) |
| 9 | Hungaroring | 0.33 (9) | 0.25 (24) |
| 27 | Imola | 0.00 (3) | 0.40 (10) |
| 11 | Monza | 0.22 (9) | 0.38 (24) |
| 13 | Suzuka | 0.43 (7) | 0.50 (20) |
| — | Sepang | 0.33 (3) | 0.28 (18) |
| 19 | Mexico | 0.50 (8) | 0.50 (8) |
| 5 | Monaco | 0.50 (8) | 0.61 (23) |
| 26 | Zandvoort | 0.67 (3) | 0.67 (3) |
| — | Sochi | 0.14 (7) | 0.62 (8) |
| 29 | Jeddah | 0.67 (3) | 1.00 (3) |
| 12 | Marina Bay | 0.43 (7) | 0.93 (14) |
| 4 | Catalunya | 0.22 (9) | 0.21 (24) |
| 14 | Yas Marina | 0.11 (9) | 0.33 (15) |
| 7 | Silverstone | 0.33 (9) | 0.62 (24) |
| 15 | COTA | 0.38 (8) | 0.36 (11) |

**Oddities in the table** 🔵:
- The per-circuit counts add up to 167 VSC races and 389 SC races, against the totals of 185 and 455. The total row therefore includes circuits that are not listed (for example Portimão, Istanbul, Qatar, Miami, Las Vegas, Korea, India).
- The printed total ratio of 0.41 does not equal 0.30 / 0.47 = 0.64. The per-row ratios are consistent (for example 0.29 / 0.68 = 0.43, printed 0.4), so the 0.41 is probably a typo or a different quantity.
- The race-weighted mean over the listed circuits is VSC 0.305 and SC 0.488, close to the totals.

**Missing F1 25 tracks** 🔵:
- Miami (30), Las Vegas (31) and Losail (32) have no row.
- The reverse layouts (39–41) have no real-F1 data at all.
- Thin rows: Zandvoort, Jeddah and Imola (VSC) rest on 3 races, Shanghai on 5 for VSC. Shanghai's and Imola's VSC 0.00 is "none in 5 or 3 races", not an impossible event.

**Against the spike's assumptions** (research 13 §1: 0.5 SC per race, 3–5 laps; 0.3 VSC per race, 1–3 laps):
- 🔵 Table A.1 gives P(at least one) per race, not a count per race. Read as Poisson, P(≥1 SC) = 0.47 means a mean of −ln 0.53 = **0.63 SC per race**, and P(≥1 VSC) = 0.30 means **0.36 VSC per race**.
- TUM's count distribution (research 11 §2) has P(≥1) = 0.545 and a mean of 0.71.
- The spike's 0.5 SC per race corresponds to P(≥1) = 0.39 under Poisson. So the spike is **somewhat low**: by about 20 % on the SC mean against Aguad and 30 % against TUM, and by about 15 % on VSC.
- That gap is small next to the spread across tracks. Real P(≥1 SC) runs from 0.21 (Catalunya) and 0.25 (Hungaroring) to 0.93 (Marina Bay) and 1.00 (Jeddah, n = 3), a factor of 4–5. For VSC it runs from 0.00–0.11 to 0.67–0.75.
- Per-track rates are therefore worth more than a better global mean.
- The spike's "30 % of SCs from lap 1" matches TUM's 36 %. Neither Aguad nor CEJOR has a lap-1 bump: both use a constant per-lap q.

**Aguad's own instance does not use its table** 🟢:
- The instance sets r_SC = r_VSC = 0.3 ("set to 30 %. As shown in Appendix A, there are circuits where the frequency has been lower, while others have seen higher", L p. 14). That is below the table's own SC total of 0.47.
- Lengths are fixed: VSC 2 laps and SC 3 laps, "as the latter usually involves more track clearing" (L).
- 🔵 These are illustrative values, not a calibration.

**Does this fit the plan: rates per track in the track file, calibrated through a calibration set (C62a, spec §6.2, O6)?**
1. **As a track-file default with its source: yes** 🔵. Each row gives value, n and window, and fills `TrackDefault { value, source }`, for example source `"Aguad & Thraves 2024 suppl. Table A.1 (Trotman 2024 Kaggle), SC races 2000–2023, n = 24"`.
   - The race count should also be a number, not only text: a calibration aggregate that shrinks toward the real rate needs it (a Beta prior with n pseudo-races).
   - That is a change to the track-file type in `domain` (C78, supervisor), not a contract change: C62b only requires "each default with its source".
2. **What `race-hazard` has to add** 🔵. The table gives P(≥1) only: no counts, start laps or durations. `race-hazard` needs TUM's shape (multiplicity 0–3, start bins with the lap-1 bump, duration distributions; research 11 §2) to turn a per-track P(≥1) into a per-lap hazard.
   - Both papers' formula, q = 1 − (1 − r)^(1/N), spreads the hazard evenly and ignores a second SC.
3. **Era bias** 🔵. The SC window (2000–2023) is mostly before the VSC existed (2015). Some incidents that became VSCs from 2015 were SCs before, so a modern SC rate may be lower than the table's.
   - Recomputing SC over 2015–2025 only, from the same Kaggle dataset or from timing data, would also fill Miami, Las Vegas and Losail. That is a job for `pitwall-trackdata`, outside pitwall (memory rule).
4. **Real F1 is not F1 25** 🔵. The game's neutralisations come from its AI and human incidents and the lobby's safety-car setting (`m_safetyCar`: 0 Off, 1 Reduced, 2 Standard, 3 Increased, Session packet). League races are also 10–20 laps, not full distance.
   - Research 12's six races: an SC in 3 of them (Zandvoort 14 laps, Miami 20, Texas 20), a VSC in 2 (Mexico 70, Miami). That is about 178 race laps.
   - Real P(≥1 SC) per race would predict about 2.8 SC races if the game scales incidents to race length, and about 1.9 SCs if it keeps real per-lap rates. Three events cannot tell these apart.
   - Before any formula is chosen, the 4.3b spec has to answer whether rates convert per race or per lap. It needs more recordings, and the lobby setting of each.
5. **Calibration through C62a: workable, with three details for the 4.3b spec** 🔵.
   - **Dedupe by session.** A set's sources are stints, but an SC is a property of a race session. The aggregate counts each race session behind the set's stints once, from the session-phase spans in its stored projection (C62a: "pure functions over a set's sources (read from their stored projections)"). It counts only race sessions and only those with a known lobby setting. The setting is a value, not a C12 signal, so it is readable.
   - **The real prior dominates for years.** At about one race per track per season the calibration adds 1–3 observations against the real prior's 3–24. A set mainly confirms or overrides the default; an override already exists (C62a).
   - **Possible contract gap.** The quantity worth learning from the game is probably one factor for the whole game (F1 25 against real F1, per lobby setting), not a per-track rate. A calibration set belongs to one track (C62a), and C62a has no priors entry pooled across tracks.
   - **Ways around it within the contract:** make that factor a `race-hazard` config value (C47), fixed for a run, next to the lobby-setting factors the spec already has (spec §4, `race-hazard`); or accept per-track learning only. If the 4.3b spec wants the factor learned from data across tracks, that is a contract gap against C62a (C0).

### 1. Overtaking and blocking

- 🟢 **Appendix G: what the minimum gap Δ does** (supp. pp. 7–8). "Circuits usually have sections where cars are almost enforced to follow a race line". Cars must keep "a minimum time difference of Δ > 0 after the pit stop exit". Two changes:
  - (i) The interaction term is evaluated at a gap of at least Δ: `exp(−λ·|min{−Δ, ε′}|)·Z(1)` if ε′ < 0, otherwise `exp(−λ·|max{Δ, ε′}|)·Z(2)` (G.1). Very close cars therefore pay the interaction for a gap of Δ, not for zero.
  - (ii) The trailing car's lap time gains `+ max{Δ − ε, 0}` (A when ε > 0, B when ε ≤ 0). The car behind is pushed back to Δ behind at the pit-exit point.
  - Under VSC and SC the lap time is unchanged (G.2). Δ = 0.4 s (J.1).
  - 🔵 This is the same rule as TUM's rejoin rule (the car just behind is pushed back to 0.5 s; research 14 §2, "Checks"). Two independent models hold the follower 0.4–0.5 s back at one point of the lap. 4.3a can check it on F1 25.
- 🟢 **Appendix L: no source for Z1, Z2, T_DRS** (supp. p. 14). L says "most parameters are not specifically based on any particular circuit … rough estimates to match their order of magnitude", and "the exponent coefficient … λ is considered arbitrarily as a positive number (we use λ = 2)". L says **nothing** about the values of Z1, Z2 or T_DRS, and neither does J.1. 🔵 The blocking and DRS numbers quoted in research 14 B §1–§2 have no source at all.
- 🟢 L gives sources for the other values:
  - 52 laps "the same as the Silverstone Circuit"; laps "around 95 seconds".
  - Tyre life 30 / 40 / 50 laps as an "upper bound".
  - Pit loss "around 20 seconds", "around 10" under VSC or SC.
  - Grid gap g0 = 0.4 s, since adjacent cars "typically cross the finish line with a time gap of less than half a second".
  - Small inconsistency: J.1 prints d0 = 97.2 s for both cars, while L and the main text give 97.22 / 97.24.
- **CEJOR:** not covered. One car; "we have decided to neglect these from the model for tractability reasons", which omits "overtaking and blocking" (pp. 241–242, 262).

### 2. DRS and DRS trains

- 🟢 Aguad, supplement:
  - T_DRS is a random variable in the SDP and a fixed parameter in the deterministic DP (Table C.2, C.1). No source (above).
  - L: "The DRS is usually enabled a couple of laps after a VSC/SC incident and three laps after the start of the race" (k_VSC = k_SC = 2).
  - The circuit sketch (Fig. D.1) has one DRS zone, on the straight before the pit stop. Nothing on trains.
- **CEJOR:** not covered.

### 3. Pitting into traffic and clear air

- 🟢 **Aguad Appendix K** (supp. pp. 12–13): when one driver ignores the competition and the other does not, "the latter increases their winning odds in 10 − 20 % of the scenarios", over all three other instances.
  - The instances: B starts ahead (g = 0.4); equal pit loss (20 s); both together.
  - Table K.1: A alone strategic 67.18 % against both strategic 57.52 %. K.2: 87.22 against 70.33 %. K.3: 78.23 against 64.47 %.
  - 🔵 The +18 pp of the main text (research 14 B §3) is typical of this family of near-tie instances, not an outlier. It is still a two-car near-tie value.
- 🟢 **Rejoin at pit exit:** Appendix G is the only rejoin mechanism (§1 above). No search over neighbouring stop laps; the DP is exact over its grid.
- 🟢 **CEJOR:** no traffic, no rivals. The yellow-flag sweeps (Fig. 3, Fig. 4: one 2-lap yellow at each lap) show what happens to the stop:
  - The best stop moves in jumps with the yellow's timing. A yellow on laps 7–19 makes the soft-start plan pit under it and add a stop later; on laps 20–26 it switches to hards to the end; before lap 20 or after 33 the soft start wins (p. 253).
  - Race times between starting compounds differ by about 1–3 s. Example: a yellow on laps 6–7 gives 4630, 4633 and 4632 s (p. 253); without a yellow, medium +2.5 s and hard +1.5 s (p. 249).
  - 🔵 Distinct plans sit within a few seconds of each other even in a noise-free model, so near-ties are normal (proposal 1).

### 4. Pace and pace uncertainty

- 🟢 **CEJOR's lap time** (eq. 10): `μ0 + p0·1{stop} + α_t + β(w) + g·f`.
  - β(w) is a cubic spline through chosen points, flat early and steep late ("falling off the cliff"; Appendix B, Fig. 6: +1.2 s at 70 % wear).
  - Wear per lap is `d_t·(1+δ)^(f/F)`: it grows with fuel (eq. 9).
  - Instance: μ0 = 85 s, p0 = 21 s, g = 0.03 s/kg; fuel use 1.92 / 1.87 / 1.83 kg per lap (S/M/H); d = 1/25, 1/40, 1/65 per lap; α = 0, 0.6, 0.9 s (p. 248).
  - Starting fuel is a decision (eq. 8).
- 🟢 **Under yellow** (CEJOR): no tyre wear, 0.5 kg/lap fuel, pit loss 10 s (fn. 13, which labels it μ1 by mistake; p1 is meant).
- 🟢 **No noise at all.** No lap-time noise and no parameter uncertainty. The only random inputs are yellow flags and, in the formulation only, weather as a lap-dependent Markov chain P(n), "updated at each lap as new weather forecast information is revealed" (p. 255).
  - The yellow-flag chance may depend on weather and lap (q_{l,r}(n): "more likely to occur during rainy weather"; higher in the first laps, p. 256).
  - 🔵 **No rain case is computed.** Every result is dry with yellows; the abstract's "rainy weather" is formulation only.
- 🟢 **Nothing fitted.** No parameter is fitted to data and there is no validation against real races in either paper (CEJOR §2.2, §3.1; Aguad L).
- **Aguad:** as in research 14 B §4.

### 5. Ranking strategies under noise

- 🟢 **CEJOR's comparison** (p. 259, Table 1): DP and SDP are evaluated "on 1000 sampled scenarios of yellow flag occurrences", generated with the SDP's probabilities.
  - The DP is CEJOR's Algorithm 1: the deterministic DP, **re-solved from the current lap whenever a yellow appears**, with its length known.
  - Table 1 (yellow chance 70 %) reports mean, sd, min and max of the paired race-time difference, the win, loss and even counts, and conditional means.
  - 🔵 Win, loss and even counts per scenario mean both policies ran on the same scenarios: common random numbers in effect. No confidence interval is given.
- 🟢 **The mean and the win count disagree.** With 2+ yellows from a soft start, the SDP has the lower mean (−0.22 s at 2 yellows, −1.05 s at 3) but wins fewer scenarios than the DP (27 against 57 at 2; 16 against 18 at 3). With one yellow the DP wins more (72 against 22) at about the same mean (+0.01 s). With no yellow on a hard start the DP is better by exactly 0.18 s in all 314 scenarios.
  - 🔵 "Mean better" and "more often better" pick different policies: the gain comes from rare large wins (min −11 to −16 s) against frequent small losses (about +0.25–0.9 s). This supports proposal 1's mean-first key and argues against P(better) as the main key.
- 🟢 **Aguad K:** the gamble effect holds in every other instance. Final-gap sd is 1.95–2.08 s under the gap objective against 4.81–5.08 s under the win objective (Tables K.1–K.3).
- 🟢 **Runtimes and state counts:**
  - CEJOR (Appendix G, Table 2; Julia 1.7.2, 6 CPUs of an M1 Pro): DP 120.72 s on average (sd 5.94, 53 runs), 2,107,242 states per stage on average. SDP 635.58 s (sd 12.67, 10 runs), 9,109,140 states per stage. Grid: wear 1/1995, fuel 0.0505 kg.
  - Aguad (Table M.1): 9 states at lap 1, 113,464,800 at lap 15, 889,564,032 at lap 52. **20,478,351,241 states in all, 5 h 34′ 23″.** 1,046 s for lap 52 alone. The main text says 15 CPUs.
  - 🔵 Both are orders of magnitude above the spike's 300 ms per car. The spike's DP is affordable only through its coarse state, not through the papers' formulations; the papers do not show that a fine wear grid matters.

### 6. Driver differences

- **CEJOR:** not covered (one car).
- 🟢 **Aguad:** only d0 and pit loss differ. L: "rough estimates"; J.1 even prints equal d0 values. Nothing on consistency, AI or humans.

### 7. What sharpens or contradicts the spike

1. **The stochastic DP gains little at real rates** 🟡 (CEJOR Fig. 5, 1,000 scenarios per point, one car, VSC only, race time).
   - The SDP's expected gain over the re-solve-on-yellow DP is about 0.00–0.03 s per race for P(yellow) 0.1–0.5, about 0.05–0.1 s at 0.6–0.7, 0.15–0.2 s at 0.8, 0.35–0.45 s at 0.9, and 0.65 s (soft, hard) to 1.05 s (medium) at 0.95.
   - 🔵 Real tracks: P(SC or VSC) ≈ 1 − (1 − 0.47)(1 − 0.30) ≈ 0.63 overall, assuming independence; about 0.45 at Catalunya and about 0.96 at Marina Bay.
   - So the planned stretch before a likely yellow (research 11 §3) is worth about 0.1 s per race at an average track and about 0.5–1 s at the street circuits, for a single car's race time.
   - 🔵 **Caveat:** CEJOR's yellow is a VSC (gaps kept, p. 241 fn. 5). The SC's bunching of the field, which changes positions, is not in it. The spike's DP already has SC and VSC states (research 13 §1, the brute-force checks), so this bounds only part of their value.
2. **The deterministic DP, re-solved when a yellow appears, is CEJOR's baseline** 🟢 (Algorithm 1). That is proposal 7's shape: a reaction to the SC, from the current state. It loses almost nothing at P(yellow) ≤ 0.5.
3. **The 0.28 s DRS agreement carries no weight.** Appendix L gives no source for T_DRS, Z1 or Z2 (§1 above). Research 14 B's "agreement between two guesses" is really agreement with an unsourced number.
4. **Rejoin push-back** 🟢 (Aguad G, Δ = 0.4 s): independent support for TUM's 0.5 s rule as a candidate for the 4.3a check.
5. **Pit loss under yellow about 0.5 × green** 🟢: both papers assume it (Aguad L: 20 s against 10 s; CEJOR: 21 s against 10 s). It matches research 12's SC measurement (about 0.5 × green). Both values are assumed, not measured.
6. **No wear under yellow** 🟢 in both papers, against TUM's ×0.25 (SC) and ×0.5 (VSC). 🔵 A modelling choice to check against F1 25 laps under SC (research 12 has some).
7. **Fixed yellow lengths** 🟢: Aguad VSC 2 and SC 3 laps; CEJOR 2 laps. The spike's ranges and TUM's distributions are the better shape.

### Consequences for the spike's proposals (research 13 §8, §10; numbering as research 14 §2)

| # | Proposal | Verdict | From this reread |
|---|---|---|---|
| 1 | Ranking by E[pos], paired tie | **agree** | The mean and the win count rank DP and SDP differently (CEJOR Table 1). The win objective gambles in every Aguad instance (K.1–K.3: sd about 2 against about 5 s). Near-ties between distinct plans are normal even without noise (CEJOR: 1–3 s between starting compounds) |
| 2 | Common random numbers | agree | CEJOR compares on the same 1,000 scenarios (paired counts), without CIs |
| 3 | Time cap 5 s | no evidence | The papers' solve times (121 s to 5.6 h) are offline and say nothing about a cap |
| 4 | Re-score the winner | no evidence | — |
| 5 | Braking-zone steps | no evidence | Both papers split the lap at pit exit only |
| 6 | DP 300 ms per car | agree | The papers' state counts (2.1–9.1 M per stage; 20.5 bn in all for two cars) show the price of fine grids; nothing shows the coarse grid loses decisions |
| 7 | SC trigger per remaining stop | **agree, sharpen** | It is CEJOR's DP baseline; the full SDP adds about 0.1 s per race at an average track and 0.5–1 s at Marina Bay or Jeddah (Fig. 5, VSC only). Keep the DP's SC states but expect value mainly at high-rate tracks; an ablation per track rate band is enough |
| 8 | Dedupe candidates | no evidence | — |
| 9 | Blocking, relative DRS; dirty air 0 | agree, sharpen | Aguad's Z1, Z2 and T_DRS have no source (L). The rejoin push-back (G, Δ 0.4 s) is a second model with TUM's 0.5 s rule: add it to 4.3a's checks |
| 10 | S24 | no evidence | — |
| 11 | Stop-lap neighbours | agree | CEJOR's best stop jumps with the yellow's timing (Fig. 3, 4), so a single optimum is fragile |
| 12 | Calibrate the pass chance | no evidence | Neither paper fits anything |
| 13 | Plain forecast at the median | no evidence | — |
| 14 | Pace uncertainty | no evidence | Neither paper draws pace (no lap noise either) |
| 15 | Rivals' reaction ablation | **agree** | Aguad K: +10–20 pp of win rate for the strategic driver over a non-reacting one, in all instances |
| new | SC/VSC rates per track | **adopt Appendix A as the first source** | Shape from TUM; store the race count as a number; recompute 2015–2025 for SC and the three missing tracks in `pitwall-trackdata`; settle whether rates convert per race or per lap on F1 25 recordings; the spike's 0.5 SC per race is about 20–30 % low, the track spread (×4–5) matters more |
| new | Calibration of the rates via C62a | **fits, with care** | Dedupe by race session, only race sessions with a known lobby setting; a game-wide F1 25 factor pooled across tracks does not fit a one-track set (C62a). Make it a `race-hazard` config value (C47), or report it as a contract gap in the 4.3b spec |
