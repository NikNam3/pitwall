# Strategy models

## 1. What teams do

- Monte Carlo simulation of the whole race has been standard since McLaren in the 1990s (Neil Martin) ([The National](https://www.thenationalnews.com/uae/science/the-strategy-behind-the-race-1.567592)).
- Red Bull says it runs billions of simulations per race. That figure comes from Oracle marketing ([Oracle](https://blogs.oracle.com/connect/post/oracle-red-bull-racing-turns-data-into-decisions)).
- Practice sessions supply the base lap time and degradation of each car. During the race these are **re-estimated live** and the strategy is recalculated, e.g. switching to two stops when degradation is high.
- Driver models include overtaking ability, mistake probability and lap-time consistency ([Autosport](https://autosport.com/f1/news/inside-the-strategy-system-thats-won-20-f1-world-championships/10801964/)).

## 2. The open reference model: TUM race simulation

- **Authors:** Heilmeier et al. Three papers:
  - [ITSC 2018](https://doi.org/10.1109/itsc.2018.8570012), the deterministic model
  - [Monte Carlo, Appl. Sci. 2020, 10, 4229](https://doi.org/10.3390/app10124229), at `external/applsci-10-04229-v3.pdf`
  - [Virtual Strategy Engineer, Appl. Sci. 2020](https://doi.org/10.3390/app10217805)
- **Dissertation** (TUM 2022): https://mediatum.ub.tum.de/doc/1647512/1647512.pdf
- **Code:** [TUMFTM/race-simulation](https://github.com/TUMFTM/race-simulation), **LGPL-3.0**.
  - parameter files for 121 races from 2014–2019
  - `pars_mcs.ini` holds the Monte Carlo probabilities
  - **Re-implement, don't copy:** copying code would bring LGPL obligations.
- **Timing data** 2014–2019: [TUMFTM/f1-timing-database](https://github.com/TUMFTM/f1-timing-database). It could serve as test data for the strategy layer.
- The model steps forward **one lap at a time**.

The values below come from the code, its parameter files and the Monte Carlo paper, not from abstracts.

### 2.1 Lap-time formula (per driver, per lap)
```
t_lap = t_q + t_gap_racepace          # best qualifying lap + offset to race pace
      + t_car + t_driver              # team and driver pace gap
      + t_tire(age, compound)         # degradation (2.2)
      + m_fuel · s_mass               # fuel mass × sensitivity (s/kg)
      + N(0, σ_driver)                # lap-to-lap variation (Monte Carlo only)
      + [lap 1: t_loss_firstlap + (grid−1)·t_loss_pergridpos + N(start performance)]
      + [first lap of a stint: t_add_coldtires]
      + DRS bonus, duel/overtaking losses, pit in-lap/out-lap losses
```

### 2.2 Tyre models (`calc_tire_degradation.py`)
| Model | Formula |
|---|---|
| linear | `k0 + k1·age` |
| quadratic | `k0 + k1·age + k2·age²` |
| cubic | `k0 + k1·age + k2·age² + k3·age³` |
| logarithmic | `k0 + k1·ln(k2·age + 1)` |

- `k0` is the compound's offset when new. The parameters are fitted per driver and per compound.
- Cold tyres add **+1.0 s** on the first lap of a stint.
- **Tyres age at ×0.25 under SC and ×0.5 under VSC.**
- F1 25 supplies a `k0`-like value itself: `TyreSetData.m_lapDeltaTime` (see [04](04-f1-25-data-mapping.md)).

### 2.3 Example parameters: Spielberg 2019
| Item | Value |
|---|---|
| Fuel | 110 kg at the start, 1.549 kg/lap, **0.019 s/kg** (the 0.03 rule of thumb varies by track) |
| Fuel use under SC / VSC | ×0.25 / ×0.5 |
| Pit loss, green | in-lap +2.69 s, out-lap +11.40 s, standstill ≥1.9 s plus a team-specific extra → **about 16 s** |
| Pit loss under SC | in-lap **−1.49 s**, out-lap +3.98 s → **about 5 s** |
| Pit stop variation | Fisk distribution per team (heavy tail for slow stops) |
| Minimum gap to the car ahead | 0.5 s (0.8 s under SC) |
| Overtaking | the car behind needs **2.01 s of pace advantage**, adjusted by top-speed difference (−0.022 s per km/h) and team orders |
| Fighting for position | both cars lose 0.3 s; the car that gets passed loses another 0.3 s |
| DRS | within 1.0 s: −0.322 s per lap; active from lap 3, and 2 laps after an SC |
| SC / VSC lap times | ×1.6 behind the SC (as a "ghost car"), ×1.4 under VSC; no overtaking |

### 2.4 Monte Carlo inputs (`pars_mcs.ini`, fitted on 2014–2019)
- **SCs per race:** 0: 45.5 %, 1: 41.3 %, 2: 9.9 %, 3: 3.3 %
- **When the SC comes:** 36.4 % on lap 1, the rest spread across the race
- **SC duration:** mostly 2–5 laps
- **VSC after a technical failure:** 22.7 %
- accident probability per driver (about 5–10 % per race) and failure probability per team
- lap-time standard deviation per driver: about 0.45 s for top drivers, up to 0.85 s
- start performance per driver (mean and spread)

### 2.5 Inputs to the Virtual Strategy Engineer, effectively a strategist's checklist
The inputs to TUM's neural network for the pit decision:
- tyre age relative to race progress
- race progress and position
- current compound relative to the others available
- SC/VSC status
- remaining planned stops
- **whether the car behind has just pitted** (undercut threat)
- the track's tyre-stress category
- whether there is a car close ahead

Two further points:
- With no opponents, the optimal strategy is a **quadratic optimisation problem**. The full Monte Carlo is needed only because cars interact.
- Degradation is estimated by regression over fuel-corrected lap times per stint, which is what ATLAS's `LinearRegressionSlope` does live.

## 3. From the Monte Carlo paper (`external/applsci-10-04229-v3.pdf`)

### 3.1 Separating degradation from scatter: the clean-lap filter
- For **each stint**, fit a quadratic to the lap times: `t = k2·l² + k1·l + k0`. The curve captures degradation and fuel burn together.
- **Only clean laps go into the fit. Leave out:**
  - the first two laps of the race
  - in-laps and out-laps
  - every lap under SC or VSC
- What's left over (lap time minus curve) is roughly normally distributed. Its standard deviation is the driver's lap-time scatter, about 0.46–0.84 s.

### 3.2 The race history chart
```
gap(l) = t_race(l) − l · t_virt,   t_virt = winner's race time / number of laps
```
The reference is an imaginary driver who laps at a constant pace. A falling line means the driver is gaining time; a rising line means they're losing it. Live, use a running estimate for `t_virt`, e.g. the leader's average lap.

### 3.3 Safety car and VSC
- **SC and VSC start at a race time, not a lap number.** A lapped car meets the same SC one lap "earlier". All SC and VSC periods are drawn before the simulation runs.
- A lap that is only partly neutralised is blended: `t = f_n·t_normal + f_vsc·t_vsc`.
- **VSC:**
  - lap time ×1.4
  - no overtaking if at least 50 % of the lap is under VSC
  - tyre wear and fuel use at 50 %
- **SC "ghost car":** every driver gets their own virtual safety car, which affects only them.
  - The driver runs at ×1.4 until they catch it.
  - They then follow it at ×1.6, separated from the others by position × minimum gap.
  - The SC leaves only at the end of a lap.
  - DRS is off for 2 laps afterwards.
  - Tyre wear and fuel use run at 25 %.
- **Fuel saved under yellow is used up again later.** Consumption per lap is adjusted so the tank is empty at the finish.

### 3.4 Pit loss under VSC/SC depends heavily on the track
The "halve it" rule is wrong:

| Track | Green | VSC | SC |
|---|---|---|---|
| Catalunya | 19.04 s | 10.03 s | 7.88 s |
| Melbourne | 17.85 s | 12.95 s | 12.61 s |
| Monza | 20.60 s | 15.42 s | 10.16 s |
| Suzuka | 19.48 s | 15.05 s | 13.60 s |

Pit loss has to be **measured per track and per condition** (green, VSC, SC), e.g. from recordings.

### 3.5 Other models
- **Race start:** the average starter's time to the start line is `t = √(2(p_grid − 0.8)/a) + 0.2 s`, with `a = 11.2 m/s²`. A driver's start performance is their spread around this curve.
- **Accidents and failures:** probabilities are estimated with a Beta prior per driver (accidents) and per team (failures). Every SC is triggered by an accident; a failure triggers a VSC with probability 22.7 %.

### 3.6 Performance and output
- The Python version takes 90–110 ms per race. 10,000 runs take about 4–5 minutes on 4 cores, and pin down the mean finishing position to ±0.03 (95 % confidence).
- The output is a **distribution of finishing positions per strategy**, i.e. how robust each strategy is. In the paper's example, the deterministic result was only the second most likely outcome.
- **Limitation:** each strategy stays fixed during a Monte Carlo run and doesn't react to events. A live race needs a re-simulation whenever things change. The authors name this as an open problem, and it is where pitwall would have to go further than the paper.

## 4. Consequences for pitwall (agreed in the brainstorm)

1. The race model follows the TUM structure: lap-based, an additive lap time, the same set of parameters. Each term can be tested on its own.
2. **Two speeds:**
   - a fast deterministic forecast every lap (pit window, rejoin position, undercut threat) in the MVP (sub-project 4)
   - Monte Carlo in a worker, later (sub-project 5)
3. **Parameters are fitted live** from the session, like teams do from FP1/FP2: degradation per compound from your own stints, pit loss measured from actual stops, and fuel sensitivity.
4. A TypeScript implementation should be well below the Python runtime, so a re-simulation every lap in a worker thread looks realistic (not measured).
5. The strategy model must work with **measured wear** (AI cars, public telemetry) **and estimated wear** (restricted human rivals); see [04](04-f1-25-data-mapping.md).
6. The per-stint fit with the clean-lap filter (3.1) and the race-history formula (3.2) can be written straight into spec tests.
