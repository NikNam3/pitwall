# Pitwall

## What

Pitwall is a read-only race-engineer panel for F1 25 (TypeScript pnpm monorepo).
Spec: `docs/superpowers/specs/2026-10-28-foundation-design.md`. Plan: `docs/superpowers/plans/2026-10-28-foundation.md`.

## Map

- `packages/protocol`: bytes to typed packets (spec 2025 only)
- `packages/domain`: JSON-safe domain vocabulary (`Known`, `Corners`, `CarState`, records, ids); leaf package
- `packages/engine`: pure race model (no I/O, no clock, no network)
- `packages/analysis`: the analyses (calculators, one folder per unit); `src/shared/` holds helpers shared by analyses (e.g. current-stint laps, penalty classes)
- `packages/contracts`: topic types and WebSocket messages shared by bridge and UI
- `apps/bridge`: imperative shell (input, frame assembler, engine runner, storage, WebSocket, CLI)
- `apps/ui`: Svelte UI: kit, shell, widgets, connection, theme, emphasis, gallery
- `apps/bridge/src/ui-state/default-workbooks/`: default workbooks `car`, `quali`, `race`; seeded into `PITWALL_DATA_DIR/ui/workbooks/` when missing, never overwritten
- `apps/desktop`: Electron host for the UI (imports nothing from the workspace)
- `test-support/`: fixtures helper; `fixtures/`: committed `.pwrec` segments and `index.json`

Dependency direction (enforced by dependency-cruiser): `protocol` and `domain` import nothing; `contracts` imports `domain`; `engine` imports `protocol`, `domain`; `analysis` imports `engine`, `domain`; `bridge` imports all packages; `ui` imports `contracts`, `domain` only. Details: `docs/architecture.md`.

## Commands

- `pnpm check`: typecheck, lint, depcruise and tests; run it before every commit
- `pnpm test` / `pnpm test:acceptance`: unit and property tests / acceptance tests on real recordings
- `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`
- `pnpm mutation`: Stryker on protocol, engine, analysis and the UI logic (score of at least 80 %); runs once at the MVP end, not per sub-project
- `pnpm gen`: regenerate the gitignored generated files: `gen:features` (`apps/bridge/src/features/index.generated.ts`), `gen:topics` (`packages/contracts/src/topics/index.generated.ts`), `gen:widgets` (`apps/ui/src/widgets/index.generated.ts`) and `gen:catalogue` (the unit catalogue); `pnpm gen:moments` is separate
- `pnpm test:ui`: the Playwright suite for the UI. Screenshots: one baseline per display size of the display's first gallery case, default theme (plus kit and shell cells); `SCREENSHOT_BUDGET` (`apps/ui/test/gallery/screenshot-budget.test.ts`) caps the total. The gallery still renders every case and theme, and `fit.spec` checks them all
- `pnpm desktop` / `pnpm desktop:dev`: the Electron panel (starts or attaches to the bridge)
- `pitwall live|replay|tap|reprocess|import`: the bridge CLI; `pitwall dev --replay <file> [--at-lap n]` restarts the replay on source changes; `pitwall where <unit|--topic name>` lists a unit's files
- `pwrec-cut <in> <out> --from <sessionTime> --to <sessionTime>`: cut a fixture segment

## Rules

- Units in engine and contracts: time integer ms, distance m, speed km/h, temperature °C, pressure psi, fuel kg, energy J, angle rad.
- Missing data is `Known` (`unknown(reason)`), never 0.
- No `enum`, namespaces or parameter properties (Node type stripping); use `as const` objects.
- Relative imports end in `.ts`.
- The engine and analysis are pure: no clock (`Date`, `performance`), no `Math.random`, no I/O.
- Expected problems are values (`DecodeResult`, `Known`, `topicStatus`); exceptions are bugs.
- Registration by convention: a feature is a folder `apps/bridge/src/features/<name>/register.ts`; no central lists.
- Ports and paths come from env: `PITWALL_WS_PORT`, `PITWALL_UDP_PORT`, `PITWALL_UI_PORT`, `PITWALL_DATA_DIR`, `PITWALL_FIXTURES_DIR`.
- Only `packetFormat === 2025`. Wheel order in protocol stays RL, RR, FL, FR; it becomes `Corners` once, in the engine.
- Tests on real data use short segments (`fixtures/segments/`, at most 1 MB, except at most three full-lap segments of about 8 MB; cut from normal sessions with `pwrec-cut`), each targeting one behaviour of our code. Whole recordings only serve whole-pipeline properties in the acceptance suite (determinism, reprocess, decoder equality and speed). Never test facts of a recording ("15 laps", "fuel stays 10 kg"); the time trial is no test fixture. Guide: `docs/testing.md`.
- Goals, highest first: clean code, extendable code, clean UI, intuitive UX, realism, findability, performance.

