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

- **PACE Δ** (`paceDeltaMs`, s/lap): both cars' times over the same last 50 mini-sectors, normalised to one lap. The window ends at the newest segment both cars have crossed. A segment is skipped when either car was in the pit lane or a VSC or SC was out on the frame it began (membership by frames, C26), and the window reaches further back until it holds 50 usable segments, at most 3 laps back. Fewer than `minPaceSegments` (config, 25) usable → `insufficientData`. Positive = we are faster.
- **CLOSING** (`closingMsPerLap`) is removed, with its config keys and its emphasis (P1).
- **`overtakeMarginMs`** is replaced by **`passMarginMs`** on the AHEAD side (our edge − `overtakeThresholdMs`) and **`holdMarginMs`** on the BEHIND side (`overtakeThresholdMs` − their edge); both positive = good for us (P2). `BattleSide` carries the one that applies: `margin: Known<{ kind: 'pass' | 'hold'; ms: Ms }>`.
- **Kind and cadence:** `battle` stops reading `pace`; it reads `miniSectors` and the spans it needs (`car-location`, the race's `race-control`). Reading the whole crossing list every pass grows with the race, so `battle` becomes **incremental**: its accumulator is the last 150 current crossings per car (3 laps), a pure fold over the projection (C31.2); it passes C31.1's proof on the long-race builder. Cadence `frame` (affected only when crossings, spans or its other reads change); topic `battle.cards` `maxHz` 4.

### 3.2 `gaps` (N3)

- `GapperLines.cars[].byLap` becomes **`points: { lap: number; gapMs: Ms }[]`**: one point per mini-sector crossing for the last `fineLaps` laps (config, 10), one per completed lap before them; `lap` = completed laps + segment / 50. `now` stays (P4).
- New **`GapperLines.window: CarId[]`**: our cars, plus every car within ±`windowMs` (config, 10 000, pitwall estimate) of one of our cars' gapper value at its newest crossing (P3). The membership is gaps' judgement (C43).
- Topic `gaps.gapper` `maxHz` 1 → 4.

### 3.3 `incidents` (N4)

`IncidentWarning` becomes `{ kind: 'cornerCutting'; count: number; limit: number } | { kind: 'other'; infringement: Known<number> }`: a corner-cutting warning (the warned span's `cornerCutting` count rose) keeps `count/limit`; any other warning carries its PENA infringement code. Readers: `incident-feed`, `race-moment` (ignores the warning detail).

### 3.4 `lap-times` (N5)

`LapBoardRow` gains:

- `newestSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>]`: per sector the newest finished time: sector 1 and 2 from the live `sector1TimeMs` and `sector2TimeMs` as soon as the car has passed the sector's end in the current lap, sector 3 (and all three) at the line;
- `newestSectorStatus: [SectorStatus, SectorStatus, SectorStatus]`: judged against the bests before that time;
- `newestSectorFromLap: [number, number, number]`: the lap each newest time belongs to, so the display can dim an older one without computing (C65).

`lastSectorsMs` and its status stay (other readers). Cadence unchanged (`frame`).

### 3.5 `damage` (N7)

Each `DamageJump` (its `lossMsPerLap` is the measured loss) gains:

- `measuring: Known<{ lapsDone: number; lapsNeeded: number }>`: while a jump's loss is being measured over `forPace` laps (`lapsNeeded` = the existing 2); `notApplicable` otherwise;
- `estimateMsPerLap: Known<Ms>`: from the car's mini-sectors since the jump against its median for those segments (the median of its earlier current crossings, pit and neutralised segments skipped), summed and scaled to 50 segments, after at least `minEstimateSegments` (config, 10); `notApplicable` once its `lossMsPerLap` is known, and `notApplicable` for a jump whose loss can never be measured (no pace laps before it), where it is the only number.

The per-segment median moves from `incidents` (`incidents.ts`) to `analysis/src/shared/segment-medians.ts`, one pure function both units call (C43, C45); `incidents`' behaviour is unchanged.

## 4. UI

| Input | Widget or shell | Change |
|---|---|---|
| N2 | `battle-cards` | Rows: GAP, PACE Δ (`s/lap`), `PASS` or `HOLD` (`s/lap`), DRS, tyres, ERS; CLOSING removed. Emphasis: a positive PASS bold white; a negative HOLD bold `warning`; no verdict words. |
| N3 | `gap-chart` | Draws only the `window` cars: ours white, the others `textFaint`; no team colours. The y range comes from the drawn series (kit `Chart`). Points per mini-sector are one line. |
| N4 | `incident-feed` | Our cars by driver code from `cars.overview` (`RUS P6→P7`), not `us`. Warnings: `warning · corner cutting 2/3`, `warning · collision`, from an infringement wording table in `kit/text.ts` (the F1 25 infringement codes of the UDP specification's appendix). |
| N5 | `timing-tower`, `lap-analysis` | S1–S3 from `newestSectorsMs` with their status colours; a sector whose `newestSectorFromLap` is older than the car's current lap in `textFaint`. |
| N6 | `fuel-gauge` | The kg shows whenever `kg` is known; lasts, burn and margin stay blank until known. |
| N7 | `damage-card` | While measuring: `measuring 1/2 laps`; with an estimate: `~+0.8 s/lap est.` in `textFaint`; the measured loss replaces both. |
| N8 | `projected-lap` | The finish margin through a new `formatMinutesTenths` (`kit/values/format.ts`, `18:48.6`) at 60 s or more, seconds below. |
| N10 | shell commands | One command per registered widget: id `panel.add.<widget>`, title "Add panel: <title>", group Window; adds the widget to the focused group through `docking.addPanel`; the existing layout save sends `workbook.updateWindow` (C67, C72, C73). No default key. |

`kit/text.ts`, `kit/values/format.ts` and `shell/commands/` are supervisor-owned: delegated changes in two phases.

## 5. Testing

- `battle`: PACE Δ over a window with pit and SC segments skipped; `insufficientData` below 25 segments; PASS and HOLD signs on both sides; incremental equals from scratch, also after a rewind; C31.1's proof; behaviour tables over the spans it reads.
- `gaps`: points per segment for the last 10 laps and per lap before; `window` membership at the boundary (exactly 10 s in, 10.001 s out); `now` unchanged.
- `incidents`: a corner-cutting warning keeps `count/limit`; a collision warning carries infringement 4.
- `lap-times`: S1 appears at the end of sector 1 with its status; after the line S2 and S3 of the previous lap remain with their lap number.
- `damage`: `measuring` counts `forPace` laps; the estimate after 10 segments, `notApplicable` once measured; `segment-medians` tests moved with the function, `incidents`' tests unchanged.
- Widgets: presentation and emphasis completeness (C66, C68); gallery cases per change; `fit.spec` over every case; the add-panel command sends `workbook.updateWindow` with the new panel.
- One segment test: `battle`'s PACE Δ on `race-zandvoort-full-lap` is known for a car pair after one lap and matches the difference of their gap change over the same segments within 1 ms.
