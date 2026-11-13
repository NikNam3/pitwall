// `sc-call` (SP4.3b spec §9.3; from SP4.2 spec 3.3): an analysis with a job (C51): per our car, per condition SC and
// VSC, boxing under it now against staying out, scored on common scenarios to the flag. Topic `scCall.car`.
import type { Job } from '@pitwall/engine/readers';
import { REJOIN } from '../rejoin/index.ts';
import { STRATEGY_INPUT_READS } from '../shared/strategy-input/index.ts';
import { STRATEGY_TRIGGER } from '../strategy/index.ts';
import type { ScCallOutput } from './job.ts';
import { prepareScCall, type ScCallInput } from './prepare.ts';

export type { ScCall, ScCallRow } from '@pitwall/domain';
export { SC_CALL_BEHAVIOUR, type ScCallEffect } from './behaviour.ts';
export * from './config.ts';
export type { ScCallOutput } from './job.ts';
export { prepareScCall, type ScCallInput } from './prepare.ts';

/** The analysis id (its job's id). */
export const SC_CALL = 'sc-call';

/** The job (C51): `strategy`'s trigger and input reads, plus `rejoin`; on demand of `scCall.car` (C49). */
export const SC_CALL_JOB: Job<ScCallInput, ScCallOutput> = {
  kind: 'job',
  id: SC_CALL,
  reads: [...STRATEGY_INPUT_READS, { calculator: REJOIN }],
  trigger: { onChange: [...STRATEGY_TRIGGER.onChange] },
  prepare: (view) => prepareScCall(view),
  module: new URL('./job.ts', import.meta.url),
};
