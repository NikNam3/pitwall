# Special situations: session phases and car situations (design)

Status: draft for the user's review (2026-10-30). Replaces the clock-reset rule of the live-test fixes (review findings B1, B4) and the scattered local rules for formation laps, garage stays, pit visits, penalties served, neutralisations, finishes and session ends.

## 1. Why

Live testing (a friend's race over VPN, 2026-10-30) and the review of its fixes showed one root cause behind several bugs: every module (`laps`, `stints`, `pit-stops`, `flags`, `fuel`, `lap-classes`, `gaps`, the tower) re-derives the same situation from raw game statuses in its own way, each rule added when a recording first showed the case. A fix in one module then broke another (the clock-reset rule dropped lights out in one race; the garage-restart rule restarted a race's final lap at the flag). The game's signals are noisy and out of step (inventory section 5), so local rules keep diverging.

User rulings (2026-10-30): model special situations explicitly, once: a situations catalogue grounded in our recordings plus engine-recorded spans that every reader uses (approach A: a situation tracker); show the situations in the UI; design the unrecorded situations now and verify them by recording; rates consistently per stint, fuel burn and ERS trend only over the stint's laps at the current fuel mix and ERS mode, with a per-lap conditions block for the future simulator; displays, calculators and analyses behave per situation, by an explicit behaviour matrix.

Facts this design rests on: `.superpowers/sdd/2026-10-30-storage-c-39-40/situations-inventory.md` (49 situations seen in 10 sessions, 5 never seen, 21 documented only) and `t1-diagnosis.md` (the four start shapes S1–S4). Both get copied into `docs/research/09-situations-catalogue.md` as the catalogue (section 9).

## 2. Principles

1. **One tracker, one place per rule.** A new engine history step, `situations`, runs first on every frame. It owns two state machines (the session phase, and each car's situation) and records every transition as a span in the history. No other module reads raw `pitStatus`, `driverStatus`, `resultStatus`, `safetyCarStatus`, SCAR, STLG, LGOT, RTMT, DTSV/SGSV, RDFL, CHQF/RCWN or SEND to decide a situation.
2. **Spans are history.** They follow every history rule: deterministic, truncated by flashbacks, rebuilt by reprocess, stored, `incremental = from scratch`.
3. **Signals are confirmed, not trusted singly.** Each transition names its opening signal, its confirming signal and the lag between them (inventory section 5: SCAR leads the Session status by 0.5–1.3 s; RTMT leads `resultStatus` by a frame; DTSV can come seconds after the pit exit). A transition opens on the earliest reliable signal and is dropped if its confirmation never comes (an SC undone by a flashback, a neutralisation announced before a simulated session end).
4. **Unrecorded situations fail safe.** Where only the F1 25 spec documents a signal (red flag, stop-go, joins, spectating, network pause), the tracker implements it, logs every transition it takes, and never discards history on it; the catalogue marks it "not yet seen". A recording confirms or corrects it.
5. **Behaviour is explicit per consumer.** Every analysis and display has a behaviour table (situation → what it does); a test fails when a situation is missing from a table (section 7).
6. **Session time is not a timeline.** It resets, holds, rewinds, runs up to 30× faster in the garage and jumps by hours into the post-session simulation (inventory 1.2–1.9). The tracker is the only place that interprets its jumps (section 3.3).

## 3. Session phases

### 3.1 Phases and transitions

| Phase | Opens on | Closes on | Notes |
|---|---|---|---|
| `preStart` | the session's first frame | the first STLG (race) or the session's running start (practice, qualifying) | grid; session time stays at a fixed value (0.000 offline) |
| `formation` | `safetyCarStatus` 3, or SCAR type 3 event 0, whichever first (seen in every formation lap; the `formationLap` setting is unreliable: 0 at first in every race, 1 in Mexico without a formation lap) | the first LGOT after an STLG (diagnosis P2/P3) | closing discards what the phase recorded (3.2) |
| `startLights` | the first STLG | LGOT | session time frozen (0.000 offline; 1.968 and 0.794 online) |
| `racing` (practice/qualifying: `running`) | LGOT (practice/qualifying: the first frame with the session clock running) | another phase | the race start is this phase's opening time; `gaps` takes it from here, not from the last LGOT |
| `neutralised` (kind SC or VSC, stage deployed / returning / returned / resume) | SCAR deployed (type 1 or 2, event 0) | SCAR resume (event 3) or `safetyCarStatus` 0, whichever first | confirmed by `safetyCarStatus` 1/2 within 2 Session packets; unconfirmed → dropped (inventory 1.4: SgW undone by FLBK, ZvR/ZvR2 before simulation). A VSC upgraded to SC (SC deployed while VSC on) closes the VSC span and opens an SC span at the same time. A VSC has no "returned" stage. Resume can come twice (types 1 and 0): the first closes |
| `suspended` (red flag; not yet seen) | RDFL | the restart: LGOT after STLG (standing restart, phase `startLights` between), or a change to `safetyCarStatus` 1 (rolling restart behind the SC) | fail safe (principle 4) |
| `finished` | RCWN (race winner) or CHQF, whichever first (MiR has both; MxR only RCWN) | SEND, or the post-session simulation | cars keep their own `finished` situations (4.1) |
| `post-session` | SEND (frame id 0), or a session-time jump forward of more than 60 s with no packets in between (the online simulation: inventory 1.7), or a UID-0 FinalClassification | end of the recording or a new session | nothing recorded here is race history; classifications are recorded as such |
| `paused` (overlay, not a phase) | offline: no packets with a frozen session time for over 2 s wall time; online: Session `gamePaused` 1 | packets again / `gamePaused` 0 | display only (top bar `PAUSED`); changes no other span |

Practice and qualifying use `preStart` → `running` → (`suspended`) → `finished` (time over: SEND with every car `resultStatus` 3) → `post-session`; no formation or start lights. Time trial: `running` only.

### 3.2 The formation phase is discarded at lights out

At `formation`'s close (the race's first LGOT after STLG), the tracker cuts the history back to the lengths it had when `formation` opened: everything recorded during the formation lap goes (its crossings, events such as the 24 formation-lap OVTK of raceZandvoortOnline, its DSQ/RTMT transient of the player, inventory 2.11). Kept: the STLG and LGOT events (race history), the session's identity and settings. Every lap cursor restarts with `fromStart` true at lights out (cars stand on the grid), the open pit visits, mini-sector cursors and snapshots restart. A car in the pit lane at lights out (a pit-lane start; not yet seen) opens its pit-lane situation at lights out with an unknown entry.

