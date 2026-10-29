// Damage per part and corner, faults and damage jumps (spec 5.5).
import type { DamageState } from '@pitwall/domain';
import { defineTopic, type CarParams } from '../topic-def.ts';

export default defineTopic<CarParams, DamageState>({ owner: 'damage', mode: 'state', maxHz: 4 });
