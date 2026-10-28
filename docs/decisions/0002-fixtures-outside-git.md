# 0002: Full recordings stay outside git

## Status

Accepted (2026-10-28)

## Context

Tests and acceptance checks run on real `.pwrec` recordings. Full recordings are large and would bloat the repository. Git worktrees do not contain untracked files, so each worktree needs a way to find them.

## Decision

- `recordings/` is gitignored and holds the full recordings.
- `fixtures/index.json` lists every fixture with its sha256, so a test can verify it found the right file.
- The location is overridden with `PITWALL_FIXTURES_DIR` (default `<repo>/recordings`).
- Small segments cut with `pwrec-cut` are committed under `fixtures/segments/`.
- Git LFS is not used: bandwidth quotas make it a poor fit, and segments are enough for most tests.

## Consequences

- The repository stays small and clones quickly.
- A worktree or a fresh clone must set `PITWALL_FIXTURES_DIR` to run the tests that need full recordings.
- Revisit if full recordings ever have to be versioned.
