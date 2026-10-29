// One of our cars against the car ahead and behind (spec 6.3).
import type { BattleCard } from '@pitwall/domain';
import { defineTopic, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, BattleCard>({ owner: 'battle', mode: 'state', maxHz: 2 });
