import { SOURCE_INTERVAL_MS, type CarId } from '@pitwall/domain';
// A cross-package test import: the engine's own builder is the single definition of "every field of a car".
// (Tests may reach other packages' builders; the dependency-cruiser layer rule for apps/ui must allow this file.)
import { createCarState } from '../../../../packages/engine/src/step/initial-state.ts';
import { describe, expect, it } from 'vitest';
import { CAR_FIELD_SOURCE } from '../../src/kit/values/car-sources.ts';

const isKnown = (v: unknown): boolean => typeof v === 'object' && v !== null && 'known' in v && typeof (v as { known: unknown }).known === 'boolean';

/**
 * The field paths of a car, as `CAR_FIELD_SOURCE` must key them:
 *  - dot paths from the CarState root, e.g. `timing.position`, `energy.fuel`;
 *  - a leaf is a number field or a `Known` field (a `Known` is not descended into);
 *  - `Corners` objects are collapsed: the corner key is dropped, the `corners` / `brakes` key stays,
 *    e.g. `tyres.corners.surfaceTempC`, `condition.brakes.tempC`;
 *  - `motion` is one path, `motion`, whatever it holds;
 *  - the top-level `id` and the optional `ownCar` are not car fields;
 *  - strings, booleans and arrays are not enumerated.
 */
function carFieldPaths(car: unknown, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(car as Record<string, unknown>)) {
    if (prefix === '' && (key === 'id' || key === 'ownCar')) continue;
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (key === 'motion' && prefix === '') out.push(path);
    else if (isKnown(value) || typeof value === 'number') out.push(path);
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const inner = value as Record<string, unknown>;
      const isCorners = 'fl' in inner && 'fr' in inner && 'rl' in inner && 'rr' in inner;
      out.push(...carFieldPaths(isCorners ? inner['fl'] : value, path));
    }
  }
  return out;
}

const car = createCarState(0 as CarId);
const paths = carFieldPaths(car);

describe('CAR_FIELD_SOURCE', () => {
  it('enumerates a meaningful set of paths (guards the enumerator)', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        'timing.position',
        'timing.gapToLeaderMs',
        'timing.speedTrapFastestKmh',
        'tyres.age',
        'tyres.corners.surfaceTempC',
        'tyres.corners.wearPct',
        'tyres.sets',
        'energy.fuel',
        'condition.brakes.tempC',
        'condition.engineTempC',
        'dynamics',
        'motion',
        'identity.teamId',
      ]),
    );
    expect(paths.length).toBeGreaterThan(40);
  });

  it.each(paths)('has a valid source for %s', (path) => {
    const source = (CAR_FIELD_SOURCE as Record<string, string>)[path];
    expect(source, `no source for ${path}`).toBeDefined();
    expect(Object.keys(SOURCE_INTERVAL_MS)).toContain(source);
  });

  it('has no entry for a path a car does not have', () => {
    const extra = Object.keys(CAR_FIELD_SOURCE).filter((p) => !paths.includes(p));
    expect(extra).toEqual([]);
  });

  it('maps by packet: telemetry, damage, lap data, motion, tyre sets, participants', () => {
    const s = CAR_FIELD_SOURCE as Record<string, string>;
    expect(s['tyres.corners.surfaceTempC']).toBe('telemetry');
    expect(s['tyres.corners.wearPct']).toBe('damage');
    expect(s['timing.position']).toBe('lapData');
    expect(s['timing.gapToLeaderMs']).toBe('lapData');
    expect(s['motion']).toBe('motion');
    expect(s['tyres.sets']).toBe('tyreSets');
    expect(s['identity.teamId']).toBe('participants');
  });
});
