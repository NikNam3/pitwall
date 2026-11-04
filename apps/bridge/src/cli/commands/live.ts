import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { loadFeatureConfig } from '../../feature-config.ts';
import { FEATURES } from '../../features/index.generated.ts';
import { UdpSource } from '../../input/udp-source.ts';
import { dataDir, type DataDir } from '../../storage/data-dir.ts';
import { openDatabase, SchemaVersionError, type Db } from '../../storage/db.ts';
import { rulesVersion, SOURCE_ROOT } from '../../storage/rules-version.ts';
import { EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { rebuildDatabase, StaleSessions } from '../rebuild-database.ts';
import { serve } from '../serve.ts';
import { assertUdpPortFree, udpPortError } from '../udp-port.ts';

/**
 * The database, rebuilt from every recording first when it has an outdated schema (it is a cache of the recordings).
 * Undefined when the rebuild was interrupted.
 */
async function currentDatabase(dirs: DataDir, io: CliIo, version: string): Promise<Db | undefined> {
  try {
    return openDatabase(dirs.dbPath);
  } catch (error) {
    if (!(error instanceof SchemaVersionError)) throw error;
    io.err(`pitwall: database schema ${error.found} is outdated; rebuilding it from the recordings`);
    return (await rebuildDatabase(dirs, io, version))?.db;
  }
}

/** `pitwall live`: records the game's UDP telemetry and serves it; `--dev` also publishes calculator timings. */
export async function run(_positionals: string[], values: { dev?: boolean | undefined }, io: CliIo): Promise<number> {
  const { udpPort, udpHost, wsPort } = loadConfig(io.env);
  const dirs = dataDir(io.env);
  // Fixed for the run (a runtime change from the UI comes later); a config error stops the start before anything listens.
  const config = loadFeatureConfig(dirs.root, FEATURES);
  await assertUdpPortFree(udpPort, udpHost);
  // Computed once, when the database opens (C61).
  const version = await rulesVersion(SOURCE_ROOT);
  const db = await currentDatabase(dirs, io, version);
  if (db === undefined) return EXIT_INTERRUPTED;
  const stale = new StaleSessions(db, config, io, version);
  // Before input opens; any other stale session is rebuilt when first read.
  if (!(await stale.rebuildNewestWeekend())) {
    db.close();
    return EXIT_INTERRUPTED;
  }
  const source = new UdpSource({ feedId: feedId(`udp-${udpPort}`), port: udpPort, host: udpHost });
  return serve({
    source,
    feed: { kind: 'udp', label: `UDP port ${udpPort}` },
    wsPort,
    dumpsDir: dirs.dumps,
    uiDir: dirs.ui,
    config,
    storage: { db, recordingsDir: dirs.recordings, rulesVersion: version, rebuild: stale.rebuild },
    staleCheck: { clock: () => performance.now(), everyMs: 500 },
    // The port was free a moment ago; this catches the race and any other bind failure.
    bound: () => source.listening.catch((error: unknown) => Promise.reject(udpPortError(udpPort, error))),
    ...(values.dev && { dev: true }),
    io,
  });
}
