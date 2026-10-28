# 0004: better-sqlite3 over node:sqlite

## Status

Accepted (2026-10-28)

## Context

The derived database is SQLite. Spec 9.2 asks to prefer the built-in `node:sqlite` when it is mature enough. On Node 22.22 it still prints `ExperimentalWarning: SQLite is an experimental feature`. `better-sqlite3` 13 ships prebuilt binaries, so no C toolchain is needed.

## Decision

Use `better-sqlite3` for the storage layer, behind the `WeekendRepository`.

## Consequences

- One native dependency, installed from prebuilt binaries.
- The repository interface hides the library, so switching is local to storage.
- Revisit when the minimum supported Node is a release where `node:sqlite` is stable.