## Workflow

Each task has two phases, done by two separate agents: a test agent writes the failing tests and commits them, then an implementation agent makes them pass without touching the tests. Task briefs follow `docs/tasks/_template.md`.

- Use one git worktree per task under `../pitwall-wt/<task>`, then run `pnpm install` in it.
- `recordings/` is gitignored and missing in worktrees: set `PITWALL_FIXTURES_DIR=<main checkout>/recordings` when running tests.
- Start a worker from its worktree as `PITWALL_PHASE=<test|implement> PITWALL_WORKER_SCOPE=<folders> claude`. `PITWALL_WORKER_SCOPE` is a colon-separated list of repo-relative folders the worker may write; `PITWALL_PHASE=implement` makes test files read-only.
- Hooks in `.claude/hooks/` enforce this: `guard-scope.sh` and `guard-tests.sh` block writes, `typecheck.sh` typechecks the touched package after each edit.
- Limit: the guards only see the Edit, Write, MultiEdit and NotebookEdit tools. A write through Bash bypasses them. The env vars are per process, so in-process subagents inherit the supervisor's environment. Hook-enforced workers must therefore be separate `claude` processes started in their worktree with the env set.
- After every implement phase the supervisor checks that `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support` is empty.
- Units: an analysis (shared calculation) or a display (one widget) is a unit with a kebab-case name, e.g. `undercut-card`. `PITWALL_WORKER_UNIT=<name>` additionally grants `apps/ui/src/widgets/<name>/`, `apps/bridge/src/features/<name>/`, `apps/bridge/test/features/<name>/`, `packages/analysis/src/<name>/`, `packages/analysis/test/<name>/` and `packages/contracts/src/topics/<camelName>.*.ts`. One agent per unit; analyses are built before the displays that read them (ADR 0011). In the implement phase, a widget's `gallery.ts` is read-only like a test.
- Displays render, analyses compute; anything two parallel workers would share is built first (ADR 0014).
- Supervisor-owned files: `packages/domain/**`, `packages/contracts/**` (except a unit's own topic files), the UI kit, shell, connection, theme and emphasis (`apps/ui/src/{kit,shell,connection,theme,emphasis}/**`), every `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/engine/src/state/**`, root configs. Workers never edit them; they list the change (file, exact change, why) under "Requested changes to supervisor-owned files" in their report.

## Git

Claude manages git: workers commit on their own branches; supervisor may merge to main and push without asking; never force-push main

- Conventional commits: `feat(protocol): ...`, `test(engine): ...`, `docs: ...`, `build: ...`.
- Commit after every task. End every commit message with a blank line and a `Co-Authored-By: <model name> <noreply@anthropic.com>` trailer.

## Where to look

- `docs/superpowers/specs/2026-10-29-timing-car-monitoring-design.md`: sub-project 3 spec; dependency graph of its units: `docs/superpowers/specs/2026-10-29-timing-car-monitoring/dependency-graph.html`; run rulings: `docs/superpowers/notes/2026-10-29-sp3-run-rulings.md`
- `docs/testing.md`: how to write tests and plan validation (layers, segments, properties, gates, a sub-project's test plan)
- `docs/architecture.md`: packages, data flow, UI structure, determinism, parallel development, where state lives
- `docs/research/`: race-engineering research (real practice, ATLAS, TUM strategy model, F1 25 data mapping, control boundary)
- `docs/decisions/`: ADRs (stack, fixtures, domain package, SQLite library, feature registry, GPL code and data allowed, one file per topic, calculator config, second car later, Electron host, analyses and displays, widget registry, UI state in the bridge, displays render and analyses compute)
- `docs/tasks/_template.md`: the task-brief and report format
- `~/dev/personal/pitwall-recorder/FORMAT.md`: the `.pwrec` file format
- `external/`: the F1 25 UDP structs (`F1 25 Telemetry Output Structures.txt`), the data-output PDF and the TUM race-simulation paper (gitignored)
