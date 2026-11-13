// `pit-sweep` (SP4.3b spec §9.2): an analysis with a job (C51): per our car, per compound with a new set and per stop
// lap from now, "box at L onto the compound, then the DP's best continuation", scored on common scenarios to the flag.
// Topic `pitSweep.car`, whose select picks the panel's compound.
import type { Job } from '@pitwall/engine/readers';
import { PIT_WINDOW } from '../pit-window/index.ts';
import { REJOIN } from '../rejoin/index.ts';
import { STRATEGY_JOB, STRATEGY_TRIGGER } from '../strategy/index.ts';
import { mergePitSweep, splitPitSweep, type PitSweepOutput } from './job.ts';
import { preparePitSweep, type PitSweepInput } from './prepare.ts';

export { PIT_SWEEP_BEHAVIOUR, type PitSweepEffect } from './behaviour.ts';
export * from './config.ts';
export type { PitSweepOutput } from './job.ts';
export type { PitSweepInput } from './prepare.ts';

/** The analysis id (its job's id). */
export const PIT_SWEEP = 'pit-sweep';

/** The job (C51): `strategy`'s trigger and input reads, plus `pit-window` and `rejoin`; on demand of `pitSweep.car` (C49). */
export const PIT_SWEEP_JOB: Job<PitSweepInput, PitSweepOutput> = {
  kind: 'job',
  id: PIT_SWEEP,
  reads: [...STRATEGY_JOB.reads, { calculator: PIT_WINDOW }, { calculator: REJOIN }],
  trigger: { onChange: [...STRATEGY_TRIGGER.onChange] },
  prepare: (view) => preparePitSweep(view),
  module: new URL('./job.ts', import.meta.url),
  parts: { split: splitPitSweep, merge: mergePitSweep },
};
