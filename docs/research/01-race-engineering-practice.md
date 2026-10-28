# Real race-engineering practice

## 1. The race engineer's job

- **The link between driver and team.** On the radio they tell the driver what is happening and pass on instructions: DRS, engine modes, brake balance changes. Over a session they also manage setup changes. ([Red Bull](https://www.redbull.com/my-en/the-people-behind-the-f1-paddock), [Motorsport Explained](https://motorsportexplained.com/type-of-f1-engineers-trackside-during-race-weekend))
- **One of a team of specialists.**
  - next to them: a performance engineer (telemetry, driver against reference), a tyre engineer, an aero engineer and a strategy group
  - Mercedes keeps several of these in the garage rather than on the pit wall, to cut distractions ([Mercedes](https://mercedesamgf1.com/news/insight-the-trackside-engineers))
- **Weekend rhythm.** Friday is the heaviest day: practice data, setup work, long-run tyre data. Sunday is mostly carrying out a plan made in advance. ([School of Race Engineering: Friday](https://schoolofraceengineering.co.uk/blog/post/16525/race-engineering-day-by-day--friday), [Thursday](https://www.schoolofraceengineering.co.uk/blog/post/16477/race-engineering-day-by-day--thursday/))

**For pitwall:** it combines a performance engineer, a tyre engineer and a strategist in one panel.

## 2. Who looks at what, and where they sit

| Location | People | Focus |
|---|---|---|
| **Pit wall** (4–7 seats) | race engineers (at the ends), head of strategy, chief race engineer, sporting director, team principal | the race picture: own car against rivals, timing, TV feed, GPS, weather radar, other teams' radio |
| **Garage** | race engineer in practice and qualifying, performance, tyre, aero and PU engineers. Some teams (Mercedes) keep race engineers here during the race too | detailed data for their own car |
| **Factory ops room** (Red Bull "Ops Room", Mercedes "Race Support Room") | strategy group plus dozens of specialists | detailed sensor analysis, strategy simulations, competitor analysis |

Ferrari's sporting director made three points:
- **Each person sets up their own screens**, and "moving someone else's window is unwelcome".
- Race engineers watch their own car and driver; the wall watches the position against rivals.
- Detailed sensor data stays in the back room.

Sources: [F1.com insider's guide](https://www.formula1.com/en/latest/article/the-insiders-guide-to-the-pit-wall.CFwHwjTcLNO5Gf4B3Dy4o), [Mercedes](https://mercedesamgf1.com/news/insight-the-trackside-engineers), [Red Bull ops room](https://www.redbull.com/us-en/red-bull-racing-inside-top-secret-ops-room)

## 3. Software stack

1. **Data acquisition and analysis**, the core tool:
   - **McLaren Applied ATLAS**: the F1 standard, live and historical in one tool ([docs](https://docs.atlas.mclarenapplied.com)). Details in [02](02-atlas-interaction-model.md).
   - **Cosworth Pi Toolbox**: used from F1 to endurance racing; also reads iRacing data ([product PDF](https://www.cosworth.com/media/2erfisc1/pi-toolbox-product-information-v2.pdf)).
   - **MoTeC i2 Pro**: GT and touring cars; strong custom maths and lap overlays ([MoTeC](https://www.motec.com.au/i2/)).
   - **Bosch WinDarab** and **Magneti Marelli WinTAX**: tied to their own hardware ([WinDarab](https://xtramotorsport.com/blog/windarab-free-vs-expert/)).
2. **Live timing:** the official feed: gaps, sectors, micro-sectors, speed traps, tyres, stop count.
3. **Strategy simulator:** built in-house by every team and not public. It runs continuous "what if we pit on lap N" simulations.
4. **Video, TV feed, GPS tracker, weather radar.**
5. **Team database:** run plans, setup sheets, driver feedback, debrief notes. These are custom tools, sometimes plain OneNote.

## 4. Display types (shared by ATLAS and Pi Toolbox)

| Display | Shows | Typical use |
|---|---|---|
| **Waveform / time-distance chart** | several channels against time or distance; cursor; overlaid laps; event markers | lap overlays: speed, throttle, brake, steering, gear, delta |
| **Scatter (X/Y)** | Y against X, optionally coloured by a third channel | GG diagram, understeer plots, aero maps (ride height against downforce) |
| **Histogram** | time spent at each value | damper velocities, throttle use, gear use |
| **Loadmap** | heatmap of time spent in 2D ranges | engine operating points, tyre load |
| **FFT / PSD** | frequency spectrum | vibration, kerb strikes, suspension frequencies |
| **Numeric / bar / dial** | current value, coloured by thresholds | live monitoring (temperatures, pressures, fuel) |
| **Bit / status** | status flags as coloured lights | DRS, systems, ECU states |
| **Circuit / track map** | car position, sectors, map coloured by a channel | where on track something happens |
| **Summary / outing report** | min, max and mean per lap as a table | run summaries, stint comparisons |
| **Metric reports** (Pi: per segment, between events) | KPIs per corner or segment | corner-by-corner comparison |
| **Event / error log** | ECU events and alarms, by priority | reliability monitoring |
| **Dash display** | the steering-wheel display | seeing what the driver sees |
| **Video** | onboard video synced to the data | matching data to what happened |
| **Notepad, browser, countdown** | notes, embedded web pages, timers | session admin |

The concepts that tie the displays together:
- **Workbook / worksheet:** a saved layout of displays plus channel choices, with one layout per task (tyres, brakes, driver, PU).
- **Compare sets / overlays:** load several laps, runs or cars and flip between them.
- **Math channels:** channels computed from other channels, e.g. time delta, understeer index, fuel-corrected lap time.
- **Events / metrics:** automatically detected events (braking points, apexes) plus KPIs for the reports.
- **Live and historical in one tool:** live displays scroll; afterwards the same workbook is used to analyse the session.

## 5. What is on the screens, by task

### a) Timing (pit wall, strategy)
- One row per car with:
  - position, gap to the leader, interval to the car ahead
  - sector times (purple/green/yellow), last lap, best lap, speed trap, laps completed
  - tyre compound and age, stop count, pit status
- A second table holds the same data **for every lap** (the full history).
- Micro-sectors matter most in qualifying.

Sources: [Autosport](https://www.autosport.com/f1/news/everything-you-need-to-know-about-the-pitwall-in-f1-who-sits-there-and-what-does-it-do/10588720/), [F1 Chronicle](https://f1chronicle.com/f1-telemetry-and-data-explained/)

### b) Strategy
- **Race history / gap chart:** gap to a reference over laps, one line per car. Pit stops show as jumps, stints as slopes. The FIA publishes these as PDFs for every race ([example: Monza 2025](https://www.fia.com/sites/default/files/2025_16_ita_f1_r0_timing_racehistorychart_v01.pdf)). The exact formula is in [03](03-strategy-models.md).
- **Fuel-corrected lap times per stint.** The rule of thumb is about 0.03 s per kg per lap (TUM Spielberg 2019: 0.019 s/kg, so it varies by track). The slope of the corrected times is the degradation rate ([TracingInsights](https://github.com/TracingInsights/2026)).
- **Stint and tyre chart:** compounds and tyre age across the whole field.
- **Pit loss and rejoin projection:** where you'd come back out after a stop, and into which traffic.
- **Live what-if simulation:** undercut and overcut threats, SC scenarios.
- **Weather radar**, and the GPS position of every car.
- An unconfirmed visual idea, reported for years: a circular track display with your own car fixed at 12 o'clock and rivals placed by time gap rather than distance ([Tufte thread](https://www.edwardtufte.com/?p=409)).

### c) Car monitoring, live (garage, back room)
- tyre pressure and temperature on all four corners (sensors in each wheel), with puncture warnings
- brake temperatures on all four corners
- power unit:
  - fuel flow against the limit
  - ERS deploy and harvest against the energy budget
  - temperatures
- fuel used against target
- alarms and ECU errors by priority, plus status bits

### d) Performance analysis (after each run, debrief)
- **Lap overlay with delta.** The delta is the key derived channel: it shows where on track time is gained or lost. If time is lost in only one place, the cause is local (tyre drop-off, fuel load, wind). Overlaid speed, throttle, brake, steering and gear traces separate the driver's effect from the car's ([HP Academy delta](https://www.hpacademy.com/courses/data-analysis-fundamentals/practical-skills-analysing-the-time-delta-lap-gainloss-channel-advanced-sensors)).
- **GG diagram (friction circle):** lateral against longitudinal G, showing how much of the available grip is used ([HP Academy](https://www.hpacademy.com/courses/professional-motorsport-data-analysis/cornering-performance-gg-diagram/)).
- **Balance:** understeer and oversteer math channels, built from steering angle against yaw rate and lateral acceleration ([F1Technical](https://f1technical.net/forum/viewtopic.php?p=670443)).
- **Tyre temperatures across the tread (inner, middle, outer) over a stint.** They show camber and pressure issues and driving style. Engineers use them to check driver feedback, e.g. "understeer" that turns out to be a mid-corner problem.
- **Ride height and aero platform** against speed (ground effect), and damper velocity histograms ([HP Academy](https://www.hpacademy.com/courses/professional-motorsport-data-analysis/damper-analysis-damping-histogram/)).
- **Consistency across laps**, and comparing racing lines using GPS.
- Further telemetry sources: [Dronedesk](https://blog.dronedesk.io/f-1-telemetry-data/), [Jalopnik](https://jalopnik.com/1845821817), [Coach Dave Delta](https://coachdaveacademy.com/announcements/delta-data-telemetry-tool/)

## 6. Strategy basics

- **Tyre degradation** drives almost every decision: the higher it is, the more a fresh set is worth.
- **Undercut:** pit before the rival and gain time on fresh tyres. It's the most common move in modern F1.
- **Overcut:** stay out longer in clean air. It works where degradation is low and overtaking is hard.
- **Pit loss** = pit entry + time at the speed limiter + stationary time + exit + tyre warm-up. It drops under SC/VSC, but **not** by a fixed factor (see the table in [03](03-strategy-models.md)).
- **Pit window:** the range of laps where stopping beats staying out, given degradation, traffic at pit exit and the gaps around the car.

Sources: [Formula1.com](https://www.formula1.com/en/latest/article/undercut-vs-overcut-why-tyre-strategy-was-so-finely-poised-in-monaco-and-why.1YYMDkEBnFols8bDWtSXiz), [Catapult](https://www.catapult.com/blog/motorsports-race-strategy-undercut-overcut), [GPFans](https://www.gpfans.com/en/f1-news/1016512/f1-undercut-overcut-explained/)

## 7. Work cycle

**Run plan → session (live monitoring) → driver debrief right after the run → keep or revert setup changes → updated run plan.**

On top of that:
- a full debrief about 15 minutes after the session ends
- an evening session on strategy and competitors (tyre performance, wing levels across the field)
- outing reports and metrics as the shared summary of each run

Sources: [School of Race Engineering](https://schoolofraceengineering.co.uk/blog/post/16525/race-engineering-day-by-day--friday), [Autosport](https://autosport.com/all/news/how-to-become-race-engineer-f1/6631135/)

## 8. Existing F1 25 tools (for comparison)

- **AI race engineers:** a Steam app for F1 25 and Le Mans Ultimate, and [APEX AI](https://therapeutic-roast-420.notion.site/APEX-AI-Support-Help-Center-2b4c99532ae7804c821bc74fc92d3619). Both do radio calls, live pit strategy and corner coaching.
- **Dashboards and analysis:** [F1Laps](https://www.f1laps.com/faqs/f1-25-udp-telemetry-settings/) (post-session review), [Race Dash](https://apps.apple.com/gb/app/race-dash-for-sim-games/id1174914156), Sim Racing Telemetry, [SimHub](https://www.hackernoon.com/how-to-set-up-simhub-with-f1-25-for-the-playstation-5).
- **Pacedex:** a telemetry viewer for phone or tablet. No evidence was found that it sends anything to the game.

## 9. Consequences for pitwall

- The professional tools come down to four things:
  - a **set of display types**
  - **saved layouts per task**
  - **math channels and events**
  - **compare sets**

  These map onto pitwall's race model → topics → widgets.
- There are four views: **timing, strategy, car monitoring, performance analysis**. Teams split them across people; in pitwall one person switches between layouts.
- Live and historical data go through one engine and the same displays.
- To adapt for F1 25: there are no damper or ride-height data for rivals, and no inner/middle/outer tyre temperatures. See [04](04-f1-25-data-mapping.md).
