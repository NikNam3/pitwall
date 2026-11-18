import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { ReplayControl } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { loadFeatureConfig, recordingConfig, type FeatureConfig } from '../../feature-config.ts';
import { FEATURES } from '../../features/index.generated.ts';
import { StartupError } from '../../startup-error.ts';
import { dataDir, type DataDir } from '../../storage/data-dir.ts';
import { openDatabase, SchemaVersionError, type Db } from '../../storage/db.ts';
import { rulesVersion, SOURCE_ROOT } from '../../storage/rules-version.ts';
import { cliLogger, type CliIo } from '../io.ts';
import { StaleSessions, type RunningSessions } from '../rebuild-database.ts';
import { serve } from '../serve.ts';
import { UsageError } from '../usage.ts';

type ReplayFlags = {
  realtime?: boolean | undefined;
  dev?: boolean | undefined;
  paused?: boolean | undefined;
  speed?: string | undefined;
  'at-lap'?: string | undefined;
  'at-time'?: string | undefined;
};

/** The transport flags as controls, in the order they apply: speed and pause first, then the jump. */
function controlsOf(values: ReplayFlags): ReplayControl[] {
  const controls: ReplayControl[] = [];
  if (values.speed !== undefined) {
    const factor = Number(values.speed);
    if (!Number.isFinite(factor) || factor <= 0) throw new UsageError(`--speed needs a number above 0, got "${values.speed}"`);
    controls.push({ kind: 'speed', factor });
  }
  if (values.paused) controls.push({ kind: 'pause' });
  const { 'at-lap': atLap, 'at-time': atTime } = values;
  if (atLap !== undefined && atTime !== undefined) throw new UsageError('use either --at-lap or --at-time, not both');
  if (atLap !== undefined) {
    const lap = Number(atLap);
    if (!Number.isInteger(lap) || lap < 1) throw new UsageError(`--at-lap needs a whole lap number from 1, got "${atLap}"`);
    controls.push({ kind: 'jumpToLap', lap });
  }
  if (atTime !== undefined) {
    const sessionTimeMs = Number(atTime);
    if (atTime.trim() === '' || !Number.isInteger(sessionTimeMs) || sessionTimeMs < 0) {
      throw new UsageError(`--at-time needs a session time in whole ms from 0, got "${atTime}"`);
    }
    controls.push({ kind: 'jumpToTime', sessionTimeMs });
  }
  return controls;
}

/** `pitwall replay <file> [--realtime] [--paused] [--speed n] [--at-lap n | --at-time ms] [--dev]`: serves a recording as if it were live with its own config (`<file>.config.json`) if it has one; its basis is read from the data dir's database (R21), the replayed session is not stored. */
export async function run(positionals: string[], values: ReplayFlags, io: CliIo): Promise<number> {
  const [file] = positionals;
  if (file === undefined) throw new UsageError('replay needs a recording file');
  const controls = controlsOf(values);
  if (!existsSync(file)) throw new StartupError(`recording ${file} not found`);
  const { wsPort } = loadConfig(io.env);
  const dirs = dataDir(io.env);
  // The config the recording ran with if it has one, else the current one; fixed for the run (a runtime change from the UI comes later).
  const config = recordingConfig(file, FEATURES, loadFeatureConfig(dirs.root, FEATURES), cliLogger(io, 'warn'));
  const storage = await readStorage(dirs, config, io);
  try {
    return await serve({
      replay: { feedId: feedId('replay'), path: file, controls, unpaced: !values.realtime && values.speed === undefined },
      feed: { kind: 'replay', label: basename(file) },
      wsPort,
      dumpsDir: dirs.dumps,
      uiDir: dirs.ui,
      config,
      ...(storage && {
        storage: {
          db: storage.db,
          recordingsDir: dirs.recordings,
          rulesVersion: storage.version,
          mode: 'read' as const,
          rebuild: storage.stale.rebuild,
          rebuildService: storage.stale.rebuildService,
          onRunning: (running: RunningSessions) => {
            storage.holder.running = running;
          },
        },
      }),
      onDone: () => io.err('pitwall: replay finished'),
      ...(values.dev && { dev: true }),
      io,
    });
  } finally {
    // The rebuild service's worker stops with the run.
    await storage?.stale.close();
  }
}

/** The feeds' running sessions, once `serve` hands them over (`storage.onRunning`); none before. */
type RunningHolder = { running: RunningSessions };

/**
 * The data dir's database, read only for the replay's basis (R21; C38, C62): the stored sessions its basis names, a stale
 * one rebuilt first through the one rebuild service (C61). Undefined without a database (none is made) or with one of
 * an outdated schema (a replay does not rebuild the database): the replay then runs with its basis empty.
 */
async function readStorage(dirs: DataDir, config: FeatureConfig, io: CliIo): Promise<{ db: Db; stale: StaleSessions; version: string; holder: RunningHolder } | undefined> {
  if (!existsSync(dirs.dbPath)) return undefined;
  let db: Db;
  try {
    db = openDatabase(dirs.dbPath);
  } catch (error) {
    if (!(error instanceof SchemaVersionError)) throw error;
    io.err(`pitwall: database schema ${error.found} is outdated; replaying without the stored basis`);
    return undefined;
  }
  // Computed as `import` computes it (C61).
  const version = await rulesVersion(SOURCE_ROOT);
  const holder: RunningHolder = { running: () => [] };
  return { db, stale: new StaleSessions(db, config, io, version, { running: () => holder.running() }), version, holder };
}
