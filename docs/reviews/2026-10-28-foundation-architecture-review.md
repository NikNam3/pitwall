# Foundation architecture review

Date: 2026-10-28 · Subject: sub-project 1 as merged on `main` (bf342ac) · Status: draft for discussion

## 0. Purpose and method

This review checks every part of the foundation against three questions:
1. **Why does it exist?** Which goal (CLAUDE.md "Goals") or research finding justifies it.
2. **Does the code deliver it?** It is judged on the code, not on the spec.
3. **Is it ready for what comes next?** Each later sub-project and the research findings it will rely on: the TUM race model, the ATLAS interaction model, the F1 25 data mapping, the pit actuator.

Inputs:
- the spec, the plan, the ADRs and `architecture.md`
- the source of every package (about 8 k lines without tests)
- the research session of 2026-10-27/28. It is not stored in the repo; its findings that matter are summarised in section 2.

Gate run for this review: `pnpm check` is green, with 89 test files, 775 tests passing and 1 skipped.

Each verdict below uses this scale:
- **Sound:** keep it as it is.
- **Sound, with a gap:** the idea is right; something is missing or not wired up.
- **Rethink:** the shape will hurt later.

## 1. Summary

The core shape holds up:
- a functional core with an imperative shell
- the raw stream as the source of truth, with a cache that can be rebuilt
- `Known` instead of 0
- frames assembled from packets, with flashback rewind
- topics with "latest value wins" delivery

No part needs to be rethought from scratch. Nine findings need work. Most are small now and expensive once sub-projects 3 and 4 build on them:

| # | Finding | Verdict | Fix before |
|---|---|---|---|
| F1 | Calculators run whether or not anyone subscribes; demand-driven scheduling exists in the engine but the bridge marks everything as needed | gap | SP 3 |
| F2 | Jobs (Monte Carlo, optimisation) have no home: the `Job` type lives in the bridge, where `strategy` cannot import it; `Feature` has no jobs and no topic binding for them; `JobRunner` is used nowhere | gap | SP 4 |
| F3 | Change tags are named after packets (`status`, `telemetry`, `motion`), not domain areas, so a calculator's `reads` needs to know which packet fills which field | rethink (small) | SP 3 |
| F4 | Topic bindings are untyped (`from: string`, `select: (unknown, object) => unknown`), so the compiler doesn't check that a calculator feeds its topic the right value type | gap | SP 3 |
| F5 | Each lap is appended twice (provisional, then confirmed). Every consumer has to work out the current version of each lap itself, and no shared helper exists yet | gap | SP 3 |
| F6 | Calculators have no configuration input: alarm thresholds, tyre windows and fuel targets can't be passed in without breaking purity | gap | SP 3 |
| F7 | `WeekendContext` holds the player's laps only; the TUM model needs every driver's pace and degradation from practice | gap | SP 4 |
| F8 | Lap, stint, pit-stop and flag logic is tested only on synthetic frames: no recording has a completed race lap, a pit stop or an SC | risk | SP 4 (needs recordings) |
| F9 | `Known.stale` is declared but never produced; only the feed as a whole turns stale | gap | SP 3 |

Smaller notes are in section 5. Decisions only you can make are in section 6.

## 2. What the research asks of the foundation

Condensed from the research session. Each later section refers back to these items as R1–R12.

