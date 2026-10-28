# Research

Race-engineering research done on 2026-10-27/28, before the foundation spec. These files keep its findings in the repo; the spec and the architecture review refer to them.

| File | Content |
|---|---|
| [01-race-engineering-practice.md](01-race-engineering-practice.md) | What real (IRL) race engineers do and see: roles, software, display types, screens per task, work cycle |
| [02-atlas-interaction-model.md](02-atlas-interaction-model.md) | McLaren ATLAS in detail: data model, timebase, functions (math channels), alarms, workbooks; Catapult RaceWatch |
| [03-strategy-models.md](03-strategy-models.md) | How teams do strategy; the TUM race simulation: lap-time model, tyre models, parameters, Monte Carlo inputs, clean-lap filter, race history chart, SC/VSC, pit loss tables |
| [04-f1-25-data-mapping.md](04-f1-25-data-mapping.md) | What the F1 25 UDP feed delivers per view, send rates, online restrictions, extra fields, findings from the first recordings |
| [05-game-control-boundary.md](05-game-control-boundary.md) | What can be changed in the game from outside; why pitwall is read-only; the pit actuator idea (sub-project 6) |
| [06-engineer-decisions.md](06-engineer-decisions.md) | The engineer's decision catalogue: pit-wall roles and information flow, 32 decisions per weekend phase with computed answer, display, inputs, F1 25 feasibility and escalation; display catalogue; escalation map; open questions |

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
- degradation estimation from noisy live lap times (outliers, traffic laps, fuel correction) in more depth
- Segers, *Analysis Techniques for Racecar Data Acquisition* (SAE, 2nd ed. 2014), and Knox, *A Practical Guide to Race Car Data Analysis*, for standard math channels
- photos of real pit-wall screens, as visual reference for the UI (sub-project 2)
- live performance analysis: how the delta channel is aligned by distance, how the reference lap is chosen, splitting a lap into corners (sub-project 5)
