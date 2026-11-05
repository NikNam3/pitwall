# Live Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo every task has two phases by two agents (contract C82): a test agent writes the failing tests and commits them, an implementation agent makes them pass without touching them. Supervisor steps (marked **supervisor**) commit contract-first types (C81), constants and gates, and write no logic.

**Goal:** The panel reads right on the next league weekend: battle numbers with one sign rule that update every mini-sector, a gap chart of only the cars in our window, sectors as they finish, our cars named and warnings by kind in the incident feed, fuel kg from the start, damage that says it is measuring and estimates early, a readable finish margin, and an "add panel" command.

**Architecture:** Each change sits in the unit that owns the judgement (C43). `battle` becomes incremental over the mini-sector crossings and measures PACE Δ over the same last 50 segments of both cars; `gaps` publishes only the window's lines, per segment for the last 10 laps; `lap-times` adds the newest time per sector; `damage` adds a measuring state and an early estimate against segment medians shared with `incidents`. New fields arrive optional first, each reader moves to them, and one cleanup task removes the old fields, so `pnpm check` stays green after every task.

**Tech Stack:** TypeScript (Node type stripping), pnpm monorepo, vitest + fast-check, Svelte 5.

**Spec:** `docs/superpowers/specs/2026-11-05-live-polish/01-live-polish-design.md` (approved with the user's review fixes f6281e7), answers `00-answers.md` (P0–P5); the contract `docs/architecture.md`. Unit sections: timing spec `docs/specs/2026-10-29-timing-car-monitoring-design.md` §6.1 (gaps), §6.2 (lap-times), §6.3 (battle), §6.4 (incidents), §5.5 (damage).

## Global Constraints

- **C0:** no task may violate the contract; a task that needs a different contract stops and reports a contract gap, and every task of this plan stops at its next commit until the user decides. This plan needs no contract change.
- Briefs follow `docs/tasks/_template.md` and list the clauses their task touches (C83).
- Ownership (C78): `packages/domain/**`, the contracts package, `apps/ui/src/{connection,kit,shell,theme,emphasis}/` are supervisor-owned; logic there is a named delegated change in two phases (C82); the supervisor commits only types, doc comments and constants.
- One worker per unit at a time (C80); the Order table never runs two tasks on one unit in parallel.
- Test levels (C88): a worker runs `nice -n 10 pnpm vitest related <changed files>` plus `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`; the supervisor runs `nice -n 10 pnpm check` before every merge, `pnpm test:ui` and `pnpm test:acceptance` once at the end (Task 16). Read vitest's `Errors` line as well as `Tests`.
- Worktrees under `../pitwall-wt/<task>`, `pnpm install` in each; `PITWALL_FIXTURES_DIR=/home/nklx/dev/personal/pitwall/recordings`; workers started as separate `claude` processes with `PITWALL_PHASE` and `PITWALL_WORKER_SCOPE` (CLAUDE.md, Workflow).
- After every implement phase the supervisor checks that `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support '**/gallery.ts' '**/fixtures.ts'` is empty.
- The run works on `polish/integ` (worktree `../pitwall-wt/polish-integ`); only Task 16 merges it to main.
- **Sign rule:** every battle number is positive when it is good for our car.
- New thresholds and their sources (pitwall estimates): `battle.minPaceSegments` 25; `gaps.fineLaps` 10, `gaps.windowMs` 10 000, `gaps.windowExitMs` 1 000; `damage.minEstimateSegments` 10. Segment medians keep `incidents`' values: the last 5 eligible mini-sectors per segment, at least 3.
- A test of behaviour that stays is ported, never dropped (C82); a test of a removed field (CLOSING) is deleted with it.

## Review Focus

1. **A garage restart in practice** keeps the lap number: a sector time from the attempt before the restart must read as older (`newestSectorOlder`) on the restarted pass, not as the current lap's. → Task 5 row 5.
2. **A battle with a lapped car or across a lap boundary:** the two cars' windows are the same segment indices on their own newest passes, so a car a lap ahead is compared over the same stretch of track. → Task 2 row 6.
3. **The first lap of a race and the laps after an SC:** fewer than 25 usable segments gives PACE Δ `insufficientData`, `lapsToDrs` carries the reason, and `race-moment`'s battle rule falls back to the gap rule as for any unknown. → Task 2 rows 4 and 9.
4. **A flashback during a neutralisation:** `battle`'s and `gaps`' accumulators after the rewind equal a fresh run (C31.3, C33), the window membership included. → Task 2 row 10, Task 3 row 7.
5. **A car on the window's edge:** it enters at exactly 10 s and stays until 11 s, so its line does not flicker in and out of the chart. → Task 3 rows 4–5.

## Order

| Step | Tasks | Runs in parallel |
|---|---|---|
| types first | 0 | serial (supervisor) |
| analyses | 1, 2, 3, 5, 11, 13a, 14 | in parallel after 0 |
| after their inputs | 4 (after 1: `incidents`), 6 (after 1) | in parallel |
| displays | 7 (after 2), 8 (after 3), 9 (after 4), 10a and 10b (after 5), 12 (after 6), 13b (after 13a) | in parallel |
| cleanup | 15 (after 7, 8, 9) | serial |
| gate | 16 | serial (supervisor) |

---

### Task 0: Contract-first types, config and wording (supervisor)

**Clauses:** C47, C53, C68, C81.

**Files:**
- Modify: `packages/domain/src/analyses/battle.ts`, `gaps.ts`, `incidents.ts`, `lap-times.ts`, `damage.ts`
- Modify: `packages/analysis/src/battle/config.ts`, `packages/analysis/src/gaps/config.ts`, `packages/analysis/src/damage/config.ts`
- Modify: `packages/contracts/src/topics/battle.cards.ts` (`maxHz` 4), `packages/contracts/src/topics/gaps.gapper.ts` (`maxHz` 4)
- Modify: `apps/ui/src/kit/text.ts` (infringement wording), `apps/ui/src/kit/values/format.ts` (`formatMinutesTenths` stub)

**Interfaces:**
- Produces (every new field optional until Task 15):
  - `BattleSide.margin?: Known<{ kind: 'pass' | 'hold'; ms: Ms }>`; doc comments of `paceDeltaMs` ("over the same last 50 mini-sectors of both cars, s/lap; positive = we are faster") and `lapsToDrs` ("from PACE Δ").
  - `GapperLines.cars[].points?: { lap: number; gapMs: Ms }[]` (doc: "per mini-sector crossing for the last `fineLaps` laps, per lap before"; `cars` "only the cars in the window").
  - `IncidentWarning` gains `kind?: 'cornerCutting' | 'other'` and `infringement?: Known<number>`.
  - `LapBoardRow` gains `newestSectorsMs?`, `newestSectorStatus?`, `newestSectorOlder?: [boolean, boolean, boolean]`.
  - `DamageJump` gains `measuring?: Known<{ lapsDone: number; lapsNeeded: number }>`, `estimateMsPerLap?: Known<Ms>`.
  - Config: `BATTLE_CONFIG` gains `minPaceSegments: 25`; `GAPS_CONFIG` gains `fineLaps: 10`, `windowMs: 10_000`, `windowExitMs: 1_000`; `DAMAGE_CONFIG` gains `minEstimateSegments: 10`; each with a "Source: pitwall estimate" doc comment.
  - `kit/text.ts`: `infringementNames: Readonly<Record<number, string>>`, the F1 25 infringement codes 0–54 from `external/F1 25 Telemetry Output Structures.txt` ("Infringement types"), lower-case short words (`4` → `collision`, `27` → `corner cutting`, …), and `warningKind(kind: 'cornerCutting' | 'other', infringement?: number): string`. Wording is a constant, not logic: the function only looks up the table, `warning` when the code is unknown.
  - `kit/values/format.ts`: `formatMinutesTenths(ms: Ms): string` stub that throws until Task 13a.

- [ ] **Step 1: Add** everything under Produces. Run `pnpm gen && pnpm typecheck`. Expected: green.
- [ ] **Step 2: Run** `nice -n 10 pnpm check`. Expected: green.
- [ ] **Step 3: Commit** `feat(domain): live polish types, config and wording`.

### Task 1: Shared segment medians

**Clauses:** C31.2, C43, C45, C78 (delegated: `packages/analysis/src/shared/`), C82 (moved tests).

**Scope:** `PITWALL_WORKER_UNIT=incidents` plus delegated `packages/analysis/src/shared/segment-medians.ts`, tests `packages/analysis/test/shared`.

**Files:**
- Create: `packages/analysis/src/shared/segment-medians.ts`
- Modify: `packages/analysis/src/incidents/incidents.ts`, `calculator.ts` (call the shared functions)
- Test: `packages/analysis/test/shared/segment-medians.test.ts` (moved from the incidents tests of the median)

**Interfaces:**
- Produces: `type SegmentSamples` (per car, per segment, the last `MEDIAN_LAPS` eligible mini-sector times); `foldSegmentSample(samples: SegmentSamples, carId: CarId, segment: number, ms: Ms): void`; `segmentMedian(samples: SegmentSamples, carId: CarId, segment: number): Known<Ms>` (`unknown('fewLaps')` below `MEDIAN_MIN_LAPS`); `MEDIAN_LAPS = 5`, `MEDIAN_MIN_LAPS = 3`. Eligibility stays with the caller (it knows its spans).

- [ ] **Step 1: Write the failing tests**: move the median tests out of the incidents test files into `segment-medians.test.ts` against the new functions (same cases: 5 newest kept, fewer than 3 → `fewLaps`, odd and even medians). Run the incidents tests unchanged.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/shared/segment-medians.test.ts packages/analysis/test/incidents`. Expected: the new file FAILS (module missing), the incidents tests pass. Commit `test(analysis): shared segment medians`.
- [ ] **Step 3: Move** the samples fold, `median`, `MEDIAN_LAPS` and `MEDIAN_MIN_LAPS` into `shared/segment-medians.ts`; `incidents` calls them.
- [ ] **Step 4: Run the tests again.** Expected: PASS, the incidents tests unchanged.
- [ ] **Step 5: Commit** `refactor(analysis): segment medians shared by incidents and damage`.

### Task 2: `battle`: PACE Δ per mini-sector, PASS/HOLD, incremental

**Clauses:** C26, C31, C41, C43, C44, N1.

**Scope:** `PITWALL_WORKER_UNIT=battle`; ported tests `packages/analysis/test/race-moment`.

**Files:**
- Modify: `packages/analysis/src/battle/calculator.ts`, `battle.ts` (or the unit's maths file), `behaviour.ts`
- Test: `packages/analysis/test/battle/battle.test.ts`, `packages/analysis/test/battle/pace-window.test.ts` (new), `packages/analysis/test/battle/battle.segments.test.ts` (new), `packages/analysis/test/race-moment/race-moment.test.ts` (ported)

**Interfaces:**
- Consumes: `NEUTRALISATION_READS` and the neutralised spans from `shared/neutralised.ts`; `currentCrossings` / `foldCurrentCrossing` from `domain`; `BATTLE_CONFIG.minPaceSegments`.
- Produces: `battleCalculator: IncrementalCalculator<BattleAcc, BattleOutput>`, `reads` `[{ calculator: 'gaps' }, 'miniSectors', 'spans:car-location', ...NEUTRALISATION_READS, 'tyres', 'energy', 'identity', 'spans:race-control-race', 'spans:weekend-phase']`, cadence `'frame'`; the accumulator holds each car's current crossings of its last 4 laps. Each side: `paceDeltaMs` per spec 3.1, `margin` (`pass` = our edge − `overtakeThresholdMs` on AHEAD; `hold` = `overtakeThresholdMs` − their edge on BEHIND), `lapsToDrs` = (gap − `drsRangeMs`) / the closing car's edge per lap. `closingMsPerLap` and `overtakeMarginMs` are written as `unknown('notApplicable')` until Task 15 removes them.

- [ ] **Step 1: Write the failing tests.** Delete the CLOSING tests. `pace-window.test.ts`, one row each:
  1. two cars over 50 clean segments: PACE Δ = (their time − our time) over the window, per lap;
  2. a segment where either car is in the pit lane is skipped and the window reaches further back;
  3. a segment that an SC covers from its start crossing to its end crossing is skipped, also an SC that comes out mid-segment;
  4. 24 usable segments → `insufficientData` (Review Focus 3);
  5. at most 3 laps back: a long SC leaves fewer than 25 → `insufficientData`;
  6. a car a lap ahead is compared over the same segment indices of its own newest pass (Review Focus 2).
  `battle.test.ts`, one row each:
  7. AHEAD `margin` `{ kind: 'pass', ms: edge − 1000 }`, BEHIND `{ kind: 'hold', ms: 1000 − their edge }`; positive = good for us on both;
  8. `lapsToDrs` from PACE Δ on both sides; 0 inside DRS range; `notApplicable` while the gap is not closing or DRS is off;
  9. with PACE Δ unknown, `lapsToDrs` carries its reason; `race-moment` falls back to the gap rule (ported race-moment test);
  10. incremental equals from scratch at every frame, also after a rewind during an SC (Review Focus 4);
  11. C31.1's proof on the long-race builder (from-scratch reads grow ≥ 5×, incremental ≤ 2×).
  `battle.segments.test.ts`: on `race-zandvoort-full-lap` PACE Δ is known for a car pair after one lap and equals the difference of their gap change over the same segments within 1 ms.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/battle packages/analysis/test/race-moment`. Expected: FAIL. Commit `test(analysis): battle pace per mini-sector, pass and hold`.
- [ ] **Step 3: Implement** the fold, the window and the sides.
- [ ] **Step 4: Run the tests again** plus `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(analysis): battle pace per mini-sector, pass and hold`.

### Task 3: `gaps`: the window and per-segment points

**Clauses:** C31.2, C31.3, C43, C53, N1.

**Scope:** `PITWALL_WORKER_UNIT=gaps`.

**Files:**
- Modify: `packages/analysis/src/gaps/gaps.ts`, `calculator.ts`
- Test: `packages/analysis/test/gaps/gapper-window.test.ts` (new), `packages/analysis/test/gaps/gaps.test.ts`, `gaps.property.test.ts`, `apps/bridge/test/features/gaps/register.test.ts`

**Interfaces:**
- Consumes: `GAPS_CONFIG.fineLaps`, `.windowMs`, `.windowExitMs`.
- Produces: `GapperLines.cars` holds only the window's cars; each has `points` (per crossing for the last 10 laps, per lap before; `lap` = completed laps + segment / 50) and still `byLap` until Task 15.

- [ ] **Step 1: Write the failing tests** in `gapper-window.test.ts`, one row each:
  1. our cars are always in `cars`;
  2. points per segment for the last 10 laps, one per lap before, x = completed laps + segment / 50;
  3. `now` unchanged;
  4. a car at exactly 10 000 ms from one of ours at its newest crossing enters; 10 001 ms does not (Review Focus 5);
  5. a car in the window stays at 11 000 ms and leaves at 11 001 ms;
  6. membership is judged at each crossing (a car that passes through 9 s between two crossings without a crossing there does not enter);
  7. incremental equals from scratch after a rewind, membership included (Review Focus 4).
  Port the existing gapper tests to `points` where they asserted `byLap` values.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/gaps apps/bridge/test/features/gaps`. Expected: FAIL. Commit `test(analysis): gapper window and points per segment`.
- [ ] **Step 3: Implement** the window as part of the fold (enter within `windowMs`, leave beyond `windowMs + windowExitMs`, judged at each crossing) and the points.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(analysis): gapper window and points per segment`.

### Task 4: `incidents`: warnings by kind

**Clauses:** C3, C43.

**Scope:** `PITWALL_WORKER_UNIT=incidents` (after Task 1, the same unit).

**Files:**
- Modify: `packages/analysis/src/incidents/calculator.ts`
- Test: `packages/analysis/test/incidents/warning-kinds.test.ts` (new)

**Interfaces:**
- Consumes: `WarnedDetail.cornerCutting` and `.infringement` (warnings span); `IncidentWarning.kind?`, `.infringement?` (Task 0).
- Produces: every warning entry carries `kind`; `cornerCutting` keeps `count/limit`; `other` carries the span's `infringement`.

- [ ] **Step 1: Write the failing tests**: a warning whose corner-cutting count rose → `{ kind: 'cornerCutting', count, limit }`; a collision warning (count unchanged, infringement 4) → `{ kind: 'other', infringement: known(4) }`; a warning without infringement → `other` with `unknown`.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/incidents/warning-kinds.test.ts`. Expected: FAIL. Commit `test(analysis): incident warnings by kind`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(analysis): incident warnings by kind`.

### Task 5: `lap-times`: the newest sector times

**Clauses:** C3, C25, C65.

**Scope:** `PITWALL_WORKER_UNIT=lap-times`.

**Files:**
- Modify: `packages/analysis/src/lap-times/lap-times.ts`, `calculator.ts`
- Test: `packages/analysis/test/lap-times/newest-sectors.test.ts` (new)

**Interfaces:**
- Produces: on every board row `newestSectorsMs`, `newestSectorStatus`, `newestSectorOlder` per spec 3.4. "Older" means: from a pass before the car's current pass of the lap (its current lap's own line crossing, the rule `lap-times` already uses for the projection after a restart, C25).

