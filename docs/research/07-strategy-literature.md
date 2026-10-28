# Strategy models: the literature map

[03](03-strategy-models.md) covers the TUM race simulation. [06](06-engineer-decisions.md) found a 2026 MILP model built on F1 25 data (Avella et al.). This file follows their citations backwards and searches forwards for newer work. It asks what each paper adds and how the pieces combine into pitwall's strategy layer (sub-projects 4 and 5).

Research done on 2026-10-28. The user's view: the 2026 paper is promising but not a finished solution; learn from it and combine it with the rest.

**How far each paper was read:** 🟢 full text read · 🟡 abstract, excerpts or a search summary only. Pitwall's own conclusions are marked 🔵.

## 1. The map

| Year | Paper | Method | Optimises | SC / rivals | Read |
|---|---|---|---|---|---|
| 2009 | Bekker & Lotz, *Planning F1 race strategies using discrete-event simulation*, JORS 60(7) | discrete-event simulation for one team; validated on three 2005 races | evaluates given strategies | failures, overtaking, pit stops / yes | 🟡 [IAOR](https://iaorifors.com/paper/64724) |
| 2014 | Tulabandhula & Rudin, *Tire changes, fresh air, and yellow flags*, Big Data 2(2) | real-time prediction of rank change after a tyre decision (NASCAR) | 2- vs 4-tyre stop | yellow flags / rank | 🟡 [DOI](https://doi.org/10.1089/big.2014.0018), [MIT](https://dspace.mit.edu/handle/1721.1/109309) |
| 2018–22 | Heilmeier et al. (TUM): race simulation, Monte Carlo, Virtual Strategy Engineer, dissertation | lap-wise simulation, Monte Carlo, neural nets for the pit decision | evaluates strategies; VSE decides pit and compound | yes / yes | 🟢 [03](03-strategy-models.md) |
| 2023 | Carrasco Heine & Thraves, *On the optimization of pit stop strategies via dynamic programming*, CEJOR 31(1) | dynamic programming (DP), extended to stochastic DP (SDP) | stop laps and compounds, minimum race time | yellow flags, rain (SDP) / no | 🟡 [RePEc](https://ideas.repec.org/a/spr/cejnor/v31y2023i1d10.1007_s10100-022-00806-4.html) |
| 2023 | Bonomi, Turri & Iacca, *Evolutionary F1 race strategy*, GECCO '23 Companion | genetic algorithm from practice data; evaluated on a video game and on **Pirelli tyre data**, with Pirelli strategy engineers | stop laps and compounds | no / no | 🟡 [UniTN](https://iris.unitn.it/handle/11572/384851), [DOI](https://doi.org/10.1145/3583133.3596349) |
| 2023 | Duhr et al. (ETH), *Minimum-race-time energy allocation strategies for the hybrid-electric F1 power unit*, IEEE TVT 72(6) | nonlinear program over lap-time maps | battery and fuel energy per lap | no / no | 🟡 (cited in Fieni 2025) |
| 2024 | Aguad & Thraves, *Optimizing pit stop strategies in F1 with dynamic programming and game theory*, EJOR 319(3) | two-driver zero-sum feedback **Stackelberg game**, solved by DP; the leader moves first each lap | win probability | yellow flags / one rival | 🟡 [ANID](https://investigadores.anid.cl/es/public_search/work?id=772055) |
| 2025 | Thomas et al. (Imperial + Mercedes), *Explainable RL for F1 race strategy* (RSRL), ACM SAC '25 | deep recurrent Q-network trained on Mercedes' Monte Carlo simulator; SHAP, decision-tree surrogates and counterfactuals | pit lap and compound | via the simulator / via the simulator | 🟢 parts, [arXiv 2501.04068](https://arxiv.org/abs/2501.04068) |
| 2025 | Cappello & Hoegh, *A state-space approach to modeling tire degradation in F1*, arXiv 2512.00640 | **Bayesian state-space model** of latent tyre pace | estimates degradation live | no / no | 🟢 [arXiv](https://arxiv.org/abs/2512.00640) |
| 2025 | Fieni et al. (ETH), *Towards learning-based F1 race strategies*, arXiv 2512.21570 | MINLP (BONMIN) plus an RL agent on the same model | pit stops, compound, battery and fuel per lap | one disturbance / no | 🟢 [arXiv](https://arxiv.org/abs/2512.21570) |
| 2026 | Avella et al., *A simulation framework for F1 race strategy based on pit-stop optimization*, Optimization Online | MILP (FICO Xpress); parameters **from F1 25 practice** | stints, compounds, fuel load, ERS per sector | no / no | 🟢 [06](06-engineer-decisions.md), [paper](https://optimization-online.org/2026/02/a-simulation-framework-for-formula-1-race-strategy-based-on-pit-stop-optimization/) |
| 2026 | Fieni et al. (ETH), *Learning-based multi-agent race strategies in F1*, arXiv 2602.23056 | multi-agent RL, self-play, Elo ranking; a dirty-air model couples the cars | as Fieni 2025, against an active rival | no / **yes** | 🟢 [arXiv](https://arxiv.org/abs/2602.23056) |
| 2026 | Wüthrich et al. (ETH), *Bridging RL and MPC for mixed-integer optimal control*, arXiv 2604.00826 | the RL actor sets the integer decisions, then a nonlinear MPC refines | as Fieni 2025 | adapts to unseen disturbances / no | 🟡 [arXiv](https://arxiv.org/abs/2604.00826) |
| 2026 | Joshi, *The persistence of the dirty air penalty*, arXiv 2608.03192 | causal analysis of 100,000 laps (FastF1) | measures the dirty-air penalty | – | 🟡 [arXiv](https://arxiv.org/abs/2608.03192) |

Found but not looked at in depth (🟡 search summaries): a genetic algorithm from historical data ([Brennand et al., JBCS 2026](https://journals-sol.sbc.org.br/index.php/jbcs/article/view/5833)), a QUBO/annealing formulation ([Kolstee, LIACS 2026](https://theses.liacs.nl/pdf/2025-2026-KolsteeSSophie.pdf)), two-stage stochastic programming ([Ferreira, PoliTo 2026](https://webthesis.biblio.polito.it/41015/)).

## 2. What each one adds

### 2.1 Tyre model: wear as a state, not just age

- **TUM** ([03](03-strategy-models.md)): lap time grows with tyre **age** (linear to cubic, or logarithmic).
- **Fieni 2025** (🟢) separates two relations: tyre **wear** evolves per lap, and lap time depends on wear.
  ```
  TW[k+1] = 0                                          if pitting
          = a_j · TW[k] + b_j · m_car[k]/m_car[0] + c_j   otherwise
  T_lap   = T_nom(E_b, ΔE_b, ΔE_f, m_car, pit) + ΔT_j(TW)
  ```
  `a_j, b_j, c_j` are per compound and track; the mass term makes a heavy car wear its tyres faster. `ΔT_j(TW)` is a fitted curve per compound; Pirelli data covered `TW ≤ 0.6` only, because teams change tyres before then. A fresh hard costs about 2 s/lap against a fresh soft and pays off after about 18 laps.
  - In-lap, out-lap and "out-in-lap" each get their own lap-time map (example: 93.1 s normal, 104.6 s in-lap, 108.2 s out-lap).
  - The tyre data came from a public GitHub repository released with Bonomi et al., made with Pirelli (repository URL not yet found).
- **Avella 2026** (🟢) uses one average degraded lap time per compound: `t_eff = t_base · (1 + δ·μ_perf/2)`. This is the crude part of that paper.

**For pitwall (🔵):** F1 25 delivers **tyre wear %** directly (`m_tyresWear`) for our cars, AI cars and public players. So Fieni's split fits the game better than age-based models: fit the wear rate per compound from the wear channel, and the lap-time cost against wear from lap times. Hidden cars (restricted humans, or anyone when realism mode is on) fall back to the age-based TUM model.

### 2.2 Live degradation from noisy lap times

This was an open research gap ([README](README.md)).

- **Cappello & Hoegh 2025** (🟢): a state-space model.
  ```
  y_t     = α_t + γ · fuel_t + ε_t                       (observation: lap time)
  α_{t+1} = (1 − I_pit)(α_t + ν) + I_pit · α_reset + η_t  (latent tyre pace)
  ```
  `ν` is the degradation per lap (per compound in an extension), `γ` the fuel sensitivity, and a pit stop resets the state. A **skewed t** error fits best, because mistakes and traffic only make laps slower. It beat an ARIMA(2,1,2) baseline. Hard and medium were not statistically distinct in their one-race case. They name traffic (distance to the car ahead) as the next covariate.
  - It is fitted with Stan/MCMC, but the base model is linear and Gaussian, so a **Kalman filter** gives the same estimate live (🔵), with an uncertainty that shrinks as laps arrive.
- **HH Timing** (🟢, [06](06-engineer-decisions.md)): linear fit per stint, excluding laps over 120 % of the stint average. **TUM**: quadratic per stint with the clean-lap filter.

**For pitwall (🔵):** a Kalman filter per car and stint replaces the plain regression. It gives degradation *and* its uncertainty every lap, handles stint resets naturally, and down-weights outliers if it uses a robust (skewed or heavy-tailed) noise model. The clean-lap filter still decides which laps go in. A traffic covariate (gap ahead under 1.35 s, see 2.5) is a cheap extension.

### 2.3 The optimiser: which method

| Method | Example | Runtime | Strengths | Weaknesses |
|---|---|---|---|---|
| MILP | Avella 2026 | < 0.3 s | fast, exact for its linear model | needs a solver (Xpress); linear degradation only |
| MINLP | Fieni 2025 | 50 s – 5 min | nonlinear wear, energy | too slow per lap |
| DP / SDP | Carrasco Heine & Thraves 2023 | not known | exact, any nonlinear model, SC as a random event | state space grows with every state added |
| Genetic algorithm | Bonomi 2023 | not known | flexible | no optimality guarantee |
| RL policy | Fieni 2025, RSRL 2025 | inference < 1 s | instant, handles disturbances | needs a simulator to train; about 5 s suboptimal over 1.5 h (Fieni) |

**For pitwall (🔵):** **dynamic programming** over the rest of the race. The state is (lap, compound, tyre wear or age, "second compound used", sets left). With about 70 laps × 3 compounds × 70 wear steps × 2 × a few set counts, that is a few hundred thousand states with 4 actions each. It needs no solver, takes any degradation curve from 2.1, and is exact. This estimate is not measured. The same DP extends to Carrasco Heine's **stochastic DP** for SC/VSC (2.4). Avella's constraints carry over unchanged: two dry compounds, maximum stint length, sets available.

**Energy:** Fieni and Avella plan battery and fuel energy per lap. In F1 25 the driver sets ERS mode and fuel mix, not an energy target, so energy belongs in the per-lap targets (D12, D13 in [06](06-engineer-decisions.md)), not in the pit optimiser at first. Avella's **40 % battery reserve until the last laps** is a useful rule for D13.

### 2.4 Safety cars and uncertainty

- **Carrasco Heine & Thraves** (🟡): the SDP beats the plain DP, especially in races where yellow flags are likely. The SDP's policy is a *rule per state* ("in this state, if a yellow comes, pit"), which is exactly the standing SC answer of [06](06-engineer-decisions.md) D24.
- **Aguad & Thraves** (🟡): with two drivers, yellow flags raise the **weaker driver's** chance of winning.
- **TUM** ([03](03-strategy-models.md)): Monte Carlo with SC probabilities per race; SC starts at a race time, not a lap.
- **RSRL** (🟢): answers questions like "if there is a safety car, what should we do" through its simulator.
- **Fieni 2025** (🟢): after a disturbance at lap 22 (a jump in tyre wear), the RL agent lost 5.08 s against the re-solved optimum and a fixed heuristic lost 31.45 s. Plans that don't re-plan are expensive.

**For pitwall (🔵):** two options for sub-project 5. The **SDP** gives exact answers per state but needs SC probabilities per lap. **Monte Carlo** (TUM) gives distributions of finishing positions. The SDP's per-state answers fit the numbers-only rule well: "SC now: gain 11.2 s, P7" is a lookup.

### 2.5 Rivals and dirty air

- **Fieni 2026** (🟢) couples two cars:
  ```
  ΔT_int = a · t_gap + b    for t_gap in [0.2 s, 1.35 s], else 0
  t_gap[k+1] = t_gap[k] + (T_lap_us[k] − T_lap_rival[k])
  ```
  `a, b` are per track; at Bahrain the fitted loss reaches about 0.4 s per lap close behind (read from their figure). **The agents observe only what a real pit wall sees of the rival: compound, tyre age, pit stop, "second compound used", gap.** Battery and energy are explicitly unobservable. The trained agents learned the undercut by themselves and held about 1.6 s behind, outside the wake, until their stop.
- **Aguad & Thraves** (🟡): a two-driver game in which the leader moves first each lap.
- **Joshi 2026** (🟡): the dirty-air penalty did not measurably shrink with the 2022 rules.

**For pitwall (🔵):**
- Fieni's dirty-air term and gap update go into every forecast that follows gaps: the battle forecast (D17), the undercut balance (D23) and the traffic after a rejoin (D21). The F1 25 coefficients have to be fitted from recordings (lap-time loss against the gap at the start of the lap).
- Fieni's observation set matches the **realism mode** decided in [06](06-engineer-decisions.md): a model built on it works the same with realism on or off.

### 2.6 Learned policies and explanations

- **VSE** (TUM), **RSRL** (Mercedes) and **Fieni's agents** output an *action*. RSRL ended its test race on average P5.33 against P5.63 for the best baseline.
- RSRL adds **explanations**: feature importance (TimeSHAP), a decision-tree surrogate, and **counterfactuals** ("the smallest change in the race state that would change the decision").

**For pitwall (🔵):** the user wants **numbers, not verdicts** ([06](06-engineer-decisions.md)). A policy that outputs "pit now" is a verdict, so learned policies are not planned. The counterfactual idea survives as a number, though: a **sensitivity line** such as "two stops become faster if degradation exceeds 0.12 s/lap (now 0.09 ± 0.02)". The DP and the Kalman filter can compute it directly.

## 3. How the pieces combine (🔵 proposal)

| Layer | What | Built on | Sub-project |
|---|---|---|---|
| 1. Estimation | per car and stint: Kalman filter on fuel-corrected lap times; wear-rate fit per compound where wear is visible; fuel sensitivity `γ`; pit loss table per condition; dirty-air coefficients | Cappello & Hoegh, Fieni 2025/26, HH, TUM | 4 |
| 2. Forecast | lap-by-lap gap forecast with the dirty-air term and overtaking threshold; rejoin and undercut calculations | Fieni 2026, TUM, HH ghosts | 4 |
| 3. Optimiser | DP over the remaining race for each of our cars, every lap; table of strategies with projected times; sensitivity lines | Carrasco Heine & Thraves, Avella constraints | 4 |
| 4. Uncertainty | SDP with SC/VSC per state, or Monte Carlo with distributions | Carrasco Heine & Thraves, TUM | 5 |
| 5. Rivals' strategy | predicted stops of rivals from their stint lengths and tyre age, feeding layers 2 and 3 | HH predicted stint length, Aguad & Thraves | 5 |

Every layer works with realism mode on: with wear hidden, layer 1 uses age-based degradation from lap times.

## 4. Open questions and next reads

- **Full texts not read (🟡 above):** Carrasco Heine & Thraves (Springer), Aguad & Thraves (EJOR), Bekker & Lotz (JORS), Bonomi et al. (ACM; the UniTN copy didn't download as PDF), Tulabandhula & Rudin, Duhr et al. They hold the DP state definitions, the game formulation and the SC model that layers 3–5 need.
- **The Pirelli tyre data repository** of Bonomi et al.: URL not found yet. It would give real wear-to-lap-time curves to compare with F1 25.
- **F1 25 checks from recordings:** does lap time follow wear % (Fieni's `ΔT_j(TW)`) better than tyre age? How large is the dirty-air loss, and up to which gap? Does wear depend on fuel mass (Fieni's `b_j`)?
- **DP runtime in TypeScript:** estimated, not measured; a spike in sub-project 4 settles it.

## 5. Sources

- Bekker, J., Lotz, W. (2009). Planning Formula One race strategies using discrete-event simulation. *JORS* 60(7), 952–961. [IAOR](https://iaorifors.com/paper/64724)
- Tulabandhula, T., Rudin, C. (2014). Tire changes, fresh air, and yellow flags. *Big Data* 2(2), 97–112. [DOI](https://doi.org/10.1089/big.2014.0018)
- Carrasco Heine, O. F., Thraves, C. (2023). On the optimization of pit stop strategies via dynamic programming. *CEJOR* 31(1), 239–268. [DOI](https://doi.org/10.1007/s10100-022-00806-4)
- Bonomi, A., Turri, E., Iacca, G. (2023). Evolutionary F1 race strategy. *GECCO '23 Companion*, 1925–1932. [DOI](https://doi.org/10.1145/3583133.3596349)
- Duhr, P. et al. (2023). Minimum-race-time energy allocation strategies for the hybrid-electric Formula 1 power unit. *IEEE TVT* 72(6), 7035–7050.
- Aguad, F., Thraves, C. (2024). Optimizing pit stop strategies in Formula 1 with dynamic programming and game theory. *EJOR* 319(3), 908–919.
- Thomas, D. et al. (2025). Explainable reinforcement learning for Formula One race strategy. *ACM SAC '25*. [arXiv 2501.04068](https://arxiv.org/abs/2501.04068)
- Cappello, C., Hoegh, A. (2025). A state-space approach to modeling tire degradation in Formula 1 racing. [arXiv 2512.00640](https://arxiv.org/abs/2512.00640)
- Fieni, G. et al. (2025). Towards learning-based Formula 1 race strategies. [arXiv 2512.21570](https://arxiv.org/abs/2512.21570)
- Avella, P. et al. (2026). A simulation framework for Formula 1 race strategy based on pit-stop optimization. [Optimization Online](https://optimization-online.org/2026/02/a-simulation-framework-for-formula-1-race-strategy-based-on-pit-stop-optimization/)
- Fieni, G. et al. (2026). Learning-based multi-agent race strategies in Formula 1. [arXiv 2602.23056](https://arxiv.org/abs/2602.23056)
- Wüthrich, J. et al. (2026). Bridging RL and MPC for mixed-integer optimal control with application to Formula 1 race strategies. [arXiv 2604.00826](https://arxiv.org/abs/2604.00826)
- Joshi, B. (2026). The persistence of the dirty air penalty. [arXiv 2608.03192](https://arxiv.org/abs/2608.03192)
- Pirelli's strategy method (qualitative only): [F1Technical](https://www.f1technical.net/news/28001)
