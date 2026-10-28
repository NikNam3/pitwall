# Architecture

Condensed from spec section 3 (`docs/superpowers/specs/2026-10-28-foundation-design.md`).

## Packages and allowed dependencies

| Package | Role |
| --- | --- |
| `packages/protocol` | bytes to typed packets (spec 2025 only) |
| `packages/domain` | JSON-safe domain vocabulary (`Known`, `Corners`, `CarState`, records, `Insight`, ids); leaf package |
| `packages/engine` | race model: pure, no I/O, no clock, no network |
| `packages/strategy` | strategy calculators |
| `packages/contracts` | topic types and WebSocket messages, shared by bridge and UI; wire-only |
| `apps/bridge` | imperative shell: input, frame assembler, engine runner, storage, WebSocket, CLI |
| `apps/ui` | Svelte UI (sub-project 2) |

Allowed edges (everything else is a violation; dependency-cruiser fails the build):

- protocol → nothing
- domain → nothing
- contracts → domain
- engine → protocol, domain
- strategy → engine, domain
- bridge → all packages
- ui → contracts, domain

The UI imports neither `engine` nor `protocol`. See ADR 0003 for why `domain` is a separate package.

## Data flow

```
PacketSource (UDP | PwrecFile) → RawPacket → decode → Frame assembler → Frame
  → Engine.step(state, frame) → state → Scheduler → calculators → topic values / insights
  → TopicHub (throttle, per client) → WebSocket → UI
  ↘ PwrecWriter (raw)          ↘ StorageWriter (confirmed history → SQLite)
```

## Determinism rules

- The engine never reads the system clock. Time comes only from `sessionTime` and frame IDs.
- Randomness only through an injected, seeded generator.
- The same input stream always produces the same state and the same topic stream.
- Wall-clock time (`receivedAtMs`) exists only in the shell, for diagnostics, except that `SessionTracker` compares receive times (differences only) for the `SEND` grace window, because UID-0 packets carry no usable session time.

## Parallel development

Several agents work in parallel in git worktrees; a supervisor merges. The architecture prevents conflicts on shared files:

- **Registration by convention, no central lists.** Calculators, topics and widgets register through a file in their feature folder (`src/features/<name>/register.ts`). Adding a feature means adding a folder (ADR 0005).
- **The supervisor owns the shared files:** `packages/contracts`, `packages/domain`, every `package.json`, the lockfile, base types in `engine`. Workers request changes in their report.
- **Ports per worktree:** `PITWALL_WS_PORT`, `PITWALL_UDP_PORT` and `PITWALL_UI_PORT` come from the environment, so parallel instances and Playwright runs do not collide.

## Where state lives

- **Engine state** (`EngineState`): session, one `CarState` per car (identity, timing, tyres, energy, condition, dynamics, own-car data), player and teammate ids. Held in memory, advanced only by `Engine.step(state, frame)`.
- **History:** append-only inside the engine state; entries become `confirmed` once the game's SessionHistory data settles them.
- **Calculators:** derive topic values and insights from engine state. They keep no state of their own; whatever they need lives in engine state or history.
- **Storage:** raw `.pwrec` files per session are the source of truth; one SQLite database (`better-sqlite3`, ADR 0004) is a rebuildable cache written from confirmed history by the bridge. The engine has no database access; the bridge passes earlier sessions of the weekend in as read-only `WeekendContext`.
