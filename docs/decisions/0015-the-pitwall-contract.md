# 0015: The pitwall contract

## Status

Accepted (user, 2026-11-02). Replaces the previous `docs/architecture.md`; amends ADRs 0008 (config and the new priors store), 0011 and 0014 (calculators, analyses, simulators, presentation in displays), 0013 (UI state, decisions). The situations spec of 2026-10-30 and the SP4a spec and plan are superseded (SP4a is re-specced after the migration).

## Context

Live testing and nine review waves (2026-10-30/31) showed one root cause behind most bugs: every module re-derived the same situation (pit, garage, safety car, finish, retirement) from the game's raw statuses with its own local rule, and each fix in one module broke another. The first slice of a situation tracker made it worse in one respect: it rewrote history (formation discard, start re-stamp, a "shared-moment" rule) under one boolean flag, and the rules that grew around it were written only in specs and code comments. The survey `docs/history/specs/2026-11-02-race-state-machine/01-current-architecture.md` lists 12 places that decided situations outside the tracker and 7 rules changed without being written down. Workers under pressure took the shortest local path because nothing in their context forbade it.

## Decision

`docs/architecture.md` is the contract: numbered clauses with enforcement tags and a glossary, imported into every agent's context by CLAUDE.md. The reasons, per clause or group:

- **C0.** A contract that bends per task stops being one. Changing it first and adapting the code before anything else avoids building twice on a contract that is about to change; a gap stops the whole sub-project because work on a changing contract is work done twice (user).
- **Glossary.** Words like "machine", "signal" and "fact" were read differently by different agents; one meaning each removes the room for a local rule.
- **C1–C4.** Unchanged rules of the foundation (ADRs 0001, 0003), kept because the purity of engine and analysis is what makes determinism and incremental = from scratch testable.
- **C1a, C8 (realism, freshness), C37 (feed health).** Rules of the previous architecture document carried over (ADR 0009, realism mode, the UI's staleness).
- **C5, C6.** The game's format is the most likely thing to change (F1 26) or to multiply (another game); confining it to an adapter keeps everything above it untouched.
- **C7–C11.** The old step order carried meaning only in comments, and modules coupled through each other's open state (`pit-stops` setting the lap cursor's out lap). Fixed steps with no coupling inside a step make order irrelevant and testable by shuffling.
- **C12, C13.** Only a closed list enforced by types makes a local situation rule a compile error instead of a review finding.
- **C14–C17.** The weekend phase decides which rules apply; sub-machines are shared only where recordings show the same signals in two phases, so shared code never hides a phase difference. Registration by convention makes adding or moving a sub-machine cheap (user).
- **C18, C19.** The game's signals are noisy and out of step; opening on the earliest signal and recording an unconfirmed span as such keeps the log truthful without ever withdrawing a fact.
- **C20.** Two doors (open spans in the view, closed spans in the projection) are enough for every reader and leave no third way to re-derive.
- **C21–C26.** History is never edited (user): an immutable log, references instead of updates, and stamps that fix membership at recording, which removes the shared-moment rule.
- **C27, C27a.** A flashback means the undone time never happened (user); a void fact expresses that by appending. Decisions are voided too, because they rested on facts that no longer happened (user).
- **C28, C29, C34.** One module applies voids and the formation stamp, so no reader can get them wrong; storage keeps everything, and nothing reads hidden facts until a reader is designed (user).
- **C30–C33.** Only state derived from the projection must react to a rewind; the accumulator is the one fenced exception, allowed only for measured speed, because state kept between frames is where incremental readers went wrong. Insights are recomputed after a rewind because the engineer never saw them in the correct timeline (user).
- **C35–C38.** One continuous race clock; a fall is carried over instead of re-stamping facts; determinism makes every run reproducible from its recording and sidecars.
- **C39–C49.** The view is the only input of a unit, change tags come from registries, and a guarded view in tests catches undeclared reads; judgements live in calculators and analyses so two displays never disagree.
- **C50, C51.** Simulators stay plain functions so a model can be swapped or ported; jobs keep expensive work off the frame path.
- **C52.** Insights come from analyses; the scheduler and the bridge raise only `system` insights.
- **C53–C57.** Topics are the seam to the UI; core topics publish facts and spans as they are, analysis topics publish judgements, and no signal crosses.
- **C58–C63, C62a.** All I/O in the bridge; recordings are the truth and storage a rebuildable cache; the rules version rebuilds stale sessions; the priors store holds season-wide aggregates as a versioned cache, read once per run, so tests and replays stay reproducible.
- **C64–C71.** The UI rules of SP2 and ADRs 0012–0014, plus presentation tables so layouts can follow the situation without displays judging anything (user).
- **C72–C77.** Every action is a command; persistent changes go through the bridge; a manual layout choice is never overridden (user); decisions are recorded facts so replays reproduce them (user); pitwall never controls the game.
- **C78–C83.** Ownership and the two-phase workflow keep parallel workers from colliding; briefs cite clauses so every change is checked against the contract.
- **C84–C88.** Tests target one behaviour on small segments; every transition is tested by tables, completeness and one property per sub-machine; workers run related tests, the supervisor the full suite per merge (user).
- **C89.** Open review questions looped for eight waves; asking only whether the contract was violated converges and points every finding at a clause (user).
- **C90.** A sub-machine change alters stored history, so its version must rise and stored sessions rebuild.

## Consequences

- The existing code violates many clauses (survey §7, §8). A migration plan adapts it before any other code is written (C0); it replaces situations plan Tasks 3–9 and precedes SP4a.
- Enforcement that does not exist yet (the signals module, the projection, the void fact, the machine registry, the guarded view, the shuffle test, generic completeness tests, `pitwall scan-situations`, the version-bump test, the priors store) is built by the migration: `docs/history/specs/2026-11-02-race-state-machine/03-traceability.md` §5.
- Every brief names the clauses it touches; every review asks one question (C89).
