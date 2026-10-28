import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { loadFeatureConfig } from '../../feature-config.ts';
import { FEATURES } from '../../features/index.generated.ts';
import { UdpSource } from '../../input/udp-source.ts';
import { dataDir, type DataDir } from '../../storage/data-dir.ts';
import { openDatabase, SchemaVersionError, type Db } from '../../storage/db.ts';
import { EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { rebuildDatabase } from '../rebuild-database.ts';
import { serve } from '../serve.ts';
import { assertUdpPortFree, udpPortError } from '../udp-port.ts';

/**
 * The database, rebuilt from every recording first when it has an outdated schema (it is a cache of the recordings).
 * Undefined when the rebuild was interrupted.
 */
async function currentDatabase(dirs: DataDir, io: CliIo): Promise<Db | undefined> {
  try {
    return openDatabase(dirs.dbPath);
  } catch (error) {
    if (!(error instanceof SchemaVersionError)) throw error;
    io.err(`pitwall: database schema ${error.found} is outdated; rebuilding it from the recordings`);
    return (await rebuildDatabase(dirs, io))?.db;
  }
}

/** `pitwall live`: records the game's UDP telemetry and serves it. */
export async function run(_positionals: string[], _values: object, io: CliIo): Promise<number> {
  const { udpPort, wsPort } = loadConfig(io.env);
  const dirs = dataDir(io.env);
  // Fixed for the run (a runtime change from the UI comes later); a config error stops the start before anything listens.
  const config = loadFeatureConfig(dirs.root, FEATURES);
  await assertUdpPortFree(udpPort);
  const db = await currentDatabase(dirs, io);
  if (db === undefined) return EXIT_INTERRUPTED;
  const source = new UdpSource({ feedId: feedId(`udp-${udpPort}`), port: udpPort });
  return serve({
    source,
    feed: { kind: 'udp', label: `UDP port ${udpPort}` },
    wsPort,
    dumpsDir: dirs.dumps,
    config,
    storage: { db, recordingsDir: dirs.recordings },
    staleCheck: { clock: () => performance.now(), everyMs: 500 },
    // The port was free a moment ago; this catches the race and any other bind failure.
    bound: () => source.listening.catch((error: unknown) => Promise.reject(udpPortError(udpPort, error))),
    io,
  });
}
