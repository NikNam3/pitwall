/** Printed after `usage:` errors and by `--help`. The first line is pinned by the tests. */
export const USAGE = `usage: pitwall <live|replay|tap|reprocess|import> …

  live [--dev]              listen for the game's UDP telemetry, record it and serve the topics
  replay <file> [--realtime] [--dev]
                            serve a .pwrec.gz recording; --realtime keeps the recorded pace
                            --dev publishes per-calculator compute times (dev.calcStats)
  tap <topic> [--carId n] [--url ws://…] [--feed id]
                            print the messages of one topic as JSON lines
  reprocess [--weekend id]  rebuild the database from the recordings (one weekend, or all)
  import <file>             copy a recording into the data directory and process it

The WebSocket server listens on 127.0.0.1 only. Ports and the data directory come from
PITWALL_WS_PORT, PITWALL_UDP_PORT and PITWALL_DATA_DIR.`;

/** The command line was used wrongly (a missing argument); the CLI prints the message and the usage. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}