- [ ] **Step 1: Write the failing tests**, one row each:
  1. S1 appears when the car passes sector 2's start, with its status against the bests before it;
  2. S2 appears at sector 3's start; S3 and all three at the line;
  3. after the line S2 and S3 of the previous lap stay with `newestSectorOlder` true; S1 of the new lap replaces S1 with `false`;
  4. a session-best S1 mid-lap is `sessionBest` at once;
  5. after a garage restart in practice (same lap number), the S1 of the attempt before the restart is `newestSectorOlder: true` on the restarted pass (Review Focus 1);
  6. a car without live sector times keeps `unknown` with the reason.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/lap-times/newest-sectors.test.ts`. Expected: FAIL. Commit `test(analysis): newest sector times`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(analysis): newest sector times`.

### Task 6: `damage`: measuring and the early estimate

**Clauses:** C26, C31.2, C41, C43, C45.

**Scope:** `PITWALL_WORKER_UNIT=damage`.

**Files:**
- Modify: `packages/analysis/src/damage/calculator.ts`, `packages/analysis/src/shared/damage-jumps.ts` (delegated: shared), `behaviour.ts`
- Test: `packages/analysis/test/damage/estimate.test.ts` (new), `packages/analysis/test/damage/damage.test.ts`

**Interfaces:**
- Consumes: `foldSegmentSample`, `segmentMedian` (Task 1); `NEUTRALISATION_READS`; `DAMAGE_CONFIG.minEstimateSegments`.
- Produces: per jump `measuring` (`lapsDone` of `lapsNeeded` 2 `forPace` laps after the jump; `notApplicable` once measured or when never measurable) and `estimateMsPerLap` per spec 3.5; reads gain `'miniSectors'` and `NEUTRALISATION_READS`.

