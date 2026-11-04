# Testing and validation

> The binding rules are contract clauses C82–C88 (`docs/architecture.md`); this guide explains how to follow them.

How pitwall tests its code, and how a sub-project plans its tests. Rulings this guide rests on: user, 2026-10-30 (segment tests, the time trial, replay as a test tool), and the earlier memories on slowness, screenshots and Stryker.

## 1. What a test is for

A test proves one behaviour of **our code**, and fails when that behaviour breaks. It is not a description of a recording, and not a guard against a refactor that keeps the behaviour.

Before writing a test, name the behaviour in one sentence: "a car that retires keeps its slot", "the lap crossing confirms the lap with the game's lap time". If the sentence is about the data instead ("the Singapore race has 39 overtakes", "fuel stays 10 kg"), it is not a test of our code. Don't write it.

## 2. Which kind of test, per layer

| layer | default test | data | helpers |
|---|---|---|---|
| `protocol` | unit and property tests: decode, encode, round trip | hand-built bytes, `fast-check` arbitraries, committed segments | `packages/protocol/test/arbitraries.ts`, `test-support/reference-decoder.ts` |
| `domain` | unit tests of the pure helpers | literals | none |
| `engine` | scenario tests per step; property tests on generated races | `ScenarioBuilder` frames | `packages/engine/test/builders/`, `test/support/{arb-race,invariants,run}.ts` |
| `analysis` | unit tests per calculator; incremental = from scratch; flashback = fresh run over the truncated history | builder data | `test-support/builders/` (`lap`, `crossings`, `field`, `carState`, `engineView`, `history`), `expectIncrementalEqualsFromScratch` |
| `bridge` | pipeline and feature tests; engine and tracker on real data | committed segments | `apps/bridge/test/fixtures/replay.ts` (`segmentPath`, `trackFile`), `engine-replay.ts` (`replayRunner`) |
| `ui` | gallery cases per display; `fit.spec` (no overflow at any size or theme); a few screenshot baselines; Playwright e2e per workflow | synthetic topic values in `gallery.ts`; moments captured from segments | `apps/ui/test/gallery/`, `apps/ui/e2e/harness.ts` |

Choose the lowest layer that can show the behaviour. Builder data first: it is small, readable and shows exactly the case. Real data second, to prove that the game's actual packets produce the case.

## 3. Real data: segments

Real recordings (`.pwrec.gz`) enter tests only as **segments**: short cuts committed under `fixtures/segments/`.

- **Size:** at most 1 MB. Exception: at most three **full-lap** segments of about 8 MB each, one per kind of lap (a 20-car race lap, a qualifying flying lap, a lap with a car-care band out for the whole lap). Behaviour that needs several laps uses builder data.
- **Source:** normal sessions only. The time trial holds fuel, wear, temperatures and the ERS store fixed, so it is no test fixture.
- **Cut** with `pwrec-cut <in> <out> --from <s> --to <s>`. Session time can repeat inside a recording (formation-lap resets, flashbacks, frozen LapPositions headers), so check the segment's content after cutting.
- **Record** each segment in `fixtures/index.json` (`segments`): source fixture, window, record count, and the facts you verified in it. Those facts help pick a segment. They are not test assertions.
- **One behaviour per segment test**, named after the behaviour: "the pit exit raises numPitStops and opens a soft stint", not "race-zandvoort-pit-exit works".
- **Cost:** a segment test runs the engine plus the units under test (1–2 s for a full lap), not the whole topic pipeline.

The committed segments (`fixtures/index.json`, `segments`; the verified facts are there). Which sub-machine test uses which segment: `docs/research/10-situations-catalogue.md`.

