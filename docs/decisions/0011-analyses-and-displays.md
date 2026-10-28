# 0011: Analyses and displays

## Status

Accepted (2026-10-28). UI shell spec 3.

## Context

Strategy displays and the calculations behind them are many-to-many: the rejoin projection feeds several widgets, and the timing tower reads several topics. Parallel agents need disjoint write areas, and the supervisor must not become the bottleneck for every new widget.

## Decision

- **Two kinds of unit, one name space.** A unit name is kebab-case and unique (`rejoin`, `undercut-card`).
  - An **analysis** is a shared calculation that publishes topics: `packages/strategy/src/<name>/` (pure maths), `apps/bridge/src/features/<name>/` (wiring) and its topic files.
  - A **display** is one widget, `apps/ui/src/widgets/<name>/`, plus optionally a bridge feature and a strategy folder of the same name and its topic files. A feature folder named like a widget is private to that display; every other feature folder is an analysis.
- **Topic owners.** `defineTopic` takes an `owner`: a unit name or `'core'`. The first segment of a topic name is the owner in camelCase (`undercut-card` owns `undercutCard.rows`). The foundation, `ui.*` and `dev.*` topics are owned by `core` and exempt. An analysis topic may be read by any widget; a display's private topic only by its own widget. `gen:catalogue` enforces both.
- **Write scopes.** `PITWALL_WORKER_UNIT=<name>` grants, on top of `PITWALL_WORKER_SCOPE`: `apps/ui/src/widgets/<name>/`, `apps/bridge/src/features/<name>/`, `apps/bridge/test/features/<name>/`, `packages/strategy/src/<name>/`, `packages/strategy/test/<name>/` and `packages/contracts/src/topics/<camelName>.*.ts` (one file directly in the folder; `guard-scope.sh` lets it through the `packages/contracts` block, every other contracts path stays blocked). In the implement phase a widget's `gallery.ts` is read-only like a test.
- **Supervisor-owned:** `packages/domain`, the rest of `packages/contracts`, the UI kit, shell, connection, theme and emphasis, and the files that were supervisor-owned before. A unit worker lists needed changes there in its report.
- **One agent per unit; analyses first.** A display that reads an analysis topic is built after the analysis. Displays never edit an analysis: a needed change goes to the analysis owner as a request in the report.

## Consequences

- Adding a display needs no shared-file change: a widget folder, its topic file, and the generated indexes.
- Two displays can be built in parallel without write conflicts; an analysis serialises the displays that read it.
- `pitwall where <unit>` shows all of a unit's files, because the naming is by convention.
