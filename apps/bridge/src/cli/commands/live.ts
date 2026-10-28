import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { UdpSource } from '../../input/udp-source.ts';
import { openDatabase } from '../../storage/db.ts';
import { dataDir } from '../../storage/data-dir.ts';
import type { CliIo } from '../io.ts';
import { serve } from '../serve.ts';
import { assertUdpPortFree, udpPortError } from '../udp-port.ts';

/** `pitwall live`: records the game's UDP telemetry and serves it. */
export async function run(_positionals: string[], _values: object, io: CliIo): Promise<number> {
  const { udpPort, wsPort } = loadConfig(io.env);
  await assertUdpPortFree(udpPort);
  const dirs = dataDir(io.env);
  const db = openDatabase(dirs.dbPath);
  const source = new UdpSource({ feedId: feedId(`udp-${udpPort}`), port: udpPort });
  return serve({
    source,
    feed: { kind: 'udp', label: `UDP port ${udpPort}` },
    wsPort,
    dumpsDir: dirs.dumps,
    storage: { db, recordingsDir: dirs.recordings },
    staleCheck: { clock: () => performance.now(), everyMs: 500 },
    // The port was free a moment ago; this catches the race and any other bind failure.
    bound: () => source.listening.catch((error: unknown) => Promise.reject(udpPortError(udpPort, error))),
    io,
  });
}
