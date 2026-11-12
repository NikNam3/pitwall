// The strategy table's data (SP4.3b spec §8.1): per our car the ranked policies and the run's metadata; a job's result (C51).
import type { StrategyOutput } from '@pitwall/domain';
import type { Computed } from '../computed.ts';
import { defineTopic, type NoParams } from '../topic-def.ts';

export default defineTopic<NoParams, Computed<StrategyOutput>>({ owner: 'strategy', mode: 'state', maxHz: 1 });
