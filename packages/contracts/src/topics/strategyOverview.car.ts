// The field's strategies in one table, for one of our cars (SP4.3d spec §6.4).
import type { StrategyOverview } from '@pitwall/domain';
import { defineTopic, eachCar, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, StrategyOverview>({ owner: 'strategy-overview', mode: 'state', maxHz: 4, momentParams: eachCar });