| # | Research finding | What it asks of the foundation |
|---|---|---|
| R1 | Real teams split the work into four views: timing, strategy, car monitoring, performance analysis | data for all four from one model |
| R2 | ATLAS: live and historical data in the same tool; compare sets; math channels; alarms over the stream; workbooks per role | the same pipeline for live and replay; derived channels as a first-class extension point; alarms as rules |
| R3 | TUM lap-time model: an additive lap time per lap (base + tyre(age, compound) + fuel·sensitivity + …) | one record per lap with compound, tyre age, fuel, in-lap/out-lap and SC/VSC share |
| R4 | TUM degradation fit: a quadratic per stint over clean laps only (drop laps 1–2, in-laps and out-laps, SC/VSC laps) | the lap flags needed for that filter; stints |
| R5 | SC/VSC start at a race time, not at a lap; partly neutralised laps are blended by their share | flag phases with session times; `scShare`/`vscShare` per lap |
| R6 | Pit loss differs per track and per condition (green/VSC/SC); the "halve it" rule is wrong | pit stops with the flag status and track; kept across a season |
| R7 | Race history chart: `gap(l) = t_race(l) − l·t_virt` | each car's race time at every lap line |
| R8 | Rejoin projection, undercut threat ("car behind just pitted") | gaps between any two cars; pit events for every car |
| R9 | Monte Carlo: seeded, worker-based, results tagged with what they were computed for, re-run when the race changes | a job framework with seeds, cancellation and `computedFor` |
| R10 | F1 25 restricted data: human rivals with private telemetry send zeros for fuel, ERS, wear and damage, and no tyre-set packet | `restricted` as an explicit unknown; the strategy model must work with measured *or* estimated wear |
| R11 | Game extras: `TyreSet.lapDeltaTime` (≈ TUM `k0`), the game's own pit window, the `safetyCar` setting (SC probability), sector boundaries in metres | captured in state |
| R12 | Pit actuator (SP 6): confirmation through `mfdPanelIndex` and the pit window fields | a reserved command channel; those fields captured |

## 3. Part by part

### 3.1 Package split and dependency rules
**Why:** clean code and extendable code (goals 1 and 2) are the top goals. Hard package borders make "the UI knows no packets, the engine knows no sockets" a build error instead of a convention. They also let parallel workers own separate folders. ADR 0003 adds `domain` so the UI never has to import `engine`.

**Code:** dependency-cruiser enforces the edges (277 modules, no violations). pnpm's strict dependencies back it up.

**Verdict:** sound. One deviation from the spec is fine but should be written down: the frame assembler and `SessionTracker` sit in `engine/frame`, not in `apps/bridge`. Both are pure, so the engine is the right place. Spec 5.1 still says "the bridge only drives it", which matches. `architecture.md` doesn't mention it.

**Future:**
- `strategy → engine, domain` is right for the deterministic calculators (SP 4).
- See F2: jobs need a type that `strategy` can import.

### 3.2 Protocol: schema DSL, one description for decode and encode
**Why:**
- The spec has 16 packets and a little over 300 fields. Describing each struct once, and deriving both the decoder and the encoder from it, rules out a whole class of drift bugs.
- The encoder exists so property tests can round-trip packets (random packet → encode → decode → equal) and so test builders produce realistic bytes.
- Results instead of exceptions (`DecodeResult`), because bad input is expected over the internet.

**Code:**
- The DSL is small (`dsl.ts`, `codec.ts`).
- `Infer<S>` gives exact packet types.
- Split times are merged into ms, including the negative-delta quirk found in the recordings.
- Mutation score: 95 %.

**Verdict:** sound. This is the most solid package.

**Future:**
- A new game year means a second schema set behind the same `decode`. CLAUDE.md currently forbids that; it's a deliberate scope limit, not a design limit.
- Fields the engine ignores (e.g. `mfdPanelIndex`, R12) are already decoded, so capturing them later is an engine change only.

### 3.3 Domain vocabulary: `Known`, `Corners`, units, records
**Why:**
- `Known<T>` exists because of R10. The game sends 0 for withheld data, and a strategy model fed a "0 % wear" would be confidently wrong.
- `Corners` removes the RL/RR/FL/FR ordering trap in one place.
- Fixed units (ms, m, km/h, °C, …) keep every calculator free of conversions.
- The records (`LapRecord` …) use engineering terms (lap, stint, pit stop, flag phase), not packet terms, so the code reads like race engineering (goal 5).

**Code:** `Known` appears only where the game can actually withhold a value or where a value cannot apply. That is the right discipline; wrapping every field would make every widget noisy.

**Checked against the research:**
- R3 and R4: `LapRecord` carries everything the TUM clean-lap filter and the lap-time model need: compound, `tyreAgeAtStart`, fuel at start and end (`Known`), `inLap`, `outLap`, `scShare`, `vscShare`, `valid`, `positionAtEnd`. That is a good fit.
- R5: `FlagPhase` has session times plus leader laps, as the paper prescribes.
- R6: `PitStopRecord` has `flag` and the pit-lane and stationary times. Pit *loss* (in-lap plus out-lap against race pace) is derived from laps, so it needs no extra field.
- R11: `TyreSet.lapDeltaMs`, `session.pitWindow`, `settings.safetyCar` and the sector boundaries in metres are all captured.

