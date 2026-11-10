# Strategy model: the reread before 4.3

Research done on 2026-11-10, at the start of the 4.3 brainstorm (strategy model). Every paper behind [03](03-strategy-models.md) and [07](07-strategy-literature.md) was read again in full, with questions from the 4.3 design: Monte Carlo run counts and convergence, how random events and rivals are drawn, driver noise and mistakes, DP formulations, dirty air and overtaking, and validation on noisy data. Where this file and 03 or 07 disagree, this file is right; §7 lists every correction.

**Labels:** 🟢 stated by the source · 🟡 read off a figure (about ±10 %) · 🔵 pitwall's own inference.

**Read:**

| Source | How | Notes |
|---|---|---|
| Heilmeier et al., Monte Carlo race simulation, Appl. Sci. 2020, 10, 4229 | full text (`external/applsci-10-04229-v3.pdf`) | |
| TUMFTM/race-simulation code | `main_racesim.py`, `_race_montecarlo.py`, `race.py`, `mcs_analysis.py`, `vse.py`, `vse_supervised.py`, `pars_mcs.ini` | |
| Heilmeier, dissertation, TUM 2022 | race simulation, Monte Carlo, validation, VSE, RL, case study chapters ([mediatum](https://mediatum.ub.tum.de/doc/1647512/1647512.pdf)) | cumulative: the papers are bound in; page numbers are the dissertation's |
| Heilmeier et al., Virtual Strategy Engineer, Appl. Sci. 2020, 10, 7805 | only through the dissertation and the code | MDPI blocks fetching |
| Aguad & Thraves, EJOR 319(3), 2024 | full text (`external/1-s2.0-S0377221724005484-main.pdf`) | appendices A–P are online supplementary material, **not read** (Appendix A holds the SC/VSC rates per circuit) |
| Carrasco Heine & Thraves, CEJOR 31(1), 2023 | abstract only | full text unreachable (SSRN 3769652, Springer) |
| Fieni et al. 2025 (arXiv 2512.21570), Fieni et al. 2026 (arXiv 2602.23056) | full text and figures | |
| Wüthrich et al. 2026 (arXiv 2604.00826), Joshi 2026 (arXiv 2608.03192) | skimmed | |
| Bonomi, Turri & Iacca, GECCO '23 | full text (`external/3583133.3596349.pdf`) and its repository | |
| Cappello & Hoegh 2025 (arXiv 2512.00640) | full text | |
| Tulabandhula & Rudin 2014 | full text (`external/tulabandhula-…pdf`) | |
| Simulation methodology: Law, *Simulation Modeling and Analysis* (5th ed., 2015, ch. 11); Nelson & Matejcik, *Mgmt Sci* 41 (1995); Chen et al., *DEDS* 10 (2000) (OCBA); Kim & Nelson, *ACM TOMACS* 11 (2001) | cited from standard knowledge, not re-fetched | |

## 1. Monte Carlo: how many races

- 🟢 TUM uses **10,000 races per evaluation** everywhere: the MC paper, the VSE paper, the RL comparison, the case study. Aguad & Thraves also score their policies over 10,000 races.
- 🟢 The only convergence data in the whole literature is TUM's Table 8 (MC paper p. 17): Hamilton's mean finishing position in one race, spread across 20 batches (95 %).

  | Races per batch | Mean position | ±95 % |
  |---|---|---|
  | 100 | 2.115 | 0.309 |
  | 1,000 | 2.126 | 0.082 |
  | 10,000 | 2.107 | 0.029 |
  | 100,000 | 2.107 | 0.011 |

  "Similar for all drivers"; 10,000 is "a good compromise". 🔵 It falls as 1/√N, which implies a spread of about 1.5 positions per race.
- 🟢 Nobody studied whether the **ranking of strategies** or the position distribution converges with the run count. TUM's Fig. 11 compares two strategies by eye.
- 🟢 TUM uses no variance reduction. Latin hypercube sampling is named as future work. The code sets no seeds (not reproducible), and races it calls invalid are silently drawn again, which conditions the sample.
- 🔵 **Common random numbers (CRN):** every candidate plan runs through the same random races (the same SC timing, failures, scatter and mistakes), and plans are compared by their paired differences. The variance of a difference is σ²(2 − 2ρ). With a correlation ρ of 0.8–0.9, which is plausible since most randomness is shared, that needs 5–10 times fewer races. Example: separating two plans 0.1 position apart at 95 % with σ = 1.5 takes about 1,700 independent races per plan, or about 350 with CRN at ρ = 0.8.
- 🔵 **CRN needs synchronised streams.** Each random draw is keyed by (scenario, car, lap, purpose), not taken from one sequential generator. Otherwise a plan with one more stop shifts every later draw and the correlation is lost.
- 🔵 **Adaptive run counts.** Ranking-and-selection methods spend races where they decide something. OCBA starts each plan with 50–100 races and gives further races to the close contenders. Kim–Nelson eliminates plans until the best one beats the rest by an indifference zone δ with probability P*. Both work with CRN. With about 10 plans they are reported to save 3–10 times over equal allocation. Then the budget is a time cap, not a fixed count.
- 🔵 **Pitfalls:**
  - Picking the best of ten noisy means is optimistic (the winner's curse): re-score the winner on fresh seeds before showing it.
  - Tail figures such as P(win) converge more slowly than means.
  - Finishing-position distributions are multimodal, driven by the SC count (TUM Fig. 12), so a mean alone misleads: report quantiles and P(gain).
- 🟢 **Model error dominates.** "The results depend strongly on a correct parameterization" (MC paper p. 17); parameterisation is "the most critical point" of the dissertation (p. 169), about 200 parameters for a 20-car race. 🔵 A lap-time error of 1 s per lap outweighs the Monte Carlo noise by orders of magnitude.

**Runtime** 🟢: TUM's Python takes 90–110 ms per race with 20 cars (i7-6820HQ), about 30 ms with 6 cars; 10,000 races take 250–300 s on 4 cores, scaling almost linearly. With the neural-network VSE deciding, about 200 ms per race. TUM's quadratic stint optimiser needs about 150 ms for 22 compound sets (15 ms in the case study), against about 20 s by brute force.

## 2. Random events: how TUM draws them

All from the MC paper's Appendix A and `pars_mcs.ini` 🟢. Real F1 2014–2019; usable as the shape of pitwall's draws, not as F1 25 values.

| Event | Draw |
|---|---|
| SC count per race | P(0 / 1 / 2 / 3) = 0.455 / 0.413 / 0.099 / 0.033; at most 3 |
| SC start | six bins by race progress: lap 1 0.364, to 20 % 0.136, 20–40 % 0.136, 40–60 % 0.080, 60–80 % 0.193, 80–100 % 0.091; spread evenly within a bin plus U(0, 1) within the lap. A "lap 1" SC begins at the end of lap 1. Note the late bump at 60–80 % |
| SC duration | 2–8 laps, P = 0.182, 0.250, 0.227, 0.193, 0.057, 0.068, 0.023; it ends at a lap end |
| Cause of an SC | exactly one accident; that driver is drawn weighted by `p_accident` and retires at the SC start |
| Failure | each remaining driver fails with the team's `p_failure` at U(0, laps); a failure brings a VSC with P = 0.227 |
| VSC duration | 1–4 laps, P = 0.479, 0.396, 0.021, 0.104, plus U(0, 1) |
| Overlap | phases keep a minimum distance, redrawn on overlap |
| Timing | all events drawn before the race, at a race time (not a lap); progress converted to time by a one-driver pre-simulation |
| Accident probability | Beta-Bernoulli posterior per driver and season: 4.5–7.2 % per race (2019) |
| Failure probability | per team and season: 4.1 % (Mercedes) to 11.7 % (McLaren) (2019) |
| Lap scatter | N(0, σ²) per driver and lap, σ 0.458–0.841 s, unknown driver 0.625 s; σ from residuals of a quadratic per stint |
| Start performance | N(µ, σ²) per driver added to lap 1: µ −0.097 to +0.102 s, σ 0.098–0.245 s, unknown N(0, 0.146²); reference `t = √(2 · (p_grid − 0.8) · 8 m / a) + 0.2 s`, a = 11.2 m/s² |
| Pit stop | Fisk (log-logistic) per team, fitted only on stops at most 4 s over the race minimum (the slow tail is cut off) |
| Damage | not modelled |

**Neutralised laps** 🟢: VSC lap 1.4 × base, SC "ghost car" 1.6 × base (first ghost lap slower); wear and fuel at ×0.5 under VSC and ×0.25 under SC (the authors call these estimates); no overtaking when at least 50 % of a lap is under VSC; DRS off for 2 laps after an SC; the SC leaves only at a lap end; fuel saved under yellow is spent again by the finish; the cheaper pit loss applies only when pit entry or exit is fully covered by the phase.

**Known flaws** 🟢: one driver per accident; lapped cars cannot unlap behind the SC; the SC starts at a race time rather than in front of the leader; at most 3 SCs; the SC is drawn first and its accident second; retired drivers count at the back of the position histogram, which distorts its tail.

**Validation of the draws** 🟢: simulated against real frequencies of 0–3 SC phases agree within 0.008; VSC is off by up to 0.027, since VSCs hang on failures; the CDF of SC starts matches the data.

**Aguad & Thraves' yellow flags** 🟢 (§4.1): a VSC or SC starts at a lap end with a per-lap probability q, only while no flag is active; fixed lengths (VSC 2 laps, SC 3 in their instance). From a per-race probability r: `q = 1 − (1 − r)^(1/N)` (the paper prints it inverted, a typo); r = 0.3 over 52 laps gives q ≈ 0.0068. Tyres do not wear under yellow. Under SC the gap collapses to ±0.5 s and the order changes only through stops; under VSC every car runs a fixed lap time and nobody passes on track. Their instance: r_VSC = r_SC = 0.3, VSC lap 170 s, SC lap 200 s, pit loss 10 s under either (20 s green). The overall rates (about 30 % of races with a VSC, 47 % with an SC) are in footnote 1; the **rates per circuit are in their online Appendix A, not yet read**.

## 3. Strategies inside the Monte Carlo: fixed or reacting

- 🟢 TUM's MC paper fixes every driver's strategy on purpose: it measures a plan's robustness "because it is fixed". The VSE paper names this as a limitation (no use of FCY chances, the user guesses rivals' plans). The code can let each driver decide per lap by a policy (`vse_type`: base strategy, real strategy, supervised, reinforcement) inside the Monte Carlo.
- 🟢 **Reaction is worth as much as the run count** (dissertation, Tables 18/19, 4.2, 4.8):
  - Austria 2019, Hamilton's mean position without FCY: real strategy 3.4, optimised 3.1, VSE 2.9. With random FCY: real 3.5, optimised 3.4 (its advantage "disappears"), VSE 2.7.
  - China 2019: Leclerc's mean position moves from 3.4 to 3.9 depending only on which strategy source drives the rivals.
  - RL agent vs optimiser vs supervised VSE (10,000 races): Belgium 8.9 / 9.3 / 9.5; Singapore 8.2 / 8.9 / 9.5; China 8.2 / 8.2 / 9.5. The RL agent's advantage shows "only when FCY phases are considered".
- 🟢 **VSE inputs** (code): pit decision: tyre age against race progress, race progress, position, compound relative to the others, FCY status (0–4: VSC or SC, started this lap or earlier, counted if active for at least 5 % of the lap), remaining tyre changes, "pursuer just pitted", location category, a car close ahead. Compound choice: race progress, location, relative compound, remaining changes, two compounds used, dry compounds available. Hard rules: stop if p > 0.5, forced stop after 90 % of the race without two compounds, at most 3 stops. Its SC response is learned from real decisions, not from a cost comparison.
- 🟢 **Aguad & Thraves score DP policies by simulation:** 10,000 scenarios with a 95 % CI; the DP's own win value 67.16 % against simulated 66.53 % [65.61, 67.45]. A precedent for "DP proposes, Monte Carlo scores".
- 🟢 **Carrasco Heine & Thraves** (abstract): the stochastic DP beats the plain DP, more so where yellows are frequent, and "tends to delay pit stops" to use a possible yellow. 🔵 A deterministic DP plus an SC reaction rule captures the *reaction* to an SC but not the planned *stretch* before a likely one. Making the DP's cost-to-go an expectation over yellows closes that; for one car it adds only a few states (SC laps left, VSC laps left).
- 🟢 **Re-planning pays** (Fieni 2025): after a tyre-wear jump on lap 22, re-solving keeps the optimum; the RL policy loses 5.08 s; a fixed go-long plan loses 31.45 s.
- 🟢 **Pre-race, in-race, post-race split** (dissertation Table 4.6): before the race the optimiser builds basic plans, with pit windows from ±15 % degradation; during the race the optimiser is re-run when degradation deviates, a policy decides on FCY, and the simulation predicts from the current state; after the race the parameters are re-fitted.

## 4. The optimiser

- 🟢 **Aguad & Thraves' DP:** stages are laps; per car the actions are stay out, soft, medium, hard; no stop on lap 1 or on the last lap. The state is per car the compound, tyre use in laps (capped at life + 1 = "cannot continue") and "two compounds used", plus the gap on a ±35 s grid in 0.04 s steps (1,751 values); the stochastic version adds VSC laps left, SC laps left and laps until DRS. Objectives: the final gap (zero-sum; ±∞ for breaking the compound rule or tyre life) or the win probability. The start compound is a mixed strategy, solved as an LP. Two cars give "hundreds of millions of states" per lap past lap 15, solved in "a few hours" on 15 CPUs in parallel C.
- 🟢 **Findings:** against a rival who ignores the interaction, a strategic driver wins 84 % instead of 66 % (+18 percentage points). Win probability as objective is riskier than the gap (final-gap sd 5.17 s against 2.00 s; B stretches a soft stint "waiting for a yellow" and loses by 30 s instead of 2.9 s). More yellows help the weaker car. Start compounds: A soft/medium 0.41/0.59, B 0.60/0.40; hard dominated.
- 🟢 **Fieni 2025 / Wüthrich 2026:** the MINLP (CasADi + BONMIN) takes 55–68 s, 50 s to 5 min overall; Wüthrich's reformulation about 3 s. RL is 4.96 s off the optimum (0.09 %), RL plus MPC 0.035 s off at a horizon of 40 laps (69 ms per step). **In every case the error is in energy allocation, never in the pit choice.** 🔵 So the DP plans stops and compounds only; ERS and fuel stay per-lap targets.
- 🟢 **Bonomi's genetic algorithm:** population 250, 1,000 generations, 30 runs per case. The best run is within −0.003 to +0.357 s of brute force (limited to 2 stops) and beats it by 4.5 s at Montreal, where 3 stops are optimal; the *mean* run is 0.5–2 min worse (sd 1:16–2:28). 🔵 Single runs of a stochastic search are unreliable; an exact DP avoids this.
- 🟢 **TUM's basic optimiser** (quadratic optimisation over stint lengths with no opponents) takes about 150 ms for 22 compound sets.

## 5. The lap model

**Tyres**
- 🟢 **Fieni 2025** wear model: `TW[k+1] = 0` after a stop, else `a_j · TW[k] + b_j · m_car[k]/m_car[0] + c_j`, TW from 0 to 1; lap time `T_nom + ΔT_j(TW)`. **No coefficients are published**; `b_j` was chosen heuristically, the mass effect is "marginal"; **the medium curve is heuristic (no data)**; the form of `ΔT_j` is not given. `T_nom` and the in-lap and out-lap times come from a lap solver fitted with neural networks, not from data. The data covers TW ≤ 0.6 only and is "artificially extended" to 1. Data source: Bonomi's repository (🔵 F1 2021 game data).
- 🟡 Read off Fieni's figures: wear per lap soft about 0.026, medium 0.020, hard 0.015; ΔT against wear for soft about 0 s at TW 0, 2.5 s at 0.5, 4 s at 0.6, 9 s at 1.0; fresh offsets against soft: medium about 0.7 s, hard about 2.0 s; soft and hard cross near lap 18–20 ("after 18 laps the hard starts paying off" 🟢). The soft has a warm-up inflection in its first 5 laps. Pit laps at Bahrain: normal 93.1 s, in-lap 104.6 s, out-lap 108.2 s, out-in-lap 119.7 s (🔵 a loss of about 26.6 s).
- 🔵 Only the shapes carry over: wear about linear per lap, lap time convex in wear, anything beyond 60 % wear is extrapolation and gets flagged.
- 🟢 **Bonomi's repository** (`classes/Car.py`): wear fitted linearly per corner in % per lap, time loss linearly per corner in ms per %; defaults against soft: medium 600 ms, hard 1,100 ms, inter 6,000 ms, wet 9,000 ms, averaged with fitted values; fuel 28–32 ms/kg (random); lap 1 +2 s; pit loss a constant 20–25 s per circuit. Its logs: soft front-left wear about 2.4–2.7 % per lap (Monza, Bahrain), burn about 1.9 kg per lap, lap times *fall* over a stint (fuel burn outweighs wear). `Car.json` is a Python pickle, not JSON: **never load it** (unpickling runs code). Randomness from `SystemRandom`, so not reproducible. The real-data section prints 0.3 s/kg, ten times the 0.03 elsewhere (probably a typo).
- 🟢 **Aguad & Thraves' instance:** tyre life soft 30, medium 40, hard 50 laps; fuel term 0.02 s per lap.

**Degradation estimation (Cappello & Hoegh)**
- 🟢 One driver (Hamilton, Austria 2025), one race, three stints, no SC; only in-laps and out-laps removed; fuel assumed linear from 110 kg to 0.
- 🟢 Observation `y_t = α_t + γ · fuel_t + ε_t`; state `α_{t+1} = (1 − I_pit)(α_t + ν) + I_pit · α_reset + η_t`. Extensions: ν and α_reset per compound; a growing slope `ν_{t+1} = ν_t + β[compound]`; a skewed-t error with **df fixed at 2** (infinite variance). Fitted with Stan (4 chains × 15,000 draws), 15–30 s per fit.
- 🟢 Priors: σ_ε N⁺(0.3, 0.1²), σ_η N⁺(0.1, 0.1²); ν per compound centred hard / medium / soft 0.01 / 0.03 / 0.05 s per lap; α_reset 69.5 / 69 / 68.5 s (from Leclerc's FP2 long run). **No prior and no estimate for γ; no posteriors for σ_ε, σ_η or the skew.** Estimates: ν hard 0.054 s per lap (95 % CI 0.004–0.133), medium 0.060 (0.009–0.120). With the growing slope, ν starts *negative* in each stint (warm-up) and reaches about 0.175 before the stop.
- 🟢 One-lap-ahead error (RMSPE) per stint: skewed t 0.325 / 0.601 / 0.156; Gaussian base 0.358 / 0.673 / 0.139; ARIMA 0.613 / 0.727 / 0.180. The base model wins stint 3; the skewed t wins overall mainly through one big outlier. CRPS: skewed t 0.202, base 0.230, ARIMA 0.324.
- 🔵 A plain Kalman filter equals this model only for the Gaussian base with fixed variances; the winning skewed-t version needs a robust filter (Student-t or Huber-weighted Kalman, or a particle filter).
- 🔵 **Fuel and degradation cannot be separated within a stint:** fuel falls linearly with the lap, so `γ · fuel` and `ν · t` are collinear; γ is identified only weakly, through the resets at stops. Fix γ from a prior.

**Dirty air and overtaking**
- 🟢 **Fieni 2026:** `ΔT_int = a · t_gap + b` for gaps of 0.2–1.35 s, else 0. **Fitted to the output of their own two-car lap simulation (arXiv 2503.05421) at Bahrain, not to race data**; at Monza the effect has the opposite sign (the follower gains). 🟡 About 0.33 s at a 0.2 s gap falling to 0.16 s at 1.35 s, then a cliff to 0; their numerical solution plateaus near 0.35 s.
- 🟢 **Wüthrich 2026:** a smooth hump instead: 0 side by side, a peak of about 0.5 s at a 0.6 s gap, 0 beyond 2.5 s.
- 🟢 **Joshi 2026:** 100,486 green-flag dry laps (FastF1, 2021–2025), corrected for fuel and tyres: lap time against the gap ahead has a slope of about **+0.014 s per second of gap** (p = 0.073; causal forest 0.018–0.019), U-shaped, with the 0.5–1 s bin fastest. **Real timing shows no measurable net dirty-air loss**: DRS, the tow and effort swamp it.
- 🟢 **Aguad & Thraves' interaction:** lap time `μ = γ + η(ε) − T_DRS · 1{gap ∈ [0, 1] s}`, with `η = e^(−λ|ε|) · z1` for the car **ahead** and `· z2` for the car **behind**, z1 < z2: the follower pays more, so a faster car may fail to pass. λ = 2.0 per s; Z1 ∈ {0.2, 0.4, 0.6} s, Z2 ∈ {0.5, 0.7, 0.9} s, equally likely; T_DRS ∈ {0.1, 0.3, 0.5} s with P 0.2 / 0.7 / 0.1; DRS off on laps 1–2 and for 2 laps after a neutralisation. No explicit pass event: a pass is when the gap changes sign.
- 🟢 **Fieni 2026 has no overtaking resistance at all:** a faster car passes at once, nobody defends. What emerged anyway: the undercut, and holding about 1.6 s behind, outside the wake, until the stop.
- 🟢 **TUM:** overtaking needs 2.01 s of pace advantage, adjusted by top speed; a fight costs both cars 0.3 s, the passed car another 0.3 s; DRS trains (a follower stuck behind) cost 0.3 s per lap in the China 2019 case study.
- 🔵 For pitwall: no published dirty-air number is a real-race measurement. The term is fitted on F1 25 recordings (clean following stints, DRS laps and battle laps kept apart) and is zero until measured. Overtaking keeps a threshold model (TUM) with defence costs (Aguad's asymmetry), calibrated per track and driver type.

**What observers of a rival see** 🟢 (Fieni 2026, eq. 5): tyre age, pit decision, "second compound used" and the gap; the compound is called observable in the text but is not in the vector; battery and energy are not observable. 🔵 This matches realism mode.

## 6. Driver behaviour

- 🟢 None of the papers models driver consistency or mistakes as such. TUM has per-driver lap scatter and accident probabilities; Cappello's error term holds "driver mistakes and the presence of other cars" (a mistake costs "several tenths"); Tulabandhula & Rudin filter crashes, spins and penalties out as noise.
- 🟢 Tulabandhula & Rudin: results were "race-specific rather than racer-specific"; pooling across races helps early in a race, naive pooling fails.
- 🟢 TUM: in China 2019, Verstappen is ahead of Leclerc in the deterministic run but only in 43 % of Monte Carlo races: scatter turns edge cases into ordinary outcomes.
- 🔵 Pitwall's split per driver:
  - a symmetric core with width σ_d, estimated robustly (median absolute deviation of the degradation filter's residuals);
  - a mistake process: a rate per lap p_d and a heavy-tailed positive size (log-normal or Pareto), estimated from residuals beyond k · σ_d on the slow side only;
  - each shrunk towards a population prior per driver type (AI, human), hierarchically across sessions.

  Mistake laps are left out of the degradation fit and kept for the noise model.

## 7. Validation when the real data is noisy

- 🟢 **TUM deterministic, Abu Dhabi 2017:** race duration off by −4.1 to +1.6 s per driver; mean lap error 0.47 s, lap-error sd 0.80 s on average. **The Monte Carlo was never validated as a predictive distribution:** only SC frequencies, the SC start CDF and one SC gap trace (China 2018, SC placed as in reality, compared by eye).
- 🟢 **China 2019:** automatically fitted parameters gave a race about 62 s too fast (about 1 s per lap); hand-tuned ones "largely agree". Errors from degradation fitted per team instead of per driver, from a compound with no data (an absurd one-stop), and from DRS trains.
- 🟢 **Cappello & Hoegh:** rolling-origin validation (train on the first ¾ of each stint, predict the next lap), scored by RMSPE and CRPS.
- 🟢 **Tulabandhula & Rudin:** the "zero change" baseline is hard to beat on RMSE; split by time (early outings train, late ones test), and expect a shift late in races; quality "improved dramatically" once outings, warm-up laps and epochs were defined carefully.
- 🟢 **Bonomi:** "beats Pirelli" means a better optimum of Pirelli's own model (🔵 circular); no real race outcome is used.
- 🔵 For pitwall:
  1. Fit-and-recover on generated races with known parameters is the gate.
  2. Match the generator's event frequencies (SC count, start, duration) against its tables.
  3. Score forecasts by rolling origin, with CRPS for the Monte Carlo distribution, and always next to a trivial baseline (gaps unchanged, stint mean).
  4. Split by time, not at random.
  5. Agreement between two tools on the same model is not validation.
  6. Write the stint, warm-up, clean-lap and mistake definitions as tested code.
  7. Check that the deterministic result is one mode of the Monte Carlo distribution and that the error falls as 1/√N.

## 8. Corrections to 03 and 07

**[03](03-strategy-models.md)**
1. §3.5: the start formula lacks the 8 m grid spacing: `t = √(2 · (p_grid − 0.8) · 8 m / a) + 0.2 s`.
2. §2.4: accident probabilities are 4.5–7.2 % per race (2019), not "about 5–10 %"; failure probabilities per team (4–12 %) are missing.
3. §2.4: the SC start bins are not spread evenly over the race: there is a bump at 60–80 % (0.193); a lap-1 SC starts at the end of lap 1.
4. Missing: the SC and VSC duration tables and the failure-driven VSC start (§2 above).
5. §3.6: the ±0.03 is one driver in one race, as batch spread; TUM has no seeds, no CI code, no variance reduction, and re-draws invalid races.
6. §3.6 "limitation": fixed strategies hold for the paper's experiments only; the code lets policies (VSE, RL) decide inside the Monte Carlo.
7. §2.5: "tyre-stress category" is `location_cat` in the code, meaning unconfirmed; the FCY status separates VSC from SC and this lap from earlier; the VSE has hard rules (p > 0.5, forced stop after 90 % without two compounds, at most 3 stops).
8. Missing: TUM's Fisk pit-stop fits drop stops more than 4 s over the race minimum.
9. Missing: the VSC frequency mismatch (up to 0.027).

**[07](07-strategy-literature.md)**
1. §2.1 Fieni: no coefficients are published, `b_j` is heuristic, the medium compound is heuristic (no data), `ΔT_j` has no stated form; `T_nom` and the in/out-lap times come from a lap solver with neural networks, not data; the wear model is "inspired by" Carrasco Heine & Thraves. Add medium about 0.7 s fresh, the soft–hard crossover near lap 18–20.
2. §2.1 Bonomi: "matched a brute-force search within a few seconds per race" is wrong (§4 above). Add the per-corner linear fits, the compound defaults, the pit loss, lap 1 +2 s, the 0.3 s/kg typo and the pickle warning.
3. §2.2 Cappello: a Kalman filter equals the Gaussian base model only; the skewed-t model needs a robust filter. df is fixed at 2; no estimates of γ, σ or skew are reported; the ν intervals are wide; fuel and slope are confounded; the base model beat the skewed t in stint 3.
4. §2.3: the DP/SDP runtime is now known for Aguad & Thraves (hours on 15 CPUs, about 10⁸ states per lap for two cars, gap grid step 0.04 s); the MINLP is BONMIN at 55–68 s; add Wüthrich (about 3 s; RL + MPC 0.035 s off; pit decisions identical to the optimum).
5. §2.4: the 30 % / 47 % rates are from Aguad & Thraves' footnote 1, not their Appendix A (online only, unread); the instance uses r_SC = 0.3; add the lap-end start, q from r, no wear under yellow, the 0.5 s SC gap, 10 s against 20 s pit loss, VSC 170 s and SC 200 s laps; Carrasco Heine's SDP wins by delaying stops.
6. §2.5 Aguad: z1 and z2 are swapped in 07: z1 is the car ahead, z2 the car behind; the follower pays more. "More than 15 % more often" is +18 percentage points (66 → 84 %), against a rival who still optimises over yellows but ignores the interaction. The follower sees the leader's new compound.
7. §2.5 Fieni 2026: "about 0.4 s close behind" is too high (about 0.33 s falling to 0.16 s, then a cliff); the coefficients are fitted to their own simulation, not real races; at Monza the sign flips; the observation vector is (tyre age, pit, compound-rule flag, gap); the model has no overtaking resistance.
8. §2.5 Joshi: the point is not that the penalty "did not shrink" but that real timing shows no detectable net penalty (slope +0.014 s per s, U-shaped).
9. §2.4 Fieni's disturbance: the size of the wear jump is not stated; Fieni models no SC.
10. §2.6 Tulabandhula & Rudin: the slope-against-rank pattern is U-shaped (higher at the front and the back); protection comes from cars *behind* that also took two tyres; an epoch is the green laps after the warm-up until the next stop or caution, and the "cars ahead had not pitted" part is a pit-entry adjustment on top; add "race-specific rather than racer-specific".

## 9. Still to get

- Aguad & Thraves' supplementary material (doi 10.1016/j.ejor.2024.07.011, ScienceDirect "Supplementary material"): Appendix A (SC/VSC rates per circuit, for the track files), Table M.1 (state counts and runtimes), Appendix L (parameter sources). Needs a download by the user.
- Carrasco Heine & Thraves 2023 full text (SSRN 3769652 or doi 10.1007/s10100-022-00806-4): how much the SDP gains over the DP.
- The VSE paper itself (validation metrics of its decisions); its content is partly covered through the dissertation.
