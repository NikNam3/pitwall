# Live polish

Status: design approved in the brainstorm, 2026-11-05 (sections A and B; answers P0–P5 in `00-answers.md`). Runs before SP4.0 (carry-over A1). Inputs: N2–N8 and N10 of `docs/superpowers/specs/2026-11-05-sp4a/00-carry-over.md` §7, from the live test of 2026-11-04/05 (`docs/acceptance/live-checklist.md`).

## 1. Goal

The panel the user ran on the first live weekend reads right on the next one: battle numbers with one sign rule that update every mini-sector, a gap chart of only the cars that matter, sectors as they finish, our cars named in the incident feed, warnings by kind, fuel kg from the start, damage that says it is measuring and estimates early, a readable finish margin, and a way to bring back a closed panel.

**Not in this run:** the pit-loss line on the gap chart (it is SP4.2's rejoin ghost lines, P0); everything of SP4.

## 2. Rules

- **One sign rule (A6):** every battle number is positive when it is good for our car.
- **As often as correct (N1):** each changed unit states its granularity; `battle` and `gaps` follow the mini-sector crossings.
- No contract change. Clauses touched: C3, C26, C31, C41, C43, C44, C45, C47, C53, C65, C66, C68, C72, C73, C82.

## 3. Analyses

### 3.1 `battle` (N2)

- **PACE Δ** (`paceDeltaMs`, s/lap): both cars' times over the same last 50 mini-sectors, normalised to one lap. The window ends at the newest segment both cars have crossed. A segment is skipped when either car was in the pit lane (`car-location`) or a neutralisation (SC, VSC, red flag: `shared/neutralised.ts`, the one source `gaps`, `incidents` and `race-moment` read, C43) covered any frame from its start crossing to its end crossing, the exclusion `incidents` applies (membership by frames, C26); and the window reaches further back until it holds 50 usable segments, at most 3 laps back. Fewer than `minPaceSegments` (config, 25) usable → `insufficientData`. Positive = we are faster.
- **CLOSING** (`closingMsPerLap`) is removed, with its config keys (`closingWindow`, `closingMinSamples`) and its emphasis (P1).
- **`lapsToDrs`** comes from PACE Δ instead of the closing rate, so the card holds one rate: (gap − `drsRangeMs`) / the closing car's edge per lap, on the AHEAD side while we are faster, on the BEHIND side while they are; 0 inside DRS range; `notApplicable` while the gap is not closing or race control has DRS off; PACE Δ's reason while it is unknown. Readers: the `battle-cards` DRS row and `race-moment`'s battle moment (its rule unchanged).
- **`overtakeMarginMs`** is replaced by **`passMarginMs`** on the AHEAD side (our edge − `overtakeThresholdMs`) and **`holdMarginMs`** on the BEHIND side (`overtakeThresholdMs` − their edge); both positive = good for us (P2). `BattleSide` carries the one that applies: `margin: Known<{ kind: 'pass' | 'hold'; ms: Ms }>`.
- **Kind and cadence:** `battle` stops reading `pace`; it reads `miniSectors`, `spans:car-location` and `NEUTRALISATION_READS` (besides `gaps`, `race-control-race` for DRS, `weekend-phase`, tyres, energy, identity). Reading the whole crossing list every pass grows with the race, so `battle` becomes **incremental**: its accumulator is each car's current crossings of its last 4 laps (the window's 3-lap reach plus one lap: the car ahead's part of the window lies behind its own newest crossing), a pure fold over the projection (C31.2); it passes C31.1's proof on the long-race builder. Cadence `frame` (affected only when crossings, spans or its other reads change); topic `battle.cards` `maxHz` 4.

### 3.2 `gaps` (N3)

- `GapperLines.cars[].byLap` becomes **`points: { lap: number; gapMs: Ms }[]`**: one point per mini-sector crossing for the last `fineLaps` laps (config, 10), one per completed lap before them; `lap` = completed laps + segment / 50. `now` stays (P4).
- **`GapperLines.cars` holds only the window** (P3): our cars, plus every car within ±`windowMs` (config, 10 000, pitwall estimate) of one of our cars' gapper value at its newest crossing. A car in the window leaves it only beyond ±(`windowMs` + `windowExitMs`) (config, 1 000, pitwall estimate), so a car at the edge does not flicker in and out; entering and leaving are judged at each crossing, a fold over the crossings like the rest of the accumulator (C31.2, C31.3). The membership is gaps' judgement (C43); the topic carries no line the display does not draw, so a message stays the size of the window, not of the field.
- Topic `gaps.gapper` `maxHz` 1 → 4.

### 3.3 `incidents` (N4)

`IncidentWarning` becomes `{ kind: 'cornerCutting'; count: number; limit: number } | { kind: 'other'; infringement: Known<number> }`: a corner-cutting warning (the warned span's `cornerCutting` count rose) keeps `count/limit`; any other warning carries its PENA infringement code. Readers: `incident-feed`, `race-moment` (ignores the warning detail).

### 3.4 `lap-times` (N5)

`LapBoardRow` gains:

- `newestSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>]`: per sector the newest finished time: sector 1 and 2 from the live `sector1TimeMs` and `sector2TimeMs` as soon as the car has passed the sector's end in the current lap, sector 3 (and all three) at the line;
- `newestSectorStatus: [SectorStatus, SectorStatus, SectorStatus]`: judged against the bests before that time;
- `newestSectorOlder: [boolean, boolean, boolean]`: the newest time belongs to an earlier pass than the car's newest sector time (at the line the just-completed lap's three are not older; once the new lap's S1 is in, S2 and S3 are), so the display dims it without computing (C65). A live sector of an invalid lap has status `none`.

`lastSectorsMs` and its status stay (other readers). Cadence unchanged (`frame`). `lap-analysis` is a best-lap table (each car's best sectors) and keeps them (run ruling, Task 10b).

### 3.5 `damage` (N7)

Each `DamageJump` (its `lossMsPerLap` is the measured loss) gains:

- `measuring: Known<{ lapsDone: number; lapsNeeded: number }>`: while a jump's loss is being measured over `forPace` laps (`lapsNeeded` = the existing 2); `notApplicable` otherwise;
- `estimateMsPerLap: Known<Ms>`: from the car's mini-sectors since the jump against its baseline for those segments (the segment medians, below, frozen at the jump: no crossing after the jump's frame enters them, so the damaged laps never dilute the baseline they are measured against), summed and scaled to 50 segments, after at least `minEstimateSegments` (config, 10); `notApplicable` once its `lossMsPerLap` is known. A jump whose loss can never be measured (`lossMsPerLap` `notApplicable`: no pace laps before it) keeps its estimate, its only number.

**Segment medians, one rule for both units.** The rule `incidents` applies today: per segment, the median of the car's last 5 eligible mini-sectors of that segment, at least 3 needed (otherwise no median: `fewLaps`), a mini-sector being eligible when no pit visit or neutralisation covers any frame of it. It moves from `incidents.ts` (`MEDIAN_LAPS`, `MEDIAN_MIN_LAPS`, the samples fold and `median`) to `analysis/src/shared/segment-medians.ts` as pure fold and query functions both units call over their own accumulators (C31.2, C43, C45); `incidents`' behaviour is unchanged. `damage` gains the reads `miniSectors` and `NEUTRALISATION_READS` (C41).

## 4. UI

| Input | Widget or shell | Change |
|---|---|---|
| N2 | `battle-cards` | Rows: GAP, PACE Δ (`s/lap`), `PASS` or `HOLD` (`s/lap`), DRS, tyres, ERS; CLOSING removed. Emphasis: a positive PASS bold white; a negative HOLD bold `warning`; no verdict words. |
| N3 | `gap-chart` | Draws the cars of `gaps.gapper` (the window): ours white, the others `textFaint`; no team colours. The y range comes from the drawn series (kit `Chart`). Points per mini-sector are one line. |
| N4 | `incident-feed` | Our cars by driver code from `cars.overview` (`RUS P6→P7`), not `us`. Warnings: `warning · corner cutting 2/3`, `warning · collision`, from an infringement wording table in `kit/text.ts` (the F1 25 infringement codes of the UDP specification's appendix). |
| N5 | `timing-tower` | S1–S3 from `newestSectorsMs` with their status colours; a sector whose `newestSectorOlder` is set in `textFaint`. |
| N6 | `fuel-gauge` | The kg shows whenever `kg` is known; lasts, burn and margin stay blank until known. |
| N7 | `damage-card` | While measuring: `measuring 1/2 laps`; with an estimate: `~+0.8 s/lap est.` in `textFaint`; the measured loss replaces both. |
| N8 | `projected-lap` | The finish margin through a new `formatMinutesTenths` (`kit/values/format.ts`, `18:48.6`) at 60 s or more, seconds below. |
| N10 | shell commands | One command per registered widget: id `panel.add.<widget>`, title "Add panel: <title>", group Window; adds the widget to the focused group through `docking.addPanel`; the existing layout save sends `workbook.updateWindow` (C67, C72, C73). No default key. |

`kit/text.ts`, `kit/values/format.ts` and `shell/commands/` are supervisor-owned: delegated changes in two phases.

## 5. Testing

- `battle`: PACE Δ over a window with pit and SC segments skipped, also an SC that comes out mid-segment; `lapsToDrs` from PACE Δ on both sides, 0 in DRS range, `notApplicable` while not closing; `insufficientData` below 25 segments; PASS and HOLD signs on both sides; incremental equals from scratch, also after a rewind; C31.1's proof; behaviour tables over the spans it reads.
- `gaps`: points per segment for the last 10 laps and per lap before; window membership at the boundary (exactly 10 s enters, 10.001 s does not; a car in the window stays at 11 s and leaves at 11.001 s); `now` unchanged.
- `incidents`: a corner-cutting warning keeps `count/limit`; a collision warning carries infringement 4.
- `lap-times`: S1 appears at the end of sector 1 with its status; after the line S2 and S3 of the previous lap remain, marked `newestSectorOlder`.
- `damage`: `measuring` counts `forPace` laps; the estimate after 10 segments against a baseline that ignores crossings after the jump, `notApplicable` once measured; `segment-medians` tests moved with the function, `incidents`' tests unchanged.
- Widgets: presentation and emphasis completeness (C66, C68); gallery cases per change; `fit.spec` over every case; the add-panel command sends `workbook.updateWindow` with the new panel.
- One segment test: `battle`'s PACE Δ on `race-zandvoort-full-lap` is known for a car pair after one lap and matches the difference of their gap change over the same segments within 1 ms.
