# Pitwall: Sub-project 1 "Foundation", Design

Status: approved · Date: 2026-10-28 · Revised during planning (domain package; corrections from the recordings, see the plan's "Corrections to the spec")

## 1. Context

### 1.1 Product
Pitwall is a race-engineer panel for F1 25. The user is a **remote race engineer** for two friends driving an online season on the same team. The drivers play on Windows PCs; the engineer runs pitwall on a Linux laptop. The MVP covers **one driver**. A second driver comes later as a second feed.

Real race-engineering practice is the reference model (see the research: the four views of timing, strategy, car monitoring and performance analysis; the ATLAS interaction model; the TUM race simulation). The game is adapted to that model, not the other way round.

### 1.2 Goals (ranked, 1 = highest)
1. Clean code
2. Extendable code
3. Clean, consistent UI
4. Intuitive user experience
5. Realism
6. Important data findable fast; less important data workable but not in your face
7. Performance (the engineer's machine is a laptop)

When goals conflict, the higher one wins.

### 1.3 Overall MVP and sub-projects
The MVP is **read-only**: pitwall changes nothing in the game.

| # | Sub-project | Content |
|---|---|---|
| **1** | **Foundation (this document)** | input, decoder, frame assembly, race model core, calculator framework, topics/WebSocket, storage |
| 2 | UI shell | Svelte 5, free docking (dockview-core), workbooks, pop-out windows, topic subscriptions |
| 3 | Timing + car monitoring | widgets plus derived values (micro-sectors, gap chart, tyre/fuel/ERS trends, alarms) |
| 4 | Strategy (deterministic) | degradation fit, pit loss, rejoin projection, undercut/SC calls, weekend data |
| 5 | Later | performance analysis, Monte Carlo, second driver, season-wide data |
| 6 | Pit actuator | box call and tyre choice from outside (separate repo, starts with a spike), after the MVP |

The MVP consists of sub-projects 1–4. Timing, strategy and car monitoring are all required.

### 1.4 Environment
- **Transport:** at the start, the driver's game sends UDP over a VPN mesh (Tailscale) straight to the engineer's laptop. Later target: a **forwarder** on the driver's PC that records and forwards (separate recorder repo).
- **Stack:** TypeScript (strict), pnpm workspaces, Node (bridge), Svelte 5 + dockview-core + uPlot + canvas (UI, sub-project 2), SQLite, Vitest, fast-check, Stryker.
- **Data source:** the official F1 25 UDP spec (`external/Data Output from F1 25 v3-1.pdf`), packet format 2025.

## 2. Scope of sub-project 1

**In scope:**
- packet input from UDP and `.pwrec` replay (real time and as fast as possible)
- `.pwrec` reader/writer (compatible with recorder v1)
- decoder/encoder for all 16 packet types, schema-driven
- frame assembler including session lifecycle and flashback handling
- engine: state (current, history, interpretation), snapshots, rewind
- calculator framework (quick, incremental, jobs) with scheduler and registry
- topic contracts, WebSocket server, feed quality, insight channel
- storage: `.pwrec` per session, SQLite cache, `reprocess`, `WeekendContext`
- base topics (see 8.4) so sub-projects 2–4 can build on them
- tools: `pitwall reprocess`, `pwrec-cut`
- a reserved command channel in the contracts (for sub-project 6, not implemented)

**Not in scope:** UI (sub-project 2), derived timing and monitoring values such as micro-sectors and the gap chart (3), strategy calculations (4), full channel traces per lap (5), multi-feed operation (prepared, not active), forwarder and actuator (separate repo).

## 3. Architecture

### 3.1 Packages and dependencies
```
packages/protocol   bytes ↔ typed packets (spec 2025 only)
packages/domain     JSON-safe domain vocabulary (Known, Corners, CarState, records, Insight, ids); leaf package
packages/engine     race model: pure, no I/O, no clock, no network
packages/strategy   strategy calculators (filled in sub-project 4; created empty in 1)
packages/contracts  topic types and WebSocket messages, shared by bridge and UI
apps/bridge         imperative shell: input, frame assembler, engine runner, storage, WebSocket, CLI
apps/ui             Svelte UI (sub-project 2)
```
Dependency direction: `protocol ← engine ← strategy ← bridge`; `domain` is a leaf imported by `contracts`, `engine`, `strategy`, `bridge` and `ui`; `contracts` (topics and wire messages only) is imported by `bridge` and `ui`; `ui` imports neither `engine` nor `protocol`. (The `domain` package was added on 2026-10-28 so the shared types are defined once; ADR 0003.) pnpm (strict dependencies) and `dependency-cruiser` enforce this; a violation fails the build.

### 3.2 Data flow
```
PacketSource (UDP | PwrecFile) → RawPacket → decode → Frame assembler → Frame
  → Engine.step(state, frame) → state → Scheduler → calculators → topic values / insights
  → TopicHub (throttle, per client) → WebSocket → UI
  ↘ PwrecWriter (raw)          ↘ StorageWriter (confirmed history → SQLite)
```

### 3.3 Parallel development
Several agents work in parallel in git worktrees; a supervisor merges. The architecture prevents conflicts on shared files:
- **Registration by convention, no central lists.** Calculators, topics and (in sub-project 2) widgets register themselves through a file in their feature folder (e.g. `src/features/<name>/register.ts`, collected via a glob/convention loader). Adding a feature means adding a folder; no shared file gets edited.
- **The supervisor owns the shared files:** `packages/contracts` (topic types, protocol messages), `package.json` files and the lockfile, base types in `engine`. Workers request changes in their report and don't make them themselves.
- **Ports per worktree:** bridge WebSocket port, UDP port and UI dev port come from environment variables (`PITWALL_WS_PORT`, `PITWALL_UDP_PORT`, `PITWALL_UI_PORT`), so parallel instances and Playwright runs don't collide.

### 3.4 Determinism rules
- The engine never reads the system clock. Time comes only from `sessionTime` and frame IDs.
- Randomness only through an injected, seeded generator.
- The same input stream always produces the same state and the same topic stream (tested, see 10.2).
- Wall-clock time (`receivedAtMs`) exists only in the shell, for diagnostics, except that `SessionTracker` compares receive times (differences only) for the `SEND` grace window, because UID-0 packets carry no usable session time.

## 4. Input and protocol

### 4.1 Packet sources (`apps/bridge`)
```ts
interface PacketSource {
  readonly feedId: FeedId;
  start(onPacket: (p: RawPacket) => void): void;
  stop(): Promise<void>;
}
type RawPacket = { feedId: FeedId; receivedAtMs: number; bytes: Uint8Array };
```
- `UdpSource`: one port per feed (default 20777).
- `PwrecSource`: modes `realtime` (original timing) and `asFastAsPossible`.
- `ForwarderSource`: later, not part of sub-project 1.

### 4.2 `.pwrec` format v1
- **Authoritative source:** `FORMAT.md` in the recorder repo (`~/dev/personal/pitwall-recorder/FORMAT.md`, github.com/NikNam3/pitwall-recorder). Pitwall implements reader and writer to that spec and references it; it doesn't keep its own copy.
- Summary: gzip layer; header `PWREC` · `u8` version 1 · `u32` JSON length · metadata JSON (`recorderVersion`, `startedAt`, `listenPort`; ignore unknown fields); then records `u8 kind` · `f64 t` (ms since start, non-decreasing) · `u16 len` · payload. `kind 0` = datagram, `kind 255` = clean end (empty payload; `t` = duration), **other kinds are skipped using `len`**. Reject other magic values and versions.
- **Lenient reading:** decompress with `finishFlush: Z_SYNC_FLUSH`; an incomplete final record counts as the end of the data. A file without an end marker was cut off and is valid up to that point.
- **Writer:** like the recorder, gzip with a sync flush about once per second, so a crash loses at most about one second.
- Checked against all three recordings: the first record starts directly after the metadata (offset `10 + n`).

### 4.3 Decoder (`packages/protocol`)
- **Schema-driven:** each spec struct is described once declaratively (field, type, array length, nesting). Decoder and encoder are generated from that description. Expected sizes per packet type are checked against the spec table in tests (motion 1349, session 753, lapData 1285, event 45, participants 1284, carSetups 1133, carTelemetry 1352, carStatus 1239, finalClassification 1042, lobbyInfo 954, carDamage 1041, sessionHistory 1460, tyreSets 231, motionEx 273, timeTrial 101, lapPositions 1131).
- **Faithful to the spec,** with three cosmetic exceptions: no `m_` prefix; camelCase; split times (`…MSPart` + `…MinutesPart`) merged into milliseconds. The game writes small negative deltas as `msPart ≥ 60000` with `minutes = 0` (u16 wrap, observed −50…−16 ms); these decode to negative milliseconds and encode back byte-identically. Units, codes and wheel order (RL, RR, FL, FR) stay unchanged.
- **Result instead of exception:**
  ```ts
  type DecodeResult =
    | { ok: true; packet: Packet }          // discriminated union over packetId
    | { ok: false; error: DecodeError };    // wrongFormat | unknownPacketId | sizeMismatch | truncated
  ```
- Only `packetFormat === 2025`. `wrongFormat` carries the received format so the UI can give a hint.
- Event details are decoded per event code into their own union type.

## 5. Frame assembly, sessions, flashbacks

### 5.1 Frame
```ts
type Frame = {
  feedId: FeedId; sessionUid: bigint; frameId: number; overallFrameId: number; sessionTime: number;
  motion?: MotionPacket; lapData?: LapDataPacket; telemetry?: CarTelemetryPacket;
  status?: CarStatusPacket; motionEx?: MotionExPacket;            // menu rate, arrive together
  session?: SessionPacket; damage?: CarDamagePacket; setups?: CarSetupsPacket;
  participants?: ParticipantsPacket; lapPositions?: LapPositionsPacket;
  finalClassification?: FinalClassificationPacket; timeTrial?: TimeTrialPacket;
  sessionHistory: SessionHistoryPacket[]; tyreSets: TyreSetsPacket[]; events: EventPacket[];
};
```
The assembler is pure logic (usable from tests); the bridge only drives it.

### 5.2 Assembly rules
- Grouped by `overallFrameId` within a session (one assembler per session). (`frameId` goes back after a flashback; grouping by it would drop every following packet as late.)
- **Reorder window** of 2 frames. A frame is closed once a newer frame is beyond the window.
- Packets for frames already closed are dropped and counted (`latePackets`).
- **`frameId` gaps are not loss.** The game runs faster than the send rate and skips frame IDs (observed: delta 2 in about 3 % of frames, with a normal session-time step). Loss is measured instead by:
  - completeness of the menu-rate group per frame (LapData, Motion, Telemetry, Status, MotionEx)
  - session-time cadence against the expected rate
- **The session-time step is not constant** (observed: 12–20 ms at 60 Hz). Consumers always use the actual difference.

### 5.3 Session lifecycle
- A session **opens only with the first Session packet** for a `sessionUid ≠ 0`. Packets before that (e.g. lobby/menu with only button events) are discarded.
- A new `sessionUid` with a Session packet closes the current session and opens a new one.
- **Grace window around a session end:** packets with `sessionUid = 0` arriving within 10 s of the `SEND` event, before or after it, are assigned to the session that just ended. This captures the final bulk SessionHistory, which was observed to arrive with UID 0 about 0.1 ms *before* `SEND`, and the FinalClassification. Other `sessionUid = 0` packets are discarded.
- A session's weekend comes from `weekendLinkIdentifier` (Session packet).
- Each session gets its own engine state and its own `.pwrec` file.

### 5.4 Flashbacks
- **Detection:** `FLBK` event (target `frameId` and session time). As a backup: `frameId` goes backwards while `overallFrameId` rises.
- **Snapshots:** every second of session time, a snapshot of the current state plus the lengths of all history lists.
- **Raw frames** of the last `replayWindowMs` (default 10 s of session time, to be confirmed with a flashback recording) are kept in a buffer, so targets before the newest snapshot can still be replayed.
- **Rewind:**
  1. restore the newest snapshot before the target
  2. cut the history back to the stored lengths
  3. re-run the buffered frames up to the target frame
  4. continue normally with the game's new frames
- Every snapshot within `replayWindowMs` is kept; older ones are thinned to one per 30 s of session time plus the first one (pending the user's answer to Q3).
- The game can report one flashback twice (an `FLBK` event and the `frameId` drop, in different frames). A rewind to the same target is ignored until the new timeline has passed the frame after it.
- An info insight `flashback` (target lap, distance in seconds).
- The `.pwrec` file keeps the original stream including the flashback.

## 6. Engine

### 6.1 State
```ts
type EngineState = {
  session: SessionState;      // track, type, laps, length, sector boundaries (m), weather + forecast,
                              // flag status, marshal zones, game settings (SC level, tyre temp mode,
                              // damage, fuel mode, recovery mode …), network game
  cars: CarState[];           // indexed by vehicleIdx, stable within a session
  history: History;           // append-only
  playerCar: CarId;
  teammateCar?: CarId;
};
```
`CarState`, grouped by domain:
- `identity`: name, team, race number, AI/human, `DriverKey`, data visibility (`own | public | restricted`)
- `timing`: position, lap, lap distance, total distance, current lap time, sector, gap to leader and to car ahead, pit status, driver status, result status, penalties, warnings, grid position
- `tyres`: actual and visual compound, age, `Corners<{ surfaceTemp, carcassTemp, pressure, wear, damage, blisters }>`
- `energy`: fuel kg, capacity, game's remaining-laps estimate, mix; ERS store, mode, harvested K/H, deployed; ICE/MGU-K power
- `condition`: bodywork damage, PU damage and wear, gearbox, faults
- `dynamics`: speed, throttle, brake, steering, gear, RPM, DRS, world position, G-forces, orientation
- `ownCar` (player only): MotionEx values, setup, brake bias, differential

### 6.2 Interpretation rules
- **Named corners:** `Corners<T> = { fl, fr, rl, rr }`, translated from the game order RL/RR/FL/FR exactly once.
- **Availability as a type:**
  ```ts
  type Known<T> = { known: true; value: T; at: SessionTime }
                | { known: false; reason: 'restricted' | 'notReceived' | 'notApplicable' | 'stale' };
  ```
  - `restricted`: human, not your own car, telemetry restricted → the fields from the spec's list (Car Status, Car Damage, Tyre Sets) are **not** taken as 0
  - `notApplicable`: e.g. carcass temperature with the setting "surface only", MotionEx for other cars, setups of other players online
  - `stale`: last update older than the topic's threshold
- **Units:** times in integer ms, distances in m, speed in km/h, temperatures in °C, pressure in psi, fuel in kg, energy in J, angles in rad. Formatting happens only in the UI.
- **Compounds:** actual (C0–C6, inter, wet; F2/Classic as in the spec) and visual (soft, medium, hard, inter, wet) as separate enums.
- **`DriverKey`** (stable across a weekend's sessions): AI → `driverId`; human → `networkId` + name + race number.
- **Active cars:** `numActiveCars` (participants) plus `resultStatus` per car (`invalid`/`inactive` = no data).

### 6.3 History (append-only)
- **`LapRecord`:** car, lap number, lap time, sector times, valid flags (lap and per sector), compound, tyre age at lap start, fuel at start and end (`Known`), share of the lap under SC/VSC, in-lap/out-lap, position at lap end, `status: 'provisional' | 'confirmed'`.
  - **provisional:** when `currentLapNum` goes up, time from `lastLapTimeInMS`.
  - **confirmed:** when the SessionHistory packet for that car contains the lap; differences are corrected (the authoritative value wins, the correction is logged).
  - Lap detection works on state changes, so a lost frame can't swallow a lap.
- **`StintRecord`:** car, first/last lap, actual and visual compound, tyre age at fitting.
- **`PitStopRecord`:** car, lap, pit-lane entry and exit (session time), time in the pit lane, stationary time, flag status (green/SC/VSC), penalty served.
- **`FlagPhase`:** `SC | VSC | red`, start and end (session time and leader lap), plus SC event phases (deployed, returning, returned, resume). A red phase ends at the next lights out, an SC restart, or the session end.
- **`RaceEvent`:** penalty, overtake, collision, retirement (with reason), fastest lap, speed trap, DRS on/off (with reason), start lights, lights out.
- **`MiniSectorCrossing`:** the lap split into 50 segments of equal length by distance; per car, the session time of each boundary crossing, linearly interpolated between frames. Basis for gaps between any two cars, live micro-sectors (sub-project 3) and the rejoin projection (sub-project 4).

### 6.4 Step function and performance
- `step(state, frame) → state`. Mutation is allowed inside; the outside only sees a `Readonly` view (deep-readonly types).
- No deep copy per frame. Snapshots copy the current state once per second.
- Hot path (telemetry at 60 Hz) without expensive work.

## 7. Calculators

### 7.1 Three kinds
**Quick calculators:** pure, no state.
```ts
interface QuickCalculator<Out> {
  kind: 'quick'; id: CalculatorId; reads: Dependency[]; cadence: Cadence;
  compute(view: EngineView): Out;
  insights?(out: Out, prev: Out | undefined): Insight[];
}
```
**Incremental calculators:** state allowed, but reproducible.
```ts
interface IncrementalCalculator<Acc, Out> {
  kind: 'incremental'; id: CalculatorId; reads: Dependency[]; cadence: Cadence;
  init(view: EngineView): Acc;                       // from scratch over the existing history
  update(acc: Acc, delta: HistoryDelta, view: EngineView): Acc;
  output(acc: Acc): Out;
  insights?(out: Out, prev: Out | undefined): Insight[];
}
```
- The accumulator is always a fold over a history prefix.
- On activation, `init`; on flashback truncation, `init` again (or from the snapshot).
- **Mandatory test:** incremental = from scratch (property test plus fixtures).

**Jobs:** expensive, asynchronous (implemented in sub-project 1 only as a framework, with no productive job).
- run in a worker thread, get a read-only snapshot, are triggered by events
- the result is published as a topic with `computedFor` (lap/frame)
- a newer trigger replaces a running job
- randomness only through the seeded generator

### 7.2 Rule for state
State that can't be derived from history belongs in the engine's history, not in a calculator.

### 7.3 Scheduler and registry
- Calculators register themselves by convention (see 3.3); the registry collects them on startup, with no central list.
- The registry builds a dependency graph from `reads`; a cycle is a startup error. Duplicate IDs are a startup error too.
- `Cadence = 'frame' | { hz: number } | 'lapCompleted' | 'pitStop' | 'flagChange' | 'sessionChange'`, measured in session time.
- Per frame, the scheduler runs calculators that are **due**, **needed** (subscribed topic, storage, or a dependent calculator) and **affected** (input changed).
- An exception in a calculator marks its output topic `errored` and raises an insight; other calculators keep running.

## 8. Topics, WebSocket, insights

### 8.1 Topics (`packages/contracts`)
```ts
type TopicDef<P, V> = {
  name: string; mode: 'state' | 'append'; maxHz: number; params: P; value: V;
};
```
- `state`: the latest value replaces the old one. `append`: new entries are added.
- Topic definitions live in `packages/contracts` (owned by the supervisor, see 3.3). The producing calculator is linked to its topic through feature registration.
- Each topic carries `feedId` (and `carId` where needed).

### 8.2 WebSocket protocol
- On connect, the server sends `hello { contractVersion, feeds }`. A version mismatch → the UI asks for a reload.
- Client → server: `subscribe { id, topic, params }`, `unsubscribe { id }`.
- Server → client: `snapshot { id, value | entries }`, then `update { id, value }` (state) or `append { id, entries }` (append), plus `topicStatus { id, status: 'ok' | 'errored' | 'noData' }`.
- Throttled per topic and client to `maxHz`. A heartbeat every 5 s; the connection is dropped after 15 s of silence.
- After a reconnect, the client subscribes again (no special case).
- **Backpressure: the latest value wins, never a queue.** If a client is slow (`ws.bufferedAmount` above a threshold), the server drops unsent intermediate values of `state` topics and sends only the newest. `append` topics are never dropped; on overflow the client gets a new snapshot instead.
- Encoding: JSON with full values, behind **one swappable wire-format module** (`encode`/`decode`). Diffs or binary formats only after a measurement shows the need.
- **Reserved:** `command { … }` from client to server for sub-project 6 (types only, the server rejects with `notSupported`).

### 8.3 Insights
```ts
type Insight = {
  key: string;                                    // deduplication
  severity: 'critical' | 'advisory' | 'info';
  category: 'strategy' | 'tyres' | 'energy' | 'damage' | 'race' | 'feed' | 'system';
  feedId: FeedId; carId?: CarId;
  kind: string; params: Record<string, number | string>;
  raisedAt: SessionTime; resolvedAt?: SessionTime;
};
```
- Active while the condition holds; resolved when it no longer does. The same key doesn't produce a duplicate.
- Structured parameters; the UI formats them.
- Insights from sub-project 1: `feed.stale`, `feed.packetLoss`, `feed.wrongFormat`, `system.storageWriteFailed` (advisory), `system.pwrecWriteFailed` (critical), `session.flashback` (info), `system.calculatorError`.

### 8.4 Base topics of sub-project 1
| Topic | Mode | max Hz | Content |
|---|---|---|---|
| `feed.status` | state | 2 | connected/stale, loss %, late packets, latency, packets per second |
| `session.info` | state | 2 | track, type, laps, weather + forecast, flag status, game settings |
| `cars.overview` | state | 10 | per car: identity, timing core, compound and age, pit status |
| `car.detail` (param `carId`) | state | 30 | full `CarState` of one car |
| `car.telemetry` (param `carId`) | state | 60 | dynamics of one car |
| `laps` | append | — | `LapRecord`s (provisional and confirmed) |
| `stints` | append | — | `StintRecord`s |
| `pitStops` | append | — | `PitStopRecord`s |
| `flagPhases` | append | — | `FlagPhase`s |
| `events` | append | — | `RaceEvent`s |
| `insights` | append | — | insights including resolution |

## 9. Storage

### 9.1 Two layers
- **Raw:** one `.pwrec` file per session, the source of truth.
- **Derived:** one SQLite database (all weekends) as a rebuildable cache.
- Location: `~/.local/share/pitwall/` (configurable via `PITWALL_DATA_DIR`). `recordings/` in the repo holds only test fixtures.

### 9.2 SQLite
- Tables: `weekends`, `sessions` (UID, type, track, settings, `.pwrec` path), `drivers` (`DriverKey` per session), `laps`, `stints`, `pit_stops`, `flag_phases`, `events`.
- Written when history entries are `confirmed`, in batches with one transaction each.
- Library: `better-sqlite3`. Check whether the built-in `node:sqlite` is mature enough in the Node version used; if so, prefer it (no native dependency).
- No migrations: on a schema version change, the database is rebuilt via `pitwall reprocess`.

### 9.3 Repository and WeekendContext
- `WeekendRepository` as the only access route (`sessionsOf`, `stintsOf`, `lapsOf`, `pitStopsOf` …).
- When a session starts, the bridge waits for the first Participants packet (it needs the player's `DriverKey`), loads a `WeekendContext` (the same `DriverKey`'s earlier sessions that weekend) and passes it to the engine as **read-only input**. The engine has no database access.

### 9.4 Tools
- `pitwall reprocess [--weekend <id>]`: rebuilds the database from `.pwrec` files.
- `pitwall import <file.pwrec.gz>`: copies an external recording into the data directory and processes it.
- `pwrec-cut <in> <out> --from <sessionTime> --to <sessionTime>`: cuts segments for fixtures (including the Session and Participants packets needed for context).

## 10. Error handling and testing

### 10.1 Error handling
- Expected problems are values (`DecodeResult`, `Known<T>`, `topicStatus`), not exceptions.
- Exceptions are bugs. Tests fail. Live: the frame is skipped, the error logged, and a debug dump (frame plus `.pwrec` position) written to `~/.local/share/pitwall/dumps/`.
- Startup errors (port busy, data directory not writable) → a clear message and exit, no half-started state.
- Storage failures don't affect live operation (see the insights in 8.3).
- Logging: structured (`pino`), with `feedId` and `sessionUid`.

### 10.2 Tests
- **protocol:** fast-check round trip (random packet → encode → decode → equal); size check of every type against 4.3; decoding real packets from the fixtures.
- **engine, spec-first:** a test per rule from this document, including:
  - lap detection with a lost frame
  - provisional → confirmed with correction
  - flashback rewind
  - UID-0 grace window after `SEND`
  - a session only opens on a Session packet
  - restricted → `Known.unknown('restricted')`
  - frame ID gaps ≠ loss
  - variable session-time step
- **engine, invariants (property tests):**
  - positions are a permutation 1..n of the active cars
  - lap numbers don't go down (except on a flashback)
  - history only grows (except flashback truncation)
  - sector sum = lap time for confirmed laps, within the game's truncation: `lapTime − 2 ms ≤ Σ sectors ≤ lapTime`
- **Incremental calculators:** incremental = from scratch.
- **Determinism:** the same recording twice → an identical topic stream (hash).
- **Fixture facts:**
  - `2026-10-27_23-31-43` (TT Zandvoort): 15 completed player laps (lap 16 unfinished); lap 1 = 71.910 s, lap 4 = 71.081 s, lap 9 = 73.253 s; one car; no fuel use; `FTLP` ×4
  - `2026-10-28_00-15-04` (race Singapore): 20 cars, 1 human (index 19); `STLG` ×5, `LGOT` ×1, `OVTK` ×39, `COLL` ×4, `PENA` ×6; no lap completed; final bulk SessionHistory with UID 0 assigned to the session
  - `2026-10-27_22-50-28`: no session opened (button events only)
- **bridge, integration:** `PwrecSource → engine → WebSocket client` in-process, including reconnect and resubscribe.
- **Test builder:** generates frames through the encoder (realistic bytes).

### 10.3 Quality gates
- Stryker on `protocol`, `engine`, `strategy`: mutation score ≥ 80 %.
- TypeScript `strict`, ESLint, `dependency-cruiser` layer rules.
- Vitest as the test runner.

### 10.4 Fixtures
- Full recordings stay outside git in a local fixture directory with `fixtures/index.json` (file, track, type, laps, special features, checksum). **Deliberately not Git LFS** (no bandwidth limits, and segments are enough for tests); can be revisited if full recordings should be versioned.
- Small segments made with `pwrec-cut` are committed under `fixtures/segments/`.
- Tests that need full recordings are skipped with a note if the file is missing.

## 11. Acceptance criteria for sub-project 1
1. `PwrecSource` replays all three recordings at maximum speed without errors; the fixture facts in 10.2 hold.
2. With UDP input from a live game (via Tailscale), all base topics in 8.4 are delivered over WebSocket at the stated rates, checked with a CLI test client (`pitwall tap <topic>`).
3. Replaying the same recording twice produces an identical topic stream.
4. A flashback in a live practice session produces a consistent history (needs a recording, see 12).
5. `pitwall reprocess` rebuilds the database identically from the `.pwrec` files.
6. The quality gates in 10.3 are met.

## 12. Open points and needed recordings
- **Recordings** (from the drivers, UDP format 2025, send rate 60 Hz):
  1. a race of at least 25 % distance with a pit stop and finish (FinalClassification)
  2. a race with SC/VSC (safety car setting "Increased")
  3. a practice session with a flashback
  4. later: an online session with two humans (restricted data)
- **To verify:**
  - Motion "only sent while player is in control" (spec) against the observed behaviour (so far always as often as LapData)
  - maturity of `node:sqlite` (9.2)
- The definition of "clean UI" is worked out with the user in sub-project 2.
