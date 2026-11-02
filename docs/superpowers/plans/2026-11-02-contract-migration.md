# Contract Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo every task has two phases by two agents (contract C82): a test agent writes the failing tests and commits them, an implementation agent makes them pass without touching them. Supervisor steps (marked **supervisor**) commit contract-first types (C81) and run gates.

**Goal:** The existing code follows every clause of `docs/architecture.md` (the contract), so that new work (SP4a and later) can start under C0.

**Architecture:** A strangler migration. The engine gets its four steps, the signals module, the log with stamps and void facts, the projection and the machine registry first; the existing situation tracker is ported into sub-machines; then every other sub-machine is built; the recorders, the view and every analysis move onto situations and the projection; then signals leave the `domain` types and the UI renders situations; storage becomes an append-only cache of logs with a rules version. Old mechanisms (`FlagPhase`, `delta.truncated`, the formation discard, the start re-stamp, the shared-moment rule, raw status reads) are deleted in the task that replaces them, with their tests (C82). `pnpm check` is green after every task.

**Tech Stack:** TypeScript (Node type stripping), pnpm monorepo, vitest + fast-check, Svelte 5, better-sqlite3, Playwright.

**Spec:** `docs/architecture.md` (the contract, approved 2026-11-02). Inputs: `docs/history/specs/2026-11-02-race-state-machine/01-current-architecture.md` (the survey: §7 decision sites, §8 unwritten rules), `docs/history/specs/2026-11-02-race-state-machine/03-traceability.md` (§5 enforcement to build), `docs/research/09-situations-inventory.md` (the facts every sub-machine rests on), `docs/testing.md`. Replaces Tasks 3–9 of `docs/history/plans/2026-10-30-situations.md`; precedes SP4a (void until re-specced).

## Global Constraints

- **C0:** no task may violate the contract. A task that needs a different contract stops and reports a contract gap; every task of the migration stops at its next commit until the user decides.
- Every brief follows `docs/tasks/_template.md` and lists the clauses its task touches (C83); every clause number below refers to `docs/architecture.md`.
- Ownership (C78): `packages/domain/**`, the contracts package (except a unit's own topic files), `packages/engine/src/{state,signals,log,situations/machine.ts,situations/registry*.ts,runner,step/step.ts}`, the UI kit, shell, connection, theme, emphasis, every `package.json`, the lockfile and root configs are supervisor-owned. Steps marked **supervisor** change them; a worker lists requests in its report.
- Test levels (C88): a worker runs `nice -n 10 pnpm vitest related <changed files>` plus `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`; the supervisor runs `nice -n 10 pnpm check` before every merge; `pnpm test:ui` and `pnpm test:acceptance` at the end of each milestone (M1–M7). Read vitest's `Errors` line as well as `Tests`.
- `PITWALL_FIXTURES_DIR=/home/nklx/dev/personal/pitwall/recordings` for every test run in a worktree.
- Segments (C84): at most 1 MB, cut with `pwrec-cut` from a normal session, one behaviour each; new segments get an entry in `fixtures/index.json`; times come from `docs/research/09-situations-inventory.md`. Whole recordings only in acceptance. No test asserts a fact of a recording; the time trial is no fixture.
- No test reads the priors store, storage or `PITWALL_DATA_DIR` (C84): the test setup points the data dir at an empty temporary directory.
- A test of a deleted mechanism is deleted in the task that deletes the mechanism; a test of behaviour that stays is ported, never dropped (C82).
- Every new sub-machine starts at `version: 1`; a later change to its folder bumps it (C90).
- Thresholds carried over unchanged, each with its source note: start settling within 60 frames after LGOT; neutralisation confirmed within 3 s of its SCAR; DSQ confirmed by PENA type 6 or 2 s unchanged; offline pause after 2 s wall time; post-session jump > 60 s and > 60 × wall time; the race under way above a 1000 ms lap timer.
- Not built by this plan (no code violates the clause today; the first feature that needs them builds them): the priors store (C62a), decisions and their sidecar (C76), automatic layout switch rules and the pin (C67).
- There is no flashback fact and no flashback insight (C27, C52): the bridge's `flashbackChanges` goes in Task 3.
- Every log writer (sub-machine, recorder, step 0, step 1 module) holds its `version` in its own file (C90); the rules version hashes them all (C61).

## Review Focus

1. **A flashback across a span boundary** (rewind from after an SC ends to inside it; from after a pit exit to inside the pit lane; across lights out): the void starts at the snapshot, the replay re-appends, span ids repeat what a straight run gives, and every topic equals a straight run. → Task 3 (property), Task 9, Task 17.
2. **Joining a session in progress in each weekend phase** (no SSTA; first frame mid-lap, mid-SC, in the garage; MiP starts at 121.6 s): every sub-machine opens its current span with `joinedAt`, no false transition, DRS on after a late race join. → each sub-machine's join rows (Tasks 9–16).
3. **The session end in each of its six shapes** (inventory §1.6–1.7): no `finished` activity for cars set to `resultStatus` 3 mid-lap in the last frame; `postSession` on SEND, on the simulation jump and on a UID-0 classification. → Tasks 9, 12.
4. **Garage time acceleration** (session time 4–30× wall time): no lap, no pause, no clock jump. → Tasks 7, 12, 17.
5. **Signals out of order** (DTSV up to 10 s after the pit exit; RTMT a frame before `resultStatus`; PENA 16/42 4 s before RTMT; SCAR before the status): each sub-machine waits for or matches its confirmation and never withdraws a fact. → Tasks 11, 12, 15.

## Milestones and order

| Milestone | Tasks | Runs in parallel |
|---|---|---|
| M1 core | 1–8 | serial (shared engine core) |
| M2 sub-machines | 9–16 | up to 8 lanes after Task 8; Tasks 9 and 10 first, Task 15 before Task 11 (others read their outputs) |
| M3 recorders | 17 | serial |
| M4 view and analyses | 18–23 | 18 first, then 19; the lanes of 20 in parallel; then 21, 22, 23 (22 and 23 in parallel) |
| M5 signals leave domain, UI | 24–26 | 24 first, then 25 and 26 in parallel |
| M6 storage | 27–28 | 27 after Task 21 (storage still reads flag phases and the removed event kinds until then); 28 after 27 |
| M7 docs and gates | 29–30 | serial |

---

## M1. The engine core

### Task 1: Contract-first types (supervisor)

**Clauses:** C21, C24, C26, C27, C35–C36, C14, C15, C81.

**Files:**
- Create: `packages/domain/src/facts.ts`, `packages/domain/src/weekend-phase.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/records.ts` (add `in: Stamp` to `LapRecord`, `StintRecord`, `PitStopRecord`, `MiniSectorCrossing`, `RaceEvent`)
- Create: `packages/engine/src/log/types.ts`, `packages/engine/src/situations/machine.ts`, `packages/engine/src/signals/types.ts`

**Interfaces (produced; every later task uses these names):**
```ts
// domain/facts.ts
export type MachineId = string;                      // a sub-machine's folder name, kebab-case
export type SpanId = number;
export type Stamp = Readonly<Record<MachineId, SpanId>>;
export type FactList = 'laps' | 'stints' | 'pitStops' | 'crossings' | 'events' | 'clock' | 'voids' | `spans:${MachineId}`;
export type FactRef = { list: FactList; index: number };
export type Span<K extends string = string, D = undefined> = {
  machine: MachineId; id: SpanId; carId?: CarId; kind: K;
  start: SessionTime; end: SessionTime; confirmed: boolean; joinedAt?: true; detail: D; in: Stamp };
export type OpenSpan<K extends string = string, D = undefined> = Omit<Span<K, D>, 'end' | 'in'>;
export type VoidFact = { target: { frameId: number; at: SessionTime }; ranges: Partial<Record<FactList, readonly [from: number, to: number]>>; in: Stamp };
export type ClockFact =
  | { kind: 'fall'; at: SessionTime; fromMs: SessionTime; toMs: SessionTime; offsetMs: Ms; in: Stamp }
  | { kind: 'jump'; at: SessionTime; fromMs: SessionTime; toMs: SessionTime; in: Stamp }
  | { kind: 'pause'; at: SessionTime; start: SessionTime; wallMs: number; source: 'offline' | 'online'; in: Stamp }   // appended when the pause ends
  | { kind: 'simulatedEnd'; at: SessionTime; in: Stamp };
export type SpanRef = { machine: MachineId; carId?: CarId; spanId: SpanId };   // a span, open or closed
export type Scope = 'session' | 'car' | 'zone';
// domain/weekend-phase.ts
export type PracticeFormat = 'practice' | 'shortPractice';
export type QualifyingFormat = 'grandPrix' | 'short' | 'oneShot' | 'sprintShootout' | 'shortSprintShootout' | 'oneShotSprintShootout';
export type RaceFormat = 'grandPrix' | 'sprint';
export type WeekendPhase =
  | { kind: 'pending' } | { kind: 'none' }
  | { kind: 'practice'; format: PracticeFormat; segment: 1 | 2 | 3 | undefined }
  | { kind: 'qualifying'; format: QualifyingFormat; segment: 1 | 2 | 3 | undefined }
  | { kind: 'race'; format: RaceFormat };
export type WeekendPhaseKind = 'practice' | 'qualifying' | 'race';
// engine/log/types.ts
export type FactOf<L extends FactList> = L extends 'laps' ? LapRecord : L extends 'stints' ? StintRecord : L extends 'pitStops' ? PitStopRecord
  : L extends 'crossings' ? MiniSectorCrossing : L extends 'events' ? RaceEvent : L extends 'clock' ? ClockFact : L extends 'voids' ? VoidFact : Span;
export type LogLengths = Partial<Record<FactList, number>>;
export type HistoryDelta = { before: LogLengths; after: LogLengths; rewound?: VoidFact['target'] };
export interface LogWriter { append<L extends FactList>(list: L, fact: FactOf<L>): FactRef; lengths(): LogLengths }
export type Projection = DeepReadonly<{ laps: LapRecord[]; stints: StintRecord[]; pitStops: PitStopRecord[]; crossings: MiniSectorCrossing[]; events: RaceEvent[]; clock: ClockFact[]; spans: Record<MachineId, Span[]> }>;
// engine/situations/machine.ts
export type MachineInputs = { signals: readonly SignalKey[]; values: readonly LiveArea[]; upstream: readonly MachineId[] };
export type MachineStep<Open> = { open: Open; closed: Span[] };
export type SubMachine<Open> = {
  id: MachineId; version: number; appliesTo: 'all' | readonly WeekendPhaseKind[]; scope: Scope; inputs: MachineInputs;
  transitions: ReadonlyArray<readonly [from: string | 'none', to: string]>;
  init(): Open; openSpans(open: Open): OpenSpan[];
  step(open: Open, input: DeepReadonly<MachineInput>): MachineStep<Open> };
export type MachineInput = { frame: FrameOnClock; signals: Signals; live: LiveState; upstream: Record<MachineId, readonly OpenSpan[]>; weekendPhase: WeekendPhase };
// engine/signals/types.ts
export type SignalKey = 'pitStatus' | 'driverStatus' | 'pitLaneTimerActive' | 'resultStatus' | 'numPitStops' | 'shouldServePenalty'
  | 'unservedDriveThroughs' | 'unservedStopGos' | 'timePenaltyMs' | 'totalWarnings' | 'cornerCuttingWarnings' | 'currentLapInvalid'
  | 'fiaFlag' | 'drsAllowed' | 'networkPaused' | 'aiControlled' | 'safetyCarStatus' | 'marshalZones' | 'periods' | 'sessionType'
  | 'weekendStructure' | 'ruleSet' | 'gamePaused' | 'isSpectating' | 'spectatorCarIndex' | 'numActiveCars' | 'events';
export type Signals = { cars: CarSignals[]; session: SessionSignals; events: SituationEvent[] };   // fields as C12 lists them, domain units
```
```ts
// engine/situations/machine.ts (continued)
export type Situation = DeepReadonly<{ weekendPhase: WeekendPhase; session: OpenSpan | undefined; paused: boolean; byMachine: Record<MachineId, OpenSpan[]> }>;
// engine/step/types.ts: every log writer is an object with an id and a version (C90)
export type StateUpdate = { id: string; version: number; apply(frame: Frame, live: LiveState, signals: Signals, out: StepOutput): void };
export type Recorder<Own> = { id: string; version: number; init(): Own; apply(input: DeepReadonly<RecorderInput>, own: Own, log: LogWriter, out: StepOutput): Own };
export type RecorderInput = { at: SessionTime; frameId: number; live: LiveState; situation: Situation; stamps: FrameStamps };
export type FrameStamps = { session: Stamp; cars: readonly Stamp[] };   // a car's fact carries { ...session, ...cars[carId] }; zone spans are never stamped
```
`LiveState` is today's `EngineState` session plus cars without `open`, plus `frameEvents: FrameEvent[]` (the frame's OVTK, COLL, FTLP and SPTP as domain values, written by step 1) and `timing.confirmedLaps` (Session History values, written by step 1), so no recorder receives a frame or a packet (C6); `LiveArea` is today's change tag set minus the history tags; `FrameOnClock` is `Frame` with `sessionTime` on the race clock. `SituationEvent` holds the C12 events with their decoded details.

