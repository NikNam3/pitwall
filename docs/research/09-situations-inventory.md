# Special situations in our recordings: inventory

The facts the machine's sub-machines are built on (contract C15–C19, C85): every situation signal as our recordings show it, with times. Gathered 2026-10-30 by scanning every recording packet by packet, extended 2026-11-02. The situations catalogue (one section per sub-machine: rule, test, "seen in") is written from it during the migration; until then this file is the reference.

Sections 1–5: the inventory of 2026-10-30. Section 6: additions of 2026-11-02. Sections 7–8: the race-start diagnosis of 2026-10-30 (its proposed rule is superseded by the contract and left out).

## Method and notation

- Scratch scripts streamed every recording packet by packet (raw `decode`, no frame assembler). They logged every change of the situation fields (Session: `safetyCarStatus`, `gamePaused`, `isSpectating`, `spectatorCarIndex`, settings, period counters, marshal zones, `sessionTimeLeft` jumps. LapData per car: `driverStatus`, `pitStatus`, `pitLaneTimerActive`, `resultStatus`, `numUnserved*`, `pitStopShouldServePen`, `penalties`, `numPitStops`, warnings, plus `currentLapInvalid` and the lap number for the player. CarStatus: `networkPaused`, the player's FIA flag and tyres. Participants: `numActiveCars`, `aiControlled`, `networkId`). They also logged every event except BUTN, SPTP and OVTK, header anomalies (session time going back or jumping, `frameIdentifier` and `overallFrameIdentifier` going back, `playerCarIndex` changes), wall-clock gaps, and session-time-to-wall-time ratios.
- `st` = header session time in s. `f` = `frameIdentifier`. `w` = wall time since file start in s. `d` = `lapDistance` in m. Car numbers are vehicle indices. "Player" = `playerCarIndex`.
- Field shorthands: ds = `driverStatus` (0 garage, 1 flying, 2 in lap, 3 out lap, 4 on track). ps = `pitStatus` (0 none, 1 pitting, 2 in pit area). rs = `resultStatus` (2 active, 3 finished, 4 DNF, 5 DSQ, 7 retired). scs = `safetyCarStatus`. plta = `pitLaneTimerActive`. pl = `pitLaneTimeInLaneInMS`. pst = `pitStopTimerInMS`. nps = `numPitStops`. udt = `numUnservedDriveThroughPens`.

### Recordings covered

| Short | Fixture id | File | Kind | Track | Notes |
|---|---|---|---|---|---|
| SgR | raceSingapore | 2026-10-28_00-15-04 | race, offline, 5 laps | Singapore | formation lap off; quit on lap 1 |
| SgQ | qualifyingSingapore | 2026-10-28_23-53-34 | Q2, offline | Singapore | garage time acceleration |
| SgW | raceSingaporeWet | 2026-10-29_00-04-08 | race, offline, 62 laps | Singapore | formation lap, 5 FLBK, quit on lap 45 |
| ZvP | practiceZandvoortOnline | 2026-10-29_22-39-31 | short practice, online | Zandvoort | retired, then simulated |
| ZvR | raceZandvoortOnline | 2026-10-29_22-48-50 | race, online, 72 laps | Zandvoort | retired on lap 1, then simulated |
| ZvP2 | practiceZandvoortUidReuse | 2026-10-29_22-54-58 | short practice, online | Zandvoort | retired, then simulated |
| ZvR2 | raceZandvoortUidReuse | 2026-10-29_23-00-37 | race, online, 72 laps | Zandvoort | VSC then SC; retired lap 15 |
| MxR | raceWetVscMexico | 2026-10-30_15-20-41 | race, offline, 71 laps | Mexico | VSC, 4 pauses, finished (lapped) |
| MiP | *(not in index.json)* | 2026-10-30_18-26-27_581b388bbb23c5e7 | short practice (type 4, 1800 s), offline | Miami (trackId 30) | starts mid-session; 3 garage visits; player retires from the menu |
| MiR | *(not in index.json)* | 2026-10-30_18-53-00_082927e692fdf2af | race (type 15), offline, 20 laps | Miami (trackId 30) | formation lap, VSC→SC, 2nd VSC, drive-through, RCWN+CHQF, finished |

The skipped files are ttZandvoort, menuOnly and lobbyOnly. ttZandvoort was scanned and shows only time-trial lap restarts: `lapDistance` jumps, `currentLapInvalid` from PENA 13/26, and ghost participant names changing. MiP and MiR are the two newest recordings. They are not in `fixtures/index.json` yet.

### What the engine reads today

- `history/flags.ts`: SCAR types 1 and 2 (deployed opens a phase, resume closes it), `safetyCarStatus` 1/2 changes, RDFL opens red, LGOT closes red, SEND closes any phase. SCAR type 3 and type 0 are ignored.
- `history/pit-stops.ts`: a visit runs from ps 0→≠0 to the change back. DTSV/SGSV mark the open visit `penaltyServed`.
- `history/laps.ts`: `outLap` from ps or ds 3. SC/VSC time per lap from the status.
- `history/stints.ts`: compound change or age drop, then SEND.
- `runner/session-runner.ts`: a flashback is an FLBK, or a drop of `frameIdentifier` while `overallFrameIdentifier` rises.
- The engine has no notion of garage, formation lap, start sequence, pause, time acceleration, retirement span or post-session simulation.

---

## 1. Session phases

### 1.1 Pre-start without a formation lap (grid to lights out)

- **Seen in:** SgR and MxR. MxR has the `formationLap` setting at 1 from the third Session packet, yet the data shows no formation lap. SgR has the setting at 0.
- **Signals:** session time stays exactly 0.000 from SSTA (or the first packet) until LGOT, while frame ids advance (SgR f0→335, MxR f0→213). STLG 1..5 arrive about 0.8 s wall apart, all at st 0.000. LGOT follows 1.6 s (SgR) and 1.8 s (MxR) wall after STLG 5.
- **Oddity:** the first 1–3 Session packets carry default settings (formationLap 0, safetyCar 0, redFlags 0, pitStopExperience 0). The real values arrive at about st 1.5, or at w1.2 to w3.7 while st is still 0. In MxR the first four Session packets also carry weather and temperatures of 0 (see index).

### 1.2 Formation lap

- **Seen in:** SgW, ZvR, ZvR2 and MiR.
- **Start signals:** SCAR(type 3, event 0 "deployed") and an LGOT, both at st 0.000. They come before the first Session packet when the recorder was already running: SgW w77.0, ZvR w112.6 (stale f16725 from the previous session), ZvR2 w50.0. These events carry `playerCarIndex` 0. MiR's file begins at st 0 with no such events. scs turns 0→3 in the second Session packet: SgW st 1.008, ZvR 1.069, ZvR2 0.887, MiR 1.025. The formationLap setting turns 0→1 at about st 1.5.
- **During:** the lap number stays 1 across the line. `lapDistance` wraps (MiR: the player d5090 → d129 at the grid) while `totalDistance` keeps counting (5540). `currentLapTimeInMS` stays 0. ds stays 4. All marshal zones are flag 1 (green). The player's FIA flag is 3 (yellow) from st 0.058 (MiR).
- **End signals:** session time resets to 0 on the grid, with no FLBK. Frame ids keep rising across the reset:
  - SgW: 169.566→0.000, f10295→10296.
  - MiR: 169.381→0.000, f5993→5994.
  - ZvR: 131.495→0.000, f21192→21193.
  - ZvR2: 131.714→0.033, f7911→7912.
- An SCAR(type 3, event 3 "resume") comes with the reset (SgW and MiR at st 0.000; ZvR at 0.000 f21193; ZvR2 at 0.355). Its `playerCarIndex` is 0. scs turns 3→0 only in the next Session packet: SgW f10361, MiR f6028, ZvR at st 1.968, ZvR2 at st 0.794. `sessionTimeLeft` jumps back to the full duration (MiR 7030→7200).
- **Oddities, ZvR2:**
  - the reset is followed by SCAR(type 0, event 3) at 0.056 and a DRSE at 0.056;
  - then a second reset 0.355→0.000 (f7937→7938, on a DRSD event with `playerCarIndex` 0);
  - the recording itself starts with a reset 57.304→0.000 at f6→7.
- **Oddity, ZvR:** during the formation lap the player (car 0) gets RTMT (reason 0) at 124.481/125.339 and rs 2→5 (DSQ) at 125.371. Its `lapDistance` crosses the line (4259→0) and then jumps back to 4258. `numActiveCars` goes 20→19 at 130.081. After the reset, rs goes 5→2 and `numActiveCars` 19→20 (st 1.968). No PENA accompanies it.

### 1.3 Start lights and lights out

- **Seen in:** every race (SgR, SgW, ZvR, ZvR2, MxR, MiR).
- **Signals:** STLG x5 at about 0.8 s wall steps. LGOT follows 1.2–3.8 s wall after STLG 5: SgW 1.2, SgR 1.6, MxR 1.8, ZvR 2.6, ZvR2 2.8, MiR 3.8. Session time is frozen during the lights: 0.000 offline, 1.968 in ZvR and 0.794 in ZvR2.
- **Oddity, online starts:** session time resets again at lights out. ZvR goes 1.968→0.065 at f21409→21410. ZvR2 goes 0.794→6.790 (+6 s jump at f8371), then 6.908→0.831→0.027 in consecutive frames (f8379→8380→8381). Offline, session time simply starts counting from 0.000 after LGOT.
- In SgW and ZvR(2) the file holds two LGOTs: the formation-lap one and the real one.

### 1.4 Safety car and virtual safety car

| Rec | Trigger | SCAR deployed | scs change | Further SCAR | SCAR resume | scs → 0 |
|---|---|---|---|---|---|---|
| MiR VSC→SC | incident, no RTMT (FIA yellow 196.8, zones 0…310 at 197.2) | VSC (2,0) 203.108 | 0→2 at 204.172, nVSC 1 | SC (1,0) 229.734 while VSC on; scs 2→1 at 230.654, nSC 1 | SC returning (1,1) 459.362, returned (1,2) 485.606 | (1,3) 494.794, the same frame as the leader (the player) crossing into lap 5 | 495.665 |
| MiR VSC 2 | car 18 RTMT 1456.006 | (2,0) 1459.049 | 0→2 at 1459.661, nVSC 2 | VSC "returning/ending" (2,1) 1523.851 | (2,3) 1531.770 | 1532.647 |
| MxR VSC | car 11 RTMT 1392.829 | (2,0) 1395.877 | 0→2 at 1396.527 | (2,1) 1469.951 | (2,3) 1477.180 | 1478.030 |
| ZvR2 VSC→SC | car 2 PENA 16/42 at 912.011 | VSC (2,0) 914.178 + DRSD reason 0 (wet track) | 0→2 at 915.045 | SC (1,0) 924.223; scs 2→1 at 925.543 | (1,1) 1121.912, (1,2) 1153.520 | (1,3) and (0,3) both at 1160.006 | 1160.557 |
| SgW | our terminal damage, PENA 16/42 496.561 | SC (1,0) 496.561 + DRSD(0) | never (undone by FLBK to 481.561) | – | – | – |
| ZvR | our terminal damage 24.001 | VSC (2,0) 24.001 | never (session simulated) | – | – | – |
| ZvR2 | our terminal damage 1207.667 | SC (1,0) 1207.667, then (0,3) twice at the same st | never (session simulated) | – | – | – |

- **Lag:** scs follows the SCAR by one Session packet (0.5–1.3 s). The Session packet is sent at 2 Hz.
- A VSC never shows event 2 ("returned"). Its sequence is deployed → 1 ("returning", the VSC-ending notice) → 3 resume.
- An SC upgrade from VSC arrives as SC deployed with no VSC end event in between.
- A resume can come in pairs, with a type-0 SCAR next to the type-1 one (ZvR2 1160.006 and 1207.667).
- DRSD on deployment says reason 0 (wet track), not 1 (safety car) (ZvR2, SgW).
- Under the SC all marshal zones turn 3 (MiR 204.172). On SC returning they go back to 0 (460.141). On resume one zone turns 1 (495.665), then 0.
- The player's FIA flag is 3 under the neutralisation, 1 on resume, then 0 about 5 s later (MiR 494.883 / 499.992; ZvR2 1165.139 / 1167.595).
- `numSafetyCarPeriods` and `numVirtualSafetyCarPeriods` count up on the scs change, not on the SCAR.

### 1.5 Race winner and chequered flag

- **RCWN:** MiR car 13 at 2217.865, the same frame as its rs 2→3. MxR car 16 at 6864.172, likewise. In MiR `sessionTimeLeft` drops 4982→179 at the next Session packet (2218.357).
- **CHQF:** only in MiR, at 2266.835. That is 48.97 s after RCWN, between P15 finishing (car 4, 2263.311) and P16 (car 9, 2267.698), and 3.85 s before the player (P17) crossed (2270.659). MxR has no CHQF: the player was lapped and crossed at 6898.451, 34 s after RCWN.

### 1.6 Session end (SEND) and what follows

| Rec | Why it ended | Last frame before SEND | SEND | After |
|---|---|---|---|---|
| SgR | quit on lap 1 | st 63.318, `gamePaused` 0→1 in that frame | st 63.318, f0 | 20 UID-0 SessionHistory just before; no FinalClassification |
| SgQ | session time over (duration 900) | 900.594: every car rs 2→3; 11 AI nps 0→1; paused 1 | 900.594, f0 | 15 SessionHistory + FinalClassification with the session uid |
| SgW | quit on lap 45 | 162 s wall without LapData (paused), then one frame at 4698.930 with paused 1 | 4698.930, f0 | no FinalClassification |
| MxR | player finished (lapped) | the player's rs 2→3 at 6898.477; last frame 6898.504 sets the rest rs 3 and the two retired cars rs 7→4; paused 1 | 6898.504, f0 | 20 bulks of SessionHistory + FinalClassification at st 6957.943, f0, 5 s apart |
| MiR | player finished | the player's rs 2→3 at 2270.688 (crossed 2270.659); 2270.718 sets cars 1 and 6 rs 3 mid-lap (d5289, d5249) and the retired car 18 rs 7→4; paused 1 | 2270.718, f0 | 20 SessionHistory |
| MiP | player retired from the menu | RTMT car 19 reason 0 at 1653.025; 1653.061: player rs 2→7, every other car rs 2→3, nps 0→1 for 4 cars, `numActiveCars` 20→19, paused 1 | 1653.061, f0 | FinalClassification at st 1800.000 (= duration), 5.4 s wall later |
| ZvP, ZvP2, ZvR, ZvR2 | online, our terminal damage | none: LapData just stops | **no SEND** | UID-0 FinalClassification (and SessionHistory) with session time jumped to about the session end, see 1.7 |

- SEND and the packets after it carry frame id 0. `overallFrameIdentifier` is 0 too.
- Every offline end has one last Session packet with `gamePaused` 1, from a game that is not a network game.

### 1.7 Post-session simulation (session time jumps to the end)

- **ZvP:** terminal damage at 487.898 (f16725). 3.5 s and then 35.7 s wall pass with only events. UID-0 FinalClassification follows at st 3600.027 and 3605.033 (duration 3600). The session's own uid reappears with st 3605.033, still at f16725.
- **ZvP2:** 135.163 → UID-0 bulks at 3600.005 every 5 s until 3760.546 (33 bulks over 166 s wall).
- **ZvR:** 24.001 → 6361.441 (27.7 s wall of silence first).
- **ZvR2:** 1207.667 → 5837.001 / 5842.006 / 5845.008 (44.2 s wall of silence), then LobbyInfo.
- **MiP:** offline, SEND at 1653.061 → FinalClassification at 1800.000.
- **MxR:** SEND 6898.504 → bulks at 6957.943, which is the last finisher's race time.
- The frame id stays frozen at the last value (ZvP 16725, ZvR 22213, ZvR2 89947) or is 0 (offline after SEND).

### 1.8 Pauses

- **Offline pause:** no packets at all except a few BUTN events. Session time freezes and frame ids continue +1 after it.

| Rec | Pause (st, f) | Wall length | Car situation |
|---|---|---|---|
| SgQ | 294.910 f10321 | 37.4 s | player on a flying lap |
| SgQ | 581.855 f20923 | 11.7 s | player in the garage, during time acceleration |
| SgW | 1364.178 f94721 | 21.7 s | lap 15 |
| SgW | 4698.916 f315709 | 162.3 s | then quit |
| MxR | 2698.585 | 48.7 s | |
| MxR | 3978.976 | 86.4 s | |
| MxR | 5329.607 | 54.5 s | |
| MxR | 6003.635 | 17.4 s | |
| MiR | 1539.859 | 18.7 s | |
| MiR | 1624.940 | 9.3 s | player in the pit lane |
| MiR | 1686.794 | 14.8 s | |
| MiP | 946.587 | 27.0 s | pit lane |
| MiP | 1037.036 | 17.9 s | garage |

- **Online pause:** ZvP has `gamePaused` 1 from 339.456 to 377.151 while session time and packets run on. The player was in the garage. `networkPaused` (CarStatus) never changed in any recording.
- A pause also precedes each flashback (SgW: 9.0, 5.1, 4.1, 3.5 and 3.4 s wall without LapData).

### 1.9 Session time running ahead of wall time (garage time acceleration)

- **SgQ:**
  - st 10.06→139.6 at 10.8× (player in the garage at the session start; ends as the player leaves);
  - st 467.3→581.9 at 7.8–9.1×, then 587.7→about 900 (player back in the garage).
- **MiP:**
  - 571→619 (about 1.5×) while the player sat in the garage from 542.879 to 641.422;
  - 980→1036 (4.5×) in the garage from 953.305 to 1079.313;
  - 1595→1645 (4.6×) in the garage from 1566.400 to the end.
- Frames keep coming at the wall rate, so each frame advances up to 0.5 s of session time. In SgQ f720→750 covers 0.5 s wall and st 29.758→45.535.
- During acceleration, AI cars jump straight into the garage (see 2.4) and `sessionTimeLeft` drops in big steps.
- No offline race shows acceleration.

### 1.10 Flashbacks

All five are in SgW, with recovery mode 1 (flashbacks):

| FLBK sent at (st, f) | Target f / st (event) | First packet after (st, f) | Notes |
|---|---|---|---|
| 496.561, f42053 | 41153 / 481.561 | 484.014, f41153 (a Session packet) | undoes our terminal damage PENA 16/42, SCAR SC deployed and DRSD; the first post-FLBK st is 2.453 s after the event's target time |
| 757.045, f57644 | 56744 / 742.045 | 742.098, f56744 | |
| 742.831, f56788 | 56743 / 742.076 | 742.097, f56743 | second rewind inside the first; target one frame earlier |
| 4581.839, f308668 | 307768 / 4566.839 | events first at f307768 still with st 4581.839, then Session at 4566.882 | RTMT car 7 and car 0 are **re-sent** after the rewind (they retired at 1792.785 and 1170.453) |
| 4580.390, f308579 | 307765 / 4566.822 | events at f307765 with st 4580.390, then 4566.882 | RTMT car 7 and car 0 re-sent again |

- `overallFrameIdentifier` keeps rising (f42053→41153 while ofid stays 42053).
- The packets after a rewind can carry the target frame id with the old session time (the events), so the frame id drops before the session time does.
- After the lap-44 rewinds the first session time is 4566.882 for both, although the targets differ (4566.839 and 4566.822).

### 1.11 Recording and stream oddities that affect phases

- **No SSTA:** MiP starts mid-session (st 121.552, f3833), ZvP2 at st 0.076, ZvR with events at st 0 (f16725), MiR at st 0.000 with a Session packet.
- **Events before the first Session packet:** SgW has 77 s of them, ZvR 112.6 s (stale f16725), ZvR2 50 s. LGOT and SCAR among them carry `playerCarIndex` 0.
- **ZvR2** LapPositions headers stay frozen at st 33.337, f10539 for the first 350 s (see index). The scripts excluded packet 15 from the header checks.
- The session uid was reused across weekends (ZvP/ZvP2 and ZvR/ZvR2, see index).

### 1.12 Red flag

- **Not seen.** The red flag setting is 2 (standard) in most sessions. `numRedFlagPeriods` stays 0 everywhere and no RDFL appears.

---

## 2. Car situations

### 2.1 Garage

- **Signals:** ds 0 marks the garage. ps is usually 1 ("pitting") while the car is in the garage.
- **Exceptions:**
  - Some cars show ps 0 in the garage and switch to 1 seconds before leaving: ZvP car 1 ps 0→1 at 13.784, ds 0→3 at 30.643; car 10 295.048→298.116; car 3 475.093→478.188; ZvP2 car 1 41.264→58.121.
  - On entering, the player shows one frame of ps 2 in the box, then ds 2→0 with ps 2→1 in the next frame (MiP 542.845 / 542.879; SgQ AI the same).
  - Some cars go ds 2→0 with ps staying 1 and no ps 2 (SgQ car 1 at 332.118, car 13 at 334.585, car 12 at 454.077).
- **Garage tyre fitting:** ZvP soft at 384.443, ZvP2 at 7.096, MiP at 1044.724 (compound 18→16, age 4→0). Stints change with no pit visit.
- **Seen in:** SgQ, ZvP, ZvP2, MiP, and retired cars in every race.

### 2.2 Leaving the garage (out lap)

- **Signals:** ds 0→3 at the garage box with ps still 1 (MiP player at d69; ZvP player at d-4157). Then ps 1→0 at pit exit (MiP d256 at 649.872; Zandvoort d-4032 or d227; SgQ d-4645). Then ds 3→1 at the line (flying lap).
- In practice and qualifying `pitLaneTimerActive` never turns 1 and pl stays 0 in the pit lane.
- **SgQ, the player at 138.968, during time acceleration:** ds 0→3 and ps 1→0 in one frame, with `lapDistance` jumping from -4896 to -1539. The car is put on track 1.5 km before the line.
- **SgQ AI during acceleration:** ds 0→3 and ps 1→0 in the same frame (frames are sparse).
- **Lap number:** in practice and qualifying the out lap after a garage visit crosses the line *without* the lap number rising, and the flying lap keeps the number of the earlier in-lap (MiP: lap 4 in at 540.123, out lap, line at 747.822 still lap 4; lap 4→5 at 850.609). This matches `outLapReachesLine` in `laps.ts`.

### 2.3 In lap to the garage (practice and qualifying)

- **Signals:** ds 1→2 shortly before pit entry (MiP d5251–5256 versus entry d5284). Then ps 0→1 at pit entry (MiP 534.607 d5284; ZvP 329.844 d4244; SgQ d4853). The car crosses the line in the pit lane **without the lap number rising** (MiP 540.123 lap 4 stays 4; ZvP 330.763; SgQ L2 d166). `currentLapInvalid` resets at that line (MiP 1563.605). Then ps 1→2 at the box and ds 0 the next frame.
- **Garage boxes before the line:** MiP car 15 (d5410), car 12 (d5396), car 0 (d5410). Everyone else's box is after the line.

### 2.4 Teleports into the garage

- **Player "return to garage" mid-lap:** SgQ 467.514, lap 4. ds 1→0 with ps 0 and d739→33. In the next frame ps 0→1 and d4929. There is no pit-lane passage.
- **AI on in-laps during time acceleration** (all with ds 2→0 and ps 0→1 in one frame, t0):
  - SgQ: cars 5, 2, 10 at 501.014, 513.509, 528.855 (d4929);
  - MiP: cars 6 and 9 at 597.948 and 613.677 (d5411); cars 5, 16, 11 at 982.9–1014.4; car 2 at 1619.549.
- **Retired cars, put into the garage about 70 s after retirement** (ds 4→0 with ps 0→1 and plta 0→1; `lapDistance` jumps to the garage):
  - MxR car 2: RTMT 202.693 → 272.748;
  - MxR car 11: 1392.829 → 1462.872;
  - MiR car 18: 1456.006 → 1526.056;
  - SgW car 0: 1170.453 → ds at 1237.694, ps at 1237.716;
  - SgW car 7: 1792.785 → 1862.810;
  - ZvR2 car 2 after only 10 s: 916.028 → 926.042 / 926.063.
- A teleported retired car shows ps 1 with plta 1 from then until the end.

### 2.5 Race pit stop: entry, box, exit

Typical sequence (MiR stop 1 of the player, lap 6→7):

| Step | Signal | MiR | MxR stop 1 | SgW stop 1 | ZvR2 stop 1 |
|---|---|---|---|---|---|
| in lap | ds 4→2 | 710.372 d5263 | 508.131 d4473 | 542.263 d4851 | 542.274 d4160 |
| pit entry | ps 0→1, plta 0→1 (pl starts 0–26) | 710.893 d5284 | 508.213 d4475 | 542.368 d4853 | 548.387 d4244 |
| line in pit lane | lap +1, pl keeps counting | 717.055 | 510.539 | – | 549.521 |
| box | ps 1→2, pst starts | 719.640 d40 | 516.437 d108 | 553.865 d37 | 553.276 d47 |
| tyres change | CarStatus compound and age | 720.641 | 517.346 | 555.130 | 554.740 |
| leave box | ps 2→1, pst frozen | 722.341 (2.516 s) | 519.037 (2.515 s) | 556.715 (2.083 s) | 562.213 (8.566 s) |
| out lap | ds 2→3 | 722.931 | 519.448 | 556.933 | 562.705 |
| stop counted | nps +1 (still in the pit lane) | 725.110 | 522.763 | 558.734 | 565.105 |
| pit exit | ps 1→0, plta 1→0; pl reads 0 **in this same frame** | 733.679 d256 | 531.104 d341 | 572.663 d284 | 574.376 d227 |
| out lap ends | ds 3→4 | at the next line, 837.233 | 629.093 | 671.028 | 648.728 |

- At all four race tracks every box lies just after the line, so the lap number rises in the pit lane before the stop. The tracks are Miami (entry d5284, boxes d27–149, exit d256), Mexico (d4475, d56–188, d341), Singapore (d4853, d23–153, d284) and Zandvoort (d4244, d34–151, d227). No race car stopped in a box before the line.
- **ds 2 lead time:** ds 2 starts 0.1–6 s before ps 1, and the gap is track-specific (Zandvoort 84 m, the rest 2–32 m). In SgW, AI cars 12 and 6 got ds 2 at the *line* one or two laps before their stop: car 6 has ds 2 from 439.393, lap 5, until its stop on lap 6 at 647.312. Both changes are close to the 496→481 flashback.
- **nps lag:** nps rises 2–3 s after the car leaves the box, while ps is still 1.
- **Exit:** pl resets to 0 on the exit frame. The last real value is on the frame before. The pit lane timer runs in races only.
- **Out-lap ds flicker:**
  - Miami: ds 3→2→3 about 250 m after pit exit (d511–547, lasting 1.1–1.2 s) on every out lap (player 740.800 / 741.925; all AI).
  - Zandvoort: several out laps end ds 3→4 at d506–508, not at the line. These are car 0 (the other human) on both of its stops, car 18 at 912.930, and cars 17, 15, 19, 16, 12, 13 under the SC. Others end at the line.
- **Stationary times:** 2.0–3.4 s normally. About 7.7–8.6 s in other stops (ZvR2 car 1 8.566, MxR 7.703, MiR car 2 8.540, car 6 8.529, player 8.542), with no penalty involved in most.
- **Pitting under SC/VSC:**
  - MiR: 9 AI stop on laps 2–3 (entries 233.4–255.7; VSC from 203.1, SC from 229.7).
  - ZvR2: most AI and the player stop on lap 12→13 under the SC (entries 940.3–971.9; SC from 924.2).
- **TMPT** precedes the teammate's ps 0→1 by about 0.1 s (SgW 538.732 versus 538.836).
- **Seen in:** SgW, ZvR2, MxR, MiR, and AI cars of every race.

### 2.6 Penalties given

| Rec | PENA type/infringement (count) |
|---|---|
| SgR | 5/4 ×5, 5/7 ×1 |
| SgQ | 5/7 ×2 |
| SgW | 5/7 ×4, 5/10 ×1, 4/21 ×1 (3 s), 16/41 ×2, 16/42 ×1 (undone by FLBK) |
| ZvP | 5/10, 16/42 |
| ZvP2 | 16/42 |
| ZvR | 5/4 ×4, 16/42 |
| ZvR2 | 5/4 ×10, 16/42 ×2 |
| MxR | 5/4, 5/7 ×3, 5/27, 4/21 (3 s), 16/41 ×2 |
| MiP | 5/7 ×4, 5/27 ×5, 12/7 ×1 |
| MiR | 5/4 ×8, 5/7, 5/27, 5/28, 4/21 (3 s), **0/38 (drive-through, VSC exceeding allowed pace)**, 16/41 |

- **Warnings:** `totalWarnings` and `cornerCuttingWarnings` rise one frame (about 0.03 s) after the PENA. Collision warnings (5/4) come in pairs, one per car, about 4 s after the COLL.
- **Time penalty:** PENA 4/21 time 3 → LapData `penalties` 0→3 one frame later (SgW 659.526/659.541; MxR 6164.705/6164.731; MiR 1683.516/1683.544).

### 2.7 Drive-through (MiR only)

- **Given:** PENA 0/38 at 1531.797 (lap 14, as the second VSC resumed at 1531.770). udt 0→1 at 1531.824, one frame later. `pitStopShouldServePen` stayed 0 throughout.
- **The visit:** ds 4→2 at 1602.446, ps 0→1 at 1603.226, line at 1608.897 (lap 15), box at 1611.483, tyres changed (7→7, age 8→0) at 1613.226, box left at 1620.648 (stationary 8.542 s), ds 3 at 1620.989, nps 1→2 at 1623.171, pit exit at 1631.735 (d256). An offline pause of 9.3 s fell at 1624.940, inside the pit lane.
- **Served:** DTSV car 19 at 1638.850, **7.1 s after the pit exit** at d513 (the Miami out-lap flicker spot). udt 1→0 at 1638.878.
- The drive-through was served on a visit that also changed tyres.

### 2.8 Lap invalidation

- **Field:** `currentLapInvalid` 0→1 one frame after the cause. It clears at the next line, including a line crossed in the pit lane on the way to the garage, where the lap number does not rise (MiP 1563.605).
- **Causes seen:**
  - MiP PENA 12/7 "this lap invalidated without reason" (1526.962 → inv 1526.992).
  - MiR: no lap-invalidation PENA. The flag rose with a warning 5/28 at 1683.488 (inv 1683.516) and the 4/21 time penalty; it cleared at the line at 1735.187.
  - TT: PENA 13/26 "this and next lap invalidated"; the flag stayed set over the next lap and cleared one line later.
- Other recordings: no player lap was invalid (see index).

### 2.9 Retirements

- **AI mechanical failure** (MxR ×2, SgW ×2, MiR ×1):
  - RTMT reason **0**;
  - rs 2→7 in the next LapData (0.01–0.03 s);
  - PENA 16/41 (retired, mechanical failure) **about 1.0 s after** the RTMT;
  - `numActiveCars` −1 about 1.2–1.6 s after the RTMT;
  - VSC deployed about 3 s after the RTMT in MxR and MiR, not in SgW;
  - into the garage about 70 s later (2.4);
  - rs 7→4 (DNF) in the last frame before SEND (MxR, MiR).
- **Terminal damage:**
  - ZvR2 car 2: PENA 16/42 at 912.011 comes 4 s *before* RTMT (916.028) and rs 7 (916.042). `numActiveCars` −1 at 918.059.
  - The player in SgW, ZvP, ZvP2, ZvR and ZvR2: PENA 16/42 and RTMT (where present) in the same frame. In ZvP and ZvP2 the other human's RTMT follows at the same session time, 5–6 s wall later.
  - Online, the session then goes straight to simulation (1.7). The last LapData still shows the player rs 2 (ZvR2 1207.660, see index).
- **Player retires from the menu (MiP):** RTMT car 19 reason 0 at 1653.025, then the final frame with rs 7 and SEND (1.6).
- **Other human leaves:** ZvR2 car 0 is DNF after 13 laps in FinalClassification. LapData shows no RTMT and no rs change for it before our retirement at 1207.667.
- **Field gaps:** the RTMT `reason` was 0 ("invalid") in every recording. FinalClassification `resultReason` is 3 for finishers and 4 for DNFs (MxR, see index). In SgQ every car shows rs 3 and rr 3 at the end.

### 2.10 Finished and cool-down lap

- rs 2→3 comes in the frame the car crosses the line. The lap number does **not** rise (it stays at the last lap) and `currentLapTimeInMS` freezes at 26–30 ms. The car keeps driving with ds 4 and rising `lapDistance` (MiR car 13 d1811→2127 over 2263.7–2270.3).
- A lapped car finishes when it crosses after the winner (MxR car 10 on lap 70 at 6873.521).
- The player's own finish ends the session immediately: SEND 0.03–0.06 s after the crossing (MiR, MxR). The data holds no cool-down lap for the player.
- In the last frame every car still running gets rs 3 mid-lap (MiR cars 1 and 6; MxR cars 15, 17 and 18, car 18 still on an out lap).
- **Qualifying end:** every car turns rs 3 at time-out (SgQ 900.594), wherever it is.
- **Practice end (MiP):** every car turns rs 3 when the player retires.

### 2.11 Grid and DSQ transient

- **ZvR:** the player has rs 5 (DSQ) during the formation lap (125.371 to the reset), with RTMT and `numActiveCars` −1, then rs 2 again (1.2).
- No final DSQ, no black flag and no "not classified" in any recording.

### 2.12 Spectating, player index changes, joins

- `isSpectating` stays 0 and `spectatorCarIndex` goes 0→255 at about st 1 in every session.
- `playerCarIndex` changes only on single event packets: formation SCAR/LGOT, the formation reset in SgW, MiR and ZvR2, and DRSD in ZvR2. They carry 0 and the next packet is back to the player.
- No Participants change of `aiControlled` or `networkId`. No car joins mid-session. `numActiveCars` only drops at retirements and rises once in the ZvR formation lap.

---

## 3. Situation × recording

✓ = seen, – = not seen, (✓) = partial or only as an anomaly.

| # | Situation | SgR | SgQ | SgW | ZvP | ZvR | ZvP2 | ZvR2 | MxR | MiP | MiR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pre-start at session time 0 until LGOT | ✓ | – | ✓ | – | ✓ | – | ✓ | ✓ | – | ✓ |
| 2 | Formation lap (scs 3, SCAR type 3) | – | – | ✓ | – | ✓ | – | ✓ | – (setting on) | – | ✓ |
| 3 | Session time reset at the formation end | – | – | ✓ | – | ✓ | – | ✓ | – | – | ✓ |
| 4 | Start lights STLG ×5 | ✓ | – | ✓ | – | ✓ | – | ✓ | ✓ | – | ✓ |
| 5 | Lights out LGOT | ✓ | – | ✓ (×2) | – | ✓ (×2) | – | ✓ (×2) | ✓ | – | ✓ |
| 6 | Session time reset or jump at lights out (online) | – | – | – | – | ✓ | – | ✓ | – | – | – |
| 7 | VSC (deployed / ending / resume) | – | – | – | – | (✓) deploy only | – | ✓ | ✓ | – | ✓ ×2 |
| 8 | Full SC (deployed / returning / returned / resume) | – | – | (✓) deploy undone | – | – | – | ✓ | – | – | ✓ |
| 9 | VSC upgraded to SC | – | – | – | – | – | – | ✓ | – | – | ✓ |
| 10 | SCAR with no scs change (undone or simulated) | – | – | ✓ | – | ✓ | – | ✓ | – | – | – |
| 11 | Pit stops under SC/VSC | – | – | – | – | – | – | ✓ | – | – | ✓ |
| 12 | Red flag (RDFL) | – | – | – | – | – | – | – | – | – | – |
| 13 | Race winner RCWN | – | – | – | – | – | – | – | ✓ | – | ✓ |
| 14 | Chequered flag CHQF | – | – | – | – | – | – | – | – | – | ✓ |
| 15 | SEND | ✓ quit | ✓ time over | ✓ quit | – | – | – | – | ✓ finish | ✓ retire | ✓ finish |
| 16 | No SEND (online end) | – | – | – | ✓ | ✓ | ✓ | ✓ | – | – | – |
| 17 | Post-session simulation (session time jumps to the end) | – | – | – | ✓ | ✓ | ✓ | ✓ | ✓ (after SEND) | ✓ (after SEND) | – |
| 18 | FinalClassification | – | ✓ | – | ✓ UID-0 | ✓ UID-0 | ✓ UID-0 | ✓ UID-0 | ✓ | ✓ | – |
| 19 | Offline pause (no packets, frozen session time) | – | ✓ | ✓ | – | – | – | – | ✓ | ✓ | ✓ |
| 20 | Online pause (gamePaused 1, time runs) | – | – | – | ✓ | – | – | – | – | – | – |
| 21 | Garage time acceleration | – | ✓ | – | – | – | – | – | – | ✓ | – |
| 22 | Flashback | – | – | ✓ ×5 | – | – | – | – | – | – | – |
| 23 | Events re-sent after a flashback (RTMT) | – | – | ✓ | – | – | – | – | – | – | – |
| 24 | Recording starts mid-session or without SSTA | – | – | – | – | ✓ | ✓ | – | – | ✓ | ✓ |
| 25 | Garage (ds 0) | – | ✓ | (✓) retired | ✓ | – | ✓ | (✓) retired | (✓) retired | ✓ | (✓) retired |
| 26 | Leave garage, out lap to the line | – | ✓ | – | ✓ | – | ✓ | – | – | ✓ | – |
| 27 | In lap into the garage via the pit lane | – | ✓ (AI) | – | ✓ | – | – | – | – | ✓ | – |
| 28 | Teleport into the garage (return to garage, time acceleration) | – | ✓ | – | – | – | – | – | – | ✓ (AI) | – |
| 29 | Retired car moved to the garage | – | – | ✓ | – | – | – | ✓ | ✓ | – | ✓ |
| 30 | Race pit stop (entry, box, exit, timers) | – | – | ✓ | – | – | – | ✓ | ✓ | – | ✓ |
| 31 | Line crossed in the pit lane before the box (lap +1) | – | – | ✓ | – | – | – | ✓ | ✓ | – | ✓ |
| 32 | Garage box before the line | – | – | – | – | – | – | – | – | ✓ (AI) | – |
| 33 | Same-compound new set at a stop | – | – | – | – | – | – | – | ✓ | – | ✓ |
| 34 | Garage tyre fitting (no visit) | – | – | – | ✓ | – | ✓ | – | – | ✓ | – |
| 35 | Out-lap ds flicker or mid-lap ds 3→4 | – | – | – | – | – | – | ✓ | – | – | ✓ |
| 36 | In lap flagged laps before the stop | – | – | (✓) AI | – | – | – | – | – | – | – |
| 37 | Drive-through given and served (PENA 0, udt, DTSV) | – | – | – | – | – | – | – | – | – | ✓ |
| 38 | Stop-go (PENA 1, usg, SGSV) | – | – | – | – | – | – | – | – | – | – |
| 39 | Time penalty (PENA 4, `penalties`) | – | – | ✓ | – | – | – | – | ✓ | – | ✓ |
| 40 | Warnings (PENA 5) | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ |
| 41 | Lap invalidated (`currentLapInvalid`) | – | – | – | – | – | – | – | – | ✓ | ✓ |
| 42 | AI retirement, mechanical (RTMT, PENA 16/41, rs 7) | – | – | ✓ | – | – | – | – | ✓ | – | ✓ |
| 43 | Retirement, terminal damage (PENA 16/42) | – | – | ✓ (undone) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| 44 | Player retires from the menu | – | – | – | – | – | – | – | – | ✓ | – |
| 45 | Retired becomes DNF at the end (rs 7→4) | – | – | – | – | – | – | – | ✓ | – | ✓ |
| 46 | Other human leaves (DNF only in FinalClassification) | – | – | – | – | – | – | ✓ | – | – | – |
| 47 | Transient DSQ (rs 5) | – | – | – | – | ✓ | – | – | – | – | – |
| 48 | Finished (rs 3) and cool-down lap (AI) | – | – | – | – | – | – | – | ✓ | – | ✓ |
| 49 | Lapped car finishes | – | – | – | – | – | – | – | ✓ | – | – |
| 50 | Session end sets everyone rs 3 | – | ✓ | – | – | – | – | – | ✓ | ✓ | ✓ |
| 51 | TMPT | – | – | ✓ | – | – | – | – | ✓ | – | – |
| 52 | Spectating or `playerCarIndex` change (real) | – | – | – | – | – | – | – | – | – | – |
| 53 | Car joining mid-session | – | – | – | – | – | – | – | – | – | – |
| 54 | `networkPaused` | – | – | – | – | – | – | – | – | – | – |

**Counts:** 54 situations in the table. 49 are seen in at least one recording. 5 are seen in none: #12 red flag, #38 stop-go, #52 spectating, #53 car joining and #54 `networkPaused`. Section 4 lists 21 further spec-documented situations that no recording shows.

---

## 4. Documented in the F1 25 spec, never seen in our recordings

| Situation | Spec signals |
|---|---|
| Red flag | event RDFL (no details). Session `numRedFlagPeriods`. DRSD reason 2 (red flag). RTMT and FinalClassification reason 7 (red flagged). The `redFlags` setting (we have 2 = standard). `safetyCarStatus` has no red value, so the restart only shows as SCAR/scs (an SC restart) or LGOT (a standing restart) |
| Stop-go penalty | PENA type 1, infringement e.g. 45 (unserved stop go). LapData `numUnservedStopGoPens`. Event SGSV `vehicleIdx` plus `stopTime` (s, new in F1 25). `pitStopShouldServePen` |
| `pitStopShouldServePen` = 1 | LapData; not even set during MiR's pending drive-through |
| Unserved-penalty escalation | PENA infringements 13 ignoring drive through, 14 too many drive throughs, 15/16 drive-through reminders, 46 unserved drive through, 20 too many penalties, 22 approaching disqualification |
| Disqualification (final) | PENA type 6. rs 5. FinalClassification rs 5 |
| Black flag | PENA type 17 (black flag timer), infringement 44. Retirement reason 6 (black flagged) |
| Not classified | rs 6. FinalClassification resultReason 5 (not enough laps completed) |
| Inactive / invalid slots | rs 0/1 (the FAQ says to treat them as no data; seen only as constant values for unused slots) |
| Formation-lap infringements | PENA type 7 (removed from formation lap). Infringements 39 (formation lap below allowed speed) and 40 (formation lap parking) |
| SC infringements | infringements 35 (SC to car collision), 36 (SC illegal overtake), 37 (SC exceeding allowed pace), 43 (SC falling too far back). Only 38 (VSC pace) was seen |
| Pit-lane infringements | 17 pit lane speeding, 33 blocking the pit lane, 10 crossed pit exit lane (seen: ZvP, SgW, as warnings) |
| Jump start, grid penalties | infringement 34 (jump start). PENA type 2 (grid penalty). Infringements 47–50 (component, gearbox, parc fermé, league grid penalty) |
| Parked too long | PENA type 8, infringement 18 |
| Session skipped / simulated retirements | RTMT reasons 9 and 10. Our simulated sessions sent RTMT reason 0 or none at all |
| Spectating | Session `isSpectating` = 1 and `spectatorCarIndex`. LobbyInfo `readyStatus` 2 |
| Car joining or leaving online | Participants `numActiveCars` rising, `aiControlled` flipping (human ↔ AI), `networkId` |
| Network pause per car | CarStatus `networkPaused` |
| Split screen | header `secondaryPlayerCarIndex` ≠ 255 |
| SCAR returning/returned for the formation lap or VSC | SCAR eventType 1/2 with type 3. Type 2 with eventType 2 never seen |
| DRSD for safety car / min lap | DRSD reason 1 (safety car) and 3 (min lap not reached). Ours always said 0, even at SC deployment |
| Lap-invalidation PENA types | PENA 10, 11, 14, 15. Infringements 30 wall riding, 31 flashback used, 32 reset to track |
| Retry penalty, mandatory pit stop, illegal time gain | infringements 51, 53 and 52 |

---

## 5. Observations

1. **Session time is not monotonic within one uid.** It resets for the formation-lap start (all four formation recordings). It resets or jumps again at online lights out, rewinds on flashbacks, freezes during lights and pauses, runs up to 30× faster in the garage, and jumps by hours into the post-session simulation. Frame ids keep rising through resets and acceleration but go to 0 at SEND. A history keyed on session time alone can see the same session time twice: before and after the formation reset, and both within the first 0.3 s of the race in ZvR2.
2. **Start and end markers come before the Session packet that confirms them.** SCAR leads scs by one Session packet (0.5–1.3 s). RTMT leads rs 7 by one frame, PENA 16/41 lags RTMT by about 1 s, and `numActiveCars` lags it by 1.2–2 s. PENA leads `totalWarnings`/`penalties`/udt by one frame. Pit-related changes come in a fixed order (ds 2 → ps 1 → line → ps 2 → tyres → ps 1 → ds 3 → nps → ps 0). DTSV can arrive seconds after the pit exit.
3. **`driverStatus` is noisy around the pit lane.** In lap 2 can start a lap or more before the stop. Out laps flicker 3→2→3 or end mid-lap at a track-specific point. The garage shows both ps 0 and ps 1. Garage entry can skip ps 2.
4. **The engine's pit visit (ps change from 0 and back) also catches non-stops.** It catches garage departures where ps starts at 0, teleports into the garage (ds 2→0 with ps 0→1, which stay open until the car leaves again), and retired cars teleported to the garage (ps 1 until the end, never closed).
5. **Lap numbering differs by session type.** In races the line crossed in the pit lane increments the lap before the stop (all race boxes are after the line). In practice and qualifying the pit-lane line crossing to the garage does not increment, and the next out lap keeps the number. A finishing crossing never increments, and the frozen 26–30 ms lap time marks a finished car.
6. **Neutralisations can be announced and then never shown.** A flashback can undo a deployment, and a retirement can be followed by simulation. Each time a SCAR "deployed" without any scs change remains. A resume can come twice, as types 1 and 0. A VSC has no "returned" event.
7. **The end of a session takes six different shapes.** They are a quit (SEND with no classification), time over (SEND, then a classification with the uid), the player's finish (SEND within 0.06 s of the line; no cool-down data for the player), retiring from the menu (SEND, then a simulated classification at the full duration), and an online terminal-damage retirement (no SEND; UID-0 classification at a jumped session time). The last frame before SEND sets every running car to rs 3 and retired cars to rs 4, mid-lap.
8. **Pauses look different offline and online.** Offline they are gaps in all packets with frozen session time (up to 162 s here), which a replay shows as a jump in wall time only. Online they are `gamePaused` 1 while everything runs on. Garage time acceleration is the inverse case: session time runs ahead with normal frame cadence.
9. **Flashbacks re-send events** (RTMT for long-retired cars). The first packets after a rewind can carry the target frame id with the pre-rewind session time. After a rewind the session time at the target frame differs from FLBK's `flashbackSessionTime` by 0.02–2.45 s.
10. **The RTMT reason is always 0 and `pitStopShouldServePen` was never 1.** These spec fields cannot be relied on for retirement causes or for a penalty pending at the next stop. The cause of a retirement comes from PENA 16 with infringement 41/42, and a pending penalty from udt/usg.

---

## 6. Additions (2026-11-02)

### 6.1 Flags and penalties per recording

Transitions of the per-car FIA flag (`vehicleFIAFlags`, counted when a car's value changes to a non-zero one) and of the marshal-zone flags, and the PENA types/infringements, over every practice, qualifying and race recording:

| Rec | Session type | Car flags (yellow / green / blue) | Zone flags (yellow / green / blue) | PENA type/infringement (count) |
|---|---|---|---|---|
| SgQ | 6 (Q2) | – | – | 5/7 ×2 |
| MiP | 4 (short practice) | 6 / 9 / – | 3 / 6 / – | 5/7 ×4, 5/27 ×5, 12/7 ×1 |
| ZvP | 4 | 18 / 4 / – | 3 / 5 / – | 5/10, 16/42 |
| ZvP2 | 4 | 20 / – / – | 1 / 1 / – | 16/42 |
| SgR | 15 | – | 1 / 1 / – | 5/4 ×5, 5/7 |
| ZvR | 15 | 40 / – / – | 2 / 11 / – | 5/4 ×4, 16/42 |
| ZvR2 | 15 | 102 / 108 / 2 | 17 / 33 / 7 | 5/4 ×10, 16/42 ×2 |
| MxR | 15 | 77 / 108 / 33 | 22 / 32 / 148 | 5/4, 16/41 ×2, 5/27, 5/7 ×3, 4/21 |
| MiR | 15 | 113 / 113 / – | 28 / 35 / – | 5/4 ×8, 5/27, 5/7, 16/41, 0/38, 5/28, 4/21 |
| SgW | 15 | 64 / 53 / 5 | 7 / 28 / 16 | 5/7 ×4, 16/42, 5/10, 4/21, 16/41 ×2 |

- Yellow flags appear in practice and in races, not in the one qualifying recording. Blue flags (car and zone) appear only in races, for lapped cars.
- Warnings (PENA 5) appear in all three weekend phases.

### 6.2 The sprint (2026-11-02_15-17-14_e4984016b74ee5c8, recorded by the user as a sprint)

- `sessionType` 15 ("Race"), `ruleSet` 1, `weekendStructure` [15, 16]. The first Session packet carries an empty structure (`numSessionsInWeekend` 0) and `parcFermeRules` 0; later ones carry [15, 16] and 1.
- 10 laps, `sessionLength` 6. Formation lap (SCAR type 3 event 0 and 3 at st 0), five STLG, LGOT, DRSE at 99 s.
- All 20 cars on mediums; one car switched to softs; the player (car 19) never pitted.
- 4 FLBK, CHQF at 993.4 s, SEND at 997.7 s, no RCWN.
- Not yet known: whether a full sprint weekend lists its shootout sessions in the structure.

## 7. Race-start sequences (diagnosis, 2026-10-30)

### Common facts (all six)
- Every active car is on lap 1 on the first LapData frame, standing on its grid slot with the lap timer at 0:
  - lap distance negative behind the line, positive past it;
  - Singapore and Mexico grids lie wholly past the line (12 to 238 m);
  - Zandvoort: −94 to 58 m;
  - Miami: −19 to 133 m.
- Lap numbers stay 1 through the whole formation lap. The lap distance runs once around (wraps through the line without a rollover). After the formation-end reset it is re-based to the grid slot: Miami 5408 → −3; Zandvoort 4253 → −6.
- No PENA in any formation lap or on any reset frame. No pit-lane starter (pitStatus 0 for every car). No damage changes, laps, pit stops or flag phases are recorded in any formation lap.
- The formation lap does fill `miniSectors` with a full lap of crossings: 971 (Singapore wet), 979 (Miami), 840 (Zandvoort online).
- SCS turns 3 about 1 s into the session: 1.008 (Singapore wet), 1.069 (Zandvoort online), 0.887 (uid reuse), 1.025 (Miami). It falls back to 0 **during the start lights**, between STLG 1 and STLG 2: fid 10361 / 21225 / 8036 / 6028. So SCS 3 ends before lights out in every formation race.
- FL is 0 in the first Session packets of **every** race and becomes 1 about 0.5 s after SCS turns 3: 1.505 / 1.573 / 1.386 / 1.527. These are the first, unfilled Session packets.
  - In raceWetVscMexico FL is 1 from fid 37, but there is **no** formation lap (SCS never 3, no SCAR type 3, no clock reset).
  - In raceSingapore FL stays 0.
  - So the setting is not a usable trigger.
- The game sends `LGOT` + `SCAR(3,0)` at the formation lap's start (st 0, playerCarIndex 0) in raceSingaporeWet, raceZandvoortOnline and raceZandvoortUidReuse. Both come **before the first Session packet**, so `SessionTracker` drops them (`droppedBeforeSession`): the engine never sees them today.
  - raceFriendWet's file starts after them (first record is a Session packet, no SSTA).
  - The formation SCAR(3,0) is therefore never available to the engine in any recording.
- The whole-recording fall scan found **no fall without a flashback outside the race start** in any recording. Every later fall is a flashback (FLBK plus frame-id drop, raceSingaporeWet ×5). raceWetVscMexico has no fall at all.

### S1: no formation lap (raceSingapore, raceWetVscMexico)
- The clock holds at st 0 from fid 0 through the start lights:
  - raceSingapore: STLG ×5 at fid 48–240, LGOT fid 335, the hold ends at fid 336 (337 frames);
  - raceWetVscMexico: STLG ×5 fid 30–146, LGOT fid 213, the hold ends at fid 217.
- After the hold the clock runs from 0. No fall.
- SCS 0 throughout; FL 0 (Singapore) or 0 → 1 at fid 37 (Mexico).
- Events before LGOT: SSTA and STLG only.
- Current engine: fine. `startLights@0` ×5 and `lightsOut@0` are kept; every lap-1 cursor is opened at 0 with `fromStart`.

### S2: formation lap, one reset to 0 (raceSingaporeWet, raceFriendWet)

| | raceSingaporeWet | raceFriendWet |
|---|---|---|
| SCS 3 / FL 1 | 1.008 (fid 60) / 1.505 | 1.025 (fid 35) / 1.527 |
| formation end | hold at 169.566 fid 10189–10295, fall **169.566 → 0.000** at fid 10295 → 10296 | hold at 169.381 fid 5987–5993, fall **169.381 → 0.000** at fid 5993 → 5994 |
| reset frame events | SCAR(3,3) only (pci 0) | SCAR(3,3) only (pci 0) |
| hold at 0 | fid 10296–10620 | fid 5994–6261 |
| STLG ×5 | fid 10348–10545 (SCS 3 → 0 at 10361) | fid 6022–6130 (SCS 3 → 0 at 6028) |
| LGOT | fid 10618, st 0 | fid 6257, st 0 |
| after | runs from 0, no fall | runs from 0, no fall |
| events in the formation lap | none | none |

- Current engine: the reset clears the ~970 formation crossings and reopens every cursor at 0 with `fromStart` (cars at t0). The start events stay. Correct by luck: the reset lands at 0 and nothing is recorded after it before LGOT.

### S3: formation lap, reset to a non-zero time, hold, fall after lights out (raceZandvoortOnline)
- File starts mid-sequence: the first frame is fid 16725 at st 0.065 (LGOT + SCAR(3,0) at fid 16725 before the first Session, dropped). SCS 3 at 1.069 (fid 16757), FL 1 at 1.573.
- Formation lap:
  - RTMT car 0 at 125.339 (fid 20992). Car 0's `resultStatus` is 5 until the reset and 2 again from the reset frame on: the retirement is a formation artefact.
  - OVTK ×11 at fid 21188 st 131.495, the grid re-ordering five frames before the reset.
- Hold at 131.495 (fid 21186–21192), then fall **131.495 → 1.968** at fid 21192 → 21193, no FLBK, frame id rising.
  - The reset frame 21193 carries **OVTK ×24** (event headers st 0.000) and SCAR(3,3).
  - Cars 1–7 (grid slots past the line, 10–58 m) show `currentLapTimeInMs` 510 from the reset frame on, the others 0.
- Hold at 1.968 for 217 frames (fid 21193–21409):
  - STLG ×5 at fid 21219–21321, SCS 3 → 0 at fid 21225;
  - **LGOT at fid 21406, st 1.968**.
- Fall **1.968 → 0.065** at fid 21409 → 21410, **four frames after LGOT**, no FLBK. Then the race runs from 0.065.
- Current engine (reproduced, the B1 finding):
  - the first reset drops the RTMT, the 11 OVTK and 840 crossings, keeps the 24 reset-frame OVTK at 1968, and reopens the cursors of cars 1–7 with `fromStart: false` (t510);
  - the second "reset" (1968 → 65) drops the 24 OVTK, all five `startLights` **and the `lightsOut`**;
  - at 20 s: no start events, cursors 1–7 joined late with fuel `unknown`.

### S4: pre-formation fall, reset, small fall, hold, forward jump, two falls (raceZandvoortUidReuse, raw stream)
- Pre-formation:
  - fid 0: SSTA (0.139), LGOT + SCAR(3,0) (0.000, pci 0) before the first Session, then Session at **57.200** (FL 0, SCS 0);
  - frames 0–6 run 57.200–57.304;
  - fall **57.304 → 0.000** at fid 6 → 7, before the formation flag.
- SCS 3 at 0.887 (fid 60), FL 1 at 1.386. No events during the formation lap.
- Fall **131.714 → 0.033** at fid 7911 → 7912; no events on the reset frame.
- After the reset, still before the lights:
  - SCAR(0,3) at fid 7913 (0.056);
  - **DRSE** fid 7914 (0.056);
  - **SCAR(3,3) + OVTK ×15** at fid 7932 (0.355; clock holds 6 frames);
  - **DRSD(reason 0)** fid 7938 (header st 0.000, pci 0).
- Small fall **0.819 → 0.794** at fid 7946 → 7947 (25 ms).
- Hold at 0.794 for 405 frames (fid 7947–8370): STLG ×5 fid 7992–8187, SCS 3 → 0 at 8036, **LGOT fid 8369, st 0.794**.
- After LGOT:
  - the clock **jumps forward** to 6.790 (fid 8371) and runs to 6.908 (fid 8379);
  - falls **6.908 → 0.831** (fid 8380) and **0.831 → 0.027** (fid 8381), 11 and 12 frames after LGOT;
  - then the race runs from 0.027.
  - The LapData lap timer runs evenly through all of it (100 → 116 → 150 ms).
- **The engine never sees any of this today.** The file has 337 stale LapPositions packets with header fid 10539 / st 33.337 among the real ones. `FrameAssembler` keys on that overall frame id and drops every real frame up to fid 10536 as late.
  - The tracker therefore delivers fid 0 (57.2 s), then fid 10537 at 34.31 s, mid lap 1.
  - Current engine: that 57.2 → 34.31 fall is taken as a clock reset on an empty history, and every lap-1 cursor reopens joined late.
  - This is a tracker bug outside T1 (see Concerns).
- With the time rule, even a fixed tracker would keep zu's DRSE, DRSD and 15 grid-order OVTK (all after the reset at 0.033) as race events.


## 8. Start segment windows (all under 1 MB, measured with `pwrec-cut` into the scratchpad)

| Shape | Source, window | Size | What it holds | Notes |
|---|---|---|---|---|
| S1 | **existing** `race-singapore-start` (raceSingapore 0–0.5) | 465 KB | hold at 0, STLG ×5, LGOT | no new cut needed |
| S2 | raceSingaporeWet **[0, 1.6]** | 672 KB | formation start, SCS 3 at 1.008, FL 1 at 1.505; reset frame 10296 with SCAR(3,3); hold at 0 with STLG ×5, LGOT; race to 1.6 | in the segment the reset is 1.586 → 0; no formation records in 1.6 s (structure checks only); pre-Session LGOT/SCAR(3,0) inside (dropped by the tracker) |
| S2 (alt.) | raceFriendWet [0, 1.6] | 523 KB | same shape | needs the `raceFriendWet` label merged first; [0, 0.5] (401 KB) is too short: SCS 3 only from 1.025 |
| S3 | raceZandvoortOnline **[0, 2.1]** | 453 KB | formation 0.065–2.076, SCS 3 at 1.069; reset frame 21193 at 1.968 with OVTK ×24 + SCAR(3,3); hold with STLG ×5, LGOT at fid 21406; fall 1.968 → 0.065 at fid 21410; race to 2.1 | **reproduces B1 on current code** (scratch run: after the fall no start events, cursors 1–7 joined late); the 24 OVTK give a concrete discard check; no RTMT/pre-reset OVTK (125–131 s); [0, 3] is 550 KB |
| S4 (part) | raceZandvoortUidReuse **[0, 1.0]** | 588 KB | formation from the first in-window Session (fid 30, 0.390), SCS 3 at 0.887; reset to 0.033; SCAR(0,3), DRSE, SCAR(3,3) + OVTK ×15, DRSD; fall 0.819 → 0.794; hold with STLG ×5, LGOT at fid 8369; 0.831 then the fall to 0.027; race to 1.0 | the window excludes 57.2 s and 33.337 s, so the stale LapPositions are out and the tracker delivers it; no Participants until 0.715 in the race timeline, so the engine has no cars in the segment's formation part; the 6.79–6.908 jump frames fall outside (a window to 7 s is 1.76 MB) |
| P5 | **existing** `race-zandvoort-clock-reset` (raceZandvoortOnline [2, 9]) | 825 KB | formation 2–9 then race 2–9: a fall with no lights out | under the new rule this segment shows "a fall changes nothing"; its test (`apps/bridge/test/fixtures/race-clock-reset.test.ts`) must be rewritten |

Builder cases the segments cannot cover:
- zu's forward jump then two falls after LGOT (P4 over several falls);
- a pre-phase fall (zu fid 7);
- a mid-race fall with no flashback (P5, the red-flag risk);
- an LGOT with no STLG before it (the P3 guard);
- a join during the hold with cars past the line at t > 0 (P3b);
- a formation RTMT whose car is active again after the reset;
- a flashback attempt after lights out that would reach before it (snapshots restarted).