### 3.3 Session-time jumps

- **Flashback** (FLBK, or the frame id falling while the overall frame id rises): unchanged; the runner rewinds.
- **The start's settling** (diagnosis P4): a fall within 60 frames after the race's LGOT (seen: 4 and 12 frames, ZvR and ZvR2) is the race clock settling; entries stamped since LGOT are re-stamped to the new clock (offset by the fall), cursors' `trackedMs` too.
- **The formation reset** (the fall at the formation lap's end, inventory 1.2): ignored by itself; the formation phase's close (3.2) handles it.
- **Garage acceleration** (session time running ahead of wall time): no jump; nothing to do (laps are not timed in the garage).
- **Post-session jump** (3.1): opens `post-session`.
- **Any other fall or jump** (not a flashback): changes nothing and is logged with the session uid and both times. Not seen in any recording outside the start.

### 3.4 Race control state

Recorded by the tracker as spans too:
- **DRS** (on, or off with a reason): DRSE / DRSD events (the engine maps an unknown reason code to `unknown`). In a race before lights out: off, `notEnabledYet`. After a late join (no lights out seen) with no DRS event: on. A DRSD before lights out (a wet start) stands until a DRSE. `BattleCard.drs` reads these spans (replaces the helper of the live-test fixes).
- **Weather and temperatures** per Session packet, as the lap conditions read them (4.4).
- **Track condition** (`dry` / `damp` / `wet`; user ruling 2026-10-30): a span over the session, from three signals, the field's tyre choice first:
  - the share of running cars on intermediates or wets (visual compounds 7, 8): below 25 % points to `dry`, 25–75 % to `damp`, above 75 % to `wet` (the field reacts to the track; Mexico's weather said storm all race while the switch from wets to intermediates on lap 5 showed the track drying);
  - the Session weather (0 clear … 5 storm) and the rain forecast: light rain with the field still on slicks points to `damp` (rain starting); clear or light cloud with the field on intermediates points to `damp` (drying);
  - DRSD with reason wet track confirms `wet` or `damp`.
  A new condition takes over only after it held for 30 s of session time (hysteresis; no flicker at a shower's edge). The 25/75 % shares and the 30 s are pitwall estimates with source notes, checked against `raceSingaporeWet` (rain coming and going), `raceWetVscMexico` and `raceFriendWet`. Before the first running car's tyres are known: `unknown('notReceived')`.

## 4. Car situations

### 4.1 Situations and transitions

| Situation | Opens on | Closes on | Notes |
|---|---|---|---|
| `garage` | `driverStatus` 0 | `driverStatus` ≠ 0 | covers the ps 0/1 variants in the garage, the entry without ps 2, the teleports into the garage (ds 2→0 with ps 0→1; the player's "return to garage"), retired cars put into the garage (their pit status after that is ignored) |
| `pitLane` | `pitStatus` ≠ 0 outside the garage | `pitStatus` 0 (the exit frame) | a race lap crossed in the pit lane rises (every recorded box lies after the line); a practice/qualifying lap does not |
| `stationary` (within `pitLane`) | `pitStatus` 2, or the pit stop timer running | `pitStatus` back to 1 | a `pitLane` span with a `stationary` part is a **stop**; one without is a **pass-through** |
| `servingPenalty` (within `pitLane`) | drive-through: a pass-through (or a stop) during which `numUnservedDriveThroughPens` falls, matched to its DTSV (which can arrive up to ~10 s after the exit: MiR 7.1 s); stop-go: the `stationary` part with SGSV (not yet seen) | the pit exit | the PENA that gave the penalty is linked |
| `onTrack` | otherwise, while the session phase is `racing` / `running` / `neutralised` | another situation | carries the lap role (4.2) |
| `retired` | RTMT (leads `resultStatus` 7 by a frame), or `resultStatus` 7, 4 (DNF) or 5 (DSQ) confirmed (4.3) | never (session) | closes every open span of the car; the cause comes from PENA 16 with infringement 41 (mechanical) / 42 (terminal damage), not from RTMT's reason (always 0) |
| `finished` | `resultStatus` 3 at a line crossing (the lap number does not rise; `currentLapTimeInMS` freezes at 26–30 ms) | `coolDown` | the last frame before SEND sets every running car to `resultStatus` 3 mid-lap: that is the session end, not a finish (no `finished` span, the car's last lap stays unfinished) |
| `coolDown` | after `finished` | session end | cool-down laps are no laps |
| `joinedLate` / `spectated` (not yet seen) | a car appearing in Participants mid-session; `isSpectating` 1 | | fail safe |

### 4.2 Lap roles, laps and stints

- **Out lap:** the lap during which the car leaves the `pitLane` or the `garage`, once. **In lap:** the lap during which the car enters the `pitLane` (race) or the `garage` (practice/qualifying). A drive-through lap is both. Everything else is **flying**. `driverStatus` is not read (its in-lap flag can come a lap early, its out-lap flag flickers: inventory 2.5).
- **Lap numbers:** race: a line crossed in the pit lane starts the next lap (the in lap ends there). Practice/qualifying: the lap number stays through the garage; the lap restarts at the line after the out lap (replaces the wrap and timer rule; fixes RE-B3, never applied in a race).
- **Cool-down and post-session:** no lap records.
- **Stints:** a stint closes and the next opens when the car leaves a `stationary` part or the `garage` on a different set (compound change, or a fitted set with a lower age than the old set's at fitting; the set read at that exit). Replaces the deferred split (fixes RE-B5). A tyre change during `suspended` (red flag in the pit lane) opens a stint the same way.
- **Pit stops:** a `PitStopRecord` per stop (`pitLane` with `stationary`); a pass-through for a penalty is a `PenaltyServedRecord` (new) linked to the penalty; garage departures, garage teleports and retired cars' pit statuses give none.

### 4.3 Confirmations

- `resultStatus` 5 (DSQ) needs a PENA type 6, or 2 s unchanged, before `retired` opens (the formation-lap DSQ transient, inventory 2.11, is discarded with the formation phase anyway).
- A PENA 16/42 before RTMT (ZvR2 car 2: 4 s) opens nothing by itself; RTMT or `resultStatus` 7 does.

### 4.4 Lap conditions (for rates and the future simulator)

`LapRecord.conditions`: the fuel mix and the ERS deploy mode used for most of the lap with their shares of the lap (from CarStatus), the weather at the lap's start and end, the track and air temperature at the lap's start and end (from the Session packet), and the track condition at the lap's start and end (3.4). Known only for laps the engine saw from their start.

## 5. Readers

| Reader | Today | After |
|---|---|---|
| `history/laps.ts` | interprets pit and driver status, the wrap/timer restart | lap roles and restarts from the car spans (4.2); `scShare`/`vscShare` from `neutralised` spans; no records in `coolDown`/`post-session` |
| `history/pit-stops.ts` | pit status 0 → back | `PitStopRecord` and `PenaltyServedRecord` from the spans |
| `history/stints.ts` | compound/age changes, deferred split | stint at the exit of `stationary`/`garage` (4.2) |
| `history/flags.ts` | SCAR, status, RDFL, LGOT | removed; `FlagPhase` records (if still needed by readers) are produced from `neutralised`/`suspended` spans, or every reader moves to the session phases (preferred) |
| `runner/session-runner.ts`, `history/clock-reset.ts` | clock-reset rule | removed; section 3.3 |
| `analysis/gaps` | race start = last LGOT | race start = the `racing` span's opening; phases for the gapper from the spans |
| `analysis/shared/drs-status.ts` | from events | replaced by the race-control spans (3.4) |
| `analysis/lap-classes` | in/out lap, neutralised share | the same from the spans; cool-down laps never classified |
| rates (`tyre-wear`, `fuel`, `ers`) | stint laps | per stint; fuel and ERS only the stint's laps at the current mix / mode (`conditions`) |
| `analysis/incidents`, `damage`, `alarms`, `race-moment`, `battle`, `session-remaining` | flag phases, pit status | the behaviour matrix (section 6) |
| displays | the tower's PIT/OUT column guesses from statuses | render the `situation` and `session.phase` topics (section 8) |

## 6. Behaviour matrix

Every analysis gets the view's current session phase and the car's situation (`view.situation`, extending `activeFlagPhase`). Each analysis and display holds a table with one row per situation; the matrix below is the reference. "—" means the output is `notApplicable` for that car or session in that situation.

| Situation | rates (`tyre-wear`, `fuel`, `ers`) | `pace`, `lap-times`, `lap-classes` | `gaps`, gapper, `battle` | `incidents` | `damage` | `car-bands` | `alarms` | `race-moment` | `session-remaining` |
|---|---|---|---|---|---|---|---|---|---|
| `preStart` | — | — | grid order only | none | live | live, no lap judgement | none | — | full duration |
| `formation` | — (discarded) | — | — | none (discarded) | live | live, no lap judgement | none | `formation` | full |
| `startLights` | — | — | grid order | none | live | live | none | `start` | full |
| `racing` / `running` | samples | samples | live | live | live | live + lap judgement | live | its rules | counting |
| `neutralised` | no samples from laps with ≥ 2 s neutralised | not for pace | live gaps (the queue); battles: `lapsToDrs` `notApplicable` (DRS off), gap closing not judged | entries stay; `neutralised` entry | live | live | car care live; battle alarms off | `neutralised` | counting |
| `suspended` | frozen (no laps) | frozen | frozen at the red flag; the restart order from the game | `suspended` entry | live | live, no lap judgement | car care off | `suspended` | frozen (the game's) |
| `finished` (session) | final | final | final order; no live point | final | final | off | resolved | `finished` | 0 |
| `post-session` | — | — | — | none | — | — | none | — | — |
| car `garage` | frozen for that car; a set change opens a stint | no lap | the car leaves the order views in practice/qualifying; in a race (retired) — | none | live (repairs show) | off | none for that car | — | — |
| car `pitLane` / `stationary` | the in and out laps give no samples | no pace | gap keeps running (pit loss visible) | the stop is no incident; time loss in the pit lane is none | live (repairs show) | off while stationary | car care off while stationary | — | — |
| car `servingPenalty` | that lap gives no sample | no pace | gap keeps running | the penalty entry shows "served" | live | off while stationary | the penalty is no longer pending | — | — |
| car `onTrack` out/in lap | no sample | no pace | live | live | live | live, no lap judgement for out/in laps | live | — | — |
| car `retired` | stopped | final | out of gaps, battles and the neighbourhood | the retirement entry | final | off | resolved | `incident` if major | — |
| car `finished` / `coolDown` | no samples | final | final position; no live point | none | final | off | resolved | — | — |
| `paused` (overlay) | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | none new | unchanged | unchanged |
| track `dry` / `damp` / `wet` (race control) | per stint as always (a compound change opens a stint); no other change | pace, pace delta and the bests compare only laps whose condition at start and end is the same as each other's; the session bests are kept per condition and the board shows the current condition's | battle pace delta over laps of the current condition only; the gapper's leader-average reference over laps of the current condition (a condition change restarts the reference) | a condition change is a `trackCondition` entry | live | bands per tyre kind as today | for our cars: a tyre kind that does not fit the condition (slicks on `wet`, wets on `dry`) raises an advisory | `weather` when the condition changes within the forecast window | unchanged |

Display rows (each display's table follows them): the tower shows the car situation (section 8) and leaves rates and gaps of an out-of-race car as "–"; the battle cards show "DRS off" with the reason while neutralised and hide a retired neighbour; the gap chart draws `neutralised`/`suspended` bands and no live point after a finish; the incident feed lists the phase entries; the fuel gauge, ERS budget and tyre-life bar show their values frozen with the "–"/"…" marks of their reasons; the corner block and the damage card stay live in the garage and pit lane (repairs, temperatures); the alarm list follows `alarms`; the top bar shows the session phase (section 8).

## 7. Tests

- **Per situation:** a segment where recorded (the catalogue names its window, under 1 MB, cut from a normal session), else builder data; the four start shapes S1–S4 each with a segment (diagnosis: Singapore wet [0, 1.6] 672 KB, Zandvoort online [0, 2.1] 453 KB, Zandvoort uid-reuse [0, 1.0] 588 KB; S1 `race-singapore-start`); the existing `race-zandvoort-clock-reset` segment becomes the "a fall that is no start changes nothing" case.
- **Per matrix row:** each consumer's behaviour table is tested row by row (builder views with the situation set).
- **Completeness:** a test enumerates every situation kind and every consumer's table, and fails when a table lacks a kind.
- **Properties:** determinism and incremental = from scratch across every transition; flashbacks across a span boundary.
- **Acceptance:** the whole-pipeline properties as today; determinism over the recordings in its set.

## 8. Topics and display

- `session.phase` (new): the current phase with `since` and its details (SC stage; the red flag's restart kind), and the list of spans.
- `cars.overview`: each car gets `situation: { kind, since, detail }` (the penalty being served, the lap role).
- Top bar: a session-phase segment, shown only when the phase is not `racing`/`running`: FORMATION, START, SC/VSC with its stage, RED, FINISHED, PAUSED; SC/VSC/RED in the attention role, the rest grey.
- Top bar: the track condition beside it, shown only when not `dry`: DAMP, WET (grey; the alarm carries the attention for a car on the wrong tyre).
- Tower: the PIT column becomes a situation column: GARAGE, PIT, BOX, DT, SG, OUT, IN, RET, FIN (nothing on a flying lap); DT/SG in the penalty role, RET/FIN dimmed like out-of-race rows.
- Wording in each widget's `text.ts` and the kit text; roles in the emphasis files.

## 9. Catalogue and recordings

- `docs/research/09-situations-catalogue.md`: per situation the signals (with times in our recordings), the tracker's rule, the behaviour row, the test (segment or builder) and "seen in" or "not yet seen".
- **Recording checklist** (the user records; each recording is labelled, cut into segments and confirms or corrects its rule): a race with a red flag and a standing restart; a red flag with a rolling restart behind the SC; a stop-go served; a restart behind the SC; a stop under the VSC; a qualifying Q1 → Q2 → Q3; a session restarted from the menu; an online race with a pause; a car joining mid-session; a pit-lane start; a race that dries from wets to slicks; a dry race that turns wet.

## 10. Rollout

Each step: test phase, implement phase, review; gates before merging into `integ/live-fixes`, then to main.

1. **Tracker and session phases** (sections 3.1–3.3): replaces the clock-reset rule; the formation phase discarded at lights out; the start segments; also the frame assembler's stale-header drop (raceZandvoortUidReuse loses its first ~10.5k frames to 337 LapPositions headers frozen at frame 10539) so that start is seen. **Merge to main after this step** (fixes B1, B4).
2. **Car situations and the lap, pit and stint rewrite** (section 4): takes in wave-2 T4's tests (RE-B3, RE-B5) and T5's tests (rates per stint, mix/mode filter), the lap conditions, `PenaltyServedRecord`.
3. **Race control spans** (3.4): DRS; takes in wave-2 T3's tests.
4. **Analyses on the matrix** (section 6), with the completeness test.
5. **Topics and display** (section 8).
6. **Catalogue document** (section 9) and the recording checklist to the user.

## 11. Open points for the user's review

- `FlagPhase` records: keep them as a view produced from the spans (fewer reader changes) or move every reader to the session phases (cleaner; this design prefers it).
- The 60-frame bound of the start's settling (3.3) and the 2 s DSQ confirmation (4.3): observed values plus margin; adjust if a recording disagrees.
