// `sc-call` (SP4.3d spec §6.3; from SP4.3b spec §9.3): an analysis with a job (C51): per our car, per condition SC,
// VSC and GREEN (the out condition alone while one is out), staying out against boxing now onto each compound, scored
// on common scenarios to the flag. Topic `scCall.car`.
import type { Job } from '@pitwall/engine/readers';
import { REJOIN } from '../rejoin/index.ts';
import { STRATEGY_INPUT_READS } from '../shared/strategy-input/index.ts';
import { STRATEGY_TRIGGER } from '../strategy/index.ts';
import { mergeScCall, splitScCall, type ScCallOutput } from './job.ts';
import { prepareScCall, type ScCallInput } from './prepare.ts';

export type { ScCallAnswer, ScCallBlock, ScCallBlocks, ScCallOption } from '@pitwall/domain';
export { SC_CALL_BEHAVIOUR, type ScCallEffect } from './behaviour.ts';
export * from './config.ts';
export type { ScCallOutput } from './job.ts';
export { prepareScCall, type ScCallInput } from './prepare.ts';

/** The analysis id (its job's id). */
export const SC_CALL = 'sc-call';

/** The job (C51): `strategy`'s trigger and input reads, plus `rejoin`; on demand of `scCall.car` (C49); one part per our car. */
export const SC_CALL_JOB: Job<ScCallInput, ScCallOutput> = {
  kind: 'job',
  id: SC_CALL,
  reads: [...STRATEGY_INPUT_READS, { calculator: REJOIN }],
  trigger: { onChange: [...STRATEGY_TRIGGER.onChange] },
  prepare: (view) => prepareScCall(view),
  module: new URL('./job.ts', import.meta.url),
  parts: { split: splitScCall, merge: mergeScCall },
};
