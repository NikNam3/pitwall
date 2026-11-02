# Research task: the engineer's decision catalogue

## Goal

Afterwards `docs/research/06-engineer-decisions.md` exists. It is a catalogue of the decisions the user makes as race engineer over an F1 25 weekend. For each decision it records the computed answer that would make that decision fast and well-founded, and how to show it. It is the content basis for the widgets of sub-projects 3 and 4, and for the mockups in the UI design (sub-project 2).

## Why

The user is one person doing a whole pit wall's job for two friends in an online F1 25 league. Raw data is not enough; computed results are what help: projected gains and losses, rejoin positions, undercut outcomes. The "circle of doom" is the model example (see below).

Real teams hide their tools. So the catalogue may:
- (A) invent its own analyses where they are useful
- (B) build on rumours and fragments

It must label which is which.

The guiding question: **what does the pit-wall team do, and how do we make the engineer's job as easy and as effective as possible?**

## Context you need

Read first:
- `CLAUDE.md`
- `docs/research/README.md` and `01`–`05`. The research style and provenance rules are there: IRL practice first, game specifics second.
- `docs/research/04-f1-25-data-mapping.md` for what the game delivers, including the online restrictions.

What the user decided (2026-10-28, UI brainstorm):
- **Weekend format:**
  - either full (FP1–3, Q1–Q3, race) or short (one practice, short or one-shot qualifying, race), depending on the time available
  - races are 50 % or 100 %, mostly 100 %, so real one- and two-stop strategy, long stints, degradation and fuel matter
  - SC/VSC is likely over a long race
- **The user's attention in a race,** most important first:
  1. car care: calls to adjust the car, the job that always runs
  2. strategy
  3. race awareness: gaps, attackers, battles
  4. driver coaching
  5. team play between the two drivers
- **Priority shifts with the race moment.** Near the tyre crossover, in the pit window, under SC/VSC, or after a crash, strategy dominates.
- **Pitwall is read-only.** The engineer advises; the driver changes brake bias, diff, ERS mode and fuel mix in the car. Calls to the driver are therefore decisions too.
- **Tentative layout:**
  - main 24" monitor: strategy and simulations
  - 14" side monitor: car information
  - The final layout waits for this catalogue.

Already found (don't redo, extend):
- **Circle of doom:**
  - Reportedly the McLaren Track Viewer (2001), by a McLaren race-strategy analyst. The name comes from the F1 Manager community. Source: a Reddit claim in an [r/F1Technical thread](https://teddit.bsalzberg.com/r/F1Technical/comments/1j0os9g/is_there_a_live_source_to_a_circular_track_layout).
  - Cars are placed on a circle by time gap; equal distance means equal time.
  - It has a ghost marker for "rejoin if we box now" (current position minus pit loss). Sky Germany shows it on broadcast.
  - Unconfirmed: own car at 12 o'clock.
- **Motorsport.com strategy guide:**
  - Plan A gives a stop lap plus target lap times; Plan B is the fallback.
  - Simulations run constantly; rejoining in clean air is the aim.
  - Source: [Motorsport.com](https://au.motorsport.com/f1/news/how-f1-race-strategy-works/6791895/).
- **F1/AWS Insights:**
  - Undercut Threat: gap, degradation, average pit loss.
  - Battle Forecast: laps until the car behind is within striking distance.
  - Alternative Strategy, and "Strategy Insight" (2026), which gives no concrete values.
  - Source: [Amazon press release](https://press.aboutamazon.com/2021/4/new-f1-insights-powered-by-aws-will-help-formula-1-fans-make-sense-of-split-second-decisions-on-the-track).
- **Simulator Controller (sim racing):**
  - The strategist proposes the stop lap with the least traffic after rejoining, or the undercut lap.
  - It answers "my position in N laps?".
  - Sources: the [AI Race Strategist](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Strategist) and [Strategy Workbench](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/Strategy-Workbench) wiki pages.
- **HH Timing:**
  - A professional timing and strategy tool with **public documentation**, e.g. [gap graph](https://help.hhtiming.com/displays/graphing/gap-graph) and [track gap display](https://help.hhtiming.com/displays/track-gap-display/).
  - **Probably the richest public source.** Go through its display list thoroughly.

Further leads:
- Catapult RaceWatch
- ATLAS (`02`)
- the TUM Virtual Strategy Engineer (`03`)
- interviews with Bernie Collins, Ruth Buscombe and Hannah Schmitz, plus the F1 Explains pieces
- the F1 Manager game's strategy screens: a game's take on the real tools, so a rumour-level source
- iRacing/LMU/ACC strategy and telemetry tools
- the optimization-online pit-stop paper (2026)
- Pi Toolbox and MoTeC for car-care displays

## Output: `docs/research/06-engineer-decisions.md`

Match the style of the existing research files: short sentences, tables, sources linked inline.

1. **How a pit-wall team works:**
   - the roles: race engineer, performance engineer, strategist, ops room
   - who decides what, and how information flows to the person who decides
   - which of these roles the user covers alone, and what that implies
2. **Decision catalogue,** grouped by weekend phase: practice, qualifying, race start, race stint, pit window and SC/VSC, between sessions. One entry per decision:

   | Field | Content |
   |---|---|
   | Decision | e.g. box this lap / next lap / stay out |
   | Question behind it | what you need to know to decide |
   | Computed answer | the result that makes it easy (not raw data) |
   | Display | how to show it (existing display type or a new idea) |
   | Inputs | data and models needed |
   | Source | 🟢 documented · 🟡 rumour / fragment · 🔵 own invention |
   | F1 25 feasibility | ✅ direct · 🔧 derived · 🔒 own car only · ⚠ hidden for restricted human rivals |
   | Escalation | when it becomes tier 1 (colour, alert) |
   | Time to decide | how quickly the engineer must decide, and what can be pre-computed or turned into an alert |

   Candidates; extend as research suggests:
   - box now or later
   - compound choice
   - react to an undercut or overcut
   - box under SC/VSC
   - push or save (tyres, fuel, ERS)
   - attack or defend
   - weather switch
   - calls to adjust the car (brake bias, diff, ERS mode, fuel mix)
   - balance and setup direction in practice
   - long-run programme
   - qualifying release timing and traffic
   - team play between the two drivers (swap, split strategies)
3. **Display catalogue:** every computed display found or invented (the circle of doom and the rest), each with the decisions it serves, its source label, and the data it needs.
4. **Escalation map:** which situations move which decisions to tier 1. This feeds the UI's escalation mechanism: a stable layout, with colour only as a highlight.
5. **Gaps and open questions:** for the user. Bundle them here; don't ask interactively.
6. **Sources.**

Also add a row for `06` to `docs/research/README.md`.

## Rules

- **Write only** `docs/research/06-engineer-decisions.md` and the README row. No code, no other docs.
- **Label every claim** documented, rumour or invention. Never present a rumour as fact.
- **Code licences:** re-implement ideas; never copy LGPL or other licensed code.
- **Quote formulas** where sources give them (as in `03`), because sub-project 4 builds specs from them.

## Done when

The file is complete with all six sections. It is committed with `docs: engineer decision catalogue (research 06)` and the `Co-Authored-By` trailer. Docs only, so committing directly to `main` is fine. Pull first, because another agent may be working in parallel.

## Report

Reply with a short summary: number of decisions, number of displays, the 3–5 most promising computed displays, and the open questions.