- [ ] **Step 1: Write the failing tests**, one row each:
  1. right after a jump: `measuring` `{ lapsDone: 0, lapsNeeded: 2 }`, estimate `insufficientData`;
  2. after 10 eligible mini-sectors: estimate = sum of (time − frozen median) × 50 / 10;
  3. the baseline ignores every crossing after the jump's frame (a slow damaged lap does not move it);
  4. pit and neutralised mini-sectors are skipped for the estimate;
  5. after two `forPace` laps: `lossMsPerLap` known, `measuring` and estimate `notApplicable`;
  6. a jump with no pace laps before it: `lossMsPerLap` `notApplicable`, the estimate stays;
  7. incremental equals from scratch (if the unit is incremental) or the guarded view passes (if quick).
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run packages/analysis/test/damage`. Expected: FAIL. Commit `test(analysis): damage measuring and estimate`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(analysis): damage measuring and estimate`.

### Task 7: `battle-cards`

**Clauses:** C65, C66, C68.

**Scope:** `PITWALL_WORKER_UNIT=battle-cards`.

**Files:**
- Modify: `apps/ui/src/widgets/battle-cards/{rows.ts,emphasis.ts,text.ts,presentation.ts,BattleCards.svelte,gallery.ts}`
- Test: `rows.test.ts`, `emphasis.test.ts`, `BattleCards.test.ts`

