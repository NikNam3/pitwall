import { describe, expect, it } from 'vitest';
import type { CarOverview } from '@pitwall/contracts';
import { carId, feedId, toSessionTime, type Insight } from '@pitwall/domain';
import { separator } from '../text.ts';
import { formatInsight, insightLabel } from './insight-text.ts';

const insight = (kind: string, params: Insight['params']): Insight => ({
  key: kind, severity: 'critical', category: 'tyres', feedId: feedId('t'), kind, params, raisedAt: toSessionTime(0),
});

describe('formatInsight alarm kinds', () => {
  it.each([
    ['bandOutLap', { channel: 'brakesC.FR', lo: 300, hi: 900 }, 'FR brake out of band a full lap'],
    ['bandOutLap', { channel: 'brakesC.fr', lo: 300, hi: 900 }, 'FR brake out of band a full lap'],
    ['bandOut', { channel: 'tyre.carcassC.FR', state: 'above', value: 109.4, lo: 85, hi: 105 }, 'FR carcass above band 109 °C'],
    ['bandOut', { channel: 'tyre.carcassC.rl', state: 'above', value: 109.4, lo: 85, hi: 105 }, 'RL carcass above band 109 °C'],
    ['bandOut', { channel: 'tyre.pressurePsi.fr', state: 'above', value: 31.44, lo: 22, hi: 31 }, 'FR pressure above band 31.4 psi'],
    ['bandOut', { channel: 'tyre.pressurePsi.fl', state: 'below', value: -1.25, lo: 22, hi: 31 }, 'FL pressure below band \u22121.3 psi'],
    ['bandOut', { channel: 'engineC', state: 'below', value: 80, lo: 90, hi: 120 }, 'engine below band 80 °C'],
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

describe('insightLabel: the car code, then the text', () => {
  const overview = (id: number, name: string, raceNumber = id): CarOverview =>
    ({ id: carId(id), identity: { name, raceNumber }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
  const CARS = [overview(0, 'Lando Norris', 4), overview(5, 'Oscar Piastri', 81), overview(7, '', 12)];
  const wing = (over: Partial<Insight> = {}): Insight => ({ ...insight('damageJump', { lap: 14, parts: 'frontLeftWingPct', deltaPct: 40 }), ...over });

  it('prefixes the code of the insight’s car with the separator', () => {
    expect(insightLabel(wing({ carId: carId(0) }), CARS)).toBe('NOR · damage: FL wing +40 %');
    expect(insightLabel(wing({ carId: carId(5) }), CARS)).toBe('PIA · damage: FL wing +40 %');
  });

  it('a car without a name is its race number, as carCode gives it', () => {
    expect(insightLabel(wing({ carId: carId(7) }), CARS)).toBe('#12 · damage: FL wing +40 %');
  });

  it('is the text alone without a carId', () => {
    expect(insightLabel(wing(), CARS)).toBe('damage: FL wing +40 %');
  });

  it('is the text alone when the car is not in cars.overview', () => {
    expect(insightLabel(wing({ carId: carId(9) }), CARS)).toBe('damage: FL wing +40 %');
    expect(insightLabel(wing({ carId: carId(0) }), [])).toBe('damage: FL wing +40 %');
  });

  it('is the text alone while cars.overview has not arrived', () => {
    expect(insightLabel(wing({ carId: carId(0) }), undefined)).toBe('damage: FL wing +40 %');
  });

  it('the text is formatInsight’s', () => {
    const band = insight('bandOut', { channel: 'tyre.carcassC.rl', state: 'above', value: 109.4, lo: 85, hi: 105 });
    expect(insightLabel({ ...band, carId: carId(0) }, CARS)).toBe(`NOR${separator}${formatInsight(band)}`);
  });
});
