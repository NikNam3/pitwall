# Sub-project 3 run (timing + car monitoring): supervisor rulings and open items

Decisions the supervisor took during the autonomous run of `docs/superpowers/plans/2026-10-29-timing-car-monitoring.md` (2026-10-29), grouped by area. Each: the ruling, why, cost if wrong. Source: the run ledger.

## Rulings

### Contracts and domain

- `GapsOutput` gains `raceStartAt: Known<SessionTime>` from the `lightsOut` event; the gapper gap at lap L = L x referenceLap - (lineTime(L) - raceStartAt). Why: real recordings do not start at session time 0. Cost: none. With no known race start, every gapper line is empty.
- Pair gaps are exact: `GapsOutput.recent` holds each car's last 100 crossings by progress ((lap-1)x50 + segment); `gapsToCar` uses the latest progress both cars passed. Why: spec 6.1 needs A's crossing minus B's at the same segment, not a difference of gaps to the leader. Cost: about 22 x 100 numbers per output.
- `GapToCar.lapsDown` is signed relative to the params car (negative = laps ahead); the `MiniSectorCrossing` doc comment is fixed (segment s = the boundary at s x L/50). Cost: none.
- `Interval.positionsGained: Known<number>`: notApplicable outside a race, notReceived while the grid position is 0. Why: missing data is `Known`, never 0; displays do not subtract. Cost: none.
- The game sends grid positions from 0 and race positions from 1; the engine's timing adds 1 to the grid position. Why: lap 1 showed up/down arrows on 20 cars (bug B1). Cost: see "Open for the user".
- `GapperLines.reference { kind, carId: Known }`: the gap chart's "ref" line reads the resolved reference, not `session.playerCar`. Why: wrong label when the link primary is not the player; no invented car id. Cost: one contract field.
- `TyreWear.warnLaps` = `ALARMS_CONFIG.wearLapsWarning`, filled by the tyre-wear calculator. Why: no analysis threshold in a widget, or a `config.json` override would not reach it. Cost: one field.
- `ErsState.attack: Known<ErsAttack>` (attack decision and whole laps to the attack level) replaces `lapsToAttackLevel`; the tower's stop count and compound fallback are assembled in the `cars-overview` feature. Why: displays never compute (task D1). Cost: none, renders byte-identical.
- `IncidentForUs.positionBefore` is `Known<number>`; `IncidentForUs.otherCarId` names the other car; the race-moment cause carries the incident entry id; `GapToCar` params car is notApplicable. Why: the tower, feed and race moment each re-chose the same car or entry. Cost: contract fields.
- `RateSample { lap, value, at }`: a Known result needs `at`; `lapsUntil` inherits the rate's `at`; `paceDelta(beforeMs, afterMs, at)`. Cost: none.
- `LapTimesOutput` (rows without deltas, session bests, projections; the board's select adds deltas from its params) and per-cell status on `lapTimes.board`. Why: same pattern as gaps; the display must not decide session bests. Cost: one internal type.
- `EngineView.activeFlagPhase` (the open flag phase, set from `state.open.flagPhase`). Why: the current phase is settled state like `session.flag`; race-moment's `since` is its start. Cost: none.
- Rename `strategyFolder`/`dirs.strategy` to `analysisFolder`/`dirs.analysis` everywhere. Why: one name per concept, cheapest while little reads it. Cost: a larger task 1 diff.

### Analyses

- Tyre pressure band 20-31 psi; carcass inter 55-75, wet 45-65 C. Why: community setups run up to 29.5 psi, time trial reads 30.16; the 21.5-25 default would flag every car. Cost: a pressure problem inside 20-31 goes unflagged until calibrated (question Q1).
- Fuel's rate samples are the fuel level at lap end of each `forRate` lap of the current stint, fitted by Theil-Sen; burn = -slope. Why: robust to a skipped lap, same shape as tyre-wear. Cost: a safety-car lap in the window biases the burn slightly low.
- `per-lap-rate`'s config is declared by a config-only feature (no calculators, no topics) and read by tyre-wear, fuel, ers and battle; race-moment reads `drsRangeMs` from battle's config key. Why: one owner per key (ADR 0008). Cost: none.
- A calculator is exported from the package root `packages/analysis/src/index.ts`; a unit's own `index.ts` never imports its calculator. Why: avoids a circular import. Cost: one-line merge conflicts in the root index.
- Battle's gap comes from `GapsOutput.intervals`, not two `latest` crossings; ahead/behind are the neighbours in position order. Cost: none.
- The battle moment's `cause.params` name the trigger `{ carId, side, lapsToDrs, gapMs }`; `battleRole` bolds only that side of that car. Why: no threshold in the widget. Cost: one param shape.
- Damage jump: per part, `jump.at` = the event reaching `jumpPct`; loss = pace delta of the last 3 pace laps before vs up to 3 after. Why: a bounded before-window keeps early-race pace from biasing late jumps. Cost: a helper rule.
- Alarms: our cars = playerCar + teammateCar; `penaltyNew` only for real penalties (fix after review: warnings, reminders, lap invalidations and black-flag timers raised it as critical). Cost: false critical alarms had it been left.
- `warningLast` raises at `warningsBeforePenalty - 1`, assuming a penalty every N warnings (count mod N). Cost: see "Open for the user".
- Laps are read as the current record per car and lap (provisional and confirmed counted once) and the current stint comes from one shared helper (`analysis/src/shared/stint-laps.ts`). Why: four copies with three meanings and double-counted laps in fuel, ers, tyre-wear and damage. Cost: none.
- Pace delta around a lap is written once and shared (damage, incidents). Cost: none.
- Session remaining: lapsLeft = totalLaps - (lap - 1) - lapDistance/trackLength; leader finished means 0; unknown session kind means laps basis. Cost: none.
- Tower `TO US` is measured to the params car; the params car is notApplicable, lapped cars show laps down. Cost: none.

### Displays

- Formatters return an empty string for a non-finite input, not a dash. Why: the approved rule, an unknown value is an empty cell. Cost: none.
- One minus glyph app-wide, U+2212, in every signed formatter. Why: matches `+` in the mono font. Cost: one constant in `format.ts`.
- In a table the unit sits in the column header and cells are plain fixed-decimal numbers (README rule). Cost: none.
- Lap analysis colours only session bests (purple); green dropped. Why: in the best-lap table every value is a personal best, so green carries nothing. Cost: one emphasis rule.
- Red-flag chart band uses the `flagRed` role at 0.3 alpha; SC/VSC keep `bgBand`. Why: flags are coloured when not green. Cost: one theme value.
- Gap chart plots y = -gapMs/1000 with positive tick labels via `yFormat`; `sign * ms` in `rows.ts` is a display-sign convention, not analysis arithmetic. Cost: one helper move.
- Incident feed uses plain kind wording; the mockup's turn, part and warning-count detail needs `IncidentEntry` fields that do not exist, so it is not built (see "Open for the user").
- `CarLabel` props are `{ identity, ours }`; the code is the first three letters of the name's last word, or `#<raceNumber>`. Why: the domain has no driver code. Cost: two surnames with the same prefix show the same code.
- Widgets send UI actions through a kit context (`kit/actions.ts`); `activeInsights` and `INSIGHT_CATEGORIES` live in the kit. Why: depcruise forbids widgets importing the shell. Cost: one context API.
- Kit `Bar` renders per cell kind: fill in the caller's role, empty textFaint, limit/marker/reserve textDim; tyre-life-bar uses it. Cost: one kit component.
- The empty-cell hover shows readable texts from `kit/text.ts`, not raw reason names. Cost: one text table.
- Displays that read `raceMoment.current` (ers-budget, timing-tower, battle-cards, incident-feed) merge only after race-moment. Why: `gen:catalogue` rejects a read of an unbound topic. Cost: a short wait.

### UI shell and gallery

- Every gallery cell is snapped to whole pixels by one mechanism (`apps/ui/src/gallery/`); fit failures are fixed at their cause. Cost: one more re-baseline round.
- `Inspector.svelte` renders in the gallery build (`import.meta.env.DEV || VITE_PITWALL_GALLERY === '1'`) only. Cost: none, production builds unaffected.
- Palette cell query is `font`; kit `select.pw-input` gets an explicit one-cell height in `controls.css`. Cost: one shell style.
- Table header overflow of 1 px is fixed in `kit/table/Table.svelte` (inset box-shadow), not by a local override. Cost: none.
- Default workbooks `car`, `quali`, `race` are seeded when no file of that name exists, never overwritten; `cross-window.spec` opens `other` by name, not by index. Cost: none.
- Screenshot baselines: first gallery case x each size x default theme per display, plus kit and shell cells, capped by `SCREENSHOT_BUDGET` (50). `fit.spec` covers every case and theme. The most telling case is first in each gallery. Cost: a colour-only regression in a non-first case is caught only by a human look at a contact sheet.
- The top bar's default moment shows "car care". Cost: one prune.

### Process

- Workers are in-process subagents, so the `PITWALL_*` hooks do not bind them; the supervisor checks scope with `git diff --stat` per phase and test immutability with an empty diff over tests, `test-support`, `apps/ui/e2e` and `gallery.ts` after each implement phase. Cost: an out-of-scope edit slips past until review.
- Implementers run in parallel in their own worktrees; merges are serialised by the supervisor. Cost: merge conflicts in shared files (kit README, index files).
- Tasks 1 and 3 are delegated, single phase, with supervisor-owned scope. Cost: one review seat each.
- `registry.test.ts` asserts a named set instead of "exactly eight" (no "exactly N" tests). Cost: none.
- Sub-project 3 analyses are built bottom-up; follow-ups (D1, F1a/F1b, FX-A..D) fix findings of the final reviews in two parallel waves with disjoint files, then a scoped re-review. Cost: none.
- Test code may import `packages/*/src` by relative path (`test-support`). Cost: one import path if the engine moves the file.
- Minor items deferred to the final review were fixed in the fix waves or stay listed there (e.g. `SCHEMA_VERSION` until SP4 reads stored laps; `findAnalysisFolders` lists `analysis/src/shared/` as a unit).

## User decisions

- (2026-10-29) Stryker is skipped in Task 38; one full run at the end of the MVP. The user also thinks the 4-7 h estimate is too high.
- (2026-10-29) About 1,000 baselines are too many ("a human looking at it once can save you so much work"). Q2 answered: baselines = per display its first gallery case x each size, default theme; kit and shell cells default theme; `fit.spec` still checks every case and theme. Before the merge, per-display contact sheets are shown to the user once.
- Total baselines capped (50-60 app-wide), enforced by a count test (`SCREENSHOT_BUDGET`) in `pnpm check`.
- Colour only to highlight or distinguish, otherwise grey (the basis for dropping green in lap analysis).

## Open for the user

- `warningLast` assumes a penalty every N warnings (count mod N); not verified against the game.
- If the game sends an all-zero grid before the grid is set, every car reads grid position P1.
- `FinalClassification`'s grid position will need the same +1 when it is mapped.
- The incident feed lacks the mockup's turn, part and warning-count detail (`IncidentEntry` has no such fields); a follow-up in the incidents analysis.
- Tower `TO US` is negative for cars ahead while the battle `GAP` is positive ahead; this matches the approved mockup (-3.199 / +3.199), so it is by design.
- Tasks 39 and 40 wait for new recordings.
- Question Q1 (tyre pressure band) in the questions file.

## Late rulings (final review, fix waves and the user's first look)

- **Display decisions moved into analyses (D1, D1b, FX-C):** ERS attack readiness, the tower's stop count, the gapper's resolved reference, TO US to the link primary, per-cell session-best status, the incident moment's entry id and the incident's other car are computed by the analyses; displays only read. Why: displays never compute. Cost if wrong: none beyond the contract fields.
- **One formatter sweep (F1) and one minus glyph (U+2212)** for every signed value; formats in `kit/values/format.ts`, wording in `text.ts`. Cost if wrong: one constant.
- **Lap analysis colours only session bests (purple).** In a best-lap table every value is a personal best, so green carried nothing. Cost if wrong: one emphasis rule.
- **Band advisories judge the last completed lap** (brakes and engine: lap peak; tyres: lap mid-range); brake and engine temperatures form a new `car` category. Why: live values cross the band every lap, so the alarm flickered. Cost if wrong: an advisory reacts one lap later.
- **Incident location is the sector** (S1–S3) until per-track turn data exists; F1 25 sends no turn numbers. Damage jumps of one car within `jumpWindowMs` are one entry. Cost if wrong: one field later.
- **Penalty alarms only for real penalties** (one shared classification of PENA codes); warnings, reminders and lap invalidations are not tier-1 alerts. Cost if wrong: a missed alert type.
- **One current-stint rule over deduplicated laps** (the engine writes a stint record only when the stint closes, and every lap twice). Cost if wrong: one helper.
- **The determinism hash covers every per-car topic for every car**, derived from the registry. Cost if wrong: none.
- **Default workbooks are copied once:** a marker file remembers seeded names, so a deleted default stays deleted. Cost if wrong: a deleted default stays deleted.
- **Menus open inside the window** (leftward from the gear, clamped) and **the top bar names the workbook** as a button for the picker. Cost if wrong: one top-bar element.
- **Car fields are stale against the car's own newest update**, not the session packet's clock (the flash to "stale"). **A lap jump shows its target** while it fast-forwards.
- **Screenshot baselines:** one per display size of the first gallery case, default theme; a test caps the total at 50 (user decision). The gallery still renders every case; `fit.spec` checks them all.
- **Test timeouts:** whole-recording fixture tests 300 s, hook tests 30 s, whole-gallery tests 30 s; the UI test setup waits for lazy imports to settle. Why: correct alone, slow under `pnpm check`. Cost if wrong: a slower check.

## Open after the run

- A lap jump fast-forwards at about 17× (lap 12 of the time trial ≈ 46 s); spec 8.4 targets 5 s. Needs seeking from history snapshots.
- A whole time-trial replay through the engine takes about 50 s alone; replay and `pitwall dev` restarts would profit from a profile.
- `moments/capture.ts` and `cli/commands/tap.ts` keep their own stale per-car topic list, so gallery moments miss some analysis data.
- The warning count in the incident feed (warning events) can differ from the alarm (the game's corner-cutting counter); verify the game's rule.
- Teammate car 14 in `raceSingapore` reads 0 on its first frames (should be unknown), which skews a lap mid-range.
- Incident turn numbers need per-track corner data.
- A lap-history display (our laps, lap by lap) for training in the `car` workbook was offered.
