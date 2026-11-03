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
                            ones (exit code 1 on those)

The WebSocket server listens on 127.0.0.1 only. Ports, the UDP bind address and the data directory
come from PITWALL_WS_PORT, PITWALL_UDP_PORT, PITWALL_UDP_HOST (default 0.0.0.0) and PITWALL_DATA_DIR.`;

/** The command line was used wrongly (a missing argument); the CLI prints the message and the usage. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}
