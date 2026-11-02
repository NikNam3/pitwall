# The current architecture, as the race state machine meets it

Status: as-is survey, 2026-11-02. Baseline: `integ/live-fixes` merged into main (situations plan Tasks 0–2 and fix waves 2–10, the `situations` code at 1e2060e). It describes what the code does, not what it should do. The contract for the target architecture is `02-contract.md` in this folder.

Sources: `docs/architecture.md` (the condensed architecture), ADRs 0001–0014, the situations spec `docs/superpowers/specs/2026-10-30-situations-design.md` and plan `docs/superpowers/plans/2026-10-30-situations.md`. Every `file:line` is in the merged tree.

## 1. Packages (unchanged by the tracker)

| Package | Role | May import |
|---|---|---|
| `protocol` | bytes → typed packets (2025 only) | nothing |
| `domain` | JSON-safe vocabulary (`Known`, records, ids, `situations.ts`) | nothing |
| `engine` | frame assembly, the race model, the calculator scheduler; pure | protocol, domain |
| `analysis` | analyses (calculators), `shared/` helpers | engine, domain |
| `contracts` | topic types, WebSocket messages | domain |
| `bridge` | I/O shell: input, runner, storage, hub, features, CLI | all |
| `ui` | Svelte UI | contracts, domain |
| `desktop` | Electron host | nothing |

dependency-cruiser enforces the edges. The tracker added no package and no edge.

## 2. One frame, end to end

```
PacketSource → decode → SessionTracker + FrameAssembler (engine/frame) → Frame
  → SessionRunner.apply(frame)                                (engine/runner/session-runner.ts)
      flashback? restore snapshot, truncate history, replay kept frames
      step(state, frame, report)                              (engine/step/step.ts)
        applySessionClock: read the session-time jump, put the frame on the race clock
        SUB_STEPS in order: session, identity, timing, tyres, energy, condition, dynamics, ownCar, realism,
                            situations, pitStops, laps, stints, flagPhases, events, miniSectors
      → StepResult { state, changed, corrections, delta {before, after, truncated}, flashback?, clockFall?, clockJump? }
  → SessionProcessor (bridge/pipeline/session-processor.ts)
      storage.writeConfirmed(history, delta)                  truncated: clear the session's rows, write again
      truncated: jobs.flashback()
      scheduler.run({ state, activeFlagPhase, situation, changed, delta, feed, config })
      publisher: state topics, publishHistory (truncated: resetAppend whole lists), insights
  → TopicHub (throttle, per client) → WebSocket → UI topic store → panel → widget
```

- `step` mutates the state in place. Sub-steps run in a fixed order and may read what earlier ones wrote (`step.ts:34-55`).
- The scheduler runs calculators by demand, cadence and change tags. A truncated delta makes every incremental calculator `init` from scratch (`calc/scheduler.ts:96-99`).
- Calculators see `EngineView.state`, which is the state without `open`, plus two named windows into `open`: `activeFlagPhase` and `situation` (`calc/types.ts:30-50`).

## 3. Engine state

`EngineState` (`engine/state/engine-state.ts:177-192`): session, `cars[]` (`CarState` per car id), `history`, player and teammate ids, `lastFrameId`, `sessionTime` (on the race clock, §5), `open`, `weekend`, `realism`.

### 3.1 History (8 lists)

| List | Written by | Read by (analysis, bridge) |
|---|---|---|
| `laps` (provisional + confirmed) | `history/laps.ts` | lap-times, pace, per-lap-rate, lap-classes, fuel, tyre-wear, ers, incidents, storage, topic `laps` |
| `stints` | `history/stints.ts` | tyre-wear, cars-overview, storage, topic `stints` |
| `pitStops` | `history/pit-stops.ts` | incidents, cars-overview, storage, topic `pitStops` |
| `flagPhases` | `history/flags.ts` (mirror of the spans, §4.3) | gaps, incidents, storage, topic `flagPhases` |
| `sessionPhases` | the tracker (`history/situations/`) | **no reader yet** (no topic, no storage, no analysis) |
| `pauses` | the tracker (`time-jumps.ts:194`) | no reader yet |
| `events` | `history/events.ts` (game events → `RaceEvent`) | incidents, gaps, battle (DRS), damage, storage, topic `events` |
| `miniSectors` | `history/mini-sectors.ts` | gaps, incidents |

