import { describe, expect, it } from 'vitest';
import { feedId, toSessionTime, type Insight } from '@pitwall/domain';
import { formatInsight } from './insight-text.ts';

const insight = (kind: string, params: Insight['params']): Insight => ({
  key: kind, severity: 'critical', category: 'tyres', feedId: feedId('t'), kind, params, raisedAt: toSessionTime(0),
});

describe('formatInsight alarm kinds', () => {
  it.each([
    ['bandOutLap', { channel: 'brakesC.FR', lo: 300, hi: 900 }, 'FR brake out of band a full lap'],
    ['bandOutLap', { channel: 'brakesC.fr', lo: 300, hi: 900 }, 'FR brake out of band a full lap'],
    ['bandOut', { channel: 'tyre.carcassC.FR', state: 'above', value: 109.4, lo: 85, hi: 105 }, 'FR carcass above band 109°'],
    ['bandOut', { channel: 'tyre.carcassC.rl', state: 'above', value: 109.4, lo: 85, hi: 105 }, 'RL carcass above band 109°'],
    ['bandOut', { channel: 'tyre.pressurePsi.fr', state: 'above', value: 31.44, lo: 22, hi: 31 }, 'FR pressure above band 31.4 psi'],
    ['bandOut', { channel: 'tyre.pressurePsi.fl', state: 'below', value: -1.25, lo: 22, hi: 31 }, 'FL pressure below band \u22121.3 psi'],
    ['bandOut', { channel: 'engineC', state: 'below', value: 80, lo: 90, hi: 120 }, 'engine below band 80°'],
    ['wearLimitNear', { corner: 'FL', lapsToLimit: 1.84, wearPct: 70, limitPct: 80 }, 'FL wear limit in 1.8 laps'],
    ['wearLimitNear', { corner: 'rr', lapsToLimit: 1.84, wearPct: 70, limitPct: 80 }, 'RR wear limit in 1.8 laps'],
    ['fuelShort', { marginLaps: -0.7 }, 'fuel short \u22120.7 laps'],
    ['fuelShort', { marginLaps: -0.04 }, 'fuel short +0.0 laps'],
    ['damageJump', { lap: 14, parts: 'frontLeftWingPct', deltaPct: 12 }, 'damage: FL wing +12 %'],
    ['damageJump', { lap: 14, parts: 'floorPct,rearWingPct,odd', deltaPct: 20 }, 'damage: floor, rear wing, odd +20 %'],
    ['damageJump', { lap: 14, parts: 'floorPct', deltaPct: -3 }, 'damage: floor \u22123 %'],
    ['warningLast', { warnings: 2, before: 3 }, 'one warning left before a penalty 2/3'],
    ['penaltyNew', { timeMs: 5000 }, 'penalty 5s'],
    ['penaltyNew', {}, 'penalty'],
  ] as const)('%s %o', (kind, params, text) => expect(formatInsight(insight(kind, params))).toBe(text));

  it('formats every number through the kit formatters, so a value never prints an ASCII hyphen', () => {
    for (const [kind, params] of [
      ['bandOut', { channel: 'tyre.surfaceC.fl', state: 'below', value: -3.6 }],
      ['fuelShort', { marginLaps: -2.2 }],
      ['damageJump', { parts: 'floorPct', deltaPct: -9 }],
      ['penaltyNew', { timeMs: -5000 }],
    ] as const) expect(formatInsight(insight(kind, params))).not.toMatch(/-\d/);
  });

  it('keeps the fallback for other kinds', () => expect(formatInsight(insight('x', { a: 1 }))).toBe('x: a 1'));
});
