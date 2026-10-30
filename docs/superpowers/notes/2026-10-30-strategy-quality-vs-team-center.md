# Strategy decision quality: how to beat Team Center

Input for the 4a/4b/SP5 strategy work, written 2026-10-30 after the market research ([research 08](../../research/08-market-landscape.md) §10.1). Simulator Controller's Team Center is the only tool found that is an F1 25-capable pit wall with a real strategy model. Its weaknesses below come from its wiki, not its source code. Its source is public under CC BY-NC-SA, so ideas may be taken but not code ([ADR 0006](../../decisions/0006-gpl-code-and-data-allowed.md)).

## 1. Where Team Center is weak, and pitwall's answer

| # | Team Center | Pitwall's answer | Where it lives now |
|---|---|---|---|
| 1 | The live stop recommendation ignores rival stops; the Monte Carlo only knows each rival's "typical stint length" plus random early stops | predict each rival's stop window from compound, tyre age, fitted degradation and **the two-dry-compound rule**; later a two-car game for the car directly ahead or behind (Aguad & Thraves, research 07 §2.5) | rival stops: SP5 (4a spec §5.3: "rivals do not stop in 4a"); the compound rule: nowhere yet |
| 2 | Full-course yellow: pit if the number of remaining stops stays the same | pit loss under SC/VSC per track (4a `pit-loss`), the SC call with rejoin position (4a `sc-call`); SC probabilities from the league's races and an optimiser that values staying flexible (stochastic DP) | 4a has the measured loss and the call; probabilities and SDP: SP5 |
| 3 | Rival pace from position samples every 10 s; degradation model undocumented | clean-lap filter, fuel correction, per-stint degradation fit, dirty-air term, measured in-lap and out-lap penalty | 4a `degradation`, `lap-model`, `pit-loss` (covered) |
| 4 | Ranks by places gained, then traffic, then fewest stops | **expected league points** across the outcome range, **for both cars together** (double-stack conflicts, one car covers while the other goes long), and robust to our own drivers' mistakes, not only rivals' | nowhere yet; 4b optimiser objective |
| 5 | No way to measure its own calls | **forecast scoreboard**: replay recorded races and score each lap's forecasts against what happened (lap times, rejoin position, undercut outcome, SC call); optionally a head-to-head against Team Center fed the same race over UDP | nowhere yet |
| 6 | Recalculates every N laps or after an unplanned stop; the Monte Carlo drops frames; rain strategies are never proposed automatically | per lap and per event within compute budgets; options with deltas and "what changed"; weather from the game's own forecast | 4a (covered: budgets, `crossover`, `weather`); 4b plan board |

Covered by the current 4a spec: rows 3 and 6, and the measured half of row 2. New: the compound rule (row 1), the objective (row 4) and the scoreboard (row 5).

## 2. Questions

### Q1. Should the forecast scoreboard come in 4a or later?

The 4a spec and plan are written. Pitwall can already replay a recording deterministically (`reprocess`). The scoreboard would replay each recorded race and, at every lap, compare the 4a forecasts with what really happened. This is a bridge CLI report (e.g. `pitwall score <recording>`), not a test: the testing rules keep whole recordings out of unit tests. It shows whether a model change helped, and it measures the "beat the game's strategist" goal.

- **A.** Add it to 4a as one late task after the strategy analyses: a report of forecast error per horizon (1, 3, 5, 10 laps), rejoin position error and undercut outcomes. This amends the spec and the plan.
- **B.** Make it the first task of 4b, before the optimiser, so the DP spike is judged by it.
- **C.** Leave it in SP5 together with calibration.

Recommendation: **A** if the 4a run hasn't started, otherwise **B**. Every model choice in 4a (degradation fit, dirty air, out-lap penalty) is a guess until something scores it.

**Answer:** A (user, 2026-10-30). In 4a as the `forecast-score` analysis and `pitwall score` (spec 7.15, plan Task 29a).

### Q2. Does the league race under the two-dry-compound rule, and should 4a use it?

In a dry race, a car that hasn't used a second dry compound must still stop. That makes it the strongest single predictor of a rival's stop late in the race, and it limits our own next compound. The game sends every car's stint compounds (session history, already decoded). 4a §14.2 leaves the league's compound rules open and makes the allowed compounds config.

- **A.** Add a `mustStop` flag per car (no second dry compound yet, dry race) next to `stopDue`, and let `pit-window` and `pit-sweep` exclude a next compound that would break the rule. Small change, built only if the rule is on.
- **B.** Only the config switch now; use the rule in SP5's rival-stop prediction.

Recommendation: **A**, provided the league confirms the rule. It is cheap, and the undercut card is misleading without it.

**Answer:** B (user, 2026-10-30). The league races under the 2025 F1 sporting regulations, so the rule applies. In 4a it is not worth building: 4a's rivals never stop, so a rival's forced stop changes no number, and the engineer picks our next compound. The rule enters with the rival-stop prediction in SP5. Beating Team Center is not an MVP goal.

### Q3. Should rivals' predicted stops move from SP5 to 4b?

It is Team Center's largest gap, and every undercut and cover call depends on it. 4a's forecast lets rivals not stop and only marks `stopDue`.

- **A.** Move it to 4b: the optimiser then plans against predicted rival stops from the start.
- **B.** Keep it in SP5 with the Monte Carlo, as planned.

Recommendation: **A**, a deterministic prediction (stint lengths, tyre life, compound rule) in 4b. The probabilistic version stays with the Monte Carlo in SP5.

**Answer:** B (user, 2026-10-30). Rivals' predicted stops stay in SP5 with the Monte Carlo; nothing is pulled forward to beat Team Center.

### Q4. What should the 4b optimiser maximise?

- **A.** Expected league points for both our cars together, with our own drivers' error rate in the outcome range.
- **B.** Expected finishing position per car, optimised separately.
- **C.** Minimum race time per car (TUM's and most papers' objective).

Recommendation: **A**. Points are what the league counts. Joint planning avoids double-stack conflicts and allows covering plays. Friends spin often, so a plan that collapses after one lost five seconds is a bad plan. C can stay as the inner measure.

**Answer:** an ordered objective (user, 2026-10-30): first expected finishing position per car, then expected league points, then minimum race time per car, each breaking the ties of the one before. It goes together with the win-probability objective of Aguad & Thraves (research 07 §2.5). Recorded in the 4a spec §13 as input for the 4b brainstorm.

### Q5. Build a head-to-head harness against Team Center?

It needs the recorder to play a `.pwrec` back as UDP, plus a Windows machine running Simulator Controller. The result would be a direct comparison of calls on the same races.

- **A.** Yes, in SP5 or later, in the recorder repo (UDP playback) and as a manual comparison.
- **B.** No; the scoreboard against real outcomes is enough.

Recommendation: **B** for now. Real outcomes are the better referee; revisit if a comparison is ever needed.

**Answer:** B (user, 2026-10-30).
