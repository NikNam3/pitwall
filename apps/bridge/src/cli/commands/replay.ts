import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { ReplayControl } from '@pitwall/contracts';
import { feedId } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import { loadFeatureConfig, recordingConfig } from '../../feature-config.ts';
import { FEATURES } from '../../features/index.generated.ts';
import { StartupError } from '../../startup-error.ts';
import { dataDir } from '../../storage/data-dir.ts';
import { cliLogger, type CliIo } from '../io.ts';
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

/** `pitwall replay <file> [--realtime] [--paused] [--speed n] [--at-lap n | --at-time ms] [--dev]`: serves a recording as if it were live with its own config (`<file>.config.json`) if it has one; nothing is stored. */
export async function run(positionals: string[], values: ReplayFlags, io: CliIo): Promise<number> {
  const [file] = positionals;
  if (file === undefined) throw new UsageError('replay needs a recording file');
  const controls = controlsOf(values);
  if (!existsSync(file)) throw new StartupError(`recording ${file} not found`);
  const { wsPort } = loadConfig(io.env);
  const dirs = dataDir(io.env);
  // The config the recording ran with if it has one, else the current one; fixed for the run (a runtime change from the UI comes later).
  const config = recordingConfig(file, FEATURES, loadFeatureConfig(dirs.root, FEATURES), cliLogger(io, 'warn'));
  return serve({
    replay: { feedId: feedId('replay'), path: file, controls, unpaced: !values.realtime && values.speed === undefined },
    feed: { kind: 'replay', label: basename(file) },
    wsPort,
    dumpsDir: dirs.dumps,
    uiDir: dirs.ui,
    config,
    onDone: () => io.err('pitwall: replay finished'),
    ...(values.dev && { dev: true }),
    io,
  });
}