**Interfaces:**
- Consumes: `BattleSide.paceDeltaMs`, `.margin`, `.lapsToDrs` (Task 2).

- [ ] **Step 1: Write the failing tests**: rows GAP, PACE Δ `+0.43 s/lap`, `PASS +0.25 s/lap` on AHEAD, `HOLD −0.40 s/lap` on BEHIND, DRS, tyres, ERS; no CLOSING row; a positive PASS bold white; a negative HOLD bold `warning`; no verdict word anywhere (a test scans the rendered text for `can pass`/`safe`). Update the gallery cases (test phase).
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/src/widgets/battle-cards`. Expected: FAIL. Commit `test(ui): battle card pass and hold`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): battle card pass and hold`.

### Task 8: `gap-chart`

**Clauses:** C65, C68.

**Scope:** `PITWALL_WORKER_UNIT=gap-chart`.

**Files:**
- Modify: `apps/ui/src/widgets/gap-chart/{series.ts,gallery.ts}`
- Test: `series.test.ts`

**Interfaces:**
- Consumes: `GapperLines.cars[].points` (Task 3).

- [ ] **Step 1: Write the failing tests**: one series per car of `cars`, from `points` plus `now`; ours in the ours role, every other car `textFaint`; no team colours; the y range is left to the kit chart (the series carry no range). Gallery case with a window of 5 cars and per-segment points.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/src/widgets/gap-chart`. Expected: FAIL. Commit `test(ui): gap chart window`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): gap chart window`.

