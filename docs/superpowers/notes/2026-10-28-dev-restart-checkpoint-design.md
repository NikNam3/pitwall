# Task 7b design: `pitwall dev` restart within 5 s

Design agent, Step 1 only. Worktree `/home/nklx/dev/personal/pitwall-wt/ui-7b` (branch feat/ui-7b, HEAD ae760a7). No production code or tests written.
Throwaway scripts: `/tmp/claude-1000/pw7b/` (`read.ts`, `pipe.ts`, `cpsize.ts`, `always.ts`, `startup.sh`, `analyze.mjs`, `bench.txt`, profile in `prof/`). The main checkout was not touched: commit 5c44143 was extracted with `git archive` to `/tmp/claude-1000/pw7b/main`, installed offline and run there. The main checkout has no generated `packages/contracts/src/topics/index.generated.ts`, so it cannot run in place.

Machine note: another process was using about 125 % CPU the whole time (load average 2.4 to 4.2 on 22 cores). Runs of the same thing vary by about ±10 %.

## 1. Where the 58.1 s go

Recording: full Zandvoort `2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz`. It has 414 371 records, 440 MB once decompressed, 71 448 frames, and its last frame is at 1 158 146 ms. It is a time trial with one active car, but every packet has all 22 car slots, so a race costs about the same per minute.

| Step | Measured | How |
|---|---|---|
| Debounce | 0.20 s | fixed (`debounceMs`) |
| Old child SIGTERM to exit | 0.04 to 0.07 s | 3 runs, `kill -TERM` on a listening replay |
| `pnpm -s gen` | 0.67 to 0.70 s | 3 runs; `gen:features` 0.20, `gen:topics` 0.22, `gen:widgets` 0.23 |
| Child process start (node, module load, WS server) to `listening` | 0.52 to 0.55 s | 3 runs, paused replay of a segment |
| **Fast-forward to the end** | **47.1 s** (one run, real `ReplayController` path); `FeedPipeline` alone 41.9 to 60.9 s over 7 runs | `pipe.ts controller` and `pipe.ts pipeline` |
| First `position` after `listening` | 0 to 0.5 s | `POSITION_EVERY_MS` interval; the first report waits for the first tick |

So about 96 % of the time is the fast-forward. Inside the fast-forward, broken down by stage and by CPU profile:

| Stage (cumulative, separate runs) | Wall time |
|---|---|
| read + gunzip + pwrec parse | 1.08 s |
| + `decode` of every datagram | 20.6 s (decode alone about 19.5 s, 47 µs per packet) |
| + `SessionTracker.push` | 22.3 s |
| + `SessionRunner.apply` (the engine only: no calculators, no hub, no monitor) | 42.3 s |
| the full `FeedPipeline` with every feature, no subscribers | 41.9 to 60.9 s (noise) |

CPU profile of the real dev child path (`ReplayController`, unpaced, `jumpToTime` to the end; 63.8 s under the profiler), inclusive shares:

| Area | Share |
|---|---|
| protocol `decode` (the codec closures in `schema/codec.ts` alone take 34.6 % self time) | 44.6 % |
| garbage collector (mostly the objects decode allocates) | 11.3 % |
| `SessionRunner.apply` (step 14.9 %, snapshots `take` 2.1 %) | 17.5 % |
| `CadenceTracker.medianMs`: sorts 64 samples on every `tracker.metrics` read, which happens per datagram and per frame | 9.6 % |
| feed monitor, `feedView`, `#checkFeed` | about 5 % |
| `readPwrec` | 2.5 % |
| topic publishing (`publishState` 0.8 %, history and insights 0.2 %) | about 1 % |
| pacer `wait` + `replay.status` publishing | 0.9 % |
| **calculators (`Scheduler.run`)** | **0.3 %** |