| Segment | Source, window (s) | Holds |
|---|---|---|
| `race-singapore-start` | raceSingapore, 0–0.5 | the grid without a formation lap: STLG ×5 and LGOT at session time 0 (start shape S1) |
| `race-singapore-wet-start` | raceSingaporeWet, 0–1.6 | the formation start, the formation-end reset to 0, the start lights and lights out (start shape S2) |
| `race-zandvoort-online-start` | raceZandvoortOnline, 0–2.1 | the formation start, the reset to 1.968 s, the start lights, lights out and the fall after it (start shape S3) |
| `race-zandvoort-uid-reuse-start` | raceZandvoortUidReuse, 0–1 | the formation start, resets and a small fall, the start lights, lights out and the fall after it (start shape S4, part) |
| `race-singapore-wet-formation-end` | raceSingaporeWet, 60–61.5 | a session that, to the engine, ends inside the formation lap |
| `race-zandvoort-clock-reset` | raceZandvoortOnline, 2–9 | a fall of the session time inside the formation, no FLBK, no lights out |
| `race-singapore-end` | raceSingapore, 61.5–63.4 | a race left with SEND, no classification |
| `race-zandvoort-lap10` | raceZandvoortUidReuse, 721–726 | the player's line crossing into lap 10 and its SessionHistory confirmation |
| `race-zandvoort-full-lap` | raceZandvoortUidReuse, 722–801 | full-lap segment: a 20-car race lap |
| `race-zandvoort-pit-stop` | raceZandvoortUidReuse, 548.2–555 | the player's pit entry, the line in the pit lane, the box and the tyre change |
| `race-zandvoort-pit-exit` | raceZandvoortUidReuse, 564.5–566 | the player in the pit lane past its box; `numPitStops` 0 → 1 |
| `race-zandvoort-vsc` | raceZandvoortUidReuse, 913.5–916.5 | a VSC deployment with its DRSD, the status a Session packet later, an RTMT |
| `race-zandvoort-retire` | raceZandvoortUidReuse, 1205–5846 | the player's terminal damage and the jump into the post-session simulation |
| `race-singapore-wet-flashback` | raceSingaporeWet, 741.5–744.5 | flashbacks on lap 7: three passes through the window |
| `race-drive-through` | raceFriendWet, 1530.5–1534 | the end of the second VSC; a drive-through given (PENA 0/38, the count a frame later) |
| `race-drive-through-served` | raceFriendWet, 1631–1639.2 | the drive-through visit's pit exit and its DTSV 7.1 s later |
| `race-miami-finish` | raceFriendWet, 2266.5–2271 | the chequered flag, finishes on the line, the last frame before SEND |
| `race-mexico-blue` | raceWetVscMexico, 6763.7–6774.7 | blue flags for lapped cars, on cars and marshal zones |
| `race-sprint-start` | raceSprint (2026-11-02_15-17-14), 0–2.5 | a sprint: the first Session packet without a weekend structure, a later one with [15, 16] |
| `qualifying-singapore-end` | qualifyingSingapore, 899–900.6 | time over: every car finished, SEND, the classification |
| `qualifying-singapore-full-lap` | qualifyingSingapore, 166.4–259.7 | full-lap segment: a qualifying flying lap from the garage |
| `practice-garage-exit` | practiceFriendWings, 640.5–651 | the player leaving the garage and the pit lane; a car ending its out lap at the line |
| `practice-wing-change` | practiceFriendWings, 615–619 | the player in the garage; a front-wing change |
| `practice-miami-yellow` | practiceFriendWings, 130–152 | yellow and green flags, on the player's car and marshal zones |
| `practice-miami-invalid` | practiceFriendWings, 1525–1550 | a lap invalidated: PENA 12/7 and `currentLapInvalid` on one frame |
| `practice-miami-warning` | practiceFriendWings, 214–218 | a warning: PENA 5/7 and the rise of `totalWarnings` on one frame |
| `practice-zandvoort-warning-late` | practiceZandvoortOnline, 45–47.5 | a warning whose rise follows its PENA by 16 frames |

**Whole recordings** (`recordings/`, gitignored, listed in `fixtures/index.json`) appear only in the acceptance suite, and only for properties of the whole pipeline: determinism, reprocess, decoder equality and decoder speed. The big races (`raceSingaporeWet`, `raceZandvoortUidReuse`, `raceWetVscMexico`, `raceFriendWet`), recordings over about 50 MB (`practiceFriendWings`) and the time trial stay out of the determinism and decoder-equality sets.

When a new recording arrives: label it (index entry with verified features), then cut the segments the next sub-project needs. Don't add whole-recording tests.

## 4. Writing a good test

- **One behaviour, one test.** The name states the behaviour and its condition. A reader who sees only the failing name knows what broke.
- **Minimal data.** Build only what the case needs; let builders default the rest. A test that sets 30 fields hides the one that matters.
- **Assert the outcome a consumer sees** (the topic value, the `Known`, the event), not internals. Prefer `toEqual` on the whole value over picking fields when the value is small.
- **Named sets, not counts:** `expect(ids).toEqual([1, 4])`, not `toHaveLength(2)`.
- **Missing data is part of the behaviour:** cover the `unknown(reason)` path (not received, restricted telemetry, realism, not applicable). Never assert a 0 that stands for "missing".
- **The cases the game really produces:** flashbacks, retirements and DSQs mid-race, safety car and VSC, pit stops, red flags, session time resets, UID-0 bulks, restricted telemetry of other humans, cars out of the slot order. A real-data finding becomes a builder test too, so the case stays covered when the segment changes.
- **Decision first:** for an analysis, test the engineer's decision it supports ("the undercut gains 1.2 s"), and the inputs where that decision flips.
- **Deterministic:** no clock, no `Math.random` (seeded generators only), no ordering by hash maps. A flaky test is a bug.
- **Fast:** every unit-test file finishes well inside the default 5 s timeout under `pnpm check`. A slow test is profiled and fixed; timeouts are never raised to hide it.

