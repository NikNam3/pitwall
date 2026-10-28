# Pitwall

## What

Pitwall is a read-only race-engineer panel for F1 25 (TypeScript pnpm monorepo).
Spec: `docs/superpowers/specs/2026-10-28-foundation-design.md`. Plan: `docs/superpowers/plans/2026-10-28-foundation.md`.

## Map

- `packages/protocol`: bytes to typed packets (spec 2025 only)
- `packages/domain`: JSON-safe domain vocabulary (`Known`, `Corners`, `CarState`, records, ids); leaf package
- `packages/engine`: pure race model (no I/O, no clock, no network)
- `packages/strategy`: strategy calculators
- `packages/contracts`: topic types and WebSocket messages shared by bridge and UI
- `apps/bridge`: imperative shell (input, frame assembler, engine runner, storage, WebSocket, CLI)
- `apps/ui`: Svelte UI (sub-project 2)
- `test-support/`: fixtures helper; `fixtures/`: committed `.pwrec` segments and `index.json`

Dependency direction (enforced by dependency-cruiser): `protocol` and `domain` import nothing; `contracts` imports `domain`; `engine` imports `protocol`, `domain`; `strategy` imports `engine`, `domain`; `bridge` imports all packages; `ui` imports `contracts`, `domain` only. Details: `docs/architecture.md`.

## Commands

- `pnpm check`: typecheck, lint, depcruise and tests; run it before every commit
- `pnpm test` / `pnpm test:acceptance`: unit and property tests / acceptance tests on real recordings
- `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`
- `pnpm mutation`: Stryker on protocol, engine, strategy (score of at least 80 %)
- `pnpm gen:features`: regenerate the gitignored `apps/bridge/src/features/index.generated.ts`
- `pitwall live|replay|tap|reprocess|import`: the bridge CLI
- `pwrec-cut <in> <out> --from <sessionTime> --to <sessionTime>`: cut a fixture segment

## Rules

- Units in engine and contracts: time integer ms, distance m, speed km/h, temperature °C, pressure psi, fuel kg, energy J, angle rad.
- Missing data is `Known` (`unknown(reason)`), never 0.
- No `enum`, namespaces or parameter properties (Node type stripping); use `as const` objects.
- Relative imports end in `.ts`.
- The engine and strategy are pure: no clock (`Date`, `performance`), no `Math.random`, no I/O.
- Expected problems are values (`DecodeResult`, `Known`, `topicStatus`); exceptions are bugs.
- Registration by convention: a feature is a folder `apps/bridge/src/features/<name>/register.ts`; no central lists.
- Ports and paths come from env: `PITWALL_WS_PORT`, `PITWALL_UDP_PORT`, `PITWALL_UI_PORT`, `PITWALL_DATA_DIR`, `PITWALL_FIXTURES_DIR`.
- Only `packetFormat === 2025`. Wheel order in protocol stays RL, RR, FL, FR; it becomes `Corners` once, in the engine.
- Goals, highest first: clean code, extendable code, clean UI, intuitive UX, realism, findability, performance.

## Workflow

Each task has two phases, done by two separate agents: a test agent writes the failing tests and commits them, then an implementation agent makes them pass without touching the tests. Task briefs follow `docs/tasks/_template.md`.

- Use one git worktree per task under `../pitwall-wt/<task>`, then run `pnpm install` in it.
- `recordings/` is gitignored and missing in worktrees: set `PITWALL_FIXTURES_DIR=<main checkout>/recordings` when running tests.
- Start a worker from its worktree as `PITWALL_PHASE=<test|implement> PITWALL_WORKER_SCOPE=<folders> claude`. `PITWALL_WORKER_SCOPE` is a colon-separated list of repo-relative folders the worker may write; `PITWALL_PHASE=implement` makes test files read-only.
- Hooks in `.claude/hooks/` enforce this: `guard-scope.sh` and `guard-tests.sh` block writes, `typecheck.sh` typechecks the touched package after each edit.
- Limit: the guards only see the Edit, Write, MultiEdit and NotebookEdit tools. A write through Bash bypasses them. The env vars are per process, so in-process subagents inherit the supervisor's environment. Hook-enforced workers must therefore be separate `claude` processes started in their worktree with the env set.
- After every implement phase the supervisor checks that `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support` is empty.
- Supervisor-owned files: `packages/domain/**`, `packages/contracts/**`, every `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `packages/engine/src/state/**`, root configs. Workers never edit them; they list the change (file, exact change, why) under "Requested changes to supervisor-owned files" in their report.

## Git

Claude manages git: workers commit on their own branches; supervisor may merge to main and push without asking; never force-push main

- Conventional commits: `feat(protocol): ...`, `test(engine): ...`, `docs: ...`, `build: ...`.
- Commit after every task. End every commit message with a blank line and a `Co-Authored-By: <model name> <noreply@anthropic.com>` trailer.

## Where to look

- `docs/architecture.md`: packages, data flow, determinism, parallel development, where state lives
- `docs/decisions/`: ADRs (stack, fixtures, domain package, SQLite library, feature registry)
- `docs/tasks/_template.md`: the task-brief and report format
- `~/dev/personal/pitwall-recorder/FORMAT.md`: the `.pwrec` file format
- `external/`: the F1 25 UDP structs (`F1 25 Telemetry Output Structures.txt`), the data-output PDF and the TUM race-simulation paper (gitignored)