### Task 9: `incident-feed`: our cars by code, warnings by kind

**Clauses:** C65, C68.

**Scope:** `PITWALL_WORKER_UNIT=incident-feed`.

**Files:**
- Modify: `apps/ui/src/widgets/incident-feed/{rows.ts,text.ts,gallery.ts}`
- Test: `rows.test.ts`, `text.test.ts`

**Interfaces:**
- Consumes: `cars.overview` codes; `IncidentWarning.kind`, `.infringement` (Task 4); `warningKind` from `kit/text.ts` (Task 0).

- [ ] **Step 1: Write the failing tests**: an entry for our teammate reads `RUS P6→P7`, for the player its own code, never `us`; `warning · corner cutting 2/3`; `warning · collision`; an unknown infringement reads `warning`. Gallery cases.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/src/widgets/incident-feed`. Expected: FAIL. Commit `test(ui): incident feed names our cars, warnings by kind`.
- [ ] **Step 3: Implement**; remove the `us` constant.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): incident feed names our cars, warnings by kind`.

### Task 10a: `timing-tower` sectors / Task 10b: `lap-analysis` sectors

**Clauses:** C65, C68.

**Scope:** `PITWALL_WORKER_UNIT=timing-tower` (10a) and `PITWALL_WORKER_UNIT=lap-analysis` (10b), in parallel.