### 3.2 Open trackers (`OpenTrackers`, `engine-state.ts:148-175`)

Work in progress behind the history, hidden from calculators: lap cursors, open stints, open pit visits, the open flag phase, `lastFlag`, mini-sector cursors, the lap index, the previous pit status per car, the previous damage per car. The tracker added `situations: { session: OpenSessionPhase }` and `phaseBook`, its bookkeeping (`engine-state.ts:106-146`): unconfirmed neutralisation, formation and start history lengths, lights out, `clockOffsetMs`, `lastWallMs`, `staleRawMs`, `onlinePause`.

### 3.3 Change tags (`step/types.ts:6-23`)

`session, identity, timing, tyres, energy, condition, dynamics, ownCar, sessionPhases, laps, stints, pitStops, flagPhases, events, miniSectors`. A truncated step sets all of them. The `flagChange` cadence fires on `flagPhases` (`scheduler.ts:69`). No cadence exists for `sessionPhases`.

## 4. The race state machine today (Tasks 0–2)

### 4.1 Where it sits

`applySessionClock` runs before every sub-step and `applySituations` is the first history sub-step (`history/situations/index.ts`). Three files:
- `session-phase.ts` (393 lines): the phase machine.
- `time-jumps.ts` (214 lines): session-time jumps, the race clock, pauses, the start re-stamp.
- `index.ts`: wiring.

### 4.2 What it decides

- **Session phase:** `preStart → formation → startLights → racing | running`, `neutralised` (SC/VSC with stages), `suspended`, `finished`, `postSession`. Signals: SCAR, STLG, LGOT, RDFL, RCWN, CHQF, SEND, `safetyCarStatus` (via `session.flag`), final classification, lap timers and leader lap (join detection).
- **Confirmation:** a SCAR opens a neutralisation unconfirmed. The safety car status must confirm it within 3 s, else it is dropped (`session-phase.ts:150-171`).
- **Join:** the first frame opens the current phase with `joinedAt` (`session-phase.ts:361-379`).
- **Session-time jumps** (`time-jumps.ts`):
  - flashback (the runner decides and hands `FlashbackReport` in);
  - stale frames after a rewind, stamped at its target;
  - start settling within 60 frames of LGOT (re-stamps the start);
  - post-session simulation (> 60 s and > 60× wall time);
  - other falls (the race clock continues: `clockOffsetMs`);
  - other forward jumps (reported only).
- **Pauses:** offline gaps > 2 s wall time, online `gamePaused`.

### 4.3 What it produces

| Output | Shape | Consumer |
|---|---|---|
| `history.sessionPhases` | `SessionPhaseSpan[]` (`domain/situations.ts`) | `flags.ts` only |
| `history.pauses` | `PauseSpan[]` | none |
| `open.situations.session` | `OpenSessionPhase` | `view.situation.session` (`calc/situation.ts`) |
| `view.situation.paused` | boolean from `phaseBook.onlinePause` | none |
| change tag `sessionPhases` | | none |
| `StepOutput.rewritten` / `discarded` | flags | runner → `delta.truncated` |
| `StepResult.clockFall` / `clockJump` | game times | bridge log only |

The old flag model is kept as a **mirror**: `flags.ts` copies neutralised and suspended spans into `history.flagPhases` and `open.flagPhase`, so `gaps`, `incidents`, `race-moment`, storage (`flag_phases`) and the topic `flagPhases` keep working unchanged. Two models of one fact now coexist.

## 5. Time: three clocks

