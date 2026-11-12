# The situations catalogue

The catalogue of the machine (contract C15–C19, C85): one section per sub-machine, with its scope, `appliesTo`, inputs and kinds, its transitions with the signal or value behind each and its timing, the test rows and segments that cover it, and whether a recording shows it. Written 2026-11-04 (migration Task 29) from the code under `packages/engine/src/situations/`, the span declarations under `packages/domain/src/situations/`, the transition tables under `packages/engine/test/situations/<id>/<id>.transitions.ts`, the inventory (`docs/research/09-situations-inventory.md`, cited as §) and the scan below.

A sub-machine's code and its transition table are the rule; this file describes them. A change to a sub-machine's transitions changes its section here.

## How to read it

- **Order:** step 0's clock first (C7), then the sub-machines in step 2's order (`MACHINE_ORDER`, `situations/registry.ts`): each after its declared upstreams.
- **From → to:** a declared transition (`transitions` in the sub-machine). `none →` is a scope's first span; a span closed with no successor on its frame would be `→ none`, which no sub-machine declares (the spans of a scope have no gaps, C85).
- **Signal or value, and its timing:** what the code reads for the transition, with the times the inventory gives. Recordings are cited by the inventory's short names (SgR, SgQ, SgW, ZvP, ZvR, ZvP2, ZvR2, MxR, MiP, MiR; its table "Recordings covered"); MiP is the fixture `practiceFriendWings`, MiR the fixture `raceFriendWet`, and "the sprint" the recording 2026-11-02_15-17-14 (§6.2).
- **Test rows:** the row names in the sub-machine's transition table; `join:` marks a join row (a session joined in progress: the new span carries `joinedAt`). The generic test `packages/engine/test/situations/transitions-completeness.test.ts` runs every row.
- **Segment:** the committed segments (`fixtures/segments/`, listed in `docs/testing.md` §3) whose segment test asserts the transition on the produced spans. A segment starts mid-session, so its first spans are joins: a join a segment shows can be one no whole recording shows.
- **Scan:** `seen (n)` when the scan counted the transition n times over every recording; `not yet seen` otherwise (C19). A count sums every scope (every car, every zone) and every session; `none →` counts a join and a first opening alike. The scan counts transitions, not their causes: a row whose name says "not yet seen" names a cause no recording has shown, also where its transition is seen by another cause.

## The scan

`pitwall scan-situations` (`apps/bridge/src/cli/commands/scan-situations.ts`) runs frame assembly and the engine over every recording and counts, per sub-machine and scope, each transition between the spans of the projection, by frame number (C26). Run on 2026-11-04 at `migrate/integ` 063ba46 over the 14 recordings of `recordings/`:

```
PITWALL_FIXTURES_DIR=<main checkout>/recordings nice -n 10 pnpm pitwall scan-situations <main checkout>/recordings
```

- 256 declared transitions over 19 sub-machines (the clock included): 110 seen, 146 not yet seen; no undeclared transition (exit code 0). The output is kept outside git with the migration's reports (`.superpowers/sdd/2026-11-02-contract-migration/reports/scan-situations-m7.txt` in the main checkout).
- The time trial (`ttZandvoort`, 2026-10-27_23-31-43) has the weekend phase `none`: only the shared sub-machines run in it. `menuOnly` (2026-10-27_22-50-28) and `lobbyOnly` (2026-10-29_22-35-28) hold no session to count.
- The spans a session's end closed (`closeSession`) are no transition and are not counted.

## 0. clock (step 0)

