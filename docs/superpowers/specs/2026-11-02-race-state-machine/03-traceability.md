# Traceability: decisions and findings → contract clauses

Status: self-check of `02-contract.md`, 2026-11-02. Every decision of the brainstorm and every finding of `01-current-architecture.md` maps to the clauses that carry it. A row without a clause would be a gap in the contract.

## 1. Decisions of the brainstorm (user, 2026-11-02)

| # | Decision | Clauses |
|---|---|---|
| Q1 | The machine is the only source of situation truth, enforced by types; `FlagPhase` and raw statuses go | C12, C13, C20, C43, C54 |
| Q2 → Q11/Q12 | History is never edited. A flashback appends a void fact (positions, not times); readers see a projection; the formation lap is hidden by its stamp; storage keeps everything and nothing reads hidden facts; the start settling is carried over by the clock; an unconfirmed span closes as a fact | C18, C24, C27, C28, C29, C34, C36 |
| Q3 | The contract follows the chain parsing → engine → view → calculators → analyses (simulators, jobs) → topics → displays, plus the bridge | sections 1–5, C42, C50, C51 |
| Q4 | Membership by stamps (span ids) written at recording | C26 |
| Q5 | Signals leave `domain`; an engine-internal signals module only the machine imports; view = live + situation + history | C13, C39 |
| Q6 | Fixed steps, no coupling within a step, shuffle test | C7–C11, C86 |
| Q7 | Weekend phase on top; per-phase sub-machines; sprint and sprint shootout are formats; review is no phase but a reader of stored projections; weekend facts come from the weekend context | C14, C17, C62 |
| Q8 | Shared once seen in two phases with the same signals; widening is cheap (registry, generic spans and stamps, generic storage, rules version) | C15, C16, C21, C26, C60, C61, C90 |
| Q9 | The signal list and the definition of signal and value; situation events leave `RaceEvent` | glossary, C12, C13 |
| Q10 | Behaviour tables in analyses; presentation tables in displays and the shell; `race-moment` ranks only | C44, C46, C66, C67 |
| Q13 | The contract replaces `docs/architecture.md`, is imported by CLAUDE.md, has numbered clauses with enforcement tags and a glossary; reasons in ADR 0015; C0 as the user worded it | preamble, C0, C79 |
| — | Only the adapter knows the game | C6 |
| — | Car location, car status and car activity | glossary, C17 |
| — | Accumulators stay in memory as the one fenced exception; derived state lives in memory | C30, C31, C32 |
| — | UX: commands, persistent versus window-local changes, input commits, widget actions, settings | C72–C75 |
| Q14 | A manual layout choice pins the layout | C67 |
| Q15 | Decisions are recorded facts with a sidecar | C10, C59, C76 |
| — | Transitions tested by tables, completeness both ways, one property per sub-machine, segments per signal shape; `pitwall scan-situations` before widening | C85, C87 |
| — | Review question: did this change violate the contract | C89 |
| — | Test levels: related tests per task, `pnpm check` per merge, UI and acceptance per sub-project | C88 |

## 2. Survey §7: places that decide situations outside the tracker

| Place today | Forbidden or replaced by |
|---|---|
| `engine/history/pit-stops.ts:47-60` (pit status, DTSV/SGSV, session flag) | C13 (no signal outside the machine); pit visits come from car location and activity spans (C17), penalties from the penalties sub-machine |
| `engine/history/laps.ts:43,68` (pit and driver status: out lap, lap restart) | C13; lap roles from car activity (C17) |
| `engine/history/laps.ts:83-84` (session flag for SC/VSC time) | C13; neutralised time from session-phase spans via stamps (C26) |
| `pit-stops.ts:31-35` → `laps.ts` (coupling through `open.laps`) | C11 |
| `engine/history/stints.ts:42-57` (pit visit, lap progress, SEND) | C11, C13; stint boundaries from car activity spans |
| `engine/step/identity.ts:22-26`, `history/cars.ts:14` (`resultStatus` → active car) | C13; car status sub-machine (C17) |
| `analysis/shared/out-of-race.ts:8` (`resultStatus`) | C13, C43; car status spans |
| `analysis/shared/drs-status.ts:13-21` (DRS from events) | C12 (DRSE/DRSD are signals, no longer `RaceEvent`s), C13; race-control spans |
| `analysis/lap-times/calculator.ts:63,142` (driver and pit status) | C13, C44 |
| `analysis/incidents/calculator.ts:141` (pit status) | C13, C44 |
| `analysis/session-remaining/calculator.ts:21` (leader `resultStatus`) | C13; car activity `finished` |
| `apps/ui/src/widgets/timing-tower/rows.ts:93,120` (raw statuses in a display) | C13, C54 (no signal in a topic), C65 (displays render), C43 |

