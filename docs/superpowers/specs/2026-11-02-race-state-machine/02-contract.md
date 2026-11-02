# The pitwall contract

Status: draft for the user's review, 2026-11-02. On approval this text replaces `docs/architecture.md`, CLAUDE.md imports it, and ADR 0015 records the reasons (one line per clause). The current code is surveyed in `01-current-architecture.md`; `03-traceability.md` maps every decision and every finding of the survey to a clause.

This document is the architecture. Every clause binds every change. Tags say how a clause is enforced: `[type]` a compile error, `[depcruise]` a dependency rule, `[lint]`, `[gen]` a generator check, `[hooks]` the worker hooks, `[test]` or `[test: name]` a test, `[review]` the review question (C89).

**C0. No change may violate the contract.** A task that needs a different contract stops, and its worker reports the need under "Contract gaps": what the task needs and which clause blocks it. Every other task of the sub-project stops too, at its next commit, whether the change touches it or not. The contract changes only with the user's approval, and then in this order: the contract and its ADR line change, the existing code is adapted, and only then is further code written. A rejected change sends the task back to be re-briefed within the contract. Approving this contract is such a change: the migration plan adapts the existing code, and no other code is written until it is done. `[review]`

## Glossary

Every clause uses these words in exactly these meanings.

**Packages**

| Term | Meaning |
|---|---|
| the contract | This document. |
| protocol | The package that decodes bytes into packets. F1 25 (`packetFormat` 2025) only. |
| domain | The shared vocabulary package: JSON-safe types (`Known`, ids, units, `Corners`), the live state types, the fact and span types. It imports nothing and holds no logic beyond small pure helpers on its own types. |
| engine | The package of the race model: frame assembly, the four steps, the projection, the scheduler, the runner. |
| analysis | The package of calculators, analyses and simulators, one folder per unit. `shared/` holds pure helpers several units use; it is not a unit. |
| contracts package | `packages/contracts`: topic and message types shared by the bridge and the UI. Not this document. |
| bridge | The app that is the imperative shell: input, runner hosting, storage, jobs, hub, CLI. |
| ui | The Svelte app: kit, theme, emphasis, shell, connection, displays, gallery. |
| desktop | The Electron host. It loads the UI and starts the bridge. |

**Input**

| Term | Meaning |
|---|---|
| recording | A `.pwrec` file: the raw packets of a session as received. With its sidecars (config, decisions) it is the source of truth for everything stored. |
| packet | One decoded UDP message. |
| frame | All packets of one game tick, assembled into one input for the engine. |
| session | One game session, identified by session uid and weekend id. It has one weekend phase (or `none`), known once its weekend structure arrives. |
| feed | One stream of frames for one player car; the bridge may run several (ADR 0009). |
| adapter | The game-specific part of the system: protocol, frame assembly, step 0, step 1 and the machine. |

**Engine**

| Term | Meaning |
|---|---|
| step 0 … step 3 | The four steps the engine applies to every frame, in order: clock, state update, machine, recorders (C7–C10). |
| value | A game field that measures something: a time, distance, position, temperature, wear, energy. |
| signal | A game field or event that states a status, permission, obligation or transition of the session, a car or race control. Driver controls and car setup (pit limiter, ERS mode, fuel mix, brake bias, TC, ABS, DRS flap open) are values. The list is closed (C12). |
| live state | The current values of the session and of every car. It contains no signal. |
| machine | The code in `packages/engine/src/situations/` that turns signals and values into situations. |
| sub-machine | One registered part of the machine, shared (`appliesTo: all`) or for listed weekend phases. |
| situation | A sub-machine's decision of what the session, a car or race control is doing now. |
| span | One situation from its start to its end: open while it lasts, closed once ended. |
| weekend phase | Practice, qualifying or race, with its format (grand prix, sprint, sprint shootout and the short and one-shot variants). |
| session phase | The situation of the session-phase sub-machine: grid, formation, start lights, racing or running, neutralised, suspended, finished, post-session. |
| car location | Where a car physically is: garage, pit lane, track. Shared. |
| car status | Whether a car still competes in the session: competing, retired (with cause), disqualified, absent. Shared. |
| car activity | What a car is doing by its weekend phase's rules (race: racing lap, in lap, box stop, serving penalty, out lap, finished, cool-down; qualifying and practice: out lap, push or flying lap, in lap, garage, finished). Per phase. |
| recorder | A step-3 module that turns values and situations into facts. |
| fact | A recorded, immutable entry of the log: a closed span, a lap, a stint, a pit stop, a crossing, an event, a penalty record, a decision, a clock fact (a flashback among them), a void fact. Its id is its list and its position in the log. |
| stamp | The span ids a fact carries: the spans open when it was recorded. |
| log | Every fact recorded in a session, in order. Append-only in memory and in storage. |
| void fact | The fact a flashback appends: per list, the range of positions that never happened. |
| projection | The log as readers see it: every hidden fact skipped. |
| hidden fact | A fact the projection skips: inside a void range, or a non-span fact stamped with a formation span. |
| flashback | The game's rewind. Everything after its target never happened. |
| race clock | The engine's time: the game's session time made continuous. Every time in a fact, span or value is on it. |
| view | Everything a calculator or analysis may see (C39). |