**Files:**
- Modify: `apps/ui/src/widgets/<unit>/{rows.ts,fixtures.ts,gallery.ts}`
- Test: `apps/ui/src/widgets/<unit>/rows.test.ts`

**Interfaces:**
- Consumes: `newestSectorsMs`, `newestSectorStatus`, `newestSectorOlder` (Task 5).

- [ ] **Step 1: Write the failing tests**: S1–S3 from `newestSectorsMs` with their status roles; a sector with `newestSectorOlder` in `textFaint` and no best colour; an unknown sector blank.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/src/widgets/<unit>`. Expected: FAIL. Commit `test(ui): <unit> sectors as they finish`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): <unit> sectors as they finish`.

### Task 11: `fuel-gauge` shows the kg

**Clauses:** C3, C65.

**Scope:** `PITWALL_WORKER_UNIT=fuel-gauge`.

- [ ] **Step 1: Write the failing test** in `apps/ui/src/widgets/fuel-gauge/rows.test.ts`: with `kg` known and `burnKgPerLap` `insufficientData`, the kg shows (`10.0 kg`); lasts, burn and margin blank. Gallery case "first lap".
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/src/widgets/fuel-gauge`. Expected: FAIL. Commit `test(ui): fuel kg from the start`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): fuel kg from the start`.

### Task 12: `damage-card`: measuring and estimate

**Clauses:** C65, C68.

**Scope:** `PITWALL_WORKER_UNIT=damage-card`.

**Interfaces:**
- Consumes: `DamageJump.measuring`, `.estimateMsPerLap` (Task 6).

- [ ] **Step 1: Write the failing tests** in `apps/ui/src/widgets/damage-card/rows.test.ts`: `measuring 0/2 laps` while measuring without an estimate; `~+0.8 s/lap est.` in `textFaint` with one (wording in `text.ts`); the measured loss alone once known; a never-measurable jump shows its estimate. Gallery cases.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/src/widgets/damage-card`. Expected: FAIL. Commit `test(ui): damage measuring and estimate`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): damage measuring and estimate`.

### Task 13a: `formatMinutesTenths` / Task 13b: `projected-lap` finish margin

**Clauses:** C65, C68, C78 (13a delegated: `kit/values/format.ts`).

**Scope:** 13a test `apps/ui/test/kit`, implement `apps/ui/src/kit/values/format.ts` (delegated); 13b `PITWALL_WORKER_UNIT=projected-lap`.

