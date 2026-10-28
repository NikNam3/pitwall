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
- Expected on `tap insights`: exactly one `raised` `session.flashback` with `targetLap: 3` and `rewoundS` ≈ 5.
- Expected on `tap laps`: the lap-3 entry appended before the flashback is absent from the snapshot sent right after it, and lap 3 appears again later.
- Consistency check:
  1. After the session has ended (driver in the menu, more than 10 s after the end) and before the next session starts, run `timeout 3 pnpm -s pitwall tap laps | sed -n 2p > live-laps.json`.
  2. Run `PITWALL_WS_PORT=4778 pnpm pitwall replay ~/.local/share/pitwall/recordings/<session file>`.
  3. Once it prints `replay finished`, run `timeout 3 pnpm -s pitwall tap laps --url ws://127.0.0.1:4778 | sed -n 2p > replay-laps.json`.
  4. `diff live-laps.json replay-laps.json` must be empty.

## 4. Keep the recording

- Copy the session file into `recordings/` and request `FIXTURES.practiceFlashback` and a `fixtures/index.json` entry from the supervisor.
- Take `t = raisedAt / 1000` (seconds; `raisedAt` is in ms) from the `session.flashback` line of `tap insights`, then run `pnpm pwrec-cut <file> fixtures/segments/practice-flashback.pwrec.gz --from <t-5> --to <t+5>`. This is spec 12, recording 3.

## Results

Record the date, the counts per topic and the flashback outcome here after the run.
