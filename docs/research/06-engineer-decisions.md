# The engineer's decision catalogue

The user is one person doing a whole pit wall's job for two drivers in an online F1 25 league. This file starts from the **decisions** they make over a weekend and works back to the computed answer, the display and the data. It is the content basis for the widgets of sub-projects 3 and 4 and for the mockups in sub-project 2.

Research done on 2026-10-28. It builds on [01](01-race-engineering-practice.md)–[05](05-game-control-boundary.md) and doesn't repeat them.

**Labels used throughout:**

| Label | Meaning |
|---|---|
| 🟢 documented | a public, first-hand source: vendor docs, team or F1 articles, papers |
| 🟡 rumour / fragment | second-hand, unverified, a game's take on the real tools, or a source we could only read through a search summary |
| 🔵 own invention | pitwall's own analysis or display; nobody has been seen doing it this way |
| ✅ direct | F1 25 delivers it as a field |
| 🔧 derived | computed from F1 25 fields |
| 🔒 own car only | only in the driver's own feed (MotionEx, setup); for the second driver it needs their feed |
| ⚠ hidden | zeroed for restricted human rivals ([04](04-f1-25-data-mapping.md)); AI cars and public players are fine |

**Tiers** (used under "Escalation"): **tier 1** = act now, colour and an alert that must be acknowledged; **tier 2** = watch, value visible but grey; **tier 3** = background, on demand.

## 1. How a pit-wall team works

### 1.1 Roles

| Role | Where | What they do | Source |
|---|---|---|---|
| **Race engineer** (one per car) | garage island most of the weekend, pit wall for the race | The only voice on the radio. Passes on strategy, setup changes and mode calls; judges tyre degradation from the wall. | 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/), [01](01-race-engineering-practice.md) |
| **Performance engineer** (one per car) | garage | Telemetry against reference; driver coaching material; setup direction. | 🟢 [01](01-race-engineering-practice.md) |
| **Tyre, aero, PU engineers** | garage, factory | Car-care detail: temperatures, pressures, energy, reliability. | 🟢 [01](01-race-engineering-practice.md) |
| **Trackside strategist** | pit wall | Runs the live plan; "always going to have a GPS window open, showing where the cars would feed out were they to make a pit stop". | 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/), [F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO) |
| **Head of strategy / racing director** | pit wall | Makes the holistic strategy calls, "including splitting strategies or juggling order". | 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/) |
| **Factory strategists** | ops room | McLaren: one overall, **one per car and one who studies rivals**. They run the simulations and sort the incoming data. | 🟢 [F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO), 🟡 [Schmitz interview](https://www.femalesinmotorsport.com/post/hannah-schmitz-red-bull-s-star-strategist-on-baalance-fame-and-staying-true-to-yourself) |
| **Sporting director** | pit wall | Race Control link: penalties, instructions, rule questions. | 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/) |
| **Car operations / chief mechanic** | pit wall, garage | Calls the crew to the box with driver, tyres and wing change; counts down penalties; watches other teams in the pit lane. | 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/) |
| **Team principal** | pit wall | An extra pair of eyes; part of the group that makes rare, major calls. | 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/) |

### 1.2 Who decides, and how information flows

