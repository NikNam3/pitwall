// SP4.3c Task 17 (O8, B8): a `pit-sweep` table's rows take their rejoin position from one model. The box-now row
// (stop lap = now) and the lap + 1 row come from the same function, the simulated rejoin's median over the scenarios;
// `rowsOf` never reads a green rejoin position of `rejoin`'s (the context here throws if one is read).
import { known, unknown } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { rowsOf, type RowContext } from '../../src/pit-sweep/rows.ts';
import type { CallOutcome } from '../../src/race-monte-carlo/index.ts';

const NOW = 12;
const AT = 1_000;

const outcome = (rejoin: number[], finish: number[]): CallOutcome => ({
  finish: Int8Array.from(finish),
  rejoin: Int8Array.from(rejoin),
  traffic: Int8Array.from(finish.map(() => 0)),
  gapMs: null,
  raceMs: Float64Array.from(finish.map((_, i) => 5_000_000 + i)),
});

/** The context of one car's table; reading `greenRejoin` throws. */
function context(): RowContext {
  const ctx = { now: NOW, position: 6, cars: 20, latest: known(20, AT), zTie: 2, tieBand: 0, at: AT };
  Object.defineProperty(ctx, 'greenRejoin', {
    enumerable: true,
    get: () => {
      throw new Error("rowsOf read rejoin's green position");
    },
  });
  return ctx as RowContext;
}

describe('pit-sweep rows: one rejoin model (SP4.3c Task 17, B8)', () => {
  it('the box-now row and the lap + 1 row both take the simulated rejoin median', () => {
    const rows = rowsOf([NOW, NOW + 1], [outcome([9, 9, 11], [7, 8, 9]), outcome([12, 10, 10], [8, 8, 9])], context());
    expect(rows.map((r) => r.stopLap)).toEqual([NOW, NOW + 1]);
    expect(rows[0]!.rejoinPosition).toEqual(known(9, AT));
    expect(rows[1]!.rejoinPosition).toEqual(known(10, AT));
  });

  it('a box-now row whose scenarios give no rejoin place is unknown, as a later row is', () => {
    const rows = rowsOf([NOW, NOW + 1], [outcome([-1, -1, -1], [7, 8, 9]), outcome([-1, -1, -1], [8, 8, 9])], context());
    expect(rows[0]!.rejoinPosition).toEqual(unknown('insufficientData'));
    expect(rows[1]!.rejoinPosition).toEqual(unknown('insufficientData'));
  });
});
