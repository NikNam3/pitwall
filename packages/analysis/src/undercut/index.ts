// `undercut` (SP4.3b spec §9.1): an analysis with a job (C51): per our car and per rival in range, we box now and it N
// laps later (for a car behind, the mirror), scored on common scenarios until both have stopped plus one lap. Topic
// `undercut.car`.
import type { Job } from '@pitwall/engine/readers';
import { REJOIN } from '../rejoin/index.ts';
import { STRATEGY_INPUT_READS } from '../shared/strategy-input/index.ts';
import { STRATEGY_TRIGGER } from '../strategy/index.ts';
import type { UndercutOutput } from './job.ts';
import { prepareUndercut, type UndercutInput } from './prepare.ts';

export { UNDERCUT_BEHAVIOUR, type UndercutEffect } from './behaviour.ts';
export * from './config.ts';
export type { UndercutOutput } from './job.ts';
export { prepareUndercut, rivalsOf, type UndercutCarInput, type UndercutInput, type UndercutRivalInput } from './prepare.ts';

/** The analysis id (its job's id). */
export const UNDERCUT = 'undercut';

/** The job (C51): `strategy`'s trigger and input reads, plus `rejoin`; on demand of `undercut.car` (C49). */
export const UNDERCUT_JOB: Job<UndercutInput, UndercutOutput> = {
  kind: 'job',
  id: UNDERCUT,
  reads: [...STRATEGY_INPUT_READS, { calculator: REJOIN }],
  trigger: { onChange: [...STRATEGY_TRIGGER.onChange] },
  prepare: (view) => prepareUndercut(view),
  module: new URL('./job.ts', import.meta.url),
};