- **Game session time:** on the frame as received. It resets, holds, rewinds, races ahead in the garage and jumps at the simulated end.
- **Race clock:** session time plus `phaseBook.clockOffsetMs`, plus the start re-stamp. Every history entry, `state.sessionTime` and every `Known.at` is on it (`step.ts` docstring; `time-jumps.ts:36`). The game's times appear only in `ClockFall` / `ClockJump` and `staleRawMs`.
- **Wall time:** `Frame.receivedAtMs`. It enters the engine only as differences: SEND grace in `SessionTracker`, offline pauses and the post-session jump in the tracker. A recording's record time reproduces it. `docs/architecture.md` "Determinism rules" documents this.

## 6. History: what "append-only" means in practice

`docs/architecture.md` says history is append-only. The code has four ways to change what was recorded, all signalled by the one flag `delta.truncated`:

| Change | Where | History | Snapshots / kept frames |
|---|---|---|---|
| Flashback | runner `#rewind` (`session-runner.ts:151-171`) | cut back to the snapshot's lengths, replay | kept up to the target |
| Formation discard at lights out | `session-phase.ts:214-250` (`discardFormation`, `lightsOut`) | laps, stints, pit stops, events, mini-sectors cut back to the formation's start; the STLG events put back; lap index rebuilt; cursors reset | **restarted** (`rewritten`): no rewind can go back before lights out |
| Start settling | `time-jumps.ts:154-190` (`restampStart`) | entries since the start lights **replaced** with re-stamped copies (not appended) | restarted (`rewritten`) |
| Discarded timeline | `session-phase.ts:90-127` (`drop`, `recordedAtOrAfter`, `atBoundary`) | unchanged | kept |

The "discarded timeline" covers two cases. A neutralisation is dropped unconfirmed, or a phase boundary lands at a moment an earlier frame already recorded entries at or after (`recordedAtOrAfter`, the "shared-moment rule", spec 3.1). Readers saw something that is now false, so all of them start over.

What every consumer does on `truncated`:
- incremental calculators: `init`;
- storage: deletes the session's rows and writes all again;
- publisher: `resetAppend` with whole lists;
- jobs: `flashback()`;
- the stream hash and moments: they follow the published stream.

The shared-moment rule lists the sequences it guards by hand: events, mini-sectors, laps (`completedAt`) and pit stops (`pitLaneExit`). Any new time-stamped history list must be added there, or it silently escapes the rule.

## 7. Where situations are decided outside the tracker

Spec principle 2.1 says no module but the tracker reads raw situation signals. Today these do, on the merged tree:

| Place | Raw signal read | What it decides |
|---|---|---|
| `engine/history/pit-stops.ts:47-60` | `pitStatus` transitions, DTSV/SGSV, `session.flag` | pit visit open/close, penalty served, the visit's flag |
| `engine/history/laps.ts:43,68` | `pitStatus`, `driverStatus` | out lap, the practice/qualifying lap restart at the line |
| `engine/history/laps.ts:83-84` | `session.flag` (sc/vsc) | `scMs` / `vscMs`, hence `scShare` / `vscShare` |
| `engine/history/pit-stops.ts:31-35` → `laps.ts` | pit exit | sets the cursor's `outLap` / `pitted` (cross-module coupling through `open.laps`) |
| `engine/history/stints.ts:42-57` | pit visit, lap progress, SEND | stint boundaries (the deferred split) |
| `engine/step/identity.ts:22-26`, `history/cars.ts:14` | `resultStatus` | "active car" (slots in use) |
| `analysis/shared/out-of-race.ts:8` | `resultStatus` | out of race (gaps, lap-times) |
| `analysis/shared/drs-status.ts:13-21` | DRSE/DRSD events in history | DRS on/off and reason (battle) |
| `analysis/lap-times/calculator.ts:63,142` | `driverStatus`, `pitStatus` | no projection on in/out/garage/pit |
| `analysis/incidents/calculator.ts:141` | `pitStatus` | which cars are pitting (no incident) |
| `analysis/session-remaining/calculator.ts:21` | leader `resultStatus` | laps left 0 at the finish |
| `apps/ui/src/widgets/timing-tower/rows.ts:93,120` | `resultStatus`, `pitStatus`, `driverStatus` (via `cars.overview.timing`) | the tower's PIT/OUT column and unused rows: **a display deciding a situation** (against ADR 0014) |

