import { describe, expect, it } from 'vitest';
import { feedId, toSessionTime, type Insight } from '@pitwall/domain';
import { formatInsight } from './insight-text.ts';

const insight = (kind: string, params: Insight['params']): Insight => ({
  key: kind, severity: 'critical', category: 'tyres', feedId: feedId('t'), kind, params, raisedAt: toSessionTime(0),
});

describe('formatInsight alarm kinds', () => {
  it.each([
    ['bandOutLap', { channel: 'brakesC.FR', lo: 300, hi: 900 }, 'FR brake out of band a full lap'],
    ['bandOut', { channel: 'tyre.carcassC.FR', state: 'above', value: 109.4, lo: 85, hi: 105 }, 'FR carcass above band 109 °C'],
    ['bandOut', { channel: 'engineC', state: 'below', value: 80, lo: 90, hi: 120 }, 'engine below band 80 °C'],
    ['wearLimitNear', { corner: 'FL', lapsToLimit: 1.84, wearPct: 70, limitPct: 80 }, 'FL wear limit in 1.8 laps'],
    ['fuelShort', { marginLaps: -0.7 }, 'fuel short −0.7 laps'],
    ['damageJump', { lap: 14, parts: 'frontLeftWingPct', deltaPct: 12 }, 'damage: FL wing +12 %'],
    ['damageJump', { lap: 14, parts: 'floorPct,rearWingPct,odd', deltaPct: 20 }, 'damage: floor, rear wing, odd +20 %'],
    ['warningLast', { warnings: 2, before: 3 }, 'one warning left before a penalty 2/3'],
    ['penaltyNew', { timeMs: 5000 }, 'penalty +5 s'],
    ['penaltyNew', {}, 'penalty'],
  ] as const)('%s', (kind, params, text) => expect(formatInsight(insight(kind, params))).toBe(text));

  it('keeps the fallback for other kinds', () => expect(formatInsight(insight('x', { a: 1 }))).toBe('x: a 1'));
});
