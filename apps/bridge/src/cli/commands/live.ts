import { feedId, type FeedId } from '@pitwall/domain';
import { loadConfig, udpPorts } from '../../config.ts';
import { loadFeatureConfig, type FeatureConfig } from '../../feature-config.ts';
import { FEATURES } from '../../features/index.generated.ts';
import { UdpSource } from '../../input/udp-source.ts';
import { dataDir, type DataDir } from '../../storage/data-dir.ts';
import { openDatabase, SchemaVersionError, type Db, type StoredSessionRow } from '../../storage/db.ts';
import { rulesVersion, SOURCE_ROOT } from '../../storage/rules-version.ts';
import { cliLogger, EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { endedQualifyingsOf, type RestoreFeed } from '../startup-restore.ts';
import { rebuildDatabase, StaleSessions, type RebuildProgress } from '../rebuild-database.ts';
import { serve } from '../serve.ts';
import { StartupServer } from '../startup-server.ts';
import { assertUdpPortFree, udpPortError } from '../udp-port.ts';

/**
 * The database, rebuilt from every recording first when it has an outdated schema (it is a cache of the recordings).
 * Undefined when the rebuild was interrupted.
 */
async function currentDatabase(dirs: DataDir, io: CliIo, version: string, onProgress: RebuildProgress): Promise<Db | undefined> {
  try {
    return openDatabase(dirs.dbPath);
  } catch (error) {
    if (!(error instanceof SchemaVersionError)) throw error;
    io.err(`pitwall: database schema ${error.found} is outdated; rebuilding it from the recordings`);
    return (await rebuildDatabase(dirs, io, version, onProgress))?.db;
  }
}

type Storage = { db: Db; stale: StaleSessions; version: string; restore: ReadonlyMap<FeedId, StoredSessionRow> };

/**
 * The current database with the newest weekend's stale sessions rebuilt, both rebuilds reporting `onProgress`, and each
 * feed's session to restore at startup (`endedQualifyingsOf`), picked before the rebuild and left out of it: `serve`'s
 * restore replays it once (C61). Undefined (database closed) when a rebuild was interrupted.
 */
async function openStorage(dirs: DataDir, config: FeatureConfig, io: CliIo, feeds: readonly RestoreFeed[], onProgress: RebuildProgress): Promise<Storage | undefined> {
  // Computed once, when the database opens (C61).
  const version = await rulesVersion(SOURCE_ROOT);
  const db = await currentDatabase(dirs, io, version, onProgress);
  if (db === undefined) return undefined;
  try {
    const restore = await endedQualifyingsOf(db, feeds, cliLogger(io, 'warn'));
    const stale = new StaleSessions(db, config, io, version);
    // Before input opens; any other stale session is rebuilt when first read.
    if (!(await stale.rebuildNewestWeekend(onProgress, [...restore.values()]))) {
      db.close();
      return undefined;
    }
    return { db, stale, version, restore };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** `pitwall live`: records the game's UDP telemetry and serves it; `--dev` also publishes calculator timings. */
export async function run(_positionals: string[], values: { dev?: boolean | undefined }, io: CliIo): Promise<number> {
  const { udpHost, wsPort } = loadConfig(io.env);
  // One feed per port (C1a, C58).
  const ports = udpPorts(io.env);
  const dirs = dataDir(io.env);
  // Fixed for the run (a runtime change from the UI comes later); a config error stops the start before anything listens.
  const config = loadFeatureConfig(dirs.root, FEATURES);
  for (const port of ports) await assertUdpPortFree(port, udpHost);
  // Until `serve` opens its own server, windows see the startup rebuild's and restore's progress (C61); `serve` closes it
  // before its server opens, and so does a failed or interrupted rebuild here.
  const startup = await StartupServer.start({ port: wsPort });
  const progress = (done: number, total: number) => startup.progress(done, total);
  const feeds = ports.map((port) => ({ feedId: feedId(`udp-${port}`), port }));
  let opened: Storage | undefined;
  try {
    opened = await openStorage(dirs, config, io, feeds, progress);
  } finally {
    if (opened === undefined) await startup.close();
  }
  if (opened === undefined) return EXIT_INTERRUPTED;
  const { db, stale, version, restore } = opened;
  const sources = feeds.map(({ feedId: id, port }) => ({ port, source: new UdpSource({ feedId: id, port, host: udpHost }) }));
  return serve({
    sources: sources.map(({ port, source }) => ({ source, port, feed: { kind: 'udp', label: `UDP port ${port}` } })),
    startup: { progress, close: () => startup.close() },
    wsPort,
    dumpsDir: dirs.dumps,
    uiDir: dirs.ui,
    config,
    storage: { db, recordingsDir: dirs.recordings, rulesVersion: version, rebuild: stale.rebuild, restore },
    staleCheck: { clock: () => performance.now(), everyMs: 500 },
    // Each port was free a moment ago; this catches the race and any other bind failure.
    bound: async () => {
      await Promise.all(sources.map(({ port, source }) => source.listening.catch((error: unknown) => Promise.reject(udpPortError(port, error)))));
    },
    ...(values.dev && { dev: true }),
    io,
  });
}
