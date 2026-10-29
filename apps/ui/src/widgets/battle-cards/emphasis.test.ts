import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import type { BattleSide, Known, Moment, RaceMoment } from '@pitwall/domain';
import { battleRole } from './emphasis.ts';

const k = <T>(v: T): Known<T> => known(v, 0);

const side = (over: Partial<BattleSide> = {}): BattleSide => ({
  carId: carId(3),
  gapMs: k(3199),
  closingMsPerLap: k(310),
  lapsToDrs: k(7.1),
  paceDeltaMs: k(290),
  overtakeMarginMs: k(-710),
  ours: { compound: 'medium', age: 12 },
  theirs: { compound: 'hard', age: 23 },
  theirErsStoreJ: k(3_100_000),
  ...over,
});

/** The battle moment carries the thresholds of its rule in `cause.params` (Assumption A1). */
const moment = (name: Moment = 'battle', params: Record<string, number | string> = { battleLaps: 2, drsRangeMs: 1000 }): Known<RaceMoment> =>
  k({ moment: name, since: unknown('notApplicable'), cause: { rule: name, params }, active: [name] });

describe('battleRole', () => {
  it('is undefined without a race moment (optional topic, or notApplicable outside the race)', () => {
    expect(battleRole(undefined, side({ lapsToDrs: k(0) }))).toBeUndefined();
    expect(battleRole(unknown('notApplicable'), side({ lapsToDrs: k(0) }))).toBeUndefined();
  });

  it('is undefined in every moment but battle, even for a side in DRS range', () => {
    for (const name of ['neutralised', 'incident', 'weather', 'carCare'] as const) {
      expect(battleRole(moment(name), side({ lapsToDrs: k(0) }))).toBeUndefined();
    }
  });

  it('is text (white bold) in the battle moment for a side already in DRS range (0 laps)', () => {
    expect(battleRole(moment(), side({ lapsToDrs: k(0) }))).toBe('text');
  });

  it('is text for laps to DRS at or below the battleLaps of the moment, undefined above it', () => {
    expect(battleRole(moment(), side({ lapsToDrs: k(2) }))).toBe('text');
    expect(battleRole(moment(), side({ lapsToDrs: k(2.01) }))).toBeUndefined();
    expect(battleRole(moment('battle', { battleLaps: 5, drsRangeMs: 1000 }), side({ lapsToDrs: k(4.9) }))).toBe('text');
  });

  it('is text for a gap at or below drsRangeMs even when the laps to DRS are unknown', () => {
    const near = side({ lapsToDrs: unknown('insufficientData'), gapMs: k(1000) });
    expect(battleRole(moment(), near)).toBe('text');
    expect(battleRole(moment(), { ...near, gapMs: k(1001) })).toBeUndefined();
    expect(battleRole(moment('battle', { battleLaps: 2, drsRangeMs: 500 }), { ...near, gapMs: k(800) })).toBeUndefined();
  });

  it('is undefined when nothing is known about the side', () => {
    expect(battleRole(moment(), side({ lapsToDrs: unknown('realism'), gapMs: unknown('realism') }))).toBeUndefined();
  });

  it('is undefined when the moment does not carry numeric thresholds (nothing hard-coded in the display)', () => {
    expect(battleRole(moment('battle', {}), side({ lapsToDrs: k(0), gapMs: k(100) }))).toBeUndefined();
  });
});
