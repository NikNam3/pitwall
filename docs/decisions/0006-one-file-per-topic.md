# 0006: One file per topic, collected by a generated index

## Status

Accepted (2026-10-28). User decision Q-B of the foundation review.

## Context

All topic definitions lived in one object in `packages/contracts/src/topics.ts`. Every feature that adds a topic had to edit that shared file, which goes against "registration by convention, no central lists" (spec 3.3) and makes parallel workers collide. The wire contract still has to be one typed source for both bridge and UI.

## Decision

- **One file per topic:** `packages/contracts/src/topics/<topic name>.ts` default-exports `defineTopic<P, V>({ mode, maxHz })`. The file name is the topic name (`car.detail.ts`); DTO types used by only that topic live in its file.
- **The index is generated:** `scripts/gen-topics.ts` writes `packages/contracts/src/topics/index.generated.ts` (gitignored), the same way ADR 0005 does for features. It rejects a file name that is not a valid topic name.
- `pnpm gen` runs both generators, and the `pre*` scripts run `gen`.
- `TOPICS`, `TopicName`, `TopicParams<T>` and `TopicValue<T>` keep their meaning for importers.
- `CONTRACT_VERSION` stays one constant in `version.ts`; the supervisor bumps it when merging an incompatible change.

## Consequences

- Adding a topic means adding a file; no shared list changes.
- Contracts are still supervisor-owned: a worker proposes a topic file, and the supervisor reviews it.
- A fresh checkout must run `pnpm gen` before typechecking; the `pre*` scripts handle that. The UI build (sub-project 2) must run it too.