- **Scope:** session. **Applies to:** every session (step 0, C7); no member of the step-2 registry (`STEP0_CLOCK`, `situations/clock/clock.ts`).
- **Reads:** the frame's session time, the runner's flashback report, receive-time differences, `gamePaused` (from the frame) and whether the session is online (from the previous frame's live state). Sub-machines read it as `MachineInput.clock` (`paused`, `offsetMs`, `simulatedEnd`), not as an upstream.
- **Kinds:** `running` (no detail), `paused` (`PausedDetail`: `source` `offline` or `online`, `wallMs` the pause's wall time). The spans tile the session.
- **Clock facts** (no spans): `fall` (every fall of the session time that is no flashback, carried over by an offset, C36), `jump` (a forward jump of more than 60 s, `SIMULATION_JUMP_MS`), `simulatedEnd` (once: a jump of more than 60 s that also outruns wall time by more than 60 times, `SIMULATION_RATE`). Garage time acceleration (up to 31.6 times wall time, §1.9) is none of them.
- **Constants:** `PAUSE_AFTER_WALL_MS` 2000 (`clock/pauses.ts`), `SIMULATION_JUMP_MS` 60 000 and `SIMULATION_RATE` 60 (`clock/jumps.ts`).
- **Tests:** `test/situations/clock/` (`clock.test.ts`, `clock.property.test.ts`, `clock.segments.test.ts`; the segments there cover falls and flashbacks, not the clock's spans).

**Transitions** (4 declared; 3 seen, 1 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → running | the session’s first frame (not an online pause) | join: “the session’s first frame opens running” | – | seen (12) |
| none → paused | the session’s first frame of an online session with `gamePaused` 1 | join: “online: the session’s first frame, already paused by the game, opens paused” | – | not yet seen |
| running → paused | online: `gamePaused` 0 → 1 (ZvP 339.456, inventory §1.8); offline: no frame for more than 2 s (`PAUSE_AFTER_WALL_MS`) of wall time beyond what the session time advanced (recorded gaps 9.3–162.3 s, §1.8; 3.4–9.0 s before each flashback, §1.10); the paused span opens and closes on the frame after the gap | “online: gamePaused 1 closes running and opens paused”; “offline: a gap of more than 2 s closes running and opens a paused span on the frame after it” | – | seen (17) |
| paused → running | online: `gamePaused` 1 → 0 (ZvP 377.151); offline: the frame after the gap, on which the paused span opened | “online: gamePaused 0 closes paused and opens running”; “offline: the paused span of a gap closes on the frame it opened on, and running opens there” | – | seen (17) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the session’s first frame opens running” | running |
| “online: the session’s first frame, already paused by the game, opens paused” | paused |

## 1. car-location

- **Scope:** car. **Applies to:** `all`. **Upstream:** none.
- **Reads:** the signals `driverStatus` and `pitStatus`; the identity area (the arrival of the car's Participants data).
- **Kinds:** `garage` (driver status in the garage, whatever the pit status), `pitLane` (otherwise pit status pitting or in the pit area), `track` (otherwise). No detail.
- **Rule:** a new span on every change of the location. A car's first span opens on the first frame its Participants data is in the live state, with `joinedAt`; before it no span opens (C3).

**Transitions** (9 declared; 8 seen, 1 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → garage | the first frame with the car’s Participants data, driver status in the garage | join: “the first frame with Participants data, a car in the garage: garage (join)” | `practice-garage-exit`, `practice-wing-change`, `race-zandvoort-retire` | seen (121) |
| none → pitLane | the first frame with the car’s Participants data, pit status pitting or in the pit area | join: “the first frame with Participants data, a car in the pit lane: pitLane (join)” | – | not yet seen |
| none → track | the first frame with the car’s Participants data, otherwise | join: “the first frame with Participants data, a car on track: track (join)” | `practice-garage-exit`, `practice-wing-change`, `race-zandvoort-pit-stop`, `race-zandvoort-retire` | seen (143) |
| garage → pitLane | driver status 0 → 3 at the box with pit status still 1 (MiP 641.422, §2.2) | “leaving the garage, ds 0 -> 3 with ps still 1 (MiP 641.422): garage -> pitLane” | `practice-garage-exit` | seen (36) |
| garage → track | driver status 0 → 3 and pit status 1 → 0 on one frame, under time acceleration (SgQ 138.968 and SgQ AI, §2.2) | “leaving the garage under time acceleration, ds 0 -> 3 and ps 1 -> 0 in one frame (SgQ 138.968): garage -> track” | – | seen (39) |
| pitLane → track | pit status 1 → 0 at the pit exit (MiP 649.872; race exits §2.5, with `pitLaneTimerActive` 1 → 0 on the same frame) | “the pit exit, ps 1 -> 0 (MiP 649.872): pitLane -> track” | `practice-garage-exit` | seen (126) |
| pitLane → garage | driver status 2 → 0 at the box: after one frame of pit status 2 (MiP 542.845 / 542.879) or with pit status staying 1 (SgQ car 1 332.118), §2.1 | “into the garage box, one frame of ps 2, then ds 2 -> 0 with ps 2 -> 1 (MiP 542.845 / 542.879): pitLane -> garage”; “into the garage box with ps staying 1 and no ps 2 (SgQ car 1 at 332.118): pitLane -> garage” | – | seen (30) |
| track → pitLane | pit status 0 → 1 at the pit entry; the in-lap driver status 2 leads it by 0.1–6 s (§2.5) | “the pit entry, ps 0 -> 1 on the in lap (ZvR2 548.387): track -> pitLane” | `race-zandvoort-pit-stop` | seen (121) |
| track → garage | a teleport (§2.4): the player’s return to the garage, driver status 1 → 0 with pit status 0 (SgQ 467.514); an AI in lap under time acceleration, driver status 2 → 0 and pit status 0 → 1 on one frame (SgQ 501.014, MiP); a retired car about 70 s after its retirement, driver status 4 → 0 (MxR car 2 272.748; ZvR2 car 2 after 10 s) | “the player’s return to the garage mid-lap, ds 1 -> 0 with ps 0 (SgQ 467.514): track -> garage”; “an AI in-lap teleported into the garage, ds 2 -> 0 and ps 0 -> 1 in one frame (SgQ, MiP): track -> garage”; “a retired car put into the garage, ds 4 -> 0 with ps 0 -> 1 (MxR car 2 at 272.748): track -> garage” | – | seen (18) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the first frame with Participants data, a car in the garage: garage (join)” | garage |
| “the first frame with Participants data, a car in the pit lane: pitLane (join)” | pitLane |
| “the first frame with Participants data, a car on track: track (join)” | track |

## 2. car-status

- **Scope:** car. **Applies to:** `all`. **Upstream:** none. The one decider of which cars are in the session (C43): a car is in the session while its span is not `absent` (`car-status/in-session.ts`); a slot is in use by `slotsInUse` (`numActiveCars` plus one slot per car out of the race, `car-status/slots.ts`).
- **Reads:** the signals `resultStatus`, `numActiveCars` and the events (RTMT, PENA); the identity area.
- **Kinds:** `competing`, `retired` (`RetiredDetail`: `cause`, `Known<'mechanical' | 'terminalDamage' | 'other'>`, the cause known on the opening frame: the PENA 16 infringement 41 or 42, else the RTMT reason, else `unknown('notReceived')`; never rewritten), `disqualified` (opens `confirmed: false`; confirmed by a PENA of type 6 or 2 s unchanged, `DSQ_CONFIRM_MS` 2000; a change first closes it `confirmed: false`, C18), `absent`.
- **Rule:** the result status maps to a kind when it changes (active and finished `competing`; retired, did not finish and not classified `retired`; disqualified `disqualified`; invalid and inactive `absent`); a competing car also retires on a PENA of type 16 or an RTMT, and an RTMT with reason black flagged disqualifies it. An RTMT or PENA 16 for a car already retired opens nothing (the game resends RTMT after a flashback, §1.10). A car's first span opens with its Participants data, with `joinedAt`.

**Transitions** (16 declared; 5 seen, 11 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → competing | the first frame with the car’s Participants data, result status active or finished | join: “the first frame with Participants data, a car in the session: competing (join)” | `race-zandvoort-retire`, `race-zandvoort-pit-stop`, `practice-wing-change`, `practice-garage-exit` | seen (216) |
| none → retired | the first frame with the car’s Participants data, result status retired, did not finish or not classified | join: “the first frame with Participants data, a car already retired: retired (join; ZvR2 car 2)” | `race-zandvoort-retire` | not yet seen |
| none → disqualified | the first frame with the car’s Participants data, result status disqualified | join: “the first frame with Participants data, a car disqualified: disqualified (join)” | – | not yet seen |
| none → absent | the first frame with the car’s Participants data, a slot no car of the session holds (`slotsInUse`, result status invalid or inactive) | join: “the first frame with Participants data, a slot past numActiveCars: absent (join)” | `race-zandvoort-retire`, `race-zandvoort-pit-stop`, `practice-wing-change`, `practice-garage-exit` | seen (48) |
| competing → retired | the earliest of a PENA of type 16, an RTMT and the result status retired (§2.9): AI mechanical failure RTMT reason 0, result status 7 0.01–0.03 s later, PENA 16/41 about 1.0 s after the RTMT; terminal damage PENA 16/42 4 s before the RTMT (ZvR2 car 2 912.011 / 916.028) or on its frame (the player) | “PENA 16/42 opens it, 4 s before its RTMT (ZvR2 car 2, 912.011 / 916.028): competing -> retired”; “the RTMT, reason invalid (0), opens it, rs 7 a frame later and PENA 16/41 about 1 s later (AI mechanical failure, MxR, SgW, MiR): competing -> retired”; “the RTMT and PENA 16/42 on one frame (the player’s terminal damage, ZvR2 1207.667): competing -> retired”; “an RTMT with reason mechanical failure, cause mechanical (not yet seen: every recording sends 0): competing -> retired”; “an RTMT with reason terminal damage, cause terminal damage (not yet seen): competing -> retired”; “an RTMT with reason retired, not enough laps completed, red flagged or inactive, cause other (not yet seen): competing -> retired”; “the result status retired with no RTMT: competing -> retired”; “the result status not classified (not yet seen, mapped from the spec): competing -> retired” | `race-zandvoort-retire` | seen (16) |
| competing → disqualified | result status disqualified (5), or an RTMT with reason black flagged; open unconfirmed until a PENA of type 6 or 2 s unchanged (`DSQ_CONFIRM_MS`) | “an RTMT with reason black flagged (not yet seen): competing -> disqualified”; “the result status disqualified (ZvR formation lap): competing -> disqualified” | – | seen (1) |
| competing → absent | the slot leaves `slotsInUse` or its result status turns invalid or inactive | “the slot marked inactive: competing -> absent (not yet seen)” | – | not yet seen |
| retired → competing | the result status active again after retired | “the result status active again after retired: retired -> competing (not yet seen)” | – | not yet seen |
| retired → disqualified | result status disqualified after an RTMT (ZvR formation lap: RTMT 125.339, result status 5 at 125.371, §1.2) | “an RTMT, then the result status disqualified a frame later (ZvR 125.339 / 125.371): retired -> disqualified” | – | not yet seen |
| retired → absent | the result status invalid or inactive after retired | “the result status invalid after retired: retired -> absent (not yet seen)” | – | not yet seen |
| disqualified → competing | the result status active again (ZvR: at the formation reset, after 6 s disqualified; §1.2, §2.11) | “the result status active again after a disqualification held over 2 s (the ZvR formation reset): disqualified -> competing” | – | seen (1) |
| disqualified → retired | the result status retired after disqualified | “the result status retired after disqualified: disqualified -> retired (not yet seen)” | – | not yet seen |
| disqualified → absent | the result status invalid or inactive after disqualified | “the result status invalid after disqualified: disqualified -> absent (not yet seen)” | – | not yet seen |
| absent → competing | the slot comes into use (`numActiveCars` rises) | “numActiveCars rises and slot 1 comes into use: absent -> competing (not yet seen)” | – | not yet seen |
| absent → retired | a slot that comes into use with the result status retired | “a slot marked invalid whose car then shows retired: absent -> retired (not yet seen)” | – | not yet seen |
| absent → disqualified | a slot that comes into use with the result status disqualified | “a slot marked invalid whose car then shows disqualified: absent -> disqualified (not yet seen)” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the first frame with Participants data, a car in the session: competing (join)” | competing |
| “the first frame with Participants data, a car already retired: retired (join; ZvR2 car 2)” | retired |
| “the first frame with Participants data, a car disqualified: disqualified (join)” | disqualified |
| “the first frame with Participants data, a slot past numActiveCars: absent (join)” | absent |

## 3. weekend-phase

- **Scope:** session. **Applies to:** `all`. **Upstream:** none. It decides which sub-machines run (C14).
- **Reads:** the signals `sessionType` and `weekendStructure`.
- **Kinds:** `practice` (`PracticePhaseDetail`: `format` `practice` or `shortPractice`, `segment` 1–3 or undefined), `qualifying` (`QualifyingPhaseDetail`: `format` `grandPrix`, `short`, `oneShot`, `sprintShootout`, `shortSprintShootout` or `oneShotSprintShootout`, `segment`), `race` (`RacePhaseDetail`: `format` `grandPrix` or `sprint`), `none` (a time trial or an unknown session type).
- **Rule:** one span per session, never changed. Session types 1–17 open it on the first frame whose signals carry a weekend structure; until then no span is open and the weekend phase is `pending`. Types 0, 18 and above open `none` on the machine's first frame. A race type is the sprint when the structure lists a later race type. The span carries `joinedAt` when it opens on the machine's first frame.

**Transitions** (4 declared; 4 seen, 0 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → practice | session type 1–4, on the first Session packet that carries a weekend structure | “type 1, practice 1: pending until the structure arrives, then practice”; “type 2, practice 2: pending until the structure arrives, then practice”; “type 3, practice 3: pending until the structure arrives, then practice”; “type 4, short practice: pending until the structure arrives, then practice”; join: “joins a session in progress: type 3, practice 3” | – | seen (3) |
| none → qualifying | session type 5–14, on the first Session packet that carries a weekend structure | “type 5, qualifying 1: pending until the structure arrives, then qualifying”; “type 6, qualifying 2: pending until the structure arrives, then qualifying”; “type 7, qualifying 3: pending until the structure arrives, then qualifying”; “type 8, short qualifying: pending until the structure arrives, then qualifying”; “type 9, one-shot qualifying: pending until the structure arrives, then qualifying”; “type 10, sprint shootout 1: pending until the structure arrives, then qualifying”; “type 11, sprint shootout 2: pending until the structure arrives, then qualifying”; “type 12, sprint shootout 3: pending until the structure arrives, then qualifying”; “type 13, short sprint shootout: pending until the structure arrives, then qualifying”; “type 14, one-shot sprint shootout: pending until the structure arrives, then qualifying”; join: “joins a session in progress: type 6, qualifying 2” | – | seen (1) |
| none → race | session type 15–17, on the first Session packet that carries a weekend structure; format `sprint` when the structure lists a later race type (the sprint: empty structure in the first Session packet, [15, 16] from st 1.505, §6.2) | “type 15, race alone: pending until the structure arrives, then race”; “type 16, race 2 alone: pending until the structure arrives, then race”; “type 17, race 3 alone: pending until the structure arrives, then race”; “type 15 in [15, 16] is the sprint: pending until the structure arrives, then race”; “type 16 in [15, 16] is the grand prix: pending until the structure arrives, then race”; “type 15 in [10, 15, 16] is the sprint: pending until the structure arrives, then race”; “type 16 in [10, 15, 16, 7] is the grand prix: pending until the structure arrives, then race”; join: “joins a session in progress: type 16 in [15, 16] is the grand prix” | `race-sprint-start` | seen (7) |
| none → none | session type 0, 18 (time trial) or above 18, on the machine’s first frame; no structure needed | join: “type 0, unknown: none at once, no structure needed”; join: “type 18, time trial: none at once, no structure needed”; join: “type 19, an unknown type: none at once, no structure needed”; join: “type 19 above 18 is none at once”; join: “type 20 above 18 is none at once”; join: “type 42 above 18 is none at once”; join: “type 255 above 18 is none at once” | – | seen (1) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “type 0, unknown: none at once, no structure needed” | none |
| “type 18, time trial: none at once, no structure needed” | none |
| “type 19, an unknown type: none at once, no structure needed” | none |
| “type 19 above 18 is none at once” | none |
| “type 20 above 18 is none at once” | none |
| “type 42 above 18 is none at once” | none |
| “type 255 above 18 is none at once” | none |
| “joins a session in progress: type 3, practice 3” | practice |
| “joins a session in progress: type 6, qualifying 2” | qualifying |
| “joins a session in progress: type 16 in [15, 16] is the grand prix” | race |

## 4. session-phase-practice

- **Scope:** session. **Applies to:** `practice`. **Upstream:** `weekend-phase`, `car-status`.
- **Reads:** the signals `events` (RDFL, SEND) and `resultStatus`; the session area (time left, duration); the clock's `simulatedEnd`.
- **Kinds:** `grid`, `running`, `suspended` (`SuspendedDetail`: `restart`, `Known<'standing' | 'rolling'>`, unknown here), `finished`, `postSession`. Code shared with qualifying: `situations/session-phase/timed.ts`.
- **Rule:** `grid` while the session clock stands, `running` once it runs; `suspended` on RDFL (no restart signal is known, so a suspension ends only with finished or the post-session, C19); `finished` when SEND comes with every car in the session finished; `postSession` on SEND or the clock's simulated end. The session's end is a signal, never the final classification's arrival.

**Transitions** (10 declared; 2 seen, 8 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → grid | the machine’s first frame, the time left equal to the duration | “the first frame before the session clock runs opens grid” | – | not yet seen |
| none → running | the machine’s first frame, the time left below the duration (MiP starts mid-session at st 121.552, §1.11) | join: “joins a session in progress: the time left below the duration (MiP, 121.6 s)” | – | seen (3) |
| grid → running | the session time moves on from the previous frame | “the session clock starts: grid closes and running opens” | – | not yet seen |
| running → suspended | RDFL (`restart` unknown; no restart signal is known) | “a red flag suspends the session” | – | not yet seen |
| running → finished | SEND with every car in the session at result status finished: time over (SgQ 900.594: every car result status 2 → 3 on the last frame, SEND at the same session time, §1.6) | “time over: SEND with every car finished closes running with finished (SgQ)” | – | not yet seen |
| suspended → finished | SEND with every car in the session finished, under a red flag | “time over under a red flag: SEND with every car finished closes the suspension with finished” | – | not yet seen |
| finished → postSession | the same SEND frame: finished opens and closes on it | “the finished span of time over opens and closes on the SEND frame: the post-session follows” | – | not yet seen |
| grid → postSession | SEND before the session clock runs | “SEND before the session clock runs opens the post-session” | – | not yet seen |
| running → postSession | SEND with a car not finished (MiP: the player retired from the menu, SEND 1653.061), or the clock’s simulated end (ZvP 487.898 → 3600.027; ZvP2 135.163 → 3600.005, §1.7) | “left from the menu: SEND with the player retired and the others finished opens the post-session, no finish (MiP)”; “the clock’s simulated end opens the post-session (ZvP, ZvP2)” | – | seen (3) |
| suspended → postSession | SEND with a car not finished, or the simulated end, under a red flag | “SEND under a red flag with a car still running opens the post-session” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “joins a session in progress: the time left below the duration (MiP, 121.6 s)” | running |

## 5. car-activity-practice

- **Scope:** car. **Applies to:** `practice`. **Upstream:** `car-location`, `car-status`, `session-phase-practice`.
- **Reads:** the signals `driverStatus` and `resultStatus`; the timing area (lap distance) and the session area (track length).
- **Kinds:** `outLap`, `flyingLap`, `inLap`, `garage`, `finished`, `notCompeting`. No detail. Code shared with qualifying: `situations/car-activity-timed/timed.ts` (the push kind `flyingLap` here, `pushLap` in qualifying).
- **Rule:** a car's scope begins with its first car-location span (a join). `notCompeting` while car-status is not `competing`; `garage` while car-location is `garage` (a teleport into it is no lap and no other transition); `outLap` from leaving the garage to the line; the push kind from the line; `inLap` once the car heads for the pit lane or the session's end ends its lap; `outLap` again at a pit exit without the garage; `finished` at the line once the session has ended for the car. The line is the lap distance on track only (from below 0 to 0 or more, or a drop of more than half the track length); the lap number, the lap timer and the driver status are no line signal. The session's end for a car: its result status finished, or the session phase `finished` or `postSession`.

**Transitions** (28 declared; 11 seen, 17 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → garage | the car’s first car-location span is garage | join: “joined in the garage: garage (join)” | `practice-garage-exit` | seen (57) |
| none → outLap | the car’s first car-location span, driver status out lap (3) | join: “joined on the out lap on track, before the line (ds 3, d -350; practice-garage-exit car 2): outLap (join)”; join: “joined leaving the garage, in the pit lane (ds 3, ps 1): outLap (join)” | `practice-garage-exit` | seen (3) |
| none → flyingLap | the car’s first car-location span, on track, no other kind applies | join: “joined mid push lap (ds 1, d 2049; qualifying-singapore-full-lap car 8): flyingLap (join)” | – | not yet seen |
| none → inLap | the car’s first car-location span: in the pit lane, driver status in lap (2), or the session ended | join: “joined on an in lap on track (ds 2, d 626; qualifying-singapore-end car 1): inLap (join)”; join: “joined in the pit lane on the in lap (ds 2, ps 1): inLap (join)”; join: “joined after the session’s end, on track: inLap (join)” | – | not yet seen |
| none → finished | the car’s first car-location span, result status finished | join: “joined with the result status finished, on track (not yet seen): finished (join)” | – | not yet seen |
| none → notCompeting | the car’s first car-location span, car-status not competing | join: “joined retired: notCompeting (join)”; join: “a slot no car of the session holds (absent): notCompeting (join)” | `practice-garage-exit` | seen (6) |
| garage → notCompeting | car-status leaves competing (MiP: the player retires from the menu in the garage, result status 2 → 7 at 1653.061, §1.6) | “the player retires from the menu in the garage (rs 2 -> 7, ds 0, ps 1; MiP 1653.061): garage -> notCompeting” | – | seen (1) |
| outLap → notCompeting | car-status leaves competing | “retires on its out lap: outLap -> notCompeting” | – | seen (3) |
| flyingLap → notCompeting | car-status leaves competing | “retires mid push lap (terminal damage): flyingLap -> notCompeting” | – | seen (1) |
| inLap → notCompeting | car-status leaves competing | “disqualified on its in lap: inLap -> notCompeting” | – | not yet seen |
| finished → notCompeting | car-status leaves competing | “a finished car turns retired (not yet seen): finished -> notCompeting” | – | not yet seen |
| notCompeting → garage | car-status competing again, the car in the garage | “competing again, in the garage (not yet seen): notCompeting -> garage” | – | not yet seen |
| notCompeting → outLap | car-status competing again, driver status out lap | “competing again, on the out lap (not yet seen): notCompeting -> outLap” | – | not yet seen |
| notCompeting → flyingLap | car-status competing again, on track | “competing again, on a push lap (not yet seen): notCompeting -> flyingLap” | – | not yet seen |
| notCompeting → inLap | car-status competing again, in lap or pit lane | “competing again, on an in lap (not yet seen): notCompeting -> inLap” | – | not yet seen |
| notCompeting → finished | car-status competing again, result status finished | “competing again, with the result status finished (not yet seen): notCompeting -> finished” | – | not yet seen |
| outLap → garage | car-location garage (back into the box from the out lap) | “back into the garage box from the pit lane on the out lap (not yet seen): outLap -> garage” | – | not yet seen |
| flyingLap → garage | car-location garage: the player’s return to the garage mid-lap, a teleport (SgQ 467.514, §2.4) | “the player’s return to the garage mid-lap, a teleport (ds 1 -> 0, ps 0, d 739 -> 33; SgQ 467.514): flyingLap -> garage” | – | not yet seen |
| inLap → garage | car-location garage: one frame of pit status 2, then driver status 2 → 0 (MiP 542.845 / 542.879); an AI in lap teleported under time acceleration (SgQ 501.014, §2.4) | “into the garage box: one frame of ps 2, then ds 2 -> 0 with ps 2 -> 1 (MiP 542.845 / 542.879): inLap -> garage”; “an AI in lap teleported into the garage under time acceleration (ds 2 -> 0, ps 0 -> 1, d 4500 -> 4929; SgQ 501.014): inLap -> garage” | – | seen (25) |
| finished → garage | car-location garage after the finish | “a finished car into the garage (not yet seen): finished -> garage” | – | not yet seen |
| garage → outLap | car-location leaves garage: driver status 0 → 3 (MiP 641.422; SgQ 138.968 under time acceleration, §2.2) | “leaving the garage, ds 0 -> 3 with ps still 1 (MiP 641.422): garage -> outLap”; “leaving the garage under time acceleration, ds 0 -> 3, ps 1 -> 0 and d -4896 -> -1539 in one frame (SgQ 138.968): garage -> outLap” | `practice-garage-exit` | seen (33) |
| outLap → flyingLap | the line on track: the lap distance from below 0 to 0 or more (SgQ 166.473), or a wrap of more than half the track length; the lap number does not rise after a garage visit (§2.2) | “the line of an out lap from a garage before it: the lap distance from below 0 to 0 or more (SgQ 166.473): outLap -> flyingLap”; “the line after a garage visit on the same lap number: a wrap, the driver status still out lap (w2/laps): outLap -> flyingLap” | `practice-garage-exit` | seen (32) |
| outLap → inLap | the pit entry on the out lap (car-location track → pitLane), or the session’s end for the car | “into the pit lane on the out lap (not yet seen): outLap -> inLap”; “the session’s end on the out lap: the result status finished mid-lap (not yet seen): outLap -> inLap” | – | seen (1) |
| flyingLap → inLap | driver status 1 → 2 on track (SgQ car 8 221.986, a frame after its line); the pit entry; or the session’s end for the car: result status finished mid-lap (SgQ 900.594, MiP 1653.061, §2.10) or the session phase finished or post-session | “the in-lap driver status on track, a frame after the line (SgQ car 8 at 221.986): flyingLap -> inLap”; “the pit entry with the driver status still flying (ps 0 -> 1): flyingLap -> inLap”; “the session’s end: the result status finished mid-lap, the lap number up, the lap distance not at the line (SgQ 900.594 car 0): flyingLap -> inLap”; “the session’s end with the driver status still flying (MiP 1653.061 car 4: rs 2 -> 3, lap 4 -> 5 at d 3457): flyingLap -> inLap”; “the session’s end by the session phase alone (post-session, an online session’s simulated end): flyingLap -> inLap” | – | seen (31) |
| inLap → outLap | car-location pitLane → track (the pit exit) without the garage | “through the pit lane without the garage, ps 1 -> 0 after the in lap (not yet seen): inLap -> outLap” | – | not yet seen |
| outLap → finished | the line on track while the session has ended for the car | “an out lap reaches the line as the result status turns finished (not yet seen): outLap -> finished” | – | not yet seen |
| flyingLap → finished | the line on track while the session has ended for the car | “the chequered flag at the line: the result status turns finished as the lap distance wraps (§2.10; not yet seen): flyingLap -> finished” | – | not yet seen |
| inLap → finished | the line on track while the session has ended for the car | “the line after the session’s end ended the push: the chequered flag’s last lap (not yet seen): inLap -> finished” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “joined in the garage: garage (join)” | garage |
| “joined on the out lap on track, before the line (ds 3, d -350; practice-garage-exit car 2): outLap (join)” | outLap |
| “joined leaving the garage, in the pit lane (ds 3, ps 1): outLap (join)” | outLap |
| “joined mid push lap (ds 1, d 2049; qualifying-singapore-full-lap car 8): flyingLap (join)” | flyingLap |
| “joined on an in lap on track (ds 2, d 626; qualifying-singapore-end car 1): inLap (join)” | inLap |
| “joined in the pit lane on the in lap (ds 2, ps 1): inLap (join)” | inLap |
| “joined after the session’s end, on track: inLap (join)” | inLap |
| “joined with the result status finished, on track (not yet seen): finished (join)” | finished |
| “joined retired: notCompeting (join)” | notCompeting |
| “a slot no car of the session holds (absent): notCompeting (join)” | notCompeting |

## 6. session-phase-qualifying

- **Scope:** session. **Applies to:** `qualifying` (a sprint shootout included). **Upstream:** `weekend-phase`, `car-status`.
- Inputs, kinds, details and rule: as `session-phase-practice` (one shared implementation, `situations/session-phase/timed.ts`).

**Transitions** (10 declared; 3 seen, 7 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → grid | the machine’s first frame, the time left equal to the duration | “the first frame before the session clock runs opens grid” | – | not yet seen |
| none → running | the machine’s first frame, the time left below the duration (MiP starts mid-session at st 121.552, §1.11) | join: “joins a session in progress: the time left below the duration (MiP, 121.6 s)” | `qualifying-singapore-end` | seen (1) |
| grid → running | the session time moves on from the previous frame | “the session clock starts: grid closes and running opens” | – | not yet seen |
| running → suspended | RDFL (`restart` unknown; no restart signal is known) | “a red flag suspends the session” | – | not yet seen |
| running → finished | SEND with every car in the session at result status finished: time over (SgQ 900.594: every car result status 2 → 3 on the last frame, SEND at the same session time, §1.6) | “time over: SEND with every car finished closes running with finished (SgQ)” | `qualifying-singapore-end` | seen (1) |
| suspended → finished | SEND with every car in the session finished, under a red flag | “time over under a red flag: SEND with every car finished closes the suspension with finished” | – | not yet seen |
| finished → postSession | the same SEND frame: finished opens and closes on it | “the finished span of time over opens and closes on the SEND frame: the post-session follows” | `qualifying-singapore-end` | seen (1) |
| grid → postSession | SEND before the session clock runs | “SEND before the session clock runs opens the post-session” | – | not yet seen |
| running → postSession | SEND with a car not finished (MiP: the player retired from the menu, SEND 1653.061), or the clock’s simulated end (ZvP 487.898 → 3600.027; ZvP2 135.163 → 3600.005, §1.7) | “left from the menu: SEND with the player retired and the others finished opens the post-session, no finish (MiP)”; “the clock’s simulated end opens the post-session (ZvP, ZvP2)” | – | not yet seen |
| suspended → postSession | SEND with a car not finished, or the simulated end, under a red flag | “SEND under a red flag with a car still running opens the post-session” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “joins a session in progress: the time left below the duration (MiP, 121.6 s)” | running |

## 7. car-activity-qualifying

- **Scope:** car. **Applies to:** `qualifying`. **Upstream:** `car-location`, `car-status`, `session-phase-qualifying`.
- **Kinds:** `outLap`, `pushLap`, `inLap`, `garage`, `finished`, `notCompeting`. No detail.
- Inputs and rule: as `car-activity-practice`, with the push kind `pushLap` (one shared implementation, `situations/car-activity-timed/timed.ts`).

**Transitions** (28 declared; 7 seen, 21 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → garage | the car’s first car-location span is garage | join: “joined in the garage: garage (join)” | `qualifying-singapore-full-lap`, `qualifying-singapore-end` | seen (15) |
| none → outLap | the car’s first car-location span, driver status out lap (3) | join: “joined on the out lap on track, before the line (ds 3, d -350; practice-garage-exit car 2): outLap (join)”; join: “joined leaving the garage, in the pit lane (ds 3, ps 1): outLap (join)” | `qualifying-singapore-full-lap` | not yet seen |
| none → pushLap | the car’s first car-location span, on track, no other kind applies | join: “joined mid push lap (ds 1, d 2049; qualifying-singapore-full-lap car 8): pushLap (join)” | `qualifying-singapore-full-lap`, `qualifying-singapore-end` | not yet seen |
| none → inLap | the car’s first car-location span: in the pit lane, driver status in lap (2), or the session ended | join: “joined on an in lap on track (ds 2, d 626; qualifying-singapore-end car 1): inLap (join)”; join: “joined in the pit lane on the in lap (ds 2, ps 1): inLap (join)”; join: “joined after the session’s end, on track: inLap (join)” | `qualifying-singapore-end` | not yet seen |
| none → finished | the car’s first car-location span, result status finished | join: “joined with the result status finished, on track (not yet seen): finished (join)” | – | not yet seen |
| none → notCompeting | the car’s first car-location span, car-status not competing | join: “joined retired: notCompeting (join)”; join: “a slot no car of the session holds (absent): notCompeting (join)” | – | seen (7) |
| garage → notCompeting | car-status leaves competing (MiP: the player retires from the menu in the garage, result status 2 → 7 at 1653.061, §1.6) | “the player retires from the menu in the garage (rs 2 -> 7, ds 0, ps 1; MiP 1653.061): garage -> notCompeting” | – | not yet seen |
| outLap → notCompeting | car-status leaves competing | “retires on its out lap: outLap -> notCompeting” | – | not yet seen |
| pushLap → notCompeting | car-status leaves competing | “retires mid push lap (terminal damage): pushLap -> notCompeting” | – | not yet seen |
| inLap → notCompeting | car-status leaves competing | “disqualified on its in lap: inLap -> notCompeting” | – | not yet seen |
| finished → notCompeting | car-status leaves competing | “a finished car turns retired (not yet seen): finished -> notCompeting” | – | not yet seen |
| notCompeting → garage | car-status competing again, the car in the garage | “competing again, in the garage (not yet seen): notCompeting -> garage” | – | not yet seen |
| notCompeting → outLap | car-status competing again, driver status out lap | “competing again, on the out lap (not yet seen): notCompeting -> outLap” | – | not yet seen |
| notCompeting → pushLap | car-status competing again, on track | “competing again, on a push lap (not yet seen): notCompeting -> pushLap” | – | not yet seen |
| notCompeting → inLap | car-status competing again, in lap or pit lane | “competing again, on an in lap (not yet seen): notCompeting -> inLap” | – | not yet seen |
| notCompeting → finished | car-status competing again, result status finished | “competing again, with the result status finished (not yet seen): notCompeting -> finished” | – | not yet seen |
| outLap → garage | car-location garage (back into the box from the out lap) | “back into the garage box from the pit lane on the out lap (not yet seen): outLap -> garage” | – | not yet seen |
| pushLap → garage | car-location garage: the player’s return to the garage mid-lap, a teleport (SgQ 467.514, §2.4) | “the player’s return to the garage mid-lap, a teleport (ds 1 -> 0, ps 0, d 739 -> 33; SgQ 467.514): pushLap -> garage” | – | seen (1) |
| inLap → garage | car-location garage: one frame of pit status 2, then driver status 2 → 0 (MiP 542.845 / 542.879); an AI in lap teleported under time acceleration (SgQ 501.014, §2.4) | “into the garage box: one frame of ps 2, then ds 2 -> 0 with ps 2 -> 1 (MiP 542.845 / 542.879): inLap -> garage”; “an AI in lap teleported into the garage under time acceleration (ds 2 -> 0, ps 0 -> 1, d 4500 -> 4929; SgQ 501.014): inLap -> garage” | – | seen (14) |
| finished → garage | car-location garage after the finish | “a finished car into the garage (not yet seen): finished -> garage” | – | not yet seen |
| garage → outLap | car-location leaves garage: driver status 0 → 3 (MiP 641.422; SgQ 138.968 under time acceleration, §2.2) | “leaving the garage, ds 0 -> 3 with ps still 1 (MiP 641.422): garage -> outLap”; “leaving the garage under time acceleration, ds 0 -> 3, ps 1 -> 0 and d -4896 -> -1539 in one frame (SgQ 138.968): garage -> outLap” | `qualifying-singapore-full-lap` | seen (27) |
| outLap → pushLap | the line on track: the lap distance from below 0 to 0 or more (SgQ 166.473), or a wrap of more than half the track length; the lap number does not rise after a garage visit (§2.2) | “the line of an out lap from a garage before it: the lap distance from below 0 to 0 or more (SgQ 166.473): outLap -> pushLap”; “the line after a garage visit on the same lap number: a wrap, the driver status still out lap (w2/laps): outLap -> pushLap” | `qualifying-singapore-full-lap` | seen (27) |
| outLap → inLap | the pit entry on the out lap (car-location track → pitLane), or the session’s end for the car | “into the pit lane on the out lap (not yet seen): outLap -> inLap”; “the session’s end on the out lap: the result status finished mid-lap (not yet seen): outLap -> inLap” | – | not yet seen |
| pushLap → inLap | driver status 1 → 2 on track (SgQ car 8 221.986, a frame after its line); the pit entry; or the session’s end for the car: result status finished mid-lap (SgQ 900.594, MiP 1653.061, §2.10) or the session phase finished or post-session | “the in-lap driver status on track, a frame after the line (SgQ car 8 at 221.986): pushLap -> inLap”; “the pit entry with the driver status still flying (ps 0 -> 1): pushLap -> inLap”; “the session’s end: the result status finished mid-lap, the lap number up, the lap distance not at the line (SgQ 900.594 car 0): pushLap -> inLap”; “the session’s end with the driver status still flying (MiP 1653.061 car 4: rs 2 -> 3, lap 4 -> 5 at d 3457): pushLap -> inLap”; “the session’s end by the session phase alone (post-session, an online session’s simulated end): pushLap -> inLap” | `qualifying-singapore-full-lap`, `qualifying-singapore-end` | seen (26) |
| inLap → outLap | car-location pitLane → track (the pit exit) without the garage | “through the pit lane without the garage, ps 1 -> 0 after the in lap (not yet seen): inLap -> outLap” | – | not yet seen |
| outLap → finished | the line on track while the session has ended for the car | “an out lap reaches the line as the result status turns finished (not yet seen): outLap -> finished” | – | not yet seen |
| pushLap → finished | the line on track while the session has ended for the car | “the chequered flag at the line: the result status turns finished as the lap distance wraps (§2.10; not yet seen): pushLap -> finished” | – | not yet seen |
| inLap → finished | the line on track while the session has ended for the car | “the line after the session’s end ended the push: the chequered flag’s last lap (not yet seen): inLap -> finished” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “joined in the garage: garage (join)” | garage |
| “joined on the out lap on track, before the line (ds 3, d -350; practice-garage-exit car 2): outLap (join)” | outLap |
| “joined leaving the garage, in the pit lane (ds 3, ps 1): outLap (join)” | outLap |
| “joined mid push lap (ds 1, d 2049; qualifying-singapore-full-lap car 8): pushLap (join)” | pushLap |
| “joined on an in lap on track (ds 2, d 626; qualifying-singapore-end car 1): inLap (join)” | inLap |
| “joined in the pit lane on the in lap (ds 2, ps 1): inLap (join)” | inLap |
| “joined after the session’s end, on track: inLap (join)” | inLap |
| “joined with the result status finished, on track (not yet seen): finished (join)” | finished |
| “joined retired: notCompeting (join)” | notCompeting |
| “a slot no car of the session holds (absent): notCompeting (join)” | notCompeting |

## 8. penalties

- **Scope:** car. **Applies to:** `race`. **Upstream:** `weekend-phase` (it runs from the frame the phase is decided on).
- **Reads:** the signals `events` (PENA), `unservedDriveThroughs` (`numUnservedDriveThroughPens`), `unservedStopGos` (`numUnservedStopGoPens`) and `timePenaltyMs` (LapData `penalties`).
- **Kinds:** `clear`; `timePenalty` (`TimePenaltyDetail`: `totalMs`, `infringement` of the PENA of type 4 that raised it, else unknown); `driveThroughPending` and `stopGoPending` (`PendingPenaltyDetail`: `driveThroughs`, `stopGos`, `infringement` of the oldest unserved penalty, `totalMs`), named after the oldest unserved penalty.
- **Rule:** a new span on every change of the kind or the detail. A count rise queues a penalty (a drive-through before a stop-go on one frame) and takes the infringement of the oldest unused PENA of its type (0 drive-through, 1 stop-go, 4 time) of the same frame or up to 16 frames before (`PENDING_FRAMES`); a fall serves the oldest of its type. DTSV and SGSV are not read. Every first span is a join (the machine's first frame).

**Transitions** (19 declared; 4 seen, 15 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → clear | the machine’s first frame (the weekend phase decided), no unserved penalty and time penalties 0 | join: “the session’s first frame, nothing owed: clear (join)” | `race-drive-through` | seen (154) |
| timePenalty → clear | LapData `penalties` falls to 0 | “the time penalties fall to 0: timePenalty -> clear” | – | not yet seen |
| driveThroughPending → clear | the drive-through count falls to 0 (MiR count 1 → 0 at 1638.878, a frame after the DTSV at 1638.850, §2.7); DTSV and SGSV are not read | “the drive-through is served (count 1 -> 0): driveThroughPending -> clear” | – | seen (1) |
| stopGoPending → clear | the stop-go count falls to 0 | “the stop-go is served (count 1 -> 0; not yet seen): stopGoPending -> clear” | – | not yet seen |
| none → timePenalty | the machine’s first frame, time penalties above 0 | join: “the session’s first frame, time penalties standing: timePenalty (join)” | – | not yet seen |
| clear → timePenalty | LapData `penalties` rises; the PENA of type 4 one frame before (4/21: SgW 659.526 / 659.541, MxR, MiR 1683.516 / 1683.544, §2.6) | “a time penalty (PENA 4, then penalties 0 -> 3 s): clear -> timePenalty” | – | seen (3) |
| timePenalty → timePenalty | LapData `penalties` changes and stays above 0 | “a further time penalty: timePenalty -> timePenalty” | – | not yet seen |
| driveThroughPending → timePenalty | the drive-through count falls to 0 while a time penalty stands | “the drive-through is served, a time penalty stands: driveThroughPending -> timePenalty” | – | not yet seen |
| stopGoPending → timePenalty | the stop-go count falls to 0 while a time penalty stands | “the stop-go is served, a time penalty stands (not yet seen): stopGoPending -> timePenalty” | – | not yet seen |
| none → driveThroughPending | the machine’s first frame, a drive-through unserved (the oldest) | join: “the session’s first frame, a drive-through unserved: driveThroughPending (join)” | – | not yet seen |
| clear → driveThroughPending | `numUnservedDriveThroughPens` rises; the PENA of type 0 one frame before (MiR 0/38 at 1531.797, count 0 → 1 at 1531.824, §2.7); a PENA waits up to 16 frames (`PENDING_FRAMES`) | “a drive-through (PENA 0, one frame before the count rises): clear -> driveThroughPending” | `race-drive-through` | seen (1) |
| timePenalty → driveThroughPending | a drive-through count rise while a time penalty stands | “a drive-through on top of a time penalty: timePenalty -> driveThroughPending” | – | not yet seen |
| driveThroughPending → driveThroughPending | a change of the counts or the time penalties while the oldest owed is a drive-through | “a second drive-through: driveThroughPending -> driveThroughPending” | – | not yet seen |
| stopGoPending → driveThroughPending | the stop-go count falls while a drive-through is still owed | “the stop-go is served, a drive-through is still owed (not yet seen): stopGoPending -> driveThroughPending” | – | not yet seen |
| none → stopGoPending | the machine’s first frame, a stop-go unserved (the oldest) | join: “the session’s first frame, a stop-go unserved: stopGoPending (join)” | – | not yet seen |
| clear → stopGoPending | `numUnservedStopGoPens` rises; the PENA of type 1 on that frame or up to 16 frames before | “a stop-go (PENA 1, then the count rises; not yet seen): clear -> stopGoPending” | – | not yet seen |
| timePenalty → stopGoPending | a stop-go count rise while a time penalty stands | “a stop-go on top of a time penalty (not yet seen): timePenalty -> stopGoPending” | – | not yet seen |
| driveThroughPending → stopGoPending | the drive-through count falls while a stop-go is still owed | “the drive-through is served, a stop-go is still owed (not yet seen): driveThroughPending -> stopGoPending” | – | not yet seen |
| stopGoPending → stopGoPending | a change of the counts or the time penalties while the oldest owed is a stop-go | “a second stop-go (not yet seen): stopGoPending -> stopGoPending” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the session’s first frame, nothing owed: clear (join)” | clear |
| “the session’s first frame, time penalties standing: timePenalty (join)” | timePenalty |
| “the session’s first frame, a drive-through unserved: driveThroughPending (join)” | driveThroughPending |
| “the session’s first frame, a stop-go unserved: stopGoPending (join)” | stopGoPending |

## 9. session-phase-race

- **Scope:** session. **Applies to:** `race` (the sprint included). **Upstream:** `weekend-phase`, `car-status`.
- **Reads:** the signals `events` (SCAR, STLG, LGOT, RDFL, RCWN, CHQF, SEND) and `safetyCarStatus`; the timing area (the leader's lap, the lap timers of the cars in the session); the clock's `simulatedEnd`.
- **Kinds:** `grid`, `formation`, `startLights`, `racing`, `neutralised` (`NeutralisedDetail`: `car` `SC` or `VSC`, `stages` `deployed`, `returning`, `returned`, `resume` with their times; a VSC has no `returned`), `suspended` (`SuspendedDetail`: `restart`, known once the restart is seen), `finished`, `postSession`.
- **Rule, per frame in this order:** the join on the machine's first frame; the clock's simulated end; the confirmation or expiry of a waiting neutralisation; the events; the safety car status; on the grid, a race already under way. A neutralisation opens on its SCAR deployment unconfirmed and is confirmed when the status shows its car; unconfirmed after 3 s (`CONFIRM_WITHIN_MS` 3000) it closes `confirmed: false` and the phase it replaced opens again (C18). A race is under way when the leader is past lap 1 or a lap timer runs past 1000 ms (`UNDER_WAY_LAP_TIME_MS`). A resume sent twice (types 1 and 0, §1.4) closes once.

**Transitions** (26 declared; 11 seen, 15 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → grid | the machine’s first frame: no SC, VSC or formation status and the race not under way | “the first frame on a fresh grid opens grid” | `race-singapore-start` | seen (2) |
| none → formation | the machine’s first frame shows `safetyCarStatus` 3 (formation); the weekend structure, and so the phase, arrives at about st 1.5, after `safetyCarStatus` turned 3 at st 0.887–1.069 (§1.1, §1.2, §7) | join: “joins in the formation lap: the first frame shows the formation status” | `race-singapore-wet-start`, `race-zandvoort-online-start`, `race-zandvoort-uid-reuse-start`, `race-singapore-wet-formation-end` | seen (5) |
| none → racing | the machine’s first frame with the leader past lap 1 or a lap timer above 1000 ms (`UNDER_WAY_LAP_TIME_MS`) | join: “joins a race under way: the leader past lap 1”; join: “joins a race under way: a lap timer above 1000 ms” | `race-zandvoort-vsc`, `race-singapore-end` | not yet seen |
| none → neutralised | the machine’s first frame shows `safetyCarStatus` SC or VSC | join: “joins under the safety car: the first frame shows the SC status”; join: “joins under the virtual safety car: the first frame shows the VSC status” | – | not yet seen |
| grid → formation | `safetyCarStatus` 0 → 3 or a SCAR(formation, deployed) on the grid; the SCAR comes at st 0 before the first Session packet and is dropped (§7); the status follows at st 0.887–1.069 (§1.2) | “the formation status on the grid opens the formation lap (S2-S4)” | – | not yet seen |
| grid → startLights | the first STLG on the grid (no formation lap: SgR, MxR; STLG ×5 about 0.8 s wall apart at st 0, §1.1) | “the first start light on the grid opens the start lights (S1, no formation lap)” | `race-singapore-start` | seen (2) |
| grid → racing | on the grid, a lap timer above 1000 ms: a join after the last start light | “on the grid a lap timer above 1000 ms is a race under way: a join after the last start light saw none (B1)” | – | not yet seen |
| formation → startLights | the first STLG after the formation lap; `safetyCarStatus` 3 → 0 between STLG 1 and 2 (§7) | “the first start light after the formation lap opens the start lights; the formation status still stands (§7)” | `race-singapore-wet-start`, `race-zandvoort-online-start`, `race-zandvoort-uid-reuse-start` | seen (5) |
| startLights → racing | LGOT, 1.2–3.8 s wall after STLG 5 (§1.3); an LGOT before any STLG (the formation lap’s) opens nothing | “lights out ends the start lights and opens racing” | `race-singapore-start`, `race-singapore-wet-start`, `race-zandvoort-online-start`, `race-zandvoort-uid-reuse-start` | seen (7) |
| racing → neutralised | a SCAR deployed (SC 1,0 or VSC 2,0) at once, unconfirmed; `safetyCarStatus` follows one Session packet (0.5–1.3 s) later and confirms it (§1.4); the status change alone opens it too | “an SC deployment opens a neutralisation at once, before the status shows it”; “a VSC deployment opens a neutralisation at once”; “the SC status without a deployment event opens a neutralisation on its frame” | `race-zandvoort-vsc` | seen (5) |
| neutralised → racing | the SCAR resume of its car (MiR SC 494.794; VSC 1531.770); or `safetyCarStatus` back to 0 for a confirmed one (one Session packet after the resume); or a deployment the status never confirms, 3 s (`CONFIRM_WITHIN_MS`) after its SCAR, closed `confirmed: false` | “the SC resume closes the neutralisation and opens racing”; “the status going green closes a confirmed neutralisation before its resume”; “a deployment the status never confirms closes 3 s after its SCAR, confirmed false, and racing opens again (C18)” | – | seen (5) |
| neutralised → neutralised | an SC deployed under a VSC, with no VSC end between (MiR 229.734, ZvR2 924.223, §1.4) | “an SC deployed under a VSC closes the VSC and opens the SC (§1.4, MiR, ZvR2)” | – | seen (2) |
| racing → suspended | RDFL | “a red flag suspends the race” | – | not yet seen |
| neutralised → suspended | RDFL under the SC or VSC | “a red flag under the safety car suspends the race” | – | not yet seen |
| suspended → startLights | the first STLG after a red flag (a standing restart; `restart: standing`) | “a standing restart: the first start light after a red flag opens the start lights” | – | not yet seen |
| suspended → neutralised | an SC deployment or the SC status after a red flag (a rolling restart; `restart: rolling`) | “a rolling restart: the SC status after a red flag closes the suspension and opens the SC” | – | not yet seen |
| racing → finished | RCWN or CHQF, whichever first (RCWN MiR 2217.865, MxR 6864.172; CHQF MiR 2266.835; the sprint CHQF 993.4 with no RCWN, §1.5, §6.2) | “the race winner finishes a race under way”; “the chequered flag without a race winner finishes a race under way” | – | seen (3) |
| neutralised → finished | RCWN or CHQF under the SC or VSC | “the chequered flag under the safety car finishes the race” | – | not yet seen |
| suspended → finished | RCWN or CHQF under a red flag | “the race winner under a red flag finishes the race” | – | not yet seen |
| grid → postSession | SEND on the grid | “SEND on the grid opens the post-session” | – | not yet seen |
| formation → postSession | SEND in the formation lap | “SEND in the formation lap opens the post-session” | – | not yet seen |
| startLights → postSession | SEND under the start lights | “SEND in the start lights opens the post-session” | – | not yet seen |
| racing → postSession | SEND (SgR quit 63.318; §1.6), or the clock’s simulated end, at the time of the last frame before the jump (ZvR 24.001 → 6361.441; ZvR2 1207.667 → 5837.001, §1.7) | “SEND mid-race (quit) opens the post-session, no finish (SgR, SgW)”; “the clock’s simulated end opens the post-session (the online shape with the UID-0 classification: ZvR, ZvR2)” | `race-singapore-end` | seen (4) |
| neutralised → postSession | SEND or the simulated end under the SC or VSC; a deployment still unconfirmed closes `confirmed: false` (ZvR2 1207.667) | “SEND under the safety car opens the post-session”; “the simulated end while a deployment waits: the neutralisation closes confirmed false and the post-session opens (ZvR2)” | – | not yet seen |
| suspended → postSession | SEND or the simulated end under a red flag | “SEND under a red flag opens the post-session” | – | not yet seen |
| finished → postSession | SEND after the finish: 0.03–0.06 s after the player’s crossing (MiR, MxR, §2.10) | “SEND after the finish opens the post-session (MxR, MiR)” | – | seen (3) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “joins in the formation lap: the first frame shows the formation status” | formation |
| “joins a race under way: the leader past lap 1” | racing |
| “joins a race under way: a lap timer above 1000 ms” | racing |
| “joins under the safety car: the first frame shows the SC status” | neutralised |
| “joins under the virtual safety car: the first frame shows the VSC status” | neutralised |

## 10. car-activity-race

- **Scope:** car. **Applies to:** `race`. **Upstream:** `car-location`, `car-status`, `penalties`, `session-phase-race`.
- **Reads:** the signals `pitStatus`, `pitLaneTimerActive`, `resultStatus` and the events (DTSV, SGSV); the timing area (lap, lap distance, pit stop timer). It reads no driver status.
- **Kinds:** `racingLap`, `inLap`, `boxStop`, `servingPenalty` (`ServingPenaltyDetail`: `penalty` `driveThrough` or `stopGo`, `given` the penalties span it serves; opens `confirmed: false`), `outLap`, `finished`, `coolDown`, `notCompeting`.
- **Rule:** the scope begins at the lights out (the race session phase first past `grid`, `formation` and `startLights`; a later standing restart changes nothing): every car with a car-status span opens then, without `joinedAt`. A race joined past the lights out, or a car whose car-status span first appears after it, opens its current activity with `joinedAt`. `servingPenalty` holds the whole visit, the box included, and closes on the later of the pit exit and the car's DTSV or SGSV, or `confirmed: false` on the first frame more than 10 s after the pit exit (`SERVED_WITHIN_MS` 10 000, C18). `finished` opens on a frame whose result status is finished on which, or one frame after which, the car crossed the line (its lap distance fell); a result status set finished mid-lap with no crossing finishes nothing.

**Transitions** (33 declared; 12 seen, 21 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → racingLap | at the lights out (the race session phase first past grid, formation and startLights), a car not in the pit lane; or a join | “the lights out, a car on the grid: none -> racingLap”; join: “a join, a car on track: racingLap (join)” | `race-zandvoort-pit-stop`, `race-drive-through`, `race-miami-finish` | seen (140) |
| none → inLap | a join: in the pit lane before its box (pit stop timer 0), owing nothing | join: “a join, a car in the pit lane before its box (pit stop timer 0): inLap (join)” | – | not yet seen |
| none → boxStop | a join: in its box (pit status in the pit area) | join: “a join, a car in its box: boxStop (join)” | – | not yet seen |
| none → servingPenalty | a join: in the pit lane owing a drive-through or stop-go | join: “a join, a car in the pit lane owing a drive-through: servingPenalty (join)” | `race-drive-through-served` | not yet seen |
| none → outLap | at the lights out, a car in the pit lane (a pit-lane start; none in any recording, §7); or a join past its box (pit stop timer above 0) | “the lights out, a car in the pit lane: none -> outLap (a pit-lane start)”; join: “a join, a car in the pit lane past its box (pit stop timer above 0; ZvR2 car 1 in race-zandvoort-pit-exit): outLap (join)” | `race-zandvoort-pit-exit` | not yet seen |
| none → coolDown | a join: result status finished | join: “a join, a car that has finished: coolDown (join)” | `race-miami-finish` | not yet seen |
| none → notCompeting | at the lights out or a join: car-status retired, disqualified or absent | “the lights out, a car not competing: none -> notCompeting”; join: “a join, a car retired: notCompeting (join)” | `race-miami-finish` | seen (14) |
| racingLap → inLap | car-location track → pitLane (pit status 0 → 1, `pitLaneTimerActive` 0 → 1; MiR 710.893, §2.5), nothing to serve | “the pit entry (car-location track -> pitLane), nothing to serve: racingLap -> inLap” | `race-zandvoort-pit-stop` | seen (88) |
| racingLap → servingPenalty | the pit entry while penalties is `driveThroughPending` or `stopGoPending` (MiR car 19 1603.226, §2.7) | “the pit entry owing a drive-through (MiR car 19, 1603.226): racingLap -> servingPenalty”; “the pit entry owing a stop-go (not yet seen, C19): racingLap -> servingPenalty” | – | seen (1) |
| racingLap → finished | result status finished on the frame of the line crossing (the lap distance falls) or the frame after it (§2.10) | “the result status finished a frame after the line crossing (MiR, MxR): racingLap -> finished”; “the result status finished on the frame of the crossing: racingLap -> finished”; “the winner: its result status finished a frame after its crossing, the session phase still racing (its RCWN comes a frame later; MiR 2217.837 / 2217.865): racingLap -> finished” | `race-miami-finish` | seen (24) |
| inLap → boxStop | pit status 1 → 2 at the box (MiR 719.640, 8.7 s after the entry, §2.5) | “the box (pit status pitting -> in the pit area): inLap -> boxStop” | `race-zandvoort-pit-stop` | seen (79) |
| inLap → outLap | car-location pitLane → track without a box | “the pit exit without a stop (not yet seen, C19): inLap -> outLap” | – | seen (9) |
| inLap → finished | result status finished at a line crossing in the pit lane before the box | “a car in the pit lane before its box crosses the line at the flag (not yet seen, C19): inLap -> finished” | – | not yet seen |
| boxStop → outLap | pit status 2 → 1 leaving the box (stationary 2.0–3.4 s, some 7.7–8.6 s, §2.5) | “leaving the box (pit status in the pit area -> pitting): boxStop -> outLap” | – | seen (79) |
| servingPenalty → outLap | the later of the pit exit and the DTSV (drive-through) or SGSV (stop-go); MiR DTSV 7.1 s after the pit exit (1631.735 / 1638.850, §2.7); no confirmation within 10 s (`SERVED_WITHIN_MS`) of the pit exit closes it `confirmed: false` | “the DTSV 7.1 s after the pit exit (MiR car 19, 1631.735 / 1638.850): servingPenalty -> outLap on the DTSV frame”; “the DTSV in the pit lane, then the pit exit: servingPenalty -> outLap at the pit exit”; “the SGSV after the pit exit (not yet seen, C19): servingPenalty -> outLap on the SGSV frame”; “no DTSV by the first frame more than 10 s after the pit exit: servingPenalty -> outLap, closed confirmed false (C18)” | `race-drive-through-served` | seen (1) |
| outLap → racingLap | the first lap rise on track after the pit exit (the race boxes lie after the line, so the lap rises in the pit lane first, §2.5) | “the first lap rise on track after the pit exit: outLap -> racingLap” | – | seen (89) |
| outLap → inLap | a pit entry on the out lap, nothing to serve | “a pit entry on the out lap (not yet seen, C19): outLap -> inLap” | – | not yet seen |
| outLap → servingPenalty | a pit entry on the out lap owing a drive-through or stop-go | “a pit entry on the out lap owing a drive-through (not yet seen, C19): outLap -> servingPenalty” | – | not yet seen |
| outLap → finished | result status finished at a line crossing on the out lap | “a car on its out lap takes the flag: outLap -> finished” | – | not yet seen |
| finished → coolDown | the frame after finished | “the frame after the finish: finished -> coolDown” | `race-miami-finish` | seen (24) |
| racingLap → notCompeting | car-status leaves competing | “the car retires on its racing lap: racingLap -> notCompeting” | – | seen (11) |
| inLap → notCompeting | car-status leaves competing | “the car retires in the pit lane: inLap -> notCompeting” | – | not yet seen |
| boxStop → notCompeting | car-status leaves competing | “the car retires in its box: boxStop -> notCompeting” | – | not yet seen |
| servingPenalty → notCompeting | car-status leaves competing; the span closes as it stands | “the car is disqualified serving a penalty: servingPenalty -> notCompeting” | – | not yet seen |
| outLap → notCompeting | car-status leaves competing | “the car retires on its out lap: outLap -> notCompeting” | – | not yet seen |
| finished → notCompeting | car-status leaves competing on the frame after the finish | “the car is disqualified on the frame after its finish (not yet seen, C19): finished -> notCompeting” | – | not yet seen |
| coolDown → notCompeting | car-status leaves competing after the finish | “the car is disqualified after its finish (not yet seen, C19): coolDown -> notCompeting” | – | not yet seen |
| notCompeting → racingLap | car-status competing again, on track | “the car competes again on track (not yet seen, C19): notCompeting -> racingLap” | – | not yet seen |
| notCompeting → inLap | car-status competing again, in the pit lane before its box | “the car competes again in the pit lane before its box (not yet seen, C19): notCompeting -> inLap” | – | not yet seen |
| notCompeting → boxStop | car-status competing again, in its box | “the car competes again in its box (not yet seen, C19): notCompeting -> boxStop” | – | not yet seen |
| notCompeting → servingPenalty | car-status competing again, in the pit lane owing a penalty | “the car competes again in the pit lane owing a drive-through (not yet seen, C19): notCompeting -> servingPenalty” | – | not yet seen |
| notCompeting → outLap | car-status competing again, in the pit lane past its box | “the car competes again in the pit lane past its box (not yet seen, C19): notCompeting -> outLap” | – | not yet seen |
| notCompeting → coolDown | car-status competing again, result status finished | “the car competes again having finished (not yet seen, C19): notCompeting -> coolDown” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “a join, a car on track: racingLap (join)” | racingLap |
| “a join, a car in the pit lane before its box (pit stop timer 0): inLap (join)” | inLap |
| “a join, a car in its box: boxStop (join)” | boxStop |
| “a join, a car in the pit lane owing a drive-through: servingPenalty (join)” | servingPenalty |
| “a join, a car in the pit lane past its box (pit stop timer above 0; ZvR2 car 1 in race-zandvoort-pit-exit): outLap (join)” | outLap |
| “a join, a car that has finished: coolDown (join)” | coolDown |
| “a join, a car retired: notCompeting (join)” | notCompeting |

## 11. car-driver

- **Scope:** car. **Applies to:** `all`. **Upstream:** none.
- **Reads:** the signal `aiControlled` (Participants); the signals `resultStatus` and `numActiveCars` for car-status's slot rule (`slotsInUse`, `situations/car-status/slots.ts`, C43); the identity area (the arrival of the car's Participants data).
- **Kinds:** `ai` (`aiControlled` 1), `human` (`aiControlled` 0). No detail.
- **Rule:** a new span on every flip of `aiControlled`. The signal defaults to `true` before any Participants packet, so a car's first span opens on the first frame its Participants data is in the live state, with `joinedAt`, and only for a slot below `slotsInUse`: the game's empty slots read `aiControlled` 0 (race-zandvoort-lap10 slots 20 and 21) and open nothing. Before it no span opens (C3). A takeover is known only from the game's spec (C19).
- **Scan:** run on 2026-11-11 at `sp4.3a/t4` over the recordings of `recordings/` (same command as above; exit code 0, no undeclared transition).

**Transitions** (4 declared; 2 seen, 2 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → ai | the first frame with the car’s Participants data, the slot in use, `aiControlled` 1 | join: “the first frame with Participants data, the AI driving: ai (join)” | `race-zandvoort-lap10` (car 4) | seen (276) |
| none → human | the first frame with the car’s Participants data, the slot in use, `aiControlled` 0 | join: “the first frame with Participants data, a human driving: human (join)” | `race-zandvoort-lap10` (cars 0 and 1) | seen (26) |
| ai → human | `aiControlled` 1 → 0: a human takes the car over from the AI (online, a driver joining a slot) | “a human takes the car over from the AI (synthetic, not yet seen): ai -> human” | – | not yet seen |
| human → ai | `aiControlled` 0 → 1: the AI takes the car over from a human (online, a driver dropping out) | “the AI takes the car over from a human (synthetic, not yet seen): human -> ai” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the first frame with Participants data, the AI driving: ai (join)” | ai |
| “the first frame with Participants data, a human driving: human (join)” | human |

## 12. car-flags

- **Scope:** car. **Applies to:** `all`. **Upstream:** none.
- **Reads:** the signal `fiaFlag` (CarStatus `vehicleFIAFlags`).
- **Kinds:** `noFlag` (the game's none), `green`, `blue`, `yellow`, `unknown` (the game's invalid/unknown, C3). No detail.
- **Rule:** every car slot has a span from the machine's first frame (joined; nothing tells whether the session was joined); a new span on every change of the flag. Under a neutralisation the player's flag is 3 (yellow), 1 on the resume, then 0 about 5 s later (§1.4); counts per recording in §6.1.

**Transitions** (25 declared; 13 seen, 12 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → noFlag | every car slot on the machine’s first frame (joined) | join: “joins a session in progress: the car shows noFlag” | `practice-miami-yellow`, `race-mexico-blue` | seen (224) |
| none → green | every car slot on the machine’s first frame (joined) | join: “joins a session in progress: the car shows green” | – | not yet seen |
| none → blue | every car slot on the machine’s first frame (joined) | join: “joins a session in progress: the car shows blue” | – | not yet seen |
| none → yellow | every car slot on the machine’s first frame (joined) | join: “joins a session in progress: the car shows yellow” | – | seen (40) |
| none → unknown | every car slot on the machine’s first frame (joined) | join: “joins a session in progress: the car shows unknown” | – | not yet seen |
| noFlag → green | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from noFlag to green” | – | seen (137) |
| noFlag → blue | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from noFlag to blue” | `race-mexico-blue` | seen (37) |
| noFlag → yellow | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from noFlag to yellow” | `practice-miami-yellow` | seen (395) |
| noFlag → unknown | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from noFlag to unknown” | – | not yet seen |
| green → noFlag | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from green to noFlag” | `practice-miami-yellow` | seen (387) |
| green → blue | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from green to blue” | – | seen (2) |
| green → yellow | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from green to yellow” | – | seen (78) |
| green → unknown | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from green to unknown” | – | not yet seen |
| blue → noFlag | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from blue to noFlag” | `race-mexico-blue` | seen (37) |
| blue → green | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from blue to green” | – | not yet seen |
| blue → yellow | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from blue to yellow” | – | seen (3) |
| blue → unknown | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from blue to unknown” | – | not yet seen |
| yellow → noFlag | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from yellow to noFlag” | – | seen (108) |
| yellow → green | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from yellow to green” | `practice-miami-yellow` | seen (341) |
| yellow → blue | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from yellow to blue” | – | seen (1) |
| yellow → unknown | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from yellow to unknown” | – | not yet seen |
| unknown → noFlag | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from unknown to noFlag” | – | not yet seen |
| unknown → green | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from unknown to green” | – | not yet seen |
| unknown → blue | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from unknown to blue” | – | not yet seen |
| unknown → yellow | the car’s `vehicleFIAFlags` changes (game values -1 unknown, 0 none, 1 green, 2 blue, 3 yellow), a span on the frame of the change | “the flag changes from unknown to yellow” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “joins a session in progress: the car shows noFlag” | noFlag |
| “joins a session in progress: the car shows green” | green |
| “joins a session in progress: the car shows blue” | blue |
| “joins a session in progress: the car shows yellow” | yellow |
| “joins a session in progress: the car shows unknown” | unknown |

## 13. compound-rule

- **Scope:** car. **Applies to:** `race`. **Upstream:** `session-phase-race`.
- **Reads:** the tyres area (`visualCompound`); no signal.
- **Kinds:** `required`, `waived`. No detail. `waived` is final.
- **Rule:** every car slot has a span from the machine's first frame (joined). A car holds `required` until its visual compound is intermediates or wets at or after the lights out. Whether a car met the rule by running two dry compounds is an analysis's judgement (C43).

**Transitions** (3 declared; 2 seen, 1 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → required | every car slot on the machine’s first frame: a dry compound, or any compound before the lights out | join: “the first frame, a car on a dry compound: required (join)”; join: “the first frame in the formation lap on intermediates: required (join), nothing waived before the lights out” | `race-singapore-wet-start` | seen (154) |
| none → waived | every car slot on the machine’s first frame: visual compound intermediates or wets after the lights out | join: “the first frame, a car on intermediates: waived (join)”; join: “the first frame, a car on wets: waived (join)” | – | not yet seen |
| required → waived | visual compound intermediates or wets at or after the lights out (the race session phase past grid, formation and startLights): at the lights out, or a tyre change at a stop (CarStatus compound about 1 s after the box, §2.5) | “the formation lap on intermediates, then the lights out: required -> waived at the lights out”; “a switch to intermediates mid-race: required -> waived”; “a switch to wets mid-race: required -> waived” | `race-singapore-wet-start` | seen (60) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the first frame, a car on a dry compound: required (join)” | required |
| “the first frame, a car on intermediates: waived (join)” | waived |
| “the first frame, a car on wets: waived (join)” | waived |
| “the first frame in the formation lap on intermediates: required (join), nothing waived before the lights out” | required |

## 14. lap-validity

- **Scope:** car. **Applies to:** `all`. **Upstream:** none.
- **Reads:** the signals `events` (PENA) and `currentLapInvalid`.
- **Kinds:** `valid`, `invalid` (`InvalidLapDetail`: `reason`, the PENA's infringement, and `scope` `this`, `thisAndNext` or `thisAndPrevious` by the PENA type 10–15; both unknown without such a PENA).
- **Rule:** every car slot has a span from the machine's first frame (joined); a new span on every change of `currentLapInvalid`. A PENA of type 10–15 waits up to 16 frames (`PENDING_FRAMES`) for the flag and is used once; a PENA after the flag changes nothing (C18).

**Transitions** (4 declared; 3 seen, 1 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → valid | every car slot on the machine’s first frame, `currentLapInvalid` 0 | join: “the session’s first frame, a valid lap: valid (join)” | `practice-miami-invalid`, `practice-wing-change` | seen (264) |
| none → invalid | every car slot on the machine’s first frame, `currentLapInvalid` 1; reason and scope unknown | join: “the session’s first frame, a lap already invalid: invalid (join)” | – | not yet seen |
| valid → invalid | `currentLapInvalid` 0 → 1, one frame after its cause (§2.8); a PENA of type 10–15 on that frame or up to 16 frames before (`PENDING_FRAMES`) gives reason and scope (MiP: PENA 12/7 and the flag on one frame, 1526.992, `practice-miami-invalid`); MiR: the flag with no such PENA (1683.516) | “the PENA 12/7 and the flag on one frame (MiP): valid -> invalid”; “the PENA a frame before the flag: valid -> invalid”; “the flag with no invalidating PENA (MiR): valid -> invalid” | `practice-miami-invalid` | seen (3) |
| invalid → valid | `currentLapInvalid` 1 → 0 at the next line, a line in the pit lane on the way to the garage included (MiP 1563.605; MiR 1735.187, §2.8) | “the flag clears: invalid -> valid”; “the flag clears, joined invalid: invalid -> valid” | – | seen (3) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the session’s first frame, a valid lap: valid (join)” | valid |
| “the session’s first frame, a lap already invalid: invalid (join)” | invalid |

## 15. race-control-practice

- **Scope:** session. **Applies to:** `practice`. **Upstream:** `weekend-phase`. No signal, no value.
- **Kinds:** `drsFree`. No detail.
- **Rule:** one span for the whole session, joined (no signal tells whether the session was joined).

**Transitions** (1 declared; 1 seen, 0 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → drsFree | the machine’s first frame (DRSE and DRSD are not sent in practice) | join: “the first frame of the practice session: drsFree (join)” | – | seen (3) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the first frame of the practice session: drsFree (join)” | drsFree |

## 16. race-control-qualifying

- **Scope:** session. **Applies to:** `qualifying`. **Upstream:** `weekend-phase`. No signal, no value.
- **Kinds:** `drsFree`. No detail.
- **Rule:** as `race-control-practice`.

**Transitions** (1 declared; 1 seen, 0 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → drsFree | the machine’s first frame (DRSE and DRSD are not sent in qualifying) | join: “the first frame of the qualifying session: drsFree (join)” | – | seen (1) |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the first frame of the qualifying session: drsFree (join)” | drsFree |

## 17. race-control-race

- **Scope:** session. **Applies to:** `race`. **Upstream:** `session-phase-race`.
- **Reads:** the signal `events` (DRSE, DRSD).
- **Kinds:** `drsOff` (`DrsOffDetail`: `reason` `notEnabledYet`, `wetTrack`, `safetyCar`, `redFlag`, `minLapNotReached` or `unknown`), `drsOn`.
- **Rule:** before the lights out (the race session phase `grid`, `formation` or `startLights`) DRS is `drsOff` with reason `notEnabledYet` and DRSE and DRSD do not count. After it, the frame's last DRSE or DRSD decides: DRSE `drsOn`, DRSD `drsOff` with its reason (a new span when the reason changes). Every DRSD of the recordings says reason 0, wet track, even at an SC deployment (§1.4, §4).

**Transitions** (5 declared; 3 seen, 2 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → drsOff | the machine’s first frame before the lights out (reason `notEnabledYet`; joined unless on the grid), or joined after it while neutralised (`safetyCar`) or suspended (`redFlag`) | “the first frame on the grid: drsOff, not enabled yet”; join: “the first frame in the formation lap: drsOff, not enabled yet (join)”; join: “the first frame at the start lights: drsOff, not enabled yet (join)”; join: “a race joined under a safety car: drsOff, reason safetyCar (join)”; join: “a race joined under a red flag: drsOff, reason redFlag (join)” | – | seen (7) |
| none → drsOn | the machine’s first frame after the lights out, not neutralised or suspended (joined) | join: “a race joined after the lights out: drsOn (join)” | `race-zandvoort-vsc` | not yet seen |
| drsOff → drsOn | DRSE after the lights out (the sprint: DRSE at 99 s, §6.2); DRSE and DRSD before the lights out do not count (ZvR2 DRSE at 0.056, §1.2) | “DRSE after the lights out: drsOff -> drsOn”; “DRSE after a DRSD: drsOff -> drsOn” | – | seen (3) |
| drsOn → drsOff | DRSD after the lights out, with its reason (VSC deployment: DRSD reason 0, wet track, on the SCAR’s frame, ZvR2 914.178, §1.4) | “DRSD after the lights out: drsOn -> drsOff” | `race-zandvoort-vsc` | seen (2) |
| drsOff → drsOff | DRSD with another reason while DRS is off, after the lights out (`notEnabledYet` to the DRSD’s reason) | “a DRSD with another reason while DRS is off: drsOff -> drsOff”; “a DRSD after the lights out while DRS is not enabled yet: drsOff -> drsOff” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the first frame in the formation lap: drsOff, not enabled yet (join)” | drsOff |
| “the first frame at the start lights: drsOff, not enabled yet (join)” | drsOff |
| “a race joined under a safety car: drsOff, reason safetyCar (join)” | drsOff |
| “a race joined under a red flag: drsOff, reason redFlag (join)” | drsOff |
| “a race joined after the lights out: drsOn (join)” | drsOn |

## 18. warnings

- **Scope:** car. **Applies to:** `all`. **Upstream:** none.
- **Reads:** the signals `events` (PENA), `totalWarnings` and `cornerCuttingWarnings` (counted inside `totalWarnings`).
- **Kinds:** `noWarning`, `warned` (`WarnedDetail`: `count`, `infringement` of the PENA of type 5 that raised it, else unknown).
- **Rule:** every car slot has a span from the machine's first frame (joined); a new span on every change of `totalWarnings`. A PENA of type 5 waits up to 16 frames (`PENDING_FRAMES`) for the rise and is used once.

**Transitions** (5 declared; 3 seen, 2 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → noWarning | every car slot on the machine’s first frame, `totalWarnings` 0 | join: “the session’s first frame, no warning: noWarning (join)” | `practice-miami-warning`, `practice-zandvoort-warning-late` | seen (264) |
| none → warned | every car slot on the machine’s first frame, `totalWarnings` above 0; infringement unknown | join: “the session’s first frame, warnings already held: warned (join)” | `practice-wing-change` | not yet seen |
| noWarning → warned | `totalWarnings` rises: on the frame of the PENA of type 5 (MiP 215.595), one frame (about 0.03 s) after it (§2.6), or up to 16 frames (`PENDING_FRAMES`) after it (ZvP car 1, 0.543 s) | “the PENA and the rise of totalWarnings on one frame: noWarning -> warned”; “the PENA 16 frames before the rise (the longest the recordings show): noWarning -> warned”; “the rise with no PENA: noWarning -> warned” | `practice-miami-warning`, `practice-zandvoort-warning-late` | seen (20) |
| warned → warned | `totalWarnings` changes and stays above 0 (a rise, or a fall to a lower count) | “a further warning: warned -> warned”; “a further warning, joined holding warnings: warned -> warned”; “a rise of 2 on one frame: warned -> warned”; “the count falls to a lower count above 0: warned -> warned (not yet seen)” | – | seen (34) |
| warned → noWarning | `totalWarnings` falls to 0 | “the count falls to 0: warned -> noWarning (not yet seen)” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “the session’s first frame, no warning: noWarning (join)” | noWarning |
| “the session’s first frame, warnings already held: warned (join)” | warned |

## 19. zone-flags

- **Scope:** zone (a marshal zone the Session packet lists). **Applies to:** `all`. **Upstream:** none.
- **Reads:** the signal `marshalZones`.
- **Kinds:** `noFlag`, `green`, `blue`, `yellow`, `unknown`; every kind with `ZoneFlagDetail` (`startFraction`, where the zone starts on the lap).
- **Rule:** a zone is a scope from the first frame that lists it (joined on the machine's first frame); a new span on every change of its flag. A zone a later packet no longer lists is `unknown` from then on (C3, C19). Under the SC every zone turns yellow (MiR 204.172), back to none on SC returning, one zone green on the resume (§1.4); in the formation lap every zone is green (§1.2); counts per recording in §6.1.

**Transitions** (25 declared; 14 seen, 11 not yet seen):

| From → to | Signal or value, and its timing | Test rows | Segment | Scan |
|---|---|---|---|---|
| none → noFlag | every zone the machine’s first frame lists (joined); a zone first listed on a later frame opens then (not joined) | “the zone is listed on a later frame, showing noFlag”; join: “joins a session in progress: the zone shows noFlag” | `practice-miami-yellow`, `race-mexico-blue` | seen (83) |
| none → green | every zone the machine’s first frame lists (joined); a zone first listed on a later frame opens then (not joined) | “the zone is listed on a later frame, showing green”; join: “joins a session in progress: the zone shows green” | – | seen (65) |
| none → blue | every zone the machine’s first frame lists (joined); a zone first listed on a later frame opens then (not joined) | “the zone is listed on a later frame, showing blue”; join: “joins a session in progress: the zone shows blue” | – | not yet seen |
| none → yellow | every zone the machine’s first frame lists (joined); a zone first listed on a later frame opens then (not joined) | “the zone is listed on a later frame, showing yellow”; join: “joins a session in progress: the zone shows yellow” | – | seen (3) |
| none → unknown | every zone the machine’s first frame lists (joined); a zone first listed on a later frame opens then (not joined) | “the zone is listed on a later frame, showing unknown”; join: “joins a session in progress: the zone shows unknown” | – | not yet seen |
| noFlag → green | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from noFlag to green” | `practice-miami-yellow` | seen (45) |
| noFlag → blue | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from noFlag to blue” | `race-mexico-blue` | seen (170) |
| noFlag → yellow | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from noFlag to yellow” | `practice-miami-yellow` | seen (68) |
| noFlag → unknown | the zone’s flag in `marshalZones` changes, a span on the frame of the change; also a zone a later packet no longer lists | “the flag changes from noFlag to unknown” | – | not yet seen |
| green → noFlag | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from green to noFlag” | `practice-miami-yellow` | seen (159) |
| green → blue | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from green to blue” | – | seen (1) |
| green → yellow | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from green to yellow” | – | seen (17) |
| green → unknown | the zone’s flag in `marshalZones` changes, a span on the frame of the change; also a zone a later packet no longer lists | “the flag changes from green to unknown” | – | not yet seen |
| blue → noFlag | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from blue to noFlag” | `race-mexico-blue` | seen (168) |
| blue → green | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from blue to green” | – | seen (1) |
| blue → yellow | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from blue to yellow” | – | seen (2) |
| blue → unknown | the zone’s flag in `marshalZones` changes, a span on the frame of the change; also a zone a later packet no longer lists | “the flag changes from blue to unknown” | – | not yet seen |
| yellow → noFlag | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from yellow to noFlag” | – | seen (15) |
| yellow → green | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from yellow to green” | `practice-miami-yellow` | seen (71) |
| yellow → blue | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from yellow to blue” | – | not yet seen |
| yellow → unknown | the zone’s flag in `marshalZones` changes, a span on the frame of the change; also a zone a later packet no longer lists | “not yet seen: a zone no longer listed turns unknown”; “the flag changes from yellow to unknown” | – | not yet seen |
| unknown → noFlag | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from unknown to noFlag” | – | not yet seen |
| unknown → green | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from unknown to green” | – | not yet seen |
| unknown → blue | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “not yet seen: a zone listed again after being dropped shows its flag”; “the flag changes from unknown to blue” | – | not yet seen |
| unknown → yellow | the zone’s flag in `marshalZones` changes, a span on the frame of the change | “the flag changes from unknown to yellow” | – | not yet seen |

**Join rows** (a session or car joined in progress):

| Join row | Opens |
|---|---|
| “joins a session in progress: the zone shows noFlag” | noFlag |
| “joins a session in progress: the zone shows green” | green |
| “joins a session in progress: the zone shows blue” | blue |
| “joins a session in progress: the zone shows yellow” | yellow |
| “joins a session in progress: the zone shows unknown” | unknown |

## Recording checklist

Every transition the scan has not yet seen, grouped by the recording that would show it. Rows 1–10 are the migration plan's list. A new recording goes into `fixtures/index.json` and the scan runs again over every recording (C85); this file then changes its "Scan" cells.

| # | What to do in the game | What it would show (sub-machine: transition) |
|---|---|---|
| 1 | A race with red flags on, run until a red flag; one race restarted from the grid (standing restart) and one behind the safety car (rolling restart); a red flag also under an SC or VSC | session-phase-race: racing → suspended, neutralised → suspended, suspended → startLights (standing), suspended → neutralised (rolling), suspended → finished, suspended → postSession; race-control-race: drsOff → drsOff (a DRSD with another reason while DRS is off) |
| 1b | A red flag in practice or qualifying, then the session's end under it | session-phase-practice and session-phase-qualifying: running → suspended, suspended → finished, suspended → postSession |
| 2 | A race in which the player earns a stop-go (PENA type 1) and serves it at the next stop; a second one before serving the first; one on top of a time penalty or a drive-through | penalties: clear → stopGoPending, stopGoPending → clear, stopGoPending → stopGoPending, timePenalty → stopGoPending, driveThroughPending → stopGoPending, stopGoPending → driveThroughPending, stopGoPending → timePenalty; car-activity-race: racingLap → servingPenalty owing a stop-go, servingPenalty → outLap on the SGSV frame |
| 3 | A restart behind the SC after a red flag (row 1); separately, a wet race started behind the safety car | session-phase-race: suspended → neutralised. A race started behind the safety car: which declared transition carries it is unknown; none from grid or formation to neutralised is declared |
| 4 | A pit stop under the VSC (the inventory shows stops under the SC only, §2.5) | car-activity-race: racingLap → inLap, inLap → boxStop, boxStop → outLap while session-phase-race is neutralised with car VSC (each transition is seen; their combination with a VSC is not) |
| 5 | A full qualifying, Q1 → Q2 → Q3, each recorded from before its clock runs, staying on track at the time-out to finish a lap at the line | weekend-phase: none → qualifying with segments 1 and 3; session-phase-qualifying: none → grid, grid → running, running → postSession; car-activity-qualifying: pushLap → finished, outLap → finished, inLap → finished, finished → garage |
| 5b | A practice session run to its time-out, staying on track to finish a lap at the line after it, then into the garage | session-phase-practice: running → finished, finished → postSession; car-activity-practice: flyingLap → finished, outLap → finished, inLap → finished, finished → garage |
| 6 | A full sprint weekend: practice, sprint shootout (SQ1–SQ3), sprint, qualifying, grand prix, all recorded | weekend-phase: none → qualifying with the sprint-shootout formats (session types 10–14), none → race with format sprint and with format grandPrix in one weekend; whether the structure lists the shootout sessions (§6.2, not yet known) |
| 7 | A session restarted from the game's menu, recorded across the restart | the frame assembly's session split and, in the new session, every sub-machine's first spans (session-phase-practice and session-phase-qualifying: none → grid, grid → running); which of them shows is not yet known |
| 8 | An online session paused by the host, one paused when the recording starts, and one in a race | clock: none → paused, and running → paused and paused → running with source online (the scan counts the clock's transitions without their source; the inventory's one online pause is ZvP, §1.8) |
| 9 | An online session that a human player joins after it started | car-status: absent → competing; car-location: none → pitLane or none → garage on a later frame; car-activity-race: the joins of a car whose car-status span first appears after the lights out (none → inLap, none → boxStop, none → outLap, none → coolDown) |
| 10 | A race started from the pit lane | car-activity-race: none → outLap at the lights out |
| 11 | The recorder started while a session is under way: a race after the lights out (once under the SC or VSC), a practice and a qualifying with cars on track and in the pit lane | session-phase-race: none → racing, none → neutralised; race-control-race: none → drsOn; car-activity-race: none → inLap, none → boxStop, none → servingPenalty, none → outLap, none → coolDown; car-activity-practice: none → flyingLap, none → inLap, none → finished; car-activity-qualifying: none → outLap, none → pushLap, none → inLap, none → finished; car-location: none → pitLane; car-status: none → retired, none → disqualified; penalties: none → timePenalty, none → driveThroughPending, none → stopGoPending; lap-validity: none → invalid; warnings: none → warned; compound-rule: none → waived (a wet race) |
| 12 | A race quit on the grid, one in the formation lap, one under the start lights, one under the SC; a race whose leader takes the chequered flag under the SC | session-phase-race: grid → postSession, formation → postSession, startLights → postSession, neutralised → postSession, neutralised → finished |
| 13 | A practice and a qualifying recorded from before their clock runs; one of each quit before it runs | session-phase-practice and session-phase-qualifying: none → grid, grid → running, grid → postSession |
| 14 | A race in which a car retires in the pit lane, in its box, on its out lap and while serving a penalty | car-activity-race: inLap → notCompeting, boxStop → notCompeting, outLap → notCompeting, servingPenalty → notCompeting |
| 15 | Retirements in qualifying (on track and in the garage) and on an in lap in practice | car-activity-qualifying: garage → notCompeting, outLap → notCompeting, pushLap → notCompeting, inLap → notCompeting; car-activity-practice: inLap → notCompeting |
| 16 | A race in which a car takes the flag on its out lap, and one in the pit lane before its box | car-activity-race: outLap → finished, inLap → finished |
| 17 | A disqualification that stands, and a black flag (inventory §4: PENA type 6; PENA type 17, infringement 44; RTMT reason black flagged); one after a retirement | car-status: competing → disqualified confirmed by a PENA of type 6, retired → disqualified, disqualified → retired; car-activity-race: finished → notCompeting, coolDown → notCompeting (a disqualification after the finish); car-activity-practice and car-activity-qualifying: finished → notCompeting |
| 18 | A race with a time penalty served at a stop; a second time penalty; a drive-through while a time penalty stands; two drive-throughs at once | penalties: timePenalty → clear, timePenalty → timePenalty, timePenalty → driveThroughPending, driveThroughPending → timePenalty, driveThroughPending → driveThroughPending, none → timePenalty |
| 19 | In practice and qualifying: an out lap from the pit lane back into the garage; a pass through the pit lane on an in lap without the garage; in practice, the return to the garage mid-lap; in qualifying, a pit entry on the out lap | car-activity-practice and car-activity-qualifying: outLap → garage, inLap → outLap; car-activity-practice: flyingLap → garage; car-activity-qualifying: outLap → inLap |
| 19b | A race in which a car enters the pit lane again on its out lap, once owing a drive-through | car-activity-race: outLap → inLap, outLap → servingPenalty |
| 20 | No game action is known for these; they are implemented from the game's specification (C19) | car-status: competing → absent, retired → competing, retired → absent, disqualified → absent, absent → retired, absent → disqualified; car-activity-race, car-activity-practice and car-activity-qualifying: every notCompeting → kind (a car competing again); warnings: warned → noWarning and a fall to a lower count; session-phase-race: grid → formation, grid → racing (they need the weekend phase decided before the formation status or the race under way); car-flags and zone-flags: every transition to or from unknown (the game's invalid flag, or a zone no longer listed), car-flags none → green, none → blue, blue → green; zone-flags none → blue, yellow → blue |
