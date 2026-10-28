# 0009: A second car comes later; the door stays open

## Status

Accepted (2026-10-28). User decision Q-A of the foundation review.

## Context

The engineer will eventually look after both drivers of a team: two games, two feeds of the same online session. The MVP covers one driver. The question was whether to build multi-feed serving and storage now.

## Decision

- **Out of MVP scope:** monitoring a second car.
- **Rule for all code now:** nothing may assume there is only one feed. `feedId` stays on topics, insights, subscriptions, demand and pipelines; the hub already holds several feeds; nothing becomes a process-wide singleton per feed.
- **What the second car will need** (recorded here so it is not rediscovered):
  - **Storage keyed per view:** two games of the same session send the same `sessionUid`. Rows must be keyed by `(sessionUid, playerCar)`, and session file names must include the player car. Today's `session_uid` keys assume one feed per session (noted on the DDL).
  - **Several feeds in one bridge:** `serve` with a list of feeds, `pitwall live --udp <port>...`, one WebSocket server. The same mechanism gives ATLAS-style compare sets: a replay feed next to the live one.
  - **Weekend context per driver:** prefer the driver's own feed for each earlier session, fall back to the teammate's view, and mark which one was used.
  - **Team features:** calculators that read two feeds' state, e.g. a combined strategy. They need a way to see more than one `EngineView`.

## Consequences

- No multi-feed code is built now, and none has to be removed later.
- The step to two cars is mostly storage keys and CLI, not a redesign.
