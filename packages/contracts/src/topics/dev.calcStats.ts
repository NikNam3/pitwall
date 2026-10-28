import type { SessionTime } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** One calculator's compute time (dev mode only): the last run, the mean over the last 100 runs and the run count. */
export type CalcStat = { id: string; lastMs: number; meanMs: number; runs: number; lastSessionTime: SessionTime };

export type CalcStats = CalcStat[];

export default defineTopic<NoParams, CalcStats>({ owner: 'core', scope: 'global', mode: 'state', maxHz: 1 });