- **Strategy is prepared, not improvised.** Plan A assumes no SC and expected tyre behaviour. The triggers for leaving Plan A are worked out on Saturday night, and drivers are told what "Plan B" means, including the tyre, "so no live calculations are needed". Ruth Buscombe: "doing the maths live during the race normally doesn't work out well"; "Strategy is 98 per cent preparation". 🟢 [F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)
- **SC calls are pre-decided.** China 2018: Red Bull made the call "about five laps earlier"; when the SC came, both drivers pitted with no radio call, about 10 s later. A lap of discussion might have produced a hedged split. 🟢 [F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO). Hannah Schmitz: you usually know what you'll do under an SC before it comes out; on the wall the decision is made **within seconds**. 🟡 [interview](https://www.femalesinmotorsport.com/post/hannah-schmitz-red-bull-s-star-strategist-on-baalance-fame-and-staying-true-to-yourself), [GPFans on Qatar 2025](https://www.gpfans.com/us/f1-news/1069481/red-bull-f1-hannah-schmitz-qatar-gp-strategy/)
- **The flow:** factory analysts and simulations → strategist on the wall → head of strategy decides → race engineer → driver. The driver's feedback goes back up the same chain. Major calls are made by a small group (McLaren: TP, racing director, CEO). 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/)
- **Monte Carlo first, rivals second.** The baseline asks "without interacting with anyone else, what is the fastest way to do this race?". Then come rival pace models, historic SC timing per track, the overtaking threshold (about 1 s/lap even with DRS) and rejoining in clean air. 🟢 [Aston Martin, McCullough](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough)
- **Everyone sees everything.** Telemetry and radio reach every console in real time, from the pit wall to the factory. 🟢 [McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/), [Catapult RaceWatch](https://www.catapult.com/solutions/racewatch)
- **Judge decisions, not outcomes.** Post-race reviews check whether the models matched reality. 🟢 [F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)

### 1.3 What the user covers alone, and what follows

The user is **two race engineers, two performance engineers, the strategist, the head of strategy and the ops room** at once. Only the sporting director's job is mostly left to the game.

What follows for pitwall (🔵, derived from 1.2):
1. **Pitwall is the ops room.** It simulates continuously and shows **computed results, not raw data**: "rejoin P6, 1.2 s behind VER", not a gap table to add up. A display that needs mental arithmetic in a race has failed. It shows **numbers only, no verdicts**: the user draws every conclusion (user, 2026-10-28; see section 5).
2. **Standing answers.** Every time-critical question ("box if SC now?", "where do we rejoin?") has its numbers always up to date *before* the event. The real teams' pre-agreed triggers become armed conditions on screen.
3. **Plans with triggers.** Plan A/B/C and their triggers are prepared between sessions and armed for the race. In the race, pitwall says which trigger fired.
4. **Answers, not scripts.** The only channel to the driver is the user's voice, but the user words the calls themselves: no pre-written radio lines (user, 2026-10-28). The answer must still hold everything a call needs: action, tyre, rejoin position, gap.
5. **Escalate, don't search.** The layout stays stable. The situation decides which few values light up (section 4).
6. **Two cars double every decision**, and add team play and pit stacking (D20, D27). A per-driver focus switch is cheaper than two full layouts.
7. **Glance budget.** The user is also watching the race. Tier-1 answers must be readable in about two seconds.

## 2. Decision catalogue

32 decisions in six phases. Each entry shows its default tier in the heading; escalation can raise it.

### 2.1 Practice

#### D01 · Run programme for the session (tier 2)
| Field | Content |
|---|---|
| Decision | What to run in this session: setup work, quali sim, long runs, which compounds, in which order. |
| Question behind it | What do we still not know for qualifying and the race, and how much track time is left? |
| Computed answer | A **knowledge checklist**: per compound, is base pace known, is degradation fitted (enough clean laps), is fuel burn measured, is pit loss measured? Plus time left versus time needed. |
| Display | Checklist card with traffic-light completeness per item and remaining session time. 🔵 |
| Inputs | Session type and time left, stint history, clean-lap counts per compound, pit-lane timer. |
| Source | 🟢 run plan → session → debrief cycle ([01](01-race-engineering-practice.md)); 🔵 checklist |
| F1 25 feasibility | ✅ session time and type; 🔧 completeness from our own fits |
| Escalation | Tier 1 when time left is less than time needed for a must-have item (e.g. no long run yet with 15 min to go). |
| Time to decide | Minutes. Fully pre-computable; short weekends (one practice) make this the key screen. |

#### D02 · Balance and setup direction (tier 2)
| Field | Content |
|---|---|
| Decision | Which way to move the setup: front/rear wing, diff, ride height, springs, brake bias baseline. |
| Question behind it | Where on the lap is the car limited (entry, mid, exit), and is it understeer or oversteer? |
| Computed answer | **Balance per corner phase**: understeer index (front vs rear slip angle, yaw rate against steering), per corner, against the previous run. Plus driver comment. |
| Display | Corner table (corner × entry/mid/exit) coloured by balance; scatter of understeer index against speed. |
| Inputs | MotionEx slip angles, yaw rate, steering, speed, lap distance, corner list. |
| Source | 🟢 understeer channels and scatter ([01](01-race-engineering-practice.md)); 🔵 corner-phase table |
| F1 25 feasibility | 🔒 own car only (MotionEx); corners 🔧 from the racing line |
| Escalation | Rarely tier 1; tier 1 only when a run's balance swings sharply (damage suspicion). |
| Time to decide | Between runs (minutes). Computed per lap. |

#### D03 · Long-run programme and degradation per compound (tier 2)
| Field | Content |
|---|---|
| Decision | How long to run each compound, and when the long run has told us enough. |
| Question behind it | What is the base pace and degradation of each compound, corrected for fuel, and how sure are we? |
| Computed answer | Per compound: **fitted curve** with base offset `k0`, slope, confidence (laps used, residual σ), and the projected **tyre life** (laps to the cliff or to the game's `m_usableLife`). |
| Display | Stint analysis scatter: lap time against tyre age, one series per stint, fit line, excluded laps greyed; laps can be toggled by hand (HH Timing does this). |
| Inputs | Lap times, stint and tyre age, fuel in tank, clean-lap filter, tyre wear per corner. |
| Source | 🟢 HH Timing degradation and stint analysis ([degradation](https://help.hhtiming.com/calculation-definitions/degradation/), [overviews](https://help.hhtiming.com/displays/overviews/)); 🟢 TUM fit ([03](03-strategy-models.md)) |
| F1 25 feasibility | ✅ lap times and wear; 🔧 fit; rivals' wear ⚠ |
| Escalation | Tier 1 if a compound's degradation differs from the plan's assumption by more than a threshold (plan at risk). |
| Time to decide | Minutes; recomputed each lap. |

**HH Timing degradation filter (🟢):** a linear fit of lap time against lap number per stint. Leave out in-laps, out-laps, SC, VSC, FCY and **laps slower than 120 % of the stint average**. TUM's filter ([03](03-strategy-models.md)) also drops the first two race laps and fits a quadratic.

#### D04 · Tyre set allocation (tier 3)
| Field | Content |
|---|---|
| Decision | Which sets to use in practice and which to keep for qualifying and the race. |
| Question behind it | Which sets do we need fresh for the race plan, and which plans does the remaining allocation still allow? |
| Computed answer | **Feasible plans** given the sets left (e.g. "two-stop S-M-M needs two fresh mediums: 1 left"). Per set: wear, `m_lifeSpan`, `m_lapDeltaTime`. |
| Display | Set inventory grid with per-plan check marks. 🔵 |
| Inputs | TyreSets packet (available, wear, life span, usable life, lap delta), plan list. |
| Source | 🔵 |
| F1 25 feasibility | ✅ own car (TyreSets); ⚠ none for restricted rivals |
| Escalation | Tier 1 only if the remaining sets make the planned race strategy impossible. |
| Time to decide | Before each run. Pre-computed. |

#### D05 · Race fuel load (tier 3)
| Field | Content |
|---|---|
| Decision | How much fuel to start with (if the league settings let the player choose). |
| Question behind it | How much fuel does the race need at our burn rate, with an SC allowance, and what does each kg cost per lap? |
| Computed answer | `fuel_start = laps · burn_green − expected_SC_laps · burn_green · (1 − f_SC) + reserve`, and the lap-time cost `0.03 s/kg` (track-dependent; TUM Spielberg 0.019). |
| Display | Fuel slider with laps of margin and race-time cost. 🔵 |
| Inputs | Burn per lap from practice, laps, SC probability, fuel sensitivity. |
| Source | 🟢 the 2026 MILP model treats fuel load as a decision ([Avella et al.](https://optimization-online.org/2026/02/a-simulation-framework-for-formula-1-race-strategy-based-on-pit-stop-optimization/)); 🟢 HH Timing SC fuel factor ([track item](https://help.hhtiming.com/settings-options/track-item-ghosts/)); 🔵 formula |
| F1 25 feasibility | 🔧 burn from `m_fuelInTank`; whether the player can set race fuel is **unverified** (open question) |
| Escalation | Tier 3. |
| Time to decide | Between sessions. |

#### D06 · Coaching from practice: where the time goes (tier 2)
| Field | Content |
|---|---|
| Decision | What to tell each driver to change: braking points, lines, gear, throttle application. |
| Question behind it | Where, corner by corner, does the driver lose time to the teammate, the fastest car, or their own best? |
| Computed answer | **Time lost per corner** against a chosen reference, sorted by size; the top three with the likely cause (braked earlier, lower minimum speed, later throttle). |
| Display | Delta trace in distance mode plus a ranked corner-loss list. |
| Inputs | Lap distance, speed, throttle, brake, gear, steering for both laps; corner list. |
| Source | 🟢 delta channel and overlays ([01](01-race-engineering-practice.md), [02](02-atlas-interaction-model.md)), HH Timing GPS coast and brake points ([GPS speed](https://help.hhtiming.com/displays/graphing/gps-speed/)); 🔵 ranked list with cause |
| F1 25 feasibility | ✅ all cars' telemetry, so rival laps can be the reference |
| Escalation | Tier 2; never tier 1. |
| Time to decide | After the run (minutes). Pre-computed per lap. |

### 2.2 Qualifying

#### D07 · Release time and traffic gap (tier 1 in Q)
| Field | Content |
|---|---|
| Decision | When to send the driver out (or start the push lap) so the flying lap is clean. |
| Question behind it | If we leave now, who will be around us on the flying lap, and will we have time for the laps we plan before the flag? |
| Computed answer | A **release clock**: the next windows (in seconds from now) in which the projected flying lap has no car within X s, and the latest release time that still allows N flying laps. |
| Display | Track map with **gap finder**: projected position of every car at the start of our push lap; free windows on a time strip. |
| Inputs | Position and speed of all cars, their driver status (out lap, flying, in lap), session time left, out-lap time. |
| Source | 🟢 HH Timing uses the GPS track map in qualifying "to find a sufficient gap on track" ([full track](https://help.hhtiming.com/displays/track-maps/full-track/)); 🟢 virtual finish car ([full track](https://help.hhtiming.com/displays/track-maps/full-track/)); 🔵 release clock |
| F1 25 feasibility | ✅ all cars' position, `m_driverStatus`, session time; 🔧 projection |
| Escalation | Tier 1 for the 30–60 s before a window opens; one-shot qualifying makes it the main screen. |
| Time to decide | Seconds. The windows are pre-computed continuously. |

#### D08 · Continue, abort or go again (tier 1 in Q)
| Field | Content |
|---|---|
| Decision | Abort the lap, keep pushing, or do another run; save the set or not. |
| Question behind it | Will this lap be good enough to get through, and is there time to start one more lap before the flag? |
| Computed answer | **Projected lap time** and projected position against the elimination cut-off; whether the car will cross the line before the flag. |
| Display | Projected-lap row (HH "Proj Time", "Proj Gap") plus a cut-off line; virtual finish car on the map. |
| Inputs | Sector times, best sectors, cut-off position, lap invalid flag, session time. |
| Source | 🟢 HH Timing projected lap time ([projected lap time](https://help.hhtiming.com/calculation-definitions/projected-lap-time/)) and virtual finish car; 🔵 cut-off projection |
| F1 25 feasibility | ✅ sectors, `m_currentLapInvalid`; 🔧 micro-sectors for an earlier projection |
| Escalation | Tier 1 when the projection drops below the cut-off or the lap is invalidated. |
| Time to decide | Seconds, mid-lap. |

**HH projected lap time (🟢), three modes:**
- *Best sectors:* completed sectors of this lap + the car's best remaining sectors.
- *%diff to best:* `δ = (Σ done − Σ best_done) / Σ best_done`; projected = done + Σ best_remaining · (1 + δ).
- *Best lap:* completed sectors + the remaining sectors of the car's fastest lap.

The virtual finish car (🟢) runs at the average lap time and crosses the line exactly when the clock reaches zero. A car ahead of it gets another lap; a car behind it doesn't.

### 2.3 Race start

#### D09 · Final plan check on the grid (tier 2)
| Field | Content |
|---|---|
| Decision | Keep Plan A, or switch to B before the start (start tyre, stop count). |
| Question behind it | Has anything changed since the plan was made: weather, track temperature, rivals' start tyres, grid positions? |
| Computed answer | **Plan delta:** the predicted race time of A/B/C re-run with the actual grid and rivals' start compounds; flags if B is now better. |
| Display | Plan board (V17) with the "changed since Saturday" list. |
| Inputs | Grid, rivals' fitted compounds, weather forecast, track temperature, plans. |
| Source | 🟢 Saturday-night simulation from quali positions ([F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)); 🔵 plan delta |
| F1 25 feasibility | ✅ grid, compounds, forecast samples |
| Escalation | Tier 1 if the forecast or rivals' tyres flip the ranking of plans. |
| Time to decide | Minutes (formation). Pre-computed. |

#### D10 · Damage: box for repairs or carry on (tier 1 when damaged)
| Field | Content |
|---|---|
| Decision | Pit now for a new front wing, or run on with the damage. |
| Question behind it | How much time does the damage cost per lap, against the extra pit loss and the place loss? |
| Computed answer | **Break-even:** `laps_remaining · Δt_damage` against `L_pit + t_wing − (stop already planned ? L_pit : 0)`. If the planned stop is close, bring it forward. |
| Display | Damage card: damage %, measured lap-time loss since the hit, break-even laps. |
| Inputs | Wing, floor, diffuser, sidepod damage; lap times before and after; pit loss table; time for a wing change. |
| Source | 🟢 Simulator Controller "Impact" repair rule: repair if lap time is slower than the reference by more than a threshold, with the reference = mean + σ of the current stint ([AI Race Engineer](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Engineer)); 🔵 break-even formula |
| F1 25 feasibility | ✅ own and AI damage; ⚠ for restricted rivals; wing-change time 🔧 from recordings |
| Escalation | Tier 1 on any new damage (Collision event or damage jump). |
| Time to decide | One lap, often less: the pit entry may be close. Show the break-even immediately, using the game's damage % until lap times confirm it. |

### 2.4 Race stint

#### D11 · Push or save tyres (tier 2, car care)
| Field | Content |
|---|---|
| Decision | Tell the driver to push, hold a target pace, or manage the tyres. |
| Question behind it | At this pace, do the tyres last to the planned stop lap, and what pace gives the best total time to the stop? |
| Computed answer | **Projected wear at the planned stop** per corner and a **target lap time** (or delta) that keeps the worst corner below the limit. |
| Display | Tyre life bar per corner (now, projected at stop, limit) plus a target lap time against the last laps. |
| Inputs | Wear per corner and its rate, surface and carcass temperatures, planned stop lap, degradation fit. |
| Source | 🟢 Plan A comes with "target lap times" ([Motorsport.com](https://au.motorsport.com/f1/news/how-f1-race-strategy-works/6791895/)); 🟢 Simulator Controller changes tyres when expected wear at the end of the next stint exceeds a limit ([AI Race Engineer](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Engineer)); 🟡 F1 game guides advise changing before 65–75 % wear ([SimRacingSetup](https://simracingsetup.com/ea-sports-f1/f1-25-race-strategy-guide/)); 🔵 target pace |
| F1 25 feasibility | ✅ own wear and temperatures; ⚠ rivals' wear |
| Escalation | Tier 1 when the projected wear at the planned stop crosses the limit, or a tyre leaves its temperature band for several corners. |
| Time to decide | A lap or two; recomputed each lap. |

#### D12 · Fuel: save or spend (tier 2, car care)
| Field | Content |
|---|---|
| Decision | Lift and coast or lean mix to save fuel, or richer mix to attack. |
| Question behind it | Do we reach the finish at this burn, with what margin, and how much must be saved per lap? |
| Computed answer | `margin_laps = fuel / burn_avg − laps_remaining`; if negative: **save target per lap** `= (laps_remaining · burn_avg − fuel) / laps_remaining`. Under SC/VSC the burn drops (TUM: ×0.25 / ×0.5), so the margin grows. |
| Display | Fuel delta gauge (+/− laps), save target in kg/lap and as a lift-and-coast hint. |
| Inputs | `m_fuelInTank`, burn per lap (clean laps), laps remaining, fuel mix, SC state. |
| Source | 🟢 Simulator Controller warns at 3 laps of fuel left and suggests saving a lap or two ([AI Race Engineer](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Engineer), [AI Race Strategist](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Strategist)); 🟢 TUM SC factors ([03](03-strategy-models.md)); 🔵 save target |
| F1 25 feasibility | ✅ `m_fuelInTank`, `m_fuelRemainingLaps` (the MFD value), `m_fuelMix`; ⚠ for restricted rivals |
| Escalation | Tier 1 when the margin goes negative beyond what one SC lap would recover. |
| Time to decide | Several laps; fully pre-computed. |

#### D13 · ERS mode (tier 2)
| Field | Content |
|---|---|
| Decision | Which deploy mode: none (harvest), medium, hotlap, overtake; when to bank energy for an attack or defence. |
| Question behind it | How much energy do we have, how much does the next attack or defence need, and when must it be ready? |
| Computed answer | **Energy plan:** store now, deployed this lap against the per-lap limit, and laps needed to recharge to the attack level before the predicted DRS range (D17). |
| Display | ERS budget bar (store, this lap's deploy, reserve line) plus "ready to attack in N laps". |
| Inputs | `m_ersStoreEnergy`, `m_ersDeployedThisLap`, harvest MGU-K/H, deploy mode, battle forecast. |
| Source | 🟢 the 2026 MILP model plans ERS per sector and keeps a **40 % battery margin** for defence until the last laps ([Avella et al.](https://optimization-online.org/2026/02/a-simulation-framework-for-formula-1-race-strategy-based-on-pit-stop-optimization/)); 🟡 F1 25 modes and per-lap deploy limit ([Traxion](https://traxion.gg/f1-25-ers-explained/)); 🔵 attack readiness |
| F1 25 feasibility | ✅ own and AI; ⚠ for restricted rivals |
| Escalation | Tier 1 when a battle is predicted within 2 laps and the store is below the attack level, or at an SC restart (D29). |
| Time to decide | A lap. |

#### D14 · Brake bias call (tier 2, car care)
| Field | Content |
|---|---|
| Decision | Tell the driver to move brake bias forward or back. |
| Question behind it | Are the fronts or rears locking, are the brake temperatures unbalanced, has the fuel load or tyre state shifted the balance? |
| Computed answer | **Lock-up count per axle and corner** (slip ratio spikes under braking) and the front/rear brake temperature split. After the call: **confirmation** that the value changed. |
| Display | Lock-up table per corner plus the call → confirmation log (V24). |
| Inputs | Slip ratio per wheel, brake pedal, brake temperatures, `m_frontBrakeBias`. |
| Source | 🟢 race engineers pass on brake-balance changes ([01](01-race-engineering-practice.md)); 🟢 call confirmation idea ([05](05-game-control-boundary.md)); 🔵 lock-up count |
| F1 25 feasibility | 🔒 slip ratio (MotionEx); ✅ brake bias for own car; ⚠ rivals |
| Escalation | Tier 1 on repeated lock-ups in the same corner (flat-spot risk). |
| Time to decide | A lap or two. |

#### D15 · Differential call (tier 3, car care)
| Field | Content |
|---|---|
| Decision | Suggest on-throttle (and off-throttle) diff changes. |
| Question behind it | Is the car losing traction on exits (wheelspin) or rotating badly at entry? |
| Computed answer | **Wheelspin count per corner exit** (rear slip ratio under throttle) and entry rotation, against the current diff value. |
| Display | Corner table plus the confirmation log. |
| Inputs | Rear slip ratio, throttle, yaw rate, `m_onThrottle`/`m_offThrottle`. |
| Source | 🔵 |
| F1 25 feasibility | 🔒 MotionEx and setup (diff in CarSetups) |
| Escalation | Tier 2 when wheelspin rises with rear wear. |
| Time to decide | Laps. |

#### D16 · Temperature and wear alarms (tier 2, car care)
| Field | Content |
|---|---|
| Decision | Warn and coach the driver: cool the tyres, manage the brakes, short-shift, avoid kerbs. |
| Question behind it | Is any corner of the car outside its operating window, and is it getting worse? |
| Computed answer | **Band state per channel** (cold / OK / hot) with a trend arrow; blisters, PU wear and engine temperature against limits. |
| Display | Corner block (four corners: surface, carcass, pressure, brake, wear) in grey, coloured only out of band; alarm list with acknowledge. |
| Inputs | Tyre surface and inner temperatures, pressures, brake temperatures, wear, blisters, engine temperature, PU wear. |
| Source | 🟢 ATLAS alarms and threshold displays ([02](02-atlas-interaction-model.md)); 🟢 Simulator Controller pressure-loss rule: deviation above the average deviation plus one σ ([AI Race Engineer](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Engineer)); 🟡 F1 25 temperature windows per compound from a community guide ([SimRacingSetup](https://simracingsetup.com/ea-sports-f1/f1-25-tyre-guide/)), not reliable |
| F1 25 feasibility | ✅ own car; rivals' tyre and brake temperatures stay visible even when restricted ([04](04-f1-25-data-mapping.md)) |
| Escalation | Tier 1 for blisters, a puncture (pressure drop) or a temperature out of band for a whole lap. |
| Time to decide | Seconds to a lap. Alarms are rules over the stream. |

#### D17 · Attack, defend or let go (tier 2, race awareness)
| Field | Content |
|---|---|
| Decision | Tell the driver to attack the car ahead, defend, or not waste tyres on a fight that costs more than it gains. |
| Question behind it | Will we catch them, when, can we pass, and what does fighting cost against the strategy? |
| Computed answer | **Battle forecast:** `laps_to_range = (gap − 1.0 s) / (t_ahead − t_us)` when positive; **pass feasibility:** our pace advantage against the threshold (TUM: 2.01 s pace advantage in real F1; McCullough: about 1 s/lap with DRS; F1 25 value unknown, calibrate). Same for the car behind. |
| Display | Battle cards ahead and behind: gap, closing rate, laps to DRS range, pass feasibility, their tyre age and compound. |
| Inputs | Gaps, lap times (assumed pace), tyre age and compound, DRS state, top speeds. |
| Source | 🟢 F1/AWS "Battle Forecast" ([Amazon](https://press.aboutamazon.com/2021/4/new-f1-insights-powered-by-aws-will-help-formula-1-fans-make-sense-of-split-second-decisions-on-the-track)); 🟢 HH Timing time-to-catch and catch line ([gap track](https://help.hhtiming.com/displays/track-maps/gap-track/)); 🟢 overtaking thresholds ([03](03-strategy-models.md), [Aston Martin](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough)); 🔵 formula |
| F1 25 feasibility | ✅ gaps, lap times, compounds, DRS; ✅ rivals' timing even when restricted |
| Escalation | Tier 1 when a car is predicted in DRS range within 2 laps, or the car behind closes faster than 0.03 s/s (HH blue-flag rule, adapted). |
| Time to decide | Laps; continuously pre-computed. |

**HH Timing closing-car rule (🟢):** a car is flagged when the gap is under a threshold and the closing rate is above 0.03 s per second, i.e. 3.6 s per lap on a 120 s lap. HH uses it for blue flags between classes; pitwall can use a lower rate for "the car behind is coming".

#### D18 · Penalties and warnings (tier 2)
| Field | Content |
|---|---|
| Decision | Warn the driver about track limits; decide when to serve a penalty (at the stop or not). |
| Question behind it | How close is the driver to the next penalty, and how does a time penalty change the rejoin and finish? |
| Computed answer | **Warnings left** before the next penalty; the penalty added to the pit loss in every rejoin and finish projection. |
| Display | Badge on the timing row and in the rejoin ghost. |
| Inputs | `m_totalWarnings`, `m_cornerCuttingWarnings`, `m_penalties`, Penalty events. |
| Source | 🟢 car operations counts down penalties ([McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/)); 🔵 penalty-aware ghost |
| F1 25 feasibility | ✅ |
| Escalation | Tier 1 one warning before a penalty, or on a new penalty. |
| Time to decide | Immediately (warn on the next straight). |

#### D19 · Coaching mid-race (tier 3, coaching)
| Field | Content |
|---|---|
| Decision | Tell the driver where they're losing time to the car ahead or behind. |
| Question behind it | In which corner is the rival faster this stint, and is it driving or tyres? |
| Computed answer | **Per-corner delta** against the car ahead over the last 3 laps, sorted; repeated losses only. |
| Display | Ranked corner-loss list (same as D06, live). |
| Inputs | All cars' telemetry and lap distance. |
| Source | 🟢 ([01](01-race-engineering-practice.md)); 🔵 live ranking |
| F1 25 feasibility | ✅ all cars |
| Escalation | Tier 2 when stuck behind a car for 3+ laps. |
| Time to decide | Laps. |

#### D20 · Team play: swap, hold, or free the faster car (tier 2, team play)
| Field | Content |
|---|---|
| Decision | Swap the two drivers, hold positions, or let the teammate through to attack. |
| Question behind it | Is the car behind faster, can it actually catch the car ahead, and what does the swap cost the team? |
| Computed answer | **Swap value:** pace delta between the teammates, laps for the rear car to reach the car ahead after a swap, the swap cost (about 0.5–1 s), and the team's projected points with and without. |
| Display | Team card: both cars side by side, pace delta, swap gain. |
| Inputs | Both cars' lap times, gaps, tyres, battle forecast, points table. |
| Source | 🟢 juggling order and splitting strategies are head-of-strategy calls ([McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/)); 🔵 swap value |
| F1 25 feasibility | ✅ timing of both cars in each feed |
| Escalation | Tier 1 when the teammates run within 1.5 s with a pace delta above a threshold for 3+ laps. |
| Time to decide | Laps. |

### 2.5 Pit window and SC/VSC

#### D21 · Box this lap, next lap, or stay out (tier 1 in the window)
| Field | Content |
|---|---|
| Decision | The core call. |
| Question behind it | Where do we rejoin, into what traffic, and does stopping now beat stopping later? |
| Computed answer | **Rejoin ghost:** `gap_ghost = gap_now + L_pit(condition) + penalty`, giving the rejoin position and the gaps to the cars around it. **Pit-lap sweep:** for each lap in the window, the rejoin position, the traffic in the first 3 laps out and the projected finish time. |
| Display | Circle of doom (V01) with the ghost; live crossing order with ghosts (V03); pit-lap sweep strip (V15). |
| Inputs | Gaps of all cars, pit loss table (green/VSC/SC, per track), assumed pace, degradation model, planned stops of rivals. |
| Source | 🟢 HH Timing ghosts ([track item](https://help.hhtiming.com/settings-options/track-item-ghosts/), [live crossing order](https://help.hhtiming.com/displays/scoreboards/live-crossing-order-scoreboard/)); 🟢 McLaren strategist's GPS feed-out window ([McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/)); 🟢 Simulator Controller picks the lap with the least traffic after rejoining ([AI Race Strategist](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Strategist)); 🟡 circle of doom; 🔵 sweep strip |
| F1 25 feasibility | ✅ gaps and positions; 🔧 pit loss per track from recordings; ✅ the game's own `m_pitStopRejoinPosition` as a cross-check |
| Escalation | Tier 1 from 2 laps before the planned stop, and whenever another trigger (D23, D24, D25, D26) fires. |
| Time to decide | Before the pit entry: the last sector. The call must be ready by the start of the in-lap. |

**HH Timing ghost offsets (🟢):**
- *Basic:* a fixed offset per stop type behind the car's current position.
- *Custom:* `offset = Offset + N_laps_in_stint · Multiplier + N_laps_in_stint · refuel_rate + StopGo_pit_loss`.
- For F1 without refuelling this becomes: `ghost = L_pit(green|VSC|SC) + t_extra`, where `t_extra` is a front-wing change or a penalty served at the stop (🔵).
- HH's live crossing order lists the ghost between real cars with the gap to the car ahead and behind ("lands 0.6 s behind car 32, 0.8 s ahead of car 61"). HH also uses **in-lap and out-lap ratios** (in-lap time / average green lap; out-lap time / average green lap) in its finish projection.

#### D22 · Compound for the next stint, and stops left (tier 1 in the window)
| Field | Content |
|---|---|
| Decision | Which tyre to fit; stay on the one-stop or switch to two stops. |
| Question behind it | Which compound gets us to the end (or the next stop) fastest, given the sets left and the laps remaining? |
| Computed answer | **Remaining-race optimiser:** for each compound sequence that is legal (two dry compounds) and possible with the sets left, the projected finish time and position; the best and the gap to the second best. |
| Display | Strategy comparison table (V16): rows = sequences, columns = stop laps, finish time, position, risk. |
| Inputs | Degradation per compound (own fits plus the game's `m_lapDeltaTime`), sets left, laps left, pit loss, SC probability. |
| Source | 🟢 TUM: with no opponents the optimum is a quadratic optimisation; with them, simulation ([03](03-strategy-models.md)); 🟢 the 2026 MILP model, solved in under 0.3 s ([Avella et al.](https://optimization-online.org/2026/02/a-simulation-framework-for-formula-1-race-strategy-based-on-pit-stop-optimization/)); 🟢 Simulator Controller revises the strategy after an unplanned stop ([AI Race Strategist](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Strategist)) |
| F1 25 feasibility | ✅ own sets; 🔧 fits; ⚠ rivals' sets |
| Escalation | Tier 1 when the best sequence changes (e.g. two stops now beat one). |
| Time to decide | Seconds at the stop; the ranking is recomputed every lap so the answer is ready. |

**2026 MILP model (🟢 [Avella et al.](https://optimization-online.org/2026/02/a-simulation-framework-for-formula-1-race-strategy-based-on-pit-stop-optimization/)):** it minimises `Z = t_start + Σ_g Σ_s t_eff_g · x_g,s + t_pit · (Σ_s a_s − 1) + Z_fuel + Z_ERS`, where `x_g,s` is the laps on compound `g` in stint `s`, and `t_eff_g = t_base_g · (1 + δ_g · μ_perf_g / 2)` is the average degraded lap time. Stints are capped at `d_eff_g = d_max_g · (1 − δ_g · d_max_g · μ_dur_g / 2)`, and at least two compounds are required. **The authors gathered their parameters from F1 25 practice sessions.** At COTA their 1-stop beat the game's default 2-stop by 7.79 s. It is a deterministic baseline with no SC, rain or rivals; the authors call those future work.

#### D23 · Undercut, cover, or overcut (tier 1 in the window)
| Field | Content |
|---|---|
| Decision | Pit early to undercut the car ahead; pit to cover the car behind that just stopped; or stay out for the overcut. |
| Question behind it | If we pit now and they pit N laps later, who is ahead after their stop? |
| Computed answer | **Undercut balance:** `Δ(N) = Σ_{k=1..N} [t_rival(old tyres, age + k) − t_us(new tyres, k)] − t_cold − (L_pit_us − L_pit_rival)`. The undercut works if `Δ(N) > gap + 0.5 s` (TUM minimum gap). The overcut is the same sum with the roles swapped. For the threat from behind, the same with the rival as "us". |
| Display | Undercut card per neighbour (ahead and behind): gap, Δ for N = 1, 2, 3, the margin over the gap; on the circle the rival's ghost too. |
| Inputs | Degradation model of both cars, tyre ages, cold-tyre penalty (TUM: +1.0 s on the first lap), pit loss, gaps; whether the car behind has just pitted. |
| Source | 🟢 F1/AWS "Undercut Threat" from gap, degradation and average pit loss ([Amazon](https://press.aboutamazon.com/2021/4/new-f1-insights-powered-by-aws-will-help-formula-1-fans-make-sense-of-split-second-decisions-on-the-track)); 🟢 TUM's input "has the car behind just pitted" ([03](03-strategy-models.md)); 🟢 the overcut works with clean air and low degradation ([Aston Martin](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough)); 🔵 formula |
| F1 25 feasibility | ✅ tyre ages, compounds, gaps for all; ⚠ rivals' wear, so their degradation comes from lap times |
| Escalation | Tier 1 when a car within undercut range (Δ(1) > gap) pits, or when our own undercut becomes positive. |
| Time to decide | The cover call must come on the lap the rival pits, before our pit entry: often under 30 s. |

#### D24 · Box under the safety car (tier 1 under SC)
| Field | Content |
|---|---|
| Decision | Pit under the SC, or stay out for track position. |
| Question behind it | How much cheaper is a stop now, where do we rejoin in the queue, and who else will stop? |
| Computed answer | **SC stop value:** `gain = L_pit_green − L_pit_SC` (track-specific: Catalunya 19.0 → 7.9 s, Melbourne 17.9 → 12.6 s); the rejoin position in the queue; the rivals for whom the same stop is free (in their window, old tyres). **Standing numbers during green running:** "SC now: gain 11.2 s, rejoin P7". |
| Display | SC card (V18), visible all race as a single line, expanding when the SC is deployed. |
| Inputs | SC status and phase events, pit loss table per condition, gaps, rivals' tyre ages and planned stops, laps left. |
| Source | 🟢 TUM pit loss table and SC model ([03](03-strategy-models.md)); 🟢 Red Bull's pre-decided SC stops ([F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)); 🟢 SCs come most often at the start and around pit stops ([Aston Martin](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough)); 🔵 standing answer |
| F1 25 feasibility | ✅ `m_safetyCarStatus`, SafetyCar events, `m_safetyCarDelta`; 🔧 SC pit loss from recordings (none yet) |
| Escalation | Tier 1 the moment the SC is deployed. |
| Time to decide | Seconds: if the car is near the pit entry, before it passes it. Hence the standing answer. |

**HH Timing under SC (🟢):** the gap map stops estimating between timing lines under an SC and keeps the gaps constant. HH marks stops made under SC/VSC/FCY with brackets and leaves them out of the average pit-stop time ([pit stop scoreboard](https://help.hhtiming.com/displays/scoreboards/pit-stop-scoreboard/), [pit stop length](https://help.hhtiming.com/calculation-definitions/pit-stop-length/)).

#### D25 · Box under the VSC (tier 1 under VSC)
| Field | Content |
|---|---|
| Decision | Pit under the VSC, or stay out. |
| Question behind it | Same as D24, but the field keeps its gaps and the VSC may end before we are out of the pits. |
| Computed answer | **VSC stop value:** `gain = L_pit_green − L_pit_VSC` (Monza 20.6 → 15.4 s), the rejoin position with the gaps frozen, and the risk that the VSC ends mid-stop (then the gain falls towards zero). |
| Display | SC card in VSC mode. |
| Inputs | As D24, plus the VSC's elapsed time. |
| Source | 🟢 TUM ([03](03-strategy-models.md)); 🟢 a VSC pit call ignored by the driver in Singapore 2026 shows how fast this call must be passed on ([Sky Sports](https://www.skysports.com/f1/news/13602364/lewis-hamilton-ferrari-driver-explains-taking-strategy-into-own-hands-in-singapore-ahead-of-united-states-gp)); 🔵 VSC-end risk |
| F1 25 feasibility | ✅ VSC status; 🔧 VSC pit loss from recordings |
| Escalation | Tier 1 when the VSC is deployed. |
| Time to decide | Seconds. |

#### D26 · Weather switch (tier 1 when rain is near)
| Field | Content |
|---|---|
| Decision | Slicks → inters, inters → slicks, inters ↔ wets; and when. |
| Question behind it | Is the other tyre faster yet, and will it stay faster for long enough to pay for the stop? |
| Computed answer | **Crossover monitor:** our lap time against the dry reference (Pirelli: inters when slicks reach **110–112 %** of the dry time, about +10 s on a 90 s lap); the lap times of cars already on the other tyre; the forecast rain % for the next samples; the payback laps of the stop. |
| Display | Crossover chart (V19): lap times of the field by tyre type, the 110 % line, the forecast strip. |
| Inputs | Lap and sector times by tyre type for the whole field, weather and forecast samples, rain %, track temperature. |
| Source | 🟢 Pirelli crossover rule ([Pirelli](https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/when-it-s-time-to-change-from-slick-to-wet-tyres-in-formula-1-52943/)); 🟢 the first car to switch is the test case for everyone else ([Motor Sport](https://motorsportmagazine.com/archive/article/december-2022/36/switching-from-inters-to-slicks-the-crucial-strategic-tyre-call-in-f1-wet-races)); 🟢 driver feedback, rivals' lap times and radar ([Aston Martin](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough)); 🔵 payback laps |
| F1 25 feasibility | ✅ forecast samples with rain %, weather, compound of every car, sector times |
| Escalation | Tier 1 when the forecast rain % passes a threshold within the next samples, or when a car on the other tyre goes faster than us in a sector. |
| Time to decide | A lap or two. |

#### D27 · Split strategies and stacking for the two drivers (tier 2, team play)
| Field | Content |
|---|---|
| Decision | Put the two cars on different plans to cover both outcomes; decide who stops first; stack both in the same lap. |
| Question behind it | Does splitting raise the team's expected points, and does the second car lose more by waiting in the box than by stopping a lap later? |
| Computed answer | **Team outcome table:** expected positions of both cars for "same plan", "split" and "stack"; the stacking cost (the second car's wait). |
| Display | Team card (with D20). |
| Inputs | Both cars' plans, gaps between them, pit loss, the stationary time of a stacked stop (unknown in F1 25). |
| Source | 🟢 splitting strategies is a head-of-strategy call ([McLaren 2026](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/)); 🟢 deliberating too long tends to produce a hedged split ([F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)); 🔵 table |
| F1 25 feasibility | ✅ both cars' timing; whether F1 25 lets two human teammates stack, and at what cost, is **unknown** (open question) |
| Escalation | Tier 1 when both cars are in the window in the same lap or an SC triggers both. |
| Time to decide | Laps for the split; seconds for stacking under an SC. |

#### D28 · Red flag: tyres for the restart (tier 1 under red)
| Field | Content |
|---|---|
| Decision | Which tyres to fit during the red flag, and the plan for the rest of the race. |
| Question behind it | With a free tyre change, which compound minimises the remaining race time, and does it fulfil the two-compound rule? |
| Computed answer | The D22 optimiser re-run with `L_pit = 0` for this change. |
| Display | Strategy comparison table with the red-flag case. |
| Inputs | As D22, red-flag state. |
| Source | 🔵 (real F1 allows tyre changes under a red flag; F1 25's handling is unverified) |
| F1 25 feasibility | ✅ `m_numRedFlagPeriods`, Red Flag event; tyre change rules **unverified** |
| Escalation | Tier 1 at the red flag. |
| Time to decide | Minutes (the cars are stopped). |

#### D29 · SC restart preparation (tier 1 at "SC in this lap")
| Field | Content |
|---|---|
| Decision | Tell the driver: charge the battery, warm the tyres and brakes, the gap to keep, who is behind on which tyres. |
| Question behind it | Who can attack us at the restart, and are we ready to defend or attack? |
| Computed answer | **Restart sheet:** ERS store against the attack level, tyre and brake temperatures against their bands, the cars ahead and behind with tyre age and compound, DRS enabled after 2 laps. |
| Display | Restart card under the SC card. |
| Inputs | SC phase events (Returning), ERS, temperatures, neighbours' tyres. |
| Source | 🟢 DRS off for 2 laps after an SC ([03](03-strategy-models.md)); 🔵 restart sheet |
| F1 25 feasibility | ✅ SafetyCar phases; ✅ own ERS and temperatures |
| Escalation | Tier 1 at "SC returning". |
| Time to decide | Within the last SC lap. |

### 2.6 Between sessions

#### D30 · Setup change for the next session (tier 3)
| Field | Content |
|---|---|
| Decision | Keep or change the setup; with parc fermé, the last chance before qualifying. |
| Question behind it | Did the last change help (driver comment, balance, lap time), and is the car better for qualifying or the race? |
| Computed answer | **Before/after comparison** of the balance table, lap time and tyre temperatures for the runs before and after each setup change. |
| Display | Setup history with the per-change comparison. |
| Inputs | CarSetups per run, D02 balance, D03 fits. |
| Source | 🟢 keep or revert changes after each run ([01](01-race-engineering-practice.md)); 🟢 circuits ranked by how much qualifying matters against race pace ([Aston Martin](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough)); 🔵 comparison |
| F1 25 feasibility | 🔒 own setup only; ✅ `m_parcFermeRules` |
| Escalation | Tier 3. |
| Time to decide | Minutes between sessions. |

#### D31 · Race plan with triggers (tier 3)
| Field | Content |
|---|---|
| Decision | Plan A, B and C for each driver, with the trigger for each switch. |
| Question behind it | What is the fastest race alone, what changes it (SC lap ranges, degradation off, rain), and what do we do in each case? |
| Computed answer | **Plan set:** each plan with stop laps, compounds, target lap times and the predicted race time; for each SC lap range, the pre-decided "box / stay"; with Monte Carlo later, the spread of finishing positions per plan. |
| Display | Plan board (V17) in edit mode; strategy comparison (V16). |
| Inputs | Fits from practice, pit loss table, grid, SC setting (`m_safetyCar`) and the probabilities that follow from it, weather forecast. |
| Source | 🟢 Monte Carlo first, then rivals ([Aston Martin](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough)); 🟢 Saturday-night plans with triggers and messages ([F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)); 🟢 TUM Monte Carlo ([03](03-strategy-models.md)) |
| F1 25 feasibility | 🔧 from our own fits |
| Escalation | Tier 3; its triggers drive the race escalations. |
| Time to decide | Hours or minutes (the short format may leave only minutes). |

#### D32 · Debrief and model calibration (tier 3)
| Field | Content |
|---|---|
| Decision | What to tell the drivers, which model parameters to update, which decisions were wrong. |
| Question behind it | Did the models match reality (pit loss, degradation, fuel), and were the decisions right given what we knew? |
| Computed answer | **Model error table:** predicted against actual per parameter; **decision review:** each call with what pitwall showed at the time. |
| Display | Review page (replay of the race with the decision log). |
| Inputs | Recordings, decision and call log, model snapshots. |
| Source | 🟢 judge decisions, not outcomes ([F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)); 🟢 HH Timing "show future laps" to check the settings of its own finish calculation ([car scoreboard](https://help.hhtiming.com/displays/scoreboards/car-scoreboard/)); 🔵 decision review |
| F1 25 feasibility | ✅ recordings and replay |
| Escalation | Tier 3. |
| Time to decide | After the session. |

## 3. Display catalogue

| # | Display | What it shows | Serves | Source | Data |
|---|---|---|---|---|---|
| V01 | **Circle of doom** | All cars placed on a circle **by time gap** (equal distance = equal time); ghost markers for "rejoin if we box now", one per pit loss condition | D21, D23, D24, D25 | 🟡 the McLaren Track Viewer (2001): its author, a former McLaren race strategist, describes on LinkedIn gaps on a circle ("equal distance equals equal time"), a black background, driver labels round the edge, sector split markers and a marker for where the car comes out after a stop, and says the engineer on Piastri's car used a very similar display at the 2025 Belgian GP (read only through a search summary; the profile blocks direct access); 🟡 a Motorsport.com article on McLaren's mission control says the circle is kept deliberately simple to show how many seconds separate the cars, and that it shows when a pit window opens (search snippet only); 🟢 HH Timing gap overlay on its circle map; 🟡 own car at 12 o'clock is unconfirmed ([Tufte thread](https://www.edwardtufte.com/?p=409)); HH puts the start/finish line at the top instead. **Pitwall: own car at 12 o'clock** (user, 2026-10-28) | gaps of all cars, pit loss table |
| V02 | **Gap track map** | Linear strip with the reference car at 0 s, cars by time gap; traffic prediction for future laps, time to catch, the line on track where a car will be caught | D17, D21 | 🟢 [HH gap track](https://help.hhtiming.com/displays/track-maps/gap-track/) | gaps, assumed pace, lap distance |
| V03 | **Live crossing order with ghosts** | Cars in the order they will cross the line; the ghost listed between real cars with the gap ahead and behind | D21, D24 | 🟢 [HH live crossing order](https://help.hhtiming.com/displays/scoreboards/live-crossing-order-scoreboard/) | gaps, pit loss |
| V04 | **Race history (gapper) chart** | Gap to a virtual car at constant pace per lap; ghost lines ("if he pitted at the end of this lap"); projected lines for the next laps; SC/VSC background | D21, D23, D31, D32 | 🟢 [HH gap graph](https://help.hhtiming.com/displays/graphing/gap-graph), [School of Race Engineering](https://schoolofraceengineering.co.uk/blog/post/15986/how-do-teams-analyse-f1-race-strategy), [03](03-strategy-models.md) | lap times of all cars |
| V05 | **Lap slice chart** | One lap: each car as a point by gap to the leader, with an extra point for the expected post-stop position of the cars of interest | D21, D23 | 🟢 [School of Race Engineering](https://schoolofraceengineering.co.uk/blog/post/15986/how-do-teams-analyse-f1-race-strategy) | gaps, pit loss |
| V06 | **Strategy overview** | One row per car, stints as blocks over time; future stints computed forwards from now and backwards from the finish, so their overlap is the **pit window**; heat map by average lap or degradation | D21, D22, D27 | 🟢 [HH overviews](https://help.hhtiming.com/displays/overviews/) | stints, assumed pace, stint length |
| V07 | **Stint analysis / degradation scatter** | Lap time against tyre age per stint with the fit; excluded laps greyed; laps toggled by hand; stints combined | D03, D11, D22 | 🟢 [HH degradation](https://help.hhtiming.com/calculation-definitions/degradation/), [03](03-strategy-models.md) | lap times, stints, fuel |
| V08 | **Raising average** | Average of the best X laps for X = 1…n; a shallow slope means consistency | D01, D03, D06 | 🟢 [HH raising average](https://help.hhtiming.com/displays/graphing/raising-average/) | lap times |
| V09 | **Lap overview heat map** | One block per lap, coloured by stint heat map, in/out laps, best laps; track status strip | D03, D32 | 🟢 [HH overviews](https://help.hhtiming.com/displays/overviews/) | lap times, status |
| V10 | **Projected lap and gap** | Projected lap time, gap to best and projected line crossing | D08 | 🟢 [HH projected lap time](https://help.hhtiming.com/calculation-definitions/projected-lap-time/) | sectors |
| V11 | **Virtual finish car** | A dot on the track map that crosses the line at zero time remaining | D07, D08 | 🟢 [HH full track](https://help.hhtiming.com/displays/track-maps/full-track/) | session time, average lap |
| V12 | **Quali gap finder / release clock** | Projected cars around us on the push lap; free windows on a time strip; latest release | D07 | 🟢 HH uses GPS maps for this; 🔵 release clock | positions, driver status |
| V13 | **Undercut card** | Per neighbour: gap, `Δ(N)` for N = 1–3, margin over the gap | D23 | 🟢 AWS Undercut Threat inputs; 🔵 card and formula | gaps, degradation, pit loss |
| V14 | **Battle cards** | Ahead and behind: gap, closing rate, laps to DRS range, pass feasibility, tyres | D17, D13 | 🟢 AWS Battle Forecast, HH time to catch; 🔵 card | gaps, pace, tyres |
| V15 | **Pit-lap sweep** | For each lap in the window: rejoin position, traffic in the first laps, projected finish | D21 | 🟢 Simulator Controller (least traffic, undercut); 🔵 strip | gaps, pace, pit loss |
| V16 | **Strategy comparison** | Rows = compound sequences / plans; finish time, position, gap to best, risk; later a distribution per plan | D22, D28, D31 | 🟢 TUM, Avella et al.; 🔵 table | fits, sets, pit loss |
| V17 | **Plan board** | Plan A/B/C per driver: stop laps, compounds, target laps; armed triggers; which trigger fired | D09, D31, all race calls | 🟢 F1 strategists (pre-agreed plans and messages); 🔵 board | plans, live state |
| V18 | **SC card (standing answer)** | One line in green running ("SC now: gain 11.2 s, rejoin P7, 2 rivals in window"); expands under SC/VSC with gain, rejoin, who else profits; restart sheet | D24, D25, D29 | 🟢 TUM, Red Bull; 🔵 card | SC state, pit loss table, gaps |
| V19 | **Crossover chart** | Field lap times by tyre type; 110 % line; forecast rain strip; payback laps | D26 | 🟢 Pirelli; 🔵 chart | lap times, compounds, forecast |
| V20 | **Fuel delta gauge** | Laps of margin; save target per lap; SC credit | D12, D05 | 🟢 Simulator Controller, iRacing fuel tools ([iRacePal](https://github.com/Bahnzo/iRacePal)); 🔵 save target | fuel, burn, laps left |
| V21 | **Tyre life bar** | Per corner: wear now, projected at the planned stop, limit, the game's life span | D11, D22 | 🟢 Simulator Controller wear rule; 🔵 bar | wear, rate, plan |
| V22 | **Corner block** | Four corners: surface and carcass temperature, pressure, brake temperature, wear; grey in band, coloured out of band | D14, D16 | 🟢 ATLAS/Pi numeric and threshold displays ([01](01-race-engineering-practice.md)) | CarTelemetry, CarDamage |
| V23 | **ERS budget** | Store, deployed this lap against the limit, reserve line, "ready to attack in N laps" | D13, D29 | 🟢 Avella et al. (target state of charge, 40 % margin); 🔵 readiness | CarStatus ERS fields |
| V24 | **Call → confirmation log** | Each call (brake bias +1, ERS overtake, box) with time and whether the car confirms it | D13, D14, D15, D21 | 🔵 ([05](05-game-control-boundary.md)) | CarStatus, CarSetups, pit status |
| V25 | **Alarm list** | Active alarms by priority, acknowledge, groups that can be switched off | D10, D16, D18 | 🟢 ATLAS alarms ([02](02-atlas-interaction-model.md)) | rules over the stream |
| V26 | **Delta trace and corner-loss list** | Distance-mode delta against a reference lap; ranked corner losses with the likely cause | D06, D19 | 🟢 ATLAS, HH GPS delta; 🔵 ranked causes | telemetry, lap distance |
| V27 | **Team card** | Both drivers: pace delta, gap, swap value, split/stack table | D20, D27 | 🔵 | both cars' timing |
| V28 | **Lap analysis scoreboard** | Best laps and sectors of all cars as deltas to a reference car; theoretical and rolling best | D01, D06, D08 | 🟢 [HH lap analysis](https://help.hhtiming.com/displays/scoreboards/lap-analysis-scoreboard/), [best sector](https://help.hhtiming.com/displays/scoreboards/best-sector-scoreboard/) | sectors |
| V29 | **Timing tower** | Position, gaps, last lap, tyre and age, stops, penalties and warnings, pit status | all | 🟢 ([01](01-race-engineering-practice.md)) | LapData, CarStatus |
| V30 | **Game pit window badge** | The game's ideal and latest lap and rejoin position, as a cross-check | D21 | 🟢 F1 25 spec ([04](04-f1-25-data-mapping.md)) | Session |
| V31 | **Damage card** | Damage %, measured lap-time loss, break-even laps against a stop | D10 | 🟢 Simulator Controller "Impact"; 🔵 break-even | CarDamage, lap times |
| V32 | **Knowledge checklist** | What is still unknown for quali and the race, with session time left | D01 | 🔵 | fits, counts |
| V33 | **Pit loss table** | Measured pit loss per track and condition (green, VSC, SC), with sample count | D21–D25 | 🟢 TUM table ([03](03-strategy-models.md)), HH pit stop scoreboard | pit-lane timers, lap times |

**The most promising computed displays** (🔵 judgement): the circle of doom with condition ghosts (V01), the SC card as a standing answer (V18), the undercut card (V13), the pit-lap sweep (V15) and the plan board (V17). Together they move the strategist's live arithmetic into the tool, which is what the real teams try to avoid doing live.

## 4. Escalation map

The layout stays put. A situation lights up the few values it needs (colour only as a highlight) and raises their decision to tier 1. Each row is a rule over the stream, so it can also be an ATLAS-style alarm with acknowledge.

| Situation | Trigger (🔵 unless noted) | Decisions moved to tier 1 | What lights up |
|---|---|---|---|
| **Pit window opens** | planned stop lap − 2, or the strategy overview's forward and backward stints overlap (🟢 HH) | D21, D22, D23 | rejoin ghost, sweep strip, compound table |
| **Rival in undercut range pits** | a car within `Δ(1) > gap` (ahead or behind) enters the pit lane; TUM uses "car behind just pitted" (🟢) | D23, D21 | undercut card, that rival's ghost |
| **Our undercut turns positive** | `Δ(1) > gap_ahead + 0.5 s` | D23 | undercut card |
| **Safety car deployed** | `m_safetyCarStatus = 1` / SafetyCar event Deployed | D24, D27, D12 (fuel credit) | SC card expands, ghosts switch to SC pit loss |
| **VSC deployed** | `m_safetyCarStatus = 2` | D25 | SC card in VSC mode |
| **SC ending** | SafetyCar event Returning | D29, D13 | restart sheet |
| **Red flag** | Red Flag event | D28 | strategy comparison |
| **Rain coming** | forecast rain % above a threshold within the next samples, or the first car on the other tyre goes faster in a sector (🟢 Motor Sport) | D26 | crossover chart |
| **Incident / damage** | Collision event involving our car, or a jump in damage % | D10, D21 | damage card |
| **Tyre limit near** | projected wear at the planned stop above the limit; blisters; pressure drop | D11, D16, D21 | tyre life bar, corner block |
| **Temperature out of band** | a channel out of band for a full lap | D16, D14 | corner block cell |
| **Fuel deficit** | `margin_laps < 0` beyond one SC lap's credit | D12 | fuel gauge |
| **Battle near** | DRS range predicted within 2 laps; car behind closing faster than a threshold (🟢 HH 0.03 s/s idea) | D17, D13 | battle card |
| **Teammates together** | within 1.5 s with a pace delta for 3+ laps | D20 | team card |
| **Penalty close** | one warning left before a penalty; new penalty | D18 | timing row badge, ghost includes penalty |
| **Plan trigger fired** | any armed trigger on the plan board | the plan's decision | plan board row |
| **Final laps** | laps left ≤ fuel/ERS horizon | D12, D13 (spend the reserve; the 2026 model lifts its battery margin in the last laps 🟢) | fuel gauge, ERS bar |
| **Quali release window** | a free window opens in 30–60 s | D07 | release clock |
| **Quali cut-off danger** | projection below the cut-off, lap invalid | D08 | projected row |

**Race moments** (from the user's priorities): car care is the default tier-1 job. Strategy takes over in the *window*, *neutralised* (SC/VSC/red), *weather* and *incident* moments. Race awareness takes over in a *battle*. The moment is a single state the UI can show and every widget can read.

## 5. Gaps and open questions

### For the user

Answered (user, 2026-10-28):
- **Second car's data:** both drivers set their telemetry to public, and both feeds will reach pitwall. The second driver comes after the MVP, so the 🔒 items for the second car (D02, D14, D15) wait until then.
- **Circle orientation:** own car at 12 o'clock.
- **Radio lines:** none. The plan board holds plans and triggers, not sentences.
- **Numbers only, no verdicts:** pitwall shows the computed numbers ("rejoin P6, 1.2 s behind VER; undercut +0.8 s") and never a verdict ("Undercut: WORKS") or a recommended call ("BOX this lap"). The user draws every conclusion. The plan board's triggers show *that* a condition holds, not what to do about it.
- **AI cars:** there are AI cars in the lobby, so their wear, fuel, ERS and tyre sets are visible (no ⚠ for them).

Still open:
1. **Fuel load:** can the league's settings let the player choose the race fuel load in F1 25? If not, D05 drops out. (The user is asking a friend what the drivers can edit.)
2. **Pit stacking:** does the league use double stacking, and does F1 25 allow it for two human teammates? (The user is asking a friend.)
3. **League rules:** two dry compounds, parc fermé, the SC setting, the track-limit penalty rules, red-flag tyre change. These set constants for D22, D28 and D30. Unknown for now.

### For research and recordings
1. **Pit loss per track and condition** (green, VSC, SC): no recordings yet with a stop or an SC (spec 12). This blocks D21–D25.
2. **F1 25 SC behaviour:** does the field bunch up, how long does the SC run (`m_safetyCar` setting), do AI cars pit under SC?
3. **`m_fuelRemainingLaps`:** is the MFD value absolute laps or the surplus against the race distance? Check against a recording.
4. **Tyre temperature bands per compound in F1 25:** the community figures disagree. Derive them from lap time against temperature in our recordings.
5. **ERS per-lap limits in F1 25:** deploy and harvest limits, from the recordings.
6. **Overtaking threshold in F1 25:** real F1 numbers are 1–2 s of pace advantage; the game's AI and humans may differ.
7. **Cold-tyre and out-lap penalty in F1 25** for the undercut formula.
8. **Wing change and stacked-stop times** in the F1 25 pit stop.
9. **Red flag rules in F1 25:** free tyre change or not.
10. **The game's own pit window:** how good is it as a baseline? The 2026 paper beat it by 7.79 s at COTA in one test.

### Sources not reached
- Bernie Collins' "F1 Explains" episode on the pit wall's screens is audio only; there is no transcript ([F1](https://www.formula1.com/en/latest/article/f1-explains-what-goes-on-inside-an-f1-pit-lane-with-strategy-guru-bernie.6w7WwASefNkk5nZ2IIDqLG)).
- Catapult RaceWatch has no public display documentation; only vendor claims (live degradation, pit stop analysis) ([Catapult](https://www.catapult.com/solutions/racewatch)).
- The LinkedIn post on the McLaren Track Viewer and the Motorsport.com mission control article could not be opened directly; both are labelled 🟡.
- F1 Manager's strategy screens: no useful description found beyond forum posts.
- MoTeC and Pi Toolbox car-care alarm displays: nothing public beyond [01](01-race-engineering-practice.md).
- iRacing/LMU/ACC tools: only fuel calculators and relative overlays were documented; no pit rejoin or strategy views found.

## 6. Sources

**Teams and F1**
- McLaren, [Who sits on McLaren's pit wall](https://www.mclaren.com/racing/formula-1/2026/who-sits-on-mclarens-pit-wall/) (2026)
- Formula1.com, [The insider's guide to F1 strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO)
- Formula1.com, [F1 Explains with Bernie Collins](https://www.formula1.com/en/latest/article/f1-explains-what-goes-on-inside-an-f1-pit-lane-with-strategy-guru-bernie.6w7WwASefNkk5nZ2IIDqLG), [Beyond the Grid with Bernie Collins](https://www.formula1.com/en/latest/article/beyond-the-grid-bernie-collins-on-strategy-risks-racing-rewards-and-the.7nvO0cOEXYUpWBcdg4Yxxt) (podcasts, not transcribed)
- Aston Martin F1, [Strategically speaking, with Tom McCullough](https://www.astonmartinf1.com/en-GB/news/feature/strategically-speaking-f1-strategy-explained-with-tom-mccullough) (2024)
- Females in Motorsport, [Hannah Schmitz interview](https://www.femalesinmotorsport.com/post/hannah-schmitz-red-bull-s-star-strategist-on-baalance-fame-and-staying-true-to-yourself); GPFans, [Schmitz on Qatar 2025](https://www.gpfans.com/us/f1-news/1069481/red-bull-f1-hannah-schmitz-qatar-gp-strategy/)
- Sky Sports, [Hamilton on the Singapore VSC call](https://www.skysports.com/f1/news/13602364/lewis-hamilton-ferrari-driver-explains-taking-strategy-into-own-hands-in-singapore-ahead-of-united-states-gp) (2026)
- Motorsport.com, [How F1 race strategy works](https://au.motorsport.com/f1/news/how-f1-race-strategy-works/6791895/)
- Motorsport.com, [Inside McLaren's mission control](https://www.motorsport.com/f1/news/insight-inside-mclarens-secretive-f1-operations-room-mission-control/3221220/) (not opened; search snippet only)
- Amazon, [F1 Insights powered by AWS](https://press.aboutamazon.com/2021/4/new-f1-insights-powered-by-aws-will-help-formula-1-fans-make-sense-of-split-second-decisions-on-the-track)
- Pirelli, [When it's time to change from slick to wet tyres](https://www.pirelli.com/global/en-ww/race/racingspot/formula-1/when-it-s-time-to-change-from-slick-to-wet-tyres-in-formula-1-52943/)
- Motor Sport, [Switching from inters to slicks](https://motorsportmagazine.com/archive/article/december-2022/36/switching-from-inters-to-slicks-the-crucial-strategic-tyre-call-in-f1-wet-races) (2022)
- School of Race Engineering, [How do teams analyse F1 race strategy](https://schoolofraceengineering.co.uk/blog/post/15986/how-do-teams-analyse-f1-race-strategy)
- r/F1Technical, [circular track layout thread](https://teddit.bsalzberg.com/r/F1Technical/comments/1j0os9g/is_there_a_live_source_to_a_circular_track_layout) (the McLaren Track Viewer claim)

**Tools**
- HH Timing help: [displays](https://help.hhtiming.com/displays/), [gap graph](https://help.hhtiming.com/displays/graphing/gap-graph), [raising average](https://help.hhtiming.com/displays/graphing/raising-average/), [scatter](https://help.hhtiming.com/displays/graphing/scatter/), [GPS speed](https://help.hhtiming.com/displays/graphing/gps-speed/), [overviews](https://help.hhtiming.com/displays/overviews/), [track gap](https://help.hhtiming.com/displays/track-gap-display/), [circle track](https://help.hhtiming.com/displays/track-maps/circle-track/), [gap track](https://help.hhtiming.com/displays/track-maps/gap-track/), [full track](https://help.hhtiming.com/displays/track-maps/full-track/), [live crossing order](https://help.hhtiming.com/displays/scoreboards/live-crossing-order-scoreboard/), [lap analysis](https://help.hhtiming.com/displays/scoreboards/lap-analysis-scoreboard/), [best sector](https://help.hhtiming.com/displays/scoreboards/best-sector-scoreboard/), [car scoreboard](https://help.hhtiming.com/displays/scoreboards/car-scoreboard/), [pit stop scoreboard](https://help.hhtiming.com/displays/scoreboards/pit-stop-scoreboard/), [track item and ghosts](https://help.hhtiming.com/settings-options/track-item-ghosts/), [backstage options](https://help.hhtiming.com/settings-options/backstage-options/), calculation definitions: [assumed pace](https://help.hhtiming.com/calculation-definitions/assumed-pace/), [degradation](https://help.hhtiming.com/calculation-definitions/degradation/), [sanitized average](https://help.hhtiming.com/calculation-definitions/sanitized-average-lap-time/), [pit stop length](https://help.hhtiming.com/calculation-definitions/pit-stop-length/), [predicted stint length](https://help.hhtiming.com/calculation-definitions/predicted-stint-length/), [projected lap time](https://help.hhtiming.com/calculation-definitions/projected-lap-time/), [race finish](https://help.hhtiming.com/calculation-definitions/race-finish-calculation/), [yellow flag laps](https://help.hhtiming.com/calculation-definitions/yellow-flag-laps/)
- Simulator Controller wiki: [AI Race Strategist](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Strategist), [AI Race Engineer](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/AI-Race-Engineer), [Strategy Workbench](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/Strategy-Workbench) (LGPL code: ideas only)
- Catapult, [RaceWatch](https://www.catapult.com/solutions/racewatch)
- [iRacePal](https://github.com/Bahnzo/iRacePal) (fuel in car, fuel to add)

**Papers**
- Avella, Borruso, Marino, Masone, [A simulation framework for Formula 1 race strategy based on pit-stop optimization](https://optimization-online.org/2026/02/a-simulation-framework-for-formula-1-race-strategy-based-on-pit-stop-optimization/), Optimization Online, Feb 2026 ([PDF](https://optimization-online.org/wp-content/uploads/2026/02/Pit_Stop_Strategy_Optimization_Model.pdf))
- TUM race simulation and Monte Carlo paper: see [03](03-strategy-models.md)

**Game guides (🟡)**
- SimRacingSetup, [F1 25 race strategy guide](https://simracingsetup.com/ea-sports-f1/f1-25-race-strategy-guide/), [F1 25 tyre guide](https://simracingsetup.com/ea-sports-f1/f1-25-tyre-guide/)
- Traxion, [F1 25 ERS explained](https://traxion.gg/f1-25-ers-explained/)

**Game data**
- `external/F1 25 Telemetry Output Structures.txt` (fields cited by name above)