- [ ] **Step 1 (13a): Write the failing tests**: `formatMinutesTenths(1_128_600)` is `18:48.6`; `60_000` is `1:00.0`; `59_999` rounds to `1:00.0`. Run `nice -n 10 pnpm vitest run apps/ui/test/kit`; expected FAIL; commit `test(ui): minutes and tenths`; implement; run; commit `feat(ui): minutes and tenths`.
- [ ] **Step 2 (13b): Write the failing tests** in `apps/ui/src/widgets/projected-lap/rows.test.ts`: a finish margin of 1 128 600 ms shows `18:48.6 left at line`; 45 300 ms shows `45.3 s`. Run; expected FAIL; commit `test(ui): finish margin in minutes`; implement; run; commit `feat(ui): finish margin in minutes`.

### Task 14: "Add panel" commands

**Clauses:** C67, C70, C72, C73, C78 (delegated: `apps/ui/src/shell/commands/`, `kit/text.ts` titles).

**Scope:** test `apps/ui/test/shell`; implement `apps/ui/src/shell/commands:apps/ui/src/shell/docking` (delegated).

**Files:**
- Modify: `apps/ui/src/shell/commands/default-commands.ts` (or a new `panel-commands.ts` beside it), `apps/ui/src/kit/text.ts` (`commandTitles.panelAdd(title)`, group Window)
- Test: `apps/ui/test/shell/panel-add.test.ts`

**Interfaces:**
- Consumes: the widget index (the shell may import it, C69); `docking.addPanel(spec: PanelSpec)`.
- Produces: one command per registered widget, id `panel.add.<widget>`, title "Add panel: <title>", group Window, no default key.

- [ ] **Step 1: Write the failing tests**: the registry holds `panel.add.track-map`-style ids for every registered widget; running one calls `addPanel` with that widget's spec in the focused group; the layout save afterwards sends one `workbook.updateWindow` holding the new panel; the palette lists the commands under Window.
- [ ] **Step 2: Run** `nice -n 10 pnpm vitest run apps/ui/test/shell/panel-add.test.ts`. Expected: FAIL. Commit `test(ui): add panel commands`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): add panel commands`.

### Task 15: Cleanup of the old fields

**Clauses:** C78 (delegated: `packages/domain/src/analyses/`), C82.

**Scope:** delegated domain files; `PITWALL_WORKER_UNIT=battle`, then `gaps`, then `incidents` (serial, one task).

- [ ] **Step 1: Write the failing tests**: a type-level test (`packages/domain/test/live-polish-fields.test-d.ts` or `expectTypeOf` in a test) that `BattleSide` has no `closingMsPerLap` or `overtakeMarginMs` and `margin` is required; `GapperLines.cars[]` has `points` required and no `byLap`; `IncidentWarning` is the union `{ kind: 'cornerCutting'; count; limit } | { kind: 'other'; infringement: Known<number> }`; the new `LapBoardRow` and `DamageJump` fields are required. Commit `test(domain): live polish fields final`.
- [ ] **Step 2: Implement**: remove the old fields and their writers in `battle` and `gaps`, the closing config keys (`closingWindow`, `closingMinSamples`) and every gallery or fixture value of them; make the new fields required.
- [ ] **Step 3: Run** `nice -n 10 pnpm check`. Expected: green.
- [ ] **Step 4: Commit** `refactor(domain): live polish fields final`.

### Task 16: Gate (supervisor)

**Clauses:** C88, C89.

- [ ] **Step 1: Run** `nice -n 10 pnpm check`. Expected: green, `Errors` empty.
- [ ] **Step 2: Run** `pnpm test:ui`; update the baselines of the changed widgets' first gallery cases (battle-cards, gap-chart, timing-tower if its first case changed); `SCREENSHOT_BUDGET` holds. The user looks at the changed images once.
- [ ] **Step 3: Run** `pnpm test:acceptance`. Expected: green.
- [ ] **Step 4: Replay** `2026-11-05_00-13-26_f5b2b5fdb8a6c50e_car19.pwrec.gz` (`pitwall dev --replay … --at-lap 18`): PACE Δ and PASS/HOLD move within the lap; the gap chart shows only the window; S1 appears mid-lap; the incident feed names RUS; tick the live-checklist rows for N2–N8 and N10.
- [ ] **Step 5: Review** with the one question (C89); fix findings in two phases; merge `polish/integ` to main and push; move spec and plan to `docs/history/`, update `docs/superpowers/README.md`.
