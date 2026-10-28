# F1 25 UDP data mapping

## Sources
- **Official:** `external/Data Output from F1 25 v3-1.pdf` and `external/F1 25 Telemetry Output Structures.txt`. The [EA forum page](https://forums.ea.com/blog/f1-games-game-info-hub-en/f1%c2%ae-25-udp-specification/12187347) blocks automated access.
- **Cross-check:** the open-source parser `@deltazeroproduction/f1-udp-parser` 1.2.2. All 16 packets and their fields match the official spec, and the packet sizes add up.

## Key finding

The game gives **more than a real F1 team sees** in several areas, and less in only a few:
- **Telemetry, motion and lap data for all 22 cars**, at up to 60 Hz: rivals' speed, throttle, brake, gear, position, G-forces. Real teams have only GPS and timing data for rivals.
- **Car status and damage for all cars** (tyre wear per corner, compound and age, fuel, ERS). Restricted only for human players online who keep their telemetry private (see below).
- **The player's own car has lab-grade channels** (MotionEx):
  - per-wheel slip angle, slip ratio and tyre forces
  - suspension travel, velocity and acceleration
  - aero ride height front and rear, and camber

  That is more than most real logger setups expose.
- **The game computes its own pit window** (ideal lap, latest lap, rejoin position), a baseline to compare pitwall's strategy against.

## Mapping by view

Legend: ✅ direct · 🔧 derivable · ❌ missing · 🔒 own car only

### Timing
| Channel | Status | Source / note |
|---|---|---|
| Position, gap to leader, gap to car ahead | ✅ | LapData (all cars) |
| Sectors S1/S2, last/current lap | ✅ | LapData; S3 🔧 = lap − S1 − S2 |
| Lap history per car incl. sectors and valid flags | ✅ | SessionHistory (rotates through the cars) |
| Purple/green sectors, personal bests | 🔧 | from SessionHistory |
| Micro-sectors for all cars | 🔧 | lap distance + session time |
| Speed trap (best per car) | ✅ | LapData; any other measuring point 🔧 from Motion velocities |
| Compound and tyre age per car | ✅ | CarStatus + stint history |
| Pit status, stop count, time in pit lane, stationary time | ✅ | LapData |
| Penalties, warnings, corner cutting | ✅ | LapData + Events |
| Lap chart (positions per lap) | ✅ | LapPositions packet (new in F1 25) |

### Strategy
| Channel | Status | Note |
|---|---|---|
| Race history / gap chart | 🔧 | formula in [03](03-strategy-models.md) |
| Fuel-corrected lap times | 🔧 | fuel in tank ✅ (not for restricted cars) |
| Degradation fit per stint and car | 🔧 | lap history + stints, clean-lap filter |
| Tyre wear % per corner, rivals included | ✅ | CarDamage (not for restricted cars); real teams have to estimate this |
| Available tyre sets incl. wear and remaining life | ✅ | TyreSets (per car; none for restricted cars) |
| Pit loss green/VSC/SC | 🔧 | pit-lane timers + lap times; build a table per track from recordings |
| Game's pit window and rejoin position | ✅ | Session |
| SC/VSC status, SC delta, marshal-zone flags | ✅ | Session, LapData, Events |
| Weather forecast incl. rain % and temperature trend | ✅ | Session (forecast samples) |
| Retirements, overtakes | ✅ | LapData result status, Events |
| Rejoin projection and traffic | 🔧 | lap distance and time of all cars |
| SC/VSC probabilities for Monte Carlo | ❌ | game-specific (`m_safetyCar` setting); estimate from recordings |

### Car monitoring
| Channel | Status | Note |
|---|---|---|
| Tyre pressure, surface and carcass temperature (4 corners) | ✅ | CarTelemetry |
| Tread temperature inner/middle/outer | ❌ | only one surface and one carcass value per tyre |
| Brake temperatures (4 corners) + brake damage | ✅ | |
| Fuel in tank, game's remaining-laps estimate, fuel mix | ✅ | fuel flow ❌, 🔧 roughly from the change in fuel |
| ERS: store, deploy mode, harvested K/H, deployed, ICE/MGU-K power | ✅ | CarStatus |
| PU wear (ICE, MGU-H, MGU-K, ES, CE, TC), gearbox, engine temperature | ✅ | CarDamage |
| Damage to wings, floor, diffuser, sidepods; tyre damage; **blisters** (new) | ✅ | CarDamage |
| DRS/ERS faults | ✅ | |
| Oil/water pressure and temperatures | ❌ | |
| Alarms / ECU-style warnings | 🔧 | rules over the stream (ATLAS-style alarms) |

### Performance analysis
| Channel | Status | Note |
|---|---|---|
| Speed, throttle, brake, steering, gear, RPM, DRS | ✅ | **all cars**, so rival laps can be overlaid |
| Lap distance → distance mode, delta channel | ✅ / 🔧 | |
| World position x/y/z, track map, racing line | ✅ | all cars |
| G lateral/longitudinal/vertical, yaw/pitch/roll | ✅ | all cars → GG diagram 🔧 |
| Wheel speed, slip ratio, slip angle per wheel | ✅🔒 | MotionEx |
| Tyre forces lateral/longitudinal/vertical per wheel | ✅🔒 | |
| Suspension position/velocity/acceleration | ✅🔒 | → damper histograms possible |
| Aero ride height front/rear, CoG height, roll angles, camber | ✅🔒 | → aero platform analysis |
| Understeer/oversteer channel | 🔧🔒 | front vs rear slip angle; yaw rate against steering |
| Setup sheet | ✅ | own car; other players' setups blank online |
| Surface type per wheel (track limits, kerbs) | ✅ | |
| Brake pressure | ❌ | pedal position 0–1 only |
| Corner definitions per track | ❌ | 🔧 from the curvature of the recorded racing line |
| Video | ❌ | out of scope |

### What pitwall really can't get
1. tread temperature across the tyre (inner/middle/outer)
2. oil/water pressure, fuel flow, brake pressure
3. MotionEx channels for rivals
4. rival data from restricted human players
5. track metadata (corners, pit-lane geometry): can be built from recordings
6. SC statistics specific to the game: can be built from recordings

## Send rates (official spec)

| Rate | Packets |
|---|---|
| **Rate set in the menu** (up to 60 Hz; **default `sendRate` is 20**, so drivers who record must set 60) | Motion, LapData, CarTelemetry, CarStatus, MotionEx |
| 10/s | CarDamage |
| 2/s | Session, CarSetups |
| 20/s, rotating through the cars (each car at least once a second) | SessionHistory, TyreSets |
| 1/s | LapPositions, TimeTrial |
| every 5 s | Participants |
| on the event / once at race end | Event / FinalClassification (followed by a **bulk SessionHistory for all cars**) |

Packets at the menu rate always arrive **together in the same frame**, so the decoder can group them by frame.

## Online restrictions

"Restricted" applies only to **other human players online who haven't set their telemetry to public**. AI cars and offline sessions are unaffected.

For those players:
- **Zeroed:**
  - fuel (all values), brake bias, all ERS values, ICE/MGU-K power
  - **tyre wear, tyre damage, brake damage**
  - all bodywork, engine and PU damage, DRS fault
  - their whole TyreSets packet
- **Still visible:**
  - the entire CarTelemetry packet (including **tyre temperatures, tyre pressures, brake temperatures**, throttle, brake, gear)
  - compound and tyre age
  - LapData, Motion, SessionHistory
- **Setups:** blank for every other player in multiplayer, whatever their setting.

**Design rule:** "real rival tyre wear" holds for AI and offline sessions. Against restricted humans, pitwall has to **estimate** wear from tyre age, lap times and temperatures, the way a real team does. The strategy model must work with both.

For two drivers in the same online race: each driver's game sends LapData, Telemetry and Motion for all 22 cars, so the teammate's timing and telemetry are already in one feed. If the teammate sets telemetry to public, fuel, ERS and wear are there too. Only MotionEx and the setup exist exclusively in that driver's own feed.

## Fields that matter for the model

- **`TyreSetData.m_lapDeltaTime`:** the game's own lap-time delta for each tyre set against the fitted set. It is effectively the TUM compound offset `k0`. Alongside it: `m_lifeSpan` (laps left) and `m_usableLife` (recommended maximum laps).
- **Game settings in the Session packet:**
  - `m_safetyCar` (Off/Reduced/Standard/Increased) sets the SC probabilities for Monte Carlo
  - `m_tyreTemperature` (surface only, or surface and carcass) says whether carcass temperature means anything
  - `m_carDamage`/`m_carDamageRate`, `m_lowFuelMode`, `m_pitLaneTyreSim`, `m_recoveryMode` (whether flashbacks are possible)
- **`m_sector2/3LapDistanceStart`:** sector boundaries in metres, for splitting the lap by distance.
- **Event details:**
  - Retirement has a reason
  - SafetyCar events have phases (Deployed / Returning / Returned / Resume)
  - Collision events
  - DRS disabled has a reason
- **Header:** `m_frameIdentifier` jumps back after a flashback, while `m_overallFrameIdentifier` keeps counting. Together with the FLBK event, that detects flashbacks.
- **Active cars:** `m_numActiveCars` plus `m_resultStatus` per car (Invalid/Inactive = no data).
- **`m_mfdPanelIndex`** (CarTelemetry): which MFD panel is open. Needed by the pit actuator ([05](05-game-control-boundary.md)).
- The Motion packet is marked "only sent while player is in control", but its struct holds all 22 cars. In the recordings it arrived exactly as often as LapData.

## Findings from the first recordings (2026-10-27/28)

| Recording | Content |
|---|---|
| `2026-10-27_22-50-28` | menus only: 385 `BUTN` events, `sessionUid` 0 |
| `2026-10-27_23-31-43` (42 MB) | Time Trial Zandvoort, 19 min, 1 car, 15 completed laps (71.1–73.3 s), 60 Hz. No fuel use or tyre wear (TT). |
| `2026-10-28_00-15-04` (8 MB) | Race Singapore, 20 cars (1 human, 19 AI), 63 s, lap 1 unfinished: start lights, lights out, 39 overtakes, 4 collisions, 6 penalties. No pit stop, no SC. |

Confirmed:
- format 2025, game version 1.26
- packets at the menu rate at about 60 Hz
- Session at 2/s, Damage at 10/s, SessionHistory and TyreSets at 20/s rotating, LapPositions at 1/s, Participants every 5 s
- AI cars are `public`

Findings that changed the design (now in the spec):
1. **Gaps in `frameId` are not packet loss.** `frameId` jumps by 2 in about 3 % of frames while session time moves normally: the game runs faster than the send rate. The session-time step varies from 12 to 20 ms. Never assume a fixed time step.
2. **The final bulk SessionHistory arrives with `sessionUid = 0`,** about 0.1 ms *before* `SEND`. A grace window on both sides of `SEND` assigns it to the session that just ended.
3. **A UID alone doesn't make a session.** A non-zero `sessionUid` can appear with only button events (lobby/menu). A session opens only with the first Session packet.
4. The game writes small negative deltas as split times with `msPart ≥ 60000` and `minutes = 0`.
5. In Singapore, session time stays at 0 for about 5.6 s before lights out.

Recordings still needed (spec 12): a race of at least 25 % distance with a pit stop and finish; a race with SC/VSC (safety car "Increased"); a practice session with a flashback; an online session with two humans (restricted data).

Game settings for recording: UDP on, port 20777, broadcast off, **format 2025**, **send rate 60 Hz**.