**Conclusion.** Nearly all the cost is in the engine layer (decode, frame assembly, engine step, frame metrics). Calculators and publishing cost almost nothing. Removing waste (cache the median, skip publishing while seeking, skip `gen`) saves at most about 12 %, which still leaves about 40 s. A generated decoder (packages/protocol, outside this task's scope) might halve decode and bring it to about 25 s. Neither reaches 5 s, and a 90-minute race is about 4.7 times this recording. **Candidate 1 can't meet the target. The child must not re-run the prefix.**

## 2. Main vs branch throughput

`FeedPipeline` over the full Zandvoort recording, as fast as possible, no subscribers, runs alternating main and branch:

| | Run 1 | Run 2 | Run 3 | Mean | Session ms per wall ms |
|---|---|---|---|---|---|
| main 5c44143 (7 features) | 50.9 s | 56.3 s | 54.7 s | 54.0 s | 21.4 |
| branch ae760a7 (8 features, realism step) | 53.9 s | 60.9 s | 53.8 s | 56.2 s | 20.6 |

Decode alone: main 19.8 s, branch 20.6 s. The 4 % difference is smaller than the run-to-run spread (7 s). **This run didn't make replays slower in any way that matters.** The time was already this slow on main.

## 3. Chosen design: checkpoint on request, resume at the exact record

### Idea
On a change, before it is killed, the old child writes a checkpoint at exactly the record it is at. The checkpoint holds the state of the **engine layer** only: source position, tracker and assembler, frame metrics, feed monitor, feed alerts, session processor, `SessionRunner` with its snapshots and frame window, the pipeline's own insight log, and the scheduler's "untouched pending". It holds no calculator state at all. The new child restores it when the code that produced it is byte-identical (an import-graph hash), skips the records already processed without decoding them, and goes on from that record with no seek. Calculators start fresh in the new code. This is exact because, during the dev startup, the reference run has not run any calculator yet either (see "Why it is exact").

### Why the snapshot stays valid
- **Key.** `sha256` over: the format version; `process.version`; the recording's resolved path, size and mtime; the effective `FeatureConfig` as JSON (realism changes the engine); and, sorted by path, the content hash of every source file in the **import closure** of `apps/bridge/src/pipeline/feed-pipeline.ts`, `apps/bridge/src/input/pwrec-source.ts`, `apps/bridge/src/replay/replay-controller.ts` and `apps/bridge/src/dev/checkpoint.ts`. Relative `.ts` imports are followed, `import type` included (conservative). `@pitwall/<name>` resolves to `packages/<name>/src/index.ts`. `node:` and npm imports are ignored. The closure covers protocol, domain, engine (including `calc/`), contracts, the pipeline, the hub, and `features/feature.ts` plus `features/feed-status/feed-status.ts` (feed alerts import it). It does **not** cover other feature folders or `packages/strategy`. So an edit to a calculator or a feature keeps the key, and an edit to engine, protocol or pipeline changes it, which means a full fast-forward as today.
- **Each child computes its key at start-up** from the files it has just loaded and stamps it on the checkpoints it writes. The new child computes its own key and compares.
- **Start-up race.** A file saved between a child's module load and its hashing would give the child a key for code it didn't load. The supervisor asks for a checkpoint only from a child that saw no change event between its spawn and its first `position` report.
- **No calculator state is carried.** An old calculator's output can't leak into the new run.
- **Refusal rule.** If the new registry has any always-on calculator (`demandOf(features, registry)(empty set)` is non-empty: insight hooks or unreferenced calculators), resume is refused and the child does a full fast-forward with one stderr line. Those calculators run through the whole session, so only a full run gives their state. Today the set is empty (checked with `always.ts`).

### Why it is exact (requirement 2)
The reference is a fresh `pitwall replay --dev` fast-forwarded to the same moment. The moment is the **record index** the old child had processed, which also fixes the session time.
1. Every object that carries state from one record to the next is checkpointed and restored without loss: source position (records delivered, last record `t`), `SessionTracker` with its assemblers, counters and `CadenceTracker`, `FeedMonitor`, `FeedAlerts`, `FeedPipeline` (`#lastReceivedAtMs`, `#position`, current and ended `SessionProcessor`), `SessionProcessor` (runner, buffered frames, `driversStored`, `dumps`, `lastReceivedAtMs`), and `SessionRunner` (state with history, `SnapshotStore`, kept frames, `lastOverallFrameId`, `rewoundTo`). Unit tests check the round trip for each.
2. That state was made by byte-identical code, from the same recording prefix and config (the key).
3. **Demand is held during the dev startup seek.** With `--dev`, the pipeline sees an empty subscription set until the startup jump or resume has settled. Then `serve` releases it and calls `pipeline.demandChanged()` once. So in the reference no demand-driven calculator has run before the moment, and with an empty always-on set, no calculator has run at all. Every scheduler slot is then fresh apart from `pending`: the change tags and history delta absorbed since the session start or the last flashback reset. That is the only scheduler state the checkpoint carries (`Scheduler.untouched`), and the restored scheduler is seeded with it.
4. At release, both runs evaluate the newly needed calculators once (`#evaluateNow`) on the same state, pending, feed view and config, so they produce the same outputs.
5. The hub content at the moment is rebuilt on restore: the history append topics are sent whole (`resetAppend`, equal to the history lists), the `insights` append topic gets the pipeline's own insight log (feed alerts and flashbacks since the last session start; with demand held, the scheduler adds none in the reference), `feed.status` is republished from the restored monitor, and `replay.status` comes from the controller.

The demand hold also fixes something that is wrong today. A window that reconnects during the 47 s startup fast-forward subscribes at some random session time, and then `cars.overview` (10 Hz) runs at a random phase. So today's dev restart isn't deterministic either.

### Data flow
1. A change is debounced in the supervisor. If the running child has reported a position and saw no change during its start-up, the supervisor sends `{ type: 'checkpoint', path }` and at the same time starts `pnpm gen`. It waits for both, with a 3 s timeout on the checkpoint.
2. The child (`serve`, dev only) answers between two records. Node runs the IPC callback between `onPacket` calls, so the state is always "after record *i*". It calls `controller.checkpoint()`, then `writeCheckpoint(path, …)` (v8 serialize to `path.tmp`, then rename), and replies `{ type: 'checkpointed', path, sessionTimeMs, paused, speed }`, or `{ type: 'checkpointFailed', reason }`.
3. The supervisor sends SIGTERM and spawns `replay <file> --dev --resume <path> --at-time <sessionTimeMs> [--paused] --speed <s>`. Without a checkpoint it uses `--at-time` from the last position, as today. It keeps the last good checkpoint path for a later child that dies before reporting.
4. The new child reads the checkpoint and checks its key and the refusal rule. If both pass, it restores: `PwrecSource` skips `delivered` records (no decode, no pacing) and the pipeline is built from the checkpoint. The `--at-time` jump is dropped. If either check fails, it writes one stderr line (`pitwall dev: engine code changed, full fast-forward` or `…: always-on calculators x, y`) and runs the `--at-time` jump as today.
5. `serve` sends the first `position` right at `listening` instead of waiting for the first 500 ms tick.

### Interfaces
Engine changes are additive and pure (`packages/engine/src/frame`, `runner`, `calc`; nothing in `state/`):
```ts
// frame/session-tracker.ts (+ assembler.ts, metrics.ts CadenceTracker: the same pair, internal)
export type SessionTrackerCheckpoint = { /* plain data: assemblers, counters, current, pending, cadence */ };
class SessionTracker {
  /** The tracker's state between two packets; valid until the next push (serialise at once). */
  checkpoint(): SessionTrackerCheckpoint;
  static restore(cp: SessionTrackerCheckpoint, opts: { feedId: FeedId; graceMs?: number }): SessionTracker;
}
// runner/session-runner.ts (+ snapshots.ts SnapshotStore checkpoint/restore)
export type SessionRunnerCheckpoint = {
  state: EngineState; snapshots: SnapshotStoreCheckpoint; frames: Frame[];
  lastOverallFrameId: number; rewoundTo?: number; snapshotEveryMs: number; replayWindowMs: number;
};
class SessionRunner { checkpoint(): SessionRunnerCheckpoint; static restore(cp: SessionRunnerCheckpoint): SessionRunner }
// calc/scheduler.ts
export type UntouchedPending = { changed: ChangeTag[]; delta: HistoryDelta } | undefined;
class Scheduler {
  /** What a calculator that never ran since construction or the last reset() would see as pending; follows absorb() and reset(). */
  get untouched(): UntouchedPending;
}
type SchedulerOptions = { onCalculatorRun?: OnCalculatorRun; untouched?: UntouchedPending }; // seeds every slot's pending
```
Bridge:
```ts
// input/pwrec-source.ts
type PwrecSourceOptions = { …; resumeAfter?: { delivered: number; lastT: number } }; // skips, then the first gap is t - lastT
class PwrecSource { get resumePoint(): { delivered: number; lastT: number } }
// pipeline/feed-monitor.ts, feed-alerts.ts: checkpoint() / static restore()
// pipeline/session-processor.ts
export type SessionProcessorCheckpoint = { sessionUid: bigint; session: SessionPacket; startedAt: string; pwrecPath: string | null;
  runner?: SessionRunnerCheckpoint; untouched?: UntouchedPending; buffered: Frame[]; driversStored: boolean; dumps: number; lastReceivedAtMs: number };
SessionProcessor.checkpoint(): SessionProcessorCheckpoint;  SessionProcessorOptions.resume?: SessionProcessorCheckpoint;
// pipeline/feed-pipeline.ts
export type FeedPipelineCheckpoint = { tracker: SessionTrackerCheckpoint; monitor: …; alerts: …; lastReceivedAtMs: number;
  position?: FeedPosition; session?: SessionProcessorCheckpoint; ended?: SessionProcessorCheckpoint; insightLog: InsightChange[] };
FeedPipeline.checkpoint(): FeedPipelineCheckpoint;           // between two packets only
FeedPipelineOptions.resume?: FeedPipelineCheckpoint;         // start() republishes history, insight log and feed.status
FeedPipelineOptions.demandHeld?: () => boolean;              // true: needed() sees no subscriptions, demandChanged() is ignored
// replay/replay-controller.ts
export type ReplayCheckpoint = { source: { delivered: number; lastT: number }; pipeline: FeedPipelineCheckpoint; atEnd: boolean; beyondEnd: boolean };
ReplayController.checkpoint(): ReplayCheckpoint;  ReplayControllerOptions.resume?: ReplayCheckpoint;
// dev/checkpoint.ts (new)
export const CHECKPOINT_FORMAT = 1;
export type DevCheckpoint = { format: 1; key: string; position?: FeedPosition; replay: ReplayCheckpoint };
export function checkpointKey(o: { root: string; entries: readonly string[]; recordingPath: string; config: FeatureConfig;
  readFile?: (path: string) => string; stat?: (path: string) => { size: number; mtimeMs: number } }): string;
export function resumeRefusal(features: readonly Feature[], registry: CalculatorRegistry): string | undefined;
export function writeCheckpoint(path: string, cp: DevCheckpoint): void;          // v8.serialize, tmp + rename
export function readCheckpoint(path: string): DevCheckpoint | undefined;         // missing, corrupt or other format: undefined
// dev/dev-supervisor.ts
export type CheckpointRequest = { type: 'checkpoint'; path: string };
export type CheckpointReply = { type: 'checkpointed'; path: string; sessionTimeMs: number; paused: boolean; speed: number } | { type: 'checkpointFailed'; reason: string };
interface ChildHandle { …; send(msg: CheckpointRequest): void }
type DevSupervisorOptions = { …; checkpointPath?: string; checkpointTimeoutMs?: number /* 3000 */ };
```
CLI: `pitwall replay … --resume <file>`, accepted only with `--dev` (otherwise `UsageError`), plus a usage line. `dev.ts` passes `checkpointPath = <PITWALL_DATA_DIR>/dev/replay-checkpoint.v8`, one file that is overwritten each time.

### Files touched
`packages/engine/src/frame/{session-tracker,assembler,metrics}.ts`, `packages/engine/src/runner/{session-runner,snapshots}.ts`, `packages/engine/src/calc/scheduler.ts`, `packages/engine/src/index.ts` (exports), `apps/bridge/src/input/pwrec-source.ts`, `apps/bridge/src/pipeline/{feed-pipeline,session-processor,feed-monitor,feed-alerts}.ts`, `apps/bridge/src/replay/replay-controller.ts`, `apps/bridge/src/dev/{checkpoint.ts (new),dev-supervisor.ts}`, `apps/bridge/src/cli/{serve.ts,pitwall.ts,usage.ts,commands/replay.ts,commands/dev.ts}`. No supervisor-owned files.

### Requirement 3
Everything new is reached only through `--dev`: the demand hold, the IPC handler, `--resume`, and the first position at `listening`. Without `--dev`, `serve` passes no `demandHeld`, no `resume` and no IPC handler, so `pitwall replay` behaves as before.

## 4. Tests for the test agent

Engine (`packages/engine/test`):
1. `SessionTracker` round trip. For each committed segment (`tt-zandvoort-lap1`, `race-singapore-start`, `race-singapore-end`), split after record *k* for k in {1, 2, the first Session packet, a record in the middle of a frame, 25/50/75 % of the records, the last record}: `restore(v8.deserialize(v8.serialize(checkpoint())))` fed the remaining records gives events and `metrics` deep-equal to the uninterrupted tracker. Also: after `end()` on a restored ended tracker, `end()` returns `[]`.
2. `SessionRunner` round trip. Split a segment's frames at frame *k* (k = 1, inside the first replay window, after the first thinning at 30 s, the last frame): the `StepResult`s after restore deep-equal the uninterrupted ones, and so does `retained`. Synthetic flashback: a frame after the split whose `FLBK` targets a frame before the split but inside the window gives the same `StepResult` and state as without the split. A target older than the window does too.
3. `Scheduler.untouched`: after N runs with no calculator needed, it equals the pending a calculator sees on its first run (union of tags, the first `before`, `truncated` ORed). `reset()` clears it. An `only` pass leaves it unchanged. `new Scheduler(reg, { untouched })` followed by the first run of a calculator gives the same `view.changed` and `view.delta` as in the uninterrupted scheduler.

Bridge (`apps/bridge/test`):
4. `PwrecSource` with `resumeAfter { delivered: n, lastT }` delivers exactly records n onwards. The pacer's first `wait` gets `t(n) − t(n−1)`. `resumePoint` after m deliveries is `{ m, t(m−1) }`.
5. **Pipeline determinism (the core test).** For each segment and each split *k* from (1): (a) the reference is a fresh `FeedPipeline` with `demandHeld` true over records `[0, k)` (an `ArraySource`), then release, then one client subscribed to every topic (per-car topics for every car, as in `topicStreamHash`); hash its snapshot messages. (b) Pipeline A runs over `[0, k)` **with all topics subscribed and demand not held** (calculators run, so the old child is "dirty"); take `checkpoint()`, run it through v8, build pipeline B with `resume` and `demandHeld` true; release; subscribe the same way; hash. The hashes must be equal. Then feed both the records `[k, end)` with the subscriber kept: their full message streams after the split must be equal too. Cases must include k after the session end (ended processor, late subscriber).
6. Pipeline insight log: a split after a feed-stale alert raised and resolved (a synthetic gap in receive time) restores the same `insights` append content.
7. `checkpointKey`, on a temporary tree: deterministic. It changes when a file reached only through `import type` changes, when a file two imports deep changes, when a `@pitwall/x` package index changes, and when the config, the recording size or mtime changes. It stays the same when a file outside the closure changes (a feature `register.ts`). Run once on the real repo: editing `features/cars-overview/register.ts` keeps the key, and `features/feed-status/feed-status.ts` is in the closure.
8. `resumeRefusal`: undefined for `FEATURES`. With a feature that has an `insights` calculator, or an unreferenced calculator, it names them.
9. `writeCheckpoint`/`readCheckpoint`: round trip, `bigint` kept; a missing, truncated or other-format file reads as `undefined`; a write leaves no `.tmp` behind.
10. `ReplayController`: `checkpoint()` then a new controller with `resume` gives the same `position()` and `replay.status` (`atEnd` included, for a checkpoint taken after the end); paused stays paused; with resume no seek runs.
11. `serve` with `--dev`, the controller test harness and a fake `process.send`: a subscription during the startup jump gets its first value only after settle, computed from the settled state (a 10 Hz calculator's value equals its compute on the settled state). The first `position` arrives at `listening` with no interval tick. A `{type:'checkpoint', path}` message writes the file and replies `checkpointed` with the current position. A key mismatch or refusal gives one stderr line and the `--at-time` jump runs. Without `--dev`, the same subscription during the jump is served at once (behaviour unchanged), and `--resume` without `--dev` is a `UsageError`.
12. `DevSupervisor` (fake spawn, as in the existing test): after a change it sends `checkpoint` to a child that has reported; `gen` starts before the reply arrives; after `checkpointed` it SIGTERMs and spawns with `--resume <path> --at-time <ms>`, passing paused and speed from the reply. If there is no reply within `checkpointTimeoutMs`, it SIGTERMs and restarts from the last position without `--resume`. It doesn't ask a child that hasn't reported, or one that saw a change before its first report; it then reuses the last good checkpoint path. `checkpointFailed` is treated like a timeout, minus the wait.
13. Acceptance, to measure and record (requirement 1): `measure.ts` from Task 7, adapted (first child `--at-time 99999999` on the full Zandvoort recording; edit a file under `apps/bridge/src/features`; time to the new child's first `position`). Report the number. Also measure an engine edit to document the full-path fallback time.

## 5. Expected time (end of full Zandvoort, feature edit)

| Step | Estimate | Evidence |
|---|---|---|
| Debounce | 0.20 s | fixed |
| Checkpoint in the old child, in parallel with `pnpm gen` | max(0.55, 0.70) = 0.70 s | v8.serialize of the 702 kept frames 0.51 s (28 MB) + state 4 ms + 51 snapshots × 0.13 MB, about 0.05 s; gen 0.67 to 0.70 s |
| SIGTERM to exit | 0.05 s | measured |
| New child start-up | 0.53 s | measured |
| Key (about 200 files, sha256) + read and deserialise the checkpoint | about 0.40 s | deserialise 0.36 s for the frames, 5 ms for the state |
| Skip 414k records (gunzip + parse, no decode) | 1.08 s | measured `read` stage |
| Seek | 0 | resume at the exact record |
| First position | about 0 | sent at `listening` |
| **Total** | **about 3.0 s** (about 3.5 s under this machine's load) | |

An engine, protocol or pipeline edit falls back to a full fast-forward, as today (about 50 s at the end of Zandvoort). The checkpoint that child writes on the next request carries the new key, so the following feature edits are fast again.

## 6. Concerns
- **Engine work stays slow.** Each edit under protocol, domain, engine or the pipeline means a full fast-forward. Cheap later wins: cache `CadenceTracker.medianMs` (about 10 %); a generated decoder in protocol (decode is about 45 % of the time).
- **Always-on calculators (sub-project 3 alerts) turn resume off.** Once insight calculators exist, a feature edit gets the full path. That will need validity per calculator (a hash per feature folder plus scheduler slot state) or an accepted weaker guarantee for alarm features.
- **Full race.** Skipping records is linear in time and costs about 1.1 s per 19 minutes, so about 5 s at the end of a 90-minute race. That alone breaks the spec's "any point of a full race". Fix: a seekable recording (re-pack once into gzip members of about 10 MB each, with an offset index). Not needed for requirement 1.
- **Size.** The checkpoint is about 35 MB, almost all of it the 10 s flashback frame window (28 MB, 0.5 s to serialise). It is acceptable. Storing those frames as re-encoded datagrams would shrink it to about 5 MB if needed.
- **Demand hold, a visible change in dev.** Windows that reconnect during a startup fast-forward show `noData` until it settles. On the fast path that is under 1 s; on the full path it is up to about 50 s, where today they would update during the fast-forward.
- **Definition of "the same moment".** Resume lands on the old child's exact record. The `--at-time` fallback stops at the first frame at or after that time, which can be a few records earlier. Determinism tests must compare at the same record index.
