# Task NN: <name>

## Goal

<One or two sentences: what exists afterwards that does not exist now.>

## Scope

`PITWALL_WORKER_SCOPE=<folder>:<folder>`

Everything outside these repo-relative folders is read-only.

Optional: `PITWALL_WORKER_UNIT=<unit>` for a task that builds one analysis or display. It additionally grants the unit's folders and topic files (ADR 0011).

## Interfaces

- Consumes: <modules, types and files this task depends on, copied from the plan>
- Produces: <modules, types and files other tasks will depend on, copied from the plan>

## Tests to pass

```
pnpm vitest run <path>
```

## Phase

- `test`: write and commit failing tests only; no implementation code.
- `implement`: make the committed tests pass; tests are read-only.

This brief is for phase: `<test|implement>`.

## Done when

`pnpm check` is green in scope and the commit is made.

## Report

### Summary

<What was done, files, commit SHAs.>

### Tests

<Command plus pass/fail counts.>

### Requested changes to supervisor-owned files

<For each: file, exact change, why. Write "none" if there are none.>

### Open questions

<Anything that needs the human or the supervisor. Write "none" if there are none.>
