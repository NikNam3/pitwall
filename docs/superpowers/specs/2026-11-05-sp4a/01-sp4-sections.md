# SP4: dependency graph and sections

Status: agreed with the user in the SP4 brainstorm, 2026-11-05. It replaces the 4a/4b split (carry-over D1) and the 4a/4a' split (carry-over A8). The answers behind it are in `00-carry-over.md` §9. Each section gets its own spec, plan and run, in the order below.

## Dependency graph

`→` means "needs". Already on main and read by the units below: `gaps`, `fuel`, `lap-classes`, `per-lap-rate`, `view.weekend` (C62), `incidents`, `race-moment`, the spans of `zone-flags`, `car-flags`, `car-location`, `race-control`.

**Foundation**

- F1 contract change `view.track` (C39, new C62b, C38, C59, C78, ADR 0015 line); `TrackFile` type in `domain`; bridge loader and sidecar
- F2 track files `data/tracks/<trackId>.json`, made in `~/dev/personal/pitwall-trackdata` (R1 turns, R3 defaults) → F1
- F3 `track-lookup` (`analysis/src/shared/`) → F1
- F4 scheduler cadence `ourCrossing` (a mini-sector crossing of our cars was appended)
- F5 kit pieces: track outline canvas, ghost marker (B1), source badge; theme role `opportunity`

**Track**

- `track-positions` → F1, F3, spans → display track map → F5
- `incidents` gains the official turn → F3
- radio indicator (N9): our car's current lap distance against the track file's braking zones → F1, F3 → top bar (shell)

**Estimation**

- `degradation` → `laps`, `stints`, `fuel`, `view.weekend`, F1 (compound offsets)
- `pit-loss` → `pitStops`, `laps`, F1 (defaults)
- `tyre-life` → `degradation`, live tyres, `view.weekend`; `tyre-wear` is ported onto it (C43)

**Long run and weather**

- `raising-average`, `lap-overview`, `weather` → nothing new
- `stint-analysis` → `degradation`
- `pit-losses` → `pit-loss`
- `crossover` → `pit-loss`

**Race calls without a forecast**

- `rejoin` → `gaps`, `pit-loss`, F3, F4 → crossing order, gap-chart ghost lines, map ghost (→ track map)
- `sc-call` → `rejoin`, `pit-loss`, race-control spans → SC card
- `pit-window` → `tyre-life`, tyre sets → `window` moment in `race-moment`

**Strategy model**

- `lap-model` → `degradation`, `tyre-life`
- `race-forecast` (with battles) → `lap-model`; `forecast-field` → the three calculators, `gaps`
- Monte Carlo (SC/VSC, passes), DP optimiser → `race-forecast`
- `undercut` → `race-forecast`, `rejoin`; `pit-sweep` → the strategy model, `pit-window`; `forecast-score` → the strategy model, `rejoin`, `undercut`
- V16, V06, V17, V01; weather in the model → `crossover`

## Sections

| Section | Content | Needs |
|---|---|---|
| **4.0 Foundation and track** | F1–F3, F5's outline canvas, R1, R3; track map, incident turns, talk indicator (spec `02-sp4.0-foundation-and-track-design.md`) | — |
| **4.1 Estimation and long run** | the source badge; `degradation`, `pit-loss`, `tyre-life` (+ `tyre-wear` port); stint scatter, raising average, lap overview, pit-loss table, weather strip, crossover chart; workbook `longrun` | 4.0 |
| **4.2 Race calls** | F4 (`ourCrossing`), the ghost marker; rejoin (crossing order, gap-chart ghost lines, map ghost), SC card, pit window and `window` moment; workbook `strategy` | 4.0, 4.1 |
| **4.3 Strategy model** | lap model, race forecast with battles, Monte Carlo, DP optimiser; undercut, pit sweep, forecast scoreboard; V16, V06, V17, V01; weather in the model | 4.1, 4.2 |

Rules for every section (carry-over §9): positive = good for our car (A6); each unit updates when its inputs change and states why (A2); practice feeds the race through `view.weekend` (A13); the priors store across weekends is not in SP4; track geometry is never computed live (A3). Before SP4: the live-polish plan for N2–N8 and N10 (A1).
