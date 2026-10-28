# Pitwall Foundation (Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pitwall foundation: F1 25 UDP / `.pwrec` input, schema-driven decoder, frame assembly with session lifecycle and flashbacks, a pure race-model engine with history, the calculator framework, topic contracts over WebSocket, SQLite storage and the CLI tools — so sub-projects 2–4 can build on stable topics.

**Architecture:** A pnpm monorepo. `packages/protocol` turns bytes into typed packets, `packages/domain` holds the JSON-safe domain vocabulary (`Known`, `Corners`, `CarState`, records, `Insight`, ids), `packages/contracts` holds topic definitions and wire messages, `packages/engine` is a pure race model (assembler, `step`, history, snapshots, calculators), `apps/bridge` is the imperative shell (sources, `.pwrec`, storage, topic hub, WebSocket, CLI). Data flows `PacketSource → decode → FrameAssembler → SessionRunner(step) → Scheduler → TopicHub → WebSocket`.

**Tech Stack:** TypeScript ~6.0 (strict; not 7, because typescript-eslint and dependency-cruiser still need the TS JS API) run directly by Node ≥ 22.18 type stripping, pnpm workspaces, Vitest, fast-check, Stryker, dependency-cruiser, ESLint, `ws`, `better-sqlite3`, `pino`.

**Spec:** `docs/superpowers/specs/2026-10-28-foundation-design.md` (read it alongside this plan; section numbers like "spec 5.3" refer to it). `.pwrec` format: `~/dev/personal/pitwall-recorder/FORMAT.md`. UDP structs: `external/F1 25 Telemetry Output Structures.txt` and `external/Data Output from F1 25 v3-1.pdf` (appendix tables for codes).

## Global Constraints

- Node `>=22.18`; TS files run natively (type stripping). Therefore tsconfig has `"erasableSyntaxOnly": true`, `"allowImportingTsExtensions": true`, `"noEmit": true`, `"verbatimModuleSyntax": true`, `"module": "nodenext"`, `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`. No `enum`, no namespaces, no parameter properties; relative imports end in `.ts`. Use `as const` objects instead of enums.
- Package names: `@pitwall/protocol`, `@pitwall/domain`, `@pitwall/contracts`, `@pitwall/engine`, `@pitwall/strategy`, `@pitwall/bridge`. Each package's `exports` maps `"."` to `./src/index.ts`.
- Dependency direction (enforced by dependency-cruiser, violation = failed build): `protocol` → nothing; `domain` → nothing; `contracts` → `domain`; `engine` → `protocol`, `domain`; `strategy` → `engine`, `domain`; `bridge` → all packages; `ui` (sub-project 2) → `contracts`, `domain` only. **This refines spec 3.1 (decided by the user 2026-10-28):** the JSON-safe domain vocabulary lives in a new leaf package `@pitwall/domain`, defined once and shared by engine, contracts and UI; `contracts` stays wire-only (topics, messages, wire format). Recorded in ADR 0003.
- Only `packetFormat === 2025`. Wheel order in protocol stays RL, RR, FL, FR; it is translated to `Corners` exactly once, in the engine.
- Units inside engine/contracts: time integer ms, distance m, speed km/h, temperature °C, pressure psi, fuel kg, energy J, angle rad. `SessionTime` = integer ms (`Math.round(header.sessionTime * 1000)`).
- Engine never reads the clock (`Date`, `performance`), never does I/O, never uses `Math.random`. ESLint `no-restricted-globals`/`no-restricted-properties` enforce this in `packages/engine` and `packages/strategy`.
- Expected problems are values (`DecodeResult`, `Known`, `topicStatus`), not exceptions. Exceptions are bugs.
- Environment variables: `PITWALL_WS_PORT` (default 4777), `PITWALL_UDP_PORT` (default 20777), `PITWALL_UI_PORT` (default 5173, reserved), `PITWALL_DATA_DIR` (default `~/.local/share/pitwall`), `PITWALL_FIXTURES_DIR` (default `<repo>/recordings`).
- Registration by convention: a feature is a folder `apps/bridge/src/features/<name>/register.ts` default-exporting a `Feature`. `scripts/gen-features.ts` generates the gitignored `apps/bridge/src/features/index.generated.ts`; it runs in `pretest`, `pretypecheck` and before every bridge start. No hand-edited central list.
- Supervisor-owned files (workers request changes in their report instead of editing): `packages/domain/**`, `packages/contracts/**`, every `package.json`, `pnpm-lock.yaml`, `packages/engine/src/state/**`, root configs.
- Workflow for every task: a **test agent** writes the task's tests first from this plan and the spec (Step 1–2), commits them, then a separate **implementation agent** makes them pass without editing test files (hook-enforced). The supervisor runs the full suite and merges.
- Quality gates: Stryker mutation score ≥ 80 % on `protocol`, `engine`, `strategy`; `tsc -p tsconfig.json` strict clean (not `tsc -b`: project references with `noEmit` fail with TS6310); ESLint clean; dependency-cruiser clean.
- Fixtures: full recordings are never committed (`recordings/` and `external/` are gitignored). Tests needing them call `fixturePath(name)` and are skipped with a note when the file is missing. Small segments cut with `pwrec-cut` live in `fixtures/segments/` and are committed.
- Fixture names (short ids used in tests): `ttZandvoort` = `2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz`, `raceSingapore` = `2026-10-28_00-15-04_b3cd07e2790bdcbe.pwrec.gz`, `menuOnly` = `2026-10-27_22-50-28_5cc4798807ebe7a5.pwrec.gz`.
- Git: work happens on feature branches/worktrees; commit after every task; never force-push `main`.

## Review Focus

1. **A car slightly ahead on the timing screen** (gap −17 ms, game-encoded as u16 wrap): gap shows −17 ms, not 65 s. Tests: Task 3 "minutes 0 with msPart >= 60000 is a negative delta", Task 6 real-packet test (`negativeDeltas` = 795, byte-identical), Task 14 "passes negative gaps through".
2. **A flashback in practice**: no packets after it are dropped as late, laps after the target disappear, and history continues as if the discarded frames never happened, also without an `FLBK` event. Tests: Task 10 "orders by overallFrameId…", Task 17 "detects a flashback without FLBK…", "a target older than the replay window…", Task 18 flashback property.
3. **The final lap of a session** is confirmed by the UID-0 SessionHistory bulk that arrives around `SEND`: the last lap must show as confirmed. Tests: Task 11 `session-tracker.fixture.test.ts` (20 UID-0 packets land in the session, end reason `SEND`), Task 30 "acceptance: TT Zandvoort" (lap 15 confirmed).
4. **An online rival with restricted telemetry**: tyre wear, fuel, ERS and damage show "restricted", never 0. Tests: Task 13 identity "human non-player with yourTelemetry 0 is restricted", Task 14 "a restricted human car: every field on the spec list is unknown("restricted"), not 0".
5. **Startup and slow clients**: a busy UDP/WS port or unwritable data dir gives one clear message and exit 1 with nothing half-started; a slow UI client gets the newest state and a fresh snapshot instead of lost append entries. Tests: Task 28 "live: busy …", Task 26 dataDir `StartupError`, Task 24 "backpressure: append overflow…".

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, tsconfig.json   root workspace (Task 1)
eslint.config.js, .dependency-cruiser.cjs, vitest.config.ts            quality tooling (Task 1)
stryker.config.mjs (per gated package)                                 mutation gate (Task 1, enforced Task 30)
.gitignore, fixtures/index.json, fixtures/segments/                    fixtures (Task 1, segments Task 29)
scripts/gen-features.ts                                                feature registry codegen (Task 20)
test-support/fixtures.ts                                               fixturePath()/skip helper (Task 1)
CLAUDE.md, docs/architecture.md, docs/decisions/, docs/tasks/          agent workflow docs (Task 2)
.claude/settings.json, .claude/hooks/*.sh                              hooks (Task 2)

packages/protocol/src/
  schema/dsl.ts        field/struct/array/chars/splitTime builders, Infer<S>       (Task 3)
  schema/codec.ts      readStruct/writeStruct over DataView                        (Task 3)
  header.ts            PacketHeader schema, PacketId, PACKET_FORMAT                (Task 4)
  packets/*.ts         one schema file per packet type (16)                        (Tasks 4–5)
  events.ts            event codes + EventDetails union                            (Task 5)
  sizes.ts             PACKET_SIZES table                                          (Task 4)
  decode.ts encode.ts  decode()/encode()                                           (Task 6)
  index.ts
packages/protocol/test/arbitraries.ts                                          fast-check arbitraries (Task 6)

packages/domain/src/
  ids.ts known.ts corners.ts units.ts compounds.ts                             (Task 9)
  session.ts car.ts records.ts insight.ts index.ts                             (Task 9)

packages/contracts/src/
  topics.ts messages.ts wire.ts version.ts index.ts                            (Task 21)

packages/engine/src/
  frame/frame.ts frame/assembler.ts frame/session-tracker.ts frame/metrics.ts  (Tasks 10–11)
  state/engine-state.ts state/weekend-context.ts                               (Task 9)
  step/step.ts step/session.ts step/identity.ts step/timing.ts
  step/tyres.ts step/energy.ts step/condition.ts step/dynamics.ts step/own-car.ts (Tasks 13–14)
  history/laps.ts history/stints.ts history/pit-stops.ts history/flags.ts
  history/events.ts history/mini-sectors.ts history/delta.ts                   (Tasks 15–16)
  runner/session-runner.ts runner/snapshots.ts                                 (Task 17)
  calc/types.ts calc/registry.ts calc/scheduler.ts calc/insight-book.ts        (Tasks 19–20)
  util/rng.ts util/deep-readonly.ts
packages/engine/test/builders/  packet + frame builders via encoder            (Task 12)

packages/strategy/src/index.ts  empty placeholder                               (Task 1)

apps/bridge/src/
  pwrec/parser.ts pwrec/reader.ts pwrec/writer.ts                              (Task 7)
  input/packet-source.ts input/pwrec-source.ts input/udp-source.ts             (Task 8)
  jobs/job-runner.ts jobs/worker-entry.ts                                      (Task 22)
  features/feature.ts features/<topic>/register.ts                             (Tasks 20, 23)
  hub/topic-hub.ts hub/throttle.ts                                             (Task 24)
  ws/server.ts ws/client.ts                                                    (Task 25)
  storage/db.ts storage/storage-writer.ts storage/weekend-repository.ts        (Task 26)
  storage/data-dir.ts storage/session-files.ts
  pipeline/feed-pipeline.ts pipeline/debug-dump.ts log.ts config.ts            (Task 27)
  cli/pitwall.ts cli/pwrec-cut.ts cli/commands/*.ts                            (Tasks 28–29)
```

## Task Overview

| # | Task | Depends on | Parallel group |
|---|---|---|---|
| 1 | Workspace scaffold and quality tooling | — | A |
| 2 | Agent workflow: CLAUDE.md, docs, ADRs, hooks | 1 | A |
| 3 | Protocol schema DSL and codec | 1 | B |
| 4 | Header and fixed-size packet schemas | 3 | B |
| 5 | Event packet and event details | 4 | B |
| 6 | `decode`/`encode`, round trip, real packets | 5, 7 | B |
| 7 | `.pwrec` parser, reader, writer | 1 | C |
| 8 | Packet sources (`PwrecSource`, `UdpSource`) | 7 | C |
| 9 | Domain vocabulary package and engine state types | 1 | D (supervisor) |
| 10 | Frame assembler (grouping, reorder, loss metrics) | 6, 9 | D |
| 11 | Session tracker (lifecycle, UID-0 grace window) | 10 | D |
| 12 | Test builders (packets and frames via encoder) | 6, 9, 11 | D |
| 13 | `step`: session state and car identity | 11, 12 | D |
| 14 | `step`: timing, tyres, energy, condition, dynamics, own car | 13 | D |
| 15 | History: laps (provisional → confirmed), stints, pit stops | 14 | D |
| 16 | History: flag phases, race events, mini-sector crossings | 14 | D |
| 17 | `SessionRunner`: snapshots and flashback rewind | 15, 16 | D |
| 18 | Engine invariants (property tests over fixtures) | 17 | D |
| 19 | Calculator types, registry, insight book | 9 | E |
| 20 | Scheduler and feature convention loader | 19 | E |
| 21 | Topic definitions, WebSocket messages, wire format | 9 | E (supervisor) |
| 22 | Job framework (worker thread, seeded RNG) | 19 | E |
| 23 | Base topic features | 17, 20, 21 | E |
| 24 | `TopicHub` (throttle, backpressure, snapshots) | 21, 23 | E |
| 25 | WebSocket server and client | 24 | E |
| 26 | Storage: SQLite, `StorageWriter`, `WeekendRepository` | 9, 15 | C |
| 27 | Feed pipeline, session files, logging, debug dumps | 8, 17, 23, 25, 26, 29 | E |
| 28 | CLI: `live`, `replay`, `tap`, `reprocess`, `import` | 27 | E |
| 29 | `pwrec-cut` and committed fixture segments | 6, 7 | C |
| 30 | Acceptance: fixture facts, determinism, quality gates | all | A |

Groups B, C, D(9) and E(19, 21) can start in parallel after Task 1–2.

## Corrections to the spec found while planning

The planning agents checked the spec against the three recordings. These deviations are deliberate; the spec is updated in the same commit as this plan:

1. **Negative split times.** The game writes small negative gaps (car ahead/leader deltas, −50…−16 ms in raceSingapore, 795 LapData packets) as u16 `msPart` ≥ 60000 with `minutes` 0. `splitTime()` decodes that form as `msPart − 65536` and encodes negatives back the same way, so every recorded datagram re-encodes byte-identically (Tasks 3, 6, 14).
2. **The UID-0 SessionHistory bulk arrives ~0.1 ms *before* `SEND`**, not after (both recordings). The 10 s grace window applies on both sides of `SEND` (Task 11). In ttZandvoort, lap 15 is confirmed only by that bulk (Task 30).
3. **Frames are grouped by `overallFrameIdentifier`**, not `frameId`: after a flashback `frameId` goes back, so grouping by it would drop every following packet as late. Flashback detection still compares `frameId` (Tasks 10, 17).
4. **Sector sum vs lap time:** the game truncates sector times, so confirmed sectors sum to 0–2 ms *less* than the lap time; the invariant checks `lapTime − 2 ≤ Σ sectors ≤ lapTime` (Task 18).
5. **Flashback replay window:** frames are buffered for `replayWindowMs` (default 10 000) instead of "since the last snapshot", because a target before the newest snapshot must still be replayable (Task 17). The default is confirmed once the flashback recording (spec 12, item 3) exists.
6. **Weekend context needs the player's `DriverKey`**, which arrives with Participants (every 5 s). The pipeline buffers a new session's frames until the first Participants packet (cap 600 frames) before creating the `SessionRunner` (Task 27).
7. **Red flag end** has no signal in the spec; a red `FlagPhase` ends at the next `LGOT`, an SC restart, or `SEND` (Task 16).
8. **Singapore's session time stays 0 for ~5.6 s before lights out**; cadence and snapshots tolerate a zero step (Tasks 10, 17).

---

### Task 1: Workspace scaffold and quality tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`
- Create: `vitest.config.ts`, `vitest.acceptance.config.ts`, `eslint.config.js`, `.dependency-cruiser.cjs`
- Create per package (`packages/{protocol,domain,contracts,engine,strategy}`, `apps/bridge`): `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (`export {};`)
- Create: `packages/{protocol,engine,strategy}/stryker.config.mjs`
- Create: `fixtures/index.json`, `fixtures/segments/.gitkeep`, `test-support/fixtures.ts`
- Test: `test/tooling/quality-gates.test.ts`, `test-support/fixtures.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (contract): `FIXTURES`, `FixtureName`, `fixturePath(name: FixtureName): string | undefined`, `describeWithFixture(name: FixtureName, title: string, fn: (path: string) => void): void`; root scripts `typecheck`, `test`, `lint`, `depcruise`, `mutation`, `check`, `gen:features`.
- Produces (new): `fixturesDir(env?: NodeJS.ProcessEnv): string`; `fixturePath` takes an optional second parameter `env` (default `process.env`); root script `test:acceptance` (`vitest run -c vitest.acceptance.config.ts`, used by Task 30). Tests may live in `src/**/*.test.ts` or `test/**/*.test.ts` of each package; root tooling tests live in `test/` and `test-support/`.

**Decisions already verified on this machine (Node 22.22.2):**
- **TypeScript `~6.0.3`, not 7.** TS 7 ships no JS compiler API. typescript-eslint 8.72 (peer `typescript <6.1`) and dependency-cruiser 18.7 (`typescript <7`) need that API. Recorded in ADR 0001 (Task 2).
- **`typecheck` is `tsc -p tsconfig.json`, not `tsc -b`.** Project references cannot be combined with `noEmit` (TS6310 "may not disable emit"). The root `tsconfig.json` covers every package. Each package `tsconfig.json` is used for the per-package hook (Task 2).
- Every `package.json` needs `"type": "module"`. Without it TS1287 fires under `verbatimModuleSyntax`.
- Stryker cannot discover the plugin from a package folder: set `plugins: ['@stryker-mutator/vitest-runner']`. With no tests, Stryker aborts: `strategy` sets `allowEmpty: true` until sub-project 4. Remove it then.
- `passWithNoTests` is accepted only in the root vitest config, not in `defineProject`.

- [ ] **Step 0: Install pnpm (pnpm and corepack are missing; `~/.local/bin` is on PATH)**

```bash
npm install -g pnpm@12.15.0 --prefix ~/.local && pnpm --version   # 12.15.0
```

- [ ] **Step 1: Write the workspace skeleton and install the tooling** (supervisor)

Root `package.json`: `"name": "pitwall"`, `"private": true`, `"type": "module"`, `"packageManager": "pnpm@12.15.0"`, `"engines": { "node": ">=22.18" }`. Scripts:
`"typecheck": "tsc -p tsconfig.json"`, `"test": "vitest run"`, `"test:acceptance": "vitest run -c vitest.acceptance.config.ts"`, `"lint": "eslint ."`, `"depcruise": "depcruise packages apps test-support test --config .dependency-cruiser.cjs"`, `"mutation": "pnpm --workspace-concurrency=1 --filter @pitwall/protocol --filter @pitwall/engine --filter @pitwall/strategy run mutation"`, `"check": "pnpm typecheck && pnpm lint && pnpm depcruise && pnpm test"`, `"gen:features": "node scripts/gen-features.ts"`. Task 20 creates `scripts/gen-features.ts` and adds `pretest`/`pretypecheck`.
`pnpm-workspace.yaml`: `packages: [packages/*, apps/*]`.
Each package `package.json`: `{ "name": "@pitwall/<x>", "version": "0.0.0", "private": true, "type": "module", "exports": { ".": "./src/index.ts" } }`. The gated packages also get `"scripts": { "mutation": "stryker run" }`. Internal dependencies use `"workspace:*"`: contracts → domain; engine → protocol, domain; strategy → engine, domain; bridge → all five.

```bash
pnpm add -Dw typescript@~6.0.3 @types/node@^22.20.5 vitest@^5.0.5 fast-check@^4.10.2 eslint@^10.13.0 @eslint/js@^10.0.1 \
  typescript-eslint@^8.72.1 dependency-cruiser@^18.7.0 @stryker-mutator/core@^10.1.1 @stryker-mutator/vitest-runner@^10.1.1
```

`tsconfig.base.json` compilerOptions: `target`/`lib` `ES2023`, `module`/`moduleResolution` `nodenext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`, `types: ["node"]`. Root `tsconfig.json` extends it with `include: ["packages/*/src", "packages/*/test", "packages/*/vitest.config.ts", "apps/*/src", "apps/*/test", "apps/*/vitest.config.ts", "scripts", "test", "test-support", "vitest.config.ts", "vitest.acceptance.config.ts"]`. Package `tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test", "vitest.config.ts"] }`.

Vitest: each package `vitest.config.ts` = `defineProject({ test: { name: '<x>', include: ['src/**/*.test.ts', 'test/**/*.test.ts'], exclude: ['**/*.acceptance.test.ts'] } })`. Root `vitest.config.ts` = `defineConfig({ test: { passWithNoTests: true, projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts', { test: { name: 'root', include: ['test/**/*.test.ts', 'test-support/**/*.test.ts'] } }] } })`. `vitest.acceptance.config.ts` = `defineConfig({ test: { include: ['apps/bridge/test/acceptance/**/*.acceptance.test.ts'], testTimeout: 600_000, hookTimeout: 600_000, fileParallelism: false } })`.

`stryker.config.mjs` (protocol, engine, strategy; strategy adds `allowEmpty: true`):

```js
export default { packageManager: 'pnpm', testRunner: 'vitest', plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'vitest.config.ts' }, mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/index.ts'],
  thresholds: { high: 90, low: 80, break: 80 }, reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' }, tempDirName: '.stryker-tmp', ignoreStatic: true };
```

`.gitignore`: `node_modules/`, `recordings/`, `external/`, `.idea/`, `apps/bridge/src/features/index.generated.ts`, `.stryker-tmp/`, `reports/`. Do not ignore `*.gz`, because the segments are committed.

`fixtures/index.json` holds `{ "fixtures": [...] }`, one entry per full recording. Each entry has `id`, `file`, `sha256`, `bytes`, `track`, `trackId`, `sessionType`, `sessionTypeCode`, `completedLaps`, `durationMs` (end marker) and `features`:
- `ttZandvoort`: `2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz`, sha256 `4b973ffae797c1bd1a938d1c44037e376393b131bd02280243ae54a451600564`, 42418062 bytes, Zandvoort/26, `timeTrial`/18, 15 laps, 1266710.4776 ms. Features: "15 completed player laps, lap 16 unfinished; lap 1 71.910 s, lap 4 71.081 s, lap 9 73.253 s (invalid)", "one active car, fuel 10.0 kg throughout", "FTLP x4", "15 UID-0 SessionHistory just before SEND".
- `raceSingapore`: `2026-10-28_00-15-04_b3cd07e2790bdcbe.pwrec.gz`, `82de3a428389d036ca3d6d5a0e7f109ca3fc9f87a590387c442199922767bb42`, 8445878 bytes, Singapore/12, `race`/15 (5 laps scheduled), 0 laps, 79458.7947 ms. Features: "20 cars, 1 human (index 19)", "STLG x5, LGOT x1, OVTK x39, COLL x4, PENA x6", "sessionTime stays 0 until lights out", "20 UID-0 SessionHistory just before SEND".
- `menuOnly`: `2026-10-27_22-50-28_5cc4798807ebe7a5.pwrec.gz`, `e9c0515df640c71af6fe76feffd751b40382cf2ff7533cb673e4016f49594ab9`, 4697 bytes, track/type `null`, 0 laps, 2475323.6368 ms. Features: "385 BUTN events only (155 with UID 0), no Session packet".

- [ ] **Step 2: Write the failing tests** (test agent)

```ts
// test-support/fixtures.test.ts
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describeWithFixture, FIXTURES, fixturePath, fixturesDir } from './fixtures.ts';

const ROOT = resolve(import.meta.dirname, '..');
const index = JSON.parse(readFileSync(join(ROOT, 'fixtures/index.json'), 'utf8')) as { fixtures: Array<{ id: string; file: string; sha256: string }> };

describe('fixture paths', () => {
  it('defaults to <repo>/recordings and honours PITWALL_FIXTURES_DIR', () => {
    expect(fixturesDir({})).toBe(join(ROOT, 'recordings'));
    expect(fixturesDir({ PITWALL_FIXTURES_DIR: '/data/fx' })).toBe('/data/fx');
  });
  it('returns the path only when the file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    expect(fixturePath('menuOnly', { PITWALL_FIXTURES_DIR: dir })).toBeUndefined();
    writeFileSync(join(dir, FIXTURES.menuOnly), '');
    expect(fixturePath('menuOnly', { PITWALL_FIXTURES_DIR: dir })).toBe(join(dir, '2026-10-27_22-50-28_5cc4798807ebe7a5.pwrec.gz'));
  });
  it('FIXTURES and fixtures/index.json list the same recordings', () => {
    expect(index.fixtures.map((f) => [f.id, f.file])).toEqual(Object.entries(FIXTURES));
  });
});

const notes: string[] = [];
const info = vi.spyOn(console, 'info').mockImplementation((m: unknown) => { notes.push(String(m)); });
const saved = process.env['PITWALL_FIXTURES_DIR'];
process.env['PITWALL_FIXTURES_DIR'] = mkdtempSync(join(tmpdir(), 'fx-empty-'));
describeWithFixture('ttZandvoort', 'a suite whose fixture is missing', () => {
  it('is skipped, never run', () => { throw new Error('must be skipped'); });
});
if (saved === undefined) delete process.env['PITWALL_FIXTURES_DIR']; else process.env['PITWALL_FIXTURES_DIR'] = saved;
info.mockRestore();
it('prints a note naming the missing file', () => {
  expect(notes).toEqual([expect.stringContaining('2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz')]);
});

for (const f of index.fixtures) {
  describeWithFixture(f.id as keyof typeof FIXTURES, `checksum of ${f.id}`, (path) => {
    it('matches fixtures/index.json', () => {
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(f.sha256);
    });
  });
}
```

```ts
// test/tooling/quality-gates.test.ts
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const depcruise = () => spawnSync('pnpm', ['-s', 'depcruise'], { cwd: ROOT, encoding: 'utf8' });
function withProbe(rel: string, source: string, fn: () => void): void {
  const file = join(ROOT, rel); writeFileSync(file, source);
  try { fn(); } finally { rmSync(file, { force: true }); }
}

describe('dependency-cruiser layer rules', { timeout: 60_000 }, () => {
  it('passes on the clean tree', () => { expect(depcruise().status).toBe(0); });
  it('protocol importing engine fails the build', () => {
    withProbe('packages/protocol/src/probe-layer.ts', "import '../../engine/src/index.ts';\n", () => {
      const r = depcruise();
      expect(r.status).not.toBe(0);
      expect(r.stdout).toContain('protocol-is-leaf');
    });
  });
  it('engine importing bridge fails the build', () => {
    withProbe('packages/engine/src/probe-layer.ts', "import '../../../apps/bridge/src/index.ts';\n", () => {
      expect(depcruise().stdout).toContain('engine-only-protocol-domain');
    });
  });
});

describe('purity lint for engine and strategy', () => {
  const lint = async (rel: string, code: string) =>
    (await new ESLint({ cwd: ROOT }).lintText(code, { filePath: join(ROOT, rel) }))[0]!.messages.map((m) => m.ruleId);
  it('rejects clock and Math.random in engine and strategy', async () => {
    expect(await lint('packages/engine/src/x.ts', 'export const t = Date.now();\n')).toContain('no-restricted-globals');
    expect(await lint('packages/engine/src/x.ts', 'export const t = performance.now();\n')).toContain('no-restricted-globals');
    expect(await lint('packages/strategy/src/x.ts', 'export const r = Math.random();\n')).toContain('no-restricted-properties');
    expect(await lint('packages/engine/src/x.ts', "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n")).toContain('no-restricted-imports');
  });
  it('allows them in the bridge', async () => {
    expect(await lint('apps/bridge/src/x.ts', 'export const t = Date.now() + Math.random();\n')).toEqual([]);
  });
});

describe('workspace constraints', () => {
  it('tsconfig.base.json sets the global compiler flags', () => {
    const o = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions;
    expect(o).toMatchObject({ strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true,
      allowImportingTsExtensions: true, erasableSyntaxOnly: true, verbatimModuleSyntax: true, module: 'nodenext' });
  });
  it.each(['protocol', 'domain', 'contracts', 'engine', 'strategy'].map((p) => `packages/${p}`).concat('apps/bridge'))('%s is an ESM package exporting src/index.ts', (dir) => {
    const pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    expect(pkg).toMatchObject({ type: 'module', exports: { '.': './src/index.ts' } });
    expect(pkg.name).toBe(`@pitwall/${dir === 'apps/bridge' ? 'bridge' : dir.split('/')[1]}`);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run --project root`
Expected: FAIL (`test-support/fixtures.ts`, `eslint.config.js` and `.dependency-cruiser.cjs` missing)

- [ ] **Step 4: Implement `test-support/fixtures.ts`, `eslint.config.js`, `.dependency-cruiser.cjs`** (implementation agent; must not edit test files)

`fixtures.ts`: `FIXTURES` as in the contract (`as const`). `fixturesDir(env)` = `env.PITWALL_FIXTURES_DIR ?? <repo>/recordings`, with the repo root resolved from `import.meta.dirname`. `fixturePath(name, env)` = the joined path when `existsSync` is true, else `undefined`. `describeWithFixture`: when the file is present, `describe(title, () => fn(path))`. When it is missing, `console.info('[fixtures] skipping "<title>": <expected path> not found (set PITWALL_FIXTURES_DIR)')` and `describe.skip(title, () => fn(expectedPath))`. Vitest still collects the body, so `fn` must not do I/O outside `it`.

`eslint.config.js` (`defineConfig` from `eslint/config`): ignores `**/node_modules/`, `external/`, `recordings/`, `**/.stryker-tmp/`, `**/reports/`, `apps/bridge/src/features/index.generated.ts`. Then `js.configs.recommended`, `tseslint.configs.strict`, and the rules `@typescript-eslint/consistent-type-imports: error` and `@typescript-eslint/no-unused-vars: ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }]`. `**/*.cjs` gets `sourceType: 'commonjs'` with globals `module`, `require`. Test code (`**/*.test.ts`, `**/test/**/*.ts`, `test-support/**/*.ts`) turns off `@typescript-eslint/no-non-null-assertion` and `@typescript-eslint/no-explicit-any`, because later tasks' tests use `!` on fixture results. Then the purity block:

```js
{ files: ['packages/engine/src/**/*.ts', 'packages/strategy/src/**/*.ts'], ignores: ['**/*.test.ts'], rules: {
  'no-restricted-globals': ['error', ...['Date', 'performance', 'process', 'setTimeout', 'setInterval', 'fetch'].map((name) =>
    ({ name, message: 'Engine/strategy are pure: no clock, no environment, no I/O (spec 3.4).' }))],
  'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded Rng (engine/src/util/rng.ts).' }],
  'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', 'fs', 'path', 'os', 'net', 'dgram', 'child_process', 'worker_threads'], message: 'Engine/strategy do no I/O.' }] }] } }
```

`.dependency-cruiser.cjs`: a `layer(name, from, allowed)` helper returns `{ name, severity: 'error', from: { path: '^<from>/' }, to: { path: '^(packages|apps)/', pathNot: '^(<from>|<allowed…>)/' } }`. Rules:
- `protocol-is-leaf` (`packages/protocol`, none)
- `domain-is-leaf` (`packages/domain`, none)
- `contracts-only-domain` (allowed: domain)
- `engine-only-protocol-domain` (allowed: protocol, domain)
- `strategy-only-engine-domain` (allowed: engine, domain)
- `ui-only-contracts-domain` (`apps/ui`; allowed: contracts, domain)
- `no-cross-package-relative-import`: from `^(packages|apps)/([^/]+)/src/` to `{ dependencyTypes: ['local'], path: '^(packages|apps)/', pathNot: '^$1/$2/' }`. Production code imports other packages by name. Tests may reach other packages' test builders.
- `no-circular`
- `not-to-unresolvable`: this also catches a workspace import that is missing from `package.json`, through pnpm's strict linking.
- `no-undeclared-dependency`: from `^(packages|apps)/[^/]+/src/` (pathNot `\.test\.ts$`) to `dependencyTypes: ['npm-no-pkg', 'npm-unknown']`.

Options: `doNotFollow: { path: 'node_modules' }`, `exclude: { path: '(^|/)(\\.stryker-tmp|reports)/' }`, `tsPreCompilationDeps: true`, `tsConfig: { fileName: 'tsconfig.json' }`, `enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default'], extensions: ['.ts', '.js'] }`.

- [ ] **Step 5: Run the full gate on the empty scaffold**

Run: `pnpm install && pnpm vitest run --project root && pnpm check && (cd packages/strategy && pnpm mutation)`
Expected: all PASS. The checksum suites run when `recordings/` is present. `pnpm check` prints `✔ no dependency violations found`. Stryker on strategy ends with "No tests were found" and exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json .gitignore vitest.config.ts vitest.acceptance.config.ts \
  eslint.config.js .dependency-cruiser.cjs packages apps fixtures test test-support
git commit -F - <<'EOF'
build: pnpm workspace scaffold with tsc, vitest, eslint, dependency-cruiser and stryker gates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Agent workflow: CLAUDE.md, docs, ADRs, hooks

**Files:**
- Create: `CLAUDE.md`, `docs/architecture.md`, `docs/tasks/_template.md`
- Create: `docs/decisions/0001-stack-and-native-type-stripping.md`, `docs/decisions/0002-fixtures-outside-git.md`, `docs/decisions/0003-shared-domain-package.md`, `docs/decisions/0004-better-sqlite3-over-node-sqlite.md`, `docs/decisions/0005-feature-registry-via-generated-index.md`
- Create: `.claude/settings.json`, `.claude/hooks/lib.sh`, `.claude/hooks/guard-scope.sh`, `.claude/hooks/guard-tests.sh`, `.claude/hooks/typecheck.sh` (all `chmod +x` except `lib.sh`)
- Test: `test/hooks/hooks.test.ts`, `test/docs/agent-docs.test.ts`

**Interfaces:**
- Consumes: Task 1 workspace (root `tsc` in `node_modules/.bin`, the `root` vitest project, per-package `tsconfig.json`).
- Produces (new): the environment variables `PITWALL_WORKER_SCOPE` (colon-separated, repo-relative folders a worker may write, e.g. `packages/protocol:apps/bridge/src/pwrec`) and `PITWALL_PHASE` (`test` | `implement`). Also the task-brief format `docs/tasks/_template.md`, used by the supervisor for every worker.

**Hook contract.** Claude Code passes JSON on stdin with `tool_name`, `cwd` and `tool_input`. Edit, Write and MultiEdit carry `tool_input.file_path`. NotebookEdit carries `tool_input.notebook_path`. Exit 2 blocks a PreToolUse call, and stderr is shown to Claude. For PostToolUse, exit 2 only reports. The scripts parse JSON with `node`, so jq is not needed. The repo root is `$CLAUDE_PROJECT_DIR`, falling back to the payload's `cwd`.

**Limit (write it into CLAUDE.md):** the guards only see the Edit, Write, MultiEdit and NotebookEdit tools. A write through Bash bypasses them. The env vars are per process: in-process subagents inherit the supervisor's environment. So hook-enforced workers are separate `claude` processes, started in their worktree with the env set. After every implement phase, the supervisor also checks that `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support` is empty.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// test/hooks/hooks.test.ts
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const abs = (rel: string) => join(ROOT, rel);
function runHook(script: string, filePath: string, env: Record<string, string> = {}, projectDir = ROOT, toolName = 'Edit') {
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: projectDir, tool_name: toolName, tool_input: { file_path: filePath } });
  const { PITWALL_WORKER_SCOPE: _s, PITWALL_PHASE: _p, ...base } = process.env;
  const r = spawnSync(join(ROOT, '.claude/hooks', script), { input, encoding: 'utf8', env: { ...base, CLAUDE_PROJECT_DIR: projectDir, ...env } });
  return { code: r.status, stderr: r.stderr };
}

describe('settings.json', () => {
  it('wires the three hooks to existing executable scripts', () => {
    const s = JSON.parse(readFileSync(abs('.claude/settings.json'), 'utf8'));
    expect(s.hooks.PreToolUse[0].matcher).toBe('Edit|Write|MultiEdit|NotebookEdit');
    expect(s.hooks.PostToolUse[0].matcher).toBe('Edit|Write|MultiEdit');
    const commands: string[] = [...s.hooks.PreToolUse, ...s.hooks.PostToolUse].flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks.map((h) => h.command));
    expect(commands.map((c) => c.split('/').at(-1))).toEqual(['guard-scope.sh', 'guard-tests.sh', 'typecheck.sh']);
    for (const c of commands) accessSync(abs(c.replace('"$CLAUDE_PROJECT_DIR"/', '')), constants.X_OK);
  });
});

describe('guard-scope.sh', () => {
  const scope = { PITWALL_WORKER_SCOPE: 'packages/protocol:apps/bridge/src/pwrec' };
  it('allows everything when PITWALL_WORKER_SCOPE is unset', () => {
    expect(runHook('guard-scope.sh', abs('packages/engine/src/x.ts')).code).toBe(0);
  });
  it('allows files inside any scope folder', () => {
    expect(runHook('guard-scope.sh', abs('packages/protocol/src/decode.ts'), scope).code).toBe(0);
    expect(runHook('guard-scope.sh', abs('apps/bridge/src/pwrec/reader.ts'), scope).code).toBe(0);
  });
  it('blocks a file outside the scope with exit 2 and a reason', () => {
    const r = runHook('guard-scope.sh', abs('packages/engine/src/x.ts'), scope);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('packages/engine/src/x.ts is outside your task scope (packages/protocol:apps/bridge/src/pwrec)');
  });
  it('does not treat a shared prefix as inside', () => {
    expect(runHook('guard-scope.sh', abs('packages/protocolx/a.ts'), scope).code).toBe(2);
  });
  it('blocks paths outside the repository', () => {
    expect(runHook('guard-scope.sh', '/etc/hosts', scope).code).toBe(2);
  });
  it.each(['packages/protocol/package.json', 'pnpm-lock.yaml', 'packages/domain/src/known.ts', 'packages/contracts/src/topics.ts', 'packages/engine/src/state/engine-state.ts'])(
    'blocks supervisor-owned %s even inside the scope', (rel) => {
      const r = runHook('guard-scope.sh', abs(rel), { PITWALL_WORKER_SCOPE: 'packages:pnpm-lock.yaml' });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('supervisor-owned');
    });
  it('reads notebook_path for NotebookEdit', () => {
    const input = JSON.stringify({ tool_name: 'NotebookEdit', cwd: ROOT, tool_input: { notebook_path: abs('packages/engine/n.ipynb') } });
    const r = spawnSync(abs('.claude/hooks/guard-scope.sh'), { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ...scope } });
    expect(r.status).toBe(2);
  });
});

describe('guard-tests.sh', () => {
  it.each(['packages/protocol/src/decode.test.ts', 'packages/engine/test/builders/scenario.ts', 'test-support/fixtures.ts', 'test/hooks/hooks.test.ts'])(
    'blocks %s when PITWALL_PHASE=implement', (rel) => {
      const r = runHook('guard-tests.sh', abs(rel), { PITWALL_PHASE: 'implement' });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('PITWALL_PHASE=implement');
    });
  it('allows source files in the implement phase and tests in the test phase', () => {
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/decode.ts'), { PITWALL_PHASE: 'implement' }).code).toBe(0);
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/latest.ts'), { PITWALL_PHASE: 'implement' }).code).toBe(0);
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/decode.test.ts'), { PITWALL_PHASE: 'test' }).code).toBe(0);
    expect(runHook('guard-tests.sh', abs('packages/protocol/src/decode.test.ts')).code).toBe(0);
  });
});

describe('typecheck.sh', () => {
  function tempPackage(source: string): { root: string; file: string } {
    const root = mkdtempSync(join(tmpdir(), 'pitwall-hook-'));
    const pkg = join(root, 'packages/demo');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['src'] }));
    writeFileSync(join(pkg, 'src/a.ts'), source);
    return { root, file: join(pkg, 'src/a.ts') };
  }
  it('reports a type error in the touched package with exit 2', () => {
    const { root, file } = tempPackage('export const n: number = "x";\n');
    const r = runHook('typecheck.sh', file, {}, root, 'Write');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('typecheck failed in packages/demo');
    expect(r.stderr).toContain('TS2322');
  });
  it('passes a clean package and ignores non-TS files and files outside a package', () => {
    const { root, file } = tempPackage('export const n: number = 1;\n');
    expect(runHook('typecheck.sh', file, {}, root, 'Write').code).toBe(0);
    expect(runHook('typecheck.sh', join(root, 'packages/demo/README.md'), {}, root, 'Write').code).toBe(0);
    expect(runHook('typecheck.sh', join(root, 'notes.ts'), {}, root, 'Write').code).toBe(0);
  });
});
```

```ts
// test/docs/agent-docs.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('agent docs', () => {
  it('CLAUDE.md is a short map that carries the git rule verbatim', () => {
    const md = read('CLAUDE.md');
    expect(md.trimEnd().split('\n').length).toBeLessThanOrEqual(150);
    expect(md).toContain('Claude manages git: workers commit on their own branches; supervisor may merge to main and push without asking; never force-push main');
    for (const ref of ['docs/architecture.md', 'docs/decisions/', 'docs/tasks/_template.md', 'pnpm check', 'PITWALL_WORKER_SCOPE', 'PITWALL_PHASE', 'PITWALL_FIXTURES_DIR'])
      expect(md).toContain(ref);
  });
  it('has the five ADRs, each with status, context, decision and consequences', () => {
    const adrs = readdirSync(join(ROOT, 'docs/decisions')).filter((f) => f.endsWith('.md')).sort();
    expect(adrs).toEqual(['0001-stack-and-native-type-stripping.md', '0002-fixtures-outside-git.md', '0003-shared-domain-package.md',
      '0004-better-sqlite3-over-node-sqlite.md', '0005-feature-registry-via-generated-index.md']);
    for (const f of adrs) for (const h of ['## Status', '## Context', '## Decision', '## Consequences']) expect(read(`docs/decisions/${f}`), `${f}: ${h}`).toContain(h);
  });
  it('architecture.md states every allowed dependency edge', () => {
    const md = read('docs/architecture.md');
    for (const edge of ['contracts → domain', 'engine → protocol, domain', 'strategy → engine, domain', 'bridge → all packages', 'ui → contracts, domain'])
      expect(md).toContain(edge);
  });
  it('the task template asks for scope, interfaces, tests and the report format', () => {
    const md = read('docs/tasks/_template.md');
    for (const h of ['## Scope', '## Interfaces', '## Tests to pass', '## Phase', '## Report', 'Requested changes to supervisor-owned files']) expect(md).toContain(h);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run --project root test/hooks test/docs`
Expected: FAIL (`.claude/settings.json`, hook scripts and docs missing)

- [ ] **Step 3: Write the hooks** (implementation agent; must not edit test files)

`.claude/settings.json`, exactly:

```json
{ "hooks": {
  "PreToolUse": [{ "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [
    { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard-scope.sh" },
    { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard-tests.sh" } ] }],
  "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [
    { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/typecheck.sh", "timeout": 120 } ] }] } }
```

`lib.sh` (sourced, `set -euo pipefail`):
- reads stdin once into `PAYLOAD`
- `payload_get <dotted.path>` prints a string field, using `node -e`
- sets `PROJECT_DIR`, `TARGET` (`file_path`, else `notebook_path`) and `REL` (`path.relative(PROJECT_DIR, path.resolve(PROJECT_DIR, TARGET))`, empty without a target)
- `block <msg>` prints `pitwall hook: <msg>` to stderr and exits 2

`guard-scope.sh`:
1. Exit 0 when `PITWALL_WORKER_SCOPE` is unset or `REL` is empty.
2. `REL` starting with `..` → block "`<TARGET>` is outside the repository".
3. Supervisor-owned paths are blocked before the scope check: `package.json`, `*/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/domain/*`, `packages/contracts/*`, `packages/engine/src/state/*`. Message: "`<REL>` is supervisor-owned. Do not edit it; list the change under 'Requested changes to supervisor-owned files' in your report."
4. Otherwise allow when `REL` equals a scope entry or starts with `<entry>/` (trailing `/` stripped). Else block: "`<REL>` is outside your task scope (`<PITWALL_WORKER_SCOPE>`). Request the change in your report instead."

`guard-tests.sh`: only when `PITWALL_PHASE=implement`. Block `*.test.ts`, `test/*`, `*/test/*` and `test-support/*` with: "`<REL>` is a test file and PITWALL_PHASE=implement. Make the tests pass without changing them; if a test is wrong, say so in your report."

`typecheck.sh`: skip unless `REL` ends in `.ts` and lies inside the repo. Walk up from the file's directory to the nearest `tsconfig.json` below `PROJECT_DIR`; at the root itself, skip, because root-level files are covered by `pnpm typecheck`. Run `<hook dir>/../../node_modules/.bin/tsc -p <dir>/tsconfig.json --pretty false`. On failure, print `pitwall hook: typecheck failed in <dir relative to root>` and the tsc output to stderr, then exit 2.

- [ ] **Step 4: Write the docs**

- `CLAUDE.md`, at most 150 lines. Sections:
  - **What** (2 lines, links to spec and plan)
  - **Map**: one line per package with its role, and the dependency direction
  - **Commands**: `pnpm check`, `test`, `test:acceptance`, `typecheck`, `lint`, `depcruise`, `mutation`, `gen:features`, `pitwall live|replay|tap|reprocess|import`, `pwrec-cut`
  - **Rules**: the Global Constraints, one line each: units, `Known` instead of 0, no enums/namespaces/parameter properties, `.ts` imports, a pure engine, problems as values, registration by convention, ports from env
  - **Workflow**: test agent, then implementation agent. A worktree per task under `../pitwall-wt/<task>`, with `pnpm install` and `PITWALL_FIXTURES_DIR=<main checkout>/recordings`, because `recordings/` is gitignored and missing in worktrees. Start a worker as `PITWALL_PHASE=<test|implement> PITWALL_WORKER_SCOPE=<folders> claude` from the worktree. Include the Bash-bypass limit and the supervisor diff check above. Supervisor-owned files and how to request changes go here too.
  - **Git**: the verbatim line `Claude manages git: workers commit on their own branches; supervisor may merge to main and push without asking; never force-push main`, conventional commits, and the `Co-Authored-By` trailer
  - **Where to look**: architecture, ADRs, `FORMAT.md`, the UDP structs and PDF
- `docs/architecture.md` (condensed spec 3):
  - packages and roles, with the allowed edges written exactly as `protocol → nothing`, `domain → nothing`, `contracts → domain`, `engine → protocol, domain`, `strategy → engine, domain`, `bridge → all packages`, `ui → contracts, domain`
  - the data-flow diagram of spec 3.2
  - the determinism rules of spec 3.4
  - parallel development of spec 3.3
  - where state lives: engine state, history, calculators, storage
- ADRs (Status, Context, Decision, Consequences):
  - **0001**: TypeScript run by Node type stripping (≥ 22.18), erasable-only syntax, packages export `./src/index.ts`. Workspace links resolve to real paths, because Node refuses to strip types under `node_modules`. TypeScript `~6.0`, not 7, because typescript-eslint and dependency-cruiser need the JS compiler API. `tsc -p` instead of `tsc -b` (TS6310). pnpm 12 installed into `~/.local`, pinned via `packageManager`.
  - **0002**: full recordings stay outside git: `recordings/` is gitignored, located through `fixtures/index.json` with sha256, and override `PITWALL_FIXTURES_DIR`. Not Git LFS, because of bandwidth quotas and because segments suffice. Revisit if full recordings must be versioned.
  - **0003**: shared leaf package `@pitwall/domain` for the JSON-safe vocabulary. User decision 2026-10-28; refines spec 3.1. `contracts` stays wire-only. The UI imports `domain` and `contracts` only.
  - **0004**: `better-sqlite3` over `node:sqlite`, because on Node 22.22 `node:sqlite` still prints `ExperimentalWarning: SQLite is an experimental feature`. better-sqlite3 13 ships prebuilt binaries. Revisit when Node's minimum is a release where `node:sqlite` is stable.
  - **0005**: feature registry via a generated, gitignored `apps/bridge/src/features/index.generated.ts`, written by `scripts/gen-features.ts` in `pretest`, `pretypecheck` and before each bridge start. Rejected: a hand-edited list (merge conflicts) and a runtime glob (invisible to `tsc` and dependency-cruiser).
- `docs/tasks/_template.md`: headings `# Task NN: <name>`, `## Goal`, `## Scope` (the `PITWALL_WORKER_SCOPE` value; everything else is read-only), `## Interfaces` (consumes / produces, copied from the plan), `## Tests to pass` (exact `pnpm vitest run …` commands), `## Phase` (`test`: write and commit failing tests only; `implement`: make them pass, tests read-only), `## Done when` (`pnpm check` green in scope, commit made). Then `## Report` with `### Summary`, `### Tests` (command plus pass/fail counts), `### Requested changes to supervisor-owned files` (file, exact change, why) and `### Open questions`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run --project root test/hooks test/docs && pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/architecture.md docs/decisions docs/tasks .claude/settings.json .claude/hooks test/hooks test/docs
git commit -F - <<'EOF'
docs: agent workflow (CLAUDE.md, architecture, ADRs 0001-0005, task template) and guard hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Protocol schema DSL and codec

**Files:**
- Create: `packages/protocol/src/schema/dsl.ts`, `packages/protocol/src/schema/codec.ts`
- Modify: `packages/protocol/src/index.ts` (export the names below)
- Test: `packages/protocol/test/schema/dsl.test.ts`, `packages/protocol/test/schema/codec.test.ts`

**Interfaces:**
- Consumes: nothing (protocol is a leaf).
- Produces (verbatim from the contract): `Primitive`, `FieldSpec`, `u8`, `i8`, `u16`, `i16`, `u32`, `i32`, `u64`, `f32`, `f64`, `array(item, length)`, `chars(length)`, `splitTime()`, `struct(fields)`, `Infer<S>`, `sizeOf(spec)`, `readField(spec, view, offset)`, `writeField(spec, view, offset, value)`.
- Produces (new, the spec shapes; Task 6's `arbitraryFor` walks them by `kind`):
  ```ts
  type PrimitiveSpec<P extends Primitive = Primitive> = { readonly kind: 'primitive'; readonly type: P };
  type ArraySpec<S extends FieldSpec = FieldSpec> = { readonly kind: 'array'; readonly item: S; readonly length: number };
  type StructSpec<F extends Record<string, FieldSpec> = Record<string, FieldSpec>> = { readonly kind: 'struct'; readonly fields: F };
  type CharsSpec = { readonly kind: 'chars'; readonly length: number };
  type SplitTimeSpec = { readonly kind: 'splitTime' };
  const SPLIT_TIME_MAX_MS = 255 * 60_000 + 59_999;   // 15_359_999
  const SPLIT_TIME_MIN_MS = 60_000 - 65_536;          // -5_536: negative deltas the game writes as u16 msPart >= 60000 with minutes 0
  ```
  `Infer`: `'u64'` → `bigint`, other primitives → `number`, array → `Infer<S>[]`, struct → `{ [K in keyof F]: Infer<F[K]> }`, chars → `string`, splitTime → `number` (ms).

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/protocol/test/schema/dsl.test.ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import { array, chars, f32, f64, i16, i32, i8, sizeOf, splitTime, struct, u16, u32, u64, u8, type Infer } from '../../src/index.ts';

describe('sizeOf', () => {
  it.each([[u8, 1], [i8, 1], [u16, 2], [i16, 2], [u32, 4], [i32, 4], [u64, 8], [f32, 4], [f64, 8]] as const)(
    'primitive %o is %i bytes', (spec, size) => expect(sizeOf(spec)).toBe(size));
  it('arrays multiply, structs are packed (no padding)', () => {
    expect(sizeOf(array(u16, 4))).toBe(8);
    expect(sizeOf(struct({ a: u8, b: f32 }))).toBe(5);
    expect(sizeOf(array(array(u8, 22), 50))).toBe(1100);
  });
  it('nested structs, chars and splitTime', () => {
    expect(sizeOf(chars(32))).toBe(32);
    expect(sizeOf(splitTime())).toBe(3);
    expect(sizeOf(struct({ x: array(struct({ a: u8, b: u16 }), 3), name: chars(32), t: splitTime() }))).toBe(9 + 32 + 3);
    expect(sizeOf(struct({}))).toBe(0);
  });
});

describe('Infer', () => {
  it('maps specs to value types', () => {
    expectTypeOf<Infer<typeof u64>>().toEqualTypeOf<bigint>();
    expectTypeOf<Infer<typeof f32>>().toEqualTypeOf<number>();
    expectTypeOf<Infer<ReturnType<typeof chars>>>().toEqualTypeOf<string>();
    const s = struct({ uid: u64, laps: array(struct({ t: splitTime() }), 2) });
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<{ uid: bigint; laps: { t: number }[] }>();
  });
});
```

```ts
// packages/protocol/test/schema/codec.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { array, chars, f32, f64, i16, i32, i8, readField, splitTime, struct, u16, u32, u64, u8, writeField, type FieldSpec } from '../../src/index.ts';

/** Writes at offset 3 into a buffer pre-filled with 0xAA; returns the bytes written. */
function written<S extends FieldSpec>(spec: S, value: unknown, size: number): number[] {
  const buf = new Uint8Array(3 + size + 2).fill(0xaa);
  writeField(spec, new DataView(buf.buffer), 3, value as never);
  expect([...buf.subarray(0, 3), ...buf.subarray(3 + size)]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa]); // no spill
  return [...buf.subarray(3, 3 + size)];
}
const read = <S extends FieldSpec>(spec: S, bytes: number[]) => readField(spec, new DataView(new Uint8Array([0, 0, 0, ...bytes]).buffer), 3);

describe('primitives are little-endian', () => {
  it.each([
    ['u8', u8, 255, [0xff]], ['i8', i8, -128, [0x80]],
    ['u16', u16, 0x1234, [0x34, 0x12]], ['i16', i16, -2, [0xfe, 0xff]],
    ['u32', u32, 0x01020304, [4, 3, 2, 1]], ['i32', i32, -1, [0xff, 0xff, 0xff, 0xff]],
    ['f32', f32, 1.5, [0, 0, 0xc0, 0x3f]], ['f64', f64, 1.5, [0, 0, 0, 0, 0, 0, 0xf8, 0x3f]],
    ['u64', u64, 0x0102030405060708n, [8, 7, 6, 5, 4, 3, 2, 1]], ['u64 max', u64, 2n ** 64n - 1n, Array(8).fill(0xff)],
  ] as const)('%s', (_n, spec, value, bytes) => {
    expect(written(spec, value, bytes.length)).toEqual(bytes);
    expect(read(spec, [...bytes])).toEqual(value);
  });
  it('u64 decodes to bigint', () => expect(typeof read(u64, [1, 0, 0, 0, 0, 0, 0, 0])).toBe('bigint'));
  it('round-trips any value of every primitive', () => {
    const cases: Array<[FieldSpec, fc.Arbitrary<unknown>]> = [
      [u8, fc.integer({ min: 0, max: 255 })], [i8, fc.integer({ min: -128, max: 127 })],
      [u16, fc.integer({ min: 0, max: 65535 })], [i16, fc.integer({ min: -32768, max: 32767 })],
      [u32, fc.integer({ min: 0, max: 2 ** 32 - 1 })], [i32, fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 })],
      [u64, fc.bigInt({ min: 0n, max: 2n ** 64n - 1n })], [f32, fc.float().map(Math.fround)], [f64, fc.double()],
    ];
    for (const [spec, arb] of cases) {
      fc.assert(fc.property(arb, (v) => {
        const view = new DataView(new ArrayBuffer(16));
        writeField(spec, view, 5, v as never);
        expect(readField(spec, view, 5)).toEqual(v);
      }));
    }
  });
});

describe('splitTime', () => {
  it('83_456 ms = 1 min 23.456 s -> msPart 23456 (u16 LE), minutes 1', () => {
    expect(written(splitTime(), 83_456, 3)).toEqual([0xa0, 0x5b, 0x01]);
    expect(read(splitTime(), [0xa0, 0x5b, 0x01])).toBe(83_456);
  });
  it('minutes 0 with msPart >= 60000 is a negative delta (u16 wrap), seen in raceSingapore', () => {
    expect(read(splitTime(), [0xef, 0xff, 0x00])).toBe(-17);       // 65519 - 65536
    expect(written(splitTime(), -17, 3)).toEqual([0xef, 0xff, 0x00]);
    expect(read(splitTime(), [0x60, 0xea, 0x00])).toBe(-5_536);    // msPart 60000
  });
  it('round-trips SPLIT_TIME_MIN_MS..SPLIT_TIME_MAX_MS', () => fc.assert(fc.property(fc.integer({ min: -5_536, max: 15_359_999 }), (ms) => {
    const view = new DataView(new ArrayBuffer(3));
    writeField(splitTime(), view, 0, ms);
    expect(readField(splitTime(), view, 0)).toBe(ms);
  })));
  it('throws RangeError for negative, fractional or too large values', () => {
    for (const bad of [-5_537, 1.5, 15_360_000]) expect(() => written(splitTime(), bad, 3)).toThrow(RangeError);
  });
});

describe('chars', () => {
  it('writes UTF-8 then NUL padding', () => {
    expect(written(chars(8), 'Max', 8)).toEqual([77, 97, 120, 0, 0, 0, 0, 0]);
    expect(written(chars(8), 'Pérez', 8)).toEqual([0x50, 0xc3, 0xa9, 0x72, 0x65, 0x7a, 0, 0]);
  });
  it('reads up to the first NUL and ignores bytes after it', () => {
    expect(read(chars(8), [0x50, 0, 0x72, 0x65, 0, 0, 0, 0])).toBe('P');
    expect(read(chars(8), [0x50, 0xc3, 0xa9, 0x72, 0x65, 0x7a, 0, 0])).toBe('Pérez');
  });
  it('reads the full field when there is no NUL', () => expect(read(chars(4), [65, 66, 67, 68])).toBe('ABCD'));
  it('throws RangeError when the UTF-8 bytes do not leave room for the NUL', () => {
    expect(() => written(chars(4), 'ABCD', 4)).toThrow(RangeError);
    expect(() => written(chars(4), 'ABé', 4)).toThrow(RangeError);
  });
});

describe('structs and arrays', () => {
  it('writes fields in declaration order', () => {
    expect(written(struct({ b: u16, a: u8 }), { b: 2, a: 1 }, 3)).toEqual([2, 0, 1]);
    expect(read(struct({ b: u16, a: u8 }), [2, 0, 1])).toEqual({ b: 2, a: 1 });
  });
  it('arrays of structs', () => {
    const spec = array(struct({ x: i8, y: u8 }), 2);
    expect(written(spec, [{ x: -1, y: 2 }, { x: 3, y: 4 }], 4)).toEqual([0xff, 2, 3, 4]);
    expect(read(spec, [0xff, 2, 3, 4])).toEqual([{ x: -1, y: 2 }, { x: 3, y: 4 }]);
  });
  it('throws RangeError when an array value has the wrong length', () => {
    expect(() => written(array(u8, 3), [1, 2], 3)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/protocol/test/schema`
Expected: FAIL (`dsl.ts`/`codec.ts` do not exist; imports unresolved)

- [ ] **Step 3: Implement the DSL in `packages/protocol/src/schema/dsl.ts` and `readField`/`writeField` in `packages/protocol/src/schema/codec.ts`** (implementation agent; must not edit test files)

Builders return frozen plain objects of the shapes above (`u8` … `f64` are constants; `splitTime()`/`chars(n)` are functions so every use site reads like the C struct). `readField`/`writeField` are a plain recursive walker over the spec using `DataView` get/set with `littleEndian = true`; struct fields in `Object.keys` order (= declaration order). No code generation (performance is goal 7). `splitTime` writes `msPart = ms % 60000` (u16) then `minutes = Math.floor(ms / 60000)` (u8) for `ms >= 0`, and `msPart = ms + 65536`, `minutes = 0` for negative `ms`; it reads `minutes === 0 && msPart >= 60000` as `msPart - 65536` (the game writes small negative deltas this way; a real ms part is always < 60000). Record this rule in a comment at `splitTime()`; `chars` uses one shared `TextEncoder`/`TextDecoder('utf-8')`. Integers are not range-checked (DataView semantics); only `splitTime`, `chars` and array length throw `RangeError` (a bug in the caller, never an expected problem).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/protocol/test/schema && pnpm typecheck`
Expected: PASS (the `expectTypeOf` assertions are checked by `tsc`)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/schema packages/protocol/src/index.ts packages/protocol/test/schema
git commit -F - <<'EOF'
feat(protocol): add schema DSL and little-endian codec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Header and fixed-size packet schemas

**Files:**
- Create: `packages/protocol/src/header.ts`, `packages/protocol/src/sizes.ts`
- Create (one schema file per packet, event comes in Task 5): `packages/protocol/src/packets/motion.ts`, `session.ts`, `lap-data.ts`, `participants.ts`, `car-setups.ts`, `car-telemetry.ts`, `car-status.ts`, `final-classification.ts`, `lobby-info.ts`, `car-damage.ts`, `session-history.ts`, `tyre-sets.ts`, `motion-ex.ts`, `time-trial.ts`, `lap-positions.ts`, and `packages/protocol/src/packets/index.ts`
- Modify: `packages/protocol/src/index.ts` (export the names below)
- Test: `packages/protocol/test/packets/sizes.test.ts`

**Interfaces:**
- Consumes: Task 3 DSL (`struct`, `array`, `chars`, `splitTime`, primitives, `sizeOf`, `Infer`, `StructSpec`).
- Produces (verbatim): `PACKET_FORMAT = 2025`, `PacketId`, `PacketName`, `headerSchema`, `PacketHeader`, `PACKET_SIZES`; the packet types `MotionPacket`, `SessionPacket`, `LapDataPacket`, `ParticipantsPacket`, `CarSetupsPacket`, `CarTelemetryPacket`, `CarStatusPacket`, `FinalClassificationPacket`, `LobbyInfoPacket`, `CarDamagePacket`, `SessionHistoryPacket`, `TyreSetsPacket`, `MotionExPacket`, `TimeTrialPacket`, `LapPositionsPacket`, each `{ packetId: <literal>; header: PacketHeader } & Infer<typeof <name>BodySchema>`.
- Produces (new):
  ```ts
  const HEADER_SIZE = 29;
  const MAX_CARS = 22;
  // body schema per packet (everything after the header), e.g. motionBodySchema, sessionBodySchema, lapDataBodySchema, …
  // element schemas, e.g. carMotionDataSchema, marshalZoneSchema, weatherForecastSampleSchema, lapDataSchema, participantDataSchema, …
  const PACKET_BODIES: { readonly [N in Exclude<PacketName, 'event'>]: StructSpec };   // packets/index.ts
  ```

**Naming rules** (the C struct file is the source; do not invent or drop fields):
1. Drop `m_`, first letter lower-case. Names without `m_` (`LiveryColour.red/green/blue`) stay as they are.
2. An acronym becomes one capitalised word: `m_sessionUID` → `sessionUid`, `m_engineRPM` → `engineRpm`, `m_maxRPM` → `maxRpm`, `m_lastLapTimeInMS` → `lastLapTimeInMs`, `m_enginePowerICE` → `enginePowerIce`, `m_enginePowerMGUK` → `enginePowerMguk`, `m_ersHarvestedThisLapMGUH` → `ersHarvestedThisLapMguh`, `m_vehicleFIAFlags` → `vehicleFiaFlags`, `m_engineMGUHWear` → `engineMguhWear`, `m_engineESWear` → `engineEsWear`, `m_heightOfCOGAboveGround` → `heightOfCogAboveGround`, `m_timeTrialPBCarIdx` → `timeTrialPbCarIdx`, `m_affectsLicenceLevelMP` → `affectsLicenceLevelMp`. A leading acronym is all lower-case: `m_ERSAssist` → `ersAssist`, `m_DRSAssist` → `drsAssist`.
3. Split times: each `…MSPart` + `…MinutesPart` pair becomes one `…Ms: splitTime()` field at the position of the `MSPart`. The complete list (7 pairs): `LapData`: `sector1TimeMs`, `sector2TimeMs`, `deltaToCarInFrontMs`, `deltaToRaceLeaderMs`; `LapHistoryData`: `sector1TimeMs`, `sector2TimeMs`, `sector3TimeMs`. (`TimeTrialDataSet.m_sector1TimeInMS` etc. are plain `u32` → `sector1TimeInMs`.)
4. C `uint` = `u32`, `float` = `f32`, `double` = `f64`, `char[n]` = `chars(n)`, `uint8[n]`/`float[n]` = `array(…, n)`. Every array is decoded at full length regardless of the `num…` count field next to it (slicing is the engine's job). Wheel arrays stay in game order RL, RR, FL, FR.

**Per packet** (header 29 bytes: `packetFormat u16, gameYear, gameMajorVersion, gameMinorVersion, packetVersion, packetId u8, sessionUid u64, sessionTime f32, frameIdentifier u32, overallFrameIdentifier u32, playerCarIndex u8, secondaryPlayerCarIndex u8`):

| File | Body | Tricky fields |
|---|---|---|
| `motion.ts` | `carMotionData: array(carMotionDataSchema /*60*/, 22)` | `worldForwardDirX…worldRightDirZ` are `i16` |
| `session.ts` | 724 bytes | `trackTemperature`, `airTemperature`, `trackId` are `i8`; `marshalZones: array({ zoneStart f32, zoneFlag i8 } /*5*/, 21)`; `weatherForecastSamples: array(weatherForecastSampleSchema /*8, temps and changes i8*/, 64)`; `weekendStructure: array(u8, 12)`; ends with `sector2LapDistanceStart`, `sector3LapDistanceStart` (f32) |
| `lap-data.ts` | `lapData: array(lapDataSchema /*57*/, 22)`, `timeTrialPbCarIdx`, `timeTrialRivalCarIdx` | four split times (rule 3); `pitLaneTimeInLaneInMs`, `pitStopTimerInMs` are `u16` |
| `participants.ts` | `numActiveCars`, `participants: array(participantDataSchema /*57*/, 22)` | `name: chars(32)`, `techLevel u16`, `liveryColours: array({ red, green, blue }, 4)` |
| `car-setups.ts` | `carSetupData: array(carSetupDataSchema /*50*/, 22)`, `nextFrontWingValue f32` | four separate tyre-pressure floats `rearLeftTyrePressure…frontRightTyrePressure` |
| `car-telemetry.ts` | `carTelemetryData: array(/*60*/, 22)`, `mfdPanelIndex`, `mfdPanelIndexSecondaryPlayer`, `suggestedGear i8` | `gear i8`; `brakesTemperature: array(u16, 4)`, `tyresSurfaceTemperature`/`tyresInnerTemperature`/`surfaceType: array(u8, 4)`, `tyresPressure: array(f32, 4)` |
| `car-status.ts` | `carStatusData: array(/*55*/, 22)` | `vehicleFiaFlags i8` |
| `final-classification.ts` | `numCars`, `classificationData: array(/*46*/, 22)` | `totalRaceTime f64`; `tyreStintsActual`/`tyreStintsVisual`/`tyreStintsEndLaps: array(u8, 8)` |
| `lobby-info.ts` | `numPlayers`, `lobbyPlayers: array(/*42*/, 22)` | `name: chars(32)`, `techLevel u16` |
| `car-damage.ts` | `carDamageData: array(/*46*/, 22)` | `tyresWear: array(f32, 4)`, `tyresDamage`/`brakesDamage`/`tyreBlisters: array(u8, 4)` |
| `session-history.ts` | `carIdx, numLaps, numTyreStints, bestLapTimeLapNum, bestSector1LapNum, bestSector2LapNum, bestSector3LapNum`, `lapHistoryData: array(/*14*/, 100)`, `tyreStintsHistoryData: array({ endLap, tyreActualCompound, tyreVisualCompound }, 8)` | three split times (rule 3) |
| `tyre-sets.ts` | `carIdx`, `tyreSetData: array(/*10*/, 20)`, `fittedIdx` | `lapDeltaTime i16` |
| `motion-ex.ts` | 244 bytes, all `f32` | 4-wheel `array(f32, 4)`: `suspensionPosition`, `suspensionVelocity`, `suspensionAcceleration`, `wheelSpeed`, `wheelSlipRatio`, `wheelSlipAngle`, `wheelLatForce`, `wheelLongForce`, `wheelVertForce`, `wheelCamber`, `wheelCamberGain` |
| `time-trial.ts` | `playerSessionBestDataSet`, `personalBestDataSet`, `rivalDataSet`: `timeTrialDataSetSchema /*24*/` | four `u32` times |
| `lap-positions.ts` | `numLaps`, `lapStart`, `positionForVehicleIdx: array(array(u8, 22), 50)` | outer index = lap, inner = vehicle |

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/protocol/test/packets/sizes.test.ts — the size check against spec 4.3
import { describe, expect, it } from 'vitest';
import * as p from '../../src/index.ts';
const { HEADER_SIZE, PACKET_BODIES, PACKET_FORMAT, PACKET_SIZES, PacketId, headerSchema, sizeOf } = p;

describe('packet sizes (spec 4.3)', () => {
  it('pins the spec table', () => {
    expect(PACKET_SIZES).toEqual({ motion: 1349, session: 753, lapData: 1285, event: 45, participants: 1284, carSetups: 1133,
      carTelemetry: 1352, carStatus: 1239, finalClassification: 1042, lobbyInfo: 954, carDamage: 1041, sessionHistory: 1460,
      tyreSets: 231, motionEx: 273, timeTrial: 101, lapPositions: 1131 });
    expect(PACKET_FORMAT).toBe(2025);
  });
  it('PacketId covers 0..15 in spec order', () => {
    expect(Object.entries(PacketId)).toEqual(Object.keys(PACKET_SIZES).map((name, id) => [name, id]));
  });
  it('header is 29 bytes', () => {
    expect(HEADER_SIZE).toBe(29);
    expect(sizeOf(headerSchema)).toBe(29);
  });
  it('has a body schema for every packet except event', () => {
    expect(Object.keys(PACKET_BODIES).sort()).toEqual(Object.keys(PACKET_SIZES).filter((n) => n !== 'event').sort());
  });
  it.each(Object.entries(PACKET_BODIES))('%s: header + body = PACKET_SIZES', (name, body) => {
    expect(HEADER_SIZE + sizeOf(body)).toBe(PACKET_SIZES[name as keyof typeof PACKET_SIZES]);
  });
  it.each([
    ['carMotionDataSchema', 60], ['marshalZoneSchema', 5], ['weatherForecastSampleSchema', 8], ['lapDataSchema', 57],
    ['participantDataSchema', 57], ['carSetupDataSchema', 50], ['carTelemetryDataSchema', 60], ['carStatusDataSchema', 55],
    ['finalClassificationDataSchema', 46], ['lobbyInfoDataSchema', 42], ['carDamageDataSchema', 46], ['lapHistoryDataSchema', 14],
    ['tyreStintHistoryDataSchema', 3], ['tyreSetDataSchema', 10], ['timeTrialDataSetSchema', 24],
  ] as const)('element %s is %i bytes', (name, size) => {
    expect(sizeOf(p[name])).toBe(size);
  });
  it('replaces every MSPart/MinutesPart pair with one splitTime field', () => {
    const kinds = (s: p.StructSpec) => Object.fromEntries(Object.entries(s.fields).map(([k, f]) => [k, f.kind]));
    expect(kinds(p.lapDataSchema)).toMatchObject({ sector1TimeMs: 'splitTime', sector2TimeMs: 'splitTime',
      deltaToCarInFrontMs: 'splitTime', deltaToRaceLeaderMs: 'splitTime' });
    expect(kinds(p.lapHistoryDataSchema)).toMatchObject({ sector1TimeMs: 'splitTime', sector2TimeMs: 'splitTime', sector3TimeMs: 'splitTime' });
    const all = JSON.stringify([headerSchema, PACKET_BODIES]);
    expect(all).not.toMatch(/MSPart|MinutesPart|"m_/);
  });
  it('uses camelCase acronyms', () => {
    expect(Object.keys(headerSchema.fields)).toEqual(['packetFormat', 'gameYear', 'gameMajorVersion', 'gameMinorVersion',
      'packetVersion', 'packetId', 'sessionUid', 'sessionTime', 'frameIdentifier', 'overallFrameIdentifier', 'playerCarIndex', 'secondaryPlayerCarIndex']);
    expect(Object.keys(p.carStatusDataSchema.fields)).toEqual(expect.arrayContaining(['vehicleFiaFlags', 'enginePowerIce', 'enginePowerMguk', 'ersHarvestedThisLapMguh']));
    expect(Object.keys(p.sessionBodySchema.fields)).toEqual(expect.arrayContaining(['ersAssist', 'drsAssist', 'affectsLicenceLevelMp']));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/protocol/test/packets/sizes.test.ts`
Expected: FAIL (`PACKET_SIZES`, `headerSchema`, `PACKET_BODIES` not exported)

- [ ] **Step 3: Write `header.ts`, `sizes.ts` and the 15 packet schema files** (implementation agent; must not edit test files)

Transcribe each C struct field by field, in order, using the rules above; export the element schema (`<structName>Schema`), the body schema (`<packetName>BodySchema`) and the packet type. `PACKET_SIZES` is the literal table (it is the spec, not computed). `packets/index.ts` builds `PACKET_BODIES` from the 15 body schemas. `PacketId`/`PacketName` live in `header.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/protocol/test/packets && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src packages/protocol/test/packets
git commit -F - <<'EOF'
feat(protocol): add header and packet schemas for F1 25 format 2025

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Event packet and event details

**Files:**
- Create: `packages/protocol/src/events.ts` (codes, detail schemas, `EventDetails`), `packages/protocol/src/packets/event.ts` (`EventPacket`, body read/write)
- Modify: `packages/protocol/src/index.ts` (export the names below)
- Test: `packages/protocol/test/packets/event.test.ts`

**Interfaces:**
- Consumes: Task 3 DSL; `PacketHeader`, `HEADER_SIZE`, `PACKET_SIZES` (Task 4).
- Produces (verbatim): `EVENT_CODES`, `EventCode`, `EventDetails`, `EventPacket = { packetId: 3; header: PacketHeader; details: EventDetails }`.
- Produces (new):
  ```ts
  const EVENT_DETAILS_LENGTH = 12;                                   // 45 − 29 − 4
  const EVENT_DETAILS_SCHEMAS: { readonly [C in EventCode]: StructSpec };
  type EventDetails = { [C in EventCode]: { code: C } & Infer<(typeof EVENT_DETAILS_SCHEMAS)[C]> }[EventCode];
  type EventDetailsOf<C extends EventCode> = Extract<EventDetails, { code: C }>;
  function isEventCode(code: string): code is EventCode;
  function readEventBody(view: DataView, offset: number): { ok: true; details: EventDetails } | { ok: false; code: string };  // offset = start of the 4-char code
  function writeEventBody(view: DataView, offset: number, details: EventDetails): void;   // writes code + details, zero-fills to 16 bytes
  ```

**Variants** (field names are the C union's, which carry no `m_`; all `u8` unless noted):

| Code | Fields |
|---|---|
| `SSTA`, `SEND`, `DRSE`, `CHQF`, `LGOT`, `RDFL` | none (`{ code }`) |
| `FTLP` | `vehicleIdx`, `lapTime` f32 (s) |
| `RTMT` | `vehicleIdx`, `reason` |
| `DRSD` | `reason` |
| `TMPT`, `RCWN`, `DTSV` | `vehicleIdx` |
| `PENA` | `penaltyType`, `infringementType`, `vehicleIdx`, `otherVehicleIdx`, `time`, `lapNum`, `placesGained` |
| `SPTP` | `vehicleIdx`, `speed` f32, `isOverallFastestInSession`, `isDriverFastestInSession`, `fastestVehicleIdxInSession`, `fastestSpeedInSession` f32 (12 bytes, the largest) |
| `STLG` | `numLights` |
| `SGSV` | `vehicleIdx`, `stopTime` f32 |
| `FLBK` | `flashbackFrameIdentifier` u32, `flashbackSessionTime` f32 |
| `BUTN` | `buttonStatus` u32 |
| `OVTK` | `overtakingVehicleIdx`, `beingOvertakenVehicleIdx` |
| `SCAR` | `safetyCarType`, `eventType` |
| `COLL` | `vehicle1Idx`, `vehicle2Idx` |

The code is 4 ASCII bytes (`String.fromCharCode` per byte, no UTF-8). Decoding ignores detail bytes past the variant's size; encoding writes zeros there (no event in the three recordings has non-zero padding).

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/protocol/test/packets/event.test.ts
import { describe, expect, it } from 'vitest';
import { EVENT_CODES, EVENT_DETAILS_LENGTH, EVENT_DETAILS_SCHEMAS, isEventCode, readEventBody, sizeOf, writeEventBody,
  type EventDetails } from '../../src/index.ts';

const f32 = Math.fround;
const SAMPLES: EventDetails[] = [
  { code: 'SSTA' }, { code: 'SEND' }, { code: 'FTLP', vehicleIdx: 3, lapTime: f32(71.91) }, { code: 'RTMT', vehicleIdx: 4, reason: 8 },
  { code: 'DRSE' }, { code: 'DRSD', reason: 1 }, { code: 'TMPT', vehicleIdx: 19 }, { code: 'CHQF' }, { code: 'RCWN', vehicleIdx: 0 },
  { code: 'PENA', penaltyType: 1, infringementType: 2, vehicleIdx: 3, otherVehicleIdx: 4, time: 5, lapNum: 6, placesGained: 7 },
  { code: 'SPTP', vehicleIdx: 19, speed: f32(318.5), isOverallFastestInSession: 1, isDriverFastestInSession: 1, fastestVehicleIdxInSession: 19, fastestSpeedInSession: f32(318.5) },
  { code: 'STLG', numLights: 5 }, { code: 'LGOT' }, { code: 'DTSV', vehicleIdx: 2 }, { code: 'SGSV', vehicleIdx: 2, stopTime: f32(10.5) },
  { code: 'FLBK', flashbackFrameIdentifier: 123_456, flashbackSessionTime: f32(1234.5) }, { code: 'BUTN', buttonStatus: 0x0010_0001 },
  { code: 'RDFL' }, { code: 'OVTK', overtakingVehicleIdx: 7, beingOvertakenVehicleIdx: 8 }, { code: 'SCAR', safetyCarType: 2, eventType: 0 },
  { code: 'COLL', vehicle1Idx: 1, vehicle2Idx: 19 },
];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
function body(details: EventDetails): Uint8Array {
  const buf = new Uint8Array(16).fill(0xaa);
  writeEventBody(new DataView(buf.buffer), 0, details);
  return buf;
}

describe('event codes', () => {
  it('has the 21 codes of the spec, each with a details schema of at most 12 bytes', () => {
    expect(EVENT_CODES).toHaveLength(21);
    expect(EVENT_DETAILS_LENGTH).toBe(12);
    expect(Object.keys(EVENT_DETAILS_SCHEMAS).sort()).toEqual([...EVENT_CODES].sort());
    for (const code of EVENT_CODES) expect(sizeOf(EVENT_DETAILS_SCHEMAS[code])).toBeLessThanOrEqual(12);
    expect(sizeOf(EVENT_DETAILS_SCHEMAS.SPTP)).toBe(12);
    expect(SAMPLES.map((s) => s.code)).toEqual(EVENT_CODES);
  });
  it('isEventCode', () => {
    expect(isEventCode('FLBK')).toBe(true);
    expect(isEventCode('flbk')).toBe(false);
    expect(isEventCode('ABCD')).toBe(false);
  });
});

describe('event body', () => {
  it.each(SAMPLES.map((s) => [s.code, s] as const))('%s round-trips', (_c, details) => {
    const buf = body(details);
    expect(readEventBody(new DataView(buf.buffer), 0)).toEqual({ ok: true, details });
  });
  it('writes the code as 4 ASCII bytes and zero-pads the 12 detail bytes', () => {
    expect([...body({ code: 'SSTA' })]).toEqual([...ascii('SSTA'), ...Array(12).fill(0)]);
    const ftlp = body({ code: 'FTLP', vehicleIdx: 3, lapTime: f32(71.91) });
    const lap = new Uint8Array(new Float32Array([71.91]).buffer);   // platform LE
    expect([...ftlp]).toEqual([...ascii('FTLP'), 3, ...lap, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('lays out PENA bytes in declaration order', () => {
    expect([...body(SAMPLES[9]!).subarray(4, 12)]).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
  });
  it('writes FLBK frame id as u32 LE', () => {
    expect([...body({ code: 'FLBK', flashbackFrameIdentifier: 0x01020304, flashbackSessionTime: 0 }).subarray(4, 8)]).toEqual([4, 3, 2, 1]);
  });
  it('ignores bytes past the variant when reading', () => {
    const buf = new Uint8Array([...ascii('BUTN'), 1, 0, 0, 0, ...Array(8).fill(0xff)]);
    expect(readEventBody(new DataView(buf.buffer), 0)).toEqual({ ok: true, details: { code: 'BUTN', buttonStatus: 1 } });
  });
  it('reads at an offset (the code starts at byte 29 of the packet)', () => {
    const buf = new Uint8Array(45);
    writeEventBody(new DataView(buf.buffer), 29, { code: 'STLG', numLights: 3 });
    expect([...buf.subarray(29, 34)]).toEqual([...ascii('STLG'), 3]);
    expect(readEventBody(new DataView(buf.buffer), 29)).toEqual({ ok: true, details: { code: 'STLG', numLights: 3 } });
  });
  it('reports an unknown code instead of throwing', () => {
    const buf = new Uint8Array([...ascii('ABCD'), ...Array(12).fill(0)]);
    expect(readEventBody(new DataView(buf.buffer), 0)).toEqual({ ok: false, code: 'ABCD' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/protocol/test/packets/event.test.ts`
Expected: FAIL (`EVENT_CODES`, `readEventBody` not exported)

- [ ] **Step 3: Implement `events.ts` and `packets/event.ts`** (implementation agent; must not edit test files)

`EVENT_DETAILS_SCHEMAS` is one `struct({...})` per code (`struct({})` for codes without details), declared `as const satisfies`-style so `EventDetails` is derived from it and narrows on `code`. `readEventBody`/`writeEventBody` reuse `readField`/`writeField` on `EVENT_DETAILS_SCHEMAS[code]` at `offset + 4`; `writeEventBody` zero-fills `offset + 4 … offset + 16` first.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/protocol/test/packets && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src packages/protocol/test/packets/event.test.ts
git commit -F - <<'EOF'
feat(protocol): decode and encode event packets for all 21 event codes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: `decode`/`encode`, round trip, real packets

> **Ordering:** Steps 1–4 (protocol unit and property tests) only need Tasks 3–5 and can run as soon as Task 5 is merged. Steps 5–7 (real-packet test) use `readPwrec` from Task 7 and run after Task 7 is merged. The real-packet test lives in `apps/bridge/test` because `protocol` must not import from `bridge` (dependency rule).

**Files:**
- Create: `packages/protocol/src/packet.ts` (`Packet`, `PacketOf`), `packages/protocol/src/decode.ts` (`decode`, `peekHeader`, `DecodeError`, `DecodeResult`), `packages/protocol/src/encode.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/arbitraries.ts` (test support), `packages/protocol/test/decode.test.ts`, `apps/bridge/test/protocol/real-packets.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5 (`readField`, `writeField`, `headerSchema`, `HEADER_SIZE`, `PACKET_BODIES`, `PACKET_SIZES`, `PacketId`, `PACKET_FORMAT`, `readEventBody`, `writeEventBody`, `EVENT_CODES`, `EVENT_DETAILS_SCHEMAS`, `SPLIT_TIME_MAX_MS`, `SPLIT_TIME_MIN_MS`); Task 7 `readPwrec`; Task 1 `describeWithFixture`, `fixturePath`.
- Produces (verbatim): `Packet`, `PacketOf<N>`, `DecodeResult`, `decode(bytes)`, `encode(packet)`, `peekHeader(bytes)`.
- Produces (extends contract): `DecodeError` gains `| { kind: 'unknownEventCode'; code: string }` (an event packet whose 4-char code is not in `EVENT_CODES`, e.g. from a future game patch — an expected problem, so a value).
- Produces (test support): `arbitraryFor<S extends FieldSpec>(spec: S): fc.Arbitrary<Infer<S>>`, `arbitraryEventDetails(): fc.Arbitrary<EventDetails>`, `arbitraryPacket<N extends PacketName>(name: N): fc.Arbitrary<PacketOf<N>>` in `packages/protocol/test/arbitraries.ts` (Task 12 may import them).

Check order in `decode`: `length < 29` → `truncated`; `packetFormat !== 2025` → `wrongFormat` (before the size check, so an F1 24 packet of any size yields the hint); `packetId > 15` → `unknownPacketId`; `length !== PACKET_SIZES[name]` → `sizeMismatch`; unknown event code → `unknownEventCode`.

- [ ] **Step 1: Write the arbitraries and the failing tests** (test agent)

```ts
// packages/protocol/test/arbitraries.ts
import fc from 'fast-check';
import { EVENT_CODES, EVENT_DETAILS_SCHEMAS, PACKET_BODIES, PACKET_FORMAT, PacketId, SPLIT_TIME_MAX_MS, SPLIT_TIME_MIN_MS, headerSchema,
  type EventDetails, type FieldSpec, type Infer, type PacketName, type PacketOf } from '../src/index.ts';

const INT = { u8: [0, 255], i8: [-128, 127], u16: [0, 65535], i16: [-32768, 32767], u32: [0, 2 ** 32 - 1], i32: [-(2 ** 31), 2 ** 31 - 1] } as const;
const utf8 = new TextEncoder();

export function arbitraryFor<S extends FieldSpec>(spec: S): fc.Arbitrary<Infer<S>> {
  const s: FieldSpec = spec;
  const arb = ((): fc.Arbitrary<unknown> => {
    switch (s.kind) {
      case 'primitive': {
        const t = s.type;
        if (t === 'u64') return fc.bigInt({ min: 0n, max: 2n ** 64n - 1n });
        if (t === 'f32') return fc.float().map(Math.fround);   // f32-representable, incl. NaN/-0/±Infinity
        if (t === 'f64') return fc.double();
        return fc.integer({ min: INT[t][0], max: INT[t][1] });
      }
      case 'array': return fc.array(arbitraryFor(s.item), { minLength: s.length, maxLength: s.length });
      case 'struct': return fc.record(Object.fromEntries(Object.entries(s.fields).map(([k, f]) => [k, arbitraryFor(f)])));
      case 'chars': return fc.string({ unit: 'grapheme', maxLength: 8 }).filter((v) => !v.includes('\0') && utf8.encode(v).length < s.length);
      case 'splitTime': return fc.integer({ min: SPLIT_TIME_MIN_MS, max: SPLIT_TIME_MAX_MS });
    }
  })();
  return arb as fc.Arbitrary<Infer<S>>;
}

export const arbitraryEventDetails = (): fc.Arbitrary<EventDetails> =>
  fc.constantFrom(...EVENT_CODES).chain((code) => arbitraryFor(EVENT_DETAILS_SCHEMAS[code]).map((f) => ({ code, ...f }) as EventDetails));

export function arbitraryPacket<N extends PacketName>(name: N): fc.Arbitrary<PacketOf<N>> {
  const header = arbitraryFor(headerSchema).map((h) => ({ ...h, packetFormat: PACKET_FORMAT, packetId: PacketId[name] }));
  const body: fc.Arbitrary<object> = name === 'event' ? arbitraryEventDetails().map((details) => ({ details })) : arbitraryFor(PACKET_BODIES[name as Exclude<N, 'event'>]);
  return fc.tuple(header, body).map(([h, b]) => ({ packetId: PacketId[name], header: h, ...b }) as unknown as PacketOf<N>);
}
```

```ts
// packages/protocol/test/decode.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PACKET_SIZES, PacketId, decode, encode, peekHeader, type PacketName } from '../src/index.ts';
import { arbitraryPacket } from './arbitraries.ts';

function raw(packetId: number, length: number, format = 2025): Uint8Array {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  if (length >= 2) view.setUint16(0, format, true);
  if (length >= 7) view.setUint8(6, packetId);
  return bytes;
}

describe('decode errors are values', () => {
  it('truncated below 29 bytes', () => {
    expect(decode(new Uint8Array(0))).toEqual({ ok: false, error: { kind: 'truncated', length: 0 } });
    expect(decode(raw(2, 28))).toEqual({ ok: false, error: { kind: 'truncated', length: 28 } });
  });
  it('wrongFormat carries the received format, checked before the size', () => {
    expect(decode(raw(2, 1285, 2024))).toEqual({ ok: false, error: { kind: 'wrongFormat', format: 2024 } });
    expect(decode(raw(2, 1239, 2024))).toEqual({ ok: false, error: { kind: 'wrongFormat', format: 2024 } });
  });
  it('unknownPacketId', () => {
    expect(decode(raw(16, 100))).toEqual({ ok: false, error: { kind: 'unknownPacketId', packetId: 16 } });
  });
  it('sizeMismatch in both directions', () => {
    expect(decode(raw(2, 1284))).toEqual({ ok: false, error: { kind: 'sizeMismatch', packetId: 2, expected: 1285, actual: 1284 } });
    expect(decode(raw(3, 46))).toEqual({ ok: false, error: { kind: 'sizeMismatch', packetId: 3, expected: 45, actual: 46 } });
  });
  it('unknownEventCode', () => {
    const bytes = raw(3, 45);
    bytes.set([65, 66, 67, 68], 29);
    expect(decode(bytes)).toEqual({ ok: false, error: { kind: 'unknownEventCode', code: 'ABCD' } });
  });
  it('a zero body decodes', () => {
    const r = decode(raw(15, 1131));
    expect(r.ok && r.packet.packetId).toBe(15);
  });
});

describe('round trip', () => {
  it.each(Object.keys(PacketId) as PacketName[])('%s: encode is exactly PACKET_SIZES long and decode inverts it', (name) => {
    fc.assert(fc.property(arbitraryPacket(name), (packet) => {
      const bytes = encode(packet);
      expect(bytes.length).toBe(PACKET_SIZES[name]);
      expect(decode(bytes)).toEqual({ ok: true, packet });
    }), { numRuns: 40 });
  });
  it('decodes a view with a non-zero byteOffset (records are views into a chunk)', () => {
    const [packet] = fc.sample(arbitraryPacket('carTelemetry'), { numRuns: 1, seed: 7 });
    const bytes = encode(packet!);
    const padded = new Uint8Array(bytes.length + 7);
    padded.set(bytes, 7);
    expect(decode(padded.subarray(7))).toEqual({ ok: true, packet });
  });
});

describe('peekHeader', () => {
  it('is undefined below 29 bytes', () => expect(peekHeader(new Uint8Array(28))).toBeUndefined());
  it('reads the header without validating format, id or size', () => {
    const bytes = raw(16, 29, 2024);
    new DataView(bytes.buffer).setBigUint64(7, 0xb3cd07e2790bdcben, true);
    expect(peekHeader(bytes)).toMatchObject({ packetFormat: 2024, packetId: 16, sessionUid: 12956020372289608894n });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/protocol/test/decode.test.ts`
Expected: FAIL (`decode`, `encode`, `peekHeader` not exported)

- [ ] **Step 3: Implement `decode`, `encode`, `peekHeader`, `Packet`, `PacketOf`** (implementation agent; must not edit test files)

`DataView` over `(bytes.buffer, bytes.byteOffset, bytes.byteLength)`. Packet name from id via an id-indexed array derived from `PacketId`. `decode` builds `{ packetId, header, ...body }` (event: `{ packetId: 3, header, details }`); `encode` allocates `PACKET_SIZES[name]` bytes and writes header then body. `PacketOf<N> = Extract<Packet, { packetId: (typeof PacketId)[N] }>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/protocol` — Expected: PASS. Commit (Step 7) may happen here for the protocol part.

- [ ] **Step 5: Write the real-packet test** (test agent, after Task 7 is merged)

Fixture facts (verified with a throwaway scan of the recording): 24 726 datagrams, all format 2025 and correctly sized; 795 LapData datagrams carry `deltaToCarInFront`/`deltaToRaceLeader` with `msPart` 65 486–65 520 and `minutes` 0 (a negative delta written as u16 by the game). Task 3 decodes these as negative ms (−50…−16) and encodes them back the same way, so **every** datagram re-encodes byte-identically.

```ts
// apps/bridge/test/protocol/real-packets.test.ts
import { expect, it } from 'vitest';
import { decode, encode, type Packet } from '@pitwall/protocol';
import { describeWithFixture, fixturePath } from '../../../../test-support/fixtures.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

describeWithFixture('raceSingapore', 'real packets: raceSingapore', () => {
  it('every datagram decodes and re-encodes byte-identically', async () => {
    const perId = new Map<number, number>();
    const events = new Map<string, number>();
    const changed: number[] = [];
    let negativeDeltas = 0;
    let total = 0, firstSession: Packet | undefined, firstParticipants: Packet | undefined;
    for await (const record of readPwrec(fixturePath('raceSingapore')!)) {
      total++;
      const r = decode(record.payload);
      if (!r.ok) throw new Error(`datagram ${total}: ${JSON.stringify(r.error)}`);
      const p = r.packet;
      perId.set(p.packetId, (perId.get(p.packetId) ?? 0) + 1);
      if (p.packetId === 3) events.set(p.details.code, (events.get(p.details.code) ?? 0) + 1);
      firstSession ??= p.packetId === 1 ? p : undefined;
      firstParticipants ??= p.packetId === 4 ? p : undefined;
      const again = encode(p);
      if (!equalBytes(again, record.payload)) changed.push(p.packetId);
      if (p.packetId === 2 && p.lapData.some((c) => c.deltaToCarInFrontMs < 0 || c.deltaToRaceLeaderMs < 0)) negativeDeltas++;
    }
    expect(total).toBe(24_726);
    expect(Object.fromEntries(perId)).toEqual({ 0: 4137, 1: 139, 2: 4137, 3: 231, 4: 15, 5: 139, 6: 4137, 7: 4137, 10: 691, 11: 1376, 12: 1380, 13: 4137, 15: 70 });
    expect(Object.fromEntries(events)).toEqual({ BUTN: 154, SSTA: 1, STLG: 5, LGOT: 1, OVTK: 39, SPTP: 20, COLL: 4, PENA: 6, SEND: 1 });
    expect(changed).toEqual([]);
    expect(negativeDeltas).toBe(795);
    expect(firstSession).toMatchObject({ header: { sessionUid: 12956020372289608894n }, trackId: 12, sessionType: 15, totalLaps: 5, trackLength: 4928 });
    expect(firstParticipants).toMatchObject({ header: { playerCarIndex: 19 }, numActiveCars: 20 });
    if (firstParticipants?.packetId !== 4) throw new Error('no participants');
    expect(firstParticipants.participants.map((d) => d.aiControlled).slice(0, 20)).toEqual([...Array(19).fill(1), 0]);
  }, 60_000);
});
```

- [ ] **Step 6: Run it** — `pnpm vitest run apps/bridge/test/protocol` — Expected: PASS with the fixture present (it is skipped with a note otherwise). No implementation step: a failure here is a schema transcription bug in Task 4/5; fix it there.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol apps/bridge/test/protocol
git commit -F - <<'EOF'
feat(protocol): add decode/encode with result values and real-packet round trip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: `.pwrec` parser, reader, writer

**Files:**
- Create: `apps/bridge/src/pwrec/parser.ts`, `apps/bridge/src/pwrec/reader.ts`, `apps/bridge/src/pwrec/writer.ts`, `apps/bridge/src/pwrec/types.ts`
- Test: `apps/bridge/test/pwrec/helpers.ts` (test support), `apps/bridge/test/pwrec/parser.test.ts`, `apps/bridge/test/pwrec/reader-writer.test.ts`, `apps/bridge/test/pwrec/fixtures.test.ts`

**Interfaces:**
- Consumes: Task 1 `describeWithFixture`, `fixturePath`. Format: `~/dev/personal/pitwall-recorder/FORMAT.md` (spec 4.2).
- Produces (verbatim): `PwrecMeta`, `PwrecRecord`, `PwrecError`, `PwrecParser`, `readPwrec(path)`, `PwrecSummary`, `PwrecWriter`.
- Produces (new): `class PwrecFormatError extends Error { readonly error: PwrecError }` (thrown by `readPwrec`; declare the field, no parameter property).
- Produces (extends contract): `PwrecWriter.create(path: string, meta: PwrecMeta, opts?: { onError?: (e: unknown) => void })` — reports async file errors as they happen (Task 27 raises `system.pwrecWriteFailed` from it); `close()` also rejects with the first error.

Rules pinned here: header `PWREC`·u8 1·u32 n·JSON; meta must be a JSON object with string `recorderVersion`, string `startedAt`, number `listenPort`, else `badMeta`; unknown meta fields are kept. Records: u8 kind·f64 t·u16 len·payload, little-endian. Only kind 0 is returned; kind 255 ends the stream (`durationMs = t`, later bytes ignored); other kinds are skipped by `len`. An incomplete header at `finish()` sets `error = { kind: 'badMeta' }`. After any error `push` returns `[]`. Returned payloads stay valid after later pushes (the parser never writes into memory it has handed out). Writer: header written and sync-flushed in `create`; after writing a record, sync-flush when `Math.floor(t / 1000)` is above the last flushed second; `close(durationMs)` appends kind 255 with `t = durationMs`, ends gzip, resolves when the file is closed; `write` after `close` throws.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/pwrec/helpers.ts — builds .pwrec byte streams and drains readPwrec in tests
import { readPwrec } from '../../src/pwrec/reader.ts';

const enc = new TextEncoder();
export const META = { recorderVersion: '0.1.0', startedAt: '2026-10-27T21:50:28.331Z', listenPort: 20777 };
export function pwrecHeader(meta: unknown = META, o: { magic?: string; version?: number; json?: string } = {}): Uint8Array {
  const json = enc.encode(o.json ?? JSON.stringify(meta));
  const out = new Uint8Array(10 + json.length);
  out.set(enc.encode(o.magic ?? 'PWREC'), 0);
  out[5] = o.version ?? 1;
  new DataView(out.buffer).setUint32(6, json.length, true);
  out.set(json, 10);
  return out;
}
export function pwrecRecord(kind: number, t: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(11 + payload.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, kind); v.setFloat64(1, t, true); v.setUint16(9, payload.length, true);
  out.set(payload, 11);
  return out;
}
export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};
export async function drain(path: string) {
  const it = readPwrec(path);
  const records = [];
  for (;;) { const r = await it.next(); if (r.done) return { records, summary: r.value }; records.push(r.value); }
}
```

```ts
// apps/bridge/test/pwrec/parser.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PwrecParser } from '../../src/pwrec/parser.ts';
import { META, concat, pwrecHeader, pwrecRecord } from './helpers.ts';

const p = (...b: number[]) => new Uint8Array(b);
const STREAM = concat(pwrecHeader(), pwrecRecord(0, 0.5, p(1, 2, 3)), pwrecRecord(7, 1, p(9, 9, 9, 9, 9)),
  pwrecRecord(0, 16.25, p(4)), pwrecRecord(0, 16.25, p()), pwrecRecord(255, 5000.5));
const EXPECTED = [{ kind: 0, t: 0.5, payload: p(1, 2, 3) }, { kind: 0, t: 16.25, payload: p(4) }, { kind: 0, t: 16.25, payload: p() }];

describe('PwrecParser', () => {
  it('parses header and datagrams, skips unknown kinds by len, ends on kind 255', () => {
    const parser = new PwrecParser();
    expect(parser.push(STREAM)).toEqual(EXPECTED);
    expect(parser.meta).toEqual(META);
    expect(parser.error).toBeUndefined();
    expect(parser.finish()).toEqual({ endedCleanly: true, durationMs: 5000.5, truncatedBytes: 0 });
  });
  it('gives the same result for any chunking', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: STREAM.length - 1 }), { maxLength: 12 }), (cuts) => {
      const parser = new PwrecParser();
      const bounds = [0, ...[...cuts].sort((a, b) => a - b), STREAM.length];
      const out = bounds.slice(1).flatMap((end, i) => parser.push(STREAM.slice(bounds[i], end)));
      expect(out).toEqual(EXPECTED);
      expect(parser.finish()).toEqual({ endedCleanly: true, durationMs: 5000.5, truncatedBytes: 0 });
    }));
  });
  it('keeps returned payloads intact after later pushes', () => {
    const parser = new PwrecParser();
    const first = parser.push(STREAM.slice(0, 120));
    parser.push(STREAM.slice(120));
    expect(first[0]?.payload).toEqual(p(1, 2, 3));
  });
  it('ignores bytes after the end record', () => {
    const parser = new PwrecParser();
    expect(parser.push(concat(STREAM, pwrecRecord(0, 6000, p(8))))).toEqual(EXPECTED);
  });
  it('treats an incomplete last record as the end and keeps earlier records', () => {
    const parser = new PwrecParser();
    const cut = pwrecRecord(0, 2, p(4, 5, 6));
    expect(parser.push(concat(pwrecHeader(), pwrecRecord(0, 1, p(1, 2, 3)), cut.subarray(0, 5)))).toEqual([{ kind: 0, t: 1, payload: p(1, 2, 3) }]);
    expect(parser.finish()).toEqual({ endedCleanly: false, truncatedBytes: 5 });
    const mid = new PwrecParser();
    mid.push(concat(pwrecHeader(), pwrecRecord(0, 2, new Uint8Array(20)).subarray(0, 24)));
    expect(mid.finish()).toEqual({ endedCleanly: false, truncatedBytes: 24 });
  });
  it('rejects a bad magic', () => {
    const parser = new PwrecParser();
    expect(parser.push(concat(pwrecHeader(META, { magic: 'PWREX' }), pwrecRecord(0, 1, p(1))))).toEqual([]);
    expect(parser.error).toEqual({ kind: 'badMagic' });
    expect(parser.push(pwrecRecord(0, 2, p(1)))).toEqual([]);
  });
  it('rejects version 2', () => {
    const parser = new PwrecParser();
    parser.push(pwrecHeader(META, { version: 2 }));
    expect(parser.error).toEqual({ kind: 'badVersion', version: 2 });
  });
  it.each([['invalid JSON', { json: '{"recorderVersion":' }], ['missing listenPort', { json: '{"recorderVersion":"0.1.0","startedAt":"x"}' }],
    ['not an object', { json: '[1,2]' }]])('badMeta: %s', (_n, o) => {
    const parser = new PwrecParser();
    parser.push(pwrecHeader(META, o));
    expect(parser.error).toEqual({ kind: 'badMeta' });
  });
  it('an incomplete header is badMeta at finish', () => {
    const parser = new PwrecParser();
    parser.push(pwrecHeader().subarray(0, 7));
    expect(parser.finish()).toEqual({ endedCleanly: false, truncatedBytes: 7 });
    expect(parser.error).toEqual({ kind: 'badMeta' });
  });
  it('keeps unknown metadata fields', () => {
    const meta = { ...META, host: 'driver-pc', extra: { a: [1, 2] } };
    const parser = new PwrecParser();
    parser.push(pwrecHeader(meta));
    expect(parser.meta).toEqual(meta);
  });
});
```

```ts
// apps/bridge/test/pwrec/reader-writer.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { PwrecFormatError } from '../../src/pwrec/reader.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import { META, concat, drain, pwrecHeader, pwrecRecord } from './helpers.ts';
const tmp = () => mkdtempSync(join(tmpdir(), 'pwrec-'));
const payload = (n: number) => new Uint8Array([n, n + 1, n + 2]);

describe('readPwrec', () => {
  it('reads a gzip file and returns the summary', async () => {
    const path = join(tmp(), 'a.pwrec.gz');
    writeFileSync(path, gzipSync(concat(pwrecHeader(), pwrecRecord(0, 1, payload(1)), pwrecRecord(255, 9))));
    expect(await drain(path)).toEqual({ records: [{ kind: 0, t: 1, payload: payload(1) }], summary: { meta: META, endedCleanly: true, durationMs: 9 } });
  });
  it('throws PwrecFormatError for a bad magic', async () => {
    const path = join(tmp(), 'bad.pwrec.gz');
    writeFileSync(path, gzipSync(pwrecHeader(META, { magic: 'NOPE!' })));
    await expect(drain(path)).rejects.toSatisfy((e) => e instanceof PwrecFormatError && e.error.kind === 'badMagic');
  });
});

describe('PwrecWriter', () => {
  it('round-trips through readPwrec, unknown meta fields included', async () => {
    const path = join(tmp(), 'w.pwrec.gz');
    const meta = { ...META, forwarder: 'x' };
    const w = PwrecWriter.create(path, meta);
    [0, 400, 1200].forEach((t, i) => w.write(t, payload(i)));
    await w.close(2500);
    expect(await drain(path)).toEqual({
      records: [0, 400, 1200].map((t, i) => ({ kind: 0, t, payload: payload(i) })),
      summary: { meta, endedCleanly: true, durationMs: 2500 },
    });
    expect(() => w.write(3000, payload(9))).toThrow();
  });
  it('a crash after a sync flush leaves a readable file without end marker', async () => {
    const path = join(tmp(), 'crash.pwrec.gz');
    const w = PwrecWriter.create(path, META);
    const ts = [0, 400, 800, 1200, 1600, 2100, 2300];   // flushes after 1200 and after 2100
    ts.forEach((t, i) => w.write(t, payload(i)));
    await w.close(2400);
    const file = readFileSync(path);
    const lastFlush = file.subarray(0, file.length - 8).lastIndexOf(Buffer.from([0, 0, 0xff, 0xff]));
    writeFileSync(path, file.subarray(0, lastFlush + 4));   // simulate kill right after the 2100 flush
    const { records, summary } = await drain(path);
    expect(records.map((r) => r.t)).toEqual([0, 400, 800, 1200, 1600, 2100]);
    expect(summary).toEqual({ meta: META, endedCleanly: false });
  });
  it('reports file errors through onError and close()', async () => {
    const onError = vi.fn();
    const w = PwrecWriter.create(join(tmp(), 'missing-dir', 'x.pwrec.gz'), META, { onError });
    w.write(0, payload(0));
    await expect(w.close(1)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(onError).toHaveBeenCalledOnce();
  });
});
```

```ts
// apps/bridge/test/pwrec/fixtures.test.ts — facts verified with a throwaway scan of the recordings
import { readFileSync } from 'node:fs';
import { constants, gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { describeWithFixture, fixturePath } from '../../../../test-support/fixtures.ts';
import { drain } from './helpers.ts';

describeWithFixture('menuOnly', 'pwrec fixture: menuOnly', () => {
  it('385 datagrams of 45 bytes (BUTN events), clean end', async () => {
    const { records, summary } = await drain(fixturePath('menuOnly')!);
    expect(records).toHaveLength(385);
    expect(records.every((r) => r.payload.length === 45)).toBe(true);
    expect(summary.meta).toEqual({ recorderVersion: '0.1.0', listenPort: 20777, startedAt: '2026-10-27T21:50:28.331Z' });
    expect(summary.endedCleanly).toBe(true);
    expect(summary.durationMs).toBeCloseTo(2_475_323.6368, 3);
  });
});
describeWithFixture('raceSingapore', 'pwrec fixture: raceSingapore', () => {
  it('24 726 datagrams, clean end, first record directly after the metadata (offset 10 + n)', async () => {
    const path = fixturePath('raceSingapore')!;
    const bytes = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH });
    const n = bytes.readUInt32LE(6);
    expect(n).toBe(85);
    expect(bytes[10 + n]).toBe(0);
    const { records, summary } = await drain(path);
    expect(records[0]!.t).toBe(bytes.readDoubleLE(10 + n + 1));
    expect(records).toHaveLength(24_726);
    expect(summary).toMatchObject({ endedCleanly: true });
    expect(summary.durationMs).toBeCloseTo(79_458.7947, 3);
  }, 60_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/bridge/test/pwrec`
Expected: FAIL (`parser.ts`, `reader.ts`, `writer.ts` do not exist)

- [ ] **Step 3: Implement `PwrecParser` (`parser.ts`), `readPwrec` + `PwrecFormatError` (`reader.ts`), `PwrecWriter` (`writer.ts`), shared types in `types.ts`** (implementation agent; must not edit test files)

Parser: keep a list of unconsumed byte slices (or one carry-over buffer that is replaced, never overwritten); records are returned as `subarray` views or copies. Reader: `createReadStream(path).pipe(createGunzip({ finishFlush: constants.Z_SYNC_FLUSH }))`, `for await` chunks → `push` → `yield*`; throw `PwrecFormatError` as soon as `parser.error` is set (also after `finish()`); return `{ meta, endedCleanly, durationMs? }`. Writer: `createGzip()` piped into `createWriteStream(path)`, `gzip.flush(constants.Z_SYNC_FLUSH)` per the rule above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/bridge/test/pwrec`
Expected: PASS (fixture tests skipped with a note if `recordings/` is missing)

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/pwrec apps/bridge/test/pwrec
git commit -F - <<'EOF'
feat(bridge): add .pwrec v1 parser, lenient reader and flushing writer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Packet sources (`PwrecSource`, `UdpSource`)

**Files:**
- Create: `apps/bridge/src/input/packet-source.ts`, `apps/bridge/src/input/pwrec-source.ts`, `apps/bridge/src/input/udp-source.ts`
- Test: `apps/bridge/test/input/pwrec-source.test.ts`, `apps/bridge/test/input/udp-source.test.ts`

**Interfaces:**
- Consumes: `readPwrec`, `PwrecWriter`, `PwrecFormatError` (Task 7); `FeedId` from `@pitwall/domain` (Task 9 — only the branded string type; if Task 9 is not merged yet, the supervisor lands `ids.ts` first).
- Produces (verbatim): `RawPacket`, `PacketSource` (`feedId`, `start(onPacket)`, `stop()`, `done`), `PwrecSource`, `UdpSource`.
- Produces (extends contract):
  ```ts
  new PwrecSource(opts: { feedId: FeedId; path: string; mode: 'realtime' | 'asFastAsPossible';
    clock?: () => number;                                          // default performance.now
    sleep?: (ms: number, signal: AbortSignal) => Promise<void> })  // default node:timers/promises setTimeout with { signal }
  new UdpSource(opts: { feedId: FeedId; port: number /* 0 = ephemeral */; host?: string /* default '0.0.0.0' */; clock?: () => number /* default performance.now */ })
  UdpSource.prototype.boundPort: number | undefined     // getter; set once bound
  UdpSource.prototype.listening: Promise<void>          // resolves when bound; rejects with the bind error (e.g. EADDRINUSE)
  ```

Semantics pinned here:
- `done` resolves when the source has finished delivering: end of file (`PwrecSource`) or after `stop()` (both). It rejects on a fatal error: `PwrecFormatError` or a read error (`PwrecSource`), the bind error (`UdpSource`). Both sources attach an internal no-op `catch` to `done`/`listening`, so an unobserved rejection never crashes the process; consumers awaiting them still see it.
- After `stop()` is called, `onPacket` is never called again, also when `stop()` is called from inside `onPacket`. `stop()` resolves after `done` settles.
- `PwrecSource` realtime pacing: origin = (`clock()` when the first record arrives, first record's `t`); before each later record, `wait = originClock + (t − originT) − clock()`; sleep only when `wait > 0` (a slow consumer catches up instead of drifting). `stop()` aborts a pending sleep via the `AbortSignal`; a sleep that rejects with an abort error counts as stopped. `receivedAtMs` = record `t` in both modes. `asFastAsPossible` never calls `sleep`.
- `UdpSource`: `receivedAtMs = clock()` on receipt; `bytes` is the received datagram as a `Uint8Array`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/input/pwrec-source.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { FeedId } from '@pitwall/domain';
import { describe, expect, it, vi } from 'vitest';
import type { RawPacket } from '../../src/input/packet-source.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { PwrecFormatError } from '../../src/pwrec/reader.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import { META } from '../pwrec/helpers.ts';

const FEED = 'feed-a' as FeedId;
async function recording(ts: number[]): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), 'src-')), 'r.pwrec.gz');
  const w = PwrecWriter.create(path, META);
  ts.forEach((t, i) => w.write(t, new Uint8Array([i])));
  await w.close((ts.at(-1) ?? 0) + 1);
  return path;
}

describe('PwrecSource', () => {
  it('asFastAsPossible: every datagram in order, receivedAtMs = record t, no sleeping, then done', async () => {
    const sleep = vi.fn();
    const src = new PwrecSource({ feedId: FEED, path: await recording([100, 110, 110, 150]), mode: 'asFastAsPossible', sleep });
    const got: RawPacket[] = [];
    src.start((p) => got.push(p));
    await src.done;
    expect(got.map((p) => [p.feedId, p.receivedAtMs, [...p.bytes]])).toEqual([[FEED, 100, [0]], [FEED, 110, [1]], [FEED, 110, [2]], [FEED, 150, [3]]]);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('realtime: sleeps the gaps relative to the first record', async () => {
    let now = 5_000;
    const sleeps: number[] = [];
    const src = new PwrecSource({ feedId: FEED, path: await recording([100, 110, 110, 150]), mode: 'realtime',
      clock: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    const got: number[] = [];
    src.start((p) => got.push(p.receivedAtMs));
    await src.done;
    expect(sleeps).toEqual([10, 40]);
    expect(got).toEqual([100, 110, 110, 150]);
  });
  it('realtime: never sleeps when the consumer is behind schedule', async () => {
    let now = 0;
    const sleep = vi.fn(async () => {});
    const src = new PwrecSource({ feedId: FEED, path: await recording([0, 10, 20]), mode: 'realtime', clock: () => now, sleep });
    src.start(() => { now += 100; });
    await src.done;
    expect(sleep).not.toHaveBeenCalled();
  });
  it('stop() aborts a pending realtime wait and resolves done', async () => {
    const sleep = (_ms: number, signal: AbortSignal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    const src = new PwrecSource({ feedId: FEED, path: await recording([0, 60_000]), mode: 'realtime', sleep });
    const got: RawPacket[] = [];
    src.start((p) => got.push(p));
    await vi.waitFor(() => expect(got).toHaveLength(1));
    await src.stop();
    await expect(src.done).resolves.toBeUndefined();
    expect(got).toHaveLength(1);
  });
  it('stop() from inside onPacket delivers nothing after that packet', async () => {
    const src = new PwrecSource({ feedId: FEED, path: await recording([0, 1, 2, 3, 4]), mode: 'asFastAsPossible' });
    const got: RawPacket[] = [];
    src.start((p) => { got.push(p); if (got.length === 2) void src.stop(); });
    await src.done;
    expect(got).toHaveLength(2);
  });
  it('done rejects with PwrecFormatError for a file with a bad magic', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'src-')), 'bad.pwrec.gz');
    writeFileSync(path, gzipSync(Buffer.from('NOPE!\x01\x00\x00\x00\x00')));
    const src = new PwrecSource({ feedId: FEED, path, mode: 'asFastAsPossible' });
    src.start(() => {});
    await expect(src.done).rejects.toBeInstanceOf(PwrecFormatError);
  });
});
```

```ts
// apps/bridge/test/input/udp-source.test.ts
import { createSocket } from 'node:dgram';
import type { FeedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { RawPacket } from '../../src/input/packet-source.ts';
import { UdpSource } from '../../src/input/udp-source.ts';

const FEED = 'feed-udp' as FeedId;

describe('UdpSource', () => {
  it('binds an ephemeral port and delivers datagrams with the injected clock', async () => {
    const src = new UdpSource({ feedId: FEED, port: 0, host: '127.0.0.1', clock: () => 1234 });
    expect(src.boundPort).toBeUndefined();
    const received = new Promise<RawPacket>((resolve) => src.start(resolve));
    await src.listening;
    expect(src.boundPort).toBeGreaterThan(0);
    const client = createSocket('udp4');
    client.send(Uint8Array.from([1, 2, 3]), src.boundPort!, '127.0.0.1');
    const p = await received;
    expect(p.feedId).toBe(FEED);
    expect(p.receivedAtMs).toBe(1234);
    expect(p.bytes).toBeInstanceOf(Uint8Array);
    expect([...p.bytes]).toEqual([1, 2, 3]);
    client.close();
    await src.stop();
    await expect(src.done).resolves.toBeUndefined();
  });
  it('rejects listening and done with EADDRINUSE when the port is busy', async () => {
    const a = new UdpSource({ feedId: FEED, port: 0, host: '127.0.0.1' });
    a.start(() => {});
    await a.listening;
    const b = new UdpSource({ feedId: FEED, port: a.boundPort!, host: '127.0.0.1' });
    b.start(() => {});
    await expect(b.listening).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await expect(b.done).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await a.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/bridge/test/input`
Expected: FAIL (`pwrec-source.ts`, `udp-source.ts` do not exist)

- [ ] **Step 3: Implement `PacketSource`/`RawPacket` (`packet-source.ts`), `PwrecSource`, `UdpSource`** (implementation agent; must not edit test files)

`PwrecSource.start` runs one async loop over `readPwrec(path)` (an `AbortController` per source; the loop checks `stopped` before every `onPacket`) and settles `done` via `Promise.withResolvers`. `UdpSource` uses `dgram.createSocket('udp4')`, `bind(port, host)`, `'listening'` → `boundPort = socket.address().port`; `stop()` closes the socket. Calling `start` twice throws (bug).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/bridge/test/input`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/input apps/bridge/test/input
git commit -F - <<'EOF'
feat(bridge): add PwrecSource (realtime/as fast as possible) and UdpSource

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Domain vocabulary package and engine state types

**Files:**
- Create: `packages/domain/package.json` (`@pitwall/domain`, `"type": "module"`, no dependencies, `exports: { ".": "./src/index.ts" }`), `packages/domain/tsconfig.json` (extends `../../tsconfig.base.json`)
- Create: `packages/domain/src/{ids,units,known,corners,compounds,session,car,records,insight,index}.ts`
- Create: `packages/engine/src/state/engine-state.ts`, `packages/engine/src/state/weekend-context.ts`, `packages/engine/src/util/deep-readonly.ts`
- Modify: root `tsconfig.json` (add reference `packages/domain`), `packages/engine/package.json` (`"@pitwall/domain": "workspace:*"`), `packages/engine/src/index.ts` (re-export state types and `DeepReadonly`); run `pnpm install`
- Test: `packages/domain/test/vocabulary.test.ts`, `packages/engine/test/state/deep-readonly.test.ts`

**Interfaces:**
- Consumes: Task 1 workspace (tsconfig base, vitest, depcruise rule "domain → nothing").
- Produces (contract): `FeedId`, `CarId`, `SessionUid`, `SessionTime`, `DriverKey`, `driverKeyString`, `Known`, `known`, `unknown`, `Corners`, `cornersFromGameOrder`, `ActualCompound`, `VisualCompound`, `SessionState`, `CarState`, `LapRecord`, `StintRecord`, `PitStopRecord`, `FlagPhase`, `RaceEvent`, `MiniSectorCrossing`, `MINI_SECTORS = 50`, `Insight`; engine: `History`, `HistoryLengths`, `EngineState`, `WeekendContext`, `DeepReadonly`.
- Produces (new): `feedId(s)`, `carId(i)`, `sessionUidString(uid: bigint): SessionUid`, `MAX_CARS = 22`, `toSessionTime(seconds: number): SessionTime`, unit aliases, `UnknownReason`, `actualCompoundFromCode(code: number): ActualCompound`, `visualCompoundFromCode(code: number): VisualCompound` (both `'unknown'` for unlisted codes), the sub-types below (`CarIdentity`, `CarTiming`, `CarTyres`, `CarEnergy`, `CarCondition`, `CarDynamics`, `OwnCarState`, …), `OpenTrackers`, `EngineState.weekend?`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/domain/test/vocabulary.test.ts
import { describe, expect, it } from 'vitest';
import { actualCompoundFromCode, cornersFromGameOrder, driverKeyString, known, sessionUidString, toSessionTime,
  unknown, visualCompoundFromCode, type Known } from '../src/index.ts';

describe('Known', () => {
  it('known carries value and time, unknown carries the reason', () => {
    expect(known(42.5, 1200)).toEqual({ known: true, value: 42.5, at: 1200 });
    const r: Known<number> = unknown('restricted');
    expect(r).toEqual({ known: false, reason: 'restricted' });
  });
});
describe('cornersFromGameOrder', () => {
  it('maps game order RL, RR, FL, FR to named corners', () => {
    expect(cornersFromGameOrder(['rl', 'rr', 'fl', 'fr'] as const)).toEqual({ fl: 'fl', fr: 'fr', rl: 'rl', rr: 'rr' });
    expect(cornersFromGameOrder([1, 2, 3, 4] as const)).toEqual({ rl: 1, rr: 2, fl: 3, fr: 4 });
  });
});
describe('compounds (appendix codes)', () => {
  it.each([[16, 'C5'], [17, 'C4'], [18, 'C3'], [19, 'C2'], [20, 'C1'], [21, 'C0'], [22, 'C6'], [7, 'inter'], [8, 'wet'],
    [9, 'classicDry'], [10, 'classicWet'], [11, 'f2SuperSoft'], [12, 'f2Soft'], [13, 'f2Medium'], [14, 'f2Hard'], [15, 'f2Wet'],
    [0, 'unknown'], [255, 'unknown']] as const)('actual %i -> %s', (code, c) => expect(actualCompoundFromCode(code)).toBe(c));
  it.each([[16, 'soft'], [17, 'medium'], [18, 'hard'], [7, 'inter'], [8, 'wet'], [15, 'wet'], [19, 'superSoft'], [20, 'soft'],
    [21, 'medium'], [22, 'hard'], [0, 'unknown'], [9, 'unknown']] as const)('visual %i -> %s', (code, c) => expect(visualCompoundFromCode(code)).toBe(c));
});
describe('ids and units', () => {
  it('driverKeyString: AI by driverId, human by networkId + race number + name', () => {
    expect(driverKeyString({ kind: 'ai', driverId: 9 })).toBe('ai:9');
    expect(driverKeyString({ kind: 'human', networkId: 255, name: 'HAMILTON', raceNumber: 44 })).toBe('human:255:44:HAMILTON');
  });
  it('sessionUidString is the decimal u64', () => expect(sessionUidString(0xb3cd07e2790bdcben)).toBe('12956020372289608894'));
  it('toSessionTime rounds seconds to integer ms', () => {
    expect(toSessionTime(12.3456)).toBe(12346);
    expect(toSessionTime(0)).toBe(0);
  });
});
```

```ts
// packages/engine/test/state/deep-readonly.test.ts
import { expect, expectTypeOf, it } from 'vitest';
import type { CarId, Known } from '@pitwall/domain';
import type { DeepReadonly, EngineState } from '../../src/index.ts';

type S = { id: CarId; list: Array<{ n: number }>; pair: [number, number]; map: Map<string, { v: number }>; k: Known<number>; fn: (x: number) => number };
it('DeepReadonly forbids mutation at every depth and keeps brands and functions', () => {
  const mutate = (s: DeepReadonly<S>) => {
    // @ts-expect-error top-level field
    s.id = 1 as CarId;
    // @ts-expect-error array
    s.list.push({ n: 1 });
    // @ts-expect-error nested object in array
    s.list[0]!.n = 2;
    // @ts-expect-error tuple element
    s.pair[0] = 1;
    // @ts-expect-error map
    s.map.set('a', { v: 1 });
  };
  expect(mutate).toBeTypeOf('function');
  expectTypeOf<DeepReadonly<S>['id']>().toEqualTypeOf<CarId>();
  expectTypeOf<DeepReadonly<S>['fn']>().toEqualTypeOf<(x: number) => number>();
  expectTypeOf<DeepReadonly<EngineState>['cars'][number]['identity']['name']>().toEqualTypeOf<string>();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/domain packages/engine/test/state && pnpm typecheck`
Expected: FAIL (modules `packages/domain/src/index.ts`, `util/deep-readonly.ts` do not exist)

- [ ] **Step 3: Implement the vocabulary and state types** (implementation agent; must not edit test files)

Functions are one-liners. Compound maps are `as const` objects (`ActualCompound = { C0: 'C0', …, C6: 'C6', inter, wet, classicDry, classicWet, f2SuperSoft, f2Soft, f2Medium, f2Hard, f2Wet, unknown }`, `VisualCompound = { soft, medium, hard, superSoft /* F2 only */, inter, wet, unknown }`) with codes from Car Status in the PDF (actual 16=C5 … 21=C0, 22=C6, 7, 8, classic 9/10, F2 11–15; visual 16/17/18, 7, 8, F2 15/19–22). `DeepReadonly`: functions and primitives (check primitives first — branded ids are primitive intersections) unchanged, `Map`/`Set` → `ReadonlyMap`/`ReadonlySet`, objects/arrays/tuples → `{ readonly [K in keyof T]: DeepReadonly<T[K]> }`. Types, exactly (unit aliases `Ms, Metres, Kmh, Celsius, Psi, Kg, Joules, Watts, Radians, Percent /*0–100*/, Ratio /*0–1*/` are `number`):

```ts
// ids.ts / known.ts
type FeedId = string & { readonly __brand: 'FeedId' }; type CarId = number & { readonly __brand: 'CarId' };
type SessionUid = string; type SessionTime = number; const MAX_CARS = 22;
type DriverKey = { kind: 'ai'; driverId: number } | { kind: 'human'; networkId: number; name: string; raceNumber: number };
type UnknownReason = 'restricted' | 'notReceived' | 'notApplicable' | 'stale';
type Known<T> = { known: true; value: T; at: SessionTime } | { known: false; reason: UnknownReason };
// session.ts — from the Session packet (spec 6.1); codes mapped to names in Task 13
type SessionKind = 'unknown' | 'practice' | 'qualifying' | 'sprintShootout' | 'race' | 'timeTrial';
type Weather = 'clear' | 'lightCloud' | 'overcast' | 'lightRain' | 'heavyRain' | 'storm';
type Trend = 'up' | 'down' | 'flat'; type ZoneFlag = 'unknown' | 'none' | 'green' | 'blue' | 'yellow';
type SessionFlag = 'green' | 'sc' | 'vsc' | 'formation';            // from safetyCarStatus; red flags are FlagPhases (Task 16)
type ForecastSample = { sessionType: number; offsetMin: number; weather: Weather; trackTempC: Celsius; trackTempTrend: Trend; airTempC: Celsius; airTempTrend: Trend; rainPct: Percent };
type GameSettings = { safetyCar: 'off' | 'reduced' | 'standard' | 'increased'; redFlags: 'off' | 'reduced' | 'standard' | 'increased';
  carDamage: 'off' | 'reduced' | 'standard' | 'simulation'; carDamageRate: 'reduced' | 'standard' | 'simulation';
  tyreTemperature: 'surfaceOnly' | 'surfaceAndCarcass'; lowFuelMode: 'easy' | 'hard'; recoveryMode: 'none' | 'flashbacks' | 'autoRecovery';
  flashbackLimit: 'low' | 'medium' | 'high' | 'unlimited'; surfaceType: 'simplified' | 'realistic'; collisions: 'off' | 'playerToPlayerOff' | 'on';
  pitLaneTyreSim: boolean; parcFerme: boolean; equalCarPerformance: boolean; formationLap: boolean; aiDifficulty: number; gameMode: number; ruleSet: number };
type SessionState = { trackId: number; sessionType: number; kind: SessionKind; formula: number; totalLaps: number;
  trackLengthM: Metres; sector2StartM: Metres; sector3StartM: Metres; durationMs: Ms; timeLeftMs: Ms; pitSpeedLimitKmh: Kmh;
  weather: Weather; trackTempC: Celsius; airTempC: Celsius; forecast: ForecastSample[]; forecastAccuracy: 'perfect' | 'approximate';
  flag: SessionFlag; marshalZones: Array<{ startFraction: Ratio; flag: ZoneFlag }>; periods: { sc: number; vsc: number; red: number };
  pitWindow: { idealLap: number; latestLap: number; rejoinPosition: number };   // player strategy, 0 = none
  settings: GameSettings; networkGame: boolean; numActiveCars: number;           // numActiveCars from Participants
  link: { season: number; weekend: number; session: number }; weekendStructure: number[]; updatedAt: SessionTime };
// car.ts — Known<> only where restricted / notApplicable can apply (PDF "Restricted data"); notReceived until the first packet
type Visibility = 'own' | 'public' | 'restricted'; type PitStatus = 'none' | 'pitting' | 'inPitArea';
type DriverStatus = 'inGarage' | 'flyingLap' | 'inLap' | 'outLap' | 'onTrack'; type FiaFlag = ZoneFlag;
type ResultStatus = 'invalid' | 'inactive' | 'active' | 'finished' | 'didNotFinish' | 'disqualified' | 'notClassified' | 'retired';
type Vec3 = { x: number; y: number; z: number };
type CarIdentity = { name: string; teamId: number; raceNumber: number; nationality: number; ai: boolean; driverId: number;
  networkId: number; myTeam: boolean; platform: number; telemetryPublic: boolean /* yourTelemetry = 1 */; driverKey: DriverKey; visibility: Visibility };
type CarTiming = { position: number; lap: number; lapDistanceM: Metres; totalDistanceM: Metres; currentLapTimeMs: Ms; lastLapTimeMs: Ms;
  sector: 1 | 2 | 3; sector1TimeMs: Ms; sector2TimeMs: Ms; currentLapInvalid: boolean; gapToLeaderMs: Ms; gapToCarAheadMs: Ms;
  safetyCarDeltaMs: Ms; pitStatus: PitStatus; numPitStops: number; pitLaneTimerActive: boolean; pitLaneTimeMs: Ms; pitStopTimerMs: Ms;
  shouldServePenalty: boolean; driverStatus: DriverStatus; resultStatus: ResultStatus; timePenaltyMs: Ms; totalWarnings: number;
  cornerCuttingWarnings: number; unservedDriveThroughs: number; unservedStopGos: number; gridPosition: number;
  speedTrapFastestKmh: Kmh | undefined; fiaFlag: FiaFlag };
type TyreCorner = { surfaceTempC: Celsius; carcassTempC: Known<Celsius> /* notApplicable when settings.tyreTemperature = surfaceOnly */;
  pressurePsi: Psi; wearPct: Known<Percent>; damagePct: Known<Percent>; blistersPct: Percent };
type TyreSet = { actualCompound: ActualCompound; visualCompound: VisualCompound; wearPct: Percent; available: boolean; fitted: boolean;
  recommendedSession: number; lifeSpanLaps: number; usableLifeLaps: number; lapDeltaMs: Ms };
type CarTyres = { actualCompound: ActualCompound; visualCompound: VisualCompound; age: number; corners: Corners<TyreCorner>;
  sets: Known<{ sets: TyreSet[]; fittedIdx: number }> };
type CarEnergy = { fuel: Known<{ kg: Kg; capacityKg: Kg; remainingLaps: number; mix: 'lean' | 'standard' | 'rich' | 'max' }>;
  ers: Known<{ storeJ: Joules; mode: 'none' | 'medium' | 'hotlap' | 'overtake'; harvestedMgukJ: Joules; harvestedMguhJ: Joules; deployedJ: Joules }>;
  power: Known<{ iceW: Watts; mgukW: Watts }> };
type CarCondition = { bodywork: Known<{ frontLeftWingPct: Percent; frontRightWingPct: Percent; rearWingPct: Percent; floorPct: Percent; diffuserPct: Percent; sidepodPct: Percent }>;
  powerUnit: Known<{ engineDamagePct: Percent; gearboxDamagePct: Percent; mguhWearPct: Percent; esWearPct: Percent; ceWearPct: Percent; iceWearPct: Percent; mgukWearPct: Percent; tcWearPct: Percent }>;
  drsFault: Known<boolean>; ersFault: boolean; engineBlown: boolean; engineSeized: boolean;
  brakes: Corners<{ tempC: Celsius; damagePct: Known<Percent> }>; engineTempC: Celsius };
type CarDynamics = { speedKmh: Kmh; throttle: Ratio; brake: Ratio; steer: number /* -1..1 */; clutchPct: Percent; gear: number /* -1 R, 0 N */;
  rpm: number; maxRpm: number; revLightsPct: Percent; drs: boolean; drsAllowed: boolean; drsActivationDistanceM: Metres; pitLimiter: boolean;
  position: Vec3 /* m */; velocity: Vec3 /* m/s */; gForce: { lateral: number; longitudinal: number; vertical: number };
  orientation: { yawRad: Radians; pitchRad: Radians; rollRad: Radians } };
type OwnCarMotionEx = { wheels: Corners<{ suspensionPosition: number; suspensionVelocity: number; suspensionAcceleration: number; speed: number;
  slipRatio: number; slipAngle: number; latForce: number; longForce: number; vertForce: number; camberRad: Radians; camberGainRad: Radians }>;
  heightOfCogM: Metres; localVelocity: Vec3; angularVelocity: Vec3; angularAcceleration: Vec3; frontWheelsAngleRad: Radians;
  frontAeroHeightM: Metres; rearAeroHeightM: Metres; frontRollAngleRad: Radians; rearRollAngleRad: Radians; chassisYawRad: Radians; chassisPitchRad: Radians };
type CarSetup = { frontWing: number; rearWing: number; diffOnThrottlePct: Percent; diffOffThrottlePct: Percent; frontCamber: number; rearCamber: number;
  frontToe: number; rearToe: number; frontSuspension: number; rearSuspension: number; frontAntiRollBar: number; rearAntiRollBar: number;
  frontRideHeight: number; rearRideHeight: number; brakePressurePct: Percent; brakeBiasPct: Percent; engineBrakingPct: Percent;
  tyrePressurePsi: Corners<Psi>; ballast: number; fuelLoadKg: Kg };            // setup-screen units as sent (camber/toe in degrees)
type OwnCarState = { motionEx: Known<OwnCarMotionEx>; setup: Known<CarSetup>; brakeBiasPct: Known<Percent> /* live, Car Status */ };
type CarState = { id: CarId; active: boolean; identity: CarIdentity; timing: CarTiming; tyres: CarTyres; energy: CarEnergy;
  condition: CarCondition; dynamics: CarDynamics; ownCar?: OwnCarState /* player car only */ };
// records.ts / insight.ts: exactly as in the contract (compound fields typed ActualCompound / VisualCompound, carId: CarId), Insight per spec 8.3.
// engine state/engine-state.ts
type LapCursor = { lap: number; startedAt: SessionTime; fuelAtStartKg: Known<number>; tyreAgeAtStart: number; scMs: Ms; vscMs: Ms; pitted: boolean /* in-lap */;
  sector1Ms: Ms; sector2Ms: Ms; invalid: boolean; lastSeenAt: SessionTime; trackedMs: Ms; actualCompound: ActualCompound; visualCompound: VisualCompound; outLap: boolean };
type OpenStint = { firstLap: number; actualCompound: ActualCompound; visualCompound: VisualCompound; tyreAgeAtFitting: number; lastAge: number };
type OpenPitVisit = { lap: number; entry: SessionTime; flag: 'green' | 'sc' | 'vsc'; penaltyServed: boolean; pitLaneTimeMs: Ms; stationaryTimeMs: Ms };
type OpenTrackers = { laps: Array<LapCursor | undefined>; stints: Array<OpenStint | undefined>; pitVisits: Array<OpenPitVisit | undefined>;
  flagPhase?: FlagPhase; lastFlag: SessionFlag /* session.flag after the previous frame */;
  miniSectors: Array<{ lap: number; segment: number /* last emitted in that lap, -1 = none */; distanceM: Metres; at: SessionTime } | undefined>;
  lapIndex: Array<Record<number, { provisional?: number /* index in history.laps */; confirmed: boolean }>>; pitStatus: Array<PitStatus | undefined> /* previous frame */ };  // arrays indexed by CarId, length 22; plain data so structuredClone works
// History, HistoryLengths, WeekendContext: verbatim from the contract. EngineState: contract fields plus `weekend?: WeekendContext`.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/domain packages/engine/test/state && pnpm typecheck && pnpm depcruise`
Expected: PASS (typecheck proves every `@ts-expect-error` is used; depcruise shows `domain` imports nothing)

- [ ] **Step 5: Commit**

```bash
git add packages/domain packages/engine tsconfig.json pnpm-lock.yaml && git commit -F - <<'EOF'
feat(domain): add domain vocabulary package and engine state types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Frame assembler (grouping, reorder, loss metrics)

**Files:**
- Create: `packages/engine/src/frame/frame.ts`, `packages/engine/src/frame/metrics.ts`, `packages/engine/src/frame/assembler.ts`
- Modify: `packages/engine/src/index.ts` (export `Frame`, `FrameMetrics`, `FrameAssembler`, `MENU_RATE_SLOTS`)
- Create (test helper, test agent): `packages/engine/test/frame/stub-packet.ts`
- Test: `packages/engine/test/frame/assembler.test.ts`

**Interfaces:**
- Consumes: `decode`, `headerSchema`, `writeField`, `PACKET_SIZES`, `PacketId`, `Packet`, `PacketOf`, `PacketName`, `EventCode` and the packet types (Tasks 3–6); `FeedId`, `SessionTime`, `toSessionTime` (Task 9).
- Produces (contract): `Frame` (spec 5.1 with `sessionUid: bigint`, `sessionTime: SessionTime`, `playerCarIndex: number`), `FrameMetrics`, `class FrameAssembler { constructor(opts: { feedId: FeedId; reorderWindow?: number }); push(packet: Packet): Frame[]; flush(): Frame[]; get metrics(): FrameMetrics }`.
- Produces (new): `FrameAssembler.attach(packet: Packet): void` — merges a packet into the newest open frame whatever its own frame id (Task 11 uses it for `SEND` and grace-window packets, whose frame id is 0 in the fixtures); `MENU_RATE_SLOTS = ['lapData', 'motion', 'telemetry', 'status', 'motionEx'] as const`; test helpers `stub(name, frameId, sessionTimeS, o?)` and `menuGroup(frameId, sessionTimeS, o?)`.

**Rules pinned here (spec 5.2, refined):**
- The grouping/ordering key is `header.overallFrameIdentifier`. It equals `frameIdentifier` in all three fixtures but keeps rising across flashbacks, where `frameIdentifier` jumps back. Grouping by `frameId` would mark every packet after a flashback as late. `Frame.frameId` and `Frame.overallFrameId` are both kept.
- `newest` = the largest key seen. A packet is **late** (dropped, `latePackets++`) when `newest − key > reorderWindow` (default 2). After each accepted packet, every open frame with `newest − key > reorderWindow` closes, in ascending key order.
- Single-instance slots: the last packet wins. `sessionHistory`, `tyreSets`, `events`: appended in arrival order. `lobbyInfo` is ignored. `sessionUid`, `frameId`, `playerCarIndex` come from the packet that opened the frame. `sessionTime` = `toSessionTime(max header.sessionTime)` over the frame's packets (packets inside one frame differ by a few ms in the fixtures).
- `incompleteFrames` counts closed frames that are missing any `MENU_RATE_SLOTS` slot. `cadenceMs` = `sorted[Math.floor(n / 2)]` of the last 64 **positive** steps between consecutive closed frames' `sessionTime` (zero and negative steps from a pause or flashback are skipped); `lastSessionTime` = the last closed frame's `sessionTime`. `decodeErrors` stays 0 here (the bridge counts them, Task 27).

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/frame/stub-packet.ts — real decodable packets: zeroed body, chosen header
import { decode, headerSchema, PACKET_SIZES, PacketId, writeField, type EventCode, type PacketName, type PacketOf } from '@pitwall/protocol';
export type StubOpts = { uid?: bigint; overall?: number; player?: number; code?: EventCode; carIdx?: number };
export function stub<N extends PacketName>(name: N, frameId: number, sessionTimeS: number, o: StubOpts = {}): PacketOf<N> {
  const bytes = new Uint8Array(PACKET_SIZES[name]);
  writeField(headerSchema, new DataView(bytes.buffer), 0, { packetFormat: 2025, gameYear: 25, gameMajorVersion: 1, gameMinorVersion: 0,
    packetVersion: 1, packetId: PacketId[name], sessionUid: o.uid ?? 7n, sessionTime: sessionTimeS, frameIdentifier: frameId,
    overallFrameIdentifier: o.overall ?? frameId, playerCarIndex: o.player ?? 0, secondaryPlayerCarIndex: 255 });
  if (name === 'event') bytes.set(new TextEncoder().encode(o.code ?? 'BUTN'), 29);
  if (name === 'sessionHistory' || name === 'tyreSets') bytes[29] = o.carIdx ?? 0;
  const r = decode(bytes);
  if (!r.ok) throw new Error(`stub ${name}: ${r.error.kind}`);
  return r.packet as PacketOf<N>;
}
export const menuGroup = (frameId: number, sessionTimeS: number, o: StubOpts = {}) =>
  (['lapData', 'motion', 'carTelemetry', 'carStatus', 'motionEx'] as const).map((n) => stub(n, frameId, sessionTimeS, o));
```

```ts
// packages/engine/test/frame/assembler.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { PacketId, type Packet } from '@pitwall/protocol';
import { FrameAssembler, type Frame } from '../../src/index.ts';
import { menuGroup, stub } from './stub-packet.ts';

const feedId = 'test' as FeedId;
const pushAll = (a: FrameAssembler, ps: Packet[]) => ps.flatMap((p) => a.push(p));
const ids = (fs: Frame[]) => fs.map((f) => f.frameId);

describe('FrameAssembler', () => {
  it('groups one frame into named slots', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(10, 1.0), stub('session', 10, 1.0), stub('participants', 10, 1.0)]);
    const f = a.flush()[0]!;
    expect(f).toMatchObject({ feedId, sessionUid: 7n, frameId: 10, overallFrameId: 10, sessionTime: 1000, playerCarIndex: 0 });
    for (const k of ['motion', 'lapData', 'telemetry', 'status', 'motionEx', 'session', 'participants'] as const) expect(f[k]).toBeDefined();
    expect(f.damage).toBeUndefined();
    expect([f.sessionHistory, f.tyreSets, f.events]).toEqual([[], [], []]);
  });
  it('closes frame N only when a packet for N+3 arrives', () => {
    const a = new FrameAssembler({ feedId });
    expect(pushAll(a, [...menuGroup(10, 1.0), ...menuGroup(11, 1.016), ...menuGroup(12, 1.032)])).toEqual([]);
    expect(ids(a.push(stub('lapData', 13, 1.048)))).toEqual([10]);
  });
  it('merges a packet for N that arrives after N+1 and N+2', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [stub('motion', 10, 1.0), stub('motion', 11, 1.016), stub('motion', 12, 1.032), stub('lapData', 10, 1.0)]);
    expect(a.flush()[0]!.lapData).toBeDefined();
    expect(a.metrics.latePackets).toBe(0);
  });
  it('drops and counts a packet more than 2 behind the newest; 2 behind is still accepted', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(10, 1.0), stub('motion', 13, 1.048)]);
    expect(a.push(stub('lapData', 10, 1.0))).toEqual([]);
    a.push(stub('lapData', 11, 1.016));
    expect(a.metrics.latePackets).toBe(1);
    expect(ids(a.flush())).toEqual([11, 13]);
  });
  it('does not count frameId gaps of 2 as loss', () => {
    const a = new FrameAssembler({ feedId });
    const out = [10, 12, 14, 16].flatMap((n, i) => pushAll(a, menuGroup(n, 1 + i * 0.016)));
    expect(ids([...out, ...a.flush()])).toEqual([10, 12, 14, 16]);
    expect(a.metrics).toMatchObject({ framesClosed: 4, incompleteFrames: 0, latePackets: 0 });
  });
  it('counts frames missing any menu-rate packet as incomplete', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, menuGroup(1, 0.016));
    (['lapData', 'motion', 'carTelemetry', 'carStatus', 'motionEx'] as const).forEach((skip, i) =>
      pushAll(a, menuGroup(2 + i, 0.032 + i * 0.016).filter((p) => p.packetId !== PacketId[skip])));
    a.flush();
    expect(a.metrics).toMatchObject({ framesClosed: 6, incompleteFrames: 5 });
  });
  it('appends multi-instance packets in arrival order; last single-instance packet wins; max session time in int ms', () => {
    const a = new FrameAssembler({ feedId });
    const last = stub('lapData', 5, 12.3456);
    pushAll(a, [stub('sessionHistory', 5, 12.3, { carIdx: 3 }), stub('event', 5, 12.3, { code: 'OVTK' }), stub('lapData', 5, 12.3401),
      stub('sessionHistory', 5, 12.3, { carIdx: 4 }), stub('tyreSets', 5, 12.3, { carIdx: 1 }), stub('tyreSets', 5, 12.3, { carIdx: 2 }),
      stub('event', 5, 12.3, { code: 'BUTN' }), last]);
    const f = a.flush()[0]!;
    expect(f.sessionHistory.map((p) => p.carIdx)).toEqual([3, 4]);
    expect(f.tyreSets.map((p) => p.carIdx)).toEqual([1, 2]);
    expect(f.events.map((p) => p.details.code)).toEqual(['OVTK', 'BUTN']);
    expect(f.lapData).toBe(last);
    expect(f.sessionTime).toBe(12346);
  });
  it('cadence is the median of positive steps (variable 12–20 ms)', () => {
    const a = new FrameAssembler({ feedId });
    expect(a.metrics.cadenceMs).toBeUndefined();
    [0, 12, 32, 32, 45, 64, 80].forEach((ms, i) => pushAll(a, menuGroup(i, ms / 1000)));
    a.flush();
    expect(a.metrics).toMatchObject({ cadenceMs: 16, lastSessionTime: 80 });   // steps 12, 20, (0 skipped), 13, 19, 16
  });
  it('cadence looks at the last 64 positive steps only', () => {
    const a = new FrameAssembler({ feedId });
    let t = 0;
    for (let i = 0; i < 91; i++) { pushAll(a, menuGroup(i, t / 1000)); t += i < 50 ? 20 : 12; }
    a.flush();
    expect(a.metrics.cadenceMs).toBe(12);   // over all 90 steps the median would be 20
  });
  it('orders by overallFrameId, so a flashback (frameId back, overall up) is not late', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(100, 2.0), ...menuGroup(101, 2.016)]);
    const out = [40, 41, 42].flatMap((n, i) => pushAll(a, menuGroup(n, 0.7 + i * 0.016, { overall: 102 + i })));
    expect([...out, ...a.flush()].map((f) => [f.frameId, f.overallFrameId])).toEqual([[100, 100], [101, 101], [40, 102], [41, 103], [42, 104]]);
    expect(a.metrics.latePackets).toBe(0);
  });
  it('attach() merges into the newest open frame whatever the packet frame id', () => {
    const a = new FrameAssembler({ feedId });
    pushAll(a, [...menuGroup(4137, 63.3), ...menuGroup(4138, 63.318)]);
    a.attach(stub('sessionHistory', 4138, 63.318, { uid: 0n, carIdx: 5 }));
    a.attach(stub('event', 0, 63.318, { code: 'SEND' }));
    const fs = a.flush();
    expect(ids(fs)).toEqual([4137, 4138]);
    expect(fs[1]!.events.map((e) => e.details.code)).toEqual(['SEND']);
    expect(fs[1]!.sessionHistory[0]!.header.sessionUid).toBe(0n);
    expect(a.metrics.latePackets).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/frame/assembler.test.ts`
Expected: FAIL (`FrameAssembler` is not exported)

- [ ] **Step 3: Implement `FrameAssembler` in `packages/engine/src/frame/assembler.ts`** (implementation agent; must not edit test files)

`frame.ts` holds the `Frame` type and a `packetId → slot` table (`motion, lapData, carTelemetry→telemetry, carStatus→status, motionEx, session, carDamage→damage, carSetups→setups, participants, lapPositions, finalClassification, timeTrial`; arrays: `sessionHistory, tyreSets, event→events`). `metrics.ts` holds `FrameMetrics` and `emptyMetrics()`. Open frames live in a `Map<key, Frame>`. `flush()` closes every open frame in ascending key order and keeps `newest`, so later packets more than 2 behind are still late. `attach()` with no open frame counts the packet in `latePackets` and drops it. No clock and no I/O.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test/frame/assembler.test.ts` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -F - <<'EOF'
feat(engine): add frame assembler with reorder window and loss metrics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Session tracker (lifecycle, UID-0 grace window)

**Files:**
- Create: `packages/engine/src/frame/session-tracker.ts`
- Modify: `packages/engine/src/index.ts` (export `SessionTracker`, `TrackerEvent`)
- Create (test helper, test agent): `apps/bridge/test/fixtures/replay.ts`
- Test: `packages/engine/test/frame/session-tracker.test.ts`, `apps/bridge/test/fixtures/session-tracker.fixture.test.ts`

**Interfaces:**
- Consumes: `FrameAssembler` (incl. `attach`), `Frame`, `FrameMetrics`, `stub`/`menuGroup` (Task 10); `decode`, `Packet` (Task 6); `readPwrec` (Task 7); `describeWithFixture`, `fixturePath`, `FixtureName` (Task 1).
- Produces (contract): `TrackerEvent`, `class SessionTracker { constructor(opts: { feedId: FeedId; graceMs?: number }); push(packet: Packet, receivedAtMs: number): TrackerEvent[]; end(): TrackerEvent[]; get metrics(): FrameMetrics }`.
- Produces (new, test helper for fixture tests of later tasks): `fixturePackets(name: FixtureName): AsyncGenerator<{ packet: Packet; receivedAtMs: number }>`, `type TrackedFixture = { lifecycle: Array<Exclude<TrackerEvent, { type: 'frame' }>>; frames: number; lastFrame: Frame | undefined; metrics: FrameMetrics }`, `trackFixture(name: FixtureName, onFrame?: (f: Frame) => void): Promise<TrackedFixture>` in `apps/bridge/test/fixtures/replay.ts`. Fixture tests live in the bridge because only the bridge may import both `engine` and the `.pwrec` reader.

**Rules pinned here (spec 5.3, refined by the fixtures):** In both full recordings the UID-0 SessionHistory bulk arrives **≈0.1 ms before** `SEND` (race: 20 packets, carIdx 0–19, frame 4138). `SEND` itself has the real UID but frame id 0. In TT the session's own SessionHistory and FinalClassification follow with frame id 0 at +0.3 s, +5.3 s and +10.3 s. So "within 10 s of SEND" applies on **both sides**:
1. No open session and no grace window: a UID-0 packet → `droppedUid0`; any other packet that is not a Session packet → `droppedBeforeSession`; a Session packet with UID ≠ 0 → `sessionStarted`, and the packet goes into a new `FrameAssembler`.
2. Open session: packets with its UID → `assembler.push`. UID-0 packets wait in a pending list. On every push, pending entries with `receivedAtMs` more than `graceMs` old move to `droppedUid0`. Another UID with a Session packet → flush (frames), `sessionEnded('replaced')`, pending → `droppedUid0`, then `sessionStarted`. Another UID without one → `droppedBeforeSession`.
3. `SEND` event of the open session: the pending packets, then the `SEND` packet, are `attach`ed (frame ids are unreliable here). The session enters the grace window with `sendAt = receivedAtMs`. Nothing is emitted yet.
4. Grace window: first, if `receivedAtMs − sendAt > graceMs` (default 10 000; exactly 10 000 is still inside), the window closes: flush → frames, then `sessionEnded('SEND')`. The packet is then handled by rule 1. Otherwise UID 0 or the ended UID → `attach`; a Session packet with a new UID closes the window the same way and then opens the new session; anything else → `droppedBeforeSession`.
5. `end()`: grace → flush + `sessionEnded('SEND')`; open session → flush + `sessionEnded('streamEnd')`; pending → `droppedUid0`.
- `metrics`: `framesClosed`, `incompleteFrames`, `latePackets` summed over every assembler this tracker created; `droppedBeforeSession`, `droppedUid0` from the tracker itself; `lastSessionTime`, `cadenceMs` from the newest assembler; `decodeErrors` 0.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/frame/session-tracker.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { Packet } from '@pitwall/protocol';
import { SessionTracker, type TrackerEvent } from '../../src/index.ts';
import { menuGroup, stub } from './stub-packet.ts';

type FrameEvent = Extract<TrackerEvent, { type: 'frame' }>;
const feedId = 'test' as FeedId;
const A = 0xaaaan, B = 0xbbbbn;
const feed = (t: SessionTracker, ps: Packet[], at: number) => ps.flatMap((p) => t.push(p, at));
const kinds = (es: TrackerEvent[]) => es.map((e) => (e.type === 'sessionEnded' ? `ended:${e.reason}` : e.type));
const ended = () => {   // session A with complete frames 1 and 2, received at 900 ms
  const t = new SessionTracker({ feedId });
  feed(t, [stub('session', 1, 0, { uid: A }), ...menuGroup(1, 0.016, { uid: A }), ...menuGroup(2, 0.032, { uid: A })], 900);
  return t;
};

describe('SessionTracker', () => {
  it('opens no session before the first Session packet with uid != 0', () => {
    const t = new SessionTracker({ feedId });
    expect(feed(t, [stub('event', 0, 0, { uid: A }), ...menuGroup(0, 0, { uid: A }), stub('session', 0, 0, { uid: 0n })], 0)).toEqual([]);
    expect(t.metrics).toMatchObject({ droppedBeforeSession: 6, droppedUid0: 1 });
    expect(t.push(stub('session', 1, 0.016, { uid: A }), 100))
      .toEqual([{ type: 'sessionStarted', sessionUid: A, session: expect.objectContaining({ packetId: 1 }), receivedAtMs: 100 }]);
  });
  it('emits frames of the open session and ends with streamEnd', () => {
    const t = new SessionTracker({ feedId });
    const es = [1, 2, 3, 4].flatMap((n) => feed(t, [...(n === 1 ? [stub('session', 1, 0, { uid: A })] : []), ...menuGroup(n, n * 0.016, { uid: A })], n * 16));
    expect(kinds(es)).toEqual(['sessionStarted', 'frame']);
    expect(es[1]).toMatchObject({ type: 'frame', sessionUid: A, frame: { frameId: 1 } });
    expect(kinds(t.end())).toEqual(['frame', 'frame', 'frame', 'ended:streamEnd']);
  });
  it('drops another uid without a Session packet; a new uid with one replaces the session', () => {
    const t = ended();
    expect(t.push(stub('lapData', 3, 0.048, { uid: B }), 950)).toEqual([]);
    expect(t.metrics.droppedBeforeSession).toBe(1);
    const es = t.push(stub('session', 0, 0, { uid: B }), 1000);
    expect(es.map((e) => [e.type, e.sessionUid])).toEqual([['frame', A], ['frame', A], ['sessionEnded', A], ['sessionStarted', B]]);
    expect(es[2]).toMatchObject({ reason: 'replaced' });
  });
  it('after SEND, uid-0 packets within 10 s join the ended session; the first packet after 10 s closes it', () => {
    const t = ended();
    expect(t.push(stub('event', 0, 0.032, { uid: A, code: 'SEND' }), 1000)).toEqual([]);
    expect(t.push(stub('finalClassification', 0, 0.032, { uid: 0n }), 4000)).toEqual([]);
    expect(t.push(stub('sessionHistory', 0, 0.032, { uid: 0n, carIdx: 3 }), 11_000)).toEqual([]);
    const es = t.push(stub('sessionHistory', 0, 0.032, { uid: 0n, carIdx: 4 }), 11_001);
    expect(kinds(es)).toEqual(['frame', 'frame', 'ended:SEND']);
    const last = (es[1] as FrameEvent).frame;
    expect(last.frameId).toBe(2);
    expect(last.finalClassification).toBeDefined();
    expect(last.sessionHistory.map((p) => p.carIdx)).toEqual([3]);
    expect(last.events.map((e) => e.details.code)).toEqual(['SEND']);
    expect(t.metrics).toMatchObject({ droppedUid0: 1, latePackets: 0 });
  });
  it('keeps uid-0 packets received up to 10 s before SEND (fixture order: bulk, then SEND)', () => {
    const t = ended();
    t.push(stub('sessionHistory', 2, 0.032, { uid: 0n, carIdx: 1 }), 900);
    t.push(stub('sessionHistory', 2, 0.032, { uid: 0n, carIdx: 2 }), 5000);
    t.push(stub('event', 0, 0.032, { uid: A, code: 'SEND' }), 10_901);
    const es = t.end();
    expect(kinds(es)).toEqual(['frame', 'frame', 'ended:SEND']);
    expect((es[1] as FrameEvent).frame.sessionHistory.map((p) => p.carIdx)).toEqual([2]);
    expect(t.metrics.droppedUid0).toBe(1);
  });
  it('drops uid-0 packets of a session that never sees SEND', () => {
    const t = ended();
    t.push(stub('sessionHistory', 2, 0.032, { uid: 0n }), 950);
    const es = t.end();
    expect(kinds(es)).toEqual(['frame', 'frame', 'ended:streamEnd']);
    expect((es[1] as FrameEvent).frame.sessionHistory).toEqual([]);
    expect(t.metrics.droppedUid0).toBe(1);
  });
  it('a new session inside the grace window first ends the old one with SEND; metrics add up', () => {
    const t = ended();
    t.push(stub('event', 0, 0.032, { uid: A, code: 'SEND' }), 1000);
    const es = t.push(stub('session', 0, 0, { uid: B }), 2000);
    expect(es.map((e) => [e.type, e.sessionUid])).toEqual([['frame', A], ['frame', A], ['sessionEnded', A], ['sessionStarted', B]]);
    expect(es[2]).toMatchObject({ reason: 'SEND' });
    expect(kinds(t.end())).toEqual(['frame', 'ended:streamEnd']);
    expect(t.metrics).toMatchObject({ framesClosed: 3, incompleteFrames: 1 });   // B's frame 0 holds only the Session packet
  });
});
```

```ts
// apps/bridge/test/fixtures/replay.ts — frames are folded, never collected (TT has 71 448 frames)
import type { FeedId } from '@pitwall/domain';
import { decode, type Packet } from '@pitwall/protocol';
import { SessionTracker, type Frame, type FrameMetrics, type TrackerEvent } from '@pitwall/engine';
import { fixturePath, type FixtureName } from '../../../../test-support/fixtures.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';

export async function* fixturePackets(name: FixtureName): AsyncGenerator<{ packet: Packet; receivedAtMs: number }> {
  for await (const r of readPwrec(fixturePath(name)!)) {
    const d = decode(r.payload);
    if (d.ok) yield { packet: d.packet, receivedAtMs: r.t };
  }
}
export type TrackedFixture = { lifecycle: Array<Exclude<TrackerEvent, { type: 'frame' }>>; frames: number; lastFrame: Frame | undefined; metrics: FrameMetrics };
export async function trackFixture(name: FixtureName, onFrame: (f: Frame) => void = () => {}): Promise<TrackedFixture> {
  const tracker = new SessionTracker({ feedId: name as string as FeedId });
  const out: TrackedFixture = { lifecycle: [], frames: 0, lastFrame: undefined, metrics: tracker.metrics };
  const take = (es: TrackerEvent[]) => { for (const e of es) if (e.type === 'frame') { out.frames++; out.lastFrame = e.frame; onFrame(e.frame); } else out.lifecycle.push(e); };
  for await (const { packet, receivedAtMs } of fixturePackets(name)) take(tracker.push(packet, receivedAtMs));
  take(tracker.end());
  return { ...out, metrics: tracker.metrics };
}
```

```ts
// apps/bridge/test/fixtures/session-tracker.fixture.test.ts
import { expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { trackFixture } from './replay.ts';

const started = (r: Awaited<ReturnType<typeof trackFixture>>) => r.lifecycle.filter((e) => e.type === 'sessionStarted').map((e) => e.sessionUid);
describeWithFixture('menuOnly', 'menu-only recording', () => {
  it('opens no session', async () => {
    const r = await trackFixture('menuOnly');
    expect([r.lifecycle, r.frames]).toEqual([[], 0]);
    expect(r.metrics).toMatchObject({ droppedBeforeSession: 230, droppedUid0: 155 });
  });
});
describeWithFixture('raceSingapore', 'Singapore race', () => {
  it('one session ended by SEND; the UID-0 SessionHistory bulk lands in its last frame', async () => {
    let uid0History = 0;
    const r = await trackFixture('raceSingapore', (f) => { uid0History += f.sessionHistory.filter((p) => p.header.sessionUid === 0n).length; });
    expect(started(r)).toEqual([0xb3cd07e2790bdcben]);
    expect(r.lifecycle.at(-1)).toEqual({ type: 'sessionEnded', sessionUid: 0xb3cd07e2790bdcben, reason: 'SEND' });
    expect(r.frames).toBe(4139);
    expect(uid0History).toBe(20);
    expect(r.lastFrame!.frameId).toBe(4138);
    expect(r.lastFrame!.sessionHistory.filter((p) => p.header.sessionUid === 0n).map((p) => p.carIdx)).toEqual([...Array(20).keys()]);
    expect(r.lastFrame!.events.at(-1)!.details.code).toBe('SEND');
    expect(r.metrics).toMatchObject({ droppedBeforeSession: 8, droppedUid0: 0, latePackets: 0, incompleteFrames: 2 });
  });
});
describeWithFixture('ttZandvoort', 'Zandvoort time trial', () => {
  it('keeps the UID-0 bulk and the post-SEND FinalClassification; drops the menu afterwards', async () => {
    const r = await trackFixture('ttZandvoort');
    expect(started(r)).toEqual([0x1a4f5531395c7884n]);
    expect(r.lifecycle.at(-1)).toMatchObject({ type: 'sessionEnded', reason: 'SEND' });
    expect(r.frames).toBe(71448);
    expect(r.lastFrame!.sessionHistory.filter((p) => p.header.sessionUid === 0n).map((p) => p.carIdx)).toEqual([...Array(15).keys()]);
    expect(r.lastFrame!.finalClassification).toBeDefined();
    expect(r.metrics).toMatchObject({ droppedBeforeSession: 17, droppedUid0: 94, latePackets: 0 });   // 1 SSTA before; 16 own-UID packets at +10.3 s
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/frame/session-tracker.test.ts apps/bridge/test/fixtures/session-tracker.fixture.test.ts`
Expected: FAIL (`SessionTracker` is not exported)

- [ ] **Step 3: Implement `SessionTracker` in `packages/engine/src/frame/session-tracker.ts`** (implementation agent; must not edit test files)

A small explicit state, `{ open?: { uid, assembler }; grace?: { uid, assembler, sendAt }; pending: Array<{ packet, receivedAtMs }> }`, applying rules 1–5 in that order. `frame` events carry the session's `sessionUid`. `receivedAtMs` is input only, never a clock.

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2. Expected: PASS (fixture tests are skipped with a note when the recordings are missing)

- [ ] **Step 5: Commit**

```bash
git add packages/engine apps/bridge/test/fixtures && git commit -F - <<'EOF'
feat(engine): add session tracker with SEND grace window for UID-0 packets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Test builders (packets and frames via encoder)

**Files:**
- Create: `packages/engine/test/builders/packet.ts`, `packages/engine/test/builders/scenario.ts`, `packages/engine/test/builders/index.ts`
- Test: `packages/engine/test/builders/builders.test.ts`

**Interfaces:**
- Consumes: `decode`, `encode`, `headerSchema`, `writeField`, `PACKET_SIZES`, `PacketId`, `PacketName`, `PacketOf`, `PacketHeader`, `EventDetails` (Tasks 3–6); `SessionTracker`, `Frame` (Tasks 10–11); `FeedId`, `SessionTime` (Task 9).
- Produces (contract): `headerFor(id: PacketName, o?: Partial<PacketHeader>): PacketHeader`, `buildPacket<N extends PacketName>(name: N, o?: DeepPartial<PacketOf<N>>): PacketOf<N>`, `packetBytes(p: Packet): Uint8Array`, `class ScenarioBuilder { constructor(o?: { sessionUid?: bigint; cars?: number; player?: number; stepMs?: number }); session(o?): this; participants(o?): this; frame(fn: (f: FrameDraft) => void): this; frames(n: number, fn: (f: FrameDraft, i: number) => void): this; event(details: EventDetails): this; packets(): Array<{ packet: Packet; receivedAtMs: number }>; build(): Frame[] }`.
- Produces (new):
  ```ts
  type DeepPartial<T> = T extends bigint | number | string | boolean ? T
    : T extends readonly (infer U)[] ? { [i: number]: DeepPartial<U> }      // arrays merge element-wise by index
    : { [K in keyof T]?: DeepPartial<T[K]> };
  type MenuSlot = 'motion' | 'lapData' | 'telemetry' | 'status' | 'motionEx';
  type FrameDraft = { readonly index: number; readonly sessionTime: SessionTime;
    motion: MotionPacket; lapData: LapDataPacket; telemetry: CarTelemetryPacket; status: CarStatusPacket; motionEx: MotionExPacket;
    add<N extends PacketName>(name: N, o?: DeepPartial<PacketOf<N>>): PacketOf<N>; drop(slot: MenuSlot): void };
  ```

**Defaults pinned here:**
- `headerFor`: `packetFormat 2025, gameYear 25, gameMajorVersion 1, gameMinorVersion 0, packetVersion 1, packetId PacketId[id], sessionUid 1n, sessionTime 0, frameIdentifier 0, overallFrameIdentifier 0, playerCarIndex 0, secondaryPlayerCarIndex 255`.
- `buildPacket`: the decode of a zero-filled body of `PACKET_SIZES[name]` bytes (arrays therefore hold 22 cars), with the event code from `o.details.code` (default `'SSTA'`). `o` is then deep-merged on top, and `o.header` goes through `headerFor`.
- `ScenarioBuilder` (defaults `sessionUid 1n, cars 20, player 0, stepMs 16`): frame `i` has `frameIdentifier = overallFrameIdentifier = i`, `sessionTime = i·stepMs` (header seconds = ms/1000) and `receivedAtMs = i·stepMs`. Every header has `playerCarIndex = player`. Frame 0 starts with a pending default Session and Participants packet. `session(o)`/`participants(o)` called before the first frame replace those; called later, they (and `event`) queue a packet for the next frame. In a frame, packets arrive as: queued, then `add`ed, then the menu group. Each frame's menu packets start as a `structuredClone` of the previous frame's (carry forward) with fresh headers. Queued packets with no frame after them go into one extra frame without a menu group. `packets()` returns every packet after an `encode` → `decode` round trip, so f32 rounding and field ranges are real (spec 10.2: frames through the encoder). `build()` runs a `SessionTracker({ feedId: 'scenario' })` over `packets()`, then `end()`, and returns the frames.
- Scenario defaults (`session(o)`/`participants(o)` deep-merge `o` over these): Session `{ sessionType: 15, trackId: 0, totalLaps: 10, trackLength: 5000, sector2LapDistanceStart: 1500, sector3LapDistanceStart: 3300, trackTemperature: 30, airTemperature: 22, pitSpeedLimit: 80, sessionDuration: 3600, sessionTimeLeft: 3600, tyreTemperature: 1 }`. Participants: `numActiveCars = cars`; for `i < cars`: `aiControlled = i === player ? 0 : 1`, `driverId = i === player ? 255 : i`, `networkId = i === player ? 0 : 255`, `teamId = ⌊i/2⌋`, `raceNumber = i + 1`, `name = 'DRIVER ' + i`, `yourTelemetry 1`. LapData for `i < cars`: `carPosition = gridPosition = i + 1`, `currentLapNum 1`, `resultStatus 2`, `driverStatus 4`. CarStatus for `i < cars`: `actualTyreCompound 18`, `visualTyreCompound 17`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/builders/builders.test.ts
import { describe, expect, it } from 'vitest';
import { decode, PACKET_SIZES, type PacketName } from '@pitwall/protocol';
import { buildPacket, headerFor, packetBytes, ScenarioBuilder } from './index.ts';

describe('buildPacket', () => {
  it.each(Object.keys(PACKET_SIZES) as PacketName[])('%s encodes to its spec size and decodes back equal', (name) => {
    const p = buildPacket(name);
    const bytes = packetBytes(p);
    expect(bytes.length).toBe(PACKET_SIZES[name]);
    expect(decode(bytes)).toEqual({ ok: true, packet: p });
  });
  it('header defaults and overrides', () => {
    expect(headerFor('lapData')).toMatchObject({ packetFormat: 2025, packetId: 2, sessionUid: 1n, secondaryPlayerCarIndex: 255 });
    expect(buildPacket('motion', { header: { frameIdentifier: 7 } }).header).toMatchObject({ packetId: 0, frameIdentifier: 7 });
  });
  it('merges array overrides by index and keeps 22 cars', () => {
    const p = buildPacket('lapData', { lapData: { 3: { carPosition: 4 } } });
    expect([p.lapData.length, p.lapData[3]!.carPosition, p.lapData[2]!.carPosition]).toEqual([22, 4, 0]);
  });
  it('builds event details for the given code', () => {
    expect(buildPacket('event', { details: { code: 'FTLP', vehicleIdx: 2, lapTime: 80.5 } }).details).toEqual({ code: 'FTLP', vehicleIdx: 2, lapTime: 80.5 });
  });
});

describe('ScenarioBuilder', () => {
  it('build() yields one frame per frame() with the menu-rate group, session and participants first', () => {
    const fs = new ScenarioBuilder({ cars: 3, player: 2, stepMs: 20 }).frames(3, () => {}).build();
    expect(fs.map((f) => [f.frameId, f.sessionTime, f.playerCarIndex])).toEqual([[0, 0, 2], [1, 20, 2], [2, 40, 2]]);
    for (const f of fs) for (const k of ['motion', 'lapData', 'telemetry', 'status', 'motionEx'] as const) expect(f[k]).toBeDefined();
    expect(fs[0]!.participants).toMatchObject({ numActiveCars: 3 });
    expect(fs[0]!.participants!.participants[2]).toMatchObject({ aiControlled: 0, networkId: 0, teamId: 1, raceNumber: 3 });
    expect(fs[1]!.lapData!.lapData[1]).toMatchObject({ carPosition: 2, currentLapNum: 1, resultStatus: 2 });
    expect([fs[0]!.session!.trackLength, fs[1]!.session]).toEqual([5000, undefined]);
  });
  it('carries draft changes forward; drop() and add() shape single frames', () => {
    const fs = new ScenarioBuilder({ cars: 2 })
      .frame((d) => { d.lapData.lapData[0]!.currentLapNum = 2; })
      .frame((d) => d.drop('motion'))
      .frame((d) => { d.add('carDamage'); })
      .build();
    expect(fs[1]!.lapData!.lapData[0]!.currentLapNum).toBe(2);
    expect([fs[1]!.motion, fs[2]!.motion === undefined]).toEqual([undefined, false]);
    expect(fs[2]!.damage).toBeDefined();
  });
  it('queues session(), participants() and event() into the next frame; trailing ones get their own frame', () => {
    const fs = new ScenarioBuilder({ cars: 2 }).frames(1, () => {})
      .session({ totalLaps: 5 }).event({ code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }).frames(1, () => {})
      .event({ code: 'FTLP', vehicleIdx: 1, lapTime: 80 }).build();
    expect(fs).toHaveLength(3);
    expect(fs[1]!.session!.totalLaps).toBe(5);
    expect(fs[1]!.events.map((e) => e.details.code)).toEqual(['OVTK']);
    expect([fs[2]!.events[0]!.details.code, fs[2]!.lapData]).toEqual(['FTLP', undefined]);
  });
  it('packets() starts with the Session packet and has non-decreasing receivedAtMs', () => {
    const ps = new ScenarioBuilder({ sessionUid: 42n }).frames(4, () => {}).packets();
    expect(ps[0]!.packet).toMatchObject({ packetId: 1, header: { sessionUid: 42n } });
    expect(ps.every((p, i) => i === 0 || p.receivedAtMs >= ps[i - 1]!.receivedAtMs)).toBe(true);
    expect(ps.at(-1)!.receivedAtMs).toBe(48);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/builders`
Expected: FAIL (`./index.ts` does not exist)

- [ ] **Step 3: Implement the builders in `packages/engine/test/builders/{packet,scenario}.ts`** (implementation agent; must not edit `*.test.ts`)

`packetBytes = encode`. Deep merge: plain objects key by key, arrays index by index (`undefined` entries and holes keep the default), primitives and bigints replace. `ScenarioBuilder` keeps `pending: Packet[]`, `prev: Record<MenuSlot, Packet>` and `out: Array<{ packet; receivedAtMs }>`. It holds no clock: time comes only from the frame index.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test/builders` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/test/builders && git commit -F - <<'EOF'
test(engine): add packet and scenario builders driven by the encoder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: `step`: session state and car identity

**Files:**
- Create: `packages/engine/src/step/initial-state.ts`, `packages/engine/src/step/step.ts`, `packages/engine/src/step/session.ts`, `packages/engine/src/step/identity.ts`
- Modify: `packages/engine/src/index.ts` (export `initialState`, `step`, `ChangeTag`, `LapCorrection`)
- Test: `packages/engine/test/step/session.test.ts`, `packages/engine/test/step/identity.test.ts`, `apps/bridge/test/fixtures/identity.fixture.test.ts`

**Interfaces:**
- Consumes: domain types, `known`, `unknown`, `carId`, `sessionUidString`, `toSessionTime`, `MAX_CARS`, `EngineState`, `WeekendContext` (Task 9); `Frame` (Task 10); `trackFixture` (Task 11); `buildPacket`, `ScenarioBuilder` (Task 12).
- Produces (contract): `ChangeTag`, `LapCorrection`, `initialState(init: { feedId: FeedId; sessionUid: bigint; session: SessionPacket; weekend?: WeekendContext }): EngineState`, `step(state: EngineState, frame: Frame): { changed: Set<ChangeTag>; corrections: LapCorrection[] }`.
- Produces (new, extension points for Task 14–16): `type StepOutput = { changed: Set<ChangeTag>; corrections: LapCorrection[] }`; `type SubStep = (state: EngineState, frame: Frame, out: StepOutput) => void`; `SUB_STEPS: SubStep[]` in `step.ts` (Task 13 registers `applySession`, `applyIdentity`; later tasks append theirs); `createCarState(id: CarId): CarState`; `sessionStateFrom(p: SessionPacket, numActiveCars: number): SessionState`; `sessionKindOf(sessionType: number): SessionKind`; `isActiveCar(index: number, numActiveCars: number, resultStatus: ResultStatus): boolean`.

**Rules pinned here:**
- `step` runs `SUB_STEPS` in order, then, if `changed` has `participants` or `timing`, recomputes `car.active = isActiveCar(…)` for all cars (index < `numActiveCars` and `resultStatus` not `invalid`/`inactive`). It then sets `lastFrameId = frame.frameId` and `sessionTime = frame.sessionTime`.
- `applySession`: a frame with `session` → `state.session = sessionStateFrom(p, state.session.numActiveCars)`, tag `session`. Mappings: kind 1–4 practice, 5–9 qualifying, 10–14 sprintShootout, 15–17 race, 18 timeTrial, otherwise unknown. Weather 0–5 → `clear…storm`. Trend 0 up / 1 down / 2 flat. Zone flag −1…3 → `unknown, none, green, blue, yellow`. `safetyCarStatus` 0–3 → `green, sc, vsc, formation`. Seconds ×1000 → ms. `forecast`, `marshalZones` and `weekendStructure` are cut to their `num…` counts. `pitLaneTyreSim = code === 0` (the game sends 0 = on). Other settings use the order of the struct comments. Out-of-range codes map to the first entry. `updatedAt = toSessionTime(header.sessionTime)`.
- `applyIdentity`: `playerCar = frame.playerCarIndex` on every frame. A frame with `participants` sets `session.numActiveCars` and fills the identity of each slot. `driverKey`: AI → `{ kind: 'ai', driverId }`, human → `{ kind: 'human', networkId, name, raceNumber }`. `visibility`: player → `own`; AI or `yourTelemetry === 1` → `public`; otherwise `restricted`. When participants arrive or `playerCar` changes: tag `participants`; only the player car holds `ownCar` (created with every field `unknown('notReceived')`, moved when the player changes); `teammateCar` = the lowest index `i ≠ playerCar` with the player's `teamId` and `isActiveCar(i, numActiveCars, cars[i].timing.resultStatus)`, else `undefined`. `identity.telemetryPublic = yourTelemetry === 1`, so visibility can be re-derived when the player changes without a new Participants packet. The LapData → `resultStatus` → `active` path is tested in Task 14.
- `initialState`: `MAX_CARS` cars from `createCarState(carId(i))`: identity `{ name: '', teamId: 255, ai: true, driverId: 255, networkId: 255, platform: 255, driverKey: { kind: 'ai', driverId: 255 }, visibility: 'public', … 0/false }`, `active: false`, `timing.resultStatus: 'active'` (assumed until the first LapData), `sector: 1`, `pitStatus: 'none'`, `driverStatus: 'inGarage'`, `fiaFlag: 'unknown'`, `speedTrapFastestKmh: undefined`, compounds `'unknown'`, every `Known` field `unknown('notReceived')`, numbers 0, booleans false. Also `sessionUid = sessionUidString(uid)`, `playerCar = header.playerCarIndex` (with its `ownCar`), `session = sessionStateFrom(p, 0)`, empty history, `open = { laps, stints, pitVisits, miniSectors, pitStatus }` each `Array(22).fill(undefined)`, `lapIndex` = 22 × `{}`, `lastFlag = session.flag` (no `flagPhase`), `lastFrameId = header.frameIdentifier`, `sessionTime = toSessionTime(header.sessionTime)`, and `weekend` if given.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/step/session.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { initialState, step } from '../../src/index.ts';
import { sessionKindOf } from '../../src/step/session.ts';
import { buildPacket, ScenarioBuilder } from '../builders/index.ts';

const feedId = 'test' as FeedId;
const nr = { known: false, reason: 'notReceived' };
const packet = buildPacket('session', { header: { sessionTime: 12.5 }, weather: 3, trackTemperature: 31, airTemperature: 24, totalLaps: 57,
  trackLength: 5412, sessionType: 15, trackId: 3, sessionDuration: 7200, sessionTimeLeft: 7000, pitSpeedLimit: 80, safetyCarStatus: 2, networkGame: 1,
  numMarshalZones: 2, marshalZones: { 0: { zoneStart: 0.125, zoneFlag: 3 }, 1: { zoneStart: 0.5, zoneFlag: -1 } }, numWeatherForecastSamples: 2,
  weatherForecastSamples: { 0: { sessionType: 15, timeOffset: 5, weather: 4, trackTemperature: 30, trackTemperatureChange: 1, airTemperature: 23,
    airTemperatureChange: 2, rainPercentage: 60 }, 1: { sessionType: 15, timeOffset: 10, weather: 5 } }, forecastAccuracy: 1, weekendLinkIdentifier: 77,
  numSafetyCarPeriods: 1, tyreTemperature: 0, safetyCar: 3, redFlags: 1, carDamage: 2, carDamageRate: 2, lowFuelMode: 1, recoveryMode: 1,
  flashbackLimit: 3, surfaceType: 1, collisions: 1, pitLaneTyreSim: 0, parcFermeRules: 1, sector2LapDistanceStart: 1800.5, sector3LapDistanceStart: 3600.25 });

describe('session state', () => {
  it('maps the Session packet', () => {
    const s = initialState({ feedId, sessionUid: 9n, session: packet }).session;
    expect(s).toMatchObject({ trackId: 3, sessionType: 15, kind: 'race', totalLaps: 57, trackLengthM: 5412, sector2StartM: 1800.5, sector3StartM: 3600.25,
      durationMs: 7_200_000, timeLeftMs: 7_000_000, pitSpeedLimitKmh: 80, weather: 'lightRain', trackTempC: 31, airTempC: 24, flag: 'vsc',
      networkGame: true, forecastAccuracy: 'approximate', periods: { sc: 1, vsc: 0, red: 0 }, link: { weekend: 77 }, numActiveCars: 0, updatedAt: 12500 });
    expect(s.marshalZones).toEqual([{ startFraction: 0.125, flag: 'yellow' }, { startFraction: 0.5, flag: 'unknown' }]);
    expect(s.forecast).toEqual([{ sessionType: 15, offsetMin: 5, weather: 'heavyRain', trackTempC: 30, trackTempTrend: 'down', airTempC: 23,
      airTempTrend: 'flat', rainPct: 60 }, expect.objectContaining({ offsetMin: 10, weather: 'storm' })]);
    expect(s.settings).toMatchObject({ tyreTemperature: 'surfaceOnly', safetyCar: 'increased', redFlags: 'reduced', carDamage: 'standard',
      carDamageRate: 'simulation', lowFuelMode: 'hard', recoveryMode: 'flashbacks', flashbackLimit: 'unlimited', surfaceType: 'realistic',
      collisions: 'playerToPlayerOff', pitLaneTyreSim: true, parcFerme: true });
  });
  it.each([[0, 'unknown'], [1, 'practice'], [4, 'practice'], [5, 'qualifying'], [9, 'qualifying'], [10, 'sprintShootout'], [14, 'sprintShootout'],
    [15, 'race'], [17, 'race'], [18, 'timeTrial'], [19, 'unknown']] as const)('sessionType %i is %s', (code, kind) => expect(sessionKindOf(code)).toBe(kind));
  it('initialState: 22 cars by id, player from the header, unknown data, empty history', () => {
    const st = initialState({ feedId, sessionUid: 0xb3cd07e2790bdcben, session: buildPacket('session', { header: { playerCarIndex: 4, frameIdentifier: 9 } }) });
    expect(st.cars.map((c) => c.id)).toEqual([...Array(22).keys()]);
    expect([st.feedId, st.sessionUid, st.playerCar, st.teammateCar, st.lastFrameId]).toEqual([feedId, '12956020372289608894', 4, undefined, 9]);
    expect(Object.values(st.history).every((h) => h.length === 0)).toBe(true);
    expect(st.cars[4]!.ownCar).toEqual({ motionEx: nr, setup: nr, brakeBiasPct: nr });
    expect([st.cars[3]!.ownCar, st.cars[3]!.energy.fuel, st.cars[3]!.active]).toEqual([undefined, nr, false]);
  });
  it('step updates the session only on frames with a Session packet', () => {
    const fs = new ScenarioBuilder({ cars: 2 }).frames(2, () => {}).session({ totalLaps: 5, safetyCarStatus: 1 }).frames(1, () => {}).build();
    const st = initialState({ feedId, sessionUid: fs[0]!.sessionUid, session: fs[0]!.session! });
    expect(fs.map((f) => step(st, f).changed.has('session'))).toEqual([true, false, true]);
    expect([st.session.totalLaps, st.session.flag, st.session.numActiveCars, st.lastFrameId, st.sessionTime]).toEqual([5, 'sc', 2, 2, 32]);
  });
});
```

```ts
// packages/engine/test/step/identity.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { initialState, step } from '../../src/index.ts';
import { isActiveCar } from '../../src/step/identity.ts';
import { ScenarioBuilder } from '../builders/index.ts';

const run = (b: ScenarioBuilder) => {
  const frames = b.build();
  const st = initialState({ feedId: 'test' as FeedId, sessionUid: frames[0]!.sessionUid, session: frames[0]!.session! });
  return { st, frames, results: frames.map((f) => step(st, f)) };
};

describe('car identity', () => {
  it('AI: DriverKey by driverId, public', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).frames(1, () => {}));
    expect(st.cars[2]!.identity).toMatchObject({ name: 'DRIVER 2', teamId: 1, raceNumber: 3, ai: true, driverKey: { kind: 'ai', driverId: 2 }, visibility: 'public' });
  });
  it('player = header.playerCarIndex: human DriverKey, own, holds ownCar', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4, player: 3 }).frames(1, () => {}));
    expect(st.playerCar).toBe(3);
    expect(st.cars[3]!.identity).toMatchObject({ ai: false, driverKey: { kind: 'human', networkId: 0, name: 'DRIVER 3', raceNumber: 4 }, visibility: 'own' });
    expect([st.cars[3]!.ownCar !== undefined, st.cars[0]!.ownCar]).toEqual([true, undefined]);
  });
  it('human non-player with yourTelemetry 0 is restricted; 1 is public; AI is public regardless', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).participants({ participants: { 1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 },
      2: { aiControlled: 0, networkId: 6, yourTelemetry: 1 }, 3: { yourTelemetry: 0 } } }).frames(1, () => {}));
    expect([1, 2, 3].map((i) => st.cars[i]!.identity.visibility)).toEqual(['restricted', 'public', 'public']);
    expect(st.cars[1]!.identity.driverKey).toEqual({ kind: 'human', networkId: 5, name: 'DRIVER 1', raceNumber: 2 });
  });
  it('active cars follow numActiveCars', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).participants({ numActiveCars: 3 }).frames(1, () => {}));
    expect(st.cars.slice(0, 5).map((c) => c.active)).toEqual([true, true, true, false, false]);
  });
  it.each([['active', true], ['finished', true], ['retired', true], ['didNotFinish', true], ['invalid', false], ['inactive', false]] as const)(
    'isActiveCar: resultStatus %s -> %s', (rs, active) => {
      expect(isActiveCar(2, 3, rs)).toBe(active);
      expect(isActiveCar(3, 3, rs)).toBe(false);
    });
  it('teammate: same teamId as the player, not the player, active', () => {
    expect(run(new ScenarioBuilder({ cars: 6, player: 4 }).frames(1, () => {})).st.teammateCar).toBe(5);
    expect(run(new ScenarioBuilder({ cars: 6, player: 4 }).participants({ numActiveCars: 5 }).frames(1, () => {})).st.teammateCar).toBeUndefined();
  });
  it('tags participants on Participants frames and when the player changes', () => {
    const { st, frames, results } = run(new ScenarioBuilder({ cars: 2 }).frames(2, () => {}));
    expect(results.map((r) => r.changed.has('participants'))).toEqual([true, false]);
    const r = step(st, { ...frames[1]!, playerCarIndex: 1 });
    expect([r.changed.has('participants'), st.playerCar, st.cars[1]!.identity.visibility, st.cars[0]!.identity.visibility]).toEqual([true, 1, 'own', 'public']);
    expect([st.cars[1]!.ownCar !== undefined, st.cars[0]!.ownCar]).toEqual([true, undefined]);
  });
});
```

```ts
// apps/bridge/test/fixtures/identity.fixture.test.ts
import { expect, it } from 'vitest';
import { driverKeyString, type FeedId } from '@pitwall/domain';
import { initialState, step, type EngineState } from '@pitwall/engine';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { trackFixture } from './replay.ts';

describeWithFixture('raceSingapore', 'session and identity of the Singapore race', () => {
  it('5-lap race, 20 active cars, human player HAMILTON at index 19, teammate LECLERC at 14', async () => {
    const box: { st?: EngineState } = {};
    await trackFixture('raceSingapore', (f) => {
      if (!box.st && f.session) box.st = initialState({ feedId: 'race' as FeedId, sessionUid: f.sessionUid, session: f.session });
      if (box.st) step(box.st, f);
    });
    const st = box.st;
    expect(st!.session).toMatchObject({ kind: 'race', sessionType: 15, trackId: 12, totalLaps: 5, trackLengthM: 4928, numActiveCars: 20 });
    expect([st!.playerCar, st!.teammateCar]).toEqual([19, 14]);
    expect(st!.cars[19]!.identity).toMatchObject({ ai: false, visibility: 'own', driverKey: { kind: 'human', networkId: 255, name: 'HAMILTON', raceNumber: 44 } });
    expect(driverKeyString(st!.cars[0]!.identity.driverKey)).toBe('ai:9');
    expect(st!.cars.filter((c) => c.active)).toHaveLength(20);
    expect([st!.cars[20]!.active, st!.cars[21]!.active]).toEqual([false, false]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/step apps/bridge/test/fixtures/identity.fixture.test.ts`
Expected: FAIL (`initialState`/`step` are not exported)

- [ ] **Step 3: Implement `initialState` and `step` in `packages/engine/src/step/`** (implementation agent; must not edit test files)

Every code → name mapping is an `as const` lookup table next to its sub-step, read with one `pick(table, code, fallback)` helper. `step` mutates `state` in place and returns `{ changed, corrections: [] }`; this task never fills `corrections` (Task 15 does).

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2. Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine apps/bridge/test/fixtures/identity.fixture.test.ts && git commit -F - <<'EOF'
feat(engine): derive session state and car identity in step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 14: `step`: timing, tyres, energy, condition, dynamics, own car

**Files:**
- Create: `packages/engine/src/step/timing.ts`, `tyres.ts`, `energy.ts`, `condition.ts`, `dynamics.ts`, `own-car.ts` (in `packages/engine/src/step/`)
- Modify: `packages/engine/src/step/step.ts` (append the six sub-steps to `SUB_STEPS` after `applySession`, `applyIdentity`)
- Create (test support, test agent): `packages/engine/test/support/run.ts`
- Test: `packages/engine/test/step/timing.test.ts`, `packages/engine/test/step/car-state.test.ts`

**Interfaces:**
- Consumes: `initialState`, `step`, `SubStep`, `StepOutput`, `SUB_STEPS`, `ChangeTag`, `isActiveCar` (Task 13); `CarState` and its sub-types `CarTiming`, `CarTyres`, `TyreCorner`, `TyreSet`, `CarEnergy`, `CarCondition`, `CarDynamics`, `OwnCarState`, `OwnCarMotionEx`, `CarSetup`, `SessionState.settings.tyreTemperature`, `known`, `unknown`, `cornersFromGameOrder`, `actualCompoundFromCode`, `visualCompoundFromCode` (Task 9, used verbatim); `ScenarioBuilder`, `FrameDraft` (Task 12); `Frame` (Task 10).
- Produces: `applyTiming`, `applyTyres`, `applyEnergy`, `applyCondition`, `applyDynamics`, `applyOwnCar: SubStep`. Test support: `initFor(frames: Frame[]): Parameters<typeof initialState>[0]` (`feedId 'test'`, `sessionUid` and `session` from `frames[0]`); `runFrames(frames: Frame[]): { st: EngineState; frames: Frame[]; results: StepOutput[] }` (`initialState(initFor(frames))`, then `step` per frame); `runScenario(b: ScenarioBuilder) = runFrames(b.build())`.

- [ ] **Step 1: Write the failing tests** (test agent; write `run.ts` first)

```ts
// packages/engine/test/step/timing.test.ts
import { describe, expect, it } from 'vitest';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

describe('timing from LapData', () => {
  it('maps every LapData field with units and named codes', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[1]!, { carPosition: 3, currentLapNum: 5, lapDistance: 1234.5, totalDistance: 20_000.25, currentLapTimeInMs: 45_678,
        lastLapTimeInMs: 91_234, sector: 2, sector1TimeMs: 30_123, sector2TimeMs: 31_456, currentLapInvalid: 1, deltaToRaceLeaderMs: 65_432,
        deltaToCarInFrontMs: 1_250, safetyCarDelta: -1.5, pitStatus: 1, numPitStops: 1, pitLaneTimerActive: 1, pitLaneTimeInLaneInMs: 4_200,
        pitStopTimerInMs: 0, pitStopShouldServePen: 1, driverStatus: 3, resultStatus: 4, penalties: 5, totalWarnings: 2, cornerCuttingWarnings: 1,
        numUnservedDriveThroughPens: 1, numUnservedStopGoPens: 0, gridPosition: 7, speedTrapFastestSpeed: 312.5, speedTrapFastestLap: 3 });
      d.status.carStatusData[1]!.vehicleFiaFlags = 3;
    }));
    expect(st.cars[1]!.timing).toEqual({ position: 3, lap: 5, lapDistanceM: 1234.5, totalDistanceM: 20_000.25, currentLapTimeMs: 45_678,
      lastLapTimeMs: 91_234, sector: 3, sector1TimeMs: 30_123, sector2TimeMs: 31_456, currentLapInvalid: true, gapToLeaderMs: 65_432,
      gapToCarAheadMs: 1_250, safetyCarDeltaMs: -1_500, pitStatus: 'pitting', numPitStops: 1, pitLaneTimerActive: true, pitLaneTimeMs: 4_200,
      pitStopTimerMs: 0, shouldServePenalty: true, driverStatus: 'outLap', resultStatus: 'didNotFinish', timePenaltyMs: 5_000, totalWarnings: 2,
      cornerCuttingWarnings: 1, unservedDriveThroughs: 1, unservedStopGos: 0, gridPosition: 7, speedTrapFastestKmh: 312.5, fiaFlag: 'yellow' });
  });
  it('passes negative gaps through (the game reports a car slightly ahead as a small negative delta)', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.lapData.lapData[1]!, { deltaToCarInFrontMs: -17, deltaToRaceLeaderMs: -50 });
    }));
    expect([st.cars[1]!.timing.gapToCarAheadMs, st.cars[1]!.timing.gapToLeaderMs]).toEqual([-17, -50]);
  });
  it('speed trap is undefined while its lap is 255', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => { d.lapData.lapData[0]!.speedTrapFastestLap = 255; }));
    expect(st.cars[0]!.timing.speedTrapFastestKmh).toBeUndefined();
  });
  it('keeps the last values and does not tag timing when a frame has no LapData', () => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      if (d.index === 0) d.lapData.lapData[0]!.currentLapNum = 4; else d.drop('lapData');
    }));
    expect([st.cars[0]!.timing.lap, results[1]!.changed.has('timing')]).toEqual([4, false]);
  });
  it('LapData resultStatus drives car.active (invalid/inactive are not active)', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 3 }).frames(1, (d) => {
      d.lapData.lapData[1]!.resultStatus = 1; d.lapData.lapData[2]!.resultStatus = 7;
    }));
    expect(st.cars.slice(0, 4).map((c) => c.active)).toEqual([true, false, true, false]);
  });
});
```

```ts
// packages/engine/test/step/car-state.test.ts
import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { ChangeTag } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const R = unknown('restricted'), NR = unknown('notReceived');
// car 1 = human with "Your Telemetry: restricted", car 2 = human public; player = car 0
const online = () => new ScenarioBuilder({ cars: 3 }).participants({ participants: {
  1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 }, 2: { aiControlled: 0, networkId: 6, yourTelemetry: 1 } } });

describe('tyres', () => {
  it('translates RL,RR,FL,FR into named corners once, for every per-wheel source', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => {
      Object.assign(d.telemetry.carTelemetryData[0]!, { tyresSurfaceTemperature: [80, 81, 90, 91], tyresInnerTemperature: [100, 101, 110, 111],
        tyresPressure: [21.5, 21.75, 23, 23.25], brakesTemperature: [400, 410, 500, 510] });
      Object.assign(d.status.carStatusData[0]!, { actualTyreCompound: 18, visualTyreCompound: 16, tyresAgeLaps: 4 });
      d.add('carDamage', { carDamageData: { 0: { tyresWear: [10, 11, 20, 21], tyresDamage: [1, 2, 3, 4], tyreBlisters: [5, 6, 7, 8], brakesDamage: [9, 10, 11, 12] } } });
    }));
    const { tyres, condition } = st.cars[0]!;
    expect(tyres.corners.fl).toEqual({ surfaceTempC: 90, carcassTempC: known(110, 0), pressurePsi: 23, wearPct: known(20, 0), damagePct: known(3, 0), blistersPct: 7 });
    expect(tyres.corners.rr).toMatchObject({ surfaceTempC: 81, pressurePsi: 21.75, blistersPct: 6 });
    expect(condition.brakes.fr).toEqual({ tempC: 510, damagePct: known(12, 0) });
    expect([tyres.actualCompound, tyres.visualCompound, tyres.age]).toEqual(['C3', 'soft', 4]);
  });
  it('carcass temperature is notApplicable with the "surface only" tyre temperature setting', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).session({ tyreTemperature: 0 }).frames(1, () => {}));
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) expect(st.cars[0]!.tyres.corners[c].carcassTempC).toEqual(unknown('notApplicable'));
  });
  it('maps tyre sets by carIdx', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => {
      d.add('tyreSets', { carIdx: 0, fittedIdx: 2, tyreSetData: { 2: { actualTyreCompound: 18, visualTyreCompound: 16, wear: 5, available: 1, fitted: 1,
        recommendedSession: 15, lifeSpan: 20, usableLife: 22, lapDeltaTime: -150 } } });
    }));
    const sets = st.cars[0]!.tyres.sets;
    expect(sets).toMatchObject({ known: true, value: { fittedIdx: 2 } });
    expect(sets.known && sets.value.sets[2]).toEqual({ actualCompound: 'C3', visualCompound: 'soft', wearPct: 5, available: true, fitted: true,
      recommendedSession: 15, lifeSpanLaps: 20, usableLifeLaps: 22, lapDeltaMs: -150 });
  });
});

describe('restricted data (spec 6.2)', () => {
  it('a restricted human car: every field on the spec list is unknown("restricted"), not 0', () => {
    const { st } = runScenario(online().frames(1, (d) => { d.add('carDamage'); d.add('tyreSets', { carIdx: 1 }); }));
    const c = st.cars[1]!;
    expect([c.energy.fuel, c.energy.ers, c.energy.power]).toEqual([R, R, R]);
    expect([c.condition.bodywork, c.condition.powerUnit, c.condition.drsFault, c.condition.brakes.fl.damagePct]).toEqual([R, R, R, R]);
    expect([c.tyres.corners.fl.wearPct, c.tyres.corners.rr.damagePct, c.tyres.sets]).toEqual([R, R, R]);
    expect([c.condition.ersFault, c.tyres.corners.fl.blistersPct, c.tyres.actualCompound]).toEqual([false, 0, 'C3']);   // not on the list
  });
  it('a public human car with 0 fuel has known 0 fuel', () => {
    const { st } = runScenario(online().frames(1, () => {}));
    expect(st.cars[2]!.energy.fuel).toEqual(known({ kg: 0, capacityKg: 0, remainingLaps: 0, mix: 'lean' }, 0));
  });
  it('fields stay notReceived until their packet arrives', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => { d.drop('status'); d.drop('motionEx'); }));
    expect([st.cars[1]!.energy.fuel, st.cars[1]!.condition.bodywork, st.cars[0]!.ownCar!.motionEx]).toEqual([NR, NR, NR]);
  });
});

describe('energy, condition, dynamics', () => {
  it('energy: kg, J and W pass through; mix and ERS mode are named', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.status.carStatusData[1]!, { fuelInTank: 42.5, fuelCapacity: 110, fuelRemainingLaps: 12.25, fuelMix: 2, ersStoreEnergy: 3_000_000,
        ersDeployMode: 3, ersHarvestedThisLapMguk: 100_000, ersHarvestedThisLapMguh: 200_000, ersDeployedThisLap: 500_000, enginePowerIce: 560_000, enginePowerMguk: 120_000 });
    }));
    expect(st.cars[1]!.energy).toEqual({ fuel: known({ kg: 42.5, capacityKg: 110, remainingLaps: 12.25, mix: 'rich' }, 0),
      ers: known({ storeJ: 3_000_000, mode: 'overtake', harvestedMgukJ: 100_000, harvestedMguhJ: 200_000, deployedJ: 500_000 }, 0),
      power: known({ iceW: 560_000, mgukW: 120_000 }, 0) });
  });
  it('condition from Car Damage and Telemetry', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      d.add('carDamage', { carDamageData: { 1: { frontLeftWingDamage: 10, frontRightWingDamage: 11, rearWingDamage: 12, floorDamage: 13, diffuserDamage: 14,
        sidepodDamage: 15, engineDamage: 20, gearBoxDamage: 21, engineMguhWear: 30, engineEsWear: 31, engineCeWear: 32, engineIceWear: 33,
        engineMgukWear: 34, engineTcWear: 35, drsFault: 1, ersFault: 1, engineBlown: 0, engineSeized: 1 } } });
      d.telemetry.carTelemetryData[1]!.engineTemperature = 105;
    }));
    expect(st.cars[1]!.condition).toMatchObject({
      bodywork: known({ frontLeftWingPct: 10, frontRightWingPct: 11, rearWingPct: 12, floorPct: 13, diffuserPct: 14, sidepodPct: 15 }, 0),
      powerUnit: known({ engineDamagePct: 20, gearboxDamagePct: 21, mguhWearPct: 30, esWearPct: 31, ceWearPct: 32, iceWearPct: 33, mgukWearPct: 34, tcWearPct: 35 }, 0),
      drsFault: known(true, 0), ersFault: true, engineBlown: false, engineSeized: true, engineTempC: 105 });
  });
  it('dynamics from Telemetry, Motion and Car Status', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.telemetry.carTelemetryData[1]!, { speed: 312, throttle: 0.75, brake: 0.25, steer: -0.5, clutch: 0, gear: 7, engineRpm: 11_500, revLightsPercent: 80, drs: 1 });
      Object.assign(d.status.carStatusData[1]!, { maxRpm: 13_000, drsAllowed: 1, drsActivationDistance: 120, pitLimiterStatus: 1 });
      Object.assign(d.motion.carMotionData[1]!, { worldPositionX: 100.5, worldPositionY: 2.25, worldPositionZ: -30, worldVelocityX: 80, worldVelocityY: 0,
        worldVelocityZ: -4.5, gForceLateral: 1.5, gForceLongitudinal: -2, gForceVertical: 0.5, yaw: 0.5, pitch: 0.25, roll: -0.125 });
    }));
    expect(st.cars[1]!.dynamics).toEqual({ speedKmh: 312, throttle: 0.75, brake: 0.25, steer: -0.5, clutchPct: 0, gear: 7, rpm: 11_500, maxRpm: 13_000,
      revLightsPct: 80, drs: true, drsAllowed: true, drsActivationDistanceM: 120, pitLimiter: true, position: { x: 100.5, y: 2.25, z: -30 },
      velocity: { x: 80, y: 0, z: -4.5 }, gForce: { lateral: 1.5, longitudinal: -2, vertical: 0.5 }, orientation: { yawRad: 0.5, pitchRad: 0.25, rollRad: -0.125 } });
  });
  it('tags exactly the packets present in the frame', () => {
    const { results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => d.drop('motionEx')));
    const present: ChangeTag[] = ['timing', 'motion', 'telemetry', 'status'], absent: ChangeTag[] = ['damage', 'setups', 'motionEx', 'tyreSets'];
    expect([present.filter((t) => !results[0]!.changed.has(t)), absent.filter((t) => results[0]!.changed.has(t))]).toEqual([[], []]);
  });
});

describe('ownCar (player only)', () => {
  it('fills MotionEx (named corners), setup and live brake bias for the player; other cars get no ownCar', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2, player: 0 }).frames(1, (d) => {
      Object.assign(d.motionEx, { wheelSpeed: [1, 2, 3, 4], wheelCamber: [0.5, 0.25, -0.5, -0.25], frontWheelsAngle: 0.125, heightOfCogAboveGround: 0.25 });
      d.status.carStatusData[0]!.frontBrakeBias = 56;
      d.add('carSetups', { carSetupData: { 0: { onThrottle: 60, offThrottle: 50, brakeBias: 55, rearLeftTyrePressure: 21, rearRightTyrePressure: 21.5,
        frontLeftTyrePressure: 23, frontRightTyrePressure: 23.5, fuelLoad: 12.5 } } });
    }));
    const own = st.cars[0]!.ownCar!;
    expect(own.motionEx).toMatchObject({ known: true, value: { wheels: { fl: { speed: 3, camberRad: -0.5 }, rr: { speed: 2, camberRad: 0.25 } },
      frontWheelsAngleRad: 0.125, heightOfCogM: 0.25 } });
    expect(own.setup).toMatchObject({ known: true, value: { diffOnThrottlePct: 60, diffOffThrottlePct: 50, brakeBiasPct: 55,
      tyrePressurePsi: { fl: 23, fr: 23.5, rl: 21, rr: 21.5 }, fuelLoadKg: 12.5 } });
    expect(own.brakeBiasPct).toEqual(known(56, 0));
    expect(st.cars[1]!.ownCar).toBeUndefined();               // MotionEx is player-only data
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/step/timing.test.ts packages/engine/test/step/car-state.test.ts`
Expected: FAIL (`step` registers only `applySession` and `applyIdentity`, so these fields keep their `initialState` values)

- [ ] **Step 3: Implement the six sub-steps and append them to `SUB_STEPS`** (implementation agent; must not edit test files)

- Sources: `applyTiming` reads LapData plus `vehicleFiaFlags` from Car Status. `applyTyres` reads compounds and age from Car Status, temperatures and pressures from Telemetry, wear, damage and blisters from Car Damage, and `frame.tyreSets` by `carIdx`. `applyEnergy` reads Car Status. `applyCondition` reads Car Damage, brake and engine temperatures from Telemetry. `applyDynamics` reads Telemetry, Motion, and `maxRpm`/`drsAllowed`/`drsActivationDistance`/`pitLimiterStatus` from Car Status. `applyOwnCar` reads MotionEx, Car Setups and `frontBrakeBias` for `state.playerCar` only. A sub-step whose packet is absent leaves the car untouched. Tags follow the packets: `timing`, `status`, `telemetry`, `damage`, `motion`, `setups`, `motionEx`, `tyreSets`. `at` = `frame.sessionTime`.
- Restricted = `identity.visibility === 'restricted'`. These fields become `unknown('restricted')` whatever the value: `energy.fuel`/`ers`/`power`; `condition.bodywork`/`powerUnit`/`drsFault`; `brakes.*.damagePct`; tyre `wearPct`/`damagePct`; `tyres.sets`. That is the spec appendix "Restricted data" list. Every other field is taken as sent.
- `carcassTempC` is `unknown('notApplicable')` whenever `state.session.settings.tyreTemperature === 'surfaceOnly'`.
- Every per-wheel array goes through `cornersFromGameOrder` exactly once, inside these files.
- Conversions: `sector` = game value + 1; `safetyCarDeltaMs = Math.round(safetyCarDelta × 1000)`; `timePenaltyMs = penalties × 1000`; `speedTrapFastestKmh` is `undefined` when `speedTrapFastestLap === 255`; fuel (kg), energy (J), power (W), pressures (psi) and angles (rad) pass through unchanged. Codes are mapped with the `as const` table + `pick` helper of Task 13, in the order of the struct comments (`pitStatus`, `driverStatus`, `resultStatus`, `fuelMix`, `ersDeployMode`, FIA flag −1…3).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test/step && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/step packages/engine/test/step packages/engine/test/support
git commit -F - <<'EOF'
feat(engine): step timing, tyres, energy, condition, dynamics and own car

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 15: History: laps (provisional → confirmed), stints, pit stops

**Files:**
- Create: `packages/engine/src/history/laps.ts`, `packages/engine/src/history/stints.ts`, `packages/engine/src/history/pit-stops.ts`
- Modify: `packages/engine/src/step/step.ts` (append `applyPitStops`, `applyStints`, `applyLaps` to `SUB_STEPS`, in this order, after Task 14's)
- Create (test support, test agent): `apps/bridge/test/fixtures/engine-replay.ts`
- Test: `packages/engine/test/history/laps.test.ts`, `packages/engine/test/history/stints-pit-stops.test.ts`, `apps/bridge/test/fixtures/laps.fixture.test.ts`

**Interfaces:**
- Consumes: `SubStep`, `StepOutput`, `SUB_STEPS`, `initialState`, `step`, `LapCorrection` (Task 13); car fields of Task 14 (`timing`, `tyres`, `energy.fuel`, `active`, `session.flag`); `LapRecord`, `StintRecord`, `PitStopRecord`, `LapCursor`, `OpenStint`, `OpenPitVisit`, `OpenTrackers`, `known`, `unknown` (Task 9); `ScenarioBuilder`, `FrameDraft` (Task 12); `runScenario`, `runFrames` (Task 14); `trackFixture` (Task 11); `describeWithFixture` (Task 1).
- Requires: the `OpenTrackers`/`LapCursor`/`OpenStint`/`OpenPitVisit` fields this task uses are already defined in Task 9; `initialState` (Task 13) initialises them.
- Produces: `applyLaps`, `applyStints`, `applyPitStops: SubStep`. Test support: `replayState(name: FixtureName): Promise<EngineState>` in `apps/bridge/test/fixtures/engine-replay.ts`: `trackFixture(name, onFrame)`, with `initialState` on the first frame that has a `session` and `step` for every frame from there on, as in Task 13's identity fixture test. Throws if no frame had a session.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/history/laps.test.ts
import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runFrames, runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
// frames 0–2 = lap 1 (sector 1 at frame 1, sector 2 + fuel 48.5 at frame 2); frame 3 = lap 2 begins; frame 4 = lap 2
const lapOne = () => new ScenarioBuilder({ cars: 1 }).frames(5, (d) => {
  const s = d.status.carStatusData[0]!;
  if (d.index === 0) Object.assign(s, { actualTyreCompound: 18, visualTyreCompound: 17, fuelInTank: 50, tyresAgeLaps: 3 });
  if (d.index === 1) car0(d).sector1TimeMs = 30_000;
  if (d.index === 2) { car0(d).sector2TimeMs = 31_000; s.fuelInTank = 48.5; }
  if (d.index === 3) Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 90_500, sector1TimeMs: 0, sector2TimeMs: 0 });
});

describe('laps', () => {
  it('appends a provisional lap when currentLapNum goes up', () => {
    const { st, frames, results } = runScenario(lapOne());
    const end = frames[3]!.sessionTime;
    expect(st.history.laps).toEqual([{ carId: 0, lapNumber: 1, lapTimeMs: 90_500, sectorTimesMs: [30_000, 31_000, 29_500],
      valid: { lap: true, sectors: [true, true, true] }, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtStart: 3,
      fuelAtStartKg: known(50, 0), fuelAtEndKg: known(48.5, end), scShare: 0, vscShare: 0, inLap: false, outLap: false,
      positionAtEnd: 1, status: 'provisional', completedAt: end }]);
    expect(results.map((r) => r.changed.has('laps'))).toEqual([false, false, false, true, false]);
  });
  it('a lost frame cannot swallow a lap: without the frame where the lap number changes there is still exactly one lap', () => {
    const frames = lapOne().build();
    const { st } = runFrames(frames.filter((_, i) => i !== 3));
    expect(st.history.laps.map((l) => [l.lapNumber, l.lapTimeMs, l.status])).toEqual([[1, 90_500, 'provisional']]);
  });
  it('confirms from SessionHistory: appends a confirmed record, the authoritative value wins, the correction is reported once', () => {
    const history = { carIdx: 0, numLaps: 2, lapHistoryData: [
      { lapTimeInMs: 90_520, sector1TimeMs: 30_000, sector2TimeMs: 31_010, sector3TimeMs: 29_509, lapValidBitFlags: 0b1011 },
      { lapValidBitFlags: 0b1111 }] };                                             // lap 2 = the partial current lap (time 0)
    const { st, results } = runScenario(lapOne().frames(2, (d) => { d.add('sessionHistory', history); }));
    expect(st.history.laps).toHaveLength(2);
    expect(st.history.laps[1]).toMatchObject({ carId: 0, lapNumber: 1, status: 'confirmed', lapTimeMs: 90_520, sectorTimesMs: [30_000, 31_010, 29_509],
      valid: { lap: true, sectors: [true, false, true] }, tyreAgeAtStart: 3, positionAtEnd: 1, fuelAtStartKg: known(50, 0) });
    expect(results[5]!.corrections).toEqual([
      { carId: 0, lapNumber: 1, field: 'lapTimeMs', provisional: 90_500, confirmed: 90_520 },
      { carId: 0, lapNumber: 1, field: 'sector2Ms', provisional: 31_000, confirmed: 31_010 }]);
    expect(results[6]!.corrections).toEqual([]);
  });
  it('SC/VSC share = share of the lap’s session time under each status', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(1, () => {})
      .session({ safetyCarStatus: 1 }).frames(1, () => {})          // (0, 1000]     SC
      .session({ safetyCarStatus: 2 }).frames(1, () => {})          // (1000, 2000]  VSC
      .session({ safetyCarStatus: 0 }).frames(1, () => {})          // (2000, 3000]  green
      .frames(1, (d) => Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 4_000 })));
    expect(st.history.laps[0]).toMatchObject({ scShare: 0.25, vscShare: 0.25 });
  });
  it('in-lap = a pit entry during the lap; out-lap = the lap starts in the pit lane', () => {
    const seq = [[2, 0], [3, 0], [3, 1], [4, 1], [4, 2], [4, 0], [5, 0]] as const;
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) =>
      Object.assign(car0(d), { currentLapNum: seq[d.index]![0], pitStatus: seq[d.index]![1], lastLapTimeInMs: 80_000 })));
    expect(st.history.laps.map((l) => [l.lapNumber, l.inLap, l.outLap])).toEqual([[2, false, false], [3, true, false], [4, false, true]]);
  });
  it('fuel at lap start/end of a restricted car is unknown("restricted")', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).participants({ participants: { 1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 } } })
      .frames(2, (d) => { if (d.index === 1) Object.assign(d.lapData.lapData[1]!, { currentLapNum: 2, lastLapTimeInMs: 80_000 }); }));
    expect(st.history.laps[0]).toMatchObject({ carId: 1, fuelAtStartKg: unknown('restricted'), fuelAtEndKg: unknown('restricted') });
  });
});
```

```ts
// packages/engine/test/history/stints-pit-stops.test.ts
import { describe, expect, it } from 'vitest';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const OLD = { actualTyreCompound: 18, visualTyreCompound: 17, tyresAgeLaps: 3 }, NEW = { actualTyreCompound: 19, visualTyreCompound: 18, tyresAgeLaps: 0 };

describe('stints', () => {
  it.each([
    ['line in the pit lane before the box', [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0], [5, 1, 0], [6, 1, 0], [6, 2, 1], [6, 0, 1], [7, 0, 1]]],
    ['box before the line', [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0], [5, 1, 0], [5, 2, 1], [6, 1, 1], [6, 0, 1], [7, 0, 1]]],
  ] as const)('closes on a tyre change (%s); SEND closes the open stint', (_, seq) => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(seq.length, (d) => {
      const [lap, pitStatus, fresh] = seq[d.index]!;
      Object.assign(car0(d), { currentLapNum: lap, pitStatus, lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, fresh ? NEW : OLD);
    }).event({ code: 'SEND' }));                                                  // attaches to the last frame (Task 11)
    expect(st.history.stints).toEqual([
      { carId: 0, firstLap: 1, lastLap: 5, actualCompound: 'C3', visualCompound: 'medium', tyreAgeAtFitting: 3 },
      { carId: 0, firstLap: 6, lastLap: 6, actualCompound: 'C2', visualCompound: 'hard', tyreAgeAtFitting: 0 }]);
    expect(results.filter((r) => r.changed.has('stints'))).toHaveLength(2);
  });
  it('a fresh set of the same compound (age drops) also starts a new stint', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      Object.assign(car0(d), { currentLapNum: 4 + d.index, lastLapTimeInMs: 80_000 });
      Object.assign(d.status.carStatusData[0]!, { ...OLD, tyresAgeLaps: d.index === 0 ? 7 : 0 });
    }));
    expect(st.history.stints).toMatchObject([{ firstLap: 4, lastLap: 4, tyreAgeAtFitting: 7 }]);
  });
});

describe('pit stops', () => {
  const steps = [{ currentLapNum: 5 }, { pitStatus: 1, pitLaneTimerActive: 1, pitLaneTimeInLaneInMs: 0 },
    { pitStatus: 2, pitLaneTimeInLaneInMs: 9_000, pitStopTimerInMs: 1_200 }, { pitStopTimerInMs: 2_400, pitLaneTimeInLaneInMs: 10_000 },
    { pitStatus: 1, pitLaneTimeInLaneInMs: 21_800 }, { pitStatus: 0, pitLaneTimerActive: 0, pitLaneTimeInLaneInMs: 0 }];
  const script = (d: FrameDraft) => { Object.assign(car0(d), steps[d.index]); };
  const stop = (o: { sc?: boolean; served?: boolean } = {}) => {            // t = 0, 6000 (entry), …, 30000 (exit)
    const b = new ScenarioBuilder({ cars: 1, stepMs: 6000 }).frames(1, script);
    if (o.sc) b.session({ safetyCarStatus: 1 });
    b.frames(2, script);
    if (o.served) b.event({ code: 'DTSV', vehicleIdx: 0 });
    return runScenario(b.frames(3, script));
  };
  it('records entry, exit, the game’s pit-lane time and the stationary time', () => {
    const { st, results } = stop();
    expect(st.history.pitStops).toEqual([{ carId: 0, lap: 5, pitLaneEntry: 6_000, pitLaneExit: 30_000, pitLaneTimeMs: 21_800,
      stationaryTimeMs: 2_400, flag: 'green', penaltyServed: false }]);
    expect(results[5]!.changed.has('pitStops')).toBe(true);
  });
  it('takes the flag at pit entry and marks a served penalty (DTSV/SGSV)', () => {
    expect(stop({ sc: true, served: true }).st.history.pitStops[0]).toMatchObject({ flag: 'sc', penaltyServed: true });
  });
  it('leaving the garage is not a pit stop', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => { car0(d).pitStatus = d.index === 0 ? 2 : 0; }));
    expect(st.history.pitStops).toEqual([]);
  });
});
```

```ts
// apps/bridge/test/fixtures/laps.fixture.test.ts
import { expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayState } from './engine-replay.ts';

describeWithFixture('ttZandvoort', 'laps from the TT Zandvoort recording', () => {
  it('15 completed player laps confirmed with the recorded times; lap 16 unfinished; no fuel use', async () => {
    const st = await replayState('ttZandvoort');
    const mine = st.history.laps.filter((l) => l.carId === st.playerCar);
    const confirmed = new Map(mine.filter((l) => l.status === 'confirmed').map((l) => [l.lapNumber, l]));
    expect(mine.filter((l) => l.status === 'provisional')).toHaveLength(15);
    expect([...confirmed.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect([1, 4, 9].map((n) => confirmed.get(n)!.lapTimeMs)).toEqual([71_910, 71_081, 73_253]);
    expect(confirmed.get(9)!.valid.lap).toBe(false);                                // lapValidBitFlags 0b0110
    for (const l of confirmed.values()) expect([l.fuelAtStartKg, l.fuelAtEndKg]).toMatchObject([{ value: 10 }, { value: 10 }]);
    expect(st.history.stints).toEqual([{ carId: st.playerCar, firstLap: 1, lastLap: 15, actualCompound: 'C4', visualCompound: 'soft', tyreAgeAtFitting: 0 }]);
    expect(st.history.pitStops).toEqual([]);         // starts in the pit lane (pit status 1) and leaves at 18.7 s: no observed entry
  }, 120_000);
});

describeWithFixture('raceSingapore', 'laps from the aborted Singapore race', () => {
  it('no lap completed: no laps, stints or pit stops', async () => {
    const st = await replayState('raceSingapore');
    expect([st.history.laps, st.history.stints, st.history.pitStops]).toEqual([[], [], []]);
  }, 120_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/history apps/bridge/test/fixtures/laps.fixture.test.ts`
Expected: FAIL (`history.laps`, `stints` and `pitStops` stay empty)

- [ ] **Step 3: Implement `applyLaps`, `applyStints`, `applyPitStops`** (implementation agent; must not edit test files)

Each sub-step handles the active cars that have LapData in this frame. It reads the car fields Task 14 wrote and `state.open`. Tags `laps`, `stints`, `pitStops` are set when the list grew.
- **Laps.** The cursor opens at a car's first LapData and emits nothing. Every LapData frame first adds `dt = sessionTime − lastSeenAt` to `trackedMs`, and to `scMs`/`vscMs` when `session.flag` is `sc`/`vsc`. It keeps the last non-zero `sector1TimeMs`/`sector2TimeMs` and ORs `currentLapInvalid`. When the lap number goes up, it appends a provisional record for `lapNumber = timing.lap − 1`:
  - `lapTimeMs = timing.lastLapTimeMs`; sectors `[s1, s2, lapTime − s1 − s2]` (all `0` if the cursor is not for that lap or a sector is missing)
  - `valid.lap = !invalid`; every sector = `valid.lap`
  - fuel at start and end = `known(fuel.kg, at)` or `unknown(fuel.reason)`; compound and age from the cursor (set at lap start)
  - `inLap = pitted` (an observed pit entry during the lap); `outLap` = pit status not `none`, or driver status `outLap`, in the lap's first frame
  - `positionAtEnd = timing.position`; `completedAt = frame.sessionTime`

  A lap number that goes down (only possible without the runner) resets the cursor.
- **Confirmation.** For each `frame.sessionHistory` packet, entry `i < numLaps` with `lapTimeInMs > 0` whose `(carIdx, i + 1)` has a provisional record and no confirmed one is confirmed. Append `{ ...provisional, lapTimeMs, sectorTimesMs: [s1, s2, s3], valid: bits 0x01 lap, 0x02/0x04/0x08 sectors, status: 'confirmed', completedAt: frame.sessionTime }`. Push one `LapCorrection` per differing `lapTimeMs`/`sector1Ms`/`sector2Ms` into `out.corrections`. Sector 3 is not compared, because it is derived provisionally. Lookups go through `open.lapIndex`; never scan `history.laps`. Laps from before the engine first saw the car are not reconstructed.
- **Pit stops.** A visit opens only on an observed `none → pitting|inPitArea` change of `open.pitStatus`. It stores `lap`, `entry` and `flag` (`session.flag` `sc`/`vsc`, otherwise `green`), and sets the lap cursor's `pitted`. While open it keeps the maximum `pitLaneTimeMs` and `pitStopTimerMs`, and a `DTSV`/`SGSV` event for the car sets `penaltyServed`. It closes on the change back to `none`. Then `pitLaneTimeMs` = the maximum game timer, or `exit − entry` if that maximum is 0, and `stationaryTimeMs` = the maximum stop timer.
- **Stints.** A stint opens at the first known compound. A new set starts when the compound changes or `age < lastAge`. If a pit visit is open, the old stint's `lastLap = visit.lap` and the new `firstLap = visit.lap + 1`. Otherwise `lastLap = lap − 1` and `firstLap = lap`. A `SEND` event closes every open stint with `lastLap` = the car's last completed lap, and drops a stint that has no completed lap.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test apps/bridge/test/fixtures && pnpm typecheck`
Expected: PASS (fixture tests skip with a note when the recordings are missing)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/history packages/engine/src/step/step.ts packages/engine/test/history apps/bridge/test/fixtures/engine-replay.ts apps/bridge/test/fixtures/laps.fixture.test.ts
git commit -F - <<'EOF'
feat(engine): lap, stint and pit stop history with provisional to confirmed laps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 16: History: flag phases, race events, mini-sector crossings

**Files:**
- Create: `packages/engine/src/history/flags.ts`, `packages/engine/src/history/events.ts`, `packages/engine/src/history/mini-sectors.ts`
- Modify: `packages/engine/src/step/step.ts` (append `applyFlagPhases`, `applyEvents`, `applyMiniSectors` to `SUB_STEPS` after Task 15's)
- Test: `packages/engine/test/history/flags.test.ts`, `packages/engine/test/history/events.test.ts`, `packages/engine/test/history/mini-sectors.test.ts`, `apps/bridge/test/fixtures/events.fixture.test.ts`

**Interfaces:**
- Consumes: `SubStep`, `SUB_STEPS` (Task 13); car fields of Task 14 (`timing`, `active`); `session.flag`, `session.trackLengthM`, `FlagPhase`, `RaceEvent`, `MiniSectorCrossing`, `MINI_SECTORS`, `OpenTrackers` (Task 9); `EventDetails` (Task 5); `ScenarioBuilder`, `FrameDraft` (Task 12); `runScenario` (Task 14); `replayState` (Task 15).
- Requires: the `OpenTrackers`/`LapCursor`/`OpenStint`/`OpenPitVisit` fields this task uses are already defined in Task 9; `initialState` (Task 13) initialises them.
- Produces: `applyFlagPhases`, `applyEvents`, `applyMiniSectors: SubStep`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/history/flags.test.ts — t = 0, 1000, 2000, …; leader = car 0 on lap 3
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const race = () => new ScenarioBuilder({ cars: 2, stepMs: 1000 }).frames(1, (d) => { d.lapData.lapData[0]!.currentLapNum = 3; });
const noop = () => {};
const scar = (eventType: number): EventDetails => ({ code: 'SCAR', safetyCarType: 1, eventType });

describe('flag phases', () => {
  it('open on a safety-car status transition, close when it clears, with leader laps', () => {
    const { st, results } = runScenario(race().session({ safetyCarStatus: 1 }).frames(1, noop)            // 1000
      .frames(1, (d) => { d.lapData.lapData[0]!.currentLapNum = 4; })                                     // 2000
      .session({ safetyCarStatus: 0 }).frames(1, noop));                                                  // 3000
    expect(st.history.flagPhases).toEqual([{ kind: 'SC', start: 1000, end: 3000, startLeaderLap: 3, endLeaderLap: 4, scPhases: [] }]);
    expect(results.map((r) => r.changed.has('flagPhases'))).toEqual([false, false, false, true]);
  });
  it('SCAR deployed opens early; returning/returned are recorded; resume closes', () => {
    const { st } = runScenario(race().event(scar(0)).frames(1, noop)                                        // 1000 deployed
      .session({ safetyCarStatus: 1 }).frames(1, noop)                                                    // 2000 status follows: no 2nd phase
      .event(scar(1)).frames(1, noop).event(scar(2)).frames(1, noop).event(scar(3)).frames(1, noop)       // 3000, 4000, 5000
      .session({ safetyCarStatus: 0 }).frames(1, noop));                                                  // 6000 already closed
    expect(st.history.flagPhases).toEqual([{ kind: 'SC', start: 1000, end: 5000, startLeaderLap: 3, endLeaderLap: 3, scPhases: [
      { phase: 'deployed', at: 1000 }, { phase: 'returning', at: 3000 }, { phase: 'returned', at: 4000 }, { phase: 'resume', at: 5000 }] }]);
  });
  it('VSC = status 2; SC -> VSC switches phases; formation lap (3) is ignored', () => {
    const { st } = runScenario(race().session({ safetyCarStatus: 3 }).frames(1, noop).session({ safetyCarStatus: 1 }).frames(1, noop)
      .session({ safetyCarStatus: 2 }).frames(1, noop).session({ safetyCarStatus: 0 }).frames(1, noop));
    expect(st.history.flagPhases.map((p) => [p.kind, p.start, p.end])).toEqual([['SC', 2000, 3000], ['VSC', 3000, 4000]]);
  });
  it('red flag: RDFL opens, the next lights out closes', () => {
    const { st } = runScenario(race().event({ code: 'RDFL' }).frames(2, noop).event({ code: 'LGOT' }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ kind: 'red', start: 1000, end: 3000, startLeaderLap: 3 }]);
  });
  it('SEND closes an open phase', () => {
    const { st } = runScenario(race().session({ safetyCarStatus: 2 }).frames(2, noop).event({ code: 'SEND' }));   // SEND joins the 2000 frame
    expect(st.history.flagPhases).toMatchObject([{ kind: 'VSC', start: 1000, end: 2000 }]);
  });
});
```

```ts
// packages/engine/test/history/events.test.ts
import { describe, expect, it } from 'vitest';
import type { CarId, RaceEvent } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car = (i: number) => i as CarId;
const cases: Array<[EventDetails, Omit<RaceEvent, 'at'>]> = [
  [{ code: 'PENA', penaltyType: 4, infringementType: 7, vehicleIdx: 1, otherVehicleIdx: 255, time: 5, lapNum: 3, placesGained: 0 },
    { kind: 'penalty', carId: car(1), params: { penaltyType: 4, infringementType: 7, timeMs: 5_000, lap: 3, placesGained: 0 } }],
  [{ code: 'PENA', penaltyType: 5, infringementType: 4, vehicleIdx: 0, otherVehicleIdx: 1, time: 255, lapNum: 1, placesGained: 0 },
    { kind: 'penalty', carId: car(0), otherCarId: car(1), params: { penaltyType: 5, infringementType: 4, lap: 1, placesGained: 0 } }],
  [{ code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }, { kind: 'overtake', carId: car(1), otherCarId: car(0), params: {} }],
  [{ code: 'COLL', vehicle1Idx: 0, vehicle2Idx: 1 }, { kind: 'collision', carId: car(0), otherCarId: car(1), params: {} }],
  [{ code: 'RTMT', vehicleIdx: 1, reason: 8 }, { kind: 'retirement', carId: car(1), params: { reason: 'mechanicalFailure' } }],
  [{ code: 'FTLP', vehicleIdx: 0, lapTime: 71.91000366210938 }, { kind: 'fastestLap', carId: car(0), params: { lapTimeMs: 71_910 } }],
  [{ code: 'SPTP', vehicleIdx: 1, speed: 321.5, isOverallFastestInSession: 1, isDriverFastestInSession: 0, fastestVehicleIdxInSession: 0, fastestSpeedInSession: 330.25 },
    { kind: 'speedTrap', carId: car(1), params: { speedKmh: 321.5, overallFastest: 1, driverFastest: 0, fastestCarId: 0, fastestSpeedKmh: 330.25 } }],
  [{ code: 'DRSE' }, { kind: 'drsEnabled', params: {} }],
  [{ code: 'DRSD', reason: 1 }, { kind: 'drsDisabled', params: { reason: 'safetyCar' } }],
  [{ code: 'STLG', numLights: 3 }, { kind: 'startLights', params: { lights: 3 } }],
  [{ code: 'LGOT' }, { kind: 'lightsOut', params: {} }],
];

describe('race events', () => {
  it.each(cases)('%j', (details, expected) => {
    const { st, frames, results } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).event(details).frames(1, () => {}));
    expect(st.history.events).toEqual([{ at: frames[1]!.sessionTime, ...expected }]);
    expect(results[1]!.changed.has('events')).toBe(true);
  });
  it('codes that are not race events produce none', () => {
    const b = new ScenarioBuilder({ cars: 2 }).frames(1, () => {});
    for (const d of [{ code: 'SSTA' }, { code: 'CHQF' }, { code: 'TMPT', vehicleIdx: 1 }, { code: 'RCWN', vehicleIdx: 0 }, { code: 'DTSV', vehicleIdx: 0 },
      { code: 'SGSV', vehicleIdx: 0, stopTime: 5 }, { code: 'BUTN', buttonStatus: 1 }, { code: 'SCAR', safetyCarType: 1, eventType: 0 }, { code: 'RDFL' }] as EventDetails[]) b.event(d);
    expect(runScenario(b.frames(1, () => {})).st.history.events).toEqual([]);
  });
});
```

```ts
// packages/engine/test/history/mini-sectors.test.ts — trackLength 5000 m → 50 segments of 100 m; frames every 100 ms
import { describe, expect, it } from 'vitest';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const crossings = (samples: ReadonlyArray<readonly [lap: number, distance: number]>, o: { resultStatus?: number } = {}) => {
  const { st } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 100 }).frames(samples.length, (d) => {
    Object.assign(d.lapData.lapData[0]!, { currentLapNum: samples[d.index]![0], lapDistance: samples[d.index]![1], resultStatus: o.resultStatus ?? 2 });
  }));
  return st.history.miniSectors.map(({ carId, lap, segment, at }) => ({ carId, lap, segment, at }));
};

describe('mini-sector crossings', () => {
  it('first sample emits nothing; then every boundary at a linearly interpolated session time', () => {
    expect(crossings([[1, 950]])).toEqual([]);
    expect(crossings([[1, 950], [1, 1250]])).toEqual([{ carId: 0, lap: 1, segment: 10, at: 17 }, { carId: 0, lap: 1, segment: 11, at: 50 },
      { carId: 0, lap: 1, segment: 12, at: 83 }]);
  });
  it('lap wrap: the line is segment 0 of the new lap, interpolated over the wrapped distance', () => {
    expect(crossings([[3, 4950], [4, 150]])).toEqual([{ carId: 0, lap: 4, segment: 0, at: 25 }, { carId: 0, lap: 4, segment: 1, at: 75 }]);
  });
  it('crossing the line from a negative lap distance', () => {
    expect(crossings([[1, -30], [1, 20]])).toEqual([{ carId: 0, lap: 1, segment: 0, at: 60 }]);
  });
  it('never emits a crossing twice (backwards jitter, re-crossing)', () => {
    expect(crossings([[1, 1150], [1, 1250], [1, 1190], [1, 1210], [1, 1300]]).map((c) => [c.segment, c.at])).toEqual([[12, 50], [13, 400]]);
  });
  it('a lap jump > 1 or a lap going down resets the cursor without emitting', () => {
    expect(crossings([[3, 4950], [5, 100], [5, 250], [4, 300]]).map((c) => [c.lap, c.segment, c.at])).toEqual([[5, 2, 167]]);
  });
  it('inactive cars emit nothing', () => {
    expect(crossings([[1, 100], [1, 900]], { resultStatus: 1 })).toEqual([]);
  });
});
```

```ts
// apps/bridge/test/fixtures/events.fixture.test.ts
import { expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayState } from './engine-replay.ts';

describeWithFixture('raceSingapore', 'race events from the Singapore race', () => {
  it('STLG x5, LGOT x1, OVTK x39, COLL x4, PENA x6', async () => {
    const { history } = await replayState('raceSingapore');
    const count = (k: string) => history.events.filter((e) => e.kind === k).length;
    expect({ startLights: count('startLights'), lightsOut: count('lightsOut'), overtake: count('overtake'), collision: count('collision'), penalty: count('penalty') })
      .toEqual({ startLights: 5, lightsOut: 1, overtake: 39, collision: 4, penalty: 6 });
    expect(history.events.filter((e) => e.kind === 'startLights').map((e) => [e.at, e.params['lights']])).toEqual([[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);
  }, 120_000);
});

describeWithFixture('ttZandvoort', 'events and mini-sectors from the TT recording', () => {
  it('FTLP x4 with the recorded lap times', async () => {
    const st = await replayState('ttZandvoort');
    expect(st.history.events.filter((e) => e.kind === 'fastestLap').map((e) => [e.carId, e.params['lapTimeMs']]))
      .toEqual([[0, 71_910], [0, 71_540], [0, 71_081], [0, 71_046]]);
  }, 120_000);
  it('50 ordered crossings per lap; line-to-line time matches the lap time', async () => {
    const st = await replayState('ttZandvoort');
    const mine = st.history.miniSectors.filter((m) => m.carId === st.playerCar);
    const lap6 = mine.filter((m) => m.lap === 6);
    expect(lap6.map((m) => m.segment)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(lap6.every((m, i) => i === 0 || m.at >= lap6[i - 1]!.at)).toBe(true);
    const line = (lap: number) => mine.find((m) => m.lap === lap && m.segment === 0)!.at;
    expect(Math.abs(line(7) - line(6) - 71_254)).toBeLessThanOrEqual(10);                          // lap 6 = 71.254 s
    expect(line(5)).toBeGreaterThanOrEqual(370_600); expect(line(5)).toBeLessThanOrEqual(370_662);  // lap counter flips at 370.661 s
  }, 120_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/history apps/bridge/test/fixtures/events.fixture.test.ts`
Expected: FAIL (`flagPhases`, `events` and `miniSectors` stay empty)

- [ ] **Step 3: Implement `applyFlagPhases`, `applyEvents`, `applyMiniSectors`** (implementation agent; must not edit test files)

- **Flag phases.** `session.flag` `sc` → `SC`, `vsc` → `VSC`; `green`/`formation` → none.
  - Opening: a phase opens on the first of (a) `lastFlag → flag` changing into the kind, or (b) a `SCAR` `deployed` event of that type (1 = SC, 2 = VSC). It closes on the first of: `flag` leaving the kind, `SCAR` `resume` of that type, or `SEND`.
  - Red: `RDFL` opens `red`. The next `LGOT`, `flag` becoming `sc` (restart behind the SC), or `SEND` closes it.
  - Overlaps: a change into a kind that is already open is a no-op, and opening a phase closes any other open phase at the same time.
  - Fields: `scPhases` gets every `SCAR` of the open phase's type (eventType 0–3 → `deployed`, `returning`, `returned`, `resume`). Leader lap = `timing.lap` of the active car in position 1.
  - The phase is appended on close and tagged `flagPhases`. `lastFlag` is updated every frame.
- **Events.** `at = frame.sessionTime`. Index fields map to `carId`/`otherCarId`, and 255 is omitted.
  - `params` hold numbers or code names only. `PENA` → `penaltyType`, `infringementType`, `timeMs` (= `time × 1000`, omitted for 255), `lap`, `placesGained`.
  - `RTMT.reason` 0–10 → `invalid, retired, finished, terminalDamage, inactive, notEnoughLapsCompleted, blackFlagged, redFlagged, mechanicalFailure, sessionSkipped, sessionSimulated`. `DRSD.reason` 0–3 → `wetTrack, safetyCar, redFlag, minLapNotReached`.
  - `FTLP` → `lapTimeMs = Math.round(lapTime × 1000)`. `SPTP` → `speedKmh`, `overallFastest`, `driverFastest`, `fastestCarId`, `fastestSpeedKmh`.
  - Other codes produce no `RaceEvent`. Tag `events`.
- **Mini-sectors.** Boundary `k` is at `k × trackLengthM / MINI_SECTORS`. For each active car with LapData, compare the sample `(lap, d1, t1)` with the cursor `(lap0, d0, t0)`:
  - Same lap: every boundary `b` with `d0 < b ≤ d1` is crossed.
  - `lap0 + 1`: the old lap's boundaries `> d0` are crossed, then the new lap's boundaries `≤ d1`, over the path `(trackLengthM − d0) + d1`.
  - Any other lap change resets the cursor without emitting.
  - Time: `Math.round(t0 + (t1 − t0) × pathTo(b) / path)`, or `t0` when `path` is 0. A crossing is appended only if it comes after the cursor's last emitted `(lap, segment)`. The cursor always moves to the sample. Tag `miniSectors`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test apps/bridge/test/fixtures && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/history packages/engine/src/step/step.ts packages/engine/test/history apps/bridge/test/fixtures/events.fixture.test.ts
git commit -F - <<'EOF'
feat(engine): flag phases, race events and mini-sector crossings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 17: `SessionRunner`: snapshots and flashback rewind

**Files:**
- Create: `packages/engine/src/runner/session-runner.ts`, `packages/engine/src/runner/snapshots.ts`, `packages/engine/src/history/delta.ts`
- Modify: `packages/engine/src/index.ts` (export `SessionRunner`, `StepResult`, `FlashbackInfo`, `HistoryDelta`, `historyLengths`, `ALL_CHANGE_TAGS`)
- Test: `packages/engine/test/runner/session-runner.test.ts`

**Interfaces:**
- Consumes: `initialState`, `step`, `ChangeTag`, `LapCorrection` (Task 13); `EngineState`, `History`, `HistoryLengths`, `DeepReadonly` (Task 9); `Frame` (Task 10); `ScenarioBuilder`, `FrameDraft` (Task 12); `initFor` (Task 14); history sub-steps (Tasks 15–16).
- Produces (contract): `HistoryDelta`, `StepResult`, `FlashbackInfo`, `class SessionRunner { constructor(init: Parameters<typeof initialState>[0], opts?: { snapshotEveryMs?: number /*1000*/; replayWindowMs?: number /*10_000*/ }); apply(frame: Frame): StepResult; get state(): DeepReadonly<EngineState> }`. `replayWindowMs` extends the contract (see Step 3).
- Produces (new): `historyLengths(h: DeepReadonly<History>): HistoryLengths`, `truncateHistory(h: History, to: HistoryLengths): void` (`history/delta.ts`); `ALL_CHANGE_TAGS: readonly ChangeTag[]` (each tag once); `type Snapshot = { frameId: number; sessionTime: SessionTime; lengths: HistoryLengths; state: Omit<EngineState, 'history'> }`, `class SnapshotStore { take(state: EngineState, frameId: number): void; newestAtOrBefore(frameId: number): Snapshot; newestAtOrBeforeTime(t: SessionTime): Snapshot; dropAfter(frameId: number): void }` (`runner/snapshots.ts`).

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/runner/session-runner.test.ts
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { SessionRunner, type Frame, type StepResult } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

const STEP = 16;
const runAll = (r: SessionRunner, frames: Frame[]): StepResult[] => frames.map((f) => r.apply(f));
const noFlbk = (fs: Frame[]) => fs.map((f) => ({ ...f, events: f.events.filter((e) => e.details.code !== 'FLBK') }));
const flbk = (frameId: number): EventDetails => ({ code: 'FLBK', flashbackFrameIdentifier: frameId, flashbackSessionTime: (frameId * STEP) / 1000 });
// car 0 drives 40 m per frame on a 4000 m track; a new lap begins at each frame index in lapStarts
const drive = (lapStarts: number[]) => (d: FrameDraft) => {
  const starts = [0, ...lapStarts.filter((x) => x <= d.index)], start = starts.at(-1)!;
  Object.assign(d.lapData.lapData[0]!, { currentLapNum: starts.length, lapDistance: (d.index - start) * 40 + 10, totalDistance: d.index * 40 + 10,
    lastLapTimeInMs: starts.length === 1 ? 0 : (start - starts.at(-2)!) * STEP });
};
// A timeline that equals `lapStarts` up to frame `target` and continues differently. With `event`, the FLBK event lands in frame target + 1.
const timeline = (frames: number, lapStarts: number[], fork?: { target: number; event: boolean }) => {
  const b = new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 });
  if (!fork) return b.frames(frames, drive(lapStarts)).build();
  b.frames(fork.target + 1, drive(lapStarts));
  if (fork.event) b.event(flbk(fork.target));
  return b.frames(frames - fork.target - 1, drive(lapStarts)).build();
};
// what the game sends after a flashback: the forked frames from target + 1 on, with overallFrameId still rising
const after = (fork: Frame[], target: number, nextOverall: number) =>
  fork.slice(target + 1).map((f, k) => ({ ...f, overallFrameId: nextOverall + k }));

// original: frames 0..299, laps begin at 100 and 250. The game flashes back to frame 200 (t = 3200 ms);
// in the new timeline (frames 201..399) lap 3 begins at 330.
const scene = (event: boolean) => {
  const original = timeline(300, [100, 250]);
  const fork = timeline(400, [100, 330], { target: 200, event });
  return { original, fork, continuation: after(fork, 200, 300), reference: noFlbk(fork) };
};

describe('SessionRunner', () => {
  it('reports chained history deltas and no flashback in normal operation', () => {
    const { original } = scene(true);
    const results = runAll(new SessionRunner(initFor(original)), original.slice(0, 101));
    results.slice(1).forEach((r, i) => expect(r.delta.before).toEqual(results[i]!.delta.after));
    expect(results.every((r) => !r.delta.truncated && r.flashback === undefined)).toBe(true);
    expect([results[100]!.delta.after.laps - results[100]!.delta.before.laps, results[100]!.changed.has('laps')]).toEqual([1, true]);
  });
  it('FLBK: rewind + continuation equals a run that never saw the discarded frames', () => {
    const { original, continuation, reference } = scene(true);
    const a = new SessionRunner(initFor(original)); runAll(a, original); runAll(a, continuation);
    const b = new SessionRunner(initFor(original)); runAll(b, reference);
    expect(a.state).toEqual(b.state);
    expect(a.state.history.laps.map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([[1, 1_600], [2, 3_680]]);
  });
  it('the rewinding frame reports truncation, every change tag and the flashback info', () => {
    const { original, continuation } = scene(true);
    const a = new SessionRunner(initFor(original)); runAll(a, original);
    const r = a.apply(continuation[0]!);
    expect(r.delta.truncated).toBe(true);
    expect([r.delta.before.laps, r.delta.after.laps]).toEqual([2, 1]);                 // lap 2 (completed at frame 250) is gone
    expect(r.flashback).toEqual({ targetFrameId: 200, targetSessionTime: 3_200, rewoundMs: 299 * STEP - 3_200, targetLap: 2 });
    expect((['laps', 'timing', 'miniSectors'] as const).every((t) => r.changed.has(t))).toBe(true);
  });
  it('detects a flashback without FLBK: frameId goes back while overallFrameId rises', () => {
    const { original, continuation, reference } = scene(false);
    const a = new SessionRunner(initFor(original)); runAll(a, original);
    const [first] = runAll(a, continuation);
    expect([first!.delta.truncated, first!.flashback?.targetFrameId, first!.flashback?.targetSessionTime]).toEqual([true, 200, 3_200]);
    const b = new SessionRunner(initFor(original)); runAll(b, reference);
    expect(a.state).toEqual(b.state);
  });
  it('a target older than the replay window restores the newest snapshot at or before it; the lap is detected again, once', () => {
    const original = timeline(300, [100, 250]);
    const continuation = after(timeline(200, [120], { target: 90, event: true }), 90, 300);
    const a = new SessionRunner(initFor(original), { snapshotEveryMs: 1000, replayWindowMs: 1000 });
    runAll(a, original);
    expect(a.apply(continuation[0]!).delta.truncated).toBe(true);
    expect(a.state.history.laps).toEqual([]);                                          // lap 1 ended at frame 100 > target 90
    runAll(a, continuation.slice(1));
    expect(a.state.history.laps.map((l) => [l.lapNumber, l.lapTimeMs])).toEqual([[1, 1_920]]);
  });
  it('a second flashback after the first one still matches the reference run', () => {
    const { original, continuation } = scene(true);
    const again = timeline(360, [100, 340], { target: 300, event: true });             // equals the fork up to frame 300
    const a = new SessionRunner(initFor(original)); runAll(a, original); runAll(a, continuation); runAll(a, after(again, 300, 499));
    const b = new SessionRunner(initFor(original)); runAll(b, noFlbk(again));
    expect(a.state).toEqual(b.state);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/runner`
Expected: FAIL (`SessionRunner` is not exported)

- [ ] **Step 3: Implement `SessionRunner`, `SnapshotStore`, `historyLengths`, `truncateHistory`** (implementation agent; must not edit test files)

- **Snapshots.** The constructor stores a snapshot of `initialState(init)` at `frameId −1`. After each applied frame, take one when `frame.sessionTime ≥ lastSnapshot.sessionTime + snapshotEveryMs`. A snapshot is `structuredClone` of the state without `history`, plus `historyLengths(history)`. Snapshots are kept for the whole session (spec 5.4) unless a rewind drops them.
- **Frame buffer.** Append every applied frame. After each snapshot, take `keep = newestAtOrBeforeTime(frame.sessionTime − replayWindowMs)` and drop the buffered frames with `frameId ≤ keep.frameId`. So a target inside the window always has its frames after the restoring snapshot. Default 10 000 ms; check it against the flashback recording (spec 12, recording 3).
- **Detection, before stepping a frame.** An `FLBK` event gives the target `{ frameId: flashbackFrameIdentifier, sessionTime: Math.round(flashbackSessionTime × 1000) }`. Otherwise, `frame.frameId < state.lastFrameId` while `frame.overallFrameId >` the previous overall id gives the target `frameId = frame.frameId − 1`; its session time is the restored state's `sessionTime` after the replay. A target `≥ state.lastFrameId` is ignored.
- **Rewind.** Record `before = historyLengths(history)`. Take `snap = newestAtOrBefore(target.frameId)` and `dropAfter(snap.frameId)`. Then `truncateHistory(history, snap.lengths)` and set the state to `{ ...structuredClone(snap.state), history }`. Replay the buffered frames with `snap.frameId < frameId ≤ target.frameId` through `step`, and discard their corrections. Drop the buffered frames with `frameId > target.frameId`. Then apply the current frame normally.
- **Result.** On the rewinding frame:
  - `changed = new Set(ALL_CHANGE_TAGS)`
  - `delta = { before, after: historyLengths(after the current step), truncated: true }`
  - `flashback = { targetFrameId, targetSessionTime, rewoundMs: sessionTime before the rewind − targetSessionTime, targetLap }`, where `targetLap` is the player's `timing.lap` after the replay.

  On every other frame, `delta.before`/`after` surround the step and `truncated` is false.
- No clock and no I/O. `structuredClone` is allowed (pure).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/runner packages/engine/src/history/delta.ts packages/engine/src/index.ts packages/engine/test/runner
git commit -F - <<'EOF'
feat(engine): session runner with snapshots and flashback rewind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 18: Engine invariants (property tests over generated races and fixtures)

**Files:**
- Create (test support, test agent): `packages/engine/test/support/arb-race.ts`, `packages/engine/test/support/invariants.ts`
- Modify (test support, test agent): `apps/bridge/test/fixtures/engine-replay.ts` (add `replayRunner`)
- Test: `packages/engine/test/invariants/engine.property.test.ts`, `apps/bridge/test/fixtures/invariants.fixture.test.ts`
- This task adds no production files. A failing invariant is a bug in Tasks 13–17 and is fixed there (Step 3).

**Interfaces:**
- Consumes: `SessionRunner`, `StepResult`, `historyLengths` (Task 17); `initFor` (Task 14); `ScenarioBuilder`, `FrameDraft` (Task 12); `trackFixture` (Task 11); `EventDetails` (Task 5); `describeWithFixture`, `FixtureName` (Task 1).
- Produces (test support): `type RaceParams`, `arbRace: fc.Arbitrary<RaceParams>`, `raceFrames(p: RaceParams): { frames: Frame[]; reference: Frame[] }` (`reference` = the same race without the frames a flashback discarded); `class InvariantChecker { check(r: StepResult): void }` (throws an `Error` that names the invariant, car and frame); `replayRunner(name: FixtureName, onResult?: (r: StepResult, f: Frame) => void): Promise<SessionRunner>` (like `replayState`, through `SessionRunner.apply`).

- [ ] **Step 1: Write the generator, the checker, `replayRunner` and the tests** (test agent)

```ts
// packages/engine/test/support/arb-race.ts — a deterministic race on a 1000 m track, 16 ms frames, built through the encoder
import fc from 'fast-check';
import type { EventDetails } from '@pitwall/protocol';
import type { Frame } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';

const TRACK = 1000, STEP = 16;
export type RaceParams = { cars: number; frames: number; speeds: number[]; jitter: number[]; truncation: number[];
  flashback: { at: number; back: number; viaEvent: boolean } | undefined };
export const arbRace: fc.Arbitrary<RaceParams> = fc.record({
  cars: fc.integer({ min: 1, max: 6 }), frames: fc.integer({ min: 60, max: 300 }),
  speeds: fc.array(fc.integer({ min: 15, max: 45 }), { minLength: 6, maxLength: 6 }),
  jitter: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 20 }),
  truncation: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 5 }),       // the game truncates sectors: lap − Σ ∈ 0..2
  flashback: fc.option(fc.record({ at: fc.integer({ min: 20, max: 299 }), back: fc.integer({ min: 3, max: 60 }), viaEvent: fc.boolean() }), { nil: undefined }),
});
type Lap = { lapTimeInMs: number; sector1TimeMs: number; sector2TimeMs: number; sector3TimeMs: number; lapValidBitFlags: number };
type Car = { total: number; lapStart: number; lastLap: number; s1: number; s2: number; done: Lap[] };
type Tick = { rows: Array<Record<string, number>>; history: Lap[][] | undefined };

function simulate(p: RaceParams, cars: Car[], from: number, to: number, salt: number): Tick[] {
  const ticks: Tick[] = [];
  for (let i = from; i < to; i++) {
    const t = i * STEP;
    cars.forEach((c, k) => {
      const before = Math.floor(c.total / TRACK);
      c.total += p.speeds[k]! + p.jitter[(i * 7 + k + salt) % p.jitter.length]!;
      if (Math.floor(c.total / TRACK) > before) {
        c.lastLap = t - c.lapStart;
        c.done.push({ lapTimeInMs: c.lastLap, sector1TimeMs: c.s1, sector2TimeMs: c.s2,
          sector3TimeMs: c.lastLap - c.s1 - c.s2 - p.truncation[k % p.truncation.length]!, lapValidBitFlags: 0b1111 });
        Object.assign(c, { lapStart: t, s1: 0, s2: 0 });
      }
      const d = c.total % TRACK;
      if (c.s1 === 0 && d >= TRACK / 3) c.s1 = t - c.lapStart;
      if (c.s2 === 0 && d >= (2 * TRACK) / 3) c.s2 = t - c.lapStart - c.s1;
    });
    const order = cars.map((_, k) => k).sort((a, b) => cars[b]!.total - cars[a]!.total || a - b);
    ticks.push({ rows: cars.map((c, k) => ({ currentLapNum: Math.floor(c.total / TRACK) + 1, lapDistance: c.total % TRACK, totalDistance: c.total,
      lastLapTimeInMs: c.lastLap, sector1TimeMs: c.s1, sector2TimeMs: c.s2, carPosition: order.indexOf(k) + 1 })),
      history: i % 30 === 29 ? cars.map((c) => [...c.done]) : undefined });
  }
  return ticks;
}
function build(p: RaceParams, ticks: Tick[], event?: { before: number; details: EventDetails }): Frame[] {
  const apply = (d: FrameDraft) => {
    const tick = ticks[d.index]!;
    tick.rows.forEach((row, k) => Object.assign(d.lapData.lapData[k]!, row));
    tick.history?.forEach((laps, k) => d.add('sessionHistory', { carIdx: k, numLaps: laps.length + 1, lapHistoryData: [...laps, { lapValidBitFlags: 0b1111 }] }));
  };
  const b = new ScenarioBuilder({ cars: p.cars, stepMs: STEP }).session({ trackLength: TRACK });
  if (!event) return b.frames(ticks.length, apply).build();
  return b.frames(event.before, apply).event(event.details).frames(ticks.length - event.before, apply).build();
}
const fresh = (n: number): Car[] => Array.from({ length: n }, () => ({ total: 0, lapStart: 0, lastLap: 0, s1: 0, s2: 0, done: [] }));
export function raceFrames(p: RaceParams): { frames: Frame[]; reference: Frame[] } {
  const fb = p.flashback && p.flashback.at < p.frames && p.flashback.at - p.flashback.back >= 1 ? p.flashback : undefined;
  if (!fb) { const frames = build(p, simulate(p, fresh(p.cars), 0, p.frames, 0)); return { frames, reference: frames }; }
  const target = fb.at - fb.back, cars = fresh(p.cars);
  const prefix = simulate(p, cars, 0, target + 1, 0), fork = structuredClone(cars);
  const original = build(p, [...prefix, ...simulate(p, cars, target + 1, fb.at, 0)]);                       // frames 0..at-1
  const details: EventDetails = { code: 'FLBK', flashbackFrameIdentifier: target, flashbackSessionTime: (target * STEP) / 1000 };
  const replayed = build(p, [...prefix, ...simulate(p, fork, target + 1, target + 1 + p.frames - fb.at, 3)],  // salt 3: the timeline diverges
    fb.viaEvent ? { before: target + 1, details } : undefined);
  const continuation = replayed.slice(target + 1).map((f, k) => ({ ...f, overallFrameId: fb.at + k }));
  return { frames: [...original, ...continuation], reference: replayed.map((f) => ({ ...f, events: f.events.filter((e) => e.details.code !== 'FLBK') })) };
}
```

```ts
// packages/engine/test/support/invariants.ts — spec 10.2 invariants, checked on every StepResult
import type { HistoryLengths, StepResult } from '../../src/index.ts';
import { historyLengths } from '../../src/index.ts';

const key = (m: { carId: number; lap: number; segment: number }) => `${m.carId}/${m.lap}/${m.segment}`;
export class InvariantChecker {
  #lengths: HistoryLengths | undefined; #laps = new Map<number, number>(); #crossings = new Set<string>();
  check(r: StepResult): void {
    const { state, delta } = r, at = `frame ${state.lastFrameId}`;
    const active = state.cars.filter((c) => c.active);
    const positions = active.map((c) => c.timing.position).sort((a, b) => a - b);
    if (positions.some((p, i) => p !== i + 1)) throw new Error(`positions not a permutation of 1..${active.length} at ${at}: ${positions.join(',')}`);
    for (const c of active) {
      const prev = this.#laps.get(c.id);
      if (prev !== undefined && c.timing.lap < prev && r.flashback === undefined) throw new Error(`car ${c.id} lap ${prev} -> ${c.timing.lap} without flashback at ${at}`);
      this.#laps.set(c.id, c.timing.lap);
    }
    if (JSON.stringify(delta.after) !== JSON.stringify(historyLengths(state.history))) throw new Error(`delta.after differs from the history lengths at ${at}`);
    if (this.#lengths && JSON.stringify(delta.before) !== JSON.stringify(this.#lengths)) throw new Error(`delta.before differs from the previous delta.after at ${at}`);
    if (!delta.truncated) for (const k of Object.keys(delta.after) as Array<keyof HistoryLengths>)
      if (delta.after[k] < delta.before[k]) throw new Error(`history.${k} shrank without truncation at ${at}`);
    this.#lengths = delta.after;
    for (const l of state.history.laps.slice(delta.truncated ? 0 : delta.before.laps)) {
      const rest = l.lapTimeMs - l.sectorTimesMs[0] - l.sectorTimesMs[1] - l.sectorTimesMs[2];
      if (l.status === 'confirmed' && (rest < 0 || rest > 2)) throw new Error(`confirmed lap ${l.carId}/${l.lapNumber}: sectors off by ${rest} ms`);
    }
    if (delta.truncated) this.#crossings = new Set(state.history.miniSectors.map(key));
    else for (const m of state.history.miniSectors.slice(delta.before.miniSectors)) {
      if (this.#crossings.has(key(m))) throw new Error(`mini-sector ${key(m)} emitted twice at ${at}`);
      this.#crossings.add(key(m));
    }
  }
}
```

```ts
// packages/engine/test/invariants/engine.property.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SessionRunner, type Frame, type StepResult } from '../../src/index.ts';
import { arbRace, raceFrames } from '../support/arb-race.ts';
import { InvariantChecker } from '../support/invariants.ts';
import { initFor } from '../support/run.ts';

const run = (frames: Frame[], each?: (r: StepResult) => void) => {
  const runner = new SessionRunner(initFor(frames)); for (const f of frames) each?.(runner.apply(f)); return runner;
};
const OPTS = { numRuns: 40 };

describe('engine invariants (spec 10.2)', () => {
  it('positions, monotone laps, growing history, sector sums and unique crossings hold on every step', () => {
    fc.assert(fc.property(arbRace, (p) => { const c = new InvariantChecker(); run(raceFrames(p).frames, (r) => c.check(r)); }), OPTS);
  });
  it('a flashback (FLBK, or frameId going back) yields the state of a run that never had the discarded frames', () => {
    fc.assert(fc.property(arbRace, (p) => { const { frames, reference } = raceFrames(p); expect(run(frames).state).toEqual(run(reference).state); }), OPTS);
  });
  it('is deterministic: the same frames give the same state and the same results', () => {
    fc.assert(fc.property(arbRace, (p) => {
      const { frames } = raceFrames(p);
      const trace = (out: unknown[]) => (r: StepResult) => out.push({ changed: [...r.changed].sort(), delta: r.delta, flashback: r.flashback, corrections: r.corrections });
      const a: unknown[] = [], b: unknown[] = [];
      expect(run(frames, trace(a)).state).toEqual(run(frames, trace(b)).state);
      expect(a).toEqual(b);
    }), OPTS);
  });
});
```

```ts
// apps/bridge/test/fixtures/invariants.fixture.test.ts
import { expect, it } from 'vitest';
import { InvariantChecker } from '../../../../packages/engine/test/support/invariants.ts';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayRunner } from './engine-replay.ts';

describeWithFixture('ttZandvoort', 'engine invariants on TT Zandvoort', () => {
  it('hold on every frame; 15 confirmed laps', async () => {
    const checker = new InvariantChecker();
    const runner = await replayRunner('ttZandvoort', (r) => checker.check(r));
    expect(runner.state.history.laps.filter((l) => l.status === 'confirmed')).toHaveLength(15);
  }, 180_000);
});
describeWithFixture('raceSingapore', 'engine invariants on the Singapore race', () => {
  it('hold on every frame; 20 active cars', async () => {
    const checker = new InvariantChecker();
    const runner = await replayRunner('raceSingapore', (r) => checker.check(r));
    expect(runner.state.cars.filter((c) => c.active)).toHaveLength(20);
  }, 180_000);
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run packages/engine/test/invariants apps/bridge/test/fixtures/invariants.fixture.test.ts`
Expected: PASS if Tasks 13–17 are correct. Otherwise the output names the broken invariant and the shrunk `fc` counterexample (seed and path).

- [ ] **Step 3: Fix every reported violation in the owning module** (implementation agent; must not edit test files)

Fix it in `packages/engine/src/step`, `history` or `runner`, one commit per violation (`fix(engine): …`, naming the invariant and the counterexample). If nothing fails, this step is empty.

- [ ] **Step 4: Run the whole engine suite and the mutation gate**

Run: `pnpm vitest run packages/engine apps/bridge/test/fixtures && pnpm exec stryker run packages/engine/stryker.config.mjs`
Expected: PASS; mutation score ≥ 80 %. For a surviving mutant in `step`, `history` or `runner` that shows a missing rule, add a spec-first test to the owning task's test file in a separate commit.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/test/support packages/engine/test/invariants apps/bridge/test/fixtures/engine-replay.ts apps/bridge/test/fixtures/invariants.fixture.test.ts
git commit -F - <<'EOF'
test(engine): property and fixture invariants for positions, laps, history and flashbacks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

**Spec 10.2 checklist → covering tests** (reviewers tick every row before merging Task 18):

| Spec 10.2 rule | Covered by |
|---|---|
| Lap detection with a lost frame | T15 `history/laps.test.ts` › "a lost frame cannot swallow a lap…" |
| Provisional → confirmed with correction | T15 `history/laps.test.ts` › "confirms from SessionHistory…"; T15 `laps.fixture.test.ts` (laps 1, 4, 9) |
| Flashback rewind | T17 `runner/session-runner.test.ts` › "FLBK: rewind + continuation…", "detects a flashback without FLBK…", "a target older than the replay window…", "a second flashback…"; T18 property "a flashback … yields the state of a run that never had the discarded frames" |
| UID-0 grace window after `SEND` | T11 `frame/session-tracker.test.ts`; T11 `session-tracker.fixture.test.ts` (Singapore UID-0 bulk SessionHistory) |
| A session only opens on a Session packet | T11 `frame/session-tracker.test.ts`; T11 fixture (`menuOnly`: no session) |
| Restricted → `unknown('restricted')` | T13 `step/identity.test.ts` (visibility); T14 `step/car-state.test.ts` › "a restricted human car…", "a public human car with 0 fuel…"; T15 › "fuel at lap start/end of a restricted car…" |
| Frame ID gaps ≠ loss | T10 assembler tests |
| Variable session-time step | T10 assembler cadence tests; T15 › "SC/VSC share…" (uses the real dt); T16 mini-sector interpolation tests |
| Positions are a permutation 1..n of the active cars | T18 `InvariantChecker` (property and both fixtures); T14 › "LapData resultStatus drives car.active" |
| Lap numbers don't go down (except on a flashback) | T18 `InvariantChecker` |
| History only grows (except flashback truncation) | T18 `InvariantChecker`; T17 › "reports chained history deltas…" |
| Sector sum = lap time for confirmed laps | T18 `InvariantChecker`, to within 0–2 ms, because the game truncates each sector (TT Zandvoort lap 1: 71 910 ms, sectors sum to 71 909) |
| Incremental = from scratch | T20 scheduler tests |
| Determinism | T18 property "is deterministic…" (engine level); T30 `topicStreamHash` (topic stream) |
| Fixture facts TT Zandvoort | T15 `laps.fixture.test.ts` (15 laps, 71.910/71.081/73.253 s, no fuel use); T16 `events.fixture.test.ts` (FTLP ×4); T13/T30 (one car) |
| Fixture facts race Singapore | T13 `identity.fixture.test.ts` (20 cars, human at index 19); T16 `events.fixture.test.ts` (STLG ×5, LGOT ×1, OVTK ×39, COLL ×4, PENA ×6); T15 (no lap completed); T11 (final bulk SessionHistory with UID 0) |
| Fixture `menuOnly`: no session opened | T11; T30 |
| Protocol round trip, sizes, real packets | T4, T6 |
| Bridge integration with reconnect and resubscribe | T25, T27 |
| Test builder generates frames through the encoder | T12 (`ScenarioBuilder`); T18 `arb-race.ts` builds every generated race through it |

---

### Task 19: Calculator types, registry, insight book

**Files:**
- Create: `packages/engine/src/calc/types.ts`, `packages/engine/src/calc/registry.ts`, `packages/engine/src/calc/insight-book.ts`, `packages/engine/src/util/rng.ts`
- Modify: `packages/engine/src/index.ts` (export the names below)
- Test: `packages/engine/test/calc/registry.test.ts`, `packages/engine/test/calc/insight-book.test.ts`, `packages/engine/test/util/rng.test.ts`

**Interfaces:**
- Consumes: `ChangeTag`, `HistoryDelta`, `HistoryLengths`, `EngineState`, `DeepReadonly` (Tasks 9, 13–17); `FrameMetrics` (Task 10); `Insight`, `FeedId`, `SessionTime` from `@pitwall/domain`.
- Produces (verbatim from the contract): `CalculatorId`, `Cadence`, `Dependency`, `FeedMetricsView`, `EngineView`, `QuickCalculator<Out>`, `IncrementalCalculator<Acc, Out>`, `Calculator`, `CalculatorRegistry`, `InsightChange`, `InsightBook`, `createRng(seed)`, `Rng`.
- Produces (new): `class RegistryError extends Error { readonly reason: 'duplicateId' | 'unknownDependency' | 'cycle'; readonly ids: readonly CalculatorId[] }`.
- Produces (extends contract): `FeedMetricsView = FrameMetrics & { packetsPerSecond: number; latencyMs?: number; connected: boolean; msSinceLastPacket: number; lossPercent: number /* incomplete ÷ closed frames over the last 10 s of receive time, 0..100 */; wrongFormat?: number /* packetFormat of a wrong-format packet seen in the last 10 s */ }` — filled by `FeedMonitor` (Task 27), read by feed insights (Task 23).

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/engine/test/calc/registry.test.ts
import { describe, expect, it } from 'vitest';
import { CalculatorRegistry, RegistryError, type Calculator, type Dependency } from '../../src/index.ts';

const calc = (id: string, reads: Dependency[] = ['timing']): Calculator =>
  ({ kind: 'quick', id, reads, cadence: 'frame', compute: () => id });

describe('CalculatorRegistry', () => {
  it('orders dependencies before dependents', () => {
    const r = CalculatorRegistry.build([calc('c', [{ calculator: 'b' }]), calc('b', [{ calculator: 'a' }]), calc('a')]);
    expect(r.order.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
  it('keeps input order among independent calculators', () => {
    const r = CalculatorRegistry.build([calc('z'), calc('y'), calc('x', [{ calculator: 'z' }])]);
    expect(r.order.map((c) => c.id)).toEqual(['z', 'y', 'x']);
  });
  it('get and dependentsOf', () => {
    const r = CalculatorRegistry.build([calc('a'), calc('b', [{ calculator: 'a' }]), calc('c', [{ calculator: 'a' }, 'laps'])]);
    expect(r.get('b')?.id).toBe('b');
    expect(r.get('nope')).toBeUndefined();
    expect(r.dependentsOf('a')).toEqual(['b', 'c']);
    expect(r.dependentsOf('c')).toEqual([]);
  });
  it('rejects a duplicate id and names it', () => {
    expect(() => CalculatorRegistry.build([calc('lapStats'), calc('lapStats')])).toThrow(RegistryError);
    expect(() => CalculatorRegistry.build([calc('lapStats'), calc('lapStats')])).toThrow(/duplicate calculator id "lapStats"/);
  });
  it('rejects an unknown calculator dependency and names both ids', () => {
    expect(() => CalculatorRegistry.build([calc('gaps', [{ calculator: 'miniSectors' }])]))
      .toThrow(/calculator "gaps" depends on unknown calculator "miniSectors"/);
  });
  it('rejects a cycle and names the ids on it', () => {
    const build = () => CalculatorRegistry.build([calc('a', [{ calculator: 'c' }]), calc('b', [{ calculator: 'a' }]), calc('c', [{ calculator: 'b' }]), calc('d')]);
    expect(build).toThrow(/dependency cycle: a -> c -> b -> a/);
    try { build(); } catch (e) { expect((e as RegistryError).reason).toBe('cycle'); expect((e as RegistryError).ids).toEqual(['a', 'c', 'b']); }
  });
});
```

```ts
// packages/engine/test/calc/insight-book.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedId, Insight } from '@pitwall/domain';
import { InsightBook } from '../../src/index.ts';

const ins = (key: string): Insight => ({ key, severity: 'advisory', category: 'feed', feedId: 'f1' as FeedId, kind: key, params: {}, raisedAt: 0 });

describe('InsightBook', () => {
  it('raises once per key while the condition holds', () => {
    const b = new InsightBook();
    expect(b.apply('src', [ins('feed.stale')], 1000)).toEqual([{ type: 'raised', insight: { ...ins('feed.stale'), raisedAt: 1000 } }]);
    expect(b.apply('src', [ins('feed.stale')], 2000)).toEqual([]);
    expect(b.apply('src', [ins('feed.stale'), ins('feed.stale')], 2500)).toEqual([]);
    expect(b.active.map((i) => i.key)).toEqual(['feed.stale']);
  });
  it('resolves a key absent from current and re-raises it later', () => {
    const b = new InsightBook();
    b.apply('src', [ins('k')], 1000);
    expect(b.apply('src', [], 3000)).toEqual([{ type: 'resolved', key: 'k', at: 3000 }]);
    expect(b.active).toEqual([]);
    expect(b.apply('src', [ins('k')], 4000)).toEqual([{ type: 'raised', insight: { ...ins('k'), raisedAt: 4000 } }]);
  });
  it('tracks sources independently', () => {
    const b = new InsightBook();
    b.apply('a', [ins('x')], 1);
    expect(b.apply('b', [], 2)).toEqual([]);
    expect(b.active.map((i) => i.key)).toEqual(['x']);
  });
  it('orders changes deterministically: resolutions in raise order, then raises in current order', () => {
    const b = new InsightBook();
    b.apply('s', [ins('b'), ins('a')], 1);
    expect(b.apply('s', [ins('d'), ins('c')], 2)).toEqual([
      { type: 'resolved', key: 'b', at: 2 }, { type: 'resolved', key: 'a', at: 2 },
      { type: 'raised', insight: { ...ins('d'), raisedAt: 2 } }, { type: 'raised', insight: { ...ins('c'), raisedAt: 2 } },
    ]);
    expect(b.active.map((i) => i.key)).toEqual(['d', 'c']);
  });
});
```

```ts
// packages/engine/test/util/rng.test.ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../../src/index.ts';

describe('createRng (mulberry32)', () => {
  it('matches the mulberry32 reference sequence for seed 42', () => {
    const r = createRng(42);
    expect([r.next(), r.next(), r.next()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  });
  it('same seed, same sequence; values in [0,1); int within inclusive bounds', () => {
    fc.assert(fc.property(fc.integer(), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 }), (seed, min, span) => {
      const a = createRng(seed), b = createRng(seed);
      for (let i = 0; i < 20; i++) {
        const x = a.next();
        expect(x).toBe(b.next());
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1);
        const n = a.int(min, min + span); b.int(min, min + span);
        expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(min); expect(n).toBeLessThanOrEqual(min + span);
      }
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/calc packages/engine/test/util/rng.test.ts`
Expected: FAIL (modules/exports not found)

- [ ] **Step 3: Implement** (implementation agent; must not edit test files)

- `calc/types.ts`: the types from the contract plus the extended `FeedMetricsView` above. `insights?(out, prev, view)` on both calculator kinds.
- `calc/registry.ts`: `CalculatorRegistry.build(calcs)` — checks in this order: duplicate ids (message `duplicate calculator id "<id>"`), unknown `{ calculator }` dependencies (`calculator "<id>" depends on unknown calculator "<dep>"`), cycles (`dependency cycle: <a> -> <b> -> … -> <a>`, `ids` = the cycle starting at the first calculator in input order that lies on it). Order = Kahn's algorithm where the ready set is always taken in input order. `dependentsOf(id)` = direct dependents in `order`. Only `{ calculator }` dependencies create edges; `ChangeTag`/`'feed'` are inputs.
- `calc/insight-book.ts`: state = per `sourceId` an insertion-ordered `Map<key, Insight>`. `apply` dedupes `current` by key (first wins), emits resolutions for previously active keys missing from `current` (in raise order), then raises for new keys (in `current` order) with `raisedAt: at`. `active` = all sources' active insights, sources in first-seen order.
- `util/rng.ts`: mulberry32; `int(min, max)` = `min + Math.floor(next() * (max - min + 1))`.

```ts
let a = seed | 0;
next() { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/engine/test/calc packages/engine/test/util/rng.test.ts` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/calc packages/engine/src/util/rng.ts packages/engine/src/index.ts packages/engine/test/calc packages/engine/test/util
git commit -F - <<'EOF'
feat(engine): calculator types, registry, insight book and seeded rng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 20: Scheduler and feature convention loader

**Files:**
- Create: `packages/engine/src/calc/scheduler.ts`, `packages/engine/test/helpers/incremental.ts`, `scripts/gen-features.ts`, `apps/bridge/src/features/feature.ts`
- Modify: `packages/engine/src/index.ts` (export `Scheduler`, `SchedulerResult`)
- Test: `packages/engine/test/calc/scheduler.test.ts`, `packages/engine/test/calc/incremental.test.ts`, `scripts/gen-features.test.ts`

**Interfaces:**
- Consumes: Task 19 calc types, `CalculatorRegistry`, `InsightBook`; `SessionRunner`, `StepResult` (Task 17); `Frame` (Task 10); `ScenarioBuilder` (Task 12); `History` (Task 9).
- Produces (contract): `Scheduler`, `SchedulerResult`, `TopicBinding`, `Feature`, `defineFeature(f)`; generated `apps/bridge/src/features/index.generated.ts` exporting `FEATURES: Feature[]`.
- Produces (new): `expectIncrementalEqualsFromScratch<Acc, Out>(calc: IncrementalCalculator<Acc, Out>, frames: readonly Frame[], feed?: FeedMetricsView): void` and `IDLE_FEED: FeedMetricsView` in `packages/engine/test/helpers/incremental.ts`; in `scripts/gen-features.ts`: `findFeatureFolders(featuresDir: string): string[]`, `renderFeaturesIndex(folders: readonly string[]): string`, `generateFeatures(featuresDir?: string, outFile?: string): void`.

- [ ] **Step 1: Write the failing scheduler tests** (test agent)

```ts
// packages/engine/test/calc/scheduler.test.ts
import { describe, expect, it } from 'vitest';
import { CalculatorRegistry, Scheduler, type Calculator, type ChangeTag, type FeedMetricsView, type HistoryDelta, type IncrementalCalculator, type QuickCalculator } from '../../src/index.ts';

const len = (laps = 0) => ({ laps, stints: 0, pitStops: 0, flagPhases: 0, events: 0, miniSectors: 0 });
const delta = (b = 0, a = b, truncated = false): HistoryDelta => ({ before: len(b), after: len(a), truncated });
const feed = { framesClosed: 0, incompleteFrames: 0, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0, packetsPerSecond: 0, connected: true, msSinceLastPacket: 0, lossPercent: 0 } as FeedMetricsView;
const input = (t: number, changed: ChangeTag[] = ['timing'], d = delta(), laps = d.after.laps) =>
  ({ state: { feedId: 'f1', sessionTime: t, history: { laps: new Array(laps).fill({}) } } as never, changed: new Set(changed), delta: d, feed });
const quick = (id: string, o: Partial<QuickCalculator<unknown>> = {}): Calculator => ({ kind: 'quick', id, reads: ['timing'], cadence: 'frame', compute: (v) => v.state.sessionTime, ...o } as Calculator);
const sched = (calcs: Calculator[], needed = calcs.map((c) => c.id)) => { const s = new Scheduler(CalculatorRegistry.build(calcs)); s.setNeeded(needed); return s; };

describe('Scheduler', () => {
  it('{ hz: 2 } runs at most every 500 ms of session time', () => {
    const s = sched([quick('a', { cadence: { hz: 2 } })]);
    expect([0, 100, 499, 500, 600, 1000].map((t) => s.run(input(t)).ran)).toEqual([['a'], [], [], ['a'], [], ['a']]);
  });
  it('runs on first activation, then only when affected', () => {
    const s = sched([quick('a', { reads: ['laps'] })]);
    expect(s.run(input(0, ['timing'])).ran).toEqual(['a']);
    expect(s.run(input(16, ['timing'])).ran).toEqual([]);
    expect(s.run(input(32, ['laps'])).ran).toEqual(['a']);
  });
  it('remembers changes from frames where it was not due', () => {
    const s = sched([quick('a', { reads: ['laps'], cadence: { hz: 2 } })]);
    s.run(input(0)); s.run(input(100, ['laps']));
    expect(s.run(input(500, ['timing'])).ran).toEqual(['a']);
  });
  it('event cadences', () => {
    const lap = sched([quick('l', { reads: ['laps'], cadence: 'lapCompleted' })]); lap.run(input(0));
    expect(lap.run(input(1, ['laps'], delta(3, 3))).ran).toEqual([]);
    expect(lap.run(input(2, ['laps'], delta(3, 4))).ran).toEqual(['l']);
    const ses = sched([quick('s', { reads: ['session', 'timing'], cadence: 'sessionChange' })]); ses.run(input(0));
    expect(ses.run(input(1, ['timing'])).ran).toEqual([]);
    expect(ses.run(input(2, ['session'])).ran).toEqual(['s']);
  });
  it('runs needed calculators and their transitive dependencies only', () => {
    const s = sched([quick('a'), quick('b', { reads: [{ calculator: 'a' }] }), quick('c', { reads: [{ calculator: 'b' }] }), quick('d')], ['c']);
    expect(s.run(input(0)).ran).toEqual(['a', 'b', 'c']);
  });
  it('a dependency that ran makes its dependents affected; outputs persist', () => {
    const s = sched([quick('a', { reads: ['laps'] }), quick('b', { reads: [{ calculator: 'a' }], compute: (v) => v.outputs.get('a') })]);
    s.run(input(0));
    expect(s.run(input(16, ['timing'])).ran).toEqual([]);
    const r = s.run(input(32, ['laps']));
    expect(r.ran).toEqual(['a', 'b']);
    expect(r.outputs).toEqual(new Map([['a', 32], ['b', 32]]));
  });
  it('a throwing calculator: errors entry, calculatorError insight, dependents skipped, others run', () => {
    let fail = true;
    const s = sched([quick('a', { compute: () => { if (fail) throw new Error('boom'); return 1; } }), quick('b', { reads: [{ calculator: 'a' }] }), quick('c')]);
    const r = s.run(input(5));
    expect(r.ran).toEqual(['c']);
    expect(r.errors.map((e) => e.id)).toEqual(['a']);
    expect(r.outputs.has('a')).toBe(false);
    expect(r.insights).toEqual([{ type: 'raised', insight: { key: 'system.calculatorError:a', severity: 'advisory', category: 'system', feedId: 'f1', kind: 'system.calculatorError', params: { calculatorId: 'a', message: 'boom' }, raisedAt: 5 } }]);
    fail = false;
    const r2 = s.run(input(6));
    expect(r2.ran).toEqual(['a', 'b', 'c']);
    expect(r2.insights).toEqual([{ type: 'resolved', key: 'system.calculatorError:a', at: 6 }]);
  });
  it('calculator insights go through the insight book with prev output', () => {
    const seen: Array<[unknown, unknown]> = [];
    const s = sched([quick('a', { insights: (out, prev) => { seen.push([out, prev]); return [{ key: 'k', severity: 'info', category: 'race', feedId: 'f1', kind: 'k', params: {}, raisedAt: 0 }] as never; } })]);
    expect(s.run(input(1)).insights).toHaveLength(1);
    expect(s.run(input(2)).insights).toEqual([]);
    expect(seen).toEqual([[1, undefined], [2, 1]]);
  });

  describe('incremental', () => {
    const calls: string[] = [];
    const counter = (o: Partial<IncrementalCalculator<number, number>> = {}): Calculator => ({
      kind: 'incremental', id: 'n', reads: ['laps'], cadence: 'frame',
      init: (v) => { calls.push('init'); return v.state.history.laps.length; },
      update: (acc, d) => { calls.push(`update ${d.before.laps}->${d.after.laps}`); return acc + d.after.laps - d.before.laps; },
      output: (acc) => acc, ...o,
    } as Calculator);
    it('init on first run, update with delta, re-init on truncation and after reset()', () => {
      calls.length = 0;
      const s = sched([counter()]);
      expect(s.run(input(0, ['laps'], delta(2, 2))).outputs.get('n')).toBe(2);
      expect(s.run(input(1, ['laps'], delta(2, 3))).outputs.get('n')).toBe(3);
      expect(s.run(input(2, ['laps'], delta(3, 1, true))).outputs.get('n')).toBe(1);
      s.reset();
      s.run(input(3, ['laps'], delta(1, 1)));
      expect(calls).toEqual(['init', 'update 2->3', 'init', 'init']);
    });
    it('merges deltas across runs it skipped', () => {
      calls.length = 0;
      const s = sched([counter({ cadence: { hz: 2 } })]);
      s.run(input(0, ['laps'], delta(0, 0)));
      s.run(input(100, ['laps'], delta(0, 2)));
      expect(s.run(input(500, ['laps'], delta(2, 3))).outputs.get('n')).toBe(3);
      expect(calls).toEqual(['init', 'update 0->3']);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/engine/test/calc/scheduler.test.ts` — Expected: FAIL (`Scheduler` not exported)

- [ ] **Step 3: Implement `class Scheduler` in `packages/engine/src/calc/scheduler.ts`** (implementation agent; must not edit test files)

Per calculator in `registry.order`, keep `{ lastRunAt?, pendingChanged: Set<ChangeTag>, pendingDelta?: HistoryDelta, acc?, prevOut? }`. Each `run`: first add `input.changed` to every `pendingChanged` and merge `input.delta` into `pendingDelta` (`before` = oldest before, `after` = newest after, `truncated` OR-ed). Then for each needed calculator (`setNeeded` set + transitive `{ calculator }` deps; empty until `setNeeded` is called) in order: skip if a dependency errored this run; run if never run, else if **due** and **affected**.
- due: `'frame'` always; `{ hz }`: `sessionTime - lastRunAt >= 1000 / hz` or `sessionTime < lastRunAt`; `'lapCompleted'`/`'pitStop'`: `pendingDelta.after.laps|pitStops > pendingDelta.before.…`; `'flagChange'`: `pendingChanged.has('flagPhases')`; `'sessionChange'`: `pendingChanged.has('session')`.
- affected: `reads` contains `'feed'`, or a `ChangeTag` in `pendingChanged`, or a `{ calculator }` that ran this run.
- incremental: `init(view)` when no acc or `pendingDelta.truncated`, else `update(acc, pendingDelta, view)`; output = `output(acc)`.
After a successful run: clear pending state, set `lastRunAt`, store output, call `insights(out, prev, view)` and `book.apply(id, list, sessionTime)`. Errors: catch, keep pending state and `lastRunAt` (so it retries when due and affected; a calculator that never succeeded retries every run), delete the output, push `{ id, error }`, apply `system.calculatorError` (params `{ calculatorId, message }`, advisory, system, key `system.calculatorError:<id>`) to book source `error:<id>`; a successful run applies `[]` to that source. `view.outputs` = the persistent output map; `reset()` drops all accs, prev outputs and `lastRunAt` (not outputs).

- [ ] **Step 4: Run tests to verify they pass** — Run: `pnpm vitest run packages/engine/test/calc/scheduler.test.ts` — Expected: PASS

- [ ] **Step 5: Write the failing incremental-helper tests** (test agent)

```ts
// packages/engine/test/calc/incremental.test.ts
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IncrementalCalculator } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { expectIncrementalEqualsFromScratch } from '../helpers/incremental.ts';

type Counts = Record<string, number>;
const fold = (acc: Counts, events: ReadonlyArray<{ kind: string }>) => { const n = { ...acc }; for (const e of events) n[e.kind] = (n[e.kind] ?? 0) + 1; return n; };
const eventCounter: IncrementalCalculator<Counts, Counts> = {
  kind: 'incremental', id: 'eventCounts', reads: ['events'], cadence: 'frame',
  init: (v) => fold({}, v.state.history.events),
  update: (acc, d, v) => fold(acc, v.state.history.events.slice(d.before.events, d.after.events)),
  output: (acc) => acc,
};
const scenario = (gaps: Array<[number, number]>) => {
  const b = new ScenarioBuilder({ cars: 4 }).session().participants();
  for (const [gap, car] of gaps) b.frames(gap, () => {}).event({ code: 'FTLP', vehicleIdx: car, lapTime: 80 + car });
  return b.frames(2, () => {}).build();
};

describe('expectIncrementalEqualsFromScratch', () => {
  it('holds for a correct fold over random event streams', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 3 })), { maxLength: 8 }),
      (gaps) => expectIncrementalEqualsFromScratch(eventCounter, scenario(gaps))), { numRuns: 30 });
  });
  it('fails for an update that ignores the delta', () => {
    const broken = { ...eventCounter, update: (acc: Counts) => acc };
    expect(() => expectIncrementalEqualsFromScratch(broken, scenario([[1, 0]]))).toThrow();
  });
});
```

- [ ] **Step 6: Run** `pnpm vitest run packages/engine/test/calc/incremental.test.ts` — Expected: FAIL (helper missing)

- [ ] **Step 7: Implement the helper** (implementation agent). Builds a `SessionRunner` from the first frame carrying `session` (`{ feedId, sessionUid, session }`), applies every frame, keeps `acc` exactly like the scheduler (`init` first and on `delta.truncated`, else `update`) with `view = { state, changed, delta, feed, outputs: new Map() }`, and after every frame asserts `expect(calc.output(acc), \`frame ${i}\`).toEqual(calc.output(calc.init(view)))`. `IDLE_FEED`: all counters 0, `connected: true`, `msSinceLastPacket: 0`, `lossPercent: 0`, `packetsPerSecond: 0`. Every future incremental calculator's test file must call this helper.

- [ ] **Step 8: Run** — Expected: PASS

- [ ] **Step 9: Write the failing feature-loader tests** (test agent)

```ts
// scripts/gen-features.test.ts
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findFeatureFolders, generateFeatures, renderFeaturesIndex } from './gen-features.ts';
import { defineFeature } from '../apps/bridge/src/features/feature.ts';

const feature = (dir: string, name: string) => { mkdirSync(join(dir, name)); writeFileSync(join(dir, name, 'register.ts'), 'export default {};\n'); };

describe('gen-features', () => {
  it('collects folders with register.ts, sorted by code unit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'features-'));
    feature(dir, 'session-info'); feature(dir, 'alpha'); feature(dir, 'Zeta');
    mkdirSync(join(dir, 'notes')); writeFileSync(join(dir, 'README.md'), '');
    expect(findFeatureFolders(dir)).toEqual(['Zeta', 'alpha', 'session-info']);
  });
  it('renders the exact index', () => {
    expect(renderFeaturesIndex(['cars-overview', 'session-info'])).toBe(
      "// Generated by scripts/gen-features.ts. Do not edit.\nimport type { Feature } from './feature.ts';\n" +
      "import feature0 from './cars-overview/register.ts';\nimport feature1 from './session-info/register.ts';\n\n" +
      'export const FEATURES: Feature[] = [feature0, feature1];\n');
    expect(renderFeaturesIndex([])).toContain('export const FEATURES: Feature[] = [];');
  });
  it('is deterministic and picks up a new feature folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'features-')); const out = join(dir, 'index.generated.ts');
    feature(dir, 'session-info');
    generateFeatures(dir, out); const first = readFileSync(out, 'utf8');
    generateFeatures(dir, out); expect(readFileSync(out, 'utf8')).toBe(first);
    feature(dir, 'temp-feature'); generateFeatures(dir, out);
    expect(readFileSync(out, 'utf8')).toBe(renderFeaturesIndex(['session-info', 'temp-feature']));
  });
  it('defineFeature returns the feature unchanged', () => {
    const f = { name: 'x', calculators: [], topics: [] };
    expect(defineFeature(f)).toBe(f);
  });
});
```

- [ ] **Step 10: Run** `pnpm vitest run scripts/gen-features.test.ts` — Expected: FAIL (modules missing)

- [ ] **Step 11: Implement** (implementation agent). `feature.ts`: the contract's `TopicBinding`, `Feature`, `defineFeature` (identity, typed). `gen-features.ts`: sort with `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`; defaults `featuresDir = apps/bridge/src/features`, `outFile = <featuresDir>/index.generated.ts` (resolved from `import.meta.dirname`); runs `generateFeatures()` when executed directly (`process.argv[1] === fileURLToPath(import.meta.url)`). Root `gen:features` = `node scripts/gen-features.ts` (already wired in Task 1).

- [ ] **Step 12: Run** `pnpm vitest run scripts/gen-features.test.ts packages/engine/test/calc` — Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add packages/engine/src/calc/scheduler.ts packages/engine/src/index.ts packages/engine/test scripts apps/bridge/src/features/feature.ts
git commit -F - <<'EOF'
feat(engine,bridge): scheduler, incremental test helper, feature convention loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 21: Topic definitions, WebSocket messages, wire format (supervisor)

**Files:**
- Create: `packages/contracts/src/version.ts`, `packages/contracts/src/topics.ts`, `packages/contracts/src/messages.ts`, `packages/contracts/src/wire.ts`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/topics.test.ts`, `packages/contracts/test/wire.test.ts`

**Interfaces:**
- Consumes (`@pitwall/domain` only): `FeedId`, `CarId`, `SessionUid`, `SessionTime`, `SessionState`, `CarState`, `LapRecord`, `StintRecord`, `PitStopRecord`, `FlagPhase`, `RaceEvent`, `Insight`, `VisualCompound`, `CarDynamics` (Task 9 sub-type).
- Produces (contract): `CONTRACT_VERSION = 1`, `TopicDef<P, V>`, `TOPICS`, `TopicName`, `TopicParams<T>`, `TopicValue<T>`, `ClientMessage`, `ServerMessage`, `encodeMessage`, `decodeClientMessage`, `decodeServerMessage`.
- Produces (new wire DTOs, `topics.ts`; `sessionUid` is always the decimal string `SessionUid`, never `bigint`):
  ```ts
  type FeedStatus = { feedId: FeedId; connected: boolean; stale: boolean; lossPercent: number; latePackets: number; decodeErrors: number; packetsPerSecond: number; latencyMs?: number; wrongFormat?: number };
  type SessionInfo = { feedId: FeedId; sessionUid: SessionUid; playerCar: CarId; teammateCar?: CarId; session: SessionState };
  type CarOverview = { id: CarId; identity: CarState['identity']; timing: CarState['timing']; tyres: Pick<CarState['tyres'], 'actualCompound' | 'visualCompound' | 'age'> };
  type InsightEntry = { type: 'raised'; insight: Insight } | { type: 'resolved'; key: string; at: SessionTime };   // structurally = engine InsightChange
  type FeedInfo = { feedId: FeedId; kind: 'udp' | 'replay'; label: string; sessionUid?: SessionUid };
  type ReservedCommand = { kind: 'boxCall'; tyre: VisualCompound };   // placeholder for sub-project 6
  ```
- Contract deviation: `def` takes the name as first argument (`def<P, V>(name, mode, maxHz)`) so `TOPICS[k].name === k` holds without a cast.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// packages/contracts/test/topics.test.ts
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, TOPICS } from '../src/index.ts';

describe('TOPICS', () => {
  it('matches spec 8.4 exactly', () => {
    const table = Object.entries(TOPICS).map(([k, d]) => [k, d.name, d.mode, d.maxHz]);
    expect(table).toEqual([
      ['feed.status', 'feed.status', 'state', 2], ['session.info', 'session.info', 'state', 2],
      ['cars.overview', 'cars.overview', 'state', 10], ['car.detail', 'car.detail', 'state', 30],
      ['car.telemetry', 'car.telemetry', 'state', 60], ['laps', 'laps', 'append', Infinity],
      ['stints', 'stints', 'append', Infinity], ['pitStops', 'pitStops', 'append', Infinity],
      ['flagPhases', 'flagPhases', 'append', Infinity], ['events', 'events', 'append', Infinity],
      ['insights', 'insights', 'append', Infinity],
    ]);
  });
  it('exports the contract version', () => { expect(CONTRACT_VERSION).toBe(1); });
});
```

```ts
// packages/contracts/test/wire.test.ts
import { describe, expect, it } from 'vitest';
import { decodeClientMessage, decodeServerMessage, encodeMessage, type ClientMessage, type ServerMessage } from '../src/index.ts';

const clients: ClientMessage[] = [
  { type: 'subscribe', id: 's1', topic: 'car.detail', params: { carId: 3 } },
  { type: 'subscribe', id: 's2', topic: 'laps', params: {}, feedId: 'udp-20777' as never },
  { type: 'unsubscribe', id: 's1' },
  { type: 'command', id: 'c1', command: { kind: 'boxCall', tyre: 'soft' as never } },
  { type: 'heartbeat' },
];
const servers: ServerMessage[] = [
  { type: 'hello', contractVersion: 1, feeds: [{ feedId: 'udp-20777' as never, kind: 'udp', label: 'UDP 20777' }] },
  { type: 'snapshot', id: 's1', value: { sessionUid: '1896528710553860228' } },
  { type: 'snapshot', id: 's2', entries: [] },
  { type: 'update', id: 's1', value: 1 },
  { type: 'append', id: 's2', entries: [{ lapNumber: 1 }] },
  { type: 'topicStatus', id: 's1', status: 'noData' },
  { type: 'commandResult', id: 'c1', ok: false, reason: 'notSupported' },
  { type: 'heartbeat' },
  { type: 'error', reason: 'malformed' },
  { type: 'error', id: 's9', reason: 'unknownFeed' },
];

describe('wire format', () => {
  it.each(clients)('client round trip %o', (m) => { expect(decodeClientMessage(encodeMessage(m))).toEqual(m); });
  it.each(servers)('server round trip %o', (m) => { expect(decodeServerMessage(encodeMessage(m))).toEqual(m); });
  it.each([
    'not json', '42', 'null', '[]', '{}', '{"type":"dance"}',
    '{"type":"subscribe","topic":"laps","params":{}}',                  // missing id
    '{"type":"subscribe","id":"s","topic":"nope","params":{}}',         // unknown topic
    '{"type":"subscribe","id":"s","topic":"laps","params":null}',
    '{"type":"subscribe","id":"s","topic":"laps","params":[]}',
    '{"type":"subscribe","id":"s","topic":"laps","params":{},"feedId":7}',
    '{"type":"unsubscribe","id":5}',
    '{"type":"command","id":"c","command":{"kind":"retire"}}',
    '{"type":"command","id":"c","command":{"kind":"boxCall","tyre":"purple"}}',
    '{"type":"hello","contractVersion":1,"feeds":[]}',                   // server message is not a client message
  ])('rejects malformed client message %s', (s) => { expect(decodeClientMessage(s)).toBeUndefined(); });
  it('drops unknown extra fields', () => {
    expect(decodeClientMessage('{"type":"unsubscribe","id":"s1","x":1}')).toEqual({ type: 'unsubscribe', id: 's1' });
  });
  it.each(['nope', '{"type":"update"}', '{"type":"topicStatus","id":"s","status":"weird"}', '{"type":"hello","feeds":[]}'])(
    'rejects malformed server message %s', (s) => { expect(decodeServerMessage(s)).toBeUndefined(); });
  it('wire DTOs carry sessionUid as a decimal string', () => {
    expect(JSON.parse(encodeMessage(servers[1]!))).toEqual({ type: 'snapshot', id: 's1', value: { sessionUid: '1896528710553860228' } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/contracts` — Expected: FAIL (modules missing)

- [ ] **Step 3: Implement** (supervisor; must not edit test files)

- `version.ts`: `export const CONTRACT_VERSION = 1;`
- `topics.ts`: DTO types above; `def<P, V>(name, mode, maxHz): TopicDef<P, V>` returns `{ name, mode, maxHz }` (phantom `params?`/`value?` stay absent); `TOPICS` in the table order of the test with value types: `feed.status` → `FeedStatus`, `session.info` → `SessionInfo`, `cars.overview` → `CarOverview[]`, `car.detail` → `CarState` (params `{ carId: number }`), `car.telemetry` → `CarDynamics` (params `{ carId: number }`), `laps` → `LapRecord`, `stints` → `StintRecord`, `pitStops` → `PitStopRecord`, `flagPhases` → `FlagPhase`, `events` → `RaceEvent`, `insights` → `InsightEntry`. `TopicParams<T extends TopicName>` / `TopicValue<T>` read the phantom fields with `NonNullable<…>`.
- `messages.ts`: `ClientMessage`, `ServerMessage` per contract.
- `wire.ts`: the only module that touches JSON. `encodeMessage = JSON.stringify`. Decoders `JSON.parse` in `try`, then validate by `type` and rebuild the object from known fields only. Client rules: `id` non-empty string; `topic` an own key of `TOPICS`; `params` a non-null, non-array object; optional `feedId` string; `command.kind === 'boxCall'` and `tyre` in `Object.values(VisualCompound)`. Server rules: `type` known; `id` string where the variant has one (optional for `error`); `contractVersion` number and `feeds` array for `hello`; `status` in `ok|errored|noData`; `entries` array for `append`; `snapshot` has `value` or `entries` (array).
- `index.ts`: re-export everything.

- [ ] **Step 4: Run tests to verify they pass** — Run: `pnpm vitest run packages/contracts && pnpm depcruise` — Expected: PASS (contracts imports only `@pitwall/domain`)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -F - <<'EOF'
feat(contracts): topic definitions, websocket messages and json wire format

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 22: Job framework (worker thread, seeded RNG)

**Files:**
- Create: `apps/bridge/src/jobs/job-runner.ts`, `apps/bridge/src/jobs/worker-entry.ts`
- Test: `apps/bridge/test/jobs/job-runner.test.ts`, `apps/bridge/test/jobs/echo-job.ts` (test job module)

**Interfaces:**
- Consumes: `Cadence`, `EngineView`, `Rng`, `createRng` from `@pitwall/engine` (Task 19).
- Produces (contract): `Job<In, Out>`, `JobRunner` (`constructor({ seed })`, `trigger(job, view, computedFor)`, `onResult(cb)`, `close()`).
- Produces (new): `type JobResult = { jobId: string; computedFor: { lap: number; frameId: number }; value: unknown } | { jobId: string; computedFor: { lap: number; frameId: number }; error: string }` and `jobSeed(seed: number, jobId: string, computedFor: { lap: number; frameId: number }): number` (FNV-1a 32-bit over the UTF-8 string `` `${seed}:${jobId}:${lap}:${frameId}` ``, as unsigned int). `trigger` after `close()` throws `Error('JobRunner closed')`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/jobs/echo-job.ts — worker module used only by tests
import type { Rng } from '@pitwall/engine';
export async function run(input: { tag: string; sleepMs: number; fail?: boolean }, rng: Rng) {
  await new Promise((r) => setTimeout(r, input.sleepMs));
  if (input.fail) throw new Error(`boom ${input.tag}`);
  return { tag: input.tag, rolls: [rng.next(), rng.next(), rng.next()] };
}
```

```ts
// apps/bridge/test/jobs/job-runner.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRng, type EngineView } from '@pitwall/engine';
import { JobRunner, jobSeed, type Job, type JobResult } from '../../src/jobs/job-runner.ts';

type In = { tag: string; sleepMs: number; fail?: boolean };
const view = {} as EngineView;
const job = (input: In): Job<In, unknown> => ({ kind: 'job', id: 'echo', trigger: 'lapCompleted', prepare: () => input, module: new URL('./echo-job.ts', import.meta.url) });
const at = { lap: 3, frameId: 100 };
const runners: JobRunner[] = [];
const make = (seed: number) => { const r = new JobRunner({ seed }); runners.push(r); const got: JobResult[] = []; r.onResult((x) => got.push(x)); return { r, got }; };
afterEach(async () => { await Promise.all(runners.splice(0).map((r) => r.close())); });

describe('JobRunner', () => {
  it('jobSeed is FNV-1a over "seed:id:lap:frameId"', () => {
    expect(jobSeed(7, 'j', { lap: 3, frameId: 100 })).toBe(1521242744);
  });
  it('delivers the value computed in a worker with the seeded rng', async () => {
    const { r, got } = make(7);
    r.trigger(job({ tag: 'a', sleepMs: 1 }), view, at);
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 5000 });
    const rng = createRng(jobSeed(7, 'echo', at));
    expect(got[0]).toEqual({ jobId: 'echo', computedFor: at, value: { tag: 'a', rolls: [rng.next(), rng.next(), rng.next()] } });
  });
  it('same seed and trigger give the same result; another seed differs', async () => {
    const a = make(7), b = make(7), c = make(8);
    for (const x of [a, b, c]) x.r.trigger(job({ tag: 'd', sleepMs: 1 }), view, at);
    await vi.waitFor(() => expect([a.got, b.got, c.got].every((g) => g.length === 1)).toBe(true), { timeout: 5000 });
    expect(a.got[0]).toEqual(b.got[0]);
    expect(a.got[0]).not.toEqual(c.got[0]);
  });
  it('a newer trigger terminates the running worker; only the newer result arrives', async () => {
    const { r, got } = make(1);
    r.trigger(job({ tag: 'first', sleepMs: 400 }), view, { lap: 1, frameId: 1 });
    r.trigger(job({ tag: 'second', sleepMs: 1 }), view, { lap: 1, frameId: 2 });
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 5000 });
    await new Promise((res) => setTimeout(res, 600));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ computedFor: { lap: 1, frameId: 2 }, value: { tag: 'second' } });
  });
  it('a throwing job yields an error result', async () => {
    const { r, got } = make(1);
    r.trigger(job({ tag: 'x', sleepMs: 1, fail: true }), view, at);
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 5000 });
    expect(got[0]).toEqual({ jobId: 'echo', computedFor: at, error: 'boom x' });
  });
  it('close() terminates running workers quickly and suppresses their results', async () => {
    const { r, got } = make(1);
    r.trigger(job({ tag: 'slow', sleepMs: 5000 }), view, at);
    const t0 = Date.now();
    await r.close();
    expect(Date.now() - t0).toBeLessThan(1000);
    await new Promise((res) => setTimeout(res, 200));
    expect(got).toEqual([]);
    expect(() => r.trigger(job({ tag: 'late', sleepMs: 1 }), view, at)).toThrow('JobRunner closed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/bridge/test/jobs` — Expected: FAIL (module `job-runner.ts` missing)

- [ ] **Step 3: Implement `JobRunner` in `apps/bridge/src/jobs/job-runner.ts` and the worker in `worker-entry.ts`** (implementation agent; must not edit test files)

- `trigger`: `input = job.prepare(view)` on the main thread; terminate the running worker for `job.id` (if any, and forget it so its late messages are ignored); start `new Worker(new URL('./worker-entry.ts', import.meta.url), { workerData: { moduleHref: job.module.href, input, seed: jobSeed(this.seed, job.id, computedFor) } })`. Node type stripping runs the `.ts` worker and the job module (workspace packages resolve through their real path, outside `node_modules`).
- `worker-entry.ts`: `const mod = await import(moduleHref)`; `value = await mod.run(input, createRng(seed))`; `parentPort.postMessage({ ok: true, value })` or `{ ok: false, error: e instanceof Error ? e.message : String(e) }`.
- One `message` → one `JobResult` to every `onResult` callback, then the worker is dropped. A worker `error`/non-zero `exit` without a message → error result with the error message (except after terminate). `close()` terminates all workers and awaits them.
- No productive job is registered in this sub-project; the trigger cadence (`job.trigger`) is evaluated by the pipeline once a job exists (not wired in Task 27).

- [ ] **Step 4: Run tests to verify they pass** — Run: `pnpm vitest run apps/bridge/test/jobs` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/jobs apps/bridge/test/jobs
git commit -F - <<'EOF'
feat(bridge): job runner with worker threads, replacement and seeded rng

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 23: Base topic features

**Files:**
- Create: `apps/bridge/src/features/feed-status/register.ts`, `apps/bridge/src/features/feed-status/feed-status.ts`, `apps/bridge/src/features/session-info/register.ts`, `apps/bridge/src/features/cars-overview/register.ts`, `apps/bridge/src/features/car-detail/register.ts`, `apps/bridge/src/features/car-telemetry/register.ts`, `apps/bridge/src/features/history/register.ts`, `apps/bridge/src/features/insights/register.ts`
- Test: `apps/bridge/test/helpers/view.ts`, `apps/bridge/test/features/feed-status.test.ts`, `apps/bridge/test/features/state-features.test.ts`, `apps/bridge/test/features/registry.test.ts`

**Interfaces:**
- Consumes: `defineFeature`, `Feature`, `TopicBinding`, `FEATURES` (Task 20); `QuickCalculator`, `FeedMetricsView`, `EngineView`, `CalculatorRegistry`, `SessionRunner` (Tasks 17, 19); `TOPICS`, `FeedStatus`, `SessionInfo`, `CarOverview` (Task 21); `ScenarioBuilder` (Task 12).
- Produces (calculator ids, all `kind: 'quick'`): `feed.status` (reads `['feed']`, cadence `'frame'`), `session.info` (reads `['session', 'participants']`, `'sessionChange'`), `cars.overview` (reads `['timing', 'participants', 'status', 'stints']`, `{ hz: 10 }`), `cars.state` (reads every `ChangeTag` of a car: `participants, timing, motion, telemetry, status, damage, setups, tyreSets, motionEx`, `'frame'`), `cars.dynamics` (reads `['motion', 'telemetry']`, `'frame'`). `cars.state`/`cars.dynamics` output `state.cars` by reference; the bindings' `select` clones the selected car (`structuredClone`) and returns `undefined` for an unknown/missing `carId`.
- Produces (new, `features/feed-status/feed-status.ts`): `FEED_STALE_MS = 2000`, `FEED_LOSS_PERCENT = 5`, `FEED_WINDOW_MS = 10_000`, `feedStatusOf(feedId: FeedId, feed: FeedMetricsView): FeedStatus`, `feedInsights(feedId: FeedId, feed: FeedMetricsView, at: SessionTime): Insight[]` (used by the pipeline's feed-level `InsightBook`, Task 27 — feed insights must work before any session opens, so they are not calculator insights).
- Produces (test helper): `viewFrom(frames: readonly Frame[], feed?: Partial<FeedMetricsView>): EngineView` in `apps/bridge/test/helpers/view.ts` (runs a `SessionRunner` over `frames`, init from the first frame carrying `session`; returns the view of the last `StepResult` with `outputs: new Map()`; feed defaults: all counters 0, `connected: true`, `msSinceLastPacket: 0`, `lossPercent: 0`, `packetsPerSecond: 60`).

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/features/feed-status.test.ts
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { FEED_LOSS_PERCENT, FEED_STALE_MS, FEED_WINDOW_MS, feedInsights } from '../../src/features/feed-status/feed-status.ts';
import feedStatus from '../../src/features/feed-status/register.ts';
import { ScenarioBuilder } from '../../../../packages/engine/test/builders/index.ts';
import { viewFrom } from '../helpers/view.ts';

const f = 'udp-20777' as FeedId;
const frames = new ScenarioBuilder({ cars: 2 }).session().participants().frames(3, () => {}).build();
const feed = (o: object) => viewFrom(frames, o).feed;

describe('feed insights', () => {
  it('pins the thresholds', () => { expect([FEED_STALE_MS, FEED_LOSS_PERCENT, FEED_WINDOW_MS]).toEqual([2000, 5, 10_000]); });
  it('feed.stale: advisory from 2000 ms without packets', () => {
    expect(feedInsights(f, feed({ msSinceLastPacket: 1999 }), 0)).toEqual([]);
    expect(feedInsights(f, feed({ msSinceLastPacket: 2000 }), 42)).toEqual([
      { key: 'feed.stale', severity: 'advisory', category: 'feed', feedId: f, kind: 'feed.stale', params: { msSinceLastPacket: 2000 }, raisedAt: 42 }]);
  });
  it('feed.packetLoss: advisory above 5 % incomplete frames', () => {
    expect(feedInsights(f, feed({ lossPercent: 5 }), 0)).toEqual([]);
    expect(feedInsights(f, feed({ lossPercent: 5.01 }), 7)).toEqual([
      { key: 'feed.packetLoss', severity: 'advisory', category: 'feed', feedId: f, kind: 'feed.packetLoss', params: { lossPercent: 5.01 }, raisedAt: 7 }]);
  });
  it('feed.wrongFormat: critical with the received format', () => {
    expect(feedInsights(f, feed({ wrongFormat: 2024 }), 0)).toEqual([
      { key: 'feed.wrongFormat', severity: 'critical', category: 'feed', feedId: f, kind: 'feed.wrongFormat', params: { format: 2024 }, raisedAt: 0 }]);
  });
  it('orders stale, packetLoss, wrongFormat', () => {
    expect(feedInsights(f, feed({ msSinceLastPacket: 3000, lossPercent: 50, wrongFormat: 2023 }), 0).map((i) => i.key))
      .toEqual(['feed.stale', 'feed.packetLoss', 'feed.wrongFormat']);
  });
  it('feed.status topic value', () => {
    const calc = feedStatus.calculators.find((c) => c.id === 'feed.status') as QuickCalculator<unknown>;
    const v = viewFrom(frames, { msSinceLastPacket: 2500, lossPercent: 1.5, latePackets: 3, packetsPerSecond: 58 });
    expect(calc.compute(v)).toEqual({ feedId: v.state.feedId, connected: true, stale: true, lossPercent: 1.5, latePackets: 3, decodeErrors: 0, packetsPerSecond: 58 });
    expect(feedStatus.topics).toEqual([{ topic: 'feed.status', from: 'feed.status' }]);
  });
});
```

```ts
// apps/bridge/test/features/state-features.test.ts
import { describe, expect, it } from 'vitest';
import type { QuickCalculator } from '@pitwall/engine';
import type { Feature, TopicBinding } from '../../src/features/feature.ts';
import sessionInfo from '../../src/features/session-info/register.ts';
import carsOverview from '../../src/features/cars-overview/register.ts';
import carDetail from '../../src/features/car-detail/register.ts';
import carTelemetry from '../../src/features/car-telemetry/register.ts';
import history from '../../src/features/history/register.ts';
import insights from '../../src/features/insights/register.ts';
import { ScenarioBuilder } from '../../../../packages/engine/test/builders/index.ts';
import { viewFrom } from '../helpers/view.ts';

const view = viewFrom(new ScenarioBuilder({ sessionUid: 1896528710553860228n, cars: 3, player: 2 }).session().participants().frames(3, () => {}).build());
const out = (f: Feature, id: string) => (f.calculators.find((c) => c.id === id) as QuickCalculator<unknown>).compute(view);
const select = (f: Feature, topic: string, params: object) => {
  const b = f.topics.find((t) => t.topic === topic) as Extract<TopicBinding, { from: string }>;
  return b.select ? b.select(out(f, b.from), params) : out(f, b.from);
};

describe('base state features', () => {
  it('session.info carries the decimal sessionUid and is JSON-safe', () => {
    const info = out(sessionInfo, 'session.info') as Record<string, unknown>;
    expect(info).toMatchObject({ feedId: view.state.feedId, sessionUid: '1896528710553860228', playerCar: 2 });
    expect(info['session']).toEqual(view.state.session);
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });
  it('cars.overview: one entry per car, picked fields, cloned', () => {
    const list = out(carsOverview, 'cars.overview') as Array<Record<string, unknown>>;
    expect(list).toHaveLength(view.state.cars.length);
    const car = view.state.cars[1]!;
    expect(list[1]).toEqual({ id: car.id, identity: car.identity, timing: car.timing,
      tyres: { actualCompound: car.tyres.actualCompound, visualCompound: car.tyres.visualCompound, age: car.tyres.age } });
    expect(list[1]!['timing']).not.toBe(car.timing);
  });
  it('car.detail selects one car by carId', () => {
    expect(select(carDetail, 'car.detail', { carId: 1 })).toEqual(view.state.cars[1]);
    expect(select(carDetail, 'car.detail', { carId: 1 })).not.toBe(view.state.cars[1]);
    expect(select(carDetail, 'car.detail', { carId: 99 })).toBeUndefined();
    expect(select(carDetail, 'car.detail', {})).toBeUndefined();
  });
  it('car.telemetry selects the dynamics of one car', () => {
    expect(select(carTelemetry, 'car.telemetry', { carId: 2 })).toEqual(view.state.cars[2]!.dynamics);
    expect(select(carTelemetry, 'car.telemetry', { carId: 99 })).toBeUndefined();
  });
  it('history and insights bindings', () => {
    expect(history.calculators).toEqual([]);
    expect(history.topics).toEqual(['laps', 'stints', 'pitStops', 'flagPhases', 'events'].map((k) => ({ topic: k, fromHistory: k })));
    expect(insights.topics).toEqual([{ topic: 'insights', fromInsights: true }]);
  });
});
```

```ts
// apps/bridge/test/features/registry.test.ts
import { describe, expect, it } from 'vitest';
import { TOPICS } from '@pitwall/contracts';
import { CalculatorRegistry } from '@pitwall/engine';
import { FEATURES } from '../../src/features/index.generated.ts';

describe('generated feature set', () => {
  const bindings = FEATURES.flatMap((f) => f.topics);
  it('contains the seven base features in folder order', () => {
    expect(FEATURES.map((f) => f.name)).toEqual(['car-detail', 'car-telemetry', 'cars-overview', 'feed-status', 'history', 'insights', 'session-info']);
  });
  it('calculators form a valid registry and every binding resolves', () => {
    const reg = CalculatorRegistry.build(FEATURES.flatMap((f) => f.calculators));
    for (const b of bindings) if ('from' in b) expect(reg.get(b.from), b.topic).toBeDefined();
  });
  it('binds every topic exactly once', () => {
    expect(bindings.map((b) => b.topic).sort()).toEqual(Object.keys(TOPICS).sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm gen:features && pnpm vitest run apps/bridge/test/features` — Expected: FAIL (feature modules missing)

- [ ] **Step 3: Implement the seven `register.ts` files and `feed-status.ts`** (implementation agent; must not edit test files)

Each `register.ts` is `export default defineFeature({ name: <folder name>, calculators, topics })`. `feedStatusOf`: `stale = msSinceLastPacket >= FEED_STALE_MS`; copies `connected, lossPercent, latePackets, decodeErrors, packetsPerSecond`, and `latencyMs`/`wrongFormat` only when defined (`exactOptionalPropertyTypes`). `feedInsights`: stale (`>= 2000`, params `{ msSinceLastPacket }`), packetLoss (`> 5`, params `{ lossPercent }`), wrongFormat (defined, critical, params `{ format }`), category `feed`, key = kind. `session.info`: `{ feedId, sessionUid: state.sessionUid, playerCar, teammateCar? , session: structuredClone(state.session) }`. `cars.overview`: `structuredClone` of the picked fields per car, in `state.cars` order.

- [ ] **Step 4: Run tests to verify they pass** — Run: `pnpm gen:features && pnpm vitest run apps/bridge/test/features` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/features apps/bridge/test/features apps/bridge/test/helpers/view.ts
git commit -F - <<'EOF'
feat(bridge): base topic features and feed insights

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 24: `TopicHub` (throttle, backpressure, snapshots)

**Files:**
- Create: `apps/bridge/src/hub/topic-hub.ts`, `apps/bridge/src/hub/throttle.ts`
- Test: `apps/bridge/test/hub/topic-hub.test.ts`

**Interfaces:**
- Consumes: `TOPICS`, `TopicName`, `ServerMessage` (Task 21); `FeedId` (`@pitwall/domain`).
- Produces (contract): `Subscription`, `ClientSink`, `TopicHub` (`addClient`, `removeClient`, `subscribe`, `unsubscribe`, `publishState`, `publishAppend`, `setStatus`, `tick`).
- Produces (new, on `TopicHub`): `resetFeed(feedId: FeedId): void` (new session: drop the feed's state values, append logs and statuses; every subscriber of that feed gets a fresh snapshot — append: `entries: []`, state: `topicStatus noData`) and `resetAppend(feedId: FeedId, topic: TopicName, entries: unknown[]): void` (flashback truncation: replace the log, send a fresh snapshot to its subscribers). `throttle.ts`: `intervalMs(maxHz: number): number` (`1000 / maxHz`, `0` for `Infinity`).
- Semantics pinned here: `publishState`'s `valueFor(params)` returning `undefined` means "no data for these params" → `topicStatus noData` (sent once until a value arrives). Before an `update` follows a non-`ok` status sent to that subscription, `topicStatus ok` is sent. The throttle interval counts from the last message that carried a value (`snapshot`/`update`).

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/hub/topic-hub.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { ServerMessage } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';

const A = 'feedA' as FeedId, B = 'feedB' as FeedId;
class FakeSink { sent: ServerMessage[] = []; buffered = 0; send(m: ServerMessage) { this.sent.push(m); } bufferedAmount() { return this.buffered; } take() { return this.sent.splice(0); } }
let t: number, hub: TopicHub, sink: FakeSink;
beforeEach(() => { t = 0; hub = new TopicHub({ now: () => t, backpressureBytes: 100 }); sink = new FakeSink(); hub.addClient('c1', sink); });
const sub = (id: string, topic: Parameters<TopicHub['subscribe']>[0]['topic'], params: object = {}, feedId = A) => hub.subscribe({ clientId: 'c1', id, topic, params, feedId });

describe('TopicHub', () => {
  it('state snapshot on subscribe: latest value, else noData', () => {
    sub('s0', 'session.info');
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 's0', status: 'noData' }]);
    hub.publishState(A, 'session.info', () => ({ v: 1 }));
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 's0', status: 'ok' }, { type: 'update', id: 's0', value: { v: 1 } }]);
    sub('s1', 'session.info');
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 's1', value: { v: 1 } }]);
  });
  it('append snapshot contains all entries so far, then appends', () => {
    hub.publishAppend(A, 'laps', [{ n: 1 }]); hub.publishAppend(A, 'laps', [{ n: 2 }]);
    sub('l', 'laps');
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: [{ n: 1 }, { n: 2 }] }]);
    hub.publishAppend(A, 'laps', [{ n: 3 }]);
    expect(sink.take()).toEqual([{ type: 'append', id: 'l', entries: [{ n: 3 }] }]);
  });
  it('throttles state updates to maxHz (session.info 2 Hz = 500 ms), latest wins, tick flushes', () => {
    hub.publishState(A, 'session.info', () => 0); sub('s', 'session.info'); sink.take();
    t = 100; hub.publishState(A, 'session.info', () => 1);
    t = 200; hub.publishState(A, 'session.info', () => 2);
    t = 499; hub.tick();
    expect(sink.take()).toEqual([]);
    t = 500; hub.tick();
    expect(sink.take()).toEqual([{ type: 'update', id: 's', value: 2 }]);
    t = 600; hub.publishState(A, 'session.info', () => 3); hub.tick();
    expect(sink.take()).toEqual([]);
    t = 1000; hub.publishState(A, 'session.info', () => 4);
    expect(sink.take()).toEqual([{ type: 'update', id: 's', value: 4 }]);
    t = 2000; hub.tick();
    expect(sink.take()).toEqual([]);
  });
  it('evaluates valueFor per subscription params; undefined → noData', () => {
    sub('d1', 'car.detail', { carId: 1 }); sub('d9', 'car.detail', { carId: 9 }); sink.take();
    hub.publishState(A, 'car.detail', (p) => ((p as { carId: number }).carId < 5 ? { id: (p as { carId: number }).carId } : undefined));
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 'd1', status: 'ok' }, { type: 'update', id: 'd1', value: { id: 1 } }]);
  });
  it('backpressure: state coalesces to the newest value', () => {
    hub.publishState(A, 'session.info', () => 0); sub('s', 'session.info'); sink.take();
    sink.buffered = 101;
    t = 600; hub.publishState(A, 'session.info', () => 1);
    t = 1200; hub.publishState(A, 'session.info', () => 2); hub.tick();
    expect(sink.take()).toEqual([]);
    sink.buffered = 0; hub.tick();
    expect(sink.take()).toEqual([{ type: 'update', id: 's', value: 2 }]);
  });
  it('backpressure: append overflow becomes a fresh snapshot, never dropped entries', () => {
    hub.publishAppend(A, 'laps', ['a']); sub('l', 'laps'); sink.take();
    sink.buffered = 101;
    hub.publishAppend(A, 'laps', ['b']); hub.publishAppend(A, 'laps', ['c']); hub.tick();
    expect(sink.take()).toEqual([]);
    sink.buffered = 0; hub.tick();
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: ['a', 'b', 'c'] }]);
    hub.publishAppend(A, 'laps', ['d']);
    expect(sink.take()).toEqual([{ type: 'append', id: 'l', entries: ['d'] }]);
  });
  it('forwards status changes once; subscribe sees the current status', () => {
    hub.publishState(A, 'cars.overview', () => []); sub('o', 'cars.overview'); sink.take();
    hub.setStatus(A, 'cars.overview', 'errored'); hub.setStatus(A, 'cars.overview', 'errored');
    expect(sink.take()).toEqual([{ type: 'topicStatus', id: 'o', status: 'errored' }]);
    sub('o2', 'cars.overview');
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'o2', value: [] }, { type: 'topicStatus', id: 'o2', status: 'errored' }]);
  });
  it('isolates feeds', () => {
    sub('a', 'laps', {}, A); sub('b', 'laps', {}, B); sink.take();
    hub.publishAppend(B, 'laps', ['x']);
    expect(sink.take()).toEqual([{ type: 'append', id: 'b', entries: ['x'] }]);
  });
  it('unsubscribe and removeClient stop delivery', () => {
    sub('l', 'laps'); sub('m', 'events'); sink.take();
    hub.unsubscribe('c1', 'l'); hub.publishAppend(A, 'laps', [1]);
    expect(sink.take()).toEqual([]);
    hub.removeClient('c1'); hub.publishAppend(A, 'events', [1]);
    expect(sink.take()).toEqual([]);
  });
  it('resetFeed and resetAppend send fresh snapshots', () => {
    hub.publishAppend(A, 'laps', [1, 2]); hub.publishState(A, 'session.info', () => 'old');
    sub('l', 'laps'); sub('s', 'session.info'); sink.take();
    hub.resetAppend(A, 'laps', [1]);
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: [1] }]);
    hub.resetFeed(A);
    expect(sink.take()).toEqual([{ type: 'snapshot', id: 'l', entries: [] }, { type: 'topicStatus', id: 's', status: 'noData' }]);
  });
  it('defaults backpressureBytes to 1_000_000', () => {
    const h = new TopicHub({ now: () => 0 }); const s = new FakeSink(); h.addClient('x', s);
    h.subscribe({ clientId: 'x', id: 'l', topic: 'laps', params: {}, feedId: A }); s.take();
    s.buffered = 1_000_000; h.publishAppend(A, 'laps', [1]);
    expect(s.take()).toEqual([{ type: 'append', id: 'l', entries: [1] }]);
    s.buffered = 1_000_001; h.publishAppend(A, 'laps', [2]);
    expect(s.take()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/bridge/test/hub` — Expected: FAIL (module missing)

- [ ] **Step 3: Implement `TopicHub` in `apps/bridge/src/hub/topic-hub.ts`** (implementation agent; must not edit test files)

Per `(feedId, topic)` keep `latest?: (params) => unknown`, `log: unknown[]` (append topics), `status` (default `ok`). Per subscription keep `lastSentAt?`, `pending: boolean`, `needsSnapshot: boolean`, `lastStatus`. Backpressured = `sink.bufferedAmount() > backpressureBytes`. Messages to one subscription are emitted in the order snapshot → status. `publishState` tries each matching subscription immediately (interval elapsed and not backpressured), else marks it pending; `tick()` retries pending state subscriptions and owed append snapshots. `setStatus` to `errored` clears pending; `subscribe` with an existing `(clientId, id)` replaces it. Iterate clients in `addClient` order and subscriptions in `subscribe` order so output is deterministic.

- [ ] **Step 4: Run tests to verify they pass** — Run: `pnpm vitest run apps/bridge/test/hub` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/hub apps/bridge/test/hub
git commit -F - <<'EOF'
feat(bridge): topic hub with snapshots, throttling and backpressure

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 25: WebSocket server and client

**Files:**
- Create: `apps/bridge/src/ws/server.ts`, `apps/bridge/src/ws/client.ts`
- Test: `apps/bridge/test/ws/ws.test.ts`

**Interfaces:**
- Consumes: `TopicHub`, `ClientSink` (Task 24); `CONTRACT_VERSION`, `encodeMessage`, `decodeClientMessage`, `decodeServerMessage`, `ServerMessage`, `FeedInfo`, `TopicName` (Task 21); `StartupError` (Task 26, `apps/bridge/src/startup-error.ts`); `ws` package.
- Produces (contract): `WsServer.start(opts)`, `port`, `close()`; `WsClient.connect(url, opts?)`, `subscribe`, `unsubscribe`, `close`, `onHello`.
- Produces (new options/signatures): `WsServer.start` opts gain `tickMs?: number /* 10, interval calling hub.tick() */` and `host?: string /* '127.0.0.1' */`; `WsClient.connect(url, opts?: { reconnectMs?: number /* 1000 */; heartbeatMs?: number /* 5000 */ })`; `WsClient.subscribe(topic: TopicName, params: object, onMessage: (m: ServerMessage) => void, feedId?: FeedId): string` (ids `sub-1`, `sub-2`, … stay the same across reconnects); `onHello(cb: (m: Extract<ServerMessage, { type: 'hello' }>) => void)`. Server rejection reasons: `'malformed'`, `'unknownFeed'`. Port busy → `start` rejects with `StartupError('WebSocket port <port> is already in use')`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/ws/ws.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { FeedId } from '@pitwall/domain';
import type { FeedInfo, ServerMessage } from '@pitwall/contracts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { WsServer } from '../../src/ws/server.ts';
import { WsClient } from '../../src/ws/client.ts';

const F = 'f1' as FeedId;
const feeds = (): FeedInfo[] => [{ feedId: F, kind: 'replay', label: 'test' }];
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });
const server = async (hub: TopicHub, o: Partial<Parameters<typeof WsServer.start>[0]> = {}) => {
  const s = await WsServer.start({ port: 0, hub, feeds, ...o }); cleanup.push(() => s.close()); return s;
};
const client = (port: number, o = {}) => { const c = WsClient.connect(`ws://127.0.0.1:${port}`, o); cleanup.push(() => c.close()); return c; };
const raw = async (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`); const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)))); await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate()); return { ws, got };
};
const newHub = () => new TopicHub({ now: () => performance.now() });

describe('WsServer / WsClient', () => {
  it('sends hello with the contract version and feeds on connect', async () => {
    const s = await server(newHub()); const hellos: unknown[] = [];
    client(s.port).onHello((m) => hellos.push(m));
    await vi.waitFor(() => expect(hellos).toEqual([{ type: 'hello', contractVersion: 1, feeds: feeds() }]));
  });
  it('routes subscribe/unsubscribe to the hub (default feed = first feed)', async () => {
    const hub = newHub(); hub.publishAppend(F, 'laps', [{ n: 1 }]);
    const s = await server(hub); const c = client(s.port); const got: ServerMessage[] = [];
    const id = c.subscribe('laps', {}, (m) => got.push(m));
    await vi.waitFor(() => expect(got).toEqual([{ type: 'snapshot', id, entries: [{ n: 1 }] }]));
    hub.publishAppend(F, 'laps', [{ n: 2 }]);
    await vi.waitFor(() => expect(got).toHaveLength(2));
    expect(got[1]).toEqual({ type: 'append', id, entries: [{ n: 2 }] });
    c.unsubscribe(id); await new Promise((r) => setTimeout(r, 50));
    hub.publishAppend(F, 'laps', [{ n: 3 }]); await new Promise((r) => setTimeout(r, 50));
    expect(got).toHaveLength(2);
  });
  it('answers command with notSupported, malformed input and unknown feeds with error', async () => {
    const s = await server(newHub()); const { ws, got } = await raw(s.port);
    ws.send(JSON.stringify({ type: 'command', id: 'c1', command: { kind: 'boxCall', tyre: 'soft' } }));
    ws.send('{"type":"subscribe"');
    ws.send(JSON.stringify({ type: 'subscribe', id: 's1', topic: 'laps', params: {}, feedId: 'nope' }));
    await vi.waitFor(() => expect(got.slice(1)).toEqual([
      { type: 'commandResult', id: 'c1', ok: false, reason: 'notSupported' },
      { type: 'error', reason: 'malformed' },
      { type: 'error', id: 's1', reason: 'unknownFeed' },
    ]));
  });
  it('sends heartbeats and drops a silent client; a heartbeating client stays', async () => {
    const hub = newHub(); const s = await server(hub, { heartbeatMs: 50, timeoutMs: 200 });
    const { ws, got } = await raw(s.port); const closed = new Promise((r) => ws.once('close', r));
    const c = client(s.port, { heartbeatMs: 50 }); const live: ServerMessage[] = [];
    c.subscribe('events', {}, (m) => live.push(m));
    await closed;
    expect(got.some((m) => m.type === 'heartbeat')).toBe(true);
    hub.publishAppend(F, 'events', ['e']);
    await vi.waitFor(() => expect(live.at(-1)).toMatchObject({ type: 'append', entries: ['e'] }));
  });
  it('client resubscribes after the server restarts on the same port', async () => {
    const hub = newHub(); hub.publishAppend(F, 'laps', ['a']);
    const s1 = await WsServer.start({ port: 0, hub, feeds }); const port = s1.port;
    const c = client(port, { reconnectMs: 50 }); let hellos = 0; c.onHello(() => { hellos++; });
    const got: ServerMessage[] = []; const id = c.subscribe('laps', {}, (m) => got.push(m));
    await vi.waitFor(() => expect(got).toHaveLength(1));
    await s1.close();
    await server(hub, { port });
    await vi.waitFor(() => expect(got).toEqual([{ type: 'snapshot', id, entries: ['a'] }, { type: 'snapshot', id, entries: ['a'] }]), { timeout: 3000 });
    expect(hellos).toBe(2);
    hub.publishAppend(F, 'laps', ['b']);
    await vi.waitFor(() => expect(got).toHaveLength(3));
    await new Promise((r) => setTimeout(r, 50));
    expect(got).toHaveLength(3);
  });
  it('rejects a busy port with a clear startup error', async () => {
    const s = await server(newHub());
    await expect(WsServer.start({ port: s.port, hub: newHub(), feeds })).rejects.toThrow(`WebSocket port ${s.port} is already in use`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/bridge/test/ws` — Expected: FAIL (modules missing)

- [ ] **Step 3: Implement `WsServer` and `WsClient`** (implementation agent; must not edit test files)

- Server: `new WebSocketServer({ port, host })`, resolve on `listening`, reject on `error` (`EADDRINUSE` → the `StartupError` above; other errors → `StartupError` with the system message). Per connection: `clientId = 'c' + counter`; `hub.addClient(clientId, { send: (m) => ws.send(encodeMessage(m)), bufferedAmount: () => ws.bufferedAmount })`; send `hello` with `CONTRACT_VERSION` and `feeds()`. Every received message refreshes `lastSeen`. `subscribe` → feed = `msg.feedId ?? feeds()[0]?.feedId`, unknown/absent → `error { id, reason: 'unknownFeed' }`, else `hub.subscribe`. `unsubscribe` → `hub.unsubscribe`. `command` → `commandResult notSupported`. `decodeClientMessage` → `undefined` → `error { reason: 'malformed' }`. Every `heartbeatMs` send `heartbeat` to all clients and `terminate()` those silent for more than `timeoutMs`. `close` → `hub.removeClient`. `close()`: clear timers, terminate clients, close the server.
- Client: keeps the active subscriptions in a `Map` and re-sends all of them after each `open`; reconnects `reconnectMs` after a `close` unless `close()` was called; sends `heartbeat` every `heartbeatMs` while open; routes messages with an `id` to that subscription's callback, `hello` to `onHello` callbacks; ignores messages `decodeServerMessage` rejects.

- [ ] **Step 4: Run tests to verify they pass** — Run: `pnpm vitest run apps/bridge/test/ws` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/ws apps/bridge/test/ws
git commit -F - <<'EOF'
feat(bridge): websocket server and reconnecting client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 26: Storage: SQLite, `StorageWriter`, `WeekendRepository`

**Files:**
- Create: `apps/bridge/src/storage/db.ts` (`SCHEMA_VERSION`, DDL, `openDatabase`, `Db`, `SessionRow`, `SchemaVersionError`), `apps/bridge/src/storage/storage-writer.ts`, `apps/bridge/src/storage/weekend-repository.ts`, `apps/bridge/src/storage/data-dir.ts`, `apps/bridge/src/startup-error.ts`
- Test: `apps/bridge/test/storage/records.ts` (test support), `apps/bridge/test/storage/db.test.ts`, `apps/bridge/test/storage/storage-writer.test.ts`, `apps/bridge/test/storage/weekend-repository.test.ts`, `apps/bridge/test/storage/data-dir.test.ts`

**Interfaces:**
- Consumes: `LapRecord`, `StintRecord`, `PitStopRecord`, `FlagPhase`, `RaceEvent`, `DriverKey`, `driverKeyString`, `SessionUid`, `CarId`, `known`, `ActualCompound`, `VisualCompound` (`@pitwall/domain`, Task 9); `History`, `HistoryLengths`, `HistoryDelta`, `WeekendContext`, `DeepReadonly` (`@pitwall/engine`, Tasks 9, 15). Dependency: `better-sqlite3` (ADR: `node:sqlite` is still experimental on Node 22.22) — supervisor adds it and `@types/better-sqlite3` to `apps/bridge/package.json`.
- Produces (verbatim): `SCHEMA_VERSION = 1`, `openDatabase(path)`, `StorageWriter`, `WeekendRepository`, `dataDir(env)`.
- Produces (new):
  ```ts
  type Db = import('better-sqlite3').Database;
  class SchemaVersionError extends Error { readonly found: number; readonly expected: number }   // message: 'database schema version <found>, expected <expected>'
  class StartupError extends Error {}                                                            // apps/bridge/src/startup-error.ts; CLI prints it and exits 1
  type SessionRow = { sessionUid: SessionUid; weekendId: string /* decimal weekendLinkIdentifier */; seasonId: string /* decimal seasonLinkIdentifier */;
    sessionType: number; trackId: number; startedAt: string /* ISO 8601 */; pwrecPath: string | null; settings: Record<string, number>;
    drivers: ReadonlyArray<{ carId: CarId; driverKey: DriverKey }> };
  ```
- Produces (extends contract): `weekendContext(weekendId, driverKey, opts?: { before?: SessionUid })` — with `before`, only sessions whose `started_at` is earlier than that session's (the pipeline upserts the current session first and passes its uid). `lapsOf`/`stintsOf`/`pitStopsOf(sessionUid, driverKey?)`, `flagPhasesOf(sessionUid)`, `eventsOf(sessionUid)` return records in write order.

**DDL** (exact; `openDatabase` runs it in one transaction on a fresh database, then `PRAGMA user_version = 1`):

```sql
CREATE TABLE weekends (weekend_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, track_id INTEGER NOT NULL) STRICT;
CREATE TABLE sessions (
  session_uid TEXT PRIMARY KEY, weekend_id TEXT NOT NULL REFERENCES weekends(weekend_id),
  session_type INTEGER NOT NULL, track_id INTEGER NOT NULL, started_at TEXT NOT NULL,
  pwrec_path TEXT, settings TEXT NOT NULL /* JSON */) STRICT;
CREATE INDEX sessions_by_weekend ON sessions (weekend_id, started_at);
CREATE TABLE drivers (
  session_uid TEXT NOT NULL REFERENCES sessions(session_uid), car_id INTEGER NOT NULL,
  driver_key TEXT NOT NULL /* driverKeyString */, key_json TEXT NOT NULL, PRIMARY KEY (session_uid, car_id)) STRICT;
CREATE INDEX drivers_by_key ON drivers (driver_key);
CREATE TABLE laps (
  session_uid TEXT NOT NULL REFERENCES sessions(session_uid), car_id INTEGER NOT NULL, lap_number INTEGER NOT NULL,
  lap_time_ms INTEGER NOT NULL, record TEXT NOT NULL /* JSON LapRecord */, PRIMARY KEY (session_uid, car_id, lap_number)) STRICT;
CREATE TABLE stints (session_uid TEXT NOT NULL REFERENCES sessions(session_uid), seq INTEGER NOT NULL /* index in History.stints */,
  car_id INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY (session_uid, seq)) STRICT;
CREATE TABLE pit_stops (session_uid TEXT NOT NULL REFERENCES sessions(session_uid), seq INTEGER NOT NULL,
  car_id INTEGER NOT NULL, record TEXT NOT NULL, PRIMARY KEY (session_uid, seq)) STRICT;
CREATE TABLE flag_phases (session_uid TEXT NOT NULL REFERENCES sessions(session_uid), seq INTEGER NOT NULL,
  record TEXT NOT NULL, PRIMARY KEY (session_uid, seq)) STRICT;
CREATE TABLE events (session_uid TEXT NOT NULL REFERENCES sessions(session_uid), seq INTEGER NOT NULL,
  car_id INTEGER, record TEXT NOT NULL, PRIMARY KEY (session_uid, seq)) STRICT;
```

Rules: `openDatabase` sets `foreign_keys = ON` (and `journal_mode = WAL` for files); `user_version = 0` with no tables → create; any other `user_version ≠ 1` (or version 0 with foreign tables) → `SchemaVersionError`. `upsertSession` (one transaction): insert weekend if missing, upsert session by uid, replace its drivers. `writeConfirmed`: per list `k`, entries `[before[k], after[k])` — laps filtered to `status === 'confirmed'` and upserted by key (last wins), others upserted by `seq` = history index; if `delta.truncated`, delete the session's rows from the five history tables and write `[0, after[k])`; no new entries → no transaction. Every `StorageWriter` method catches, calls `onError(e)` and returns (never throws). `dataDir`: root `env.PITWALL_DATA_DIR` else `<env.HOME ?? os.homedir()>/.local/share/pitwall`; `recordings`, `dumps` subdirs, `dbPath = <root>/pitwall.db`; creates all, checks `W_OK`; any failure → `StartupError('data directory <root> is not writable: <reason>')`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/storage/records.ts
import { ActualCompound, VisualCompound, known, type CarId, type DriverKey, type FlagPhase, type LapRecord, type RaceEvent, type SessionUid, type StintRecord } from '@pitwall/domain';
import type { History, HistoryDelta, HistoryLengths } from '@pitwall/engine';
import type { SessionRow } from '../../src/storage/db.ts';
export const car = (n: number) => n as CarId;
export const lap = (c: number, n: number, o: Partial<LapRecord> = {}): LapRecord => ({ carId: car(c), lapNumber: n, lapTimeMs: 90_000,
  sectorTimesMs: [30_000, 30_000, 30_000], valid: { lap: true, sectors: [true, true, true] }, actualCompound: ActualCompound.C3,
  visualCompound: VisualCompound.medium, tyreAgeAtStart: n - 1, fuelAtStartKg: known(10, 0), fuelAtEndKg: known(9, 90_000), scShare: 0,
  vscShare: 0, inLap: false, outLap: false, positionAtEnd: 1, status: 'confirmed', completedAt: n * 90_000, ...o });
export const stint = (c: number, firstLap: number): StintRecord => ({ carId: car(c), firstLap, lastLap: firstLap + 9,
  actualCompound: ActualCompound.C3, visualCompound: VisualCompound.medium, tyreAgeAtFitting: 0 });
export const event = (at: number, c?: number): RaceEvent => ({ at, kind: 'overtake', ...(c === undefined ? {} : { carId: car(c) }), params: {} });
export const sc = (start: number): FlagPhase => ({ kind: 'SC', start, end: start + 60_000, startLeaderLap: 3, endLeaderLap: 5, scPhases: [] });
export const history = (o: Partial<History> = {}): History => ({ laps: [], stints: [], pitStops: [], flagPhases: [], events: [], miniSectors: [], ...o });
const lengths = (h: History): HistoryLengths => ({ laps: h.laps.length, stints: h.stints.length, pitStops: h.pitStops.length,
  flagPhases: h.flagPhases.length, events: h.events.length, miniSectors: h.miniSectors.length });
export const all = (h: History): HistoryDelta => ({ before: lengths(history()), after: lengths(h), truncated: false });
export const since = (prev: History, h: History, truncated = false): HistoryDelta => ({ before: lengths(prev), after: lengths(h), truncated });
export const AI9: DriverKey = { kind: 'ai', driverId: 9 };
export const HUMAN: DriverKey = { kind: 'human', networkId: 1, name: 'Driver One', raceNumber: 2 };
export const session = (uid: string, o: Partial<SessionRow> = {}): SessionRow => ({ sessionUid: uid as SessionUid, weekendId: 'W1', seasonId: 'S1',
  sessionType: 1, trackId: 26, startedAt: '2026-10-27T20:00:00.000Z', pwrecPath: `/rec/${uid}.pwrec.gz`, settings: { tyreTemperature: 1 },
  drivers: [{ carId: car(0), driverKey: AI9 }, { carId: car(1), driverKey: HUMAN }], ...o });
```

```ts
// apps/bridge/test/storage/db.test.ts
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, SchemaVersionError, openDatabase } from '../../src/storage/db.ts';
const file = () => join(mkdtempSync(join(tmpdir(), 'db-')), 'pitwall.db');

describe('openDatabase', () => {
  it('creates the schema at version 1 with foreign keys on', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all())
      .toEqual(['drivers', 'events', 'flag_phases', 'laps', 'pit_stops', 'sessions', 'stints', 'weekends']);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare("SELECT name FROM pragma_table_info('laps') WHERE pk > 0 ORDER BY pk").pluck().all()).toEqual(['session_uid', 'car_id', 'lap_number']);
  });
  it('reopens an existing database', () => {
    const path = file();
    openDatabase(path).close();
    expect(() => openDatabase(path).close()).not.toThrow();
  });
  it.each([[7, ''], [0, 'CREATE TABLE foreign_table (x INTEGER)']])('throws SchemaVersionError for version %i', (version, ddl) => {
    const path = file();
    const raw = new Database(path);
    if (ddl) raw.exec(ddl);
    raw.pragma(`user_version = ${version}`);
    raw.close();
    expect(() => openDatabase(path)).toThrow(SchemaVersionError);
    try { openDatabase(path); } catch (e) { expect(e).toMatchObject({ found: version, expected: 1 }); }
  });
});
```

```ts
// apps/bridge/test/storage/storage-writer.test.ts
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { all, event, history, lap, sc, session, since, stint } from './records.ts';

function setup() {
  const db = openDatabase(':memory:');
  const onError = vi.fn();
  const writer = new StorageWriter(db, { onError });
  writer.upsertSession(session('1'));
  return { db, onError, writer, repo: new WeekendRepository(db) };
}

describe('StorageWriter', () => {
  it('writes only confirmed laps; provisional ones are ignored until confirmed', () => {
    const { writer, repo, onError } = setup();
    const h1 = history({ laps: [lap(0, 1, { status: 'provisional' }), lap(0, 1), lap(0, 2, { status: 'provisional' })] });
    writer.writeConfirmed('1', h1, all(h1));
    expect(repo.lapsOf('1')).toEqual([lap(0, 1)]);
    const h2 = history({ laps: [...h1.laps, lap(0, 2)] });
    writer.writeConfirmed('1', h2, since(h1, h2));
    expect(repo.lapsOf('1')).toEqual([lap(0, 1), lap(0, 2)]);
    expect(onError).not.toHaveBeenCalled();
  });
  it('upserts by (session, car, lap): the last confirmed value wins', () => {
    const { writer, repo } = setup();
    const h = history({ laps: [lap(0, 1, { lapTimeMs: 90_100 }), lap(0, 1, { lapTimeMs: 90_000 })] });
    writer.writeConfirmed('1', h, all(h));
    expect(repo.lapsOf('1').map((l) => l.lapTimeMs)).toEqual([90_000]);
  });
  it('is idempotent', () => {
    const { db, writer, repo } = setup();
    const h = history({ laps: [lap(0, 1)], stints: [stint(0, 1)], flagPhases: [sc(1000)], events: [event(5, 0), event(6)] });
    writer.writeConfirmed('1', h, all(h));
    writer.writeConfirmed('1', h, all(h));
    expect(db.prepare('SELECT count(*) FROM events').pluck().get()).toBe(2);
    expect(repo.stintsOf('1')).toEqual([stint(0, 1)]);
    expect(repo.flagPhasesOf('1')).toEqual([sc(1000)]);
    expect(repo.eventsOf('1')).toEqual([event(5, 0), event(6)]);
  });
  it('a truncated delta (flashback) rewrites the session history', () => {
    const { writer, repo } = setup();
    const h1 = history({ laps: [lap(0, 1), lap(0, 2)], events: [event(1), event(2), event(3)] });
    writer.writeConfirmed('1', h1, all(h1));
    const h2 = history({ laps: [lap(0, 1)], events: [event(1), event(9)] });
    writer.writeConfirmed('1', h2, since(h1, h2, true));
    expect(repo.lapsOf('1')).toEqual([lap(0, 1)]);
    expect(repo.eventsOf('1')).toEqual([event(1), event(9)]);
  });
  it('one transaction per call: a failure rolls back the batch, calls onError and does not throw', () => {
    const { db, writer, onError } = setup();
    db.exec("CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const h = history({ laps: [lap(0, 1)], events: [event(1)] });
    expect(() => writer.writeConfirmed('1', h, all(h))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).toContain('boom');
    expect(db.prepare('SELECT count(*) FROM laps').pluck().get()).toBe(0);
  });
  it('a closed database is reported through onError', () => {
    const { db, writer, onError } = setup();
    db.close();
    expect(() => writer.upsertSession(session('2'))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});
```

```ts
// apps/bridge/test/storage/weekend-repository.test.ts
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/db.ts';
import { StorageWriter } from '../../src/storage/storage-writer.ts';
import { WeekendRepository } from '../../src/storage/weekend-repository.ts';
import { AI9, HUMAN, all, car, history, lap, session, stint } from './records.ts';

function weekend() {
  const db = openDatabase(':memory:');
  const w = new StorageWriter(db, { onError: (e) => { throw e; } });
  w.upsertSession(session('2', { sessionType: 5, startedAt: '2026-10-27T21:00:00.000Z', drivers: [{ carId: car(3), driverKey: AI9 }] }));
  w.upsertSession(session('1', { sessionType: 1 }));                                         // 20:00, AI9 = car 0, HUMAN = car 1
  w.upsertSession(session('3', { weekendId: 'W2', startedAt: '2026-10-27T19:00:00.000Z' }));
  const h1 = history({ laps: [lap(0, 1), lap(1, 1)], stints: [stint(0, 1), stint(1, 1)] });
  const h2 = history({ laps: [lap(3, 1)] });
  w.writeConfirmed('1', h1, all(h1)); w.writeConfirmed('2', h2, all(h2)); w.writeConfirmed('3', h1, all(h1));
  return new WeekendRepository(db);
}

describe('WeekendRepository', () => {
  it('sessionsOf returns the weekend sessions in start order', () => {
    expect(weekend().sessionsOf('W1')).toEqual([session('1', { sessionType: 1 }),
      session('2', { sessionType: 5, startedAt: '2026-10-27T21:00:00.000Z', drivers: [{ carId: car(3), driverKey: AI9 }] })]);
  });
  it('lapsOf filters by DriverKey through the drivers table', () => {
    const repo = weekend();
    expect(repo.lapsOf('1')).toEqual([lap(0, 1), lap(1, 1)]);
    expect(repo.lapsOf('1', HUMAN)).toEqual([lap(1, 1)]);
  });
  it('weekendContext: same weekend, that DriverKey only, whatever its car index per session', () => {
    expect(weekend().weekendContext('W1', AI9)).toEqual({ weekendId: 'W1', driverKey: AI9, sessions: [
      { sessionUid: '1', sessionType: 1, laps: [lap(0, 1)], stints: [stint(0, 1)], pitStops: [] },
      { sessionUid: '2', sessionType: 5, laps: [lap(3, 1)], stints: [], pitStops: [] }] });
    expect(weekend().weekendContext('W1', HUMAN).sessions.map((s) => s.sessionUid)).toEqual(['1']);
  });
  it('weekendContext with before: only sessions that started earlier', () => {
    expect(weekend().weekendContext('W1', AI9, { before: '2' }).sessions.map((s) => s.sessionUid)).toEqual(['1']);
  });
});
```

```ts
// apps/bridge/test/storage/data-dir.test.ts
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDir } from '../../src/storage/data-dir.ts';
import { StartupError } from '../../src/startup-error.ts';
const tmp = () => mkdtempSync(join(tmpdir(), 'data-'));

describe('dataDir', () => {
  it('honors PITWALL_DATA_DIR and creates the subdirectories', () => {
    const root = join(tmp(), 'pw');
    expect(dataDir({ PITWALL_DATA_DIR: root })).toEqual({ root, recordings: join(root, 'recordings'), dumps: join(root, 'dumps'), dbPath: join(root, 'pitwall.db') });
    expect(existsSync(join(root, 'recordings')) && existsSync(join(root, 'dumps'))).toBe(true);
  });
  it('defaults to ~/.local/share/pitwall', () => {
    const home = tmp();
    expect(dataDir({ HOME: home }).root).toBe(join(home, '.local', 'share', 'pitwall'));
  });
  it('throws StartupError naming the path when it cannot be created or written', () => {
    const blocker = join(tmp(), 'a-file');
    writeFileSync(blocker, '');
    expect(() => dataDir({ PITWALL_DATA_DIR: join(blocker, 'pw') })).toThrow(StartupError);
    expect(() => dataDir({ PITWALL_DATA_DIR: join(blocker, 'pw') })).toThrow(/data directory .*a-file\/pw is not writable/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/bridge/test/storage`
Expected: FAIL (storage modules do not exist)

- [ ] **Step 3: Implement `db.ts`, `storage-writer.ts`, `weekend-repository.ts`, `data-dir.ts`, `startup-error.ts`** (implementation agent; must not edit test files)

Prepared statements created once per instance; `db.transaction(fn)` per method call. Records are stored as `JSON.stringify(record)` and read back with `JSON.parse` (the JSON column is the source of truth; `lap_time_ms`/`car_id` exist for SQL queries). `weekendContext` joins `drivers` on `driver_key = driverKeyString(driverKey)`, skips sessions without that driver, orders by `started_at, session_uid`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run apps/bridge/test/storage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/storage apps/bridge/src/startup-error.ts apps/bridge/test/storage
git commit -F - <<'EOF'
feat(bridge): add SQLite storage, StorageWriter, WeekendRepository and data dir

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 27: Feed pipeline, session files, logging, debug dumps

**Files:**
- Create: `apps/bridge/src/config.ts`, `apps/bridge/src/log.ts`, `apps/bridge/src/pipeline/feed-monitor.ts`, `apps/bridge/src/pipeline/session-recording.ts`, `apps/bridge/src/pipeline/debug-dump.ts`, `apps/bridge/src/pipeline/weekend.ts`, `apps/bridge/src/pipeline/feed-pipeline.ts`, `apps/bridge/src/pipeline/stream-hash.ts`
- Test: `apps/bridge/test/helpers/array-source.ts`, `apps/bridge/test/config.test.ts`, `apps/bridge/test/pipeline/feed-monitor.test.ts`, `apps/bridge/test/pipeline/feed-pipeline.test.ts`, `apps/bridge/test/pipeline/integration.test.ts`

**Interfaces:**
- Consumes: `decode`, `peekHeader`, `DecodeError` (Task 6); `PwrecWriter`, `readPwrec` (Task 7); `PacketSource`, `PwrecSource` (Task 8); `SessionTracker`, `FrameMetrics` (Task 11); `SessionRunner` (Task 17); `CalculatorRegistry`, `Scheduler`, `InsightBook`, `FeedMetricsView` (Tasks 19–20); `Feature`, `FEATURES` (Tasks 20, 23); `feedInsights`, `feedStatusOf` (Task 23); `TopicHub` incl. `resetFeed`/`resetAppend` (Task 24); `WsServer`, `WsClient` (Task 25); `openDatabase`, `Db`, `StorageWriter`, `WeekendRepository`, `StartupError` (Task 26); fixture segment `fixtures/segments/tt-zandvoort-lap1.pwrec.gz` (Task 29 — a TT Zandvoort cut containing Session, Participants and at least one completed lap).
- Produces (contract): `FeedPipeline`, `topicStreamHash(recordingPath)`.
- Produces (contract deviation): `FeedPipeline` opts `storage?: { db: Db; recordingsDir?: string; sourcePath?: string }` — the pipeline constructs `StorageWriter` (its `onError` must raise `system.storageWriteFailed`) and `WeekendRepository` itself; a `.pwrec` per session is written only when `recordingsDir` is set (not in `reprocess`). Extra opts: `wallClock?: () => number /* Date.now; file name + meta.startedAt */`, `staleCheck?: { clock: () => number; everyMs: number }` (live only; replay stays clock-free so its stream is deterministic).
- Produces (new): `loadConfig(env?: NodeJS.ProcessEnv): { wsPort: number; udpPort: number; uiPort: number }` (throws `StartupError`); `createLogger(opts?: { level?: string; destination?: pino.DestinationStream }): Logger`; `class FeedMonitor { constructor(opts?: { windowMs?: number /*10_000*/ }); onPacket(receivedAtMs: number): void; onDecodeError(e: DecodeError, receivedAtMs: number): void; sample(m: FrameMetrics, atMs: number): void; view(m: FrameMetrics, nowMs: number): FeedMetricsView }`; `sessionRecordingName(startedAtMs: number, sessionUid: bigint): string` (`YYYY-MM-DD_HH-MM-SS_<uid 16 hex>.pwrec.gz`, local time, recorder convention); `writeDebugDump(dir: string, d: { feedId: FeedId; sessionUid: bigint; frame: Frame; pwrec: { path?: string; t: number }; error: unknown }): string` (file `<feedId>-<sessionUid>-<frameId>.json`, bigints as decimal strings); `MAX_DUMPS_PER_SESSION = 20`; `driverKeyOf(p: ParticipantsPacket, carIndex: number): DriverKey`.

- [ ] **Step 1: Write the failing unit tests** (test agent)

```ts
// apps/bridge/test/config.test.ts
import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
it('reads ports from env with defaults', () => {
  expect(loadConfig({})).toEqual({ wsPort: 4777, udpPort: 20777, uiPort: 5173 });
  expect(loadConfig({ PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '30777' })).toMatchObject({ wsPort: 0, udpPort: 30777 });
  expect(() => loadConfig({ PITWALL_WS_PORT: 'abc' })).toThrow('PITWALL_WS_PORT must be an integer 0-65535, got "abc"');
  expect(() => loadConfig({ PITWALL_UDP_PORT: '70000' })).toThrow('PITWALL_UDP_PORT must be an integer 0-65535, got "70000"');
});
```

```ts
// apps/bridge/test/pipeline/feed-monitor.test.ts
import { describe, expect, it } from 'vitest';
import type { FrameMetrics } from '@pitwall/engine';
import { FeedMonitor } from '../../src/pipeline/feed-monitor.ts';
const m = (framesClosed: number, incompleteFrames: number): FrameMetrics => ({ framesClosed, incompleteFrames, latePackets: 0, droppedBeforeSession: 0, droppedUid0: 0, decodeErrors: 0 });

describe('FeedMonitor', () => {
  it('packets per second over the last 1000 ms, time since last packet', () => {
    const f = new FeedMonitor(); for (let t = 10; t <= 1000; t += 10) f.onPacket(t);
    expect(f.view(m(0, 0), 1000)).toMatchObject({ packetsPerSecond: 100, msSinceLastPacket: 0, connected: true });
    expect(f.view(m(0, 0), 1500)).toMatchObject({ packetsPerSecond: 50, msSinceLastPacket: 500 });
    expect(new FeedMonitor().view(m(0, 0), 5000)).toMatchObject({ connected: false, msSinceLastPacket: 0, packetsPerSecond: 0 });
  });
  it('loss % = incomplete / closed frames over the last 10 s', () => {
    const f = new FeedMonitor(); f.onPacket(0);
    f.sample(m(100, 0), 0); f.sample(m(200, 10), 5000); f.sample(m(300, 10), 11_000);
    expect(f.view(m(300, 10), 11_000).lossPercent).toBe(5);
    expect(f.view(m(300, 10), 16_000).lossPercent).toBe(0);
  });
  it('wrong format is reported for 10 s and counted as decode error', () => {
    const f = new FeedMonitor(); f.onPacket(1000); f.onDecodeError({ kind: 'wrongFormat', format: 2024 }, 1000);
    expect(f.view(m(0, 0), 1000)).toMatchObject({ wrongFormat: 2024, decodeErrors: 1 });
    expect(f.view(m(0, 0), 11_001).wrongFormat).toBeUndefined();
  });
});
```

```ts
// apps/bridge/test/helpers/array-source.ts — replays prepared packets synchronously
import type { FeedId } from '@pitwall/domain';
import type { PacketSource, RawPacket } from '../../src/input/packet-source.ts';
export class ArraySource implements PacketSource {
  readonly done: Promise<void>; #resolve!: () => void;
  constructor(readonly feedId: FeedId, private readonly packets: Array<{ bytes: Uint8Array; receivedAtMs: number }>) { this.done = new Promise((r) => { this.#resolve = r; }); }
  start(on: (p: RawPacket) => void) { for (const p of this.packets) on({ feedId: this.feedId, ...p }); this.#resolve(); }
  async stop() { this.#resolve(); }
}
```

```ts
// apps/bridge/test/pipeline/feed-pipeline.test.ts
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { ServerMessage } from '@pitwall/contracts';
import { ScenarioBuilder, buildPacket, headerFor, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { defineFeature } from '../../src/features/feature.ts';
import sessionInfo from '../../src/features/session-info/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { ArraySource } from '../helpers/array-source.ts';

const F = 'test' as FeedId;
const tmp = () => mkdtempSync(join(tmpdir(), 'pipeline-'));
const scenario = (uid = 77n) => new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session().participants().frames(5, () => {})
  .event({ code: 'FTLP', vehicleIdx: 0, lapTime: 80 }).frames(5, () => {}).packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
async function run(packets: Array<{ bytes: Uint8Array; receivedAtMs: number }>, o: { features?: typeof FEATURES; storage?: object; dumpsDir?: string; topics?: Array<[string, object]> } = {}) {
  let t = 0; const hub = new TopicHub({ now: () => (t += 1000) }); const sent: ServerMessage[] = []; const logs: string[] = [];
  hub.addClient('c', { send: (m) => sent.push(m), bufferedAmount: () => 0 });
  for (const [topic, params] of o.topics ?? [['session.info', {}], ['events', {}], ['insights', {}], ['feed.status', {}]])
    hub.subscribe({ clientId: 'c', id: topic, topic: topic as never, params, feedId: F });
  const log = createLogger({ level: 'debug', destination: new Writable({ write(c, _e, cb) { logs.push(String(c)); cb(); } }) });
  const p = new FeedPipeline({ feedId: F, source: new ArraySource(F, packets), hub, features: o.features ?? FEATURES, log,
    ...(o.storage ? { storage: o.storage as never } : {}), ...(o.dumpsDir ? { dumpsDir: o.dumpsDir } : {}) });
  p.start(); await p.done;
  const of = (id: string) => sent.filter((m) => 'id' in m && m.id === id);
  const raised = () => of('insights').flatMap((m) => ('entries' in m ? (m.entries as Array<{ type: string; insight?: { kind: string; severity: string; params: object } }>) : [])).filter((e) => e.type === 'raised').map((e) => e.insight!);
  return { of, raised, logs };
}

describe('FeedPipeline', () => {
  it('publishes session.info, history appends and feed.status', async () => {
    const r = await run(scenario());
    expect(r.of('session.info').find((m) => m.type === 'update')).toMatchObject({ value: { feedId: F, sessionUid: '77' } });
    expect(r.of('events').flatMap((m) => ('entries' in m ? m.entries ?? [] : []))).toMatchObject([{ kind: 'fastestLap' }]);
    expect(r.of('feed.status').some((m) => m.type === 'update')).toBe(true);
  });
  it('wrong packet format → decode error metrics + critical feed.wrongFormat, before any session', async () => {
    const bad = packetBytes(buildPacket('session', { header: headerFor('session', { packetFormat: 2024 }) }));
    const r = await run([{ bytes: bad, receivedAtMs: 0 }]);
    expect(r.raised()).toEqual([expect.objectContaining({ kind: 'feed.wrongFormat', severity: 'critical', params: { format: 2024 } })]);
    expect(r.of('feed.status').at(-1)).toMatchObject({ value: { decodeErrors: 1, wrongFormat: 2024 } });
  });
  it('a new session resets the feed topics', async () => {
    const second = scenario(78n).map((p) => ({ ...p, receivedAtMs: p.receivedAtMs + 60_000 }));
    const r = await run([...scenario(), ...second]);
    expect(r.of('events').filter((m) => m.type === 'snapshot').at(-1)).toEqual({ type: 'snapshot', id: 'events', entries: [] });
    expect(r.of('session.info').filter((m) => m.type === 'update').at(-1)).toMatchObject({ value: { sessionUid: '78' } });
  });
  it('writes one .pwrec per session when recordingsDir is set', async () => {
    const dir = tmp(); const packets = scenario();
    await run(packets, { storage: { db: openDatabase(join(tmp(), 'p.db')), recordingsDir: dir } });
    const files = readdirSync(dir); expect(files).toHaveLength(1); expect(files[0]).toMatch(/^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_000000000000004d\.pwrec\.gz$/);
    let n = 0; for await (const _ of readPwrec(join(dir, files[0]!))) n++;
    expect(n).toBe(packets.length);
  });
  it('storage failure → advisory system.storageWriteFailed, live topics continue', async () => {
    const db = openDatabase(join(tmp(), 's.db')); db.close();
    const r = await run(scenario(), { storage: { db } });
    expect(r.raised().filter((i) => i.kind === 'system.storageWriteFailed')).toEqual([expect.objectContaining({ severity: 'advisory' })]);
    expect(r.of('session.info').some((m) => m.type === 'update')).toBe(true);
  });
  it('pwrec write failure → critical system.pwrecWriteFailed, live topics continue', async () => {
    const file = join(tmp(), 'not-a-dir'); writeFileSync(file, '');
    const r = await run(scenario(), { storage: { db: openDatabase(join(tmp(), 'w.db')), recordingsDir: join(file, 'sub') } });
    expect(r.raised().filter((i) => i.kind === 'system.pwrecWriteFailed')).toEqual([expect.objectContaining({ severity: 'critical' })]);
    expect(r.of('session.info').some((m) => m.type === 'update')).toBe(true);
  });
  it('an exception while processing a frame: frame skipped, error logged, debug dump written (max 20)', async () => {
    const boom = defineFeature({ name: 'boom', calculators: [{ kind: 'quick', id: 'boom', reads: ['timing'], cadence: 'frame', compute: () => 1 }],
      topics: [{ topic: 'car.telemetry', from: 'boom', select: () => { throw new Error('select failed'); } }] });
    const dumps = tmp();
    const r = await run(scenario(), { features: [sessionInfo, boom], dumpsDir: dumps, topics: [['session.info', {}], ['car.telemetry', { carId: 0 }]] });
    const err = r.logs.map((l) => JSON.parse(l)).find((l) => l.level === 50)!;
    expect(err).toMatchObject({ feedId: F, sessionUid: '77' }); expect(JSON.stringify(err)).toContain('select failed');
    const files = readdirSync(dumps); expect(files.length).toBeGreaterThan(0); expect(files.length).toBeLessThanOrEqual(20);
    const dump = JSON.parse(readFileSync(join(dumps, files[0]!), 'utf8'));
    expect(files[0]).toBe(`test-77-${dump.frame.frameId}.json`);
    expect(dump).toMatchObject({ feedId: F, sessionUid: '77', frame: { sessionUid: '77' }, pwrec: { t: expect.any(Number) } });
    expect(r.of('session.info').some((m) => m.type === 'update')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm gen:features && pnpm vitest run apps/bridge/test/config.test.ts apps/bridge/test/pipeline` — Expected: FAIL (modules missing)

- [ ] **Step 3: Implement** (implementation agent; must not edit test files)

`FeedPipeline` per `RawPacket`: `monitor.onPacket`; `decode` → error: `monitor.onDecodeError`, `log.debug`; ok: `tracker.push(packet, receivedAtMs)`; for each `TrackerEvent`:
- `sessionStarted`: close the previous session's writer; `hub.resetFeed(feedId)`; open the session's `PwrecWriter` (`<recordingsDir>/<sessionRecordingName(wallClock(), uid)>`, meta `{ recorderVersion: 'pitwall-bridge', startedAt, listenPort: 0 }` where `startedAt` is the source recording's `meta.startedAt` + record `t` when replaying and ISO of `wallClock()` when live, so replays stay deterministic); `writer.upsertSession(…)`; buffer the session's frames until the first frame with `participants` (cap 600 frames, then start without weekend), then `writer.upsertSession(…)` again with the drivers, `repo.weekendContext(String(session.weekendLinkIdentifier), driverKeyOf(participants, frame.playerCarIndex), { before: sessionUidString(uid) })` and `new SessionRunner({ feedId, sessionUid, session, weekend })` + a `Scheduler` over all features' calculators with `setNeeded(all ids)`.
- `frame`: inside `try`: `result = runner.apply(frame)`; on `result.flashback` → `scheduler.reset()` and an info `session.flashback` entry (raised then resolved at the same `sessionTime`, params `{ targetLap, rewoundS }`); `scheduler.run(result)`; state bindings of calculators in `ran` → `hub.publishState(feedId, topic, (p) => select ? select(out, p) : out)`, in `errors` → `setStatus(…, 'errored')`, back to success → `setStatus(…, 'ok')`; `fromHistory` bindings → `delta.truncated ? hub.resetAppend(feedId, topic, history[k].slice()) : publishAppend(history[k].slice(before[k], after[k]))` when it grew; insight changes → `publishAppend(feedId, 'insights', changes)`; `storageWriter.writeConfirmed(sessionUid, state.history, delta)`; corrections → `log.info`. `catch`: `log.error({ feedId, sessionUid: String(uid), err })` and, while fewer than `MAX_DUMPS_PER_SESSION`, `writeDebugDump` with `pwrec: { path, t }` = the session file and last written `t`.
- `sessionEnded`: `writer.close(lastReceivedAtMs - sessionStartReceivedAtMs)`.
After the events: write the raw bytes to the open session writer (header uid = session uid, or uid 0 while a session is open); `monitor.sample(tracker.metrics, receivedAtMs)`; feed-level `InsightBook` (source `'feed'`) applies `feedInsights(feedId, view, lastSessionTime ?? 0)` and `feed.status` is published via `feedStatusOf` (the `feed.status` calculator does the same in-session; both paths publish to the same topic). Every `PwrecWriter` / `StorageWriter` failure is caught and applied as `system.pwrecWriteFailed` (critical) / `system.storageWriteFailed` (advisory) to a system `InsightBook` (category `system`); the failed writer is disabled for the rest of the session. `done` resolves after `source.done`, `tracker.end()` processing and all writers closed. `staleCheck` runs a timer that publishes `feed.status` and feed insights with `view(metrics, clock())`.

`topicStreamHash`: `PwrecSource` (`asFastAsPossible`) wrapped so the hub's `now()` returns the latest `receivedAtMs` and `hub.tick()` runs after each packet; one sink client subscribed to every `TOPICS` key on the feed (`{ carId: 0 }` for per-car topics); sha256 over `encodeMessage(m) + '\n'` of every message, hex.

- [ ] **Step 4: Run tests to verify they pass** — Run: same as Step 2 — Expected: PASS

- [ ] **Step 5: Write the failing in-process integration test** (test agent)

```ts
// apps/bridge/test/pipeline/integration.test.ts
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import type { ServerMessage } from '@pitwall/contracts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { WsClient } from '../../src/ws/client.ts';
import { WsServer } from '../../src/ws/server.ts';

const SEGMENT = join(import.meta.dirname, '../../../../fixtures/segments/tt-zandvoort-lap1.pwrec.gz');
const F = 'replay' as FeedId;

describe('PwrecSource → pipeline → WebSocket (in process)', () => {
  it('delivers hello, snapshots and updates; resubscribes after reconnect', async () => {
    const hub = new TopicHub({ now: () => performance.now() });
    const feeds = () => [{ feedId: F, kind: 'replay' as const, label: 'segment' }];
    const s1 = await WsServer.start({ port: 0, hub, feeds }); const port = s1.port;
    const c = WsClient.connect(`ws://127.0.0.1:${port}`, { reconnectMs: 50 }); let hellos = 0; c.onHello(() => { hellos++; });
    const info: ServerMessage[] = [], laps: ServerMessage[] = [];
    c.subscribe('session.info', {}, (m) => info.push(m)); c.subscribe('laps', {}, (m) => laps.push(m));
    await vi.waitFor(() => expect(laps).toHaveLength(1));
    expect(info[0]).toMatchObject({ type: 'topicStatus', status: 'noData' });
    const p = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path: SEGMENT, mode: 'asFastAsPossible' }), hub, features: FEATURES, log: createLogger({ level: 'silent' }) });
    p.start(); await p.done; hub.tick();
    await vi.waitFor(() => expect(info.some((m) => m.type === 'update' || m.type === 'snapshot')).toBe(true));
    expect(info.findLast((m) => m.type === 'update')).toMatchObject({ value: { sessionUid: '1895827638050388100' } });
    const entries = laps.flatMap((m) => (m.type === 'append' || m.type === 'snapshot' ? (m.entries ?? []) : [])) as Array<{ lapTimeMs: number }>;
    expect(entries.length).toBeGreaterThan(0); expect(entries.every((l) => l.lapTimeMs > 0)).toBe(true);
    await s1.close(); const s2 = await WsServer.start({ port, hub, feeds });
    await vi.waitFor(() => expect(hellos).toBe(2), { timeout: 3000 });
    await vi.waitFor(() => expect(laps.at(-1)).toMatchObject({ type: 'snapshot', entries: expect.arrayContaining([expect.objectContaining({ lapTimeMs: entries[0]!.lapTimeMs })]) }));
    expect(info.at(-1)).toMatchObject({ type: 'snapshot', value: { sessionUid: '1895827638050388100' } });
    c.close(); await s2.close();
  });
  it('topic stream hash is deterministic', async () => {
    const [a, b] = [await topicStreamHash(SEGMENT), await topicStreamHash(SEGMENT)];
    expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).toBe(b);
  });
});
```

- [ ] **Step 6: Run** `pnpm vitest run apps/bridge/test/pipeline/integration.test.ts` — Expected: FAIL until Step 3 code and the Task 29 segment exist; after Step 3: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bridge/src/config.ts apps/bridge/src/log.ts apps/bridge/src/pipeline apps/bridge/test/config.test.ts apps/bridge/test/pipeline apps/bridge/test/helpers/array-source.ts
git commit -F - <<'EOF'
feat(bridge): feed pipeline with session files, feed monitor, debug dumps and stream hash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 28: CLI: `live`, `replay`, `tap`, `reprocess`, `import`

**Files:**
- Create: `apps/bridge/src/cli/pitwall.ts`, `apps/bridge/src/cli/io.ts`, `apps/bridge/src/cli/udp-port.ts`, `apps/bridge/src/cli/serve.ts`, `apps/bridge/src/cli/commands/live.ts`, `apps/bridge/src/cli/commands/replay.ts`, `apps/bridge/src/cli/commands/tap.ts`, `apps/bridge/src/cli/commands/reprocess.ts`, `apps/bridge/src/cli/commands/import.ts`
- Supervisor: `apps/bridge/package.json` gains `"bin": { "pitwall": "./src/cli/pitwall.ts" }` (file starts with `#!/usr/bin/env node`)
- Test: `apps/bridge/test/helpers/cli.ts`, `apps/bridge/test/cli/pitwall.test.ts`

**Interfaces:**
- Consumes: `FeedPipeline`, `loadConfig`, `createLogger` (Task 27); `FEATURES` (Task 23); `TopicHub` (Task 24); `WsServer`, `WsClient` (Task 25); `dataDir`, `openDatabase`, `WeekendRepository`, `StartupError`, `SchemaVersionError` (Task 26); `PwrecSource`, `UdpSource` (Task 8); `TOPICS`, `encodeMessage` (Task 21); `feedId()` (Task 9).
- Produces (new): `main(argv: readonly string[], io?: CliIo): Promise<number>` (exit code); `type CliIo = { out(line: string): void; err(line: string): void; env: NodeJS.ProcessEnv; signal: AbortSignal /* aborted on SIGINT/SIGTERM */ }`; `assertUdpPortFree(port: number): Promise<void>` (binds and closes a `dgram` socket; `EADDRINUSE` → `StartupError('UDP port <port> is already in use')`); `serve(opts: { source: PacketSource; storage?: { db: Db; recordingsDir: string }; io: CliIo }): Promise<number>`.
- Pinned output: a long-running command prints `listening ws://127.0.0.1:<port>` on stdout once the WebSocket server is up; errors go to stderr as `pitwall: <message>` with exit code 1; usage line `usage: pitwall <live|replay|tap|reprocess|import> …`.

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/helpers/cli.ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const CLI = fileURLToPath(new URL('../../src/cli/pitwall.ts', import.meta.url));
export const SEGMENT = fileURLToPath(new URL('../../../../fixtures/segments/tt-zandvoort-lap1.pwrec.gz', import.meta.url));
export function startCli(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
  const waitFor = async (re: RegExp, ms = 10_000) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = out.match(re); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error(`timeout waiting for ${re}; stdout=${out} stderr=${err}`); };
  return { child, exited, waitFor, stdout: () => out, stderr: () => err, stop: () => { child.kill('SIGTERM'); return exited; } };
}
export async function runCli(args: string[], env: Record<string, string> = {}) {
  const c = startCli(args, env); const code = await c.exited; return { code, stdout: c.stdout(), stderr: c.stderr() };
}
```

```ts
// apps/bridge/test/cli/pitwall.test.ts
import { createSocket } from 'node:dgram';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { dataDir } from '../../src/storage/data-dir.ts';
import { runCli, SEGMENT, startCli } from '../helpers/cli.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'pitwall-cli-'));
const dump = (dir: string) => { const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath, { readonly: true });
  const r = Object.fromEntries(['sessions', 'laps', 'events'].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])); db.close(); return r; };

describe('pitwall CLI', { timeout: 30_000 }, () => {
  it('unknown command → usage, exit 1', async () => {
    const r = await runCli(['fly']);
    expect(r.code).toBe(1); expect(r.stderr).toContain('usage: pitwall <live|replay|tap|reprocess|import>');
  });
  it('replay serves the segment; tap prints hello and the session.info snapshot as JSON lines', async () => {
    const replay = startCli(['replay', SEGMENT], { PITWALL_WS_PORT: '0', PITWALL_DATA_DIR: tmp() });
    const [, port] = (await replay.waitFor(/listening ws:\/\/127\.0\.0\.1:(\d+)/))!;
    await new Promise((r) => setTimeout(r, 500));
    const tap = startCli(['tap', 'session.info', '--url', `ws://127.0.0.1:${port}`], {});
    await tap.waitFor(/"sessionUid":"1895827638050388100"/);
    const lines = tap.stdout().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'hello', contractVersion: 1 });
    expect(lines.some((m) => m.type === 'snapshot' || m.type === 'update')).toBe(true);
    expect(await tap.stop()).toBe(0); expect(await replay.stop()).toBe(0);
  });
  it('tap rejects an unknown topic and a per-car topic without --carId', async () => {
    expect(await runCli(['tap', 'weather'])).toMatchObject({ code: 1, stderr: expect.stringContaining('pitwall: unknown topic "weather"') });
    expect(await runCli(['tap', 'car.detail'])).toMatchObject({ code: 1, stderr: expect.stringContaining('pitwall: topic car.detail needs --carId') });
  });
  it('live: busy WebSocket port → clear message, exit 1', async () => {
    const srv = createServer().listen(0); await new Promise((r) => srv.once('listening', r));
    const port = (srv.address() as { port: number }).port;
    const r = await runCli(['live'], { PITWALL_WS_PORT: String(port), PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: tmp() });
    srv.close();
    expect(r.code).toBe(1); expect(r.stderr).toContain(`pitwall: WebSocket port ${port} is already in use`); expect(r.stdout).not.toContain('listening');
  });
  it('live: busy UDP port → clear message, exit 1', async () => {
    const sock = createSocket('udp4'); await new Promise<void>((r) => sock.bind(0, () => r()));
    const port = sock.address().port;
    const r = await runCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: String(port), PITWALL_DATA_DIR: tmp() });
    sock.close();
    expect(r.code).toBe(1); expect(r.stderr).toContain(`pitwall: UDP port ${port} is already in use`);
  });
  it('live: data dir not writable → exit 1 with a pitwall: message', async () => {
    const file = join(tmp(), 'file'); writeFileSync(file, '');
    const r = await runCli(['live'], { PITWALL_WS_PORT: '0', PITWALL_UDP_PORT: '0', PITWALL_DATA_DIR: join(file, 'data') });
    expect(r.code).toBe(1); expect(r.stderr).toMatch(/^pitwall: /m);
  });
  it('reprocess rebuilds the database identically', async () => {
    const dir = tmp(); const rec = dataDir({ PITWALL_DATA_DIR: dir }).recordings; mkdirSync(rec, { recursive: true }); copyFileSync(SEGMENT, join(rec, basename(SEGMENT)));
    const first = await runCli(['reprocess'], { PITWALL_DATA_DIR: dir });
    expect(first).toMatchObject({ code: 0, stdout: expect.stringContaining('reprocessed 1 recordings') });
    const a = dump(dir);
    expect(a['sessions']).toHaveLength(1);
    expect((await runCli(['reprocess'], { PITWALL_DATA_DIR: dir })).code).toBe(0);
    expect(dump(dir)).toEqual(a);
  });
  it('import copies the file into the data dir and processes it; a second import is refused', async () => {
    const dir = tmp();
    const r = await runCli(['import', SEGMENT], { PITWALL_DATA_DIR: dir });
    expect(r).toMatchObject({ code: 0, stdout: expect.stringContaining(`imported ${basename(SEGMENT)}`) });
    expect(existsSync(join(dataDir({ PITWALL_DATA_DIR: dir }).recordings, basename(SEGMENT)))).toBe(true);
    expect(dump(dir)['sessions']).toHaveLength(1);
    expect(await runCli(['import', SEGMENT], { PITWALL_DATA_DIR: dir })).toMatchObject({ code: 1, stderr: expect.stringContaining('is already imported') });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm gen:features && pnpm vitest run apps/bridge/test/cli` — Expected: FAIL (CLI module missing)

- [ ] **Step 3: Implement the CLI** (implementation agent; must not edit test files)

- `pitwall.ts`: `parseArgs({ args, allowPositionals: true, strict: true, options: { realtime: { type: 'boolean' }, carId: { type: 'string' }, url: { type: 'string' }, feed: { type: 'string' }, weekend: { type: 'string' } } })`; first positional = command; dispatch to `commands/*.ts` (each `run(positionals, values, io): Promise<number>`). `parseArgs` errors and unknown commands → usage on stderr, `1`. `StartupError`/`SchemaVersionError` (message suffixed `; run "pitwall reprocess"`) → `pitwall: <message>`, `1`; anything else is a bug: log the stack, `1`. When run directly: `process.exitCode = await main(process.argv.slice(2), defaultIo())` with SIGINT/SIGTERM aborting `io.signal`.
- `serve` (shared by `live`/`replay`), strictly in this order, undoing every started step if a later one fails (no half-started state): `loadConfig(env)` → (live) `assertUdpPortFree(udpPort)` → `dataDir(env)` → (live) `openDatabase(dbPath)` → `new TopicHub({ now: () => performance.now() })` → `WsServer.start({ port: wsPort, hub, feeds })` → print `listening ws://127.0.0.1:<port>` → `new FeedPipeline({ …, features: FEATURES, log: createLogger(), dumpsDir })`.start(). Waits for `io.signal`, then `pipeline.stop()`, `server.close()`, `db.close()`, returns `0`.
- `live`: `UdpSource({ feedId: feedId('udp-' + udpPort), port: udpPort })`, storage `{ db, recordingsDir }`, `staleCheck: { clock: () => performance.now(), everyMs: 500 }`. `replay <file> [--realtime]`: `PwrecSource` (`realtime` or `asFastAsPossible`), feed `replay`, no storage; prints `pitwall: replay finished` to stderr when the pipeline is done and keeps serving until the signal.
- `tap <topic> [--carId n] [--url u] [--feed id]`: topic must be a `TOPICS` key; `car.detail`/`car.telemetry` need `--carId`; url defaults to `ws://127.0.0.1:<PITWALL_WS_PORT>`; prints `encodeMessage(m)` per line for `hello` and every message of its subscription until the signal, then `0`.
- `reprocess [--weekend id]`: without `--weekend` delete `dbPath` (+ `-wal`, `-shm`), open a fresh DB, process every `*.pwrec.gz` in `dataDir(env).recordings` sorted by name; with `--weekend` keep the DB and process only `new WeekendRepository(db).sessionsOf(id)` recordings (deduplicated paths; relies on Task 26 upserts being idempotent). Each file: `FeedPipeline` with `PwrecSource` `asFastAsPossible`, a client-less `TopicHub({ now: () => 0 })`, `storage: { db, sourcePath }`, awaited sequentially. Prints `reprocessed <n> recordings`.
- `import <file>`: target `<dataDir(env).recordings>/<basename>`; existing → `StartupError('<basename> is already imported')`; copy, then process it like one reprocess file; prints `imported <basename>`.

- [ ] **Step 4: Run tests to verify they pass** — Run: `pnpm gen:features && pnpm vitest run apps/bridge/test/cli` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/cli apps/bridge/test/cli apps/bridge/test/helpers/cli.ts
git commit -F - <<'EOF'
feat(bridge): pitwall cli with live, replay, tap, reprocess and import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 29: `pwrec-cut` and committed fixture segments

**Files:**
- Create: `apps/bridge/src/pwrec/cut.ts`, `apps/bridge/src/cli/pwrec-cut.ts` (starts with `#!/usr/bin/env node`)
- Create (generated by the CLI, committed): `fixtures/segments/tt-zandvoort-lap1.pwrec.gz`, `fixtures/segments/race-singapore-start.pwrec.gz`, `fixtures/segments/race-singapore-end.pwrec.gz`
- Modify: `fixtures/index.json` (add a `segments` list)
- Supervisor (requested in report): root `package.json` script `"pwrec-cut": "node apps/bridge/src/cli/pwrec-cut.ts"`; `apps/bridge/package.json` `bin` gains `"pwrec-cut": "./src/cli/pwrec-cut.ts"`
- Test: `apps/bridge/test/pwrec/cut.test.ts`, `apps/bridge/test/pwrec/segments.test.ts`, `apps/bridge/test/cli/pwrec-cut.test.ts`

**Interfaces:**
- Consumes: `PwrecRecord`, `PwrecMeta`, `readPwrec`, `PwrecWriter` (Task 7) and the test helper `drain` (`apps/bridge/test/pwrec/helpers.ts`, Task 7); `peekHeader`, `decode`, `encode`, `PacketId`, `PacketHeader` (Tasks 4, 6); `buildPacket`, `headerFor`, `packetBytes` (Task 12); `describeWithFixture`, `FIXTURES` (Task 1).
- Produces (contract): CLI `pwrec-cut <in> <out> --from <sessionTimeS> --to <sessionTimeS>`. Segments: `fixtures/segments/tt-zandvoort-lap1.pwrec.gz`, already consumed by Tasks 27 and 28, which need Session, Participants and one completed lap.
- Produces (new):
  ```ts
  type CutRange = { fromS: number; toS: number };
  type CutResult = { records: Array<{ t: number; payload: Uint8Array }>; firstT: number | undefined; contextPackets: number; durationMs: number };
  const CONTEXT_PACKET_IDS: readonly number[] = [PacketId.session, PacketId.participants];   // emitted in this order
  function cutRecords(records: AsyncIterable<PwrecRecord>, range: CutRange): Promise<CutResult>;   // apps/bridge/src/pwrec/cut.ts
  function main(argv: readonly string[], io?: { out(line: string): void; err(line: string): void }): Promise<number>;   // cli/pwrec-cut.ts
  ```

**Cut rules (pinned):**
1. A record is in the window iff `peekHeader(payload)` is defined and `fromS <= header.sessionTime <= toS` (inclusive, header seconds). Records shorter than 29 bytes are dropped. Session time can jump back after a flashback, so every record is tested; reading never stops early.
2. Context is the latest Session and the latest Participants packet with `sessionUid !== 0n` seen before the first in-window record. CarSetups, CarDamage, TyreSets, LapPositions and SessionHistory are not kept, because they repeat at ≥ 1 Hz (TyreSets/SessionHistory cycle through the cars) and a segment observes them itself. Session matters because a session opens only with a Session packet (spec 5.3). Participants matters because it arrives only every 5 s and carries identity and `numActiveCars`.
3. Context packets are written immediately before the first in-window record with the same `sessionUid`, at that record's time. They are re-stamped into its frame: `encode({ ...p, header: { ...p.header, sessionTime, frameIdentifier, overallFrameIdentifier } })` with the reference header's three values. Otherwise their old frame ids would arrive "late" or before any Session packet. The body bytes stay unchanged. A context packet that fails `decode`, or whose session never appears in the window, is left out.
4. Times: `t' = t − firstT`, where `firstT` = `t` of the first in-window record. `durationMs` = the last `t'` (0 for an empty window).
5. CLI: output meta = `{ ...inputMeta, startedAt: new Date(Date.parse(inputMeta.startedAt) + Math.round(firstT)).toISOString(), cut: { source: basename(in), fromS, toS, contextPackets } }`. `PwrecWriter.create(out, meta)`, each record, then `close(durationMs)` (clean end marker). Errors go to stderr as `pwrec-cut: <message>`, exit 1:
   - missing args or non-numeric bounds print `usage: pwrec-cut <in.pwrec.gz> <out.pwrec.gz> --from <sessionTimeS> --to <sessionTimeS>`
   - `from > to` → `--from <from> is after --to <to>`
   - the output exists → `<out> already exists`
   - an empty window → `no records with sessionTime in [<from>, <to>] s` (the output file is created only after a non-empty cut)

   Success prints `wrote <out>: <n> records (<c> context), <durationMs> ms` and exits 0.

**Segments (windows chosen from the recordings; facts measured with a reference script):**

| file | source, `--from`/`--to` | records | content |
|---|---|---|---|
| `tt-zandvoort-lap1.pwrec.gz` | ttZandvoort, 112 / 118 | 2144 (2 context) | end of lap 1: `FTLP` (car 0, 71.910 s) at st 114.228, lap 1→2 at st 114.234, SessionHistory car 0 with 2 laps at st 114.447; events FTLP 1, SPTP 1, BUTN 3; duration 5979.381 ms; ≈170 KB |
| `race-singapore-start.pwrec.gz` | raceSingapore, 0 / 0.5 | 2169 (0 context) | everything before lights out (session time stays 0 until LGOT, about 8.2 s of wall time); first record is an event before the first Session packet; events SSTA 1, STLG 5, LGOT 1, BUTN 8; duration 8750.935 ms; ≈460 KB |
| `race-singapore-end.pwrec.gz` | raceSingapore, 61.5 / 63.4 | 696 (2 context) | COLL at st 62.205, the 20 UID-0 SessionHistory packets (one per car 0–19) arriving just **before** `SEND`, then `SEND`; events BUTN 18, COLL 1, SEND 1; duration 3265.341 ms; ≈230 KB |

- [ ] **Step 1: Write the failing tests** (test agent)

```ts
// apps/bridge/test/pwrec/cut.test.ts
import { describe, expect, it } from 'vitest';
import { decode, peekHeader, type PacketName } from '@pitwall/protocol';
import { buildPacket, headerFor, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { cutRecords } from '../../src/pwrec/cut.ts';
import type { PwrecRecord } from '../../src/pwrec/types.ts';

const pkt = (name: PacketName, sessionTime: number, frame: number, sessionUid = 7n) =>
  packetBytes(buildPacket(name, { header: headerFor(name, { sessionUid, sessionTime, frameIdentifier: frame, overallFrameIdentifier: frame }) }));
const rec = (t: number, payload: Uint8Array): PwrecRecord => ({ kind: 0, t, payload });
async function* stream(rs: PwrecRecord[]) { yield* rs; }
const hdr = (b: Uint8Array) => peekHeader(b)!;

const INPUT = [
  rec(100, pkt('session', 9, 90)), rec(110, pkt('participants', 9.25, 91)), rec(120, pkt('participants', 9.5, 92)),
  rec(125, pkt('session', 9.5, 92, 0n)), rec(130, pkt('lapData', 9.75, 93)), rec(140, new Uint8Array(10)),
  rec(150, pkt('lapData', 10, 94)), rec(160, pkt('motion', 10.5, 95)), rec(170, pkt('lapData', 11, 96)), rec(180, pkt('lapData', 11.25, 97)),
];

describe('cutRecords', () => {
  it('keeps records with sessionTime in [from, to] inclusive, rebased to t = 0', async () => {
    const r = await cutRecords(stream(INPUT), { fromS: 10, toS: 11 });
    const window = r.records.slice(r.contextPackets);
    expect(window.map((x) => x.t)).toEqual([0, 10, 20]);
    expect(window.map((x) => hdr(x.payload).frameIdentifier)).toEqual([94, 95, 96]);
    expect(r).toMatchObject({ firstT: 150, durationMs: 20 });
  });
  it('prepends the latest Session and Participants (uid != 0), re-stamped into the first window frame, bodies untouched', async () => {
    const r = await cutRecords(stream(INPUT), { fromS: 10, toS: 11 });
    expect(r.contextPackets).toBe(2);
    const [s, p, first] = r.records;
    expect([s!.t, p!.t]).toEqual([0, 0]);
    expect([hdr(s!.payload).packetId, hdr(p!.payload).packetId]).toEqual([1, 4]);
    for (const c of [s!, p!]) {
      expect(hdr(c.payload)).toMatchObject({ sessionUid: 7n, sessionTime: 10, frameIdentifier: 94, overallFrameIdentifier: 94 });
      expect(decode(c.payload).ok).toBe(true);
    }
    expect(p!.payload.subarray(29)).toEqual(INPUT[2]!.payload.subarray(29));
    expect(s!.payload.subarray(29)).toEqual(INPUT[0]!.payload.subarray(29));
    expect(hdr(first!.payload).frameIdentifier).toBe(94);
  });
  it('needs no context when the window starts at the beginning', async () => {
    const r = await cutRecords(stream(INPUT), { fromS: 0, toS: 9.25 });
    expect(r.contextPackets).toBe(0);
    expect(r.records.map((x) => x.t)).toEqual([0, 10]);
  });
  it('drops context whose session never appears in the window', async () => {
    const other = [...INPUT.slice(0, 3), rec(150, pkt('lapData', 10, 94, 8n))];
    expect((await cutRecords(stream(other), { fromS: 10, toS: 11 })).contextPackets).toBe(0);
  });
  it('re-enters the window after a flashback (session time going back)', async () => {
    const fb = [rec(0, pkt('lapData', 10, 1)), rec(10, pkt('lapData', 12, 2)), rec(20, pkt('lapData', 10.5, 3))];
    expect((await cutRecords(stream(fb), { fromS: 10, toS: 11 })).records.map((x) => x.t)).toEqual([0, 20]);
  });
  it('an empty window yields no records and duration 0', async () => {
    expect(await cutRecords(stream(INPUT), { fromS: 50, toS: 60 })).toEqual({ records: [], firstT: undefined, contextPackets: 0, durationMs: 0 });
  });
});
```

```ts
// apps/bridge/test/pwrec/segments.test.ts — committed segments, no full recordings needed
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decode, type Packet } from '@pitwall/protocol';
import { drain } from './helpers.ts';

const SEG = join(import.meta.dirname, '../../../../fixtures/segments');
async function load(file: string) {
  const { records, summary } = await drain(join(SEG, file));
  const packets = records.map((r) => { const d = decode(r.payload); if (!d.ok) throw new Error(JSON.stringify(d.error)); return d.packet; });
  const codes: Record<string, number> = {};
  for (const p of packets) if (p.packetId === 3) codes[p.details.code] = (codes[p.details.code] ?? 0) + 1;
  return { records, summary, packets, codes };
}
const ids = (ps: Packet[]) => ps.map((p) => p.packetId);

describe('committed segments', () => {
  it('tt-zandvoort-lap1: context first, end of lap 1 with FTLP 71.910 s', async () => {
    const s = await load('tt-zandvoort-lap1.pwrec.gz');
    expect(s.records).toHaveLength(2144);
    expect(ids(s.packets.slice(0, 2))).toEqual([1, 4]);
    expect(s.packets[0]!.header.frameIdentifier).toBe(s.packets[2]!.header.frameIdentifier);
    expect(s.codes).toEqual({ FTLP: 1, SPTP: 1, BUTN: 3 });
    const ftlp = s.packets.find((p) => p.packetId === 3 && p.details.code === 'FTLP');
    expect(ftlp).toMatchObject({ details: { vehicleIdx: 0 } });
    expect((ftlp as { details: { lapTime: number } }).details.lapTime).toBeCloseTo(71.91, 3);
    const laps = new Set(s.packets.flatMap((p) => (p.packetId === 2 ? [p.lapData[0]!.currentLapNum] : [])));
    expect([...laps]).toEqual([1, 2]);
    expect(s.summary).toMatchObject({ endedCleanly: true, meta: { startedAt: '2026-10-27T22:33:35.674Z',
      cut: { source: '2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz', fromS: 112, toS: 118, contextPackets: 2 } } });
    expect(s.summary.durationMs).toBeCloseTo(5979.381, 2);
  });
  it('race-singapore-start: start lights and lights out, session opened by a later Session packet', async () => {
    const s = await load('race-singapore-start.pwrec.gz');
    expect(s.records).toHaveLength(2169);
    expect(s.packets[0]!.packetId).toBe(3);
    expect(s.codes).toEqual({ BUTN: 8, SSTA: 1, STLG: 5, LGOT: 1 });
    expect(s.summary).toMatchObject({ endedCleanly: true, meta: { startedAt: '2026-10-27T23:15:04.898Z', cut: { fromS: 0, toS: 0.5, contextPackets: 0 } } });
    expect(s.summary.durationMs).toBeCloseTo(8750.935, 2);
  });
  it('race-singapore-end: 20 UID-0 SessionHistory packets (cars 0-19) arrive before SEND', async () => {
    const s = await load('race-singapore-end.pwrec.gz');
    expect(s.records).toHaveLength(696);
    expect(s.codes).toEqual({ BUTN: 18, COLL: 1, SEND: 1 });
    const uid0 = s.packets.flatMap((p, i) => (p.header.sessionUid === 0n ? [{ p, i }] : []));
    expect(uid0.map(({ p }) => (p.packetId === 11 ? p.carIdx : -1))).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const send = s.packets.findIndex((p) => p.packetId === 3 && p.details.code === 'SEND');
    expect(uid0.every(({ i }) => i < send)).toBe(true);
    expect(s.summary).toMatchObject({ endedCleanly: true, meta: { startedAt: '2026-10-27T23:16:14.670Z', cut: { fromS: 61.5, toS: 63.4, contextPackets: 2 } } });
    expect(s.summary.durationMs).toBeCloseTo(3265.341, 2);
  });
});
```

```ts
// apps/bridge/test/cli/pwrec-cut.test.ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { main } from '../../src/cli/pwrec-cut.ts';
import { drain } from '../pwrec/helpers.ts';

const SEG = join(import.meta.dirname, '../../../../fixtures/segments');
const CLI = join(import.meta.dirname, '../../src/cli/pwrec-cut.ts');
const tmp = () => mkdtempSync(join(tmpdir(), 'pwrec-cut-'));
async function run(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const USAGE = 'usage: pwrec-cut <in.pwrec.gz> <out.pwrec.gz> --from <sessionTimeS> --to <sessionTimeS>';

describe('pwrec-cut CLI', () => {
  it('rejects bad arguments with usage and exit 1', async () => {
    expect(await run([])).toMatchObject({ code: 1, err: expect.stringContaining(USAGE) });
    expect(await run(['a', 'b', '--from', 'x', '--to', '2'])).toMatchObject({ code: 1, err: expect.stringContaining(USAGE) });
    expect(await run(['a', 'b', '--from', '5', '--to', '2'])).toMatchObject({ code: 1, err: expect.stringContaining('pwrec-cut: --from 5 is after --to 2') });
  });
  it('refuses to overwrite and reports an empty window', async () => {
    const out = join(tmp(), 'o.pwrec.gz'); writeFileSync(out, '');
    expect(await run([join(SEG, 'race-singapore-end.pwrec.gz'), out, '--from', '61.5', '--to', '62'])).toMatchObject({ code: 1, err: expect.stringContaining('already exists') });
    expect(await run([join(SEG, 'race-singapore-end.pwrec.gz'), join(tmp(), 'e.pwrec.gz'), '--from', '100', '--to', '200']))
      .toMatchObject({ code: 1, err: 'pwrec-cut: no records with sessionTime in [100, 200] s' });
  });
  it('cuts a segment of a segment with a clean end marker', async () => {
    const out = join(tmp(), 'sub.pwrec.gz');
    const r = await run([join(SEG, 'race-singapore-end.pwrec.gz'), out, '--from', '62', '--to', '62.5']);
    expect(r.code).toBe(0); expect(r.out).toMatch(/^wrote .*sub\.pwrec\.gz: \d+ records \(2 context\), [\d.]+ ms$/);
    const { records, summary } = await drain(out);
    expect(records[0]!.t).toBe(0); expect(summary.endedCleanly).toBe(true); expect(summary.durationMs).toBe(records.at(-1)!.t);
  });
  it('runs as a script', () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    expect(r.status).toBe(1); expect(r.stderr).toContain(USAGE);
  });
});

const SEGMENTS = [
  ['ttZandvoort', 'tt-zandvoort-lap1.pwrec.gz', '112', '118'],
  ['raceSingapore', 'race-singapore-start.pwrec.gz', '0', '0.5'],
  ['raceSingapore', 'race-singapore-end.pwrec.gz', '61.5', '63.4'],
] as const;
for (const [fixture, file, from, to] of SEGMENTS) {
  describeWithFixture(fixture, `re-cutting ${file}`, (path) => {
    it('reproduces the committed segment record for record', async () => {
      const out = join(tmp(), file);
      expect((await run([path, out, '--from', from, '--to', to])).code).toBe(0);
      expect(await drain(out)).toEqual(await drain(join(SEG, file)));
    }, 120_000);
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run apps/bridge/test/pwrec/cut.test.ts apps/bridge/test/pwrec/segments.test.ts apps/bridge/test/cli/pwrec-cut.test.ts`
Expected: FAIL (`cut.ts`, `cli/pwrec-cut.ts` and the segment files missing)

- [ ] **Step 3: Implement `cutRecords` in `apps/bridge/src/pwrec/cut.ts` and `main` in `apps/bridge/src/cli/pwrec-cut.ts`** (implementation agent; must not edit test files)

Follow the cut rules above. Hold the context in a `Map<packetId, payload>`, overwritten until the first in-window record. Emit it on the first in-window record whose `sessionUid` matches. Keep only window records in memory. `main` uses `parseArgs({ args, allowPositionals: true, strict: true, options: { from: { type: 'string' }, to: { type: 'string' } } })`, and on a parse error prints the usage. It feeds `readPwrec(in)` into `cutRecords`, then writes. Run directly when `process.argv[1] === fileURLToPath(import.meta.url)`: `process.exitCode = await main(process.argv.slice(2))` with `console.log`/`console.error` as io.

- [ ] **Step 4: Generate the segments, then run tests to verify they pass**

```bash
R=${PITWALL_FIXTURES_DIR:-recordings}
node apps/bridge/src/cli/pwrec-cut.ts $R/2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz fixtures/segments/tt-zandvoort-lap1.pwrec.gz --from 112 --to 118
node apps/bridge/src/cli/pwrec-cut.ts $R/2026-10-28_00-15-04_b3cd07e2790bdcbe.pwrec.gz fixtures/segments/race-singapore-start.pwrec.gz --from 0 --to 0.5
node apps/bridge/src/cli/pwrec-cut.ts $R/2026-10-28_00-15-04_b3cd07e2790bdcbe.pwrec.gz fixtures/segments/race-singapore-end.pwrec.gz --from 61.5 --to 63.4
```

Expected output: `… 2144 records (2 context)`, `… 2169 records (0 context)`, `… 696 records (2 context)`. Add `fixtures/index.json` `"segments"` entries `{ file, source, fromS, toS, records, features }` with the table's values.
Run: same as Step 2. Expected: PASS (including the three re-cut suites when `recordings/` is present).

- [ ] **Step 5: Commit**

```bash
git add apps/bridge/src/pwrec/cut.ts apps/bridge/src/cli/pwrec-cut.ts apps/bridge/test/pwrec/cut.test.ts apps/bridge/test/pwrec/segments.test.ts \
  apps/bridge/test/cli/pwrec-cut.test.ts fixtures/segments fixtures/index.json
git commit -F - <<'EOF'
feat(bridge): pwrec-cut tool and committed TT/race fixture segments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 30: Acceptance: fixture facts, determinism, quality gates

**Files:**
- Test: `apps/bridge/test/acceptance/replay-topics.ts` (helper), `apps/bridge/test/acceptance/fixture-facts.acceptance.test.ts`, `apps/bridge/test/acceptance/determinism.acceptance.test.ts`, `apps/bridge/test/acceptance/reprocess.acceptance.test.ts`
- Create: `docs/acceptance/live-checklist.md` (manual acceptance criteria 2 and 4)

**Interfaces:**
- Consumes: `FeedPipeline`, `createLogger`, `topicStreamHash` (Task 27); `PwrecSource` (Task 8); `TopicHub` (Task 24); `FEATURES` (Tasks 20, 23); `ServerMessage`, `TopicName`, `CarOverview` (Task 21); `feedId`, `LapRecord`, `RaceEvent` (Task 9); `trackFixture` (Task 11, `apps/bridge/test/fixtures/replay.ts`); `runCli` (Task 28, `apps/bridge/test/helpers/cli.ts`); `dataDir` (Task 26); `describeWithFixture`, `fixturePath`, `FIXTURES`, `FixtureName`, the `test:acceptance` script and `vitest.acceptance.config.ts` (Task 1).
- Produces (new, test helper): `replayTopics(path: string, subs: ReadonlyArray<readonly [id: string, topic: TopicName, params: object]>): Promise<{ value(id: string): unknown; entries(id: string): unknown[]; errored: string[] }>`.

These suites run full recordings through the real pipeline, so they live in the separate acceptance config (`*.acceptance.test.ts`, 600 s timeout, files in sequence) and stay out of `pnpm test`. Engine-level facts are already pinned in Tasks 11, 15, 16 and 18. Here they are checked where the user sees them: on the topics.

- [ ] **Step 1: Write the acceptance tests** (test agent)

```ts
// apps/bridge/test/acceptance/replay-topics.ts — real pipeline, in-memory client; last value per state topic, all entries per append topic
import type { ServerMessage, TopicName } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';

export async function replayTopics(path: string, subs: ReadonlyArray<readonly [id: string, topic: TopicName, params: object]>) {
  const F = feedId('acceptance');
  let now = 0; const hub = new TopicHub({ now: () => (now += 1000) });     // every publish is due → nothing throttled away
  const values = new Map<string, unknown>(), lists = new Map<string, unknown[]>(), errored: string[] = [];
  const send = (m: ServerMessage) => {
    if (m.type === 'snapshot') { if (m.entries) lists.set(m.id, [...m.entries]); else values.set(m.id, m.value); }
    else if (m.type === 'update') values.set(m.id, m.value);
    else if (m.type === 'append') { const l = lists.get(m.id) ?? []; for (const e of m.entries) l.push(e); lists.set(m.id, l); }
    else if (m.type === 'topicStatus' && m.status === 'errored') errored.push(m.id);
  };
  hub.addClient('acceptance', { send, bufferedAmount: () => 0 });
  for (const [id, topic, params] of subs) hub.subscribe({ clientId: 'acceptance', id, topic, params, feedId: F });
  const pipeline = new FeedPipeline({ feedId: F, source: new PwrecSource({ feedId: F, path, mode: 'asFastAsPossible' }), hub, features: FEATURES, log: createLogger({ level: 'silent' }) });
  pipeline.start(); await pipeline.done; hub.tick();
  return { value: (id: string) => values.get(id), entries: (id: string) => lists.get(id) ?? [], errored };
}
```

```ts
// apps/bridge/test/acceptance/fixture-facts.acceptance.test.ts — spec 10.2 fixture facts, acceptance criterion 1
import { expect, it } from 'vitest';
import type { CarOverview } from '@pitwall/contracts';
import type { LapRecord, RaceEvent } from '@pitwall/domain';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { trackFixture } from '../fixtures/replay.ts';
import { replayTopics } from './replay-topics.ts';

const SUBS = [['info', 'session.info', {}], ['overview', 'cars.overview', {}], ['laps', 'laps', {}], ['events', 'events', {}],
  ['insights', 'insights', {}], ['feed', 'feed.status', {}]] as const;
type Replay = Awaited<ReturnType<typeof replayTopics>>;
const activeCars = (r: Replay) => (r.value('overview') as CarOverview[]).filter((c) => c.timing.resultStatus !== 'invalid' && c.timing.resultStatus !== 'inactive');
const latestLaps = (r: Replay) => [...new Map((r.entries('laps') as LapRecord[]).map((l) => [`${l.carId}:${l.lapNumber}`, l])).values()];
const kinds = (r: Replay) => (r.entries('events') as RaceEvent[]).reduce<Record<string, number>>((n, e) => ({ ...n, [e.kind]: (n[e.kind] ?? 0) + 1 }), {});
function expectCleanRun(r: Replay) {
  expect(r.errored).toEqual([]);
  expect(JSON.stringify(r.entries('insights'))).not.toContain('calculatorError');
  expect(r.value('feed')).toMatchObject({ decodeErrors: 0 });
}

describeWithFixture('ttZandvoort', 'acceptance: TT Zandvoort', (path) => {
  it('one car, 15 confirmed laps with the recorded times, lap 16 unfinished, no fuel use, FTLP x4', async () => {
    const r = await replayTopics(path, SUBS);
    expectCleanRun(r);
    expect(r.value('info')).toMatchObject({ sessionUid: '1895827638050388100', playerCar: 0, session: { trackId: 26, sessionType: 18, numActiveCars: 1 } });
    expect(activeCars(r).map((c) => c.id)).toEqual([0]);
    const laps = latestLaps(r).filter((l) => l.carId === 0 && l.status === 'confirmed').sort((a, b) => a.lapNumber - b.lapNumber);
    expect(laps.map((l) => l.lapNumber)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect([laps[0]!.lapTimeMs, laps[3]!.lapTimeMs, laps[8]!.lapTimeMs]).toEqual([71_910, 71_081, 73_253]);
    for (const l of laps) {
      expect(Math.abs(l.sectorTimesMs[0] + l.sectorTimesMs[1] + l.sectorTimesMs[2] - l.lapTimeMs), `lap ${l.lapNumber}`).toBeLessThanOrEqual(2);
      expect([l.fuelAtStartKg, l.fuelAtEndKg]).toMatchObject([{ known: true, value: 10 }, { known: true, value: 10 }]);
    }
    expect(latestLaps(r).some((l) => l.lapNumber === 16)).toBe(false);
    expect(kinds(r)).toMatchObject({ fastestLap: 4 });
  });
});

describeWithFixture('raceSingapore', 'acceptance: race Singapore', (path) => {
  it('20 cars, the only human at index 19, start lights and race events, no lap completed', async () => {
    const r = await replayTopics(path, SUBS);
    expectCleanRun(r);
    expect(r.value('info')).toMatchObject({ sessionUid: '12956020372289608894', playerCar: 19, session: { trackId: 12, sessionType: 15, numActiveCars: 20 } });
    expect(activeCars(r)).toHaveLength(20);
    expect(activeCars(r).filter((c) => !c.identity.ai).map((c) => c.id)).toEqual([19]);
    expect(kinds(r)).toMatchObject({ startLights: 5, lightsOut: 1, overtake: 39, collision: 4, penalty: 6 });
    expect(r.entries('laps')).toEqual([]);
  });
  it('the final UID-0 SessionHistory bulk (sent just before SEND) belongs to the session', async () => {
    const { events, metrics } = await trackFixture('raceSingapore');
    const uid0 = events.flatMap((e) => (e.type === 'frame' ? e.frame.sessionHistory : [])).filter((p) => p.header.sessionUid === 0n);
    expect(uid0.map((p) => p.carIdx).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(metrics.droppedUid0).toBe(0);
    expect(events.filter((e) => e.type === 'sessionStarted')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'sessionEnded', reason: 'SEND' });
  });
});

describeWithFixture('menuOnly', 'acceptance: menu-only recording', (path) => {
  it('opens no session: every packet dropped, no topic values', async () => {
    const { events, metrics } = await trackFixture('menuOnly');
    expect(events).toEqual([]);
    expect(metrics.droppedBeforeSession + metrics.droppedUid0).toBe(385);
    const r = await replayTopics(path, SUBS);
    expect(r.value('info')).toBeUndefined();
    expect([r.entries('laps'), r.entries('events')]).toEqual([[], []]);
  });
});
```

```ts
// apps/bridge/test/acceptance/determinism.acceptance.test.ts — spec 3.4 / 10.2, acceptance criterion 3
import { expect, it } from 'vitest';
import { describeWithFixture, FIXTURES, type FixtureName } from '../../../../test-support/fixtures.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';

const hashes = new Map<FixtureName, string>();
for (const name of Object.keys(FIXTURES) as FixtureName[]) {
  describeWithFixture(name, `determinism: ${name}`, (path) => {
    it('replaying twice gives an identical topic stream', async () => {
      const a = await topicStreamHash(path);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(await topicStreamHash(path)).toBe(a);
      hashes.set(name, a);
    });
  });
}
it('different recordings give different streams (the hash is not constant)', () => {
  expect(new Set(hashes.values()).size).toBe(hashes.size);
});
```

```ts
// apps/bridge/test/acceptance/reprocess.acceptance.test.ts — spec 9.4, acceptance criterion 5
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../../../../test-support/fixtures.ts';
import { dataDir } from '../../src/storage/data-dir.ts';
import { runCli } from '../helpers/cli.ts';

const files = (['menuOnly', 'ttZandvoort', 'raceSingapore'] as const).map((n) => fixturePath(n));   // file-name order = reprocess order
function dumpDb(dir: string) {
  const db = new Database(dataDir({ PITWALL_DATA_DIR: dir }).dbPath, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all() as string[];
  const dump = { userVersion: db.pragma('user_version', { simple: true }),
    tables: Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])) as Record<string, unknown[]> };
  db.close();
  return dump;
}

describe.skipIf(files.some((f) => f === undefined))('acceptance: pitwall import + reprocess', () => {
  it('reprocess rebuilds the database identically, twice', async () => {
    const env = { PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'pitwall-acc-')) };
    for (const f of files) expect(await runCli(['import', f!], env)).toMatchObject({ code: 0 });
    const imported = dumpDb(env.PITWALL_DATA_DIR);
    expect(imported.tables['sessions']).toHaveLength(2);                 // menuOnly opens no session
    expect(imported.tables['laps']).toHaveLength(15);                    // TT confirmed laps; Singapore completed none
    expect(await runCli(['reprocess'], env)).toMatchObject({ code: 0, stdout: expect.stringContaining('reprocessed 3 recordings') });
    const first = dumpDb(env.PITWALL_DATA_DIR);
    expect((await runCli(['reprocess'], env)).code).toBe(0);
    expect(first).toEqual(imported);
    expect(dumpDb(env.PITWALL_DATA_DIR)).toEqual(first);
  });
});
```

- [ ] **Step 2: Run the acceptance suite**

Run: `pnpm gen:features && pnpm test:acceptance`
Expected: PASS. Any failure is a bug in an earlier task. Fix it in that task's scope, with the failing fact as a new unit test there; never by loosening these tests.

- [ ] **Step 3: Write `docs/acceptance/live-checklist.md`** (manual; needs a driver with the game)

Sections and exact steps:
1. **Setup.**
   - The laptop's IP: `tailscale ip -4`.
   - Fedora firewall: `sudo firewall-cmd --add-port=20777/udp --zone=$(firewall-cmd --get-zone-of-interface=tailscale0)`.
   - Game: UDP Telemetry On, Broadcast Off, IP = the Tailscale IP, port 20777, send rate 60 Hz, format 2025.
   - `pnpm pitwall live` prints `listening ws://127.0.0.1:4777`.
2. **Criterion 2: rates.** While the driver is on track, run `timeout 10 pnpm -s pitwall tap <topic> [--carId <player>] | wc -l` for each topic, and record the count. Expected (hello and snapshot add 2):

   | topic | lines |
   |---|---|
   | `feed.status` | 15–22 |
   | `session.info` | 2–22 |
   | `cars.overview` | 80–102 |
   | `car.detail` | 250–302 |
   | `car.telemetry` | 500–602 |

   For the append topics:
   - `laps`: a provisional entry within 1 s of crossing the line, then a confirmed one.
   - `pitStops` / `stints`: after a pit stop with a tyre change.
   - `events`: e.g. speed trap.
   - `insights`: pausing the game for more than 2 s raises `feed.stale` and resuming resolves it.
   - Every line must parse as JSON. `feed.status` must show `connected: true` and `lossPercent` < 5.
3. **Criterion 4: flashback.**
   - Practice session: 2 clean laps, then crash in lap 3 and flash back about 5 s.
   - Expected on `tap insights`: `session.flashback` with `targetLap: 3` and `rewoundS` ≈ 5.
   - Expected on `tap laps`: no entry for a lap that was undone, and lap numbers never decrease.
   - Afterwards, `pnpm pitwall replay <~/.local/share/pitwall/recordings/<session file>>`. A `tap laps` on the replay must equal the live capture after dropping the `hello` line: `diff <(tail -n +2 live.jsonl) <(tail -n +2 replay.jsonl)`.
4. **Keep the recording.**
   - Copy the session file into `recordings/` and request `FIXTURES.practiceFlashback` and a `fixtures/index.json` entry from the supervisor.
   - Find the FLBK `sessionTime` via `tap events`, then cut a ±5 s segment with `pnpm pwrec-cut … --from <t-5> --to <t+5>` into `fixtures/segments/practice-flashback.pwrec.gz`. This is spec 12, recording 3.

- [ ] **Step 4: Run all quality gates (spec 10.3, acceptance criterion 6)**

Run: `pnpm check && pnpm mutation`
Expected:
- `tsc`, ESLint and dependency-cruiser are clean, and all Vitest projects pass.
- For `@pitwall/protocol` and `@pitwall/engine`, Stryker prints a final mutation score ≥ 80 and exits 0. A score below the break threshold of 80 exits 1.
- `@pitwall/strategy` reports "No tests were found" (`allowEmpty`, until sub-project 4).
- Survivors listed in `packages/*/reports/mutation/index.html` are killed by adding tests in the owning task's scope.

- [ ] **Step 5: Commit, then run the live checklist with the driver**

```bash
git add apps/bridge/test/acceptance docs/acceptance/live-checklist.md
git commit -F - <<'EOF'
test(bridge): acceptance suite for fixture facts, determinism and reprocess; live checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Record the live results (date, counts per topic, flashback outcome) at the end of `docs/acceptance/live-checklist.md`, in a second commit `docs: live acceptance results <date>`.
