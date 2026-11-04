# Live acceptance checklist

Manual acceptance criteria 2 and 4 of the foundation (spec 11.1). They need a driver with the game running. Everything else is automated (`pnpm test:acceptance`, `pnpm check`, `pnpm mutation`).

## 1. Setup

- The laptop's IP: `tailscale ip -4`.
- Fedora firewall: `sudo firewall-cmd --add-port=20777/udp --zone=$(firewall-cmd --get-zone-of-interface=tailscale0)`.
- Game: UDP Telemetry On, Broadcast Off, IP = the Tailscale IP, port 20777, send rate 60 Hz, format 2025.
- `pnpm pitwall live` prints `listening ws://127.0.0.1:4777`.

## 2. Criterion 2: rates

While the driver is on track, run `timeout 10 pnpm -s pitwall tap <topic> [--carId <player>] | wc -l` for each topic, and record the count. Expected (hello and snapshot add 2):

| topic | lines |
|---|---|
| `feed.status` | 15–22 |
| `session.info` | 2–22 |
| `cars.overview` | 80–102 |
| `car.detail` | 250–302 |
| `car.telemetry` | 500–602 |

For the append topics:

- `laps`: a provisional entry within 1 s of crossing the line, then a confirmed one.
- `pitStops` / `stints`: after a pit stop with a tyre change.
- `events`: e.g. speed trap.
- `insights`: pausing the game for more than 2 s raises `feed.stale` and resuming resolves it. If pausing does not stop the stream, turn UDP Telemetry off for more than 2 s instead (it is unknown whether a paused game keeps sending).

Every line must parse as JSON. `feed.status` must show `connected: true` and `lossPercent` < 5.

## 3. Criterion 4: flashback

Keep `pnpm -s pitwall tap insights` and `pnpm -s pitwall tap laps` running in two terminals from before the start of lap 3.

- Scenario: Practice: 2 clean laps. Cross the line into lap 4, and within 3 s flash back about 5 s, to before the line. Drive on and complete lap 3 again.
- Expected on `tap insights`: no flashback insight (a flashback records no fact, C27), but one `snapshot` line right after it: the insights topic sent again whole (C30). `tap laps` gets one such `snapshot` too.
- Expected in the bridge's log: exactly one `flashback` line whose `flashback` has `targetLap: 3` and `rewoundMs` ≈ 5000.
- Expected on `tap laps`: the lap-3 entry appended before the flashback is absent from the snapshot sent right after it, and lap 3 appears again later.
- Consistency check:
  1. After the session has ended (driver in the menu, more than 10 s after the end) and before the next session starts, run `timeout 3 pnpm -s pitwall tap laps | sed -n 2p > live-laps.json`.
  2. Run `PITWALL_WS_PORT=4778 pnpm pitwall replay ~/.local/share/pitwall/recordings/<session file>`.
  3. Once it prints `replay finished`, run `timeout 3 pnpm -s pitwall tap laps --url ws://127.0.0.1:4778 | sed -n 2p > replay-laps.json`.
  4. `diff live-laps.json replay-laps.json` must be empty.

## 4. Keep the recording

- Copy the session file into `recordings/` and request `FIXTURES.practiceFlashback` and a `fixtures/index.json` entry from the supervisor.
- Take `t = flashback.targetSessionTime / 1000` (seconds; the field is in ms) from the bridge log's `flashback` line, then run `pnpm pwrec-cut <file> fixtures/segments/practice-flashback.pwrec.gz --from <t-5> --to <t+5>`. This is spec 12, recording 3.

## Results

Record the date, the counts per topic and the flashback outcome here after the run.

### 2026-11-04/05: first remote live test (WireGuard friend, car 19, Antonelli; AI teammate car 7)

A weekend on track 15 over the `lud` WireGuard tunnel. Feed: 0 % loss, cadence 28 ms, 4 receive gaps of 80–300 ms in the first 5 minutes. Recordings (`~/.local/share/pitwall/recordings`):

| session | file | size |
|---|---|---|
| short practice (type 4) | `2026-11-04_23-32-45_ae2907d2c5493776_car19.pwrec.gz` | 74.6 MB, 31 min |
| one-shot qualifying (type 9) | `2026-11-05_00-05-11_261aa3b56ae144ef_car19.pwrec.gz` | 8.1 MB, 1 lap (1:38.963) |
| race, abandoned (type 15) | `2026-11-05_00-09-56_69fd076f54e429b0_car19.pwrec.gz` | FL wing 100 % 10 s after lights out, SEND at 41 s |
| race (type 15) | `2026-11-05_00-13-26_f5b2b5fdb8a6c50e_car19.pwrec.gz` | 179 MB, 36 min, 20 laps, finished P8; SC on lap 12; stream cut right after the flag (no final classification, no end record) |

Findings for after the test:

