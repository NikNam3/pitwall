// The text of a `gaps.toCar` entry (TO US): laps between the cars when lapped, else the signed time; unknown is empty.
import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import { gapToCarCell } from '../../src/kit/car/gap-to-car.ts';

describe('gapToCarCell', () => {
  it('is the signed time, with minutes past 60 s, when no lap lies between the cars', () => {
    expect(gapToCarCell({ gapMs: known(3719, 0), lapsDown: 0 })).toEqual({ text: '+3.719' });
    expect(gapToCarCell({ gapMs: known(-2184, 0), lapsDown: 0 })).toEqual({ text: '−2.184' });
    expect(gapToCarCell({ gapMs: known(65_000, 0), lapsDown: 0 })).toEqual({ text: '+1:05.000' });
  });

  it('is the laps when lapped: down behind us, up ahead of us, whatever the time', () => {
    expect(gapToCarCell({ gapMs: known(5_000, 0), lapsDown: 1 })).toEqual({ text: '+1 lap' });
    expect(gapToCarCell({ gapMs: known(-58_000, 0), lapsDown: -2 })).toEqual({ text: '−2 laps' });
    expect(gapToCarCell({ gapMs: unknown('notReceived'), lapsDown: 1 })).toEqual({ text: '+1 lap' });
  });

  it('is empty with the reason when the gap is unknown, e.g. the car it is measured to', () => {
    expect(gapToCarCell({ gapMs: unknown('notApplicable'), lapsDown: 0 })).toEqual({ text: '', reason: 'notApplicable' });
  });
});
