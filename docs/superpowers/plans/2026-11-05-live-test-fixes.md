# Live-Test Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo every task has two phases by two agents (contract C82): a test agent writes the failing tests and commits them, an implementation agent makes them pass without touching them. Supervisor steps (marked **supervisor**) commit contract-first types (C81), fixtures and gates, and write no logic.

**Goal:** The seven bugs the first remote live test found (2026-11-04/05) are fixed, so that SP4a is re-specced on correct sector timing, warnings, bands, incidents and battle cards.

**Architecture:** Each fix sits in the one unit that owns the judgement (C43): the UI connection answers heartbeats. The mini-sector recorder restarts a lap's crossings under the lap recorder's own restart rule (`lapStepOf`), and a crossing that repeats a segment supersedes the earlier one (C25), read through one `domain` helper. `lap-times` measures a projection from each lap's own line crossing. `battle` takes the behind car's view for its margin. `incidents` names the likely cause of a neutralisation wherever it happened. The warnings span records the game's corner-cutting counter, and `alarms` follows the evidence on which warnings lead to penalties. `car-bands` judges only representative laps, gives the slick carcass the band 70–105 °C and puts the player's pressure band on the player's setup.

**Tech Stack:** TypeScript (Node type stripping), pnpm monorepo, vitest + fast-check, Svelte 5.

**Spec:** the findings in `docs/acceptance/live-checklist.md` ("2026-11-04/05: first remote live test"), the decisions in `docs/superpowers/plans/2026-11-05-live-test-fixes-questions.md` (Q1–Q5), the contract `docs/architecture.md`. Unit sections: timing spec `docs/specs/2026-10-29-timing-car-monitoring-design.md` §5.4 (car-bands), §5.6 (alarms), §6.2 (lap-times), §6.3 (battle), §6.4 (incidents). Reviewed by a second session (pitwall-71, 2026-11-05): 11 points, all taken.

**Not in this plan (SP4a re-spec):** fuel kg always shown, live sectors, battle-card signs (one rule: positive = good for us), a pace delta that updates every mini-sector, MARGIN unit, naming each of our cars in the incident feed, finish margin in minutes, the gap chart (grey field, zoom, pit-loss line, per mini-sector), damage "measuring" and estimate, re-adding a closed panel, the radio indicator, recording size.

## Global Constraints

