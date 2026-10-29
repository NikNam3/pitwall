# 0014: Displays render, analyses compute

## Status

Accepted (2026-10-29). Sub-project 3 spec 1.4 (decisions 7 and 8) and 3.5. Amends ADR 0011.

## Context

Sub-project 3 builds about a dozen analyses and twelve displays with up to eight agents in parallel. Maths hidden in a widget cannot be tested like an analysis, is invisible to other displays, and turns two displays that need the same number into two implementations of it. Parallel agents also collide whenever they share something that does not exist yet.

## Decision

- **Displays render.** A widget formats values and applies emphasis (pure functions from states in topic values to theme roles), nothing else. Any arithmetic on topic values beyond formatting is a review finding.
- **Analyses compute.** All maths lives in analyses, which combine calculators (and, from sub-project 4, simulators). Maths that only one display needs is still an analysis, with its own topic.
- **Shared first, bottom-up.** Calculators, then analyses, then displays. Anything two parallel workers would share (a calculator, an intermediate value, a UI kit component, a contract) is built first, so two display workers, or two analysis workers that share no intermediate value, never interact.
- **Contracts first.** Every value type, topic file, calculator id and output type, and config declaration between the parts is committed as code by the supervisor before any test agent starts. They are read-only for unit workers. A topic may name an analysis as its owner before the analysis's feature exists: `gen:catalogue` counts each folder of `packages/analysis/src` as a unit.
- **Amends ADR 0011.** The display-private feature folder (a feature named like its widget) stays possible in the code but is not used in new work.

## Consequences

- Every number on the panel is tested where it is computed, and two displays showing the same quantity show the same value.
- The serial part of a run grows: contracts and shared pieces come before the parallel front can start (sub-project 3 spec 13.2).
- A display that needs a new number waits for an analysis change; the request goes to the analysis's owner through the report.