**Computation**

| Term | Meaning |
|---|---|
| scheduler | Runs calculators and analyses on each frame by demand, cadence and change. |
| quick | A calculator or analysis that is a pure function of the view. |
| incremental | A calculator or analysis that folds the projection into an accumulator and equals computing from scratch (C31). |
| accumulator | The private state of an incremental calculator or analysis. |
| calculator | Scheduled; produces an intermediate value that only other units read. No topic, no insights. |
| intermediate value | A calculator's output. |
| analysis | Scheduled; combines calculators and simulators into judgements; its output is bound to a topic or raises insights. |
| judgement | A conclusion from facts, situations and values that two displays must agree on. |
| behaviour table | A unit's map from every kind of a sub-machine it reads to what it computes. |
| simulator | A pure function that analyses call to run a model forward from a starting point and decisions. Not scheduled. |
| job | An analysis's expensive computation, run in a worker thread; its result is published as `Computed<T>`. |
| insight | An event on the insights stream (raised, cleared) with key, category and severity. |
| alarm | An insight of the `alarms` analysis. |
| config | A unit's declared thresholds, overridable by `config.json`, fixed for a run. |
| priors | Season-wide aggregates (calibration, model parameters) a run starts from, fixed for the run. |
| priors store | The database of priors, a cache computed from stored projections (C62a). |
| decision | A choice the user commits for analyses to use (a plan); recorded as a fact (C76). |

**Publishing and UI**

| Term | Meaning |
|---|---|
| topic | A named stream the bridge publishes to the UI, defined by one file in the contracts package. |
| core topic | A topic that publishes facts, spans or live state as they are. |
| analysis topic | A topic that publishes one analysis's output. |
| display | A widget: renders topics and computes nothing. |
| shell | Docking, windows, workbooks, layouts, the top bar, commands and keys. |
| presentation | How facts and judgements are shown: layout, visible parts, emphasis. |
| presentation table | A display's or the shell's map from situation kinds or moments to presentation. |
| emphasis | A pure map from a state in a topic value to a theme role. |
| kit, theme | The one place for shared UI pieces; the one place for colours and fonts. |
| UI state | Workbooks, layouts and their switch rules, link groups, acknowledgements, mutes, settings. Owned by the bridge. |
| command | A named user action in the shell's one registry. |
| uiAction | The message that changes UI state or commits a decision. |

**Work**

| Term | Meaning |
|---|---|
| unit | One named analysis, calculator, simulator, display or sub-machine with its folders, owned by one worker at a time. |
| feature | The bridge folder that wires a unit's calculators, jobs, config and topics (`register.ts`). |
| supervisor, worker | The supervisor owns shared files, writes briefs and merges; a worker does one task in one phase. |
| contract gap | A need of a task that the contract blocks (C0). |
| rules version | A hash of the machine registry and every sub-machine's version (C61). |

## 1. Packages