- **C0:** no task may violate the contract. A task that needs a different contract stops and reports a contract gap; every task of this plan stops at its next commit until the user decides. Q1 option B is such a change and is not built here.
- Briefs follow `docs/tasks/_template.md` and list the clauses their task touches (C83).
- Ownership (C78): `packages/domain/**`, the contracts package, `apps/ui/src/connection/`, `kit/`, `shell/`, `theme/`, `emphasis/` are supervisor-owned. Logic in them is a named delegated change, still in two phases (C82); the supervisor itself commits only types and doc comments.
- One worker per unit at a time (C80): the Order table never runs two tasks on the same unit in parallel.
- Test levels (C88): a worker runs `nice -n 10 pnpm vitest related <changed files>` plus `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`; the supervisor runs `nice -n 10 pnpm check` before every merge, and `pnpm test:ui` and `pnpm test:acceptance` once at the end (Task 8). Read vitest's `Errors` line as well as `Tests`.
- Worktrees under `../pitwall-wt/<task>`, `pnpm install` in each; `PITWALL_FIXTURES_DIR=/home/nklx/dev/personal/pitwall/recordings`; workers started as separate `claude` processes with `PITWALL_PHASE` and `PITWALL_WORKER_SCOPE` (CLAUDE.md, Workflow).
- Segments (C84): cut with `pwrec-cut` from tonight's recordings, each at most 1 MB (the two existing full-lap segments stay the only big ones); one behaviour each; an entry in `fixtures/index.json`. No test asserts a fact of a recording. No test reads `PITWALL_DATA_DIR`.
- Changing the mini-sector recorder or the warnings sub-machine changes the rules version by itself (C61, C90); stored sessions rebuild on the next bridge start. Nothing bumps a version by hand.
- New thresholds carry a source note: `causeWindowMs: 10_000` (pitwall estimate; the live test's SC came 3.5 s after its collision), the pressure offsets of Q3 A (pitwall estimate from the live test, provisional), the carcass band 70–105 °C of Q2 (a driver friend, via the user, 2026-11-05).
- The run works on the integration branch `fix/integ` (worktree `../pitwall-wt/fix-integ`); tasks merge into it, and only Task 8 merges it to main. Nothing of Task 0a's helper stubs (which throw until Task 0c) reaches main on its own (C3).
- After every implement phase the supervisor checks that `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support` is empty.

## Review Focus

1. **A garage restart in qualifying and the sprint shootout, and a race's final lap.** The restart rule is `lapStepOf`'s (same lap number and a push span opened), so it holds in every timed phase; in a race no lap restarts, and the final lap's line crossing (`finalLines`) is unchanged. → Task 2, rows 4, 5 and 7.
2. **A flashback across a restart.** After a rewind to before the push span opened, the replay re-appends the restarted crossings with the same `supersedes` references a straight run gives (C27, C33). → Task 2, row 6.
3. **The projection on the restarted lap itself, and before the new pass reaches a segment.** Elapsed time counts from the lap's own segment-0 crossing (after a restart, the restart's line), never from the previous lap's end; a reference whose segment-0 crossing is missing or not before segment k gives `insufficientData`. → Task 3, rows 1–3.
4. **The UI window in the background.** Chromium throttles timers in hidden windows down to once a minute; the heartbeat must not depend on a client timer. → Task 1 (the client answers the bridge's heartbeats; no timer).
5. **A neutralisation with no incident before it** (debris, a red flag for weather, a VSC with no stopped car), and one with two incidents before it. The first gets no cause and stays as today; the second names the newest incident before the neutralisation opened, never one after it. → Task 5, rows 2–4.

## Order

| Step | Tasks | Runs in parallel |
|---|---|---|
| contracts first | 0a | serial (supervisor) |
| lanes | 0c, 1, 2, 4, 5, 6a | in parallel after 0a (each on its own unit) |
| after their inputs | 3 (after 0c, 2 and 5: `lap-times`), 6b (after 6a: the scan) | in parallel |
| bands | 0b (supervisor), then 7 (`car-bands`, then `alarms`) | serial; needs Q1–Q3 (answered) and Q5 (player only either way) |
| answers | Q4 from the user, after 6b's table | – |
| warning rule | 6c (`alarms`, then `incidents`) | after 7 and Q4: both 6c and 7 touch `alarms` |
| gate | 8 | serial (supervisor) |

---

### Task 0a: Contract-first types and fixtures (supervisor)

**Clauses:** C21, C25, C81, C84.

**Files:**
- Modify: `packages/domain/src/records.ts` (`MiniSectorCrossing`), `packages/domain/src/laps.ts` (helper signatures, bodies `throw new Error('not implemented')` until Task 0c), `packages/domain/src/index.ts`, `packages/domain/src/analyses/incidents.ts`, `packages/domain/src/analyses/battle.ts`, `packages/domain/src/situations/warnings.ts`
- Modify: `fixtures/index.json`, `test-support/segments.ts`
- Create: `fixtures/segments/practice-garage-restart-line.pwrec.gz`, `fixtures/segments/race-sc-after-collision.pwrec.gz`, `fixtures/segments/race-warning-collision.pwrec.gz`

**Interfaces:**
- Produces:
  - `MiniSectorCrossing` gains `supersedes?: FactRef`: on a crossing of a restarted lap, the earlier crossing of the same car, lap and segment.
  - `currentCrossings(list: readonly MiniSectorCrossing[]): MiniSectorCrossing[]` in `laps.ts`: every crossing no later crossing supersedes, in log order.
  - `type CrossingIndex = Map<CarId, Map<number, (MiniSectorCrossing | undefined)[]>>` and `foldCurrentCrossing(index: CrossingIndex, crossing: MiniSectorCrossing): void`: the incremental form; after folding a list in order, `index` holds exactly `currentCrossings(list)` by car, lap and segment.
  - `IncidentEntry` gains `cause?: IncidentCause`, with `type IncidentCause = { entryId: string; kind: 'collision' | 'retirement' | 'damage' | 'timeLoss'; carIds: CarId[]; at: SessionTime }` (on `neutralised` entries only). `kind`, `carIds` and `at` are copied from the named entry so the display renders the line without looking another entry up (C65).
  - `BattleSide.overtakeMarginMs` doc comment: "The margin to pass of the car that would pass: ahead, our pace delta minus the threshold; behind, theirs (−`paceDeltaMs` − the threshold)."
  - `WarnedDetail = { count: number; cornerCutting?: number; infringement: Known<number> }`: `cornerCutting` is the game's `cornerCuttingWarnings` (already an input of the warnings sub-machine). Optional here so `pnpm check` stays green; Task 6a fills it and makes it required.
  - `FIXTURES` segment ids `practiceGarageRestartLine`, `raceScAfterCollision`, `raceWarningCollision`.

- [ ] **Step 1: Add the types and signatures** listed under Produces. Run `pnpm typecheck`. Expected: green (every new field is optional; the helpers have signatures only).
- [ ] **Step 2: Cut the segments.** Copy the four live-test recordings from `~/.local/share/pitwall/recordings` into `recordings/`, add them to `fixtures/index.json` (ids `practiceLiveTest`, `oneShotQualifyingLiveTest`, `raceLiveTestAbandoned`, `raceLiveTest`). Cut, each ≤ 1 MB:
  - `practice-garage-restart-line`: `practiceLiveTest`, session time 1118–1135 s. Car 19 is on its out lap at 1118 s (driver status 3 since 1014.4 s), crosses the line at 1122.6 s with the lap number staying 7, and starts the flying lap. The engine joins mid out lap, so the push span opens inside the segment, not joined.
  - `race-sc-after-collision`: `raceLiveTest`, session time 1200–1215 s (COLL cars 5 and 4 at 1205.9 s, SCAR deployed at 1209.4 s).
  - `race-warning-collision`: `raceLiveTest`, session time 1708–1716 s (PENA type 5, infringement 4, at 1712.6 s; `totalWarnings` 2, `cornerCuttingWarnings` 1).
  Each gets its `segments` entry (source, from, to, records, features) and its `FIXTURES` id.
- [ ] **Step 3: Run** `nice -n 10 pnpm check`. Expected: green.
- [ ] **Step 4: Commit** `feat(domain): superseding crossings, incident cause, corner-cutting count; live-test segments`.

### Task 0c: The crossing helpers (delegated)

**Clauses:** C25, C78 (delegated change to `packages/domain/src/laps.ts`).

**Scope:** `PITWALL_WORKER_SCOPE=packages/domain/test` (test), `packages/domain/src/laps.ts` (implement, delegated).

**Files:**
- Modify: `packages/domain/src/laps.ts`
- Test: `packages/domain/test/crossings.test.ts`

**Interfaces:**
- Consumes: the signatures of Task 0a.
- Produces: the bodies of `currentCrossings` and `foldCurrentCrossing`.

- [ ] **Step 1: Write the failing tests** in `crossings.test.ts`: `currentCrossings` keeps a crossing no one supersedes; drops one a later crossing names; keeps log order. `foldCurrentCrossing` over the same list in order gives the same crossings by car, lap and segment as `currentCrossings`, as a fast-check property over random lists where `supersedes` only names earlier crossings of the same (car, lap, segment).
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/domain/test/crossings.test.ts`. Expected: FAIL ("not implemented").
- [ ] **Step 3: Implement** both helpers.
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `test(domain): current crossings`, then `feat(domain): current crossings`.

### Task 1: The UI answers the bridge's heartbeats

**Clauses:** C64, C71, C78 (delegated change to `apps/ui/src/connection/connection.ts`).

**Scope:** `PITWALL_WORKER_SCOPE=apps/ui/test/connection` (test), `apps/ui/src/connection` (implement, delegated).

**Files:**
- Modify: `apps/ui/src/connection/connection.ts`
- Test: `apps/ui/test/connection/ws-connection.test.ts`

**Interfaces:**
- Consumes: `encodeMessage` from `@pitwall/contracts`; the bridge drops a client silent for `timeoutMs` 15 000 and sends a heartbeat every 5 000 ms (`apps/bridge/src/ws/server.ts`).
- Produces: no new API. Every server `heartbeat` is answered at once with one client `heartbeat`; the client keeps no timer for it.

- [ ] **Step 1: Write the failing tests** in `ws-connection.test.ts`, with the file's fake socket: "answers a server heartbeat with one heartbeat" (the server emits `{ type: 'heartbeat' }`; the socket's sent frames end with exactly one `'{"type":"heartbeat"}'`); "sends no heartbeat on its own" (open, advance fake timers by 60 000 ms, no frame sent); "a heartbeat reaches message listeners as before" (the listener still receives it).
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/test/connection/ws-connection.test.ts`. Expected: the first test FAILS (no frame sent).
- [ ] **Step 3: Answer heartbeats** in `connect()`'s `onmessage`: after decoding, when `message.type === 'heartbeat'` and the socket is open, `ws.send(encodeMessage({ type: 'heartbeat' }))`, then notify listeners as now.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `test(ui): connection answers heartbeats`, then `fix(ui): connection answers heartbeats`.

### Task 2: The mini-sector recorder restarts a lap's crossings at a garage restart

**Clauses:** C10, C11, C21, C24, C25, C26, C27, C61, C90.

**Scope:** `PITWALL_WORKER_SCOPE=packages/engine/src/recorders:packages/engine/test/recorders`.

**Files:**
- Modify: `packages/engine/src/recorders/mini-sectors.ts`
- Test: `packages/engine/test/recorders/mini-sectors-restart.test.ts` (new), `packages/engine/test/recorders/mini-sectors.segments.test.ts`

**Interfaces:**
- Consumes: `lapStepOf(mark, car, activity, frameNumber)` from `recorders/lap-boundary.ts` (`'restart'` = the same lap number and `pushOpened`, the laps recorder's rule) and `activityOf(situation, carId)` from `recorders/spans.ts`; `MiniSectorCrossing.supersedes` (Task 0a).
- Produces: on the frame `lapStepOf` gives `'restart'` for a car, its cursor restarts the lap: the line crossing of the restarted lap (segment 0, interpolated at the line) is appended, and the cursor's segment is 0, so the new pass records every boundary again. Every crossing of a (car, lap, segment) already recorded for the current lap carries `supersedes` naming that earlier crossing. The recorder's own open state keeps, per car, the positions of the current lap's newest crossings (50 refs, cleared when the lap number goes up), part of every snapshot (C27). A race never restarts, so no reader of a race's crossings sees a superseded one.

- [ ] **Step 1: Write the failing tests** in `mini-sectors-restart.test.ts`, with `ScenarioBuilder` and the garage table of `test/situations/car-activity-timed/garage-restart.test.ts` (a 5000 m practice track, 1 frame/s, the lap number staying 2 through the pit lane and the out lap). A table, one row each:
  1. "a garage restart records the flying lap's crossings again": after the push span opens, every segment of lap 2 gets a new crossing, each with `supersedes` = the earlier crossing of lap 2 and that segment.
  2. "the first segment of the restarted lap is the line": the restart frame appends `(lap 2, segment 0)` interpolated at the line.
  3. "segments the earlier pass never reached get no supersedes".
  4. "qualifying restarts the same way" (the qualifying activity's push kind).
  5. "a race never restarts" (a race's same-lap wrap at the flag keeps today's `finalLines` behaviour and appends no superseding crossing).
  6. "a flashback across the restart gives the crossings a straight run gives" (rewind to before the push span opened, replay; the crossings list and every `supersedes` equal those of a run without the undone frames).
  7. "a push span on a new lap number appends no extra segment 0" (the lap number goes up on the frame the push span opens: one `(lap 3, segment 0)`, no `supersedes`).
  8. "the open state holds the current lap only" (after the lap number goes up, no ref of the previous lap is kept: its size is at most 50 per car).
- [ ] **Step 2: Add a segment test** in `mini-sectors.segments.test.ts` on `practiceGarageRestartLine`: after the line at about 1122.6 s, crossings of lap 7 are appended again from segment 0, in increasing segment order. (The earlier passes lie before the segment, so these carry no `supersedes`; no fact of the recording is asserted beyond that shape.)
- [ ] **Step 3: Run** `nice -n 10 pnpm vitest run packages/engine/test/recorders/mini-sectors-restart.test.ts packages/engine/test/recorders/mini-sectors.segments.test.ts`. Expected: rows 1–3, 8 and the segment test FAIL (no crossings after the restart); rows 4–7 fail or pass as today.
- [ ] **Step 4: Restart the cursor** in `mini-sectorsRecorder.apply`: per car, `lapStepOf(…) === 'restart'` → append the line crossing and set the cursor to `{ lap, segment: 0, distanceM, at }`; keep the current lap's refs to fill `supersedes`.
- [ ] **Step 5: Run the tests again,** then `nice -n 10 pnpm vitest related packages/engine/src/recorders/mini-sectors.ts`. Expected: PASS, including the shuffle and rewind properties.
- [ ] **Step 6: Commit** `test(engine): mini-sector crossings restart with the lap`, then `fix(engine): mini-sector crossings restart with the lap`.

### Task 3: The projection counts from each lap's own line

**Clauses:** C25, C28, C31, C41, C43.

**Scope:** `PITWALL_WORKER_UNIT=lap-times`.

**Files:**
- Modify: `packages/analysis/src/lap-times/calculator.ts` (`foldCrossings`, `projectionOf`)
- Test: `packages/analysis/test/lap-times/projection.test.ts`

**Interfaces:**
- Consumes: `foldCurrentCrossing`, `CrossingIndex` (Tasks 0a, 0c); restarted crossings (Task 2).
- Produces: `foldCrossings` keeps a `CrossingIndex` through `foldCurrentCrossing`. In `projectionOf`, `elapsed = at − (current crossing of (car, lap, 0)).at` and `bestElapsed = (best lap's current crossing at k).at − (best lap's current crossing at 0).at`. When either segment-0 crossing is missing, or does not lie before its segment-k crossing, `projectedLapMs`, `deltaToBestMs`, `projectedPosition` and `finishMarginMs` are `insufficientData`. `gaps` and `incidents` are unchanged: they produce output only in races, and Task 2 row 5 pins that a race has no superseded crossing (C25 holds).

- [ ] **Step 1: Write the failing tests** in `projection.test.ts`, one row each:
  1. "the restarted lap's projection counts from its own line" (lap 6 ends at 778 s, lap 7 restarts at 1122.6 s; at segment k of lap 7 the elapsed time is `at − 1122.6 s`, not `at − 778 s`).
  2. "a garage restart's flying lap is its own reference" (lap 7's record 101 497 ms from its restarted crossings; on lap 8 at segment k the projection equals elapsed + (101 497 − the flying lap's time at k)).
  3. "a reference without a segment-0 crossing before k gives insufficientData" (every projected field `insufficientData`).
  4. "an ordinary lap projects as before" (no restart: the existing expectations hold).
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/lap-times/projection.test.ts`. Expected: FAIL on rows 1–3.
- [ ] **Step 3: Implement** the index fold, the two segment-0 measures and the guard.
- [ ] **Step 4: Run the tests again,** then `nice -n 10 pnpm vitest related packages/analysis/src/lap-times/calculator.ts`. Expected: PASS, including incremental = from scratch.
- [ ] **Step 5: Commit** `test(analysis): projection counts from the lap's own line`, then `fix(analysis): projection counts from the lap's own line`.

### Task 4: The battle margin of the car behind is theirs

**Clauses:** C41, C43, C44.

**Scope:** `PITWALL_WORKER_UNIT=battle`.

**Files:**
- Modify: `packages/analysis/src/battle/calculator.ts` (`side`)
- Test: `packages/analysis/test/battle/battle.test.ts`

**Interfaces:**
- Consumes: `BattleSide.overtakeMarginMs` doc comment (Task 0a).
- Produces: ahead `overtakeMarginMs = paceDeltaMs − overtakeThresholdMs`; behind `overtakeMarginMs = −paceDeltaMs − overtakeThresholdMs`; unknown pace stays unknown with its reason. (SP4a's sign rule changes only how the card shows it.)

- [ ] **Step 1: Write the failing tests:** "behind margin is the behind car's" (our recent pace 104 000 ms, theirs 103 233 ms, threshold 1000: behind `paceDeltaMs` −767, `overtakeMarginMs` −233); "ahead margin is unchanged" (ours 104 000, theirs 104 286: `paceDeltaMs` 286, margin −714); "an unknown pace gives an unknown margin on both sides".
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/battle/battle.test.ts`. Expected: the first test FAILS (−1767).
- [ ] **Step 3: Pass `isAhead`** into the margin: `known(((isAhead ? delta.value : -delta.value) - overtakeThresholdMs) as Ms, delta.at)`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `test(analysis): behind battle margin`, then `fix(analysis): the behind car's battle margin is theirs`.

### Task 5: A neutralisation names its likely cause

**Clauses:** C43, C45, C53, C65, C66.

**Scope:** `PITWALL_WORKER_UNIT=incidents` (analysis), then `PITWALL_WORKER_UNIT=incident-feed` (display); two briefs, analysis first.

**Files:**
- Modify: `packages/analysis/src/incidents/calculator.ts`, `packages/analysis/src/incidents/config.ts`
- Modify: `apps/ui/src/widgets/incident-feed/rows.ts`, `apps/ui/src/widgets/incident-feed/text.ts`
- Test: `packages/analysis/test/incidents/incidents.test.ts`, `packages/analysis/test/incidents/incidents.segments.test.ts` (new), `apps/ui/src/widgets/incident-feed/rows.test.ts`

**Interfaces:**
- Consumes: `IncidentEntry.cause`, `IncidentCause` (Task 0a).
- Produces: `INCIDENTS_CONFIG.causeWindowMs = 10_000` (pitwall estimate). A `neutralised` entry's `cause` is the newest collision, retirement, damage or time-loss candidate of **any** car with `at` in `[neutralised.at − causeWindowMs, neutralised.at]`; that candidate is also kept in the feed although no car of ours is near it (its `forUs` empty). The feed line of a neutralised entry reads `SC · ALO–TSU collision` (VSC, red flag the same), from `text.ts`, using the cause's own `kind` and `carIds`.

- [ ] **Step 1: Write the failing analysis tests:** a table, one row each: (1) "a collision 3.5 s before the SC is its cause" (cars 4 and 5, far from ours: `cause` names `collision:5-4:…` with kind and cars copied, and that entry is in the feed); (2) "no incident before: no cause"; (3) "two incidents before: the newest is the cause"; (4) "an incident after the neutralisation opened is not its cause"; (5) "an incident 11 s before is outside the window". Segment test on `raceScAfterCollision`: the neutralised entry has a `cause` of kind `collision`.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/incidents`. Expected: FAIL on rows 1, 3 and the segment test.
- [ ] **Step 3: Attach the cause** in `output`: for each neutralised candidate, pick its cause among all candidates before the neighbourhood filter; keep a cause candidate in the feed with `forUs: []`.
- [ ] **Step 4: Run the tests again,** then `vitest related`. Expected: PASS, incremental = from scratch.
- [ ] **Step 5: Commit** `test(analysis): neutralisation cause`, then `feat(analysis): a neutralisation names its likely cause`.
- [ ] **Step 6: Display brief.** Failing test in `rows.test.ts`: "a neutralised entry with a cause shows its cars and kind" (`SC · ALO–TSU collision` with the `cars.overview` codes); "without a cause it reads as today". Run, implement in `rows.ts` and `text.ts`, run, commit `test(ui): incident cause line`, `feat(ui): incident feed shows a neutralisation's cause`.

### Task 6a: The warnings span records the corner-cutting count

**Clauses:** C9, C12, C13, C15, C85.

**Scope:** `PITWALL_WORKER_UNIT=warnings`; delegated: `packages/domain/src/situations/warnings.ts` (make `cornerCutting` required).

**Files:**
- Modify: `packages/engine/src/situations/warnings/machine.ts`
- Test: `packages/engine/test/situations/warnings/warnings.test.ts`, `warnings.transitions.ts`, a segment test on `raceWarningCollision`

**Interfaces:**
- Consumes: `WarnedDetail.cornerCutting` (Task 0a); the `cornerCuttingWarnings` signal (already an input).
- Produces: every `warned` span's `cornerCutting` = the game's `cornerCuttingWarnings` on the frame it opens. This is right whatever Q4 decides: it only records the counter, and readers choose what to count.

- [ ] **Step 1: Write the failing tests:** row "a collision warning raises the count but not cornerCutting" (`totalWarnings` 1 → 2, `cornerCuttingWarnings` stays 1: the new span has `count` 2, `cornerCutting` 1); row "a corner-cutting warning raises both"; segment test on `raceWarningCollision`: the span opened after the PENA has `count` 2, `cornerCutting` 1.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/engine/test/situations/warnings`. Expected: FAIL on the new rows.
- [ ] **Step 3: Implement** the detail field.
- [ ] **Step 4: Run the tests again,** `vitest related`, and `pnpm pitwall scan-situations recordings/` (C85; in the report). Expected: PASS; the warnings transitions unchanged.
- [ ] **Step 5: Commit** `test(engine): warnings span counts corner cutting`, then `feat(engine): warnings span counts corner cutting`.

### Task 6b: Evidence on warnings and penalties

**Clauses:** C6, C26, C28, C85.

**Scope:** `PITWALL_WORKER_SCOPE=apps/bridge/src/cli/commands:apps/bridge/test/cli`.

**Files:**
- Modify: `apps/bridge/src/cli/commands/scan-situations.ts` (a `--warnings` table)
- Test: `apps/bridge/test/cli/scan-situations.test.ts`

**Interfaces:**
- Consumes: the `warned` spans with `count` and `cornerCutting` (Task 6a); the penalty records (domain types only, no game codes in the bridge, C6).
- Produces: `pitwall scan-situations --warnings <dir>` prints, per recording and weekend phase, each penalty of the player car: its kind, its infringement, and the `count` and `cornerCutting` of the car's `warned` span the penalty belongs to. That span comes from the projection's membership, `membershipOf(source, penalty)` (or `situationAt(source, penalty.frame)`), exported from `@pitwall/engine/readers`, never from matching span and penalty times (C26).

- [ ] **Step 1: Write the failing test** on a builder session: two corner-cutting warnings, one collision warning, then a time penalty → the row reads `race, time penalty (infringement …): warnings 3, cornerCutting 2`.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/bridge/test/cli/scan-situations.test.ts`. Expected: FAIL (unknown flag).
- [ ] **Step 3: Implement the table;** run the test. Expected: PASS.
- [ ] **Step 4: Commit** `test(bridge): scan-situations warnings table`, then `feat(bridge): scan-situations warnings table`.
- [ ] **Step 5 (supervisor): Run it** over every recording (`pnpm pitwall scan-situations --warnings recordings/`), paste the output into Q4 of the questions file, commit `docs: warnings evidence for Q4`, and wait for the user's answer.

### Task 0b: Types after the answers (supervisor)

**Clauses:** C3, C81.

**Files:**
- Modify: `packages/domain/src/analyses/car-bands.ts`

**Interfaces (Q3 A, player only per Q5):**
- Produces: `BandReading.band` becomes `Known<{ lo: number; hi: number }>`. A band that depends on a value the live state does not have (the pressure band without the player's setup) is unknown with the live state's own reason (`notReceived` for every car but the player); every other band is known. No reader invents a fallback (C3).

- [ ] **Step 1: Change the type;** `pnpm typecheck` lists the producer (`car-bands`) and the reader (`alarms`). Make them compile with today's behaviour only: `car-bands` wraps each band it builds in `known(…, at)`; `alarms` reads `band.value` behind `band.known`, and its `!band.known` branch raises no alarm from that reading (the neutral choice, commented as Task 7's to own; Task 7's row "no pressure alarm from an unknown band" pins it). No new rule.
- [ ] **Step 2: Run** `nice -n 10 pnpm check`. Expected: green.
- [ ] **Step 3: Commit** `feat(domain): a band reading's band can be unknown`.

### Task 6c: The warning rule follows the evidence

**Clauses:** C14, C17, C43, C44.

**Scope:** `PITWALL_WORKER_UNIT=alarms`, then `PITWALL_WORKER_UNIT=incidents` (one brief each, in that order).

**Files:**
- Modify: `packages/analysis/src/alarms/{behaviour,calculator,config}.ts`; `packages/analysis/src/incidents/calculator.ts` (`detailOf`)
- Test: `packages/analysis/test/alarms/alarms.test.ts`, `packages/analysis/test/incidents/incidents.test.ts`

**Interfaces (Q4 A; adjust to the answer given):**
- Consumes: `WarnedDetail.cornerCutting` (Task 6a); `AlarmsEffect` (Task 7, which runs first); the limit from Q4's table.
- Produces:
  - Builds on Task 7's `AlarmsEffect`: `warningCount` becomes `'cornerCutting'` (Task 7 ported today's rule as `'total'`), and a `weekend-phase` row is added (`race: { warningCount: 'cornerCutting' }`, the other phases `{}`), so the warned span's row alone no longer raises the alarm outside races.
  - `warningLast` counts `cornerCutting` against `warningsBeforePenalty` (the answer's limit, with the evidence as its source note), in races only.
  - The incident feed: a corner-cutting warning shows `warning n/limit` from `cornerCutting`; any other warning shows its kind without `n/limit`.

- [ ] **Step 1: Write the failing tests:** alarms "no last-warning alarm in practice"; "a collision warning does not count toward the limit" (cornerCutting 1 of 3: no alarm; cornerCutting 2 of 3: the alarm); behaviour-table completeness over `weekend-phase` (C44). Incidents "a collision warning shows its kind without n/limit"; "a corner-cutting warning shows cornerCutting/limit".
- [ ] **Step 2: Run** both test files. Expected: FAIL on the new rows.
- [ ] **Step 3: Implement** per brief (alarms, then incidents).
- [ ] **Step 4: Run the tests again** and `vitest related`. Expected: PASS.
- [ ] **Step 5: Commit** per unit: `test(…)`, then `fix(analysis): last-warning alarm in races, corner cutting only`, `fix(analysis): incident warnings by kind`.

### Task 7: Bands judge representative laps; carcass 70–105 °C; the player's pressure on the setup

**Clauses:** C3, C8, C20, C41, C43, C44, C47, C52.

**Scope:** `PITWALL_WORKER_UNIT=car-bands`, then `PITWALL_WORKER_UNIT=alarms` (one brief each, after Task 0b; before Task 6c). The corner block needs no change: it colours from the reading's state.

**Files:**
- Modify: `packages/analysis/src/car-bands/{config,calculator}.ts`; `packages/analysis/src/alarms/{behaviour,calculator}.ts`
- Test: `packages/analysis/test/car-bands/car-bands.test.ts`, `packages/analysis/test/alarms/alarms.test.ts`

**Interfaces:**
- Consumes: `classifyLap(lap, { isRace, maxNeutralisedMs })` from `lap-classes`; `CarState.ownCar.setup.tyrePressurePsi` (the player's car only; step 1 fills it from the Setups packet); `BandReading.band: Known<…>` (Task 0b).
- Produces:
  - `alarms`' behaviour table becomes one merged effect per kind, as `lap-times` does (`LapTimesEffect`): `type AlarmsEffect = { warningCount?: 'total' | 'cornerCutting'; penalty?: 'time' | 'driveThrough' | 'stopGo'; bandsHidden?: true }`, merged over the car's and the session's open spans. `AlarmRow` goes; today's rows are ported unchanged (`warned: { warningCount: 'total' }`, the penalty kinds as `penalty`). Task 6c changes the warning rule on this shape.
  - Q1 A: `outForFullLap` is judged on the newest completed lap that is `forRate` and not lap 1 of a race; with none, `outForFullLap` is false.
  - Q1, refined (user): `AlarmsEffect.bandsHidden` from a `session-phase-race` row: `neutralised` hides band alarms (`bandOut`, `bandOutLap`) until its `NeutralisedDetail.stages` holds `returning` (the game's "safety car in this lap"; the VSC's ending the same); from then on they are raised again from the newest clean lap. Other alarms (damage, fuel, wear, warnings) are unaffected.
  - Q2: `CAR_BANDS_CONFIG` slick carcass `carcassDryLo: 70`, `carcassDryHi: 105` (source: a driver friend, via the user, 2026-11-05: 70–105 °C drivable; pitwall ignores "good", user).
  - Q3 A, player only (Q5): `pressureBelowSetupPsi: 1.5`, `pressureAboveSetupPsi: 1.0` (source: live test 2026-11-04/05, pitwall estimate, provisional) replace `pressureLo`/`pressureHi`; for the player's car, per corner `band = { lo: setup − 1.5, hi: setup + 1.0 }`; for every other car, and while the player's setup is not yet received, the pressure reading's band and state are unknown with the live state's reason. `car-bands` adds `ownCar` to its reads (C41).

- [ ] **Step 1: Write the failing tests** in `car-bands.test.ts`, a table: "lap 1 of a race is not judged" (a cold lap 1, then nothing out: `outForFullLap` false); "an SC lap is not judged" (`scShare` over `maxNeutralisedMs`); "an in-lap is not judged"; "a rate lap out of band is judged" (true); "carcass 72 °C is in band" (state `in`); "carcass 106 °C is above"; "the player's pressure band follows the setup" (setup 20.9 rear: band 19.4–21.9; 19.3 is `below`); "another car's pressure band is unknown" (`notReceived`); "the player's band before the setup arrives is unknown". In `alarms.test.ts`: "no band alarm from lap 1 of a race"; "band alarms are hidden while the SC is deployed" (a pre-SC carcass alarm is cleared at `deployed`); "band alarms return at returning" (the same alarm raised again from the pre-SC clean lap); "a damage alarm stays during the SC"; "no pressure alarm from an unknown band"; behaviour-table completeness over `warnings`, `penalties` and `session-phase-race`; "today's warning and penalty alarms are unchanged" (the port).
- [ ] **Step 2: Run** both test files. Expected: FAIL on the new rows.
- [ ] **Step 3: Implement** per brief: the judged-lap filter, the carcass band and the player's setup-based pressure band in `car-bands`; `bandsHidden` and the unknown band in `alarms`.
- [ ] **Step 4: Run the tests again** and `vitest related`. Expected: PASS.
- [ ] **Step 5: Commit** per unit: `fix(analysis): bands judge representative laps; carcass 70–105; the player's pressure on the setup`, `fix(analysis): band alarms hidden under the SC; unknown bands`.

### Task 8: Gate (supervisor)

**Clauses:** C86, C88, C89.

- [ ] **Step 1: Run** `nice -n 10 pnpm check`, `pnpm test:ui`, `pnpm test:acceptance`. Expected: green; read the `Errors` lines.
- [ ] **Step 2: Replay check.** `PITWALL_DATA_DIR=$(mktemp -d) pnpm pitwall replay recordings/<practiceLiveTest file>` and `pnpm -s pitwall tap lapTimes.projection --carId 19` on lap 7 after the restart and on lap 8: the projection stays within a few seconds of the lap time (no +309 s, no +345 s). The same on `raceLiveTest` for the SC cause, the behind margin at the flag (about −0.23), no band alarms on lap 1 and none under the SC before "safety car in this lap".
- [ ] **Step 3: Review** each task with the one question (C89); fix findings before merging.
- [ ] **Step 4: Update** `docs/acceptance/live-checklist.md`: mark the seven bugs fixed with the commits; the rest stays for the SP4a re-spec.
- [ ] **Step 5: Merge** to main and push; commit `docs: live-test fixes done`.
