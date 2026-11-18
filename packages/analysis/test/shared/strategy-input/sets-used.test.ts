// One set rule (SP4.3e Task 3, spec §4.4 item 5; report F4b; C43, C50): `setsUsed(start, car, policy)` in
// `shared/strategy-input/sets-used.ts` says whether the sets a policy uses from a starting point are there, and which
// compounds are missing. The rule: a free start (`start.start.freeCompound[car]` 1) takes a new set of its start
// compound unless only used ones exist; each stop takes a new set. `followable` (`committed-field.ts`) and the DP's
// input (`dp-input.ts`) read it, so the Monte Carlo never plays a plan the DP holds impossible.
//
// How these tests read the rule (the test agent's decisions):
// - `missing` lists each compound short of a set once, in the order the policy first misses it;
// - `followable` drops a stop onto a compound without a set left and marks the policy `noSetLeft` (spec §8.2), now with
//   the free start's set counted as used.
import { carId, type NoiseCompound, type Policy, type StartingPoint } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { followable } from '../../../src/shared/strategy-input/committed-field.ts';
import { setsUsed } from '../../../src/shared/strategy-input/sets-used.ts';
import { startingPoint } from '../../race-forecast/start.ts';

const CAR = carId(0);
const LAPS = 30;

/** A grid start of `LAPS` laps, our car 0 free, its sets as given (compound, wear). */
function gridWith(sets: readonly [NoiseCompound, number][]): StartingPoint {
  const s = startingPoint({ lapsTotal: LAPS, cars: [{ compound: 'medium' }, {}, {}], ours: [0] });
  return {
    ...s,
    sets: { [CAR]: sets.map(([compound, wearPct]) => ({ compound, wearPct })) },
    start: { freeCompound: Uint8Array.from([1, 0, 0]), odds: [null, null, null] },
  };
}

/** Start on M, one stop onto M at lap 15. */
const M_M: Policy = { startCompound: 'medium', stops: [{ lap: 15, compound: 'medium' }] };

describe('setsUsed: one set rule (SP4.3e Task 3)', () => {
  it("free start on M with one new M and a stop onto M → { ok: false, missing: ['medium'] }", () => {
    const start = gridWith([
      ['medium', 0],
      ['soft', 0],
      ['hard', 0],
    ]);
    expect(setsUsed(start, CAR, M_M)).toEqual({ ok: false, missing: ['medium'] });
  });

  it('free start on M with two new M and a stop onto M → ok', () => {
    const start = gridWith([
      ['medium', 0],
      ['medium', 0],
      ['hard', 0],
    ]);
    expect(setsUsed(start, CAR, M_M)).toEqual({ ok: true, missing: [] });
  });

  it('a free start takes a used set only where no new one exists: a used M start leaves the new M for the stop', () => {
    // one used M and one new M: the start takes the new one, the stop finds none new left
    expect(setsUsed(gridWith([['medium', 0], ['medium', 30]]), CAR, M_M)).toEqual({ ok: false, missing: ['medium'] });
    // only used M for the start, a new S for the stop: ok
    const mS: Policy = { startCompound: 'medium', stops: [{ lap: 15, compound: 'soft' }] };
    expect(setsUsed(gridWith([['medium', 30], ['soft', 0]]), CAR, mS)).toEqual({ ok: true, missing: [] });
  });

  it("followable reads the one rule: a free start's M counts as used, so a stop onto M with one M set is dropped (noSetLeft)", () => {
    const start = gridWith([
      ['medium', 0],
      ['soft', 0],
    ]);
    const f = followable(start, CAR, M_M);
    expect(f.infeasible).toBe('noSetLeft');
    expect(f.policy.stops, 'the stop onto M is dropped').toEqual([]);
    // with two M it is followed as it is
    expect(followable(gridWith([['medium', 0], ['medium', 0]]), CAR, M_M)).toEqual({ policy: M_M, infeasible: null });
  });
});