- **C1. Dependency direction.** `protocol` imports nothing; `domain` nothing; `contracts` only `domain`; `engine` only `protocol` and `domain`; `analysis` only `engine` and `domain`; `bridge` all packages; `ui` only `contracts` and `domain`; `desktop` nothing of the workspace. `[depcruise]`
- **C1a. Several feeds.** No code assumes a single feed: engine state, the view, topics and storage are per feed. `[review]`
- **C2. Purity.** The engine, calculators, analyses and simulators read no clock (`Date`, `performance`), use no `Math.random` and do no I/O. Randomness comes only from an injected seeded generator. `[lint, test: determinism]`
- **C3. Expected problems are values** (`DecodeResult`, `Known`, `topicStatus`); an exception is a bug. Missing data is `unknown(reason)`, never 0. `[type, review]`
- **C4. Units of measure.** In `domain`, the engine and the contracts package: time integer ms, distance m, speed km/h, temperature °C, pressure psi, fuel kg, energy J, angle rad. Game units are converted once, in step 1. `[type, review]`

## 2. Parsing, the engine and the machine

### Parsing and the adapter

- **C5. Parsing interprets nothing.** `protocol` decodes only `packetFormat` 2025 and keeps the game's order (wheels RL, RR, FL, FR). Frame assembly (`engine/frame`) turns packets into one frame per game tick and splits sessions. Neither interprets a value or a signal. `[test]`
- **C6. Only the adapter knows the game.** `protocol` types are imported only by frame assembly, step 0, step 1 and the machine. Recorders, the projection, the scheduler, calculators, analyses, simulators, the bridge's storage and publishing, and the UI see only `domain` and contracts-package types. A packet value a recorder needs becomes a value in step 1 first. `[depcruise]`

### The four steps

- **C7. Step 0, clock.** The clock sub-machine reads the frame's session time, the runner's flashback report and receive-time differences, and returns the frame on the race clock together with clock facts (a fall carried over, a forward jump, a pause, the simulated end). It runs before every other step. `[test]`
- **C8. Step 1, state update.** Reads the frame; writes the live state (values only) and the signals. Decides no situation. Each value carries when it was last updated (`updatedAt` per data source). Realism is applied here: a rival's hidden value is `unknown('realism')` in the live state, and so in every fact built from it; situations stay public. `[test]`
- **C9. Step 2, machine.** Reads signals, values and its own open spans; writes open spans, closed spans and this frame's stamps. `[test]`
- **C10. Step 3, recorders.** Read the live state, the situations and their own open state; append facts to the log. A decision committed by the user enters the engine as an input with the frame it was committed at, and the decision recorder appends it. `[test]`
- **C11. No coupling within a step.** A module reads only its step's inputs and its own open state, never another module's open state or same-frame output. The one declared exception is the order of sub-machines inside step 2 (C15). `[test: each step's modules in shuffled order give identical results]`

### Signals

