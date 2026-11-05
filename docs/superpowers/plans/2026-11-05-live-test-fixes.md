# Live-Test Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo every task has two phases by two agents (contract C82): a test agent writes the failing tests and commits them, an implementation agent makes them pass without touching them. Supervisor steps (marked **supervisor**) commit contract-first types (C81), fixtures and gates.

**Goal:** The seven bugs the first remote live test found (2026-11-04/05) are fixed, so that SP4a is re-specced on correct sector timing, warnings, bands, incidents and battle cards.

**Architecture:** Each fix sits in the one unit that owns the judgement (C43): the UI connection answers heartbeats; the mini-sector recorder restarts a lap's crossings where the lap recorder already restarts the lap (the timed activity's push span), and a crossing that repeats a segment supersedes the earlier one (C25), read through one `domain` helper; `lap-times` refuses a reference that lies outside the best lap; `battle` takes the behind car's view for its margin; `incidents` names the likely cause of a neutralisation wherever it happened; `alarms` and the warnings detail follow the evidence on which warnings lead to penalties; `car-bands` judges only representative laps, gives the slick carcass two levels and puts the pressure band on the car's setup.

**Tech Stack:** TypeScript (Node type stripping), pnpm monorepo, vitest + fast-check, Svelte 5.

**Spec:** the findings in `docs/acceptance/live-checklist.md` ("2026-11-04/05: first remote live test"), the decisions in `docs/superpowers/plans/2026-11-05-live-test-fixes-questions.md` (Q1–Q4), the contract `docs/architecture.md`. Unit sections: timing spec `docs/specs/2026-10-29-timing-car-monitoring-design.md` §5.4 (car-bands), §5.6 (alarms), §6.2 (lap-times), §6.3 (battle), §6.4 (incidents).

**Not in this plan (SP4a re-spec):** fuel kg always shown, live sectors, battle-card signs and verdict, MARGIN unit, "us" naming, finish margin in minutes, gap-chart decluttering, damage "measuring" and estimate, re-adding a closed panel, the radio indicator, recording size.

## Global Constraints