## 5. Properties worth stating

Property tests (`fast-check`) state a rule over many generated inputs. Pitwall's standing properties:

- **Round trip:** `encode(decode(bytes))` gives the bytes back, on generated packets and on every segment.
- **Determinism:** the same input stream gives the same state and the same topic stream.
- **Incremental = from scratch:** an incremental unit's accumulator after each frame, also after every rewind, equals a fresh `init` over the same projection (C31).
- **Rewind exactness:** after a flashback, the projection and every topic (insights included, job topics excepted) equal a run that never received the undone frames (contract C33).
- **Shuffle within a step:** each engine step's modules in shuffled order give identical results (C11).
- **The projection only grows,** except when a void fact appears (C28).
- **Reprocess equals live** (C38).
- **One property per sub-machine:** random signal sequences never produce an undeclared transition, a throw, two open spans in one scope or a gap between spans (C85).
- **Domain symmetries:** e.g. gap(A,B) = −gap(B,A), and gap(A,C) = gap(A,B) + gap(B,C) where all three crossed.
- **Engine invariants** (`InvariantChecker`): they hold on every frame of every segment and every generated race.

A new analysis states which of these apply, and adds its own domain property if it has one.

## 6. Validation beyond the unit suite

| gate | runs | holds |
|---|---|---|
| related tests | by the worker, during a task | `vitest related <changed files>` plus typecheck, lint and depcruise (C88) |
| `pnpm check` | by the supervisor, before every merge | typecheck, lint, depcruise, unit and property tests, segment tests; no whole recording |
| `pnpm test:acceptance` | at the end of each sub-project, and after changes to the pipeline or the decoder | whole-pipeline properties on whole recordings; speed targets |
| `pnpm test:ui` | at the end of each sub-project, and when the UI changed | gallery, fit, screenshot baselines (budget in `screenshot-budget.test.ts`), Playwright e2e |
| `pnpm mutation` | once at the MVP end | Stryker, at least 80 % on protocol, engine, analysis and UI logic |
| human check | once per sub-project | the screenshots and the checklist in `docs/acceptance/` |

**Speed targets** are tests: a measured baseline, a target, and an acceptance test that fails above it (best of several warm passes, so machine load can't flake it). The decoder's target (`decoder.acceptance.test.ts`) is the model.

**Screenshots:** one baseline per display size (its first gallery case, default theme), under the total budget. The gallery and `fit.spec` cover every case and theme without images.

## 7. Workflow

- **Two phases, two agents:** the test agent writes failing tests and commits them; the implementation agent makes them pass without touching them. The supervisor checks `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support fixtures` is empty afterwards.
- **A test that fails on current code is a finding:** keep it, change no source, report it. The supervisor rules: fix (the test becomes the fix task's test phase), or turn the test around when the behaviour is deliberate (with the ruling in a comment).
- **Test levels (C88):** a worker runs the tests related to its changes (`vitest related`) plus typecheck, lint and depcruise; the supervisor runs `pnpm check` before every merge and the UI and acceptance suites at a sub-project's end, never while an agent edits source. Vitest's `Errors` line is read as well as `Tests`.
- **Sub-machine transitions (C85):** each sub-machine's test file holds a transition table, one row per declared transition and per join; completeness tests check rows and declared transitions both ways; recorded transitions also get a segment test on the produced span sequence. Adopting or widening a rule needs `pitwall scan-situations` over every recording in the report.
- **No test reads the priors store, storage or the data dir (C84):** a test that needs priors passes them explicitly.
- **Assumptions** the brief doesn't pin go into the test agent's report; the supervisor rules on them before the implementer starts.

## 8. A sub-project's test plan

Each sub-project spec has a test section that lists, per unit:

1. the behaviours to prove, one sentence each;
2. the layer and kind of each test (builder unit test, property, segment, gallery case, e2e);
3. the segments it needs, and whether they exist or must be cut (source recording and window);
4. the properties from section 5 that apply;
5. acceptance additions, if any, and their speed targets;
6. the human checks.

Review the plan against sections 1 and 3 before any test agent starts: no recording facts, no whole recordings outside acceptance, no time trial.
