import { feedId } from '@pitwall/domain';
import { loadConfig, udpPorts } from '../../config.ts';
import { loadFeatureConfig, type FeatureConfig } from '../../feature-config.ts';
import { FEATURES } from '../../features/index.generated.ts';
import { UdpSource } from '../../input/udp-source.ts';
import { dataDir, type DataDir } from '../../storage/data-dir.ts';
import { openDatabase, SchemaVersionError, type Db } from '../../storage/db.ts';
import { rulesVersion, SOURCE_ROOT } from '../../storage/rules-version.ts';
import { EXIT_INTERRUPTED, type CliIo } from '../io.ts';
import { rebuildDatabase, StaleSessions, type RebuildProgress, type RunningSessions } from '../rebuild-database.ts';
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

/** The feeds' running sessions, once `serve` hands them over (`storage.onRunning`); none before. */
type RunningHolder = { running: RunningSessions };

type Storage = { db: Db; stale: StaleSessions; version: string; holder: RunningHolder };

/**
 * The current database (a schema rebuild reporting `onProgress`) and the rebuilds of stale sessions. Nothing stale is
 * rebuilt at start: a stale session is rebuilt when a reader first needs it (C61). Undefined (database closed) when the
 * schema rebuild was interrupted.
 */
async function openStorage(dirs: DataDir, config: FeatureConfig, io: CliIo, onProgress: RebuildProgress): Promise<Storage | undefined> {
  // Computed once, when the database opens (C61).
  const version = await rulesVersion(SOURCE_ROOT);
  const db = await currentDatabase(dirs, io, version, onProgress);
  if (db === undefined) return undefined;
  // The rebuild service reads the running sessions through the holder at every check: `serve` fills it (C24, C59).
  const holder: RunningHolder = { running: () => [] };
  return { db, stale: new StaleSessions(db, config, io, version, { running: () => holder.running() }), version, holder };
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
  // Until `serve` opens its own server, windows see a schema rebuild's progress (C61); `serve` closes it before its
  // server opens, and so does a failed or interrupted rebuild here.
  const startup = await StartupServer.start({ port: wsPort });
  const progress = (done: number, total: number) => startup.progress(done, total);
  const feeds = ports.map((port) => ({ feedId: feedId(`udp-${port}`), port }));
  let opened: Storage | undefined;
  try {
    opened = await openStorage(dirs, config, io, progress);
  } finally {
    if (opened === undefined) await startup.close();
  }
  if (opened === undefined) return EXIT_INTERRUPTED;
  const { db, stale, version, holder } = opened;
  const sources = feeds.map(({ feedId: id, port }) => ({ port, source: new UdpSource({ feedId: id, port, host: udpHost }) }));
  try {
    return await serve({
      sources: sources.map(({ port, source }) => ({ source, port, feed: { kind: 'udp', label: `UDP port ${port}` } })),
      startup: { progress, close: () => startup.close() },
      wsPort,
      dumpsDir: dirs.dumps,
      uiDir: dirs.ui,
      config,
      storage: { db, recordingsDir: dirs.recordings, rulesVersion: version, rebuild: stale.rebuild, onRunning: (running) => { holder.running = running; } },
      staleCheck: { clock: () => performance.now(), everyMs: 500 },
      // Each port was free a moment ago; this catches the race and any other bind failure.
      bound: async () => {
        await Promise.all(sources.map(({ port, source }) => source.listening.catch((error: unknown) => Promise.reject(udpPortError(port, error)))));
      },
      ...(values.dev && { dev: true }),
      io,
    });
  } finally {
    // The rebuild service's worker stops with the run.
    await stale.close();
  }
}
