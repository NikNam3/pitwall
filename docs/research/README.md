# Research

Race-engineering research done on 2026-10-27/28; 01–05 before the foundation spec, 06–07 before the strategy and UI work; 08 (market landscape) on 2026-10-30; 09 (situations inventory) on 2026-10-30, extended 2026-11-02; 10 (situations catalogue) on 2026-11-04, during the contract migration; 11 (strategy model reread) and 12 (strategy data spike) on 2026-11-10, before 4.3. These files keep its findings in the repo. Which file to read for which work: CLAUDE.md "What to read".

| File | Content |
|---|---|
| [01-race-engineering-practice.md](01-race-engineering-practice.md) | What real (IRL) race engineers do and see: roles, software, display types, screens per task, work cycle |
| [02-atlas-interaction-model.md](02-atlas-interaction-model.md) | McLaren ATLAS in detail: data model, timebase, functions (math channels), alarms, workbooks; Catapult RaceWatch |
| [03-strategy-models.md](03-strategy-models.md) | How teams do strategy; the TUM race simulation: lap-time model, tyre models, parameters, Monte Carlo inputs, clean-lap filter, race history chart, SC/VSC, pit loss tables |
| [04-f1-25-data-mapping.md](04-f1-25-data-mapping.md) | What the F1 25 UDP feed delivers per view, send rates, online restrictions, extra fields, findings from the first recordings |
| [05-game-control-boundary.md](05-game-control-boundary.md) | What can be changed in the game from outside; why pitwall is read-only; the pit actuator idea (sub-project 6) |
| [06-engineer-decisions.md](06-engineer-decisions.md) | The engineer's decision catalogue: pit-wall roles and information flow, 33 decisions per weekend phase with computed answer, display, inputs, F1 25 feasibility and escalation; display catalogue; escalation map; open questions |
| [07-strategy-literature.md](07-strategy-literature.md) | Literature map of strategy models (DP/SDP, MILP, MINLP, RL, game theory, state-space degradation, dirty air): what each adds and how they combine into pitwall's strategy layer |
| [08-market-landscape.md](08-market-landscape.md) | Other race-engineer tools (F1 25 apps, iRacing/LMU/ACC team platforms, real-F1 timing apps): what to take, where pitwall is ahead and behind, the 2026 Season Pack format risk |
| [09-situations-inventory.md](09-situations-inventory.md) | Every situation signal as our recordings show it (session phases, car situations, flags, penalties, the sprint, race starts), with times; the facts the machine's sub-machines are built on |
| [10-situations-catalogue.md](10-situations-catalogue.md) | The situations catalogue (contract C17, C19): one section per sub-machine with its scope, kinds, transitions, signals and their timing, test rows, segments and "seen" or "not yet seen" from `pitwall scan-situations`; the recording checklist for every situation not yet seen |
| [11-strategy-model-reread.md](11-strategy-model-reread.md) | Every strategy paper read again before 4.3: Monte Carlo run counts and variance reduction, TUM's random-event tables, reacting vs fixed strategies, DP formulations and runtimes, tyre, dirty-air and overtaking models, driver noise, validation on noisy data; corrections to 03 and 07 |
| [12-strategy-data-spike.md](12-strategy-data-spike.md) | What the recordings say about the strategy model: driver noise (AI vs our two humans), wear vs age, wet lap times, dirty air, blocking and passes, pit loss per condition, double stacks, the AI's stop and SC behaviour, undercut cases; engine defects found; consequences for the 4.3 spec; recordings wanted |
| [13-strategy-compute-spike.md](13-strategy-compute-spike.md) | What the simulators cost and how fast the Monte Carlo ranking settles: race-forecast, strategy-dp and race-monte-carlo prototypes on a generated race; time per piece, convergence with and without common random numbers, time caps, mode switch, ablation per model part, rule-based candidates, the S5 ranking rule; consequences for the 4.3 spec; follow-up on traffic, DRS trains and pace uncertainty |
| [14-strategy-reread-after-spike.md](14-strategy-reread-after-spike.md) | Every strategy paper reread with the compute spike's questions: overtaking per track, blocking, DRS trains, traffic after a stop, pace uncertainty, ranking and selection under noise; the spike's proposals after the reread (cap 5 s); corrections to 11 |
| [15-pass-curve-fit.md](15-pass-curve-fit.md) | The pooled pass-curve fit on the F1 25 recordings (SP4.3a Task 13): recordings kept and dropped, curves per band and pooled, wet factor, DRS hint, the O14 checks (held loss, rejoin push-back) |
| [16-scoreboard-baseline.json](16-scoreboard-baseline.json) | The first `pitwall score` baseline over the six race recordings (SP4.3a): the `--compare` base for later model changes, with its known limits |
| [20-tyre-behaviour.md](20-tyre-behaviour.md) | Tyre behaviour with heat, pressure and track condition in real F1, in the F1 25 model and feed, and in our recordings: the game's pressure as setup × gas law with a reference carcass temperature per compound, AI tyre values as constants, inter wear against carcass heat, the Silverstone 2026-11-14 drying case; proposals for per-compound car bands, wear inputs and a setup check; recordings wanted |

## Provenance

- **Focus:** what real race engineers see, i.e. technical analysis. Radio and game specifics came second (user decision).
- **Sources:**
  - web sources (linked in each file)
  - the TUM race-simulation code (read directly)
  - the Monte Carlo paper (`external/applsci-10-04229-v3.pdf`)
  - the official F1 25 UDP spec (`external/Data Output from F1 25 v3-1.pdf`, `external/F1 25 Telemetry Output Structures.txt`)
  - the recordings in `recordings/`
- **Caveat:** real team screen layouts are confidential. The picture is pieced together from vendor documentation, official F1 and team articles, and training material.
- **Origin:** the findings come from the session transcript `~/.claude/projects/-home-nklx-dev-personal-pitwall/7f29a793-…jsonl`, which Claude Code deletes after about 30 days. These files are now the only copy that will last.

## Open research gaps

- the ATLAS cursor documentation (reference vs comparison cursor, live follow mode)
- ~~degradation estimation from noisy live lap times~~: covered by the state-space model in [07](07-strategy-literature.md) §2.2; traffic correction still open
- the F1 25 measurements listed in [06](06-engineer-decisions.md) §5 and [07](07-strategy-literature.md) §4 (pit loss per condition, SC behaviour, dirty-air loss, wear against lap time); they need recordings with stops and an SC
- Carrasco Heine & Thraves (2023) full text ([DOI](https://doi.org/10.1007/s10100-022-00806-4)) and Aguad & Thraves' supplementary material (per-circuit SC/VSC rates): see [11](11-strategy-model-reread.md) §9
- Segers, *Analysis Techniques for Racecar Data Acquisition* (SAE, 2nd ed. 2014), and Knox, *A Practical Guide to Race Car Data Analysis*, for standard math channels
- photos of real pit-wall screens, as visual reference for the UI (sub-project 2)
- live performance analysis: how the delta channel is aligned by distance, how the reference lap is chosen, splitting a lap into corners (sub-project 5)