- **C0:** no task may violate the contract. A task that needs a different contract stops and reports a contract gap; every task of this plan stops at its next commit until the user decides. Q1 option B is such a change and is not built here.
- Briefs follow `docs/tasks/_template.md` and list the clauses their task touches (C83).
- Ownership (C78): `packages/domain/**`, the contracts package, `apps/ui/src/connection/`, `kit/`, `shell/`, `theme/`, `emphasis/` are supervisor-owned. A worker changes them only as a named delegated change in its brief.
- Test levels (C88): a worker runs `nice -n 10 pnpm vitest related <changed files>` plus `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`; the supervisor runs `nice -n 10 pnpm check` before every merge, and `pnpm test:ui` and `pnpm test:acceptance` once at the end (Task 8). Read vitest's `Errors` line as well as `Tests`.
- Worktrees under `../pitwall-wt/<task>`, `pnpm install` in each; `PITWALL_FIXTURES_DIR=/home/nklx/dev/personal/pitwall/recordings`; workers started as separate `claude` processes with `PITWALL_PHASE` and `PITWALL_WORKER_SCOPE` (CLAUDE.md, Workflow).
- Segments (C84): cut with `pwrec-cut` from tonight's recordings, at most 1 MB each, or one full-lap segment of about 8 MB; one behaviour each; an entry in `fixtures/index.json`. No test asserts a fact of a recording. No test reads `PITWALL_DATA_DIR`.
- Changing the mini-sector recorder changes the rules version by itself (C61, C90); stored sessions rebuild on the next bridge start. Nothing bumps a version by hand.
- New thresholds carry a source note: `causeWindowMs: 10_000` (pitwall estimate; the live test's SC came 3.5 s after its collision), the pressure offsets of Q3 A (pitwall estimate from the live test), the carcass levels of Q2 (a driver friend, via the user, 2026-11-05).
- After every implement phase the supervisor checks that `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support` is empty.

## Review Focus

1. **A garage restart in qualifying and the sprint shootout, and a race's final lap.** The restart rule follows the timed activity's push span, so it holds in every timed phase; in a race no lap restarts, and the final lap's line crossing (`finalLines`) is unchanged. → Task 2, rows 4 and 5.
2. **A flashback across a restart.** After a rewind to before the push span opened, the replay re-appends the restarted crossings with the same `supersedes` references a straight run gives (C27, C33). → Task 2, row 6.
3. **A restart that has not yet reached a segment.** Until the new pass crosses segment k, the current crossing of (lap, k) is the earlier pass's; a projection that would use it must give `insufficientData`, not a number. → Task 3, test "a reference outside the best lap gives insufficientData".
4. **The UI window in the background.** Chromium throttles timers in hidden windows down to once a minute; the heartbeat must not depend on a client timer. → Task 1 (the client answers the bridge's heartbeats; no timer).
5. **A neutralisation with no incident before it** (debris, a red flag for weather, a VSC with no stopped car), and one with two incidents before it. The first gets no cause and stays as today; the second names the newest incident before the neutralisation opened, never one after it. → Task 5, rows 2–4.

## Order

| Step | Tasks | Runs in parallel |
|---|---|---|
| contracts first | 0a | serial (supervisor) |
| lanes | 1, 2, 4, 5, 6a | in parallel after 0a |
| readers | 3 | after 2 |
| answers | Q1–Q4 from the user | Q4 after 6a's table |
| contracts after answers | 0b | serial (supervisor) |
| rules | 6b, 7 | in parallel after 0b |
| gate | 8 | serial (supervisor) |

---

### Task 0a: Contract-first types and fixtures (supervisor)

**Clauses:** C21, C25, C81, C84.

**Files:**
- Modify: `packages/domain/src/records.ts` (`MiniSectorCrossing`), `packages/domain/src/laps.ts`, `packages/domain/src/index.ts`, `packages/domain/src/analyses/incidents.ts`, `packages/domain/src/analyses/battle.ts`
- Modify: `fixtures/index.json`, `test-support/segments.ts`
- Create: `fixtures/segments/practice-garage-restart-flying.pwrec.gz`, `fixtures/segments/race-sc-after-collision.pwrec.gz`, `fixtures/segments/race-warning-collision.pwrec.gz`
- Test: `packages/domain/test/crossings.test.ts`

**Interfaces:**
- Produces:
  - `MiniSectorCrossing` gains `supersedes?: FactRef`: on a crossing of a restarted lap, the earlier crossing of the same car, lap and segment.
  - `currentCrossings(list: readonly MiniSectorCrossing[]): MiniSectorCrossing[]` in `laps.ts`: every crossing no later crossing supersedes, in log order.
  - `type CrossingIndex = Map<CarId, Map<number, (MiniSectorCrossing | undefined)[]>>` and `foldCurrentCrossing(index: CrossingIndex, crossing: MiniSectorCrossing): void`: the incremental form; after folding a list in order, `index` holds exactly `currentCrossings(list)` by car, lap and segment.
  - `IncidentEntry` gains `cause?: IncidentCause`, with `type IncidentCause = { entryId: string; kind: 'collision' | 'retirement' | 'damage' | 'timeLoss'; carIds: CarId[]; at: SessionTime }` (on `neutralised` entries only).
  - `BattleSide.overtakeMarginMs` doc comment: "The margin to pass of the car that would pass: ahead, our pace delta minus the threshold; behind, theirs (−`paceDeltaMs` − the threshold)."
  - `FIXTURES` segment ids `practiceGarageRestartFlying`, `raceScAfterCollision`, `raceWarningCollision`.

- [ ] **Step 1: Write the failing tests** in `packages/domain/test/crossings.test.ts`: `currentCrossings` keeps a crossing no one supersedes; drops one a later crossing names; keeps log order. `foldCurrentCrossing` over the same list in order gives the same crossings by car, lap and segment as `currentCrossings`, as a fast-check property over random lists where `supersedes` only names earlier crossings of the same (car, lap, segment).
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/domain/test/crossings.test.ts`. Expected: FAIL, `currentCrossings` not exported.
- [ ] **Step 3: Add the types and helpers** listed under Produces.
- [ ] **Step 4: Run the test again.** Expected: PASS. Then `pnpm typecheck`.
- [ ] **Step 5: Cut the segments.** Copy the four live-test recordings from `~/.local/share/pitwall/recordings` into `recordings/`, add them to `fixtures/index.json` (ids `practiceLiveTest`, `oneShotQualifyingLiveTest`, `raceLiveTestAbandoned`, `raceLiveTest`). Cut:
  - `practice-garage-restart-flying`: `practiceLiveTest`, session time 1100–1240 s (out lap end, the line at 1122.6 s with the lap number unchanged, the flying lap 7, lap 8 begins at 1224.1 s); a full-lap segment (≤ 8 MB).
  - `race-sc-after-collision`: `raceLiveTest`, session time 1200–1215 s (COLL cars 5 and 4 at 1205.9 s, SCAR deployed at 1209.4 s); ≤ 1 MB.
  - `race-warning-collision`: `raceLiveTest`, session time 1708–1716 s (PENA type 5, infringement 4, at 1712.6 s; `totalWarnings` 2, `cornerCuttingWarnings` 1); ≤ 1 MB.
  Each gets its `segments` entry (source, from, to, records, features) and its `FIXTURES` id.
- [ ] **Step 6: Run** `nice -n 10 pnpm check`. Expected: green.
- [ ] **Step 7: Commit** `feat(domain): superseding crossings, incident cause; live-test segments`.

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
- Consumes: `pushOpened(activity, frameNumber)` and `activityOf(situation, carId)` from `recorders/spans.ts` (the rule the laps recorder already uses for the same restart); `MiniSectorCrossing.supersedes` (Task 0a).
- Produces: on the frame the car's timed activity opens a push or flying lap (not joined), the car's cursor restarts the lap: its segment is reset so the new pass records every boundary again, starting with segment 0 at the line. Every crossing of a (car, lap, segment) already recorded in the current timeline carries `supersedes` naming that earlier crossing. Readers of `crossings`: `lap-times`, `incidents`, `gaps` (Task 3).

- [ ] **Step 1: Write the failing tests** in `mini-sectors-restart.test.ts`, with `ScenarioBuilder` and the garage table of `test/situations/car-activity-timed/garage-restart.test.ts` (a 5000 m practice track, 1 frame/s, the lap number staying 2 through the pit lane and the out lap). A table, one row each:
  1. "a garage restart records the flying lap's crossings again": after the push span opens, every segment of lap 2 gets a new crossing, each with `supersedes` = the earlier crossing of lap 2 and that segment.
  2. "the first segment of the restarted lap is the line": the restart frame appends `(lap 2, segment 0)` interpolated at the line.
  3. "segments the earlier pass never reached get no supersedes".
  4. "qualifying restarts the same way" (the qualifying activity's push kind).
  5. "a race never restarts" (a race's same-lap wrap at the flag keeps today's `finalLines` behaviour and appends no superseding crossing).
  6. "a flashback across the restart gives the crossings a straight run gives" (rewind to before the push span opened, replay; the crossings list and every `supersedes` equal those of a run without the undone frames).
- [ ] **Step 2: Add a segment test** in `mini-sectors.segments.test.ts` on `practiceGarageRestartFlying`: after the line at 1122.6 s, crossings of lap 7 are appended for every segment before lap 8 begins, in increasing segment order (no fact of the recording asserted beyond that shape).
- [ ] **Step 3: Run** `nice -n 10 pnpm vitest run packages/engine/test/recorders/mini-sectors-restart.test.ts packages/engine/test/recorders/mini-sectors.segments.test.ts`. Expected: rows 1–3 and the segment test FAIL (no crossings after the restart); rows 4–6 fail or pass as today.
- [ ] **Step 4: Restart the cursor** in `mini-sectorsRecorder.apply`: read the car's activity; when `pushOpened(activity, input.frameNumber)`, append the line crossing of the restarted lap (segment 0, at the line) and set the cursor to `{ lap, segment: 0, distanceM, at }`. Keep, in the recorder's own open state, the position of the newest crossing per (car, lap, segment) in the current timeline, so each appended crossing can name the one it supersedes (rebuilt from the snapshot on a rewind like every open state, C27).
- [ ] **Step 5: Run the tests again,** then `nice -n 10 pnpm vitest related packages/engine/src/recorders/mini-sectors.ts`. Expected: PASS, including the shuffle and rewind properties.
- [ ] **Step 6: Commit** `test(engine): mini-sector crossings restart with the lap`, then `fix(engine): mini-sector crossings restart with the lap`.

### Task 3: Crossing readers use the current crossings; the projection refuses a reference outside the best lap

**Clauses:** C25, C28, C31, C41, C43.

**Scope:** `PITWALL_WORKER_SCOPE=packages/analysis/src/lap-times:packages/analysis/src/incidents:packages/analysis/src/gaps:packages/analysis/test/lap-times:packages/analysis/test/incidents:packages/analysis/test/gaps`.

**Files:**
- Modify: `packages/analysis/src/lap-times/calculator.ts` (`foldCrossings`, `projectionOf`), `packages/analysis/src/incidents/calculator.ts`, `packages/analysis/src/gaps/calculator.ts`
- Test: `packages/analysis/test/lap-times/projection.test.ts`, `packages/analysis/test/incidents/incidents.test.ts`, `packages/analysis/test/gaps/gaps.test.ts`

**Interfaces:**
- Consumes: `foldCurrentCrossing`, `currentCrossings` (Task 0a); restarted crossings (Task 2).
- Produces: `lapTimes.projection` gives `insufficientData` for `projectedLapMs`, `deltaToBestMs`, `projectedPosition` and `finishMarginMs` when the best lap's crossing at the car's current segment does not lie within that lap (`bestLap.completedAt − bestLap.lapTimeMs ≤ at ≤ bestLap.completedAt`).

- [ ] **Step 1: Write the failing tests.** In `projection.test.ts`: "a garage restart's flying lap is its own reference" (history: lap 7 first pass, superseding crossings of the flying lap 7, lap 7's record 101 497 ms; on lap 8 at segment k the projection equals elapsed + (101 497 − the flying lap's time at k), within a lap's length); "a reference outside the best lap gives insufficientData" (the best lap's crossing at k lies before its start: every projected field `insufficientData`). In `incidents.test.ts`: "a superseded crossing counts in no segment median" (a slow first pass followed by a restarted pass: the time-loss medians use the restarted pass only). In the gaps test: "superseded crossings give no interval" (an interval uses only current crossings).
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/lap-times/projection.test.ts packages/analysis/test/incidents/incidents.test.ts packages/analysis/test/gaps/gaps.test.ts`. Expected: FAIL on the new rows.
- [ ] **Step 3: Read through the helper.** Each incremental fold of `crossings` keeps a `CrossingIndex` and calls `foldCurrentCrossing` per new entry (lap-times, incidents, gaps); a from-scratch path calls `currentCrossings`. Add the guard to `projectionOf` before computing `projected`.
- [ ] **Step 4: Run the tests again,** then `nice -n 10 pnpm vitest related` on the three calculators. Expected: PASS, including incremental = from scratch.
- [ ] **Step 5: Commit** `test(analysis): crossing readers use current crossings`, then `fix(analysis): crossing readers use current crossings; projection guard`.

### Task 4: The battle margin of the car behind is theirs

**Clauses:** C41, C43, C44.

**Scope:** `PITWALL_WORKER_UNIT=battle`.

**Files:**
- Modify: `packages/analysis/src/battle/calculator.ts` (`side`)
- Test: `packages/analysis/test/battle/battle.test.ts`

**Interfaces:**
- Consumes: `BattleSide.overtakeMarginMs` doc comment (Task 0a).
- Produces: ahead `overtakeMarginMs = paceDeltaMs − overtakeThresholdMs`; behind `overtakeMarginMs = −paceDeltaMs − overtakeThresholdMs`; unknown pace stays unknown with its reason.

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
- Produces: `INCIDENTS_CONFIG.causeWindowMs = 10_000` (pitwall estimate). A `neutralised` entry's `cause` is the newest collision, retirement, damage or time-loss candidate of **any** car with `at` in `[neutralised.at − causeWindowMs, neutralised.at]`; that candidate is also kept in the feed although no car of ours is near it (its `forUs` empty). The feed line of a neutralised entry reads `SC · ALO–TSU collision` (VSC, red flag the same), from `text.ts`.

- [ ] **Step 1: Write the failing analysis tests:** a table, one row each: (1) "a collision 3.5 s before the SC is its cause" (cars 4 and 5, far from ours: `cause` names `collision:5-4:…`, and that entry is in the feed); (2) "no incident before: no cause"; (3) "two incidents before: the newest is the cause"; (4) "an incident after the neutralisation opened is not its cause"; (5) "an incident 11 s before is outside the window". Segment test on `raceScAfterCollision`: the neutralised entry has a `cause` of kind `collision`.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/incidents`. Expected: FAIL on rows 1, 3 and the segment test.
- [ ] **Step 3: Attach the cause** in `output`: for each neutralised candidate, pick its cause among all candidates before the neighbourhood filter; keep a cause candidate in the feed with `forUs: []`.
- [ ] **Step 4: Run the tests again,** then `vitest related`. Expected: PASS, incremental = from scratch.
- [ ] **Step 5: Commit** `test(analysis): neutralisation cause`, then `feat(analysis): a neutralisation names its likely cause`.
- [ ] **Step 6: Display brief.** Failing test in `rows.test.ts`: "a neutralised entry with a cause shows its cars and kind" (`SC · ALO–TSU collision` with the `cars.overview` codes); "without a cause it reads as today". Run, implement in `rows.ts` and `text.ts`, run, commit `test(ui): incident cause line`, `feat(ui): incident feed shows a neutralisation's cause`.

### Task 6a: Evidence on warnings and penalties (supervisor)

**Clauses:** C85, C16.

**Files:**
- Modify: `apps/bridge/src/cli/commands/scan-situations.ts` (a `--warnings` table)
- Test: `apps/bridge/test/cli/scan-situations.test.ts`
- Modify: `docs/superpowers/plans/2026-11-05-live-test-fixes-questions.md` (Q4: the table)

**Interfaces:**
- Produces: `pitwall scan-situations --warnings <dir>` prints, per recording and session type, each penalty of the player car with the warnings before it, counted by infringement type (corner cutting = infringements 7, 27 and the other corner-cutting codes of the F1 25 appendix; all others apart), from the PENA events and the `warnings` spans.

- [ ] **Step 1: Write the failing test** on a builder session: two corner-cutting warnings, one collision warning, then a time penalty → the table row reads `race, penalty time after: cornerCutting 2, other 1`.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/bridge/test/cli/scan-situations.test.ts`. Expected: FAIL (unknown flag).
- [ ] **Step 3: Implement the table;** run the test; Expected: PASS.
- [ ] **Step 4: Run it** over every recording: `pnpm pitwall scan-situations --warnings recordings/` and paste the output into Q4 of the questions file.
- [ ] **Step 5: Commit** `feat(bridge): scan-situations warnings table`, `docs: warnings evidence for Q4`. Then wait for the user's answers to Q1–Q4.

### Task 0b: Types after the answers (supervisor)

**Clauses:** C81.

**Files:**
- Modify: `packages/domain/src/situations/warnings.ts` (`WarnedDetail`), `packages/domain/src/analyses/car-bands.ts`

**Interfaces (as built for the recommended answers; adjust to the answers given):**
- Produces:
  - Q4 A: `WarnedDetail = { count: number; cornerCutting: number; infringement: Known<number> }` (`cornerCutting` from `cornerCuttingWarnings`, already an input of the warnings sub-machine).
  - Q2 A: `BandState = 'below' | 'in' | 'above'` stays the alarm's state against the **okay** range; `BandReading.band` becomes `{ lo: number; hi: number; good?: { lo: number; hi: number } }` (`good` only where a channel has two levels: the slick carcass).
  - Q3 A: the pressure `BandReading.band` is per corner; `band.lo`/`band.hi` are `unknown` as a whole reading (`value`, `state` `unknown('realism')`) when the car's setup is hidden.

- [ ] **Step 1: Change the types;** `pnpm typecheck` lists every reader; fix nothing beyond compile-neutral defaults (e.g. `cornerCutting: count` in the warnings sub-machine until Task 6b).
- [ ] **Step 2: Run** `nice -n 10 pnpm check`. Expected: green.
- [ ] **Step 3: Commit** `feat(domain): warning kinds, two-level bands`.

### Task 6b: The warning rule follows the evidence

**Clauses:** C9, C13, C14, C17, C43, C44, C85.

**Scope:** sub-machine `PITWALL_WORKER_UNIT=warnings`, then `PITWALL_WORKER_UNIT=alarms`, `PITWALL_WORKER_UNIT=incidents` (one brief each, in that order).

**Files:**
- Modify: `packages/engine/src/situations/warnings/machine.ts`; `packages/analysis/src/alarms/{behaviour,calculator,config}.ts`; `packages/analysis/src/incidents/calculator.ts` (`detailOf`)
- Test: `packages/engine/test/situations/warnings/warnings.test.ts` and `warnings.transitions.ts` (transition table), `packages/analysis/test/alarms/alarms.test.ts`, `packages/analysis/test/incidents/incidents.test.ts`, a segment test on `raceWarningCollision`

**Interfaces (Q4 A):**
- Consumes: `WarnedDetail.cornerCutting` (Task 0b); the limit from Q4's table.
- Produces: the `warned` span's `cornerCutting` = the game's `cornerCuttingWarnings`; `ALARMS_BEHAVIOUR` gains a `weekend-phase` row (`race: warning`, `practice`, `qualifying`, `none`: nothing); `warningLast` counts `cornerCutting` against `warningsBeforePenalty` (the answer's limit, with the evidence as its source note); the incident feed's `warning n/limit` counts the same.

- [ ] **Step 1: Write the failing tests:** warnings sub-machine row "a collision warning raises the count but not cornerCutting" (`totalWarnings` 1 → 2, `cornerCuttingWarnings` 1: `count` 2, `cornerCutting` 1); alarms "no last-warning alarm in practice" and "a collision warning does not count toward the limit" (cornerCutting 1 of 3: no alarm; cornerCutting 2 of 3: the alarm); behaviour-table completeness over `weekend-phase` (C44); segment test on `raceWarningCollision`: the span after the PENA has `count` 2, `cornerCutting` 1.
- [ ] **Step 2: Run** the three test folders. Expected: FAIL on the new rows.
- [ ] **Step 3: Implement** per brief (sub-machine detail, then alarms, then incidents).
- [ ] **Step 4: Run the tests again,** `vitest related`, and `pnpm pitwall scan-situations recordings/` (C85: the warnings transitions over every recording, in the report). Expected: PASS; transitions unchanged except the new detail.
- [ ] **Step 5: Commit** per unit: `test(…)`, then `fix(engine): warnings span counts corner cutting apart`, `fix(analysis): last-warning alarm in races, corner cutting only`, `fix(analysis): incident warning count`.

### Task 7: Bands judge representative laps; two-level carcass; pressure on the setup

**Clauses:** C8, C41, C43, C44, C47, C65, C66, C68.

**Scope:** `PITWALL_WORKER_UNIT=car-bands`, then `PITWALL_WORKER_UNIT=alarms`, then `PITWALL_WORKER_UNIT=corner-block` (one brief each).

**Files:**
- Modify: `packages/analysis/src/car-bands/{config,calculator}.ts`; `packages/analysis/src/alarms/calculator.ts`; `apps/ui/src/widgets/corner-block/{rows,emphasis}.ts`
- Test: `packages/analysis/test/car-bands/car-bands.test.ts`, `packages/analysis/test/alarms/alarms.test.ts`, `apps/ui/src/widgets/corner-block/rows.test.ts`

**Interfaces (as built for Q1 A, Q2 A, Q3 A):**
- Consumes: `classifyLap(lap, { isRace, maxNeutralisedMs })` from `lap-classes`; `CarState.setup.tyrePressurePsi` (live state); `BandReading.band.good` (Task 0b).
- Produces:
  - Q1 A: `outForFullLap` is judged on the newest completed lap that is `forRate` and not lap 1 of a race; with none, `outForFullLap` is false.
  - Q2 A: `CAR_BANDS_CONFIG` slick carcass `carcassDryLo: 70`, `carcassDryHi: 105`, `carcassDryGoodLo: 80`, `carcassDryGoodHi: 100` (source: a driver friend, via the user, 2026-11-05); the state and alarms judge against 70–105; `band.good` carries 80–100.
  - Q3 A: `pressureBelowSetupPsi: 1.5`, `pressureAboveSetupPsi: 1.0` (source: live test 2026-11-04/05, pitwall estimate) replace `pressureLo`/`pressureHi`; per corner `band = { lo: setup − 1.5, hi: setup + 1.0 }`; a hidden setup gives `unknown('realism')`.
  - Corner block: the carcass cell is plain inside 70–105 (good and okay alike), amber outside; the good range shows as the band's inner mark (`presentation`/`emphasis` only, no arithmetic in the display, C65).

- [ ] **Step 1: Write the failing tests** in `car-bands.test.ts`, a table: "lap 1 of a race is not judged" (a cold lap 1, then nothing out: `outForFullLap` false); "an SC lap is not judged" (`scShare` over `maxNeutralisedMs`); "an in-lap is not judged"; "a rate lap out of band is judged" (true); "carcass 72 °C is in band, below good" (state `in`, `band.good` 80–100); "carcass 106 °C is above"; "pressure band follows the setup" (setup 20.9 rear: band 19.4–21.9; 19.3 is `below`); "a hidden setup gives an unknown pressure reading" (`realism`). In `alarms.test.ts`: "no band alarm from lap 1 of a race". In `rows.test.ts`: "carcass 72 °C is plain"; "carcass 68 °C is amber".
- [ ] **Step 2: Run** the three test files. Expected: FAIL on the new rows.
- [ ] **Step 3: Implement** per brief: the judged-lap filter and levels in `car-bands`, the alarm reads only `car-bands`' readings, the corner block's emphasis.
- [ ] **Step 4: Run the tests again** and `vitest related`. Expected: PASS.
- [ ] **Step 5: Commit** per unit: `fix(analysis): bands judge representative laps; carcass levels; pressure on the setup`, `fix(analysis): band alarms`, `feat(ui): corner block carcass levels`.

### Task 8: Gate (supervisor)

**Clauses:** C86, C88, C89.

- [ ] **Step 1: Run** `nice -n 10 pnpm check`, `pnpm test:ui`, `pnpm test:acceptance`. Expected: green; read the `Errors` lines.
- [ ] **Step 2: Replay check.** `PITWALL_DATA_DIR=$(mktemp -d) pnpm pitwall replay recordings/<practiceLiveTest file>` and `pnpm -s pitwall tap lapTimes.projection --carId 19` across lap 8: the projection stays within a few seconds of the lap time (no +309 s). The same on `raceLiveTest` for the SC cause, the behind margin at the flag (about −0.23), and no band alarms on lap 1.
- [ ] **Step 3: Review** each task with the one question (C89); fix findings before merging.
- [ ] **Step 4: Update** `docs/acceptance/live-checklist.md`: mark the seven bugs fixed with the commits; the rest stays for the SP4a re-spec.
- [ ] **Step 5: Merge** to main and push; commit `docs: live-test fixes done`.