- **C12. The signal list is closed** (the F1 25 adapter's):
  - LapData: `pitStatus`, `driverStatus`, `pitLaneTimerActive`, `resultStatus`, `numPitStops`, `pitStopShouldServePen`, `numUnservedDriveThroughPens`, `numUnservedStopGoPens`, `penalties`, `totalWarnings`, `cornerCuttingWarnings`, `currentLapInvalid`;
  - CarStatus: `vehicleFIAFlags`, `drsAllowed`, `networkPaused`;
  - Session: `safetyCarStatus`, `marshalZones`, `numSafetyCarPeriods`, `numVirtualSafetyCarPeriods`, `numRedFlagPeriods`, `sessionType`, `weekendStructure`, `numSessionsInWeekend`, `ruleSet`, `gamePaused`, `isSpectating`, `spectatorCarIndex`;
  - Participants: `numActiveCars`, `aiControlled`;
  - events SSTA, SCAR, STLG, LGOT, RDFL, CHQF, RCWN, SEND, RTMT, DRSE, DRSD, PENA, DTSV, SGSV, TMPT, FLBK.

  BUTN is ignored. Every other game field is a value. A new signal is a contract change. `[review]`
- **C13. Only the machine reads signals.** Signals live in an engine-internal module that only `situations/` may import. No signal appears in the live state, a fact, the view or a topic, and no `domain` type has a signal field. `[type, depcruise]`

### The machine

- **C14. Weekend phase first.** After the clock, the weekend-phase sub-machine decides the weekend phase and format once the session's weekend structure is known (the first Session packet that carries one). Until then the weekend phase is `pending`, no per-phase sub-machine runs, and readers treat the session as on the grid. It is fixed for the session and selects which sub-machines run. A sprint is the race phase with format `sprint`; a race session is the sprint when the weekend structure lists a later race session (seen once: type 15 in structure [15, 16]). A sprint shootout is the qualifying phase with its format. A time trial or an unknown session type has the weekend phase `none`: only shared sub-machines run, and units that need a phase report `notApplicable`. `[test]`
- **C15. Sub-machines are registered by convention.** One folder each, `situations/<name>/`. Each declares `appliesTo` (`all` or a list of weekend phases), its inputs (signals, values, outputs of named upstream sub-machines), its span types (in `domain`), its transitions (`from → to`) and a `version`. Order follows the declared inputs; a cycle fails generation. `[gen, test]`
- **C16. Shared only on evidence.** A sub-machine applies to `all` only if recordings of at least two weekend phases show it with the same signals; otherwise it applies per phase. Moving it is a contract change. `[review]`
- **C17. The inventory.**
  - Shared: clock, weekend phase, car location, car status, flags (yellow, green, blue; marshal zones and car flags), warnings, lap validity.
  - Per phase (race, qualifying, practice, each its own): session phase, car activity, race control.
  - Race only: penalties served or added (drive-through, stop-go, time).

  Car activity takes car location and car status as upstream inputs. Transition rules live in the situations catalogue (`docs/research/09-situations-catalogue.md`) and the tests, not in this contract. `[gen, review]`
- **C18. Confirmation without withdrawal.** A span opens on its earliest reliable signal; a pending confirmation is the sub-machine's open state; a span that is never confirmed closes as a fact with `confirmed: false`. No sub-machine withdraws a fact. `[test]`
- **C19. Unseen situations fail safe.** A situation known only from the game's specification is implemented, logged when it occurs and marked "not yet seen" in the catalogue; it never hides or discards facts. `[review]`
- **C20. Situations reach readers two ways only:** open spans in `view.situation`, and closed spans in the projection (and from both, core topics). `[type]`

## 3. The log, the projection and time

- **C21. The log is the session's record of facts.** One list per fact type and one span list per sub-machine (`spans[machineId]`). A new session starts an empty log. A fact's id is its list and its position; a fact may reference earlier facts by id (a served drive-through names its penalty and its pit visit). `[type]`
- **C22. Who appends.** Only the machine (spans, clock facts), the recorders (facts, decisions) and the runner (void facts) append to the log. `[type: only they receive a writable log]`
- **C23. Facts only.** The log holds no judgement, no intermediate value, no output of a unit. `[type]`
- **C24. Append-only, without exception.** A fact, once appended, is never changed, replaced, reordered or removed, in memory or in storage. Storage holds one log per session and rules version: a rebuild (C61) produces the session's log again from its recording and replaces the cached one as a whole, so nothing is lost. `[type: read-only entries; test]`
- **C25. Superseding is a new fact.** Superseding is one kind of reference: the confirmed lap record names the provisional one it supersedes; both stay in the log and in the projection. Readers get the current version through `domain` helpers (`currentLaps`), never by their own matching. `[review]`
- **C26. Stamps decide membership.** Every fact carries `in: { [machineId]: spanId }`, the spans open when it was recorded; a car's fact includes the car sub-machines' spans of that car. A span's id is the number of spans its sub-machine opened before it in the projection (per car for a car sub-machine), so after a rewind the re-opened spans get the ids a run without the undone frames gives them. Which situation a fact belongs to is read from its stamp, never judged from times. `[type, test]`
- **C27. A flashback appends a void fact.** The runner decides the flashback; restores the live state, every open state and the scheduler's bookkeeping (last run times, previous outputs, the active insights) from its newest snapshot at or before the target; appends one void fact: the target (frame, race-clock time) and per list the position range `[length at the snapshot, length now)`; and replays its kept frames up to the target, which append their facts again after the void. The clock sub-machine records a visible flashback fact (target time, rewound ms, target lap). Nothing is removed. `[test]`
- **C27a. A rewind voids everything after its target,** decisions included: a decision rested on facts that no longer happened. `[test]`
- **C28. Readers see the projection, never the log.** The view's history and the storage read API are the projection: the log without hidden facts. Exactly one module computes it. The log's only other readers are the storage writer (which writes it as it is) and the runner (which reads list lengths). The projection only grows, except when a void fact appears. `[type, depcruise]`
- **C29. Formation is hidden, not diverted.** Recorders record during the formation lap as always; their facts carry the formation stamp, so the projection never shows them. Spans are never hidden by a stamp: the formation span itself, and every other span, stays visible. At lights out nothing changes and no reader restarts. `[test]`
- **C30. A rewind concerns only state derived from the projection.** `HistoryDelta` is `{ before, after, rewound? }` per list; `rewound` means a void fact appeared. Then, and only then: every accumulator is rebuilt by `init`, every running job is cancelled and re-triggered, the scheduler's bookkeeping is the restored snapshot's, insight events after the target are dropped, and the publisher resends every append topic (insights included) whole. A stateless reader does nothing. `[type, test]`
- **C31. The one exception: an incremental accumulator.** A unit may keep state derived from the projection only as the accumulator of an incremental calculator or analysis, and only if all hold:
  1. a benchmark test shows that its from-scratch computation misses the per-frame budget on the long-race fixture; without it the unit is quick `[test: benchmark]`;
  2. the accumulator is a pure fold over projection entries and config, holding nothing else: no other unit's output, no frame data, no clock `[type, review]`;
  3. at every frame, also after every rewind, it equals `init` over the current projection `[test: incremental = from scratch]`;
  4. it is never stored, never published and never read by another unit except through the unit's output `[type]`;
  5. it is rebuilt by `init` on `rewound` and on nothing else.
- **C32. Derived state lives in memory.** During a run, everything derived from the log (intermediate values, outputs, topic values, accumulators, the scheduler's bookkeeping) lives only in memory and is recomputable from the projection at any time. Across runs, the only persistent derived data is the priors store (C62a). `[type, review]`
- **C33. Rewind exactness.** After a flashback the projection and every topic, insights included, equal those of a run that never received the undone frames; job topics are excepted. An insight that holds again after the rewind is a new occurrence and needs a new acknowledgement. `[test: property]`
- **C34. Hidden facts stay unread.** Storage's one read API returns a stored session's projection. No code reads hidden facts until a contract change adds a reader. `[type]`
- **C35. One time: the race clock.** Every time in a fact, a span, a value's `Known.at` and the view is on the race clock. The game's session time appears only in clock facts and diagnostics. `[review]`
- **C36. The race clock is continuous.** A fall of the session time that is no flashback (the start settling included) is carried over by an offset; a forward jump is a clock fact; the post-session simulation is a session-phase signal. Nothing re-stamps a recorded fact. `[test]`
- **C37. Wall time only as differences.** Receive-time differences on frames are read only by the clock sub-machine (pauses, the simulated end) and by frame assembly's session tracker (the SEND grace window). Feed health is computed by the bridge from receive times (so a recording's record times reproduce it) and reaches units only as `view.feed`. `[depcruise, review]`
- **C38. Determinism.** The same recording with its sidecars (config, priors, decisions) always gives the same log, projection and topic stream (job topics excepted); reprocessing equals the live run. `[test: acceptance]`

## 4. The view and computation

- **C39. The view is all a unit may see.** It is read-only and holds: `live` (the live state), `situation` (the open spans per sub-machine, per car where the sub-machine is per car), `history` (the projection), `delta`, `changed` (change tags), `weekend` (the projections of the weekend's earlier sessions), `config`, `priors`, `feed` (feed health) and `outputs` (the outputs of the units it reads). Nothing else reaches a unit. `[type]`
- **C40. Change tags come from the registries:** one per live-state area, one per fact list, one per sub-machine. A new sub-machine adds its tag without a change to the scheduler. `[gen, type]`
- **C41. Kinds and reads.** A unit is quick or incremental (C31). It declares `reads` (change tags, sub-machines, other units) and a `cadence`, and reads nothing it does not declare. `[test: in tests each unit gets a guarded view that throws on any undeclared access]`
- **C42. Role by output.** A calculator's output has no topic and raises no insights. An analysis's output is bound to a topic or raises insights. `[gen: catalogue]`
- **C43. Who decides what.** Situations are decided only by the machine. Judgements are made only by calculators and analyses; a judgement several analyses need is one calculator, so they agree. Displays, the shell and the bridge make no judgement. `[review]`
- **C44. Behaviour tables.** Every unit that reads a sub-machine holds one behaviour table covering every kind of that sub-machine. The table type lives in `analysis/src/shared/`. `[test: completeness over every unit's declared sub-machines]`
- **C45. A log reads history only.** An analysis that keeps a record of what happened (a feed, a list) builds it from the projection, never from another unit's current output; logic two need is a shared pure function over the projection. `[review]`
- **C46. `race-moment` ranks and detects nothing.** It reads situations from the view and other analyses' outputs and answers one question: what deserves attention now. Its own moments are judgements only (battle, incident, car care, window, weather); situation moments come from the machine. `[review]`
- **C47. Config.** A unit's thresholds are declared in its own `config.ts` (`defineConfig`), overridable by `<data dir>/config.json`, fixed for a run, and read through `view.config`. A live session stores its effective config as a sidecar next to its recording; a replay uses that copy. `[test]`
- **C48. Failure is contained.** A unit that throws is reported as a system insight and skipped with its dependents; the rest run on. `[test]`
- **C49. On demand.** A unit runs only while a subscribed topic is bound to it, it raises insights, or a needed unit reads it. A newly needed unit runs at once against the current view. `[test]`
- **C50. Simulators.** A simulator is a pure function in its own unit folder. It takes plain inputs (a starting point built by one shared builder from the view and calculator outputs, for strategy `forecast-field`, plus decisions) and returns typed results. It has no `reads`, no cadence and no topic and is not run by the scheduler; randomness only from an injected generator. Only analyses and job modules call it. `[depcruise, gen]`
- **C51. Jobs.** An analysis's expensive work runs as a job: a trigger `job:<id>` with `reads` and a cadence; `prepare(view)` makes a structured-cloneable input; `run(input, rng)` runs in a worker; the result reaches its topic as `Computed<T>`. A declared job without a binding, or a binding without a job, fails at startup. Job topics are excluded from the determinism hash. `[test]`
- **C52. Insights.** Only analyses raise and clear insights, through their `insights` hook, with one exception: the scheduler (a failing unit, C48) and the bridge (feed health, write failures) raise insights of category `system` only. The flashback insight is an analysis reading flashback facts. Alarms are the insights of the `alarms` analysis. Acknowledging and muting are UI state. `[type]`

## 5. Topics, the bridge and the UI

### Topics

- **C53. One file per topic** in `packages/contracts/src/topics/<name>.ts`, collected by a generated index. A topic declares its owner (a unit or `core`), its mode (`state` or `append`), `maxHz` and its params. `[gen]`
- **C54. Two kinds.** A core topic publishes projection lists, sub-machine spans (open and closed) or parts of the live state, as they are. An analysis topic publishes one analysis's output. No topic value contains a signal. `[type]`
- **C55. Typed bindings only:** `bindState` (a unit's output), `bindHistory` (a projection list), `bindSituation` (a sub-machine's spans), `bindInsights`, `bindJob`. A binding compiles only when the source type matches the topic's. `[type]`
- **C56. Names follow owners.** A unit's topics carry its camelCase name as a prefix (`battle-cards` owns `battleCards.*`); core topics carry none. `[gen: catalogue]`
- **C57. Append topics follow the projection.** They append new projection entries; on `rewound` the whole topic is resent. `[test]`

### The bridge

- **C58. All I/O is in the bridge:** UDP and recording input, hosting the runner, storage, the job runner, the hub and WebSocket, the CLI, UI-state files. Ports and paths come from the environment (`PITWALL_WS_PORT`, `PITWALL_UDP_PORT`, `PITWALL_UDP_HOST`, `PITWALL_UI_PORT`, `PITWALL_DATA_DIR`, `PITWALL_FIXTURES_DIR`). `[depcruise, review]`
- **C59. Recordings are the source of truth.** Every live session writes its raw packets to a `.pwrec` file, with its effective config, its priors and its decisions as sidecars. `[test]`
- **C60. Storage is a rebuildable cache of the logs.** SQLite holds every session's log, keyed by session uid and weekend id, append-only, in generic tables (facts by list, spans by sub-machine id): a new sub-machine adds rows, not tables. The schema version changes only when the storage layout changes. `[test]`
- **C61. Rules version.** Storage records the rules version that produced each session. On a mismatch the bridge rebuilds that session from its recording before serving it: at bridge start, before input opens, the current weekend's sessions (with progress shown); every other session when it is first read. `[test]`
- **C62. Weekend context.** At session start the bridge loads the projections of the player's earlier sessions of the weekend and gives them to the engine read-only (`view.weekend`). `[type]`
- **C62a. The priors store.** A second database of season-wide priors (calibration, model parameters). Each entry is declared by a unit with a key, a scope (weekend, track, season) and a pure `aggregate` function, computed from the projections of stored sessions in scope; user calibration enters as decision facts. It is a cache: each entry records its aggregate's version, a mismatch recomputes it, deleting the store loses nothing. Only the bridge writes it, between runs (session end, rebuild); units never write it. A run reads it once at session start as `view.priors`, fixed for the run and written as a sidecar next to the recording; a replay uses the sidecar. `[type, test]`
- **C63. Registration by convention.** Features (`apps/bridge/src/features/<name>/register.ts`), topics, widgets and sub-machines are each collected by a generated index; there are no central lists. `[gen]`

### The UI

- **C64. One path in.** Data flows WebSocket → connection (topic store) → shell (panel) → display. Only `connection/` talks to the bridge. `[depcruise]`
- **C65. Displays render.** A display formats values and applies emphasis and its presentation table, nothing else: no arithmetic beyond formatting, no fetch, subscribe or measure. The panel resolves the display's declared data and passes it as props. `[review, depcruise]`
- **C66. Presentation tables.** A display that reads a sub-machine's output or `raceMoment` holds a pure `presentation.ts`: situation kind or moment → layout variant, visible parts, emphasis. `[test: completeness over what it reads]`
- **C67. One layout controller.** The shell's layout controller is the only code that switches the active workbook or layout. Manual switches arrive as commands; automatic switches come from switch rules in UI state ("SC layout while neutralised", a workbook per weekend phase), keyed on machine facts and `raceMoment`. A manual choice pins the layout: rules pause until the user unpins it or the session changes, and the top bar shows the pin. `[test]`
- **C68. Presentation is centralised.** Numbers and units in `kit/values/format.ts`; wording in `kit/text.ts` and each widget's `text.ts`; colours and fonts as theme roles; state to role in `emphasis.ts`. No colour literal outside `theme/`. `[lint, test]`
- **C69. Folder rules.** `kit` imports only `theme`, `emphasis`, the contracts package and `domain`. `shell` is the only importer of `dockview-core` and, with the gallery, of the widget index. A widget imports only `kit`, `theme`, `emphasis` and its own folder. Only the gallery imports `gallery.ts` files. `[depcruise]`
- **C70. UI state is owned by the bridge.** It is stored in `PITWALL_DATA_DIR/ui/`, published as `ui.*` topics and changed only by uiActions. Windows hold no persistent state. `[test]`
- **C71. Host-agnostic.** Everything host-specific goes through `Host`. `[depcruise]`

### Interaction

- **C72. Every user action is a command** in the shell's one registry (`shell/commands/`). The palette, keys, menus and buttons invoke commands by id. Only the shell binds keys: defaults plus `keys.json`. `[test, review]`
- **C73. Two kinds of change.** A persistent change (UI state or a decision) goes as a uiAction to the bridge and takes effect when the bridge publishes it; the window keeps no copy. A window-local change (focus, overlays, panel size, a highlight, a draft in an input field) stays in the window and is rebuilt on reload. A text or number input commits one uiAction with its value; the bridge validates it against its declaration (type, range) and answers an invalid value with a rejection the UI shows, never storing it. `[type, test]`
- **C74. What a widget may do.** A widget sends only the uiActions its declaration lists, through its panel. It never changes link groups, layouts, workbooks or settings; any other click stays inside the widget as a local highlight. `[type]`
- **C75. Settings are declared once,** with type and default, in the contracts package's UI types, stored by the bridge, read through `ui.settings`. A setting that affects the engine (realism) takes effect at the next session start and is fixed for the session. No uiAction changes engine or analysis results within a session, except a decision (C76). `[type, test]`
- **C76. Decisions are recorded facts.** A committed decision goes as a uiAction to the bridge, which writes it to the decisions sidecar and hands it to the engine with the current frame; the decision recorder appends it to the log (C10). A replay or reprocess feeds the sidecar back at the same position in the recording (record index), not at a frame id. A flashback voids decisions like any fact (C27a). Analyses read decisions from the projection. `[test: determinism]`
- **C77. Read-only toward the game.** Nothing in pitwall sends input to the game. `[review]`

## 6. Work and verification

### Ownership

- **C78. Supervisor-owned.** `packages/domain/**`; the contracts package except a unit's own topic files; the engine core (`state/`, the signals module, the machine interface and registry, the projection module, the runner, the step order); the UI kit, shell, connection, theme and emphasis; every `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root configs and generated indexes. Workers request changes in their report; the supervisor may delegate one named change to one agent. `[hooks, review]`
- **C79. The contract and the ADRs change only under C0.** `[review]`
- **C80. One worker per unit.** A unit is kebab-case named. `PITWALL_WORKER_UNIT` grants its folders: for an analysis or calculator `packages/analysis/src/<name>/` and its tests, its feature and its own topic files; for a display `apps/ui/src/widgets/<name>/`; for a sub-machine `packages/engine/src/situations/<name>/` and its tests. Its domain types are a supervisor change. `[hooks]`
- **C81. Bottom-up, shared first.** Contracts first: types, topic files, unit ids and config declarations are committed by the supervisor before any test agent starts. Then sub-machines, calculators, analyses, displays. Anything two parallel workers would share is built before both. `[review]`
- **C82. Two phases per task.** A test agent writes the failing tests and commits them; an implement agent makes them pass without touching tests or `gallery.ts`; the supervisor checks that `git diff <test-commit>..HEAD` on tests is empty. A test of a deleted mechanism is deleted with it; a test of behaviour that stays is ported, never dropped. `[hooks, review]`
- **C83. Briefs and reports cite the contract.** A brief names the clauses its task touches; a report lists every contract gap. `[review]`

### Verification

- **C84. Real data only as segments.** A test on real data uses a segment of at most 1 MB (or one of at most three full-lap segments of about 8 MB), cut with `pwrec-cut` from a normal session, targeting one behaviour. Whole recordings serve only whole-pipeline properties in the acceptance suite. No test asserts a fact of a recording; the time trial is no fixture. No test reads the priors store, storage or `PITWALL_DATA_DIR`: a test that needs priors passes them explicitly (the defaults or a committed fixture file). `[review, test: the test setup points the data dir at an empty temporary directory]`
- **C85. Every transition is tested.** Each sub-machine's test file holds a transition table, one row per declared transition and per join; completeness tests check both ways that rows and declared transitions match; one property test per sub-machine feeds random signal sequences and checks its invariants (no undeclared transition, no throw, one open span per scope, contiguous spans). Recorded transitions are covered by segment tests on the produced span sequence. Adopting or widening a rule requires the output of `pitwall scan-situations` over every recording in the report. `[test, review]`
- **C86. Required properties:** determinism; incremental equals from scratch across rewinds; rewind exactness; shuffle within a step; the projection only grows except at a void; reprocess equals live. `[test]`
- **C87. Required completeness tests:** transitions (C85), behaviour tables (C44), presentation tables (C66), guarded views (C41). Each is one generic test over its registry. `[test]`
- **C88. Test levels.** A worker runs the tests related to its changes (`vitest related`) plus typecheck, lint and depcruise. The supervisor runs `pnpm check` before every merge. `pnpm test:ui` and `pnpm test:acceptance` run at the end of each sub-project; Stryker once at the end of the MVP. Vitest's `Errors` line is read as well as `Tests`. `[review]`
- **C89. The one review question: did this change violate the contract?** If not, the review is clean; naming, style and tighter tests are not findings. If yes, the reviewer cites the clause and decides: fixable within the contract (a finding, fixed in two phases before the next task) or a contract gap for the user (C0). `[review]`
- **C90. A changed sub-machine bumps its version** in the same commit, which changes the rules version and rebuilds stored sessions (C61). `[test: a changed sub-machine without a version bump fails]`