- [ ] **Step 1 (supervisor):** add the types; `in: Stamp` on the five records defaults to `{}` in every existing constructor (engine recorders, `test-support/builders`, gallery fixtures). Add a vitest `globalSetup` to `vitest.config.ts` that sets `PITWALL_DATA_DIR` to a fresh temporary directory per run (C84); tests that set it themselves keep doing so.
- [ ] **Step 2:** `nice -n 10 pnpm check` passes (types only; no behaviour changed).
- [ ] **Step 3:** commit `feat(domain): fact, span, stamp, void and weekend-phase types; engine log, machine and signal interfaces (contract-first)`.

### Task 2: The log and the projection

**Clauses:** C21–C25, C28, C29 (mechanism), C30 (delta), C34.

**Files:** Create `packages/engine/src/log/log.ts`, `packages/engine/src/log/projection.ts`; modify `packages/engine/src/state/engine-state.ts` (`History` becomes `log: Log` plus `projection: ProjectionState`; supervisor), `packages/engine/src/history/delta.ts` (delete; `HistoryDelta` from `log/types.ts`), every `history/*.ts` writer (append through `LogWriter`), `packages/engine/src/calc/types.ts` (`view.state.history` is the `Projection`), `packages/engine/src/calc/scheduler.ts` (`truncated` → `rewound`), `apps/bridge/src/pipeline/{session-processor,topic-publisher,session-storage}.ts`, `apps/bridge/src/storage/storage-writer.ts` (consumes `rewound`). Tests: `packages/engine/test/log/log.test.ts`, `packages/engine/test/log/projection.test.ts`.

**Interfaces:**
- Consumes: Task 1.
- Produces (C28: `.dependency-cruiser.cjs` allows importing `log/log.ts` only from `log/projection.ts`, `runner/`, `step/step.ts` and `apps/bridge/src/storage/`; supervisor): `createLog(): Log`; `logWriter(log: Log): LogWriter`; `logLengths(log: DeepReadonly<Log>): LogLengths`; `class ProjectionTracker { constructor(log: DeepReadonly<Log>); get projection(): Projection; update(): { before: LogLengths; after: LogLengths; rewound?: VoidFact['target'] } }`; `isHidden(fact: { in: Stamp }, list: FactList, hidden: HiddenRanges): boolean`. The projection hides a fact inside a void range and a non-span fact whose stamp holds a span of kind `formation` (C29); spans are never hidden by a stamp. While `truncated` still has producers (the runner until Task 3, the tracker until Task 9), the runner maps them to `rewound` with target `{ frameId: -1, at: 0 }`.

