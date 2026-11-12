/** Printed after `usage:` errors and by `--help`. The first line is pinned by the tests. */
export const USAGE = `usage: pitwall <live|replay|tap|reprocess|import> …

  live [--dev]              listen for the game's UDP telemetry, record it and serve the topics
  replay <file> [--realtime] [--paused] [--speed n] [--at-lap n | --at-time ms] [--dev]
                            serve a .pwrec.gz recording; --realtime keeps the recorded pace
                            --paused starts paused, --speed sets the playback factor (1 = recorded pace),
                            --at-lap / --at-time jump there before the server reports it is listening
                            --dev publishes per-calculator compute times (dev.calcStats) and the catalogue (dev.catalogue)
  dev --replay <file> [--at-lap n | --at-time ms]
                            replay and restart the bridge at the same moment when its source changes
  tap <topic> [--carId n] [--url ws://…] [--feed id]
                            print the messages of one topic as JSON lines
  reprocess [--weekend id]  rebuild the database from the recordings (one weekend, or all)
  import <file>             copy a recording into the data directory and process it
  where <unit> | --topic <name> [--catalogue <file>]
                            print the folders, files and links of a unit, or who binds and reads a topic
                            (reads catalogue.generated.json, written by pnpm gen)
  scan-situations [dir]     run steps 0-2 over every recording of dir (default PITWALL_FIXTURES_DIR) and print each
                            sub-machine's transitions with their counts, the declared ones never seen and the undeclared
                            ones (exit code 1 on those); with --warnings: each penalty of the player car with the
                            warnings count and corner-cutting count of its warned span
  score <file> [--json <out.json>] [--compare <old.json>]
                            reprocess a recording (its sidecars included) and print the forecast-score tables: each
                            experiment and each forecast horizon, AI and human; --json writes the report without its
                            cases, --compare prints each number beside the old one with its change; stores nothing
  drivers                   list the persons with their profile entries, then the human seats without a link
  drivers add <person> --name "<display name>"
                            add a person (kebab-case id)
  drivers link <team> <raceNumber> <person>
                            link a seat (team name or id, race number) to a person, for every session's human frames
  drivers unlink <team> <raceNumber>
                            remove the seat's link
  drivers exclude <person> <session>
                            leave one session out of the person's profile
  drivers override <person> <key> <value>
                            set one entry of the person's profile by hand
  drivers show <person>     each entry with laps, sessions, age and every linked session's own value
                            <session> is <sessionUid>/<weekendId>/<feedCar>; with a running bridge an edit goes to
                            it and the list reads its topics; show needs the bridge stopped

The WebSocket server listens on 127.0.0.1 only. Ports, the UDP bind address and the data directory
come from PITWALL_WS_PORT, PITWALL_UDP_PORT, PITWALL_UDP_HOST (default 0.0.0.0) and PITWALL_DATA_DIR.`;

/** The command line was used wrongly (a missing argument); the CLI prints the message and the usage. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}
