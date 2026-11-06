# Pitwall

## What

Pitwall is a read-only race-engineer panel for F1 25 (TypeScript pnpm monorepo).

**The architecture is the contract, `docs/architecture.md`, imported below. Every change follows it (C0): a task that needs a different contract stops and reports a contract gap; never invent a local rule.** Reasons per clause: `docs/decisions/0015-the-pitwall-contract.md`.

## What to read

Besides this file and the contract (both always loaded):

| You work on | Read |
|---|---|
| a sub-machine (`packages/engine/src/situations/<name>/`) | `docs/research/10-situations-catalogue.md`, `docs/research/09-situations-inventory.md`, `docs/research/04-f1-25-data-mapping.md` |
| the adapter (protocol, frame assembly, step 0/1) | `docs/research/04-f1-25-data-mapping.md`, `external/F1 25 Telemetry Output Structures.txt` |
| an analysis or calculator | the unit's section of its product spec in `docs/specs/`; for strategy `docs/research/03-strategy-models.md`, `06-engineer-decisions.md`, `07-strategy-literature.md` |
| a display or the shell | `docs/design/<sub-project>/` (approved mockups), the unit's section in `docs/specs/` |
| tests | `docs/testing.md` |
| a brief or a plan (supervisor) | `docs/tasks/_template.md`, the current spec or plan in `docs/superpowers/` |
| why a clause exists | `docs/decisions/` (ADRs) |
| **never, unless your brief names a file there** | `docs/history/` (done, superseded or void: old specs, plans, run notes) |

Other docs: `docs/research/README.md` (index of the domain research), `docs/acceptance/` (the user's live checklists), `~/dev/personal/pitwall-recorder/FORMAT.md` (the `.pwrec` format).

## Map

- `packages/protocol`: bytes to typed packets (F1 25 only)
- `packages/domain`: the shared vocabulary: `Known`, ids, units, live state, fact and span types; leaf package
- `packages/engine`: frame assembly, the four steps (`situations/` is the machine), the log and projection, the scheduler, the runner; pure
- `packages/analysis`: calculators, analyses, simulators, one folder per unit; `src/shared/` holds pure helpers shared by units
- `packages/contracts`: topic types and WebSocket messages shared by bridge and UI
- `apps/bridge`: the imperative shell (input, runner, storage, priors store, jobs, hub, CLI); default workbooks in `src/ui-state/default-workbooks/`, seeded into `PITWALL_DATA_DIR/ui/workbooks/` when missing, never overwritten
- `apps/ui`: Svelte UI: kit, theme, emphasis, shell, connection, widgets, gallery
- `apps/desktop`: Electron host (imports nothing from the workspace)
- `test-support/`: fixtures helper and builders; `fixtures/`: committed `.pwrec` segments and `index.json`
- `external/`: the F1 25 UDP structs, the data-output PDF, research papers (gitignored)

## Commands

- `pnpm check`: typecheck, lint, depcruise and tests; the supervisor runs it before every merge (C88), except of a minor change, which runs its related tests (C82)
- `pnpm vitest related <files>`: the tests a worker runs for its changes, with `pnpm typecheck`, `pnpm lint`, `pnpm depcruise`
- `pnpm test` / `pnpm test:acceptance`: unit and property tests / acceptance tests on real recordings
- `pnpm test:ui`: the Playwright suite. Screenshots: one baseline per display size of the display's first gallery case, default theme (plus kit and shell cells); `SCREENSHOT_BUDGET` (`apps/ui/test/gallery/screenshot-budget.test.ts`) caps the total; `fit.spec` checks every case and theme
- `pnpm mutation`: Stryker on protocol, engine, analysis and the UI logic (at least 80 %); once at the MVP end
- `pnpm gen`: regenerate the gitignored generated files: `gen:features`, `gen:topics`, `gen:widgets`, `gen:catalogue`; `pnpm gen:moments` is separate
- `pnpm desktop` / `pnpm desktop:dev`: the Electron panel (starts or attaches to the bridge)
- `pitwall live|replay|tap|reprocess|import`: the bridge CLI; `pitwall dev --replay <file> [--at-lap n]` restarts the replay on source changes; `pitwall where <unit|--topic name>` lists a unit's files
- `pwrec-cut <in> <out> --from <sessionTime> --to <sessionTime>`: cut a fixture segment

## Code style

- No `enum`, namespaces or parameter properties (Node type stripping); use `as const` objects.
- Relative imports end in `.ts`.
- Goals, highest first: clean code, extendable code, clean UI, intuitive UX, realism, findability, performance.

## Workflow

Each task has two phases, done by two separate agents (C82): a test agent writes the failing tests and commits them, then an implementation agent makes them pass without touching the tests. Task briefs follow `docs/tasks/_template.md` and name the contract clauses they touch (C83).

- Use one git worktree per task under `../pitwall-wt/<task>`, then run `pnpm install` in it.
- `recordings/` is gitignored and missing in worktrees: set `PITWALL_FIXTURES_DIR=<main checkout>/recordings` when running tests.
- Start a worker from its worktree as `PITWALL_PHASE=<test|implement> PITWALL_WORKER_SCOPE=<folders> claude`. `PITWALL_WORKER_SCOPE` is a colon-separated list of repo-relative folders the worker may write; `PITWALL_PHASE=implement` makes test files read-only. `PITWALL_WORKER_UNIT=<name>` additionally grants a unit's folders (C80).
- Hooks in `.claude/hooks/` enforce this: `guard-scope.sh` and `guard-tests.sh` block writes, `typecheck.sh` typechecks the touched package after each edit.
- Limit: the guards only see the Edit, Write, MultiEdit and NotebookEdit tools. A write through Bash bypasses them. The env vars are per process, so in-process subagents inherit the supervisor's environment. Hook-enforced workers must therefore be separate `claude` processes started in their worktree with the env set.
- After every implement phase the supervisor checks that `git diff --stat <test-commit>..HEAD -- '*.test.ts' '**/test/**' test-support` is empty.
- Supervisor-owned files: C78. Workers never edit them; they list the change (file, exact change, why) under "Requested changes to supervisor-owned files" in their report. The supervisor may delegate one named change to one agent: the brief names the path and the change ("delegated").

## Git

Claude manages git: workers commit on their own branches; supervisor may merge to main and push without asking; never force-push main

- Conventional commits: `feat(protocol): ...`, `test(engine): ...`, `docs: ...`, `build: ...`.
- Commit after every task. End every commit message with a blank line and a `Co-Authored-By: <model name> <noreply@anthropic.com>` trailer.

## Reviews

The review after every task asks one question (C89): **did this change violate the contract?** If not, the review is clean. If yes, the reviewer cites the clause and decides: fixable within the contract (a finding, fixed before the next task) or a contract gap for the user (C0).

## The contract

@docs/architecture.md
