# 0003: Shared domain package

## Status

Accepted (2026-10-28). User decision; refines spec 3.1.

## Context

Engine, contracts and the UI all need the same JSON-safe vocabulary (`Known`, `Corners`, `CarState`, records, `Insight`, ids). Defining it in `engine` would force the UI to import `engine`; defining it in `contracts` would blur contracts, which should describe only the wire.

## Decision

- A new leaf package `@pitwall/domain` holds the JSON-safe domain vocabulary, defined once.
- `domain` imports nothing. `contracts`, `engine`, `strategy`, `bridge` and `ui` may import it.
- `contracts` stays wire-only: topics, messages and wire format.
- The UI imports `domain` and `contracts` only, never `engine` or `protocol`.

## Consequences

- Shared types have one definition and one owner (the supervisor).
- The dependency graph gains one leaf; dependency-cruiser rules encode the edges.
- Changes to the vocabulary ripple to every consumer, so they go through the supervisor.
