# Testing and validation

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

**Whole recordings** (`recordings/`, gitignored, listed in `fixtures/index.json`) appear only in the acceptance suite, and only for properties of the whole pipeline: determinism, reprocess, decoder equality and decoder speed. The big races (`raceSingaporeWet`, `raceZandvoortUidReuse`, `raceWetVscMexico`) and the time trial stay out of the determinism set.

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
- **Incremental = from scratch:** an incremental calculator's accumulator after each frame equals a fresh `init` over the same history.
- **Flashback:** after a flashback, every output equals a fresh run over the truncated history.
- **Domain symmetries:** e.g. gap(A,B) = −gap(B,A), and gap(A,C) = gap(A,B) + gap(B,C) where all three crossed.
- **Engine invariants** (`InvariantChecker`): they hold on every frame of every segment and every generated race.

A new analysis states which of these apply, and adds its own domain property if it has one.

## 6. Validation beyond the unit suite

| gate | runs | holds |
|---|---|---|
| `pnpm check` | before every commit | typecheck, lint, depcruise, unit and property tests, segment tests; no whole recording |
| `pnpm test:acceptance` | at merge of a sub-project, and after changes to the pipeline or the decoder | whole-pipeline properties on whole recordings; speed targets |
| `pnpm test:ui` | when the UI changed | gallery, fit, screenshot baselines (budget in `screenshot-budget.test.ts`), Playwright e2e |
| `pnpm mutation` | once at the MVP end | Stryker, at least 80 % on protocol, engine, analysis and UI logic |
| human check | once per sub-project | the screenshots and the checklist in `docs/acceptance/` |

**Speed targets** are tests: a measured baseline, a target, and an acceptance test that fails above it (best of several warm passes, so machine load can't flake it). The decoder's target (`decoder.acceptance.test.ts`) is the model.

**Screenshots:** one baseline per display size (its first gallery case, default theme), under the total budget. The gallery and `fit.spec` cover every case and theme without images.

## 7. Workflow

- **Two phases, two agents:** the test agent writes failing tests and commits them; the implementation agent makes them pass without touching them. The supervisor checks `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support fixtures` is empty afterwards.
- **A test that fails on current code is a finding:** keep it, change no source, report it. The supervisor rules: fix (the test becomes the fix task's test phase), or turn the test around when the behaviour is deliberate (with the ruling in a comment).
- **Lane-only:** an agent runs only its own test files; the supervisor runs every bigger suite, never while an agent edits source.
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
