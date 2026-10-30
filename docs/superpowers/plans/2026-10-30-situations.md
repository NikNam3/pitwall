# Special Situations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo every task has two phases by two agents (CLAUDE.md "Workflow"): a test agent writes the failing tests and commits them, an implementation agent makes them pass without touching them.

**Goal:** One situation tracker in the engine records session phases, car situations and race control as history spans; every engine module, analysis and display reads them and behaves per situation by an explicit table.

**Architecture:** A new first history step `applySituations` (`packages/engine/src/history/situations/`) owns three state machines (session phase, per-car situation, race control). Closed spans go to the history (`sessionPhases`, `carSituations`, `raceControl`), open ones live in `state.open.situations` and reach calculators as `view.situation`. Laps, stints and pit stops derive from the spans; `flags.ts` and the clock-reset rule go; analyses and displays carry per-situation behaviour tables checked by a completeness test.

**Tech Stack:** TypeScript (Node type stripping), pnpm monorepo, vitest + fast-check, Svelte 5, better-sqlite3, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-situations-design.md` (approved 2026-10-30). Facts: `.superpowers/sdd/2026-10-30-storage-c-39-40/situations-inventory.md`, `t1-diagnosis.md`.

## Global Constraints

- Every rule of CLAUDE.md "Rules" (units, `Known` for missing data, no `enum`, pure engine and analysis, expected problems are values, registration by convention, `packetFormat === 2025`).
- Tests on real data: segments under 1 MB cut with `pwrec-cut` from normal sessions, one behaviour per test; whole recordings only in acceptance for whole-pipeline properties; never recording facts (`docs/testing.md`).
- A log reads the history only (`docs/architecture.md`); every brief lists the readers of every changed output.
- No module other than `history/situations/` reads `pitStatus`, `driverStatus`, `resultStatus`, `safetyCarStatus`, SCAR, STLG, LGOT, RTMT, DTSV, SGSV, RDFL, CHQF, RCWN, SEND or DRSE/DRSD to decide a situation (spec 2.1).
- Thresholds (spec 3.3, 4.3, 11): start settling within **60 frames** after the race's LGOT; DSQ confirmed by PENA type 6 or **2 s** unchanged; neutralisation confirmed within **3 s** of its SCAR (an unconfirmed one is dropped, also at SEND); offline pause after **2 s** wall time without packets; post-session jump **> 60 s** forward. Each gets a source note (user ruling 2026-10-30 / inventory section).
- Every reader of `FlagPhase` moves to the session phases; `FlagPhase` and `history.flagPhases` are removed (spec 11, default ruling).
- Storage schema bumps to 3 (the database is a cache; `pitwall live` rebuilds). SP4a's planned bump becomes 4: note it in `sp4a-handoff.md`.
- Commands prefixed `nice -n 10` while the user may be testing live; `PITWALL_FIXTURES_DIR=/home/nklx/dev/personal/pitwall/recordings`.
- Everything a review finds is must-fix (user ruling 2026-10-30).

## Review Focus

1. **A flashback across a span boundary** (rewind from after an SC ends to inside it; from after a stop to inside the pit lane): spans after the target are truncated, the open span is the snapshot's, and every reader equals a fresh run. → Task 1 (session), Task 3 (car).
2. **A bridge joining mid-session** (no SSTA, first frame mid-lap or mid-SC, MiP starts at 121.6 s): the tracker opens the current phase and situations at the first frame with `start` unknown-ish semantics (`joinedAt` detail), no false transitions, DRS on. → Task 1, Task 3, Task 5.
3. **The session end in each of its six shapes** (inventory 1.6–1.7): no false `finished` for cars set to `resultStatus` 3 mid-lap in the last frame; `post-session` opens on SEND, on the simulation jump and on a UID-0 classification. → Task 1, Task 3.
4. **Garage acceleration** (session time 4–30× wall time in the garage): no lap, no false pause, no false jump. → Task 1, Task 3.
5. **Signals out of order** (DTSV 7 s after the pit exit; RTMT before `resultStatus`; PENA 16/42 4 s before RTMT; SCAR before the status): each transition waits for or matches its confirmation as the spec says. → Task 3, Task 5.

---

## Task 0: Integration follow-ups of wave 2

**Files:** Modify `packages/analysis/src/gaps/calculator.ts` (out-of-race set), `apps/ui/src/widgets/gap-chart/GapChart.svelte` and `gap-chart/*.ts` (use the kit `TextCell`); delete `apps/ui/src/kit/values/UnknownMark.svelte` when no source imports it. Test: `packages/analysis/test/gaps/gaps.test.ts`, `apps/ui/test/kit/unknown-in-kit.test.ts` (the gap-chart exclusion lives there).

**Interfaces:** Consumes `isOutOfRace(car)` from `packages/analysis/src/shared/out-of-race.ts` (Task T7 of wave 2) and the kit `TextCell` (`{ text, reason?, width, align, role?, title? }`).

- [ ] **Step 1 (test agent):** `gaps.test.ts`: "a not-classified car leaves the intervals like a retired one" (the shared set includes `notClassified`); `unknown-in-kit.test.ts`: the source scan includes `widgets/gap-chart` (remove its exclusion). Run: both fail.
- [ ] **Step 2 (implementer):** `gaps` filters with `isOutOfRace`; the gap chart renders its reference cell through `TextCell`; delete `UnknownMark.svelte` (grep: no importer left).
- [ ] **Step 3:** `nice -n 10 pnpm vitest run packages/analysis/test/gaps apps/ui/test/gallery` passes; typecheck, lint, depcruise clean.
- [ ] **Step 4:** commit `refactor: gaps and the gap chart use the shared out-of-race set and the kit text cell`.

## Task 1: Situation tracker and session phases (spec 3.1–3.3, 2)

**Files:**
- Create: `packages/domain/src/situations.ts` (supervisor commit first, see Interfaces), `packages/engine/src/history/situations/session-phase.ts`, `packages/engine/src/history/situations/time-jumps.ts`, `packages/engine/src/history/situations/index.ts` (`applySituations`).
- Modify: `packages/engine/src/state/engine-state.ts` (`History.sessionPhases`, `History.pauses`, `OpenTrackers.situations`; supervisor), `packages/engine/src/step/step.ts` (`applySituations` first among history steps), `packages/engine/src/step/types.ts` (change tag `sessionPhases`), `packages/engine/src/calc/types.ts` (`EngineView.situation`; supervisor), `packages/engine/src/runner/session-runner.ts` (remove `#clockReset`; time jumps via the tracker), `packages/engine/src/history/flags.ts` (produces `FlagPhase` only from the tracker's neutralised/suspended spans until Task 6 removes it), `packages/engine/src/history/delta.ts`, `packages/engine/src/runner/snapshots.ts` (restart at the formation discard).
- Delete: `packages/engine/src/history/clock-reset.ts` and the `clockReset` field of `StepResult` (its readers in `apps/bridge/src/pipeline` reset on `delta.truncated` as before).
- Tests: `packages/engine/test/situations/session-phase.test.ts`, `time-jumps.test.ts`; segments `fixtures/segments/race-singapore-wet-start.pwrec.gz` [0, 1.6], `race-zandvoort-online-start.pwrec.gz` [0, 2.1], `race-zandvoort-uid-reuse-start.pwrec.gz` [0, 1.0] with index entries; `apps/bridge/test/fixtures/race-start.test.ts`; rewrite `apps/bridge/test/fixtures/race-zandvoort-clock-reset*.test.ts` to "a fall that is no start changes nothing".

**Interfaces:**
- Consumes: the frame (`packages/engine/src/frame/frame.ts`), `state.session`, events.
- Produces (domain, `packages/domain/src/situations.ts`):
  ```ts
  export type SessionPhaseKind = 'preStart' | 'formation' | 'startLights' | 'racing' | 'running' | 'neutralised' | 'suspended' | 'finished' | 'postSession';
  export type NeutralisedStage = 'deployed' | 'returning' | 'returned' | 'resume';
  export type SessionPhaseDetail =
    | { kind: 'neutralised'; car: 'SC' | 'VSC'; stages: { stage: NeutralisedStage; at: SessionTime }[] }
    | { kind: 'suspended'; restart: Known<'standing' | 'rolling'> };
  export type SessionPhaseSpan = { kind: SessionPhaseKind; start: SessionTime; end: SessionTime; startLeaderLap: number; endLeaderLap: number; joinedAt?: true; detail?: SessionPhaseDetail };
  export type OpenSessionPhase = Omit<SessionPhaseSpan, 'end' | 'endLeaderLap'>;
  export type PauseSpan = { start: SessionTime; wallMs: number; kind: 'offline' | 'online' };
  ```
  Engine: `History.sessionPhases: SessionPhaseSpan[]`, `History.pauses: PauseSpan[]`, `EngineView.situation: { session: OpenSessionPhase; paused: boolean }` (Task 3 adds `cars`, Task 5 `raceControl`). `applySituations(state, frame, out)` is a `SubStep`. The race start is `racing`'s `start`.

- [ ] **Step 0 (supervisor):** commit the domain types and the supervisor-owned engine-state / calc-type fields.
- [ ] **Step 1 (test agent):** builder tests, one per transition of spec 3.1 (opens on / closes on / confirmation / drop when unconfirmed, VSC → SC upgrade, double resume), the formation discard (3.2: crossings, OVTK and the DSQ transient of the formation phase gone; STLG and LGOT kept; every lap cursor `fromStart` at lights out; snapshots restarted), each time jump of 3.3 (start settling re-stamped within 60 frames; formation reset ignored; acceleration no jump; post-session jump; any other fall logged and unchanged), pauses (offline > 2 s, online `gamePaused`), practice/qualifying phases, time trial `running` only, a join mid-session (Review Focus 2), the six session-end shapes (Review Focus 3), a flashback across a phase boundary (Review Focus 1). Segment tests on the three new start segments and `race-singapore-start` (S1): the race start is known and equals the LGOT on every shape; no history entry from the formation lap survives; the gapper has a race start. Run: all fail.
- [ ] **Step 2 (implementer):** implement the tracker and its session machine per spec 3.1–3.3; remove the clock-reset rule; `flags.ts` keeps producing `FlagPhase` from the tracker's spans (no own signal reading).
- [ ] **Step 3:** `nice -n 10 pnpm vitest run packages/engine/test apps/bridge/test/fixtures apps/bridge/test/pipeline` passes; typecheck, lint, depcruise clean.
- [ ] **Step 4:** commit `feat(engine): the situation tracker records the session phases; the formation lap is discarded at lights out`.

## Task 2: The frame assembler keeps a start that stale headers would hide (spec 10 step 1)

**Files:** Modify `packages/engine/src/frame/assembler.ts`, `packages/engine/src/frame/session-tracker.ts` (as needed). Test: `packages/engine/test/frame/assembler.test.ts`, a segment test on `race-zandvoort-uid-reuse-start`.

**Interfaces:** unchanged.

- [ ] **Step 1 (test agent):** "packets whose header frame id lags behind a stale packet type's frozen header are not dropped as late": builder packets with one packet id (LapPositions) frozen at frame 10539 while the others count up from 0; every frame is assembled. Segment: the uid-reuse start segment yields frames from its first second (lights out seen). Run: fail.
- [ ] **Step 2 (implementer):** judge lateness per packet id (or ignore a packet id whose header stops advancing), not by the overall maximum.
- [ ] **Step 3:** engine frame tests and `apps/bridge/test/fixtures` pass.
- [ ] **Step 4:** commit `fix(engine): a packet type with frozen headers no longer makes every other packet late`.

**Merge point (spec 10):** after Tasks 0–2, gate `integ/live-fixes` (`pnpm check`, `pnpm test:ui` with baselines, `pnpm test:acceptance`), a review of the diff since 1d86112, fix wave, merge to main, push, tell the user to restart. SP4a stays on hold until the end gates of the whole plan (user, 2026-10-30).

## Task 3: Car situations (spec 4.1, 4.3)

Additions from review 2 (2026-10-30): the engine records a finisher's finish-line crossing (the game holds the lap number and wraps the lap distance at the flag: push `(lap + 1, segment 0)` at that wrap) and no mini-sector crossings in `coolDown` (finish segment from `raceFriendWet` about 2215–2232 s, under 1 MB, one behaviour: every finisher's final lap is in `lineTimes` and on the gapper); `history/laps.ts` (`scMs`/`vscMs`) and `pit-stops.ts` stop reading the raw safety car status (spans instead).

**Files:** Create `packages/engine/src/history/situations/car-situation.ts`; modify `situations/index.ts`, `engine-state.ts` (`History.carSituations`, open per car; supervisor), `calc/types.ts` (`EngineView.situation.cars`; supervisor). Tests: `packages/engine/test/situations/car-situation.test.ts`; segments (existing): `race-zandvoort-pit-stop`, `race-zandvoort-pit-exit`, `race-drive-through`, `practice-wing-change`, `race-zandvoort-retire`; new under 1 MB where the catalogue names a window (garage entry and exit from `practiceFriendWings`, a finish from `raceWetVscMexico`).

**Interfaces:**
- Produces (domain):
  ```ts
  export type CarSituationKind = 'garage' | 'pitLane' | 'stationary' | 'servingPenalty' | 'onTrack' | 'retired' | 'finished' | 'coolDown' | 'joinedLate' | 'spectated';
  export type CarSituationDetail =
    | { kind: 'servingPenalty'; penalty: 'driveThrough' | 'stopGo'; givenAt: Known<SessionTime> }
    | { kind: 'retired'; cause: Known<'mechanical' | 'terminalDamage' | 'disqualified' | 'other'> }
    | { kind: 'onTrack'; lapRole: 'outLap' | 'flying' | 'inLap' };
  export type CarSituationSpan = { carId: CarId; kind: CarSituationKind; start: SessionTime; end: SessionTime; lap: number; detail?: CarSituationDetail };
  export type OpenCarSituation = Omit<CarSituationSpan, 'end'>;
  ```
  `History.carSituations: CarSituationSpan[]`; `EngineView.situation.cars: ReadonlyArray<OpenCarSituation | undefined>` indexed by car id. `stationary` and `servingPenalty` are recorded as spans of their own, nested in time inside a `pitLane` span.

- [ ] **Step 0 (supervisor):** commit the domain types and the state/view fields.
- [ ] **Step 1 (test agent):** builder tests per row of spec 4.1 (each opening and closing signal and variant: garage ps 0/1, entry without ps 2, the teleports, retired cars in the garage; stop vs pass-through; DT matched to a DTSV up to 10 s after the exit; SG on `stationary` + SGSV; retired by RTMT with the cause from PENA 16/41 or 16/42; finished at the line with the frozen lap time; the last-frame `resultStatus` 3 mid-lap is no finish; DSQ confirmation 4.3; joins and spectating fail safe), lap roles (out/in/flying; the drive-through lap is both; `driverStatus` flicker ignored), a flashback inside a pit visit (Review Focus 1), garage acceleration (Review Focus 4), signals out of order (Review Focus 5). Segment tests on the listed segments: one behaviour each. Run: fail.
- [ ] **Step 2 (implementer):** implement the per-car machine in the tracker.
- [ ] **Step 3:** `packages/engine/test` and `apps/bridge/test/fixtures` pass.
- [ ] **Step 4:** commit `feat(engine): the situation tracker records each car's situation`.

## Task 4: Laps, pit stops and stints from the spans; lap conditions; rates per stint (spec 4.2, 4.4, 5)

**Files:** Modify `packages/engine/src/history/laps.ts`, `pit-stops.ts`, `stints.ts`, `lap-samples.ts`; `packages/domain/src/records.ts` (`LapRecord.conditions`, `PenaltyServedRecord`; supervisor); `engine-state.ts` (`History.penaltiesServed`); `packages/analysis/src/{tyre-wear,fuel,ers}/calculator.ts`; storage (`apps/bridge/src/storage/*`, schema 3, table `penalties_served`). Tests: bring in wave-2 branches `w2/laps` (T4: the race's final out lap, the latched stint split, renames) and `w2/rates` (T5: no run restart, no `reads: 'stints'`, the builder's derived start samples), adapted to the spans (merge the branches into this task's branch first; their test expectations stay; T4's `pendingSet` latch test becomes "a same-compound set fitted at age 0 or 1 opens a stint at the box exit").

**Interfaces:**
- Consumes: Task 3's spans.
- Produces:
  ```ts
  export type LapConditions = { fuelMix: { mix: FuelMix; share: Ratio }[]; ersMode: { mode: ErsDeployMode; share: Ratio }[]; weather: { start: Weather; end: Weather }; trackTempC: { start: number; end: number }; airTempC: { start: number; end: number } };
  // LapRecord.conditions: Known<LapConditions> (notReceived for a lap joined after its start)
  export type PenaltyServedRecord = { carId: CarId; penalty: 'driveThrough' | 'stopGo'; givenAt: Known<SessionTime>; servedAt: SessionTime; lap: number; pitLaneEntry: SessionTime; pitLaneExit: SessionTime };
  ```
  (`FuelMix`, `ErsDeployMode`, `Weather`: existing domain names where present, else added with the game's codes.) `History.penaltiesServed: PenaltyServedRecord[]`.

- [ ] **Step 0 (supervisor):** commit the domain types, state fields, schema 3 DDL note.
- [ ] **Step 1 (test agent):** lap records from the spans (out/in roles; race lap rises at the pit-lane line, practice/qualifying lap restarts at the line after the out lap; no records in `coolDown`/`postSession`; `scShare`/`vscShare` from `neutralised` spans); pit stops only for `pitLane`+`stationary`; a DT pass gives a `PenaltyServedRecord`, no stop; garage departures and teleports give nothing; stints at the exit of `stationary`/`garage` on a different set, a red-flag tyre change opens a stint; lap conditions (shares sum to 1; weather and temperatures at start and end); rates per stint, fuel only over the stint's laps at the current fuel mix, ERS only at the current deploy mode; storage round trip of `penaltiesServed` and `conditions`; reprocess. Merge `w2/laps` and `w2/rates` tests as described. Run: fail.
- [ ] **Step 2 (implementer):** rewrite the three history modules on the spans (no raw status reads, Global Constraints); conditions sampled in `lap-samples.ts`; rates filtered; storage.
- [ ] **Step 3:** `packages/engine/test`, `packages/analysis/test`, `apps/bridge/test` pass.
- [ ] **Step 4:** commit `feat(engine): laps, pit stops and stints from the situation spans; lap conditions; rates per stint at the current mix`.

## Task 5: Race control spans (spec 3.4)

Addition from review 2: the formation discard drops DRSE/DRSD sent before lights out (S4); reconcile with spec 3.4 "a DRSD before lights out stands" (DRS events are race control, not formation history: keep them through the discard, or rule otherwise with the user).

**Files:** Create `packages/engine/src/history/situations/race-control.ts`; modify `engine-state.ts` (`History.raceControl`), `calc/types.ts` (`EngineView.situation.raceControl`), `packages/analysis/src/battle/calculator.ts`; delete `packages/analysis/src/shared/drs-status.ts`. Tests: bring in `w2/drs` (T3) and adapt to the spans.

**Interfaces:**
- Produces: `export type RaceControlSpan = { kind: 'drs'; status: DrsStatus; start: SessionTime; end: SessionTime }`; `History.raceControl: RaceControlSpan[]`; `EngineView.situation.raceControl: { drs: DrsStatus; compoundRuleWaived: ReadonlyArray<boolean> }` (by car id; true from the first race lap on intermediates or wets). The engine maps an unknown DRSD reason code to `'unknown'`.

- [ ] **Step 0 (supervisor):** domain and state/view fields.
- [ ] **Step 1 (test agent):** the rules of spec 3.4 (before lights out `notEnabledYet`; a DRSD before lights out stands; after a late join with no DRS event, on; DRSE/DRSD; an unknown code is `unknown`); `BattleCard.drs` from the view; the `race-zandvoort-vsc` segment; T3's tests adapted; `compoundRuleWaived` (false on slicks, true from the first race lap on intermediates or wets and stays true, false in practice and qualifying). Run: fail.
- [ ] **Step 2 (implementer):** implement; battle reads `view.situation.raceControl.drs`.
- [ ] **Step 3:** engine and analysis tests pass.
- [ ] **Step 4:** commit `feat(engine): race control spans; DRS status from them`.

## Task 6: Every reader moves to the session phases; FlagPhase goes (spec 5, 11)

**Files:** Modify `packages/analysis/src/{gaps,incidents,race-moment}/calculator.ts`, `packages/engine/src/calc/scheduler.ts`, `packages/engine/src/step/types.ts`, `packages/contracts/src/topics/` (`flagPhases.ts` → `session.phases.ts`; supervisor), `apps/bridge/src/features/history/register.ts`, storage (table `session_phases` replaces `flag_phases`; schema 3), UI readers of the `flagPhases` topic (gap chart via the gapper only). Delete `packages/engine/src/history/flags.ts`, `FlagPhase`, `ScPhase`, `History.flagPhases`, `EngineView.activeFlagPhase`.

**Interfaces:** Consumes Tasks 1, 3, 5. Produces the topic `session.phases` (append, `SessionPhaseSpan`) and `session.phase` (state, `OpenSessionPhase & { paused: boolean }`).

- [ ] **Step 1 (test agent):** for each former reader, its current tests restated on `sessionPhases` and `view.situation.session` (gaps' race start from `racing`, the gapper's phases from `neutralised`/`suspended`; incidents' phase entries; race-moment's `neutralised`/`suspended`); storage round trip of `session_phases`; the topics. Run: fail (types missing).
- [ ] **Step 2 (implementer):** move the readers; delete the listed code; grep shows no `FlagPhase`/`flagPhases` left outside docs history.
- [ ] **Step 3:** `pnpm check` passes.
- [ ] **Step 4:** commit `refactor: every reader uses the session phases; flag phases removed`.

## Task 7: Behaviour tables on the matrix and the completeness test (spec 6, 7)

**Files:** Each analysis in `packages/analysis/src/<unit>/` gets `situations.ts`: a `SituationBehaviour<Out>` table read by its calculator. Create `packages/analysis/src/shared/situation-behaviour.ts` (the table type and `behaviourFor(view, carId)`), `packages/analysis/test/situations/completeness.test.ts`. Split across three agents with disjoint units: (a) `tyre-wear`, `fuel`, `ers`, `pace`, `lap-times`, `lap-classes`; (b) `gaps`, `battle`, `incidents`, `damage`; (c) `car-bands`, `alarms`, `race-moment`, `session-remaining`.

**Interfaces:**
- Produces:
  ```ts
  export type SituationKey = SessionPhaseKind | CarSituationKind | 'paused';
  export type SituationBehaviour<B> = Record<SituationKey, B>;
  export function behaviourFor<B>(table: SituationBehaviour<B>, view: EngineView, carId?: CarId): B[]; // the rows that apply now: the session phase's, the car's, 'paused' when paused
  ```
  Each unit exports its table as `<UNIT>_SITUATIONS` from its `index.ts`, with the row values of spec 6 for that unit.

- [ ] **Step 1 (test agent, per group):** one test per matrix row of the group's units (builder views with the situation set), asserting spec 6's cell; `completeness.test.ts`: every exported `*_SITUATIONS` table has every `SituationKey`. Run: fail.
- [ ] **Step 2 (implementer, per group):** the tables and the calculators reading them.
- [ ] **Step 3:** `packages/analysis/test` passes.
- [ ] **Step 4:** commit `feat(analysis): behaviour per situation, by one table per analysis`.

## Task 8: Situation topics and display (spec 8)

**Files:** contracts: `packages/contracts/src/topics/session.phase.ts` (Task 6), `cars.overview.ts` gains `situation` (supervisor); bridge feature `apps/bridge/src/features/session-info/` or a new `situations/` feature publishes; UI: `apps/ui/src/shell/topbar/segments/Phase.svelte` (new; shell is supervisor-owned: delegated), `apps/ui/src/widgets/timing-tower/` (situation column replaces `pit`), texts in `text.ts`, roles in `emphasis.ts`; gallery cases per situation; one screenshot baseline change at most per display size (budget).

**Interfaces:** `CarOverview.situation: { kind: CarSituationKind; since: SessionTime; detail?: CarSituationDetail }`. Tower column codes: `GARAGE`, `PIT`, `BOX`, `DT`, `SG`, `OUT`, `IN`, `RET`, `FIN`; empty on a flying lap. Top bar labels: `FORMATION`, `START`, `SC`/`VSC` + stage, `RED`, `FINISHED`, `PAUSED`; hidden while `racing`/`running`.

- [ ] **Step 1 (test agent):** row tests for the tower column and the top-bar segment per situation; gallery cases; the display behaviour rows of spec 6. Run: fail.
- [ ] **Step 2 (implementer):** topics, features, displays.
- [ ] **Step 3:** `pnpm check`, `pnpm test:ui` (supervisor updates baselines).
- [ ] **Step 4:** commit `feat(ui): the tower and the top bar show the situations`.

## Task 9: The situations catalogue and the recording checklist (spec 9)

Addition from review 2: a penalty given during the formation lap is discarded with it while the car's penalty counters stay: the catalogue says so, and the recording checklist asks for one.

**Files:** Create `docs/research/09-situations-catalogue.md` from the inventory and the diagnosis, one section per situation: signals with times in our recordings, the tracker's rule (link to the code), the behaviour row, the test (segment or builder), "seen in" / "not yet seen". Update `docs/testing.md` section 3 (the start segments) and `docs/architecture.md` (the tracker in the data flow, "Where state lives").

- [ ] **Step 1 (one agent, docs only):** write the catalogue; every situation of spec 3.1 and 4.1 appears; every "not yet seen" situation names its recording on the checklist.
- [ ] **Step 2 (supervisor):** review against the code; give the user the recording checklist (spec 9).
- [ ] **Step 3:** commit `docs: the situations catalogue`.

## End gates

After Task 9: `pnpm check`, `pnpm test:ui` (baselines shown to the user), `pnpm test:acceptance`; a final review of the diff since the merge point with the user's three questions (A hasty architecture, B fixes causing later bugs, C workarounds); a fix wave; merge to main; push; tell the user to restart; then SP4a may start (rewrite `sp4a-handoff.md` first).