**Verdict:** sound, with small inconsistencies:
- `speedTrapFastestKmh: Kmh | undefined` breaks the "missing is `Known`" rule.
- The timing fields are plain 0 until the first LapData arrives, and only `car.active` protects them. That is acceptable, but the UI has to respect `active`; it should go into the UI guidelines for SP 2.
- Q1 (raw physics channels in game units) is answered A. The field names still have no unit suffixes (`velocity`, `slipAngle`, `speed` in `OwnCarMotionEx`). Add the suffixes now, while nothing reads them yet.

### 3.4 Input and `.pwrec`: the raw stream as the source of truth
**Why:**
- Nobody can develop against the live game (it runs on the drivers' Windows PCs), so recordings are the only way to get real data to the development machine and to the agents.
- A deterministic replay makes bugs reproducible and fixture tests meaningful.
- Raw first means any later feature (traces for performance analysis, new calculators) can be backfilled by reprocessing, with no data migrations.

**Code:**
- `PacketSource` covers UDP and replay (real time and as fast as possible).
- The reader is lenient (`Z_SYNC_FLUSH`, cut-off files) and skips unknown record kinds.
- The writer flushes about once a second.
- `FORMAT.md` in the recorder repo stays the authority.

**Verdict:** sound.

**Future:**
- The forwarder (target transport) is just a third `PacketSource`.
- Sub-project 5's traces and ATLAS-style compare sets (R2) can be built by reprocessing old `.pwrec` files. This is the main payoff of choosing raw first.

### 3.5 Session tracker and frame assembler
**Why:**
- The engine should see one coherent "moment" per step, not 6 to 16 loose packets. The spec guarantees that packets at the menu rate share a frame.
- Session boundaries and the UID-0 quirks are game facts the engine shouldn't have to know about.

**Code:** every correction found in the recordings is implemented and tested:
- grouping by `overallFrameId`
- a reorder window of 2 frames
- the grace window on both sides of `SEND`
- a session opens only with a Session packet
- loss measured by frame completeness instead of `frameId` gaps

**Verdict:** sound. One determinism exception is documented: the grace window compares receive times. Replays use the recorded receive times, so the result is still reproducible.

**Future:** two feeds of the same race (second driver, R1) give two trackers and two engine states. That's fine, see 3.11 and Q-A.

### 3.6 Engine state and `step`: the functional core
**Why:** this was Option A of the brainstorm, chosen for testability, determinism and clean borders for parallel agents. Mutation inside `step` with a read-only view outside answers the performance concern without a deep copy per frame.

**Code:**
- `step` is a fixed sequence of sub-steps (`SUB_STEPS`), one per domain area. Each one reads the frame and tags what changed.
- `CarState` is grouped by domain (identity, timing, tyres, energy, condition, dynamics, own car), as the spec says.
- `withholdRestricted` is the single list of restricted fields (R10).

**Verdict:** sound, with F3 (change tags).

**F3, change tags are shaped like packets.** `CHANGE_TAGS` are `session, participants, timing, motion, telemetry, status, damage, setups, motionEx, tyreSets, …`. A calculator that needs the compound must declare `reads: ['status']` because Car Status carries the compound (`cars.overview` does exactly that). That brings protocol knowledge back into every calculator, and it contradicts the "by domain, not by packet" rule the state itself follows.
- **Fix:** tag by domain area: `identity, timing, tyres, energy, condition, dynamics, ownCar, session`, plus the history lists. Each sub-step tags its own area, and calculators then read like engineering.
- **Cost:** it touches every sub-step and the 7 calculators that exist today; after SP 3/4 there will be dozens. Do it as one supervisor task, because it cuts across the folders of every worker.

**Future:**
- `EngineView.state` also exposes `open` (the trackers for work in progress). A calculator that reads `open.laps` couples itself to engine internals. Hide it behind a narrower view type (small; see 5).
- Per-sample traces for performance analysis (SP 5) are rightly kept out of state; see 3.4.

### 3.7 History and flashbacks
**Why:**
- History is append-only so that two things are cheap and exact: a snapshot only needs the list lengths, and a flashback truncates back to them.
- An incremental calculator's accumulator is always "a fold over a history prefix", which is what makes F1-style live re-estimation (R4) affordable and testable ("incremental = from scratch").
- Mini-sector crossings for all cars are the shared basis for pairwise gaps, live micro-sectors, rejoin projection and undercut detection (R8).

**Code:**
- snapshots every second, thinned outside the 10 s replay window (Q3 = A)
- exact replay inside the window
- the double-report guard
- `copyPlain` instead of `structuredClone` (7× faster)

**Verdict:** sound, with F5 and F8.

**F5, each lap appears twice.**
- `history.laps` holds a provisional record when the lap number rises and a confirmed record when Session History has the lap.
- The `laps` topic sends both, and SQLite stores only the confirmed ones.
- So every consumer has to answer "what is the current version of car c, lap n?": the degradation fit, the race history chart, the lap table, and the UI's lap store.
- This is consistent with append-only, but the logic will be written five times unless it exists once.
- **Fix:**
  - an engine helper `currentLaps(history)` that returns, per (car, lap), the newest record
  - ideally also an incremental calculator `laps.current` (per car, lap-indexed) that strategy calculators read
  - on the UI side, one shared fold in the topic store (SP 2)
- No change to history itself.

**F8, real-data coverage.**
- Laps are validated on Zandvoort TT (15 laps).
- Pit stops, stints, flag phases, the SC/VSC share, fuel at lap start and end, and rival laps are covered only by synthetic scenarios: no recording contains a completed race lap, a pit stop or an SC.
- SP 4 is built entirely on these records (R3–R8).
- **Action:** get recordings 1 and 2 from spec 12 (a race of at least 25 % distance with a pit stop; a race with SC/VSC set to "Increased") before SP 4 starts, ideally before SP 3. Then add fixture facts for them. The flashback recording (Q2) also settles `replayWindowMs` and the known double-rewind gap.

**Future:**
- 50 equal-length mini-sectors give one crossing per car about every 100 m, which is enough for gaps and rejoin.
- A race produces about 22 × 50 × 60 ≈ 66 k crossings. They are kept in history and never sent whole, which is right: SP 3 should publish derived gaps, not raw crossings.

### 3.8 Calculator framework: quick, incremental, jobs; registry and scheduler
**Why:**
- Calculators are pitwall's "math channels" (R2) and its main extension point (goal 2).
- The three kinds came from your objection in the brainstorm ("no hidden state" is too strict for performance):
  - quick calculators are pure
  - incremental calculators may cache, but only as a reproducible fold
  - jobs are expensive and run asynchronously
- The registry turns `reads` into a dependency graph and rejects cycles and duplicates at startup.

**Code:**
- The registry and scheduler are careful work:
  - due, needed and affected checks
  - pending changes accumulate while a calculator isn't due, so an incremental calculator never misses history
  - isolation (a throwing calculator marks only its own dependents and raises an insight)
  - a flashback re-initialises incremental calculators
- The seeded RNG exists.

**Verdict:** sound, with F1, F2 and F6.

**F1, demand isn't wired up.**
- `SessionProcessor` calls `scheduler.setNeeded(registry.order.map((c) => c.id))`, so every calculator runs whether or not a widget subscribes.
- Today that's 7 cheap calculators. After SP 3/4 it will be dozens, some per car, on a laptop (goal 7).
- The spec's promise ("runs only when needed: subscribed topic, storage, or a dependent") is implemented in the engine but not used.
- **Fix:**
  - the hub reports the set of subscribed topics per feed
  - the pipeline maps topics to calculators through the feature bindings and calls `setNeeded` when that set changes
  - calculators that storage needs stay pinned
- Because late activation calls `init`, an incremental calculator that switches on halfway through a race still gives the same result (this is already tested as "incremental = from scratch").

**F2, jobs have no integration path.**
- `Job`, `JobRunner` and `worker-entry` exist in `apps/bridge/src/jobs`, and nothing uses them.
- `Feature` has `calculators` and `topics` only.
- Three things block SP 4/5 (R9):
  1. `strategy` can't import the `Job` type, because the bridge is above it.
  2. There is no trigger path from the scheduler's cadences to `JobRunner.trigger`.
  3. There is no topic binding for job results, and no `computedFor` on the wire.
- **Fix:**
  - move the `Job` type next to `Calculator` in `engine/calc/types.ts`
  - add `jobs` to `Feature` and a `{ topic, fromJob }` binding
  - have the pipeline trigger jobs on their cadence (the scheduler's `isDue` logic can be reused)
  - give results a wire type in contracts (`{ computedFor, value }`) so the UI can show how old a result is
- This is a small amount of code, but it touches supervisor-owned files, so plan it as the first task of SP 4.

**F6, no configuration input.**
- Alarm thresholds (tyre temperature window, brake temperatures, fuel target per lap, pit-loss overrides) have to come from the engineer.
- ATLAS alarms are user-defined rules with groups that can be switched on and off (R2).
- Today a calculator sees only `state`, `changed`, `delta`, `feed` and `outputs`.
- **Fix:**
  - add a read-only `config` to `EngineView` (typed per feature, defaults in the feature)
  - publish config changes as a change tag, so the affected calculators rerun
  - to keep determinism, store the config that was in effect with the session (or log changes into the session file), so a replay reproduces the alarms
- Decide the shape before SP 3's alarms; see Q-C.

**Future:**
- Two-speed strategy (R9, "fast deterministic every lap, MC in the background") maps directly onto quick or incremental calculators plus jobs, once F2 is fixed.
- The paper's open problem (strategies that react during an MC run) is a job-internal concern and doesn't affect the framework.

### 3.9 Features and topic bindings
**Why:**
- Registration by convention (ADR 0005): a feature is a folder, and a generated index imports them all. Parallel workers never edit one shared list, and `tsc` and dependency-cruiser still see every import.
- Bindings connect calculator outputs, history lists or insights to topics.

**Code:** bindings come in three kinds; publishing is contained per topic (one failing `select` marks only its own topic `errored`).

**Verdict:** sound idea, with F4.

**F4, bindings are untyped.**
- `{ topic, from: 'cars.state', select?: (out: unknown, params: object) => unknown }` means the compiler never checks that the calculator's output, after `select`, is `TopicValue<topic>`.
- If an SP 3 worker binds the wrong calculator, the bug shows up only in the UI.
- **Fix:**
  - a generic helper `bindState<T extends TopicName, Out>(topic: T, calc: Calculator<Out>, select?: (out: Out, params: TopicParams<T>) => TopicValue<T>)`
  - the same for history and job bindings
- The helper returns today's untyped binding, so the publisher stays as it is. This serves goal 1 at almost no cost.

### 3.10 Contracts and wire
**Why:**
- One typed source of truth for what crosses the WebSocket, shared by bridge and UI.
- One swappable wire module, so JSON can be replaced if a measurement ever shows the need.
- `CONTRACT_VERSION` makes a mismatched UI reload instead of misreading data.

**Code:**
- The decoders treat input as untrusted (they rebuild messages from known fields and never throw).
- `command` is reserved and answered with `notSupported` (R12).

**Verdict:** sound, with a tension worth deciding consciously (Q-B):
- `TOPICS` is one central list in a supervisor-owned file. Every SP 3/4 feature that adds a topic needs a supervisor edit of `topics.ts`, and a bump of `version.ts`.
- That cuts against "no central lists". For the wire contract it may be the right trade, because UI and bridge must agree, and one reviewer for every wire change is a feature.
- The alternative is one file per topic in `contracts/src/topics/`, collected by a generated index like the features.

**Smaller items:**
- `subscribe.feedId` is optional at the top level, and `CarParams.carId` is `number` rather than `CarId`. Fine for now.
- Before the second driver arrives, decide whether `feedId` stays optional.

### 3.11 Topic hub and WebSocket
**Why:**
- "Latest value wins, never a queue", so a slow pop-out window never shows old state (goal 3 and goal 6: "findable fast" means current).
- Throttling per topic and per client protects the laptop and the browser.

**Code:**
- The hub is pure bookkeeping (no timers, no sockets) and is tested in isolation.
- State values are produced lazily per subscriber (`valueFor`), so cloning happens only when something is actually sent.
- Append topics never drop entries; a backpressured client gets a fresh snapshot instead.
- A new session resets the feed.

**Verdict:** sound.

**Future:**
- The hub is already multi-feed, but `serve` runs one feed per process. For the second driver you can either run two processes (the UI then connects to two servers) or run several feeds in one bridge. One bridge is cleaner for the UI and lets a future "team" feature read both feeds; see Q-A.
- ATLAS compare sets (R2: my lap against best lap against a rival, or against an earlier session) map naturally onto "a replay feed alongside the live feed". That only works if the bridge can host several feeds. It's another reason to go multi-feed in one process.

### 3.12 Insights: the attention channel
**Why:**
- Goal 6 says important things should be in your face and the rest workable. The decision of what counts as important is made once, in the architecture, not separately in every widget.
- Insights are deduplicated by key, raised and resolved, and carry structured parameters that the UI formats.

**Code:**
- `InsightBook` turns "the conditions that hold now" into raised and resolved changes.
- Feed and storage alerts are handled separately (`FeedAlerts`).
- A flashback is an info entry that is raised and resolved at once.

**Verdict:** sound.

**Future:**
- SP 3 alarms need configurable thresholds (F6), and ATLAS has groups you can mute (R2). `category` can serve as the group; muting belongs in the UI or in config, not in the engine.
- The `insights` append log keeps every raise and resolve for the session, which is fine at race scale.

### 3.13 Storage: SQLite cache, repository, `WeekendContext`
**Why:**
- Practice data carries over into the race (agreed scope: weekend-wide, later season-wide).
- SQLite is embedded, crash-safe and inspectable, and it can be queried.
- It's a cache: there are no migrations, `reprocess` rebuilds it, and the repository interface hides the library.
- The engine gets earlier sessions as read-only input, so it stays pure.

**Code:**
- One database for all weekends (season-ready).
- Only confirmed laps are written; a flashback rewrites the session.
- A storage failure turns storage off for the session; live operation continues.

**Verdict:** sound, with F7 and two notes.

**F7, `WeekendContext` covers the player only.**
- The TUM model fits base pace and degradation per driver and per compound (R3, R4), and teams study competitors' long runs from practice.
- The repository can already filter by any `DriverKey`. Only the context is narrowed to the player.
- **Fix:** make it per driver, either `drivers: Array<{ driverKey, sessions }>` or a map by `driverKeyString`.
- AI drivers are stable across sessions (`driverId`). Humans depend on `networkId`, see the identity note below.
- This changes a supervisor-owned type, so do it before SP 4.

**Note 1, records are JSON blobs.**
- Only `laps.lap_time_ms` is a real column. Queries like "medium stints without SC laps" or "pit loss under VSC at this track" (the original argument for SQLite) need `json_extract` today.
- That's acceptable, because the database is a cache: adding columns means a `SCHEMA_VERSION` bump and a `reprocess`.
- Add columns when SP 4's queries are known, not before.
- One rough edge: an old database fails with `SchemaVersionError` and you have to run `reprocess` by hand. An automatic rebuild on a version mismatch would fit "cache, no migrations" better.

**Note 2, driver identity across a season** (unverified, needs recording 4, an online session with two humans).
- For humans, `DriverKey` is `networkId` plus name plus race number.
- `networkId` probably identifies a slot in the lobby, not the player. Names can be hidden online.
- Within one weekend in one lobby that is probably stable; across a season it probably isn't.
- Season-wide data (SP 5) will likely need a mapping the engineer maintains ("this key is Driver A").

### 3.14 Error handling and feed health
**Why:** bad input must never crash pitwall during a race. Exceptions mean bugs, and live they are contained and dumped so they can be reproduced.

**Code:**
- Every datagram is guarded.
- A frame that throws is skipped and dumped, up to a limit per session.
- `feed.status` is published before and during sessions.
- Wrong format, packet loss and stale feeds become insights.
- Startup is all or nothing (`serve` undoes the steps already taken).

**Verdict:** sound, with F9.

**F9, values never turn stale.**
- Spec 10.1 says values that haven't been updated for too long become `Known` with the reason `stale`, so the UI never shows old numbers as current.
- Only the feed as a whole turns stale.
- Per value, it matters for the low-rate rotating data: Session History and Tyre Sets about once a second per car, Car Damage at 10 Hz, and rivals after packet loss.
- **Fix:**
  - either the engine sets `stale` when a field's `at` is older than a threshold for its source (the cadence is known from the spec)
  - or the decision moves into the UI, which can compare `at` with `session.updatedAt`
- The second is simpler and keeps the engine free of thresholds. If you take it, change the spec and drop `stale` from `UnknownReason`.

### 3.15 Workflow tooling
**Why:** several agents work in parallel. Hooks keep writes inside each worker's scope and stop implementers from changing tests. A generated feature index avoids merge conflicts. Each worktree gets its own ports.

**Verdict:** sound for how it was used.

**Known limits (already in CLAUDE.md):**
- The guards don't see writes through Bash.
- In-process subagents inherit the supervisor's environment.

**Lesson recorded in memory:** don't run gates while another agent is editing source.

## 4. Research traceability

| Research need | Where in the foundation | Status |
|---|---|---|
| R1 four views from one model | `EngineState` + topics | ready (SP 3/4 add calculators) |
| R2 live = historical | `PacketSource` + deterministic engine + `reprocess` | ready |
| R2 math channels | calculators | ready, after F3/F4 |
| R2 alarms | insights | needs F6 |
| R2 compare sets | multi-feed hub | needs Q-A |
| R2 workbooks | UI (SP 2) | n/a |
| R3 lap-time model inputs | `LapRecord` | ready (F5 helper) |
| R4 clean-lap filter, per-stint fit | `LapRecord` flags, `StintRecord`, incremental calculators | ready; real-data check F8 |
| R5 SC/VSC by time, partial laps | `FlagPhase`, `scShare`/`vscShare` | ready; real-data check F8 |
| R6 pit loss per track and condition | `PitStopRecord.flag` + in-lap/out-lap + `sessions.track_id` | derivable; columns later (3.13) |
| R7 race history chart | confirmed `completedAt` (line crossing) | ready |
| R8 pairwise gaps, rejoin, undercut | `MiniSectorCrossing`, `PitStopRecord` | ready |
| R9 Monte Carlo framework | seeded RNG, `JobRunner` | needs F2 |
| R10 restricted data | `Known('restricted')`, `withholdRestricted` | ready; real-data check with recording 4 |
| R11 game extras | `TyreSet.lapDeltaMs`, `pitWindow`, `settings`, sector metres | ready |
| R12 pit actuator | reserved `command` | channel ready; `mfdPanelIndex` not captured yet (decoded only) |
| weekend carry-over (all drivers) | `WeekendContext` | needs F7 |

## 5. Small items (do when touching the code)

- Add unit suffixes to the raw physics fields (Q1 = A).
- Make `speedTrapFastestKmh` a `Known`.
- Give `EngineView` a state view without `open`.
- Make `CarParams.carId` a `CarId`.
- Capture `mfdPanelIndex` in `ownCar` when SP 6 starts.
- Rebuild the database automatically on a schema mismatch.
- `architecture.md`: say that the frame assembler and `SessionTracker` live in `engine/frame`.
- Write the research findings into the repo (`docs/research/`). Today they exist only in a past session transcript; the spec links to "the research" without a file.

## 6. Decisions for you

**Q-A, second driver: one bridge with several feeds, or one process per driver?**
- One bridge (my recommendation): the UI has one connection, team features can read both feeds, and a replay feed next to a live one gives compare sets (R2).
- Two processes: nothing to build now, but a multi-server UI later.
- Needed by SP 2 (the UI connection model).

**Q-B, topic definitions: one central list or a file per topic?**
- Central (today): one reviewer for every wire change, at the cost of a supervisor bottleneck.
- A file per topic plus a generated index: workers can propose topics in their own files, and the supervisor still reviews.
- My recommendation: keep the central list until SP 3 shows real friction.

**Q-C, where do thresholds and settings live (F6)?**
- A, my recommendation: a read-only config per feature in `EngineView`, stored with the session for replay.
- B: in the UI only. That means insights move into the UI for those alarms, and alarms are lost from replays and storage.

**Q-D, stale values (F9): engine or UI?**
- My recommendation: the UI. It drops `stale` from `UnknownReason` and needs a spec change.

**Q-E, order of the fixes.** My proposal is one supervisor task of "SP 3 groundwork" before SP 2/3 workers start:
1. F3 change tags
2. F4 typed bindings
3. F5 current-lap helper
4. F1 demand wiring
5. F9 per Q-D

F2 and F7 then come as the first tasks of SP 4, and F6 depends on Q-C. Recordings for F8 are needed before SP 4.
