# The ATLAS interaction model

McLaren Applied ATLAS is the F1 standard tool for data analysis. Its documentation is public: [docs.atlas.mclarenapplied.com](https://docs.atlas.mclarenapplied.com).

## Data model
- **Session → laps → parameters (channels) → events/markers.**
- Several sessions can be loaded at once as **compare sets**, with one marked as primary.
- **Live and historical sessions use the same tool.** Supported formats include `.ssn2`, the SQL Race database, CSV, MATLAB and Parquet ([Viewer](https://docs.atlas.mclarenapplied.com/key-functionality/analyse/viewer/)).

## Time and navigation
Source: [Timebase](https://docs.atlas.mclarenapplied.com/key-functionality/analyse/viewer/time-and-position/time/)

- **Timebase:** every display has its own time window (start, end, current position). Displays can be **linked** so they move together, or left independent. Live data moves the position forward automatically.
- **Timeline** across the top of the window:
  - set name (driver/session), lap and marker selection
  - previous/next/fastest-lap buttons
  - a lap bar with lap boundaries and the fastest lap highlighted
  - a red line for the current position
- **Selecting laps:** double-click a lap to view that lap, triple-click for the whole session, drag to select any range.
- **Three ways to move:**
  - dragging the cursor in a waveform, track map or scatter plot changes only the position
  - zoom changes only the duration
  - the timeline changes both
- **Time mode vs distance mode** (toggle with `K`). Distance mode needs a lap-distance channel (`sLap`) and adds **TDiff**, the time difference against the comparison lap, i.e. the delta channel.
- **Compare sets:** compare the whole session, a single lap or the fastest lap, with a time offset between sets. `Shift+n` switches one display to set n; `Ctrl+n` switches the whole page.

## Functions (math channels)
Sources: [Functions](https://docs.atlas.mclarenapplied.com/key-functionality/analyse/viewer/functions/), [Processors](https://docs.atlas.mclarenapplied.com/key-functionality/analyse/viewer/functions/processing/)

Functions are written in their own language (FDL), stored in the database, and used in displays exactly like real channels.

| Group | Functions | Typical use |
|---|---|---|
| Calculus | `derivative`, `integral` (also in distance mode) | accelerations, energy, fuel used |
| Filters | low-pass, high-pass, `PhaseCompFilter` (no lag), median | smoothing, removing spikes |
| Lap statistics | `LapMax/Min/Mean/StdDev`, `LapTime(n)`, `CurrentLapNumber` | values per lap |
| **Lap regression** | `LinearRegressionSlope/Offset/R2`, `LapBestFit` | **degradation trend over a stint** |
| Session statistics | `SessionMax/Min/Mean/StdDev` | reference values |
| History | `IndexByTime`, `IndexBySample`, `SamplesMax/Min` | rolling windows, "value t seconds ago" |
| Lookup tables | `LinearInterpolate(.2d)`, `BiLinearInterpolate(.3d)` | calibration curves, aero maps |
| Logic / events | `IsGT`, `IsInRange`, `SetEvent`, `WriteToLog` | detecting events |

## Alarms
Source: [Alarms](https://docs.atlas.mclarenapplied.com/key-functionality/analyse/viewer/alarms/)

- A condition is checked **on every incoming sample**. When it triggers, the alarm can log, warn, show a pop-up or set a marker.
- Alarms are organised in **groups** that can be switched off together.
- Three run modes: **Live**, **Manual** (run over a historical session) and **On session load**.

## Workbooks and extensibility
- A workbook saves displays, their positions, channel choices and properties.
- Displays are plugins with their own Display API. An Automation API exists for C# and MATLAB.

## For comparison: Catapult RaceWatch (strategy)
- Used by Mercedes, McLaren and the FIA. It combines timing, GPS and video, with **about 300 visualisations arranged into dashboards per role**.
- "Follow Me TV" automatically produces a video feed for a chosen car. ([Autosport](https://autosport.com/f1/news/inside-the-strategy-system-thats-won-20-f1-world-championships/10801964/))

## Worth copying into pitwall
- a time window per widget that can be linked to others or left independent
- the lap bar and lap selection
- distance mode with a built-in delta channel
- compare sets (my lap / best lap / a rival / an earlier session)
- math channels as virtual topics, including lap regression
- alarms as rules over the stream, with live and historical modes, in groups that can be switched off
- saved layouts per role

**Not found in the docs:** the exact cursor behaviour (reference vs comparison cursor) and live follow mode.