Every calculator can read these raw statuses: `view.state.cars[i].timing` carries them. So can the UI: `cars.overview` publishes `CarState['timing']` whole. Nothing stops a new reader from adding a decision site.

Fine as they are (they record, not decide): `history/events.ts` maps game events to `RaceEvent` kinds, and `lap-classes`, `fuel`, `tyre-wear` read `LapRecord.inLap` / `outLap` / `scShare`. Those are derived history, but they are derived from the raw-status rules above.

## 8. Rules the tracker work changed that the architecture docs do not hold

Each was ruled in a wave and lives in the spec, a code comment or the run's notes, not in `docs/architecture.md` or an ADR:

1. **History is rewritten, not only appended:** formation discard, start re-stamp (§6). `docs/architecture.md` still says "append-only".
2. **`delta.truncated` has three meanings:** "the history changed", "readers must restart although nothing changed" and "no rewind before here" (`rewritten` vs `discarded`). Every consumer treats them alike except the runner's snapshots.
3. **A race clock separate from the game's session time** (§5), including a monotonic offset after unexplained falls.
4. **The shared-moment rule** (§6): a guard that must know every time-stamped history list.
5. **The view grows a field per tracker:** `activeFlagPhase`, then `situation`. The plan adds `situation.cars` and `situation.raceControl`. It is the only door from `open` to calculators.
6. **The engine reads wall-time differences** (pauses, simulated end). This one *is* in `docs/architecture.md`.
7. **Ordering coupling inside `step`:** "the first history step" carries meaning (`step.ts:44`). `pit-stops` must run before `laps`, and `stints` after `laps` (comments in each module).

## 9. What is scheduled to land on these seams

From the situations plan (Tasks 3–9):
- `history.carSituations` and `open` per car;
- `view.situation.cars`;
- laps, pit stops and stints from the spans;
- `history.penaltiesServed`;
- `LapRecord.conditions`;
- `history.raceControl` and `view.situation.raceControl` (DRS, `compoundRuleWaived`);
- `FlagPhase` removed;
- topics `session.phase` / `session.phases`;
- `cars.overview.situation`;
- behaviour tables per analysis and the completeness test;
- storage schema 3.

From SP4a (`docs/superpowers/specs/2026-10-30-strategy-live-calls-design.md`):
- `pit-loss` and the forecast read `pitStops`, `laps`, `flagPhases`;
- `race-moment` gains `window`;
- a knowledge table bumps the schema;
- the forecast scoreboard taps the FeedPipeline output.

SP4a was written against `flagPhases` and the raw pit model.

## 10. Open seams (inputs for the contract)

1. One situation model or two: the `flagPhases` mirror, raw statuses on `CarState.timing` and in `cars.overview`.
2. The door from the tracker to readers: per-field `view.situation.*`, history lists, topics, or all three.
3. What history may do: append, cut back, replace. Who may do it, and how a reader learns which.
4. Whether `truncated` stays one flag or says why.
5. How a new time-stamped history list joins the shared-moment rule without a hand-kept list.
6. Ordering inside `step`: implicit by array position, or declared.
7. Whether car situations, race control and session phases are one machine or three, and their names, files and owners (engine `state/**` is supervisor-owned).
8. Which situation facts are stored (schema), which are published (topics), which are display-only (`pauses`).
9. How analyses and displays state their per-situation behaviour (plan Task 7's tables) and where that table type lives.
10. What SP4a consumes instead of `flagPhases` and the raw pit model.