- [ ] **Step 1 (test agent):** `log.test.ts`: "append returns the fact's ref (list, index)"; "lengths count every list" (the read-only assertion comes in Task 9, once no old mechanism edits facts). `projection.test.ts`: "a void range hides its facts and the projection shrinks once" (`update().rewound` set, lengths drop); "a fact stamped with a formation span is hidden, the formation span itself is not"; "without a void the projection only grows" (fast-check: random appends, `after ≥ before` per list); "two voids over the same range hide it once". Run: fail.
- [ ] **Step 2 (implementer):** implement the log and the tracker (incremental: appends extend the projected arrays; a new void rebuilds the projection once); move every history writer to `append`; rename `truncated` to `rewound` in scheduler, storage writer, publisher and jobs with no behaviour change; port the tests that assert `truncated` to `rewound`.
- [ ] **Step 3:** `nice -n 10 pnpm vitest related` on the changed files, typecheck, lint, depcruise; supervisor: `nice -n 10 pnpm check`.
- [ ] **Step 4:** commit `feat(engine): an append-only log and its projection; HistoryDelta.rewound replaces truncated`.

### Task 3: A flashback appends a void fact

**Clauses:** C27, C30, C33.

**Files:** Modify `packages/engine/src/runner/session-runner.ts`, `packages/engine/src/runner/snapshots.ts` (supervisor-delegated), `packages/engine/src/calc/scheduler.ts` (bookkeeping snapshot), `packages/engine/src/calc/insight-book.ts`, `apps/bridge/src/pipeline/topic-publisher.ts` (insights resent), `apps/bridge/src/pipeline/session-processor.ts` (delete `flashbackChanges`). Tests also: `apps/bridge/test/pipeline/insights-rewind.test.ts`; delete the tests of the flashback insight. Tests: `packages/engine/test/runner/session-runner-flashback.test.ts` (port), `packages/engine/test/runner/rewind-exactness.property.test.ts`.

**Interfaces:**
- Consumes: Task 2.
- Produces: `SessionRunner` takes `{ attach?: Snapshotable<unknown> }` where `type Snapshotable<S> = { snapshot(): S; restore(s: S): void }`; `Scheduler implements Snapshotable<SchedulerBookkeeping>` (`lastRunAt`, `prevOutput`, the insight book, failed set); the runner appends one `VoidFact` with ranges `[length at the snapshot, length now)` and the target; `StepResult.delta.rewound` carries the target; the replayed frames re-append their facts after the void.

- [ ] **Step 1 (test agent):** "a flashback appends one void fact and removes nothing" (log lengths only grow); "the void starts at the snapshot's lengths, and the replayed frames re-append the facts between the snapshot and the target"; "after a flashback the scheduler's bookkeeping is the snapshot's: an insight raised after the target is gone, one raised before it stays"; property (fast-check over builder races with random flashbacks): "the projection and every calculator output and insight equal a run that never received the undone frames" (C33); `insights-rewind.test.ts`: "on `rewound` the insights topic is resent whole, without the changes after the target" (the publisher keeps the session's insight changes in memory with their frame ids, C32). Port the existing flashback tests from truncation to the void. Run: fail.
- [ ] **Step 2 (implementer):** implement; delete history truncation from the runner (`truncateHistory`).
- [ ] **Step 3:** related tests, typecheck, lint, depcruise; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(engine): a flashback appends a void fact; the scheduler's bookkeeping rewinds with the runner`.

### Task 4: Four steps and the signals module

**Clauses:** C6, C7–C11, C13 (module and import rule; fields leave `domain` in Task 24).

**Files:** Create `packages/engine/src/signals/read.ts`, `packages/engine/src/step/state-update/` (move `session.ts`, `identity.ts`, `timing.ts`, `tyres.ts`, `energy.ts`, `condition.ts`, `dynamics.ts`, `own-car.ts`, `realism.ts`, `restricted.ts` here), `packages/engine/src/recorders/` (move `history/{laps,lap-samples,stints,pit-stops,events,mini-sectors,damage-changes,cars}.ts` here); modify `packages/engine/src/step/step.ts` (supervisor), `.dependency-cruiser.cjs` (supervisor: `src/signals/**` importable only from `src/situations/**` and `src/step/state-update/**`; C6 as `reachable` rules: nothing outside `src/frame/**`, `src/step/state-update/**`, `src/signals/**` and `src/situations/**` reaches `@pitwall/protocol` or `src/frame/frame.ts`, directly or through another module; in the bridge, `src/storage/**`, `src/hub/**`, `src/features/**` and `topic-publisher.ts` reach neither), `packages/engine/src/state/engine-state.ts` (`signals: Signals`, `open.recorders`, `open.machines`). Tests: `packages/engine/test/step/shuffle.test.ts`, `packages/engine/test/step/signals.test.ts`.

**Interfaces:**
- Consumes: Task 1 (`Signals`), Task 2.
- Produces: `step(state, frame, report)` runs `step0Clock` (today's `applySessionClock`), then `STATE_UPDATE: StateUpdate[]`, then `runMachine(state, frame)` (Task 5; until then the tracker's `applySituations`), then `RECORDERS: Recorder<unknown>[]` (types from Task 1; recorders get `RecorderInput`, never a frame); `readSignals(frame: Frame, prev: Signals): Signals` fills every C12 field; `step/initial-state.ts` moves to `step/state-update/initial.ts` (it reads the Session packet). The runner stops importing protocol types: frame assembly puts a flashback report on the frame as `frame.flashback?: { targetFrameId: number; targetSessionTime: SessionTime }`, and the runner is generic over `F extends RunnerFrame` (`{ frameId; overallFrameId; sessionTime; receivedAtMs; flashback? }`, declared in `runner/` without protocol). `apps/bridge/src/pipeline/session-storage.ts` builds session rows from `LiveState` values, not from `SessionPacket`/`ParticipantsPacket`. Signal fields stay mirrored in `CarState`/`SessionState` until Task 24.

- [ ] **Step 1 (test agent):** `signals.test.ts`: "every C12 field and event reaches `Signals`" (builder packets, one assertion per field); `shuffle.test.ts`: "each step's modules in shuffled order give identical state, log and step output" (fast-check permutations, `numRuns: 20`, on three segments: `race-zandvoort-pit-stop`, `race-singapore-start`, `practice-wing-change`); "no engine module outside the adapter reaches a protocol type" (the depcruise rules). Run: fail.
- [ ] **Step 2 (implementer):** restructure; the Session History packet's confirmed lap and sector times become values in step 1 (`live.cars[i].timing.confirmedLaps`), so `recorders/laps.ts` imports no protocol type (C6); remove the couplings between recorders (`pit-stops.ts` setting `open.laps` flags; `stints.ts` reading `open.pitVisits`) by giving each recorder its own open state holding what it needs (C10: recorders read the live state, the situations and their own open state only; Task 17 replaces the remaining cross-recorder needs with activity spans). The shuffle test pins it.
- [ ] **Step 3:** related tests, typecheck, lint, depcruise (the new rule); supervisor `pnpm check`.
- [ ] **Step 4:** commit `refactor(engine): four steps; the signals module; recorders without coupling`.

### Task 5: The machine registry and its tests

**Clauses:** C15, C17 (`gen` part), C40, C63, C85, C87, C90.

**Files:** Create `scripts/gen-machines.ts` (+ `pnpm gen:machines` in root `package.json`, part of `pnpm gen`; supervisor), `packages/engine/src/situations/registry.ts` (supervisor), `packages/engine/src/situations/run.ts`; tests `packages/engine/test/situations/registry.test.ts`, `packages/engine/test/situations/transitions-completeness.test.ts`, `packages/engine/test/situations/invariants.property.test.ts`, `packages/engine/test/situations/versions.test.ts`, `packages/engine/test/support/transition-table.ts`.

**Interfaces:**
- Consumes: Task 1, Task 4.
- Produces: `MACHINES` (generated `index.generated.ts`: every `situations/<name>/machine.ts` default export); `machineOrder(machines): SubMachine<unknown>[]` (topological by `inputs.upstream`, throws `MachineCycleError`); `runMachine(state, frame, out)` runs the sub-machines that apply to the weekend phase, appends closed spans to `spans:<id>` and returns the frame's `FrameStamps` (the session-scoped spans, and per car that car's car-scoped spans; zone-scoped spans are never stamped, C26); `situationOf(state): Situation` (the open spans of every machine); a span's id is the count of spans its machine (per car for a per-car machine) opened before it, kept in the machine's open state so a rewind restores it (C26); `type TransitionRow = { name: string; from: string | 'none'; to: string; input: MachineInputBuilder; join?: true }`; `defineTransitionTable(machine, rows)`; change tags `spans:<id>` per machine generated into `CHANGE_TAGS`. The version of every log writer lives only in its own file (`version` field, C90); `packages/engine/test/situations/versions.test.ts` (in `pnpm check`) diffs against `git merge-base HEAD main` and fails when a log writer's files changed and its `version` did not.