## 3. Survey §8: rules changed without being written down

| Rule today | Clause |
|---|---|
| 1. History is rewritten (formation discard, start re-stamp) | C24, C29, C36 |
| 2. `delta.truncated` has three meanings | C30 (`rewound` only) |
| 3. A race clock separate from session time | C35, C36 |
| 4. The shared-moment rule with its hand-kept list | C26 (membership by stamp; the rule goes) |
| 5. The view grows a field per tracker | C39, C40 (generic per sub-machine) |
| 6. The engine reads wall-time differences | C37 |
| 7. Ordering coupling inside `step` | C7–C11, C15 |

## 4. Survey §10: open seams

| Seam | Clauses |
|---|---|
| 1. One model or two | C13, C20 |
| 2. The door from the tracker to readers | C20, C39, C54, C55 |
| 3. What history may do | C22, C24, C27 |
| 4. One flag or a reason | C30 |
| 5. New lists and the shared-moment rule | C26 |
| 6. Ordering inside `step` | C11, C15 |
| 7. One machine or several, names, owners | C14–C17, C78, C80 |
| 8. Stored, published, display-only | C53–C55, C60 |
| 9. Behaviour per situation | C44, C66 |
| 10. What SP4a consumes | C20, C39 (situations and the projection replace `flagPhases` and the raw pit model) |

## 5. Enforcement that does not exist yet

Built by the migration plan, before the clauses that name them can be checked:

- the signals module and its depcruise rule (C13); the domain types without signal fields;
- the projection module and the read-only log types (C24, C28);
- the void fact in the runner (C27);
- the machine registry generator, transition declarations and the cycle check (C15);
- the shuffle test per step (C11);
- the guarded view harness (C41);
- the generic completeness tests (C87);
- the benchmark test for each incremental unit (C31); today's five (`gaps`, `lap-times`, `incidents`, `damage`, `pace`) get one or become quick;
- `bindSituation` (C55);
- generic span storage, the rules version and the rebuild on mismatch (C60, C61);
- the version-bump test (C90);
- `pitwall scan-situations` (C85);
- the decisions sidecar and the decision recorder (C76);
- the layout controller with switch rules and the pin (C67);
- the situations catalogue `docs/research/09-situations-catalogue.md` (C17, C19).

## 6. Open points outside the contract

- **Sprint weekend shape:** the sprint recording (2026-11-02_15-17-14) has weekend structure [15, 16]. Whether a full sprint weekend lists its shootout sessions too is not yet known; C14 is worded to hold either way.
- **Gallery timeout:** `apps/ui/test/gallery/gallery.test.ts` mounts the gallery in jsdom in about 28 s against a 30 s limit and failed once under load (2026-11-02). A slowness bug: profile and fix, never raise the timeout.
- **Tooling and hook tests** (about 144 s of the suite's 720 s of work) could move from `pnpm check` to the merge gate; a later decision.
- **ADR numbering:** this contract's ADR takes 0015; SP4a's planned priors ADR becomes 0016.
- **Migration plan:** a separate plan (writing-plans) after the contract is approved, ordered by C81; it replaces the remaining situations plan Tasks 3–9 and precedes SP4a.
