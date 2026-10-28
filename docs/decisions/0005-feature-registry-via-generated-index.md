# 0005: Feature registry via a generated index

## Status

Accepted (2026-10-28)

## Context

Features (calculators, topics, later widgets) must register without editing a shared file, so parallel worktrees do not conflict. The registry must stay visible to `tsc` and dependency-cruiser.

## Decision

- A feature is a folder `apps/bridge/src/features/<name>/register.ts` that default-exports a `Feature`.
- `scripts/gen-features.ts` generates `apps/bridge/src/features/index.generated.ts`, which is gitignored.
- The generator runs in `pretest`, `pretypecheck` and before each bridge start.
- Rejected: a hand-edited list (merge conflicts) and a runtime glob (invisible to `tsc` and dependency-cruiser).

## Consequences

- Adding a feature means adding a folder; no shared file changes.
- The generated file is plain static imports, so type checking and dependency rules see it.
- A fresh checkout needs the generator to run before typechecking; the `pre*` scripts handle that.