- [ ] **Step 1 (test agent):** "the order follows declared inputs; a cycle throws `MachineCycleError`"; "every declared transition has a row, every row uses a declared transition" (generic over `MACHINES` and each machine's table file); "random signal sequences never give an undeclared transition, a throw, two open spans in one scope or a gap between spans" (generic property over `MACHINES`); "a log writer changed since the merge base without a version bump fails" (`versions.test.ts`, against a scratch git repo in a temp dir); "every sub-machine declares exactly one scope". With no machine registered yet, the generic tests run over a test machine in `test/support`. Run: fail.
- [ ] **Step 2 (implementer):** implement the generator, `run.ts`, the harness; `pnpm gen` writes the index.
- [ ] **Step 3:** related tests, typecheck, lint, depcruise; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(engine): the machine registry, its order, stamps per frame and the transition tests`.

### Task 6: `pitwall scan-situations`

**Clauses:** C85.

**Files:** Create `apps/bridge/src/cli/commands/scan-situations.ts`; modify the CLI dispatcher and `usage.ts`. Test: `apps/bridge/test/cli/scan-situations.test.ts`.

**Interfaces:**
- Consumes: Task 5 (`MACHINES`, `runMachine`).
- Produces: `pitwall scan-situations [dir]` (default `PITWALL_FIXTURES_DIR`): runs steps 0–2 over every `.pwrec` and prints, per sub-machine, every transition with its count, the declared transitions never seen, and every undeclared transition (none expected); exit code 1 if an undeclared transition occurs.

- [ ] **Step 1 (test agent):** on two segments: "prints each sub-machine's transition counts"; "a declared transition never seen is listed"; "an undeclared transition exits 1" (a test machine that declares too little). Run: fail.
- [ ] **Step 2 (implementer):** implement.
- [ ] **Step 3:** related tests; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(bridge): pitwall scan-situations reports every sub-machine's transitions over the recordings`.

### Task 7: The clock sub-machine

**Clauses:** C7, C32–C37.

**Files:** Create `packages/engine/src/situations/clock/{machine.ts,jumps.ts,pauses.ts}` from `history/situations/time-jumps.ts`; tests `packages/engine/test/situations/clock/{clock.transitions.test.ts,clock.segments.test.ts}` (port `time-jumps.test.ts`). Delete `restampStart`, `phaseBook.lightsOut` re-stamp slices and `StepOutput.rewritten`.

**Interfaces:**
- Consumes: Task 5.
- Produces: the clock is step 0, not a member of the step-2 registry (`STEP0_CLOCK` in `situations/clock/machine.ts`, `id: 'clock'`, with a `version`); it appends clock facts only, no spans: `fall`, `jump`, `pause` (once, when the pause ends, with its start and wall length), `simulatedEnd`; its open state says whether a pause is in progress (`Situation.paused`); `onRaceClock(state, sessionTime): SessionTime`. The start settling is a `fall` carried over by `offsetMs` like any other fall (C36); nothing is re-stamped.

- [ ] **Step 1 (test agent):** pause rows: an offline gap over 2 s wall appends one `pause` fact; an online `gamePaused` 1 → 0 appends one `pause` fact and `Situation.paused` is true in between; fact rows: "a fall within 60 frames after LGOT is carried over, nothing is re-stamped" (the former settling tests, turned around: the recorded entries keep their times, later ones get the offset); "the post-session jump appends `simulatedEnd`"; "garage acceleration up to 31.6× is no jump"; "a flashback appends no clock fact". Segments: `race-zandvoort-online-start` (the settling fall), `race-zandvoort-clock-reset`, `race-singapore-wet-flashback`. Delete the re-stamp tests. Run: fail.
- [ ] **Step 2 (implementer):** implement; `step0Clock` delegates to it.
- [ ] **Step 3:** related tests; `pitwall scan-situations` over every recording, output into the report (C85); supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(engine): the clock sub-machine; the start settling is carried over, never re-stamped`.

### Task 8: The weekend-phase sub-machine

**Clauses:** C14.

**Files:** Create `packages/engine/src/situations/weekend-phase/machine.ts`; test `packages/engine/test/situations/weekend-phase/weekend-phase.transitions.test.ts`; segment `fixtures/segments/race-sprint-start.pwrec.gz` cut from `2026-11-02_15-17-14_e4984016b74ee5c8` over its first Session packets with a weekend structure (under 1 MB).

**Interfaces:**
- Consumes: Task 5.
- Produces: machine id `weekend-phase`, `appliesTo: 'all'`, one span per session; `view.situation.weekendPhase: WeekendPhase` (Task 20 exposes it; until then `state.open.machines`). Mapping: types 1–3 practice segment 1–3, 4 `shortPractice`; 5–7 qualifying segment 1–3, 8 `short`, 9 `oneShot`; 10–12 `sprintShootout` segment 1–3, 13 `shortSprintShootout`, 14 `oneShotSprintShootout`; 15–17 race, format `sprint` when the weekend structure lists a later race session than this one, else `grandPrix`; 0, 18 and any type above 18 are `none` from the session type alone, at once; for the others `pending` until a Session packet carries `numSessionsInWeekend` > 0.

- [ ] **Step 1 (test agent):** one row per session type 0–19 (19 stands for any unknown type); "pending until the structure arrives, then fixed for the session"; "type 15 in [15, 16] is the sprint; 16 in [15, 16] is the grand prix"; segment `race-sprint-start`: pending on the first packet, then race/sprint. Run: fail.
- [ ] **Step 2 (implementer):** implement.
- [ ] **Step 3:** related tests; scan output in the report; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(engine): the weekend phase and its format`.

**M1 end gate (supervisor):** `pnpm check`, `pnpm test:ui`, `pnpm test:acceptance`; merge.

---

## M2. Sub-machines

### Tasks 9–16: one sub-machine (or one family) each

Each row is one task with the same steps. Span kinds and details are committed by the supervisor in `packages/domain/src/situations/<machine>.ts` before its test agent starts (Step 0). Upstream inputs are named machine ids; `none` in `from` is the join or first open.

| Task | Machine id(s) | appliesTo | Inputs | Span kinds | Facts it rests on (inventory section) | Segments |
|---|---|---|---|---|---|---|
| 9 | `session-phase-race`, `session-phase-qualifying`, `session-phase-practice` (port of `history/situations/session-phase.ts`) | race / qualifying / practice | `safetyCarStatus`, `periods`, events SCAR STLG LGOT RDFL CHQF RCWN SEND, final classification; values: leader lap, lap timers; upstream `clock`, `weekend-phase` | race: `grid`, `formation`, `startLights`, `racing`, `neutralised` (detail `{ car: 'SC' \| 'VSC'; stages }`), `suspended` (detail `{ restart: Known<'standing' \| 'rolling'> }`), `finished`, `postSession`; qualifying and practice: `grid`, `running`, `suspended`, `finished`, `postSession` | §1.1–1.7, §7 | `race-singapore-start`, `race-singapore-wet-start`, `race-zandvoort-online-start`, `race-zandvoort-uid-reuse-start`, `race-zandvoort-vsc`, `race-singapore-end`, `qualifying-singapore-end` |
| 10 | `car-location`, `car-status` | all | `driverStatus`, `pitStatus`, `resultStatus`, `numActiveCars`, `aiControlled`, RTMT, PENA 6/16; upstream `clock` | location: `garage`, `pitLane`, `track`; status: `competing`, `retired` (detail `{ cause: Known<'mechanical' \| 'terminalDamage' \| 'other'> }`), `disqualified`, `absent` | §2.1–2.4, §2.9, §2.11, §2.12 | `race-zandvoort-retire`, `race-zandvoort-pit-stop`, `practice-wing-change`, new `practice-garage-exit` (ZvP or MiP, under 1 MB); moves `isActiveCar` and `slotsInUse` (today in `step/identity.ts`, read by `recorders/cars.ts`) into `car-status`: a car is in the session while its status is not `absent` |
| 11 | `car-activity-race` | race | `pitStatus`, `pitLaneTimerActive`, `resultStatus` at the line, DTSV SGSV; values: lap, lap distance, lap timer, pit timers; upstream `car-location`, `car-status`, `session-phase-race`, `penalties` | `racingLap`, `inLap`, `boxStop`, `servingPenalty` (detail `{ penalty: 'driveThrough' \| 'stopGo'; given: SpanRef }`, the open or closed `penalties` span it serves), `outLap`, `finished`, `coolDown` | §2.5, §2.7, §2.10 | `race-zandvoort-pit-stop`, `race-zandvoort-pit-exit`, `race-drive-through`, new `race-miami-finish` (MiR, a finisher's crossing, under 1 MB) |
| 12 | `car-activity-qualifying`, `car-activity-practice` | qualifying / practice | `pitStatus`, `driverStatus` (teleports), `resultStatus`; values: lap distance, lap timer; upstream `car-location`, `car-status`, the phase's session-phase | qualifying: `outLap`, `pushLap`, `inLap`, `garage`, `finished`; practice: `outLap`, `flyingLap`, `inLap`, `garage`, `finished` | §2.1–2.4, §1.9, §2.10 | `qualifying-singapore-full-lap`, `qualifying-singapore-end`, `practice-garage-exit`; brings in the tests of branch `w2/laps` that pin the lap restart at the line after an out lap |
| 13 | `car-flags` (scope car), `zone-flags` (scope zone) | all | `fiaFlag` / `marshalZones` | `none`, `green`, `yellow`, `blue` (zone spans with detail `{ zone: number; startFraction: Ratio }`) | §6.1, §1.4 | new `practice-miami-yellow` (MiP), new `race-mexico-blue` (MxR) |
| 14 | `warnings`, `lap-validity` | all | PENA 5 and 10–15, `totalWarnings`, `cornerCuttingWarnings`, `currentLapInvalid`; upstream `clock` | warnings per car: `warned` (detail `{ count: number; infringement: number }`), one span per count; lap-validity per car: `valid`, `invalid` (detail `{ reason: number; scope: 'this' \| 'thisAndNext' \| 'thisAndPrevious' }`) | §2.6, §2.8 | `practice-wing-change` (if it holds a warning), new `practice-miami-invalid` (MiP PENA 12/7) |
| 15 | `penalties` | race | PENA 0, 1, 4; `shouldServePenalty`, `unservedDriveThroughs`, `unservedStopGos`, `timePenaltyMs`; DTSV SGSV; upstream `clock` | per car: `driveThroughPending`, `stopGoPending` (detail `{ given: number; infringement: number }`), `timePenalty` (detail `{ totalMs: Ms }`); a pending span closes when the unserved count falls, matched to its DTSV/SGSV up to 10 s later | §2.6, §2.7 | `race-drive-through` |
| 16 | `race-control-race`, `race-control-qualifying`, `race-control-practice` (scope session); `compound-rule` (scope car, race only) | race / qualifying / practice | DRSE DRSD, `drsAllowed` / values: visual compound, lap; upstream `session-phase-race` | race control race: `drsOff` (detail `{ reason: 'notEnabledYet' \| 'wetTrack' \| 'safetyCar' \| 'redFlag' \| 'minLapNotReached' \| 'unknown' }`), `drsOn`; qualifying and practice: `drsFree`; compound rule: `required`, `waived` (from the first race lap on intermediates or wets) | §1.4, §4 | `race-zandvoort-vsc`; brings in the tests of branch `w2/drs` |

Per row:
- [ ] **Step 0 (supervisor):** commit the span kinds and details in `packages/domain/src/situations/<machine>.ts`.
- [ ] **Step 1 (test agent):** the transition table, one row per declared transition and one join row per kind (Review Focus 2), with the inventory's signal orders (Review Focus 5); one segment test per listed segment asserting the span sequence the machine produces; cut the new segments listed. Run: fail.
- [ ] **Step 2 (implementer):** `situations/<machine>/machine.ts` (and helpers in that folder), `version: 1`, with its `scope`.
- [ ] **Step 3:** related tests; the completeness and property tests of Task 5 now cover the machine; `pitwall scan-situations` over every recording with no undeclared transition, output in the report; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(engine): the <machine> sub-machine`.

Task 9 also makes appended facts read-only (`Object.freeze` in `log.ts`; test "an appended fact is read-only", C24), now that no old mechanism edits facts, and deletes, with their tests (C82): the formation discard (`discardFormation`), the dropped neutralisation (`drop`; an unconfirmed SCAR closes `confirmed: false`), `atBoundary` and `recordedAtOrAfter`, `StepOutput.discarded`, `phaseBook`, and `history/situations/`. Its tests assert: "a formation lap's facts are hidden, and the formation span is visible" (Review Focus 1 across lights out: a flashback from racing into the formation lap); "an SCAR never confirmed within 3 s closes as `neutralised` with `confirmed: false`"; the six session-end shapes (Review Focus 3).

Task 12 asserts garage acceleration: "a car accelerated through the garage at 31.6× opens no lap and no activity transition" (Review Focus 4).

**M2 end gate (supervisor):** `pnpm check`, `pnpm test:ui`, `pnpm test:acceptance`; merge.

---

## M3. Recorders on situations

### Task 17: Laps, stints and pit stops from activity spans

**Clauses:** C10, C13, C26, C29.

**Files:** Modify `packages/engine/src/recorders/{laps,lap-samples,stints,pit-stops}.ts`; tests port `packages/engine/test/history/{laps,laps-edge-cases,laps-garage-restart,laps-unrecorded,stints-pit-stops,lap-start-samples,lap-end-samples,history-edge-cases}.test.ts` into `packages/engine/test/recorders/`.

**Interfaces:**
- Consumes: Tasks 9–12 (`car-activity-*`, `car-location`, `session-phase-*`), Task 15 (`penalties`).
- Produces: `LapRecord.inLap`/`outLap` from the car's activity spans during the lap; `scShare`/`vscShare` from the time the lap spent stamped with a `neutralised` span of that car; a race lap rises at the pit-lane line, a practice or qualifying lap restarts at the line after an out lap (from the activity spans); no lap record while the car's activity is `coolDown` or the session phase is `postSession`; a `PitStopRecord` per `boxStop` span (lap, entry, exit, pit-lane and stationary times from values, `flag` from the stamp, `penaltyServed` true when a `servingPenalty` span overlaps); a stint closes when a `boxStop` or `garage` span ends on a different set (compound change, or a lower age than the old set's at fitting). Every fact carries the frame's stamp.

- [ ] **Step 1 (test agent):** port the listed tests onto activity spans built with the Task 5 builders; add: "a lap crossed while the formation span is open is hidden"; "a drive-through pass gives no pit stop and marks none served"; "a garage tyre fitting opens a stint without a pit stop"; "a car accelerated through the garage records no lap" (Review Focus 4); bring in the tests of branch `w2/laps` (RE-B3, RE-B5: the final out lap, the latched stint split as "a same-compound set fitted at age 0 or 1 opens a stint at the box exit"). Delete the tests of `driverStatus`/`pitStatus` reads. Run: fail.
- [ ] **Step 2 (implementer):** implement; no recorder reads a signal (the depcruise rule of Task 4 enforces it); bump each changed recorder's `version` (C90).
- [ ] **Step 3:** related tests; segment tests in `apps/bridge/test/fixtures` pass; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(engine): laps, stints and pit stops from activity spans`.

**M3 end gate (supervisor):** `pnpm check`, `pnpm test:ui`, `pnpm test:acceptance`; merge.

---

## M4. The view and the analyses

### Task 18: The view

**Clauses:** C20, C39–C41, C55.

**Files:** Modify `packages/engine/src/calc/types.ts` (`EngineView`; supervisor), `packages/engine/src/calc/situation.ts`, `packages/engine/src/calc/scheduler.ts`, `apps/bridge/src/pipeline/session-processor.ts`, `apps/bridge/src/features/feature.ts` (`bindSituation`; supervisor-delegated), `packages/engine/test/support/scheduler.ts` (guarded view). Tests: `packages/engine/test/calc/engine-view.test.ts` (port), `packages/engine/test/calc/guarded-view.test.ts`, `apps/bridge/test/features/bind-situation.test.ts`.

**Interfaces:**
- Consumes: Tasks 2, 5, 9–16 (`situationOf` from Task 5).
- Produces:
  ```ts
  export type Situation = DeepReadonly<{ weekendPhase: WeekendPhase; session: OpenSpan | undefined; byMachine: Record<MachineId, OpenSpan[]> }>;
  export type EngineView = { live: DeepReadonly<LiveState>; situation: Situation; history: Projection; delta: HistoryDelta;
    changed: ReadonlySet<ChangeTag>; weekend: DeepReadonly<WeekendContext>; config: DeepReadonly<Record<string, Record<string, number | string | boolean>>>;
    priors: DeepReadonly<Record<string, unknown>>; feed: FeedMetricsView; outputs: ReadonlyMap<CalculatorId, unknown> };
  export function openSpansOf(view: EngineView, machine: MachineId, carId?: CarId): readonly OpenSpan[];
  export function guardedView(view: EngineView, reads: readonly Dependency[]): EngineView; // throws UndeclaredReadError
  export const bindSituation: <T extends TopicName>(topic: T, machine: MachineId) => TopicBinding;
  ```
  `view.state` is removed; units read `view.live` and `view.history`. `priors` is `{}` until the priors store exists. The test harness in `packages/engine/test/support/scheduler.ts` runs every unit through `guardedView`.

- [ ] **Step 1 (test agent):** "the view holds exactly the C39 parts"; "`guardedView` throws on an undeclared read and passes a declared one"; "`bindSituation` publishes a machine's open and closed spans and compiles only for a matching topic type". Run: fail.
- [ ] **Step 2 (implementer):** implement; move every unit from `view.state` to `view.live`/`view.history` mechanically (no behaviour change; the behaviour moves in Task 22).
- [ ] **Step 3:** related tests; supervisor `pnpm check`.
- [ ] **Step 4:** commit `refactor(engine): the view is live, situation and projection; a guarded view in tests`.

### Task 19: Flag phases go

**Clauses:** C13, C20, C23.

**Files:** Modify `apps/bridge/src/storage/{storage-writer,weekend-repository}.ts` (stop writing and reading `flag_phases`; the table goes in Task 27). Delete `packages/engine/src/history/flags.ts`, `packages/engine/src/calc/active-flag-phase.ts`, `FlagPhase`/`ScPhase` (domain, supervisor), `History.flagPhases`, `open.flagPhase`, `open.lastFlag`, the `flagPhases` change tag and `flagChange` cadence, the topic `packages/contracts/src/topics/flagPhases.ts` (supervisor), its binding in `apps/bridge/src/features/history/register.ts`. Tests: delete `packages/engine/test/history/flags.test.ts`, `packages/engine/test/calc/active-flag-phase.test.ts`.

**Interfaces:**
- Consumes: Task 9, Task 18 (`view.situation`).
- Produces: none new; the readers `gaps`, `incidents`, `race-moment` move in this task to `session-phase-*` spans through a shared helper `neutralisedSpans(projection): Span[]` in `packages/analysis/src/shared/neutralised.ts` (closed `neutralised` and `suspended` spans plus the open one from the view), so no reader breaks; Task 20 gives them their behaviour tables.

- [ ] **Step 1 (test agent):** restate the three readers' flag-phase tests on session-phase spans; "a `neutralised` span with `confirmed: false` is not a neutralisation for the gapper". Run: fail.
- [ ] **Step 2 (implementer):** implement and delete.
- [ ] **Step 3:** `git grep -n "FlagPhase\|flagPhases\|activeFlagPhase"` outside `docs/history` is empty; supervisor `pnpm check`.
- [ ] **Step 4:** commit `refactor: flag phases removed; readers use session-phase spans`.

### Task 20: Analyses on situations, with behaviour tables (lanes)

**Clauses:** C13, C43, C44, C45, C46.

**Files (shared, Step 0 supervisor):** `packages/analysis/src/shared/behaviour.ts`, `packages/analysis/test/behaviour-completeness.test.ts`.

**Interfaces (shared):**
```ts
export type BehaviourTable<B> = { [machine: MachineId]: Record<string /* span kind */, B> };
export function behaviourFor<B>(table: BehaviourTable<B>, view: EngineView, carId?: CarId): B[]; // the rows of the spans open now
// each unit exports `<UNIT>_BEHAVIOUR: BehaviourTable<...>` from its index.ts; the completeness test checks every kind of every machine the unit's `reads` names
```

Lanes (one agent each, disjoint units; `PITWALL_WORKER_UNIT=<unit>`):

| Lane | Units | Moves from → to |
|---|---|---|
| a | `gaps` | race start from the `racing` span; gapper bands from `neutralisedSpans`; out of race from `car-status`; `outOfRace` helper deleted |
| b | `incidents` | pitting from `car-location`; penalties and warnings from `penalties`/`warnings` spans; retirements from `car-status`; neutralised entries from session-phase spans |
| c | `lap-times`, `session-remaining` | no projection on `inLap`/`outLap`/`garage`/`pitLane` activity or location; the elimination counts from `view.situation.weekendPhase` (qualifying segment 1/2, grand prix or sprint-shootout format) instead of session type codes; laps left 0 from the leader's `finished` activity |
| d | `battle` | DRS from `race-control-race` spans (`drs-status.ts` deleted); `lapsToDrs` `notApplicable` while `drsOff` |
| e | `alarms` | warnings from `warnings` spans; penalties from `penalties` spans |
| f | `race-moment` | detects nothing: moments `battle`, `incident`, `carCare`, `weather` only; the ranking reads the session phase from the view (`Moment` loses `neutralised`: supervisor, contracts and domain) |
| g | `tyre-wear`, `fuel`, `ers`, `pace`, `pace-delta`, `per-lap-rate`, `lap-classes`, `car-bands`, `damage` | behaviour tables for the machines they read (laps by activity via `LapRecord`; `car-bands` off while `boxStop`; `damage` live in `garage`/`pitLane`); brings in the test commit of branch `w2/rates` (64b6780: a refuel keeps the fuel burn window; fuel and ERS read no stints; the builder's `lap()` derives start samples) |

Per lane:
- [ ] **Step 1 (test agent):** port the unit's tests off removed concepts; one test per behaviour-table row (builder views with the span set); the completeness test covers the unit. Run: fail.
- [ ] **Step 2 (implementer):** the table in `<unit>/behaviour.ts`, read by the calculator; no signal read (compile error once Task 24 lands; until then `git grep` in the unit's folder for the C12 names is empty).
- [ ] **Step 3:** related tests; supervisor `pnpm check` after merging the lane.
- [ ] **Step 4:** commit `feat(analysis): <unit> behaves per situation by its behaviour table`.

After all lanes: the supervisor deletes `shared/out-of-race.ts` and `shared/drs-status.ts`. A unit that needs a weekend phase reads `view.situation.weekendPhase`; under `none` its output is `notApplicable` (C14), one row in its behaviour table.

### Task 21: Situation events leave `RaceEvent`

**Clauses:** C12, C13, C26.

**Files:** Modify `packages/engine/src/recorders/{events,mini-sectors,damage-changes}.ts`, `packages/domain/src/records.ts` (supervisor: `RaceEventKind` loses `penalty`, `retirement`, `drsEnabled`, `drsDisabled`, `startLights`, `lightsOut`). Tests: port `packages/engine/test/history/{events,mini-sectors}.test.ts`.

**Interfaces:**
- Consumes: Task 4, Tasks 9–16, Task 20 (every reader of the removed kinds has moved to spans).
- Produces: `events` holds `overtake`, `collision`, `fastestLap`, `speedTrap`, `damageChange` only; no crossing in `coolDown`; a finisher's final line crossing is recorded at the lap-distance wrap (`(lap + 1, 0)`).

- [ ] **Step 1 (test agent):** "situation events never become `RaceEvent`s"; "no crossing while the car's activity is `coolDown`"; "every finisher's final lap has its line crossing" (segment `race-miami-finish`). Run: fail.
- [ ] **Step 2 (implementer):** implement; `git grep` for the removed kinds outside `docs/history` is empty.
- [ ] **Step 3:** related tests; supervisor `pnpm check`.
- [ ] **Step 4:** commit `refactor(engine): situation events are spans, not race events`.

### Task 22: Incremental units justify their accumulator

**Clauses:** C31.

**Files:** Create `test-support/builders/long-race.ts` (`longRace(): BuilderRace`, 70 laps, 20 cars, with stops and a neutralisation), `packages/analysis/test/<unit>/<unit>.work.test.ts` for `gaps`, `lap-times`, `incidents`, `damage`, `pace`; modify `packages/engine/test/support/scheduler.ts` (the guarded view counts the projection entries a unit reads per frame). A unit that fails its proof becomes `kind: 'quick'`.

**Interfaces:**
- Consumes: Task 18 (guarded view), Task 20.
- Produces: `countReads(unit, view): number` in the test support; per unit the C31 proof: from scratch, the entries read per frame at lap 70 are more than 10 times those at lap 7; incremental, at most twice. No timer anywhere.

- [ ] **Step 1 (test agent):** one work test per unit with the two C31 assertions on `longRace()`; "incremental equals from scratch across random rewinds" (port of the existing property, now with void facts). Run: a unit whose from-scratch reads do not grow tenfold fails; it becomes quick in Step 2 and its test is turned around to "quick: from-scratch work is bounded".
- [ ] **Step 2 (implementer):** convert those units to quick; leave the others incremental.
- [ ] **Step 3:** related tests (they run in `pnpm check`: deterministic and cheap); supervisor `pnpm check`.
- [ ] **Step 4:** commit `test(analysis): every incremental unit proves its accumulator by counted work (C31)`.

### Task 23: Situation topics

**Clauses:** C54–C56, C20.

**Files:** Create `packages/contracts/src/topics/session.phase.ts`, `packages/contracts/src/topics/cars.situation.ts` (supervisor); modify `apps/bridge/src/features/history/register.ts` or create `apps/bridge/src/features/situations/register.ts`. Test: `apps/bridge/test/features/situations/situations.test.ts`.

**Interfaces:**
- Consumes: Task 18 (`bindSituation`).
- Produces: `session.phase` (state: the open session-phase span and the weekend phase); `session.phases` (append: closed session-phase spans); `cars.situation` (state, per car: `{ location, status, activity, penalties, warnings, flag }`, each the open span's kind and detail).

- [ ] **Step 1 (test agent):** "each topic carries the open span of its machine and no signal field". Run: fail.
- [ ] **Step 2 (implementer):** bindings.
- [ ] **Step 3:** related tests; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(bridge): situation topics`.

**M4 end gate (supervisor):** `pnpm check`, `pnpm test:ui`, `pnpm test:acceptance`; merge.

---

## M5. Signals leave the domain; the UI renders situations

### Task 24: Signals leave `CarState` and `SessionState` (supervisor-led)

**Clauses:** C13, C54.

**Files:** Modify `packages/domain/src/car.ts` (`CarTiming` loses `pitStatus`, `driverStatus`, `pitLaneTimerActive`, `resultStatus`, `numPitStops`, `shouldServePenalty`, `unservedDriveThroughs`, `unservedStopGos`, `timePenaltyMs`, `totalWarnings`, `cornerCuttingWarnings`, `currentLapInvalid`, `fiaFlag`), `packages/domain/src/session.ts` (`SessionState` loses `flag`, `marshalZones`, `periods`, `sessionType`, `kind`, `weekendStructure`, `numActiveCars`), the state-update modules (write `Signals` only), `apps/bridge/src/features/cars-overview/register.ts` (`stops` = the car's pit-stop records), `apps/ui/src/kit/values/car-sources.ts`, every reader the compiler names. Test: `packages/engine/test/step/no-signal-in-domain.test.ts`.

- [ ] **Step 1 (test agent):** "no `domain` type has a C12 field" (a type-level test with `expectTypeOf`); "the live state of every segment frame holds no C12 field" (runtime key scan). Run: fail.
- [ ] **Step 2 (implementer, delegated paths named in the brief):** remove the fields; fix every compile error by reading the situation instead; `session.kind` readers read `view.situation.weekendPhase`.
- [ ] **Step 3:** supervisor `pnpm check`.
- [ ] **Step 4:** commit `refactor(domain): signals leave the live state`.

### Task 25: The timing tower renders situations

**Clauses:** C54, C65, C66, C68.

**Files:** Modify `apps/ui/src/widgets/timing-tower/{widget.ts,rows.ts,emphasis.ts,text.ts,gallery.ts}`; create `apps/ui/src/widgets/timing-tower/presentation.ts`, and `presentation.ts` for `battle-cards`, `ers-budget` and `incident-feed` (they read `raceMoment.current`: their moment-keyed emphasis moves into the table, and `neutralised` leaves it with lane f). Tests: `apps/ui/src/widgets/timing-tower/rows.test.ts` (port), `apps/ui/test/presentation-completeness.test.ts` (supervisor creates the generic test in Step 0).

**Interfaces:**
- Consumes: Task 23 (`cars.situation`).
- Produces: the situation column codes `GARAGE`, `PIT`, `BOX`, `DT`, `SG`, `OUT`, `IN`, `RET`, `FIN` (empty on a racing, flying or push lap) from `presentation.ts`; the PEN cell from `penalties` and `warnings`; unused and retired rows from `car-status`.

- [ ] **Step 0 (supervisor):** `presentation-completeness.test.ts` over every widget whose `widget.ts` declares a situation topic or `raceMoment.current`.
- [ ] **Step 1 (test agent):** one row test per situation kind the tower shows; gallery cases for `boxStop`, `servingPenalty`, `retired`, `finished`. Run: fail.
- [ ] **Step 2 (implementer):** implement.
- [ ] **Step 3:** related tests; supervisor `pnpm check`, `pnpm test:ui` (baselines looked at before updating).
- [ ] **Step 4:** commit `feat(ui): the timing tower renders car situations`.

### Task 26: The top bar shows the session phase (supervisor-delegated shell change)

**Clauses:** C46, C65, C66.

**Files:** Create `apps/ui/src/shell/topbar/segments/Phase.svelte`, `apps/ui/src/shell/topbar/phase-presentation.ts`; modify `apps/ui/src/shell/topbar/model.svelte.ts`, `apps/ui/src/kit/text.ts`, emphasis roles. Tests: `apps/ui/test/shell/topbar-phase.test.ts`.

**Interfaces:**
- Consumes: Task 23 (`session.phase`), Task 20 lane f (moments without `neutralised`).
- Produces: labels `FORMATION`, `START`, `SC`/`VSC` with its stage, `RED`, `FINISHED`, `PAUSED`; hidden while `racing`/`running`; SC, VSC and RED in the attention role, the rest grey.

- [ ] **Step 1 (test agent):** one test per label; "hidden while racing". Run: fail.
- [ ] **Step 2 (implementer):** implement.
- [ ] **Step 3:** related tests; supervisor `pnpm check`, `pnpm test:ui`.
- [ ] **Step 4:** commit `feat(ui): the top bar shows the session phase`.

**M5 end gate (supervisor):** `pnpm check`, `pnpm test:ui`, `pnpm test:acceptance`; merge.

---

## M6. Storage

### Task 27: Storage is an append-only cache of logs

**Clauses:** C24, C28, C34, C60.

**Files:** Modify `apps/bridge/src/storage/{db.ts,storage-writer.ts,weekend-repository.ts}` (`SCHEMA_VERSION = 3`), `apps/bridge/src/pipeline/session-storage.ts`, `apps/bridge/src/cli/rebuild-database.ts`. Tests: port `apps/bridge/test/storage/*.test.ts`; `apps/bridge/test/storage/log-store.test.ts`.

**Interfaces:**
- Consumes: Task 2 (log, projection, `HistoryDelta`), Task 3 (void facts), Tasks 19 and 21 (no flag phases, no situation event kinds).
- Produces: tables `weekends`, `sessions` (+ `rules_version TEXT NOT NULL`), `drivers`, `facts (session_uid, weekend_id, list TEXT, seq INTEGER, car_id INTEGER NULL, record TEXT, PRIMARY KEY (session_uid, weekend_id, list, seq))`; `writeLog(key, log, delta)` appends `[before, after)` per list and never deletes; `replaceLog(key, log, rulesVersion)` is used only by a rebuild (C24): one transaction deletes the session's fact rows and writes the rebuilt log; `projectionOf(key): Projection` (built with the engine's `ProjectionTracker`); `weekendContext` built from projections; the old per-list tables go.

- [ ] **Step 1 (test agent):** "a flashback writes its void and deletes no row"; "the stored projection equals the live projection" (segment with a flashback: `race-singapore-wet-flashback`); "formation facts are stored and not returned"; "a new sub-machine's spans need no schema change" (a test machine's spans round-trip). Run: fail.
- [ ] **Step 2 (implementer):** implement; `pitwall live` rebuilds a schema-2 database from the recordings as today.
- [ ] **Step 3:** related tests; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(bridge): storage holds append-only logs; one read API returns projections`.

### Task 28: The rules version rebuilds stale sessions

**Clauses:** C61, C90.

**Files:** Create `apps/bridge/src/storage/rules-version.ts`; modify `apps/bridge/src/cli/commands/live.ts` (or the startup path), `weekend-repository.ts`. Test: `apps/bridge/test/storage/rules-version.test.ts`.

**Interfaces:**
- Consumes: the `version` of every log writer (Tasks 4, 5, 7, 9–17), Task 27.
- Produces: `rulesVersion(): string` (sha256 over the sorted `${id}@${version}` of the clock, every state-update module, every sub-machine and every recorder); at bridge start the sessions of the newest stored session's weekend with a different rules version are rebuilt from their recordings before input opens, with progress lines; any other stale session is rebuilt when first read.

- [ ] **Step 1 (test agent):** "a changed rules version rebuilds the current weekend at start and logs progress"; "a stale session of another weekend is rebuilt when first read"; "an unchanged rules version rebuilds nothing". Run: fail.
- [ ] **Step 2 (implementer):** implement.
- [ ] **Step 3:** related tests; supervisor `pnpm check`.
- [ ] **Step 4:** commit `feat(bridge): the rules version rebuilds stale sessions`.

**M6 end gate (supervisor):** `pnpm check`, `pnpm test:acceptance` (reprocess equals live); merge.

---

## M7. Docs and gates

### Task 29: The situations catalogue

**Clauses:** C17, C19, C85.

**Files:** Create `docs/research/10-situations-catalogue.md`; modify `docs/architecture.md` C17 (supervisor, under C0: the catalogue path), `docs/research/README.md`, CLAUDE.md "What to read" (sub-machine row), `docs/testing.md` §3 (the new segments).

- [ ] **Step 1 (one docs agent):** one section per sub-machine: its kinds and transitions (from `transitions`), the signals and their times (from the inventory), the test rows and segments, "seen in" or "not yet seen" from the final `pitwall scan-situations` output, and the recording checklist for every "not yet seen" situation (red flag with both restarts, stop-go, a restart behind the SC, a stop under VSC, Q1 → Q2 → Q3, a full sprint weekend, a session restarted from the menu, an online pause, a car joining, a pit-lane start).
- [ ] **Step 2 (supervisor):** review against the code; the docs test (`test/docs/agent-docs.test.ts`) passes.
- [ ] **Step 3:** commit `docs: the situations catalogue`.

### Task 30: Final gates and the clean-contract check

- [ ] **Step 1 (supervisor):** `git grep` outside `docs/history` for every removed name is empty: `FlagPhase`, `flagPhases`, `activeFlagPhase`, `truncated`, `rewritten`, `discarded`, `restampStart`, `discardFormation`, `recordedAtOrAfter`, `outOfRace(`, `drsStatus(`, `flashbackChanges`, `session.flashback`, and the C12 field names outside `packages/engine/src/{signals,situations,step/state-update}` and `packages/protocol`.
- [ ] **Step 1b (supervisor):** remove the time trial from `fixtures/index.json` and `test-support/fixtures.ts` (C84), the unreferenced `test-support/moments/ttZandvoortLap1.crossing.json`, and every test reference to them.
- [ ] **Step 2 (supervisor):** walk `03-traceability.md` §2 and §3: each of the 12 decision sites and 7 rules is gone; §5: each enforcement exists and is tested.
- [ ] **Step 3 (supervisor):** `pnpm check`, `pnpm test:ui` (baselines shown to the user), `pnpm test:acceptance`, all green with empty `Errors` lines; a review with C89's question over the whole migration diff; merge to main, push; tell the user to restart for a live test.
- [ ] **Step 4:** commit the plan's ticks `docs: contract migration done`; move this plan to `docs/history/plans/` with a row in `docs/history/README.md`.
