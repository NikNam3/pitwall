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
- `insights`: pausing the game for more than 2 s raises `feed.stale` and resuming resolves it.

Every line must parse as JSON. `feed.status` must show `connected: true` and `lossPercent` < 5.

## 3. Criterion 4: flashback

- Practice session: 2 clean laps, then crash in lap 3 and flash back about 5 s.
- Expected on `tap insights`: `session.flashback` with `targetLap: 3` and `rewoundS` ≈ 5.
- Expected on `tap laps`: no entry for a lap that was undone, and lap numbers never decrease.
- Afterwards, `pnpm pitwall replay <~/.local/share/pitwall/recordings/<session file>>`. A `tap laps` on the replay must equal the live capture after dropping the `hello` line: `diff <(tail -n +2 live.jsonl) <(tail -n +2 replay.jsonl)`.

## 4. Keep the recording

- Copy the session file into `recordings/` and request `FIXTURES.practiceFlashback` and a `fixtures/index.json` entry from the supervisor.
- Find the FLBK `sessionTime` via `tap events`, then cut a ±5 s segment with `pnpm pwrec-cut … --from <t-5> --to <t+5>` into `fixtures/segments/practice-flashback.pwrec.gz`. This is spec 12, recording 3.

## Results

Record the date, the counts per topic and the flashback outcome here after the run.