- **Fuel gauge: show the fuel amount in kg always.** Today the kg appears only inside "lasts", which needs a burn, which needs 2 rate laps, so early in practice the panel shows only the game's figure. Waiting with "lasts", burn and margin until 2 laps is right; the amount itself must always show. (User, 2026-11-04.)
- **Projected lap is wrong after a garage visit in practice (bug).** On lap 8 it showed PROJ 7:25.3, +5:43.8 to best, P20, for a ~1:42 lap. The game keeps **one lap number across in-lap, pit lane, garage, out-lap and the next flying lap**. Car 19, lap 7, race clock: flying from 778 s, in-lap 893 s, pit entry 896 s, line crossed in the pit lane at 905 s (lap stays 7), garage 905 s, out-lap 1014 s, line at 1123 s (lap still 7, flying), lap 8 at 1224 s. The mini-sector recorder (`packages/engine/src/recorders/mini-sectors.ts`) keeps the cursor's segment when the lap distance wraps on the same lap number, so the flying lap 7 records **no** crossings. Its lap record (1:41.497) becomes the best, and `lap-times` takes the crossings of lap 7 from the first attempt at 778 s. `bestElapsed` comes out at −309 s, and the projection is +309 s too long. The crossings need a lap identity that is not the game's lap number alone, plus a guard so an inconsistent reference gives `unknown`, not a number. Fixture: this recording, race clock ~770–1240 s (cut to segments within C84).
- **Warning alarm in practice (bug), and the race rule needs checking.** The user got "one warning left before a penalty 2/3" in practice. The `alarms` behaviour table (`packages/analysis/src/alarms/behaviour.ts`) has no `weekend-phase` row, so `warningLast` is raised in every phase. Evidence from the player's PENA events in every recording: **practice never penalises warnings** (this session: 4 warnings, no penalty; 2026-10-30_18-26-27: 9 warnings, no penalty). **Race:** the first penalty came after the 4th warning in all 3 races that had one (10-29_00-04: time; 10-30_15-20: time; 10-30_18-53: drive-through after 4, then time after 5). That does not obviously match `warningsBeforePenalty: 3` and `warningInCycle` ("not verified against the game"). **Qualifying:** one recording, 2 warnings, no penalty; not enough evidence. The incident feed's `warning n/3` uses the same limit. **Race 00-13-26 shows the count mixes kinds:** warning 1 at lap 9 was corner cutting (infringement 27, "corner cutting ran wide gained time minor"), warning 2 at lap 16 was a **small collision** (infringement 4). The game then reads `totalWarnings` 2 but `cornerCuttingWarnings` 1, and pitwall raised "one warning left before a penalty 2/3". If track-limit penalties count only corner-cutting warnings, the alarm counts the wrong number. That may also explain the "penalty after the 4th warning" seen in older races (re-check those with the counts split by infringement). Adopting a rule needs `pitwall scan-situations` over every recording (C85). (User, 2026-11-05.)
- **Band alarms on lap 1 of a race (check).** In race 2026-11-05_00-13-26 (restart, no formation lap, lights out 7 s in), lap 1 ended at 107 s. Carcass temperatures (72–74 °C, band 75–110) and rear pressures (19.3 psi, band 20–31) were judged on that lap: advisories for car 19 and car 7 (teammate), and **two critical `bandOutLap` alarms** (rear pressures out for the whole lap) on car 19. Cold tyres on the opening lap are expected. Decide whether lap 1 (and an out-lap) should be judged at all; `lap-classes` already excludes lap 1 of a race from pace.
- **Tyre pressure bands are wrong (user, 2026-11-05).** `car-bands` has one band, 20–31 psi, for all four corners (`pressureLo` from an F1 24 setup page). Car 19's setup (Setups packet) is **20.9 psi rear, 24.2 psi front**. Live on track (speed ≥ 80 km/h, out of the pits), practice: rear p5–p95 19.7–21.5, median 20.9; front 22.6–24.9, median 24.2. So the live value sits at the setup value once warm. Race (cold start): rear 18.8–20.3, front 21.6–23.3. The rears sit at the floor in normal running and fall below it on a cold lap, while the 31 ceiling is never near. The band needs to be per axle and relative to the car's setup pressure (known for our cars; hidden for rivals under realism), not one fixed range.
- **Incident feed: "us" does not say which of our cars.** The user read "us P6→P7" while car 19 (Antonelli) was P10. The entry was `collision:16-8:63577` with `forUs.ourCarId: 7` (Russell, the teammate: P6→P7). Our cars are the player and the teammate, and the line shows `us` for both (`apps/ui/src/widgets/incident-feed/text.ts`). Name the car (e.g. `RUS P6→P7`), or keep `us` for the player only. (User, 2026-11-05.)
- **Gap chart too crowded to be useful (user, 2026-11-05).** 20 lines, every rival in its team colour (spec V04), all on one scale. Ideas to decide: only our cars and the few cars around them (the battle neighbourhood) in colour, the rest faint grey (the colour rule: colour only to highlight); zoom the y axis to the window around our car; the pit-loss line, so you see where a stop would rejoin.
- **Sectors update only once per lap (spec change).** The tower and lap analysis show `lastSectorsMs`, the sectors of the last completed lap (timing spec, lap-times board), so S1–S3 change together at the line. The user wants each sector shown as soon as it is finished, as on real timing screens: S1 at the end of sector 1, S2 at the end of sector 2, S3 and the lap at the line, with personal-best and session-best colours per sector as it comes in. The game sends `sector1TimeMs` and `sector2TimeMs` during the lap (already in the live state, `timing`). (User, 2026-11-05.)
- **Battle card: MARGIN has no unit and is hard to read.** It is `overtakeMarginMs` = pace delta − `overtakeThresholdMs` (1000 ms), in **seconds per lap**, shown as `+0.25` with no unit (`battle-cards/rows.ts`, `formatSignedSeconds`). The user had to ask what it means. Show the unit (`s/lap`), or a clearer label (e.g. "needs" / "pace to pass"). (User, 2026-11-05.)
- **Safety car without a cause (spec gap, user 2026-11-05).** Lap 12 of race 00-13-26: SCAR (full SC, deployed) at session time 1209.4 s, 3.5 s after a COLL of car 4 (Alonso) and car 5 (Tsunoda) at 1205.9 s. Both cars stopped (0 km/h at ~1208 s); Tsunoda's front-left wing was at 49 %. The feed shows only `neutralised` (minor) with no reason. The collision is in the `events` projection, but the incident feed shows only incidents of our cars or their neighbourhood (timing spec §6, line 146), so it is filtered out. The same filter hides 3 more of the race's 10 collisions so far (15-11, 2-9, 5-11). The game sends no cause for a safety car. The incident that most likely caused it (the collision, retirement or stopped car just before SCAR, anywhere on track) should be shown with the neutralised entry, whatever the neighbourhood.
- **Band alarms under the safety car (check).** Lap 13 (under SC): carcass advisories for car 7 (69.5–73 °C, band 75–110). Cold tyres behind the safety car are expected, as on lap 1. Decide whether neutralised laps are judged.
- **Carcass band, and AI tyre temperatures (open, user 2026-11-05).** The user says 70 °C carcass should be green; the slick band is 75–110 °C. Car 19 on track (≥ 80 km/h, out of the pits): practice median 99–100 °C, p5 74–75; race median 99–102, p5 67–71 (lap 1 and SC laps). Asked the user whether "70 is green" comes from the game's own tyre HUD; if so, take the game's colour ranges as the band's source. Car 7 (AI teammate) reads a **flat 90 °C carcass** (median = p95 on every corner, practice and race), so the game seems not to simulate AI tyre temperatures in detail. Band alarms for an AI teammate may be meaningless (lap 14: surface 40–48 °C advisories on car 7).
- **Damage loss: show that it is measuring, and a first estimate (user, 2026-11-05).** Car 19, lap 15 (race 00-13-26): front-right wing 0 → 92 % at 1609 s. `damage.car` gives `lossMsPerLap: insufficientData` until there are **two `forPace` laps after the jump** (timing spec, damage). That is at least two full laps, longer if an in-lap, out-lap or SC lap comes first (it does not count). The card shows nothing meanwhile. Wanted: an indicator of the measurement's progress ("measuring, 0/2 laps"), and a preliminary number before it is done, e.g. from the mini-sectors since the jump against the car's median for those segments (the incident feed already does that for time loss), marked as an estimate.
- **Projected lap: show the finish margin in minutes.** "FINISH 1128.6 s left at line" is hard to read; show `18:48.6` (m:ss.s) once it is a minute or more. (User, 2026-11-04.)
- **Recording size: ~150 MB per hour on track** (41.8 MB after 16.8 min; 240 MB raw, ratio 5.7×). Per-frame packets (telemetry, motion, lap data, status) are 76 % of the bytes, session history 12 %. The writer's gzip is not the problem: one-pass gzip -6 gives the same size, zstd -3 saves about 15 %. The lever is the send rate (here about 37 packets per second per frame type). A weekend (practice, qualifying, race) ≈ 0.5 GB. **Race: ~290 MB per hour** (00-13-26: +14 MB in 3 min), about twice practice at the same packet rate: with the whole field moving, the data compresses worse. A 1.5 h race ≈ 430 MB. (User asked to watch this, 2026-11-04.)
- **Wanted, already planned in research: sector and corner times over the laps (practice).** No new display requested; noted as confirmation of the planned analysis. An overview per lap of the car's sector times and corner (turn) times, so the driver sees whether a change they make (line, braking point, setup) gains anything. Related: research 06, "time lost per corner against a chosen reference" (line 141) and "balance per corner, against the previous run" (line 87). The per-lap mini-sector times need the crossing fix above first (one lap number can hold several laps in practice). (User, 2026-11-04.)
- **No way to bring back a closed panel.** The shell has no "add panel" command; the only way back was restoring the default `quali.json` by hand.
- **Stale flashes: the UI's WebSocket is dropped every ~20 s.** The bridge terminates a client that sent nothing for 15 s (`apps/bridge/src/ws/server.ts`, `timeoutMs`, checked every 5 s), and the UI never sends a `heartbeat` (no sender in `apps/ui/src/connection/`). Each window reconnects at once, and in between every panel shows stale (`Panel.svelte`: `store.connection !== 'open'`). Seen at 23:44:04 → 23:44:24 on both windows. The car fields and `feed.status` were fresh throughout. Not caused by the remote feed.
