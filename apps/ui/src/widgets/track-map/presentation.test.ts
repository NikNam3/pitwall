// The track map's presentation table (C66): `presentation.ts` maps every zone-flag kind (the `flag` of a
// `trackPositions.cars` zone, the zone-flags sub-machine's kinds) to the stretch it redraws over the outline: `yellow`
// in flagYellow, every other kind none. The scene follows the table.
import { describe, expect, it } from 'vitest';
import { carId, known, zoneFlagsSpans } from '@pitwall/domain';
import type { MapZone, TrackGeometry } from '@pitwall/domain';
import { presentation } from './presentation.ts';
import { sceneOf } from './scene.ts';

const ROWS = presentation.situations['zone-flags'];

const GEOMETRY: TrackGeometry = {
  outline: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
  turns: [],
  sectorStarts: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }],
};

describe('the track map presentation table: zone flags', () => {
  it('has a row for every zone-flag kind, and no other', () => {
    expect(Object.keys(ROWS).sort()).toEqual([...zoneFlagsSpans.kinds].sort());
  });

  it('redraws only a yellow zone, in flagYellow', () => {
    const lit = Object.entries(ROWS).filter(([, row]) => row.stretch !== undefined);
    expect(lit).toEqual([['yellow', { stretch: 'flagYellow' }]]);
  });

  it("the scene draws each kind's zone as its row says", () => {
    for (const flag of zoneFlagsSpans.kinds) {
      const zones: MapZone[] = [{ start: 0.25, end: 0.5, flag }];
      const cars = known({ cars: [{ carId: carId(0), code: 'KUH', teamId: 3, raceNumber: 7, ours: true, point: { x: 0.5, y: 0.1 }, inPit: false, blueFlag: false }], zones }, 0);
      const row = ROWS[flag];
      const expected = row.stretch === undefined ? [] : [{ start: 0.25, end: 0.5, role: row.stretch }];
      expect(sceneOf(GEOMETRY, cars, undefined, { mode: 'full' }).stretches, flag).toEqual(expected);
    }
  });
});
