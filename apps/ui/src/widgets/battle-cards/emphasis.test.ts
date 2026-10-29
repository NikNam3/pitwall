import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import type { Known, Moment, RaceMoment } from '@pitwall/domain';
import { battleRole } from './emphasis.ts';

const k = <T>(v: T): Known<T> => known(v, 0);
const OURS = carId(1);

/** The battle moment's cause names the card (our car) and the side that triggered it. */
const moment = (
  name: Moment = 'battle',
  params: Record<string, number | string> = { carId: 1, side: 'behind', lapsToDrs: 0, gapMs: 841 },
): Known<RaceMoment> => k({ moment: name, since: unknown('notApplicable'), cause: { rule: name, params }, active: [name] });

describe('battleRole', () => {
  it('is undefined without a race moment (optional topic, or notApplicable outside the race)', () => {
    expect(battleRole(undefined, OURS, 'behind')).toBeUndefined();
    expect(battleRole(unknown('notApplicable'), OURS, 'behind')).toBeUndefined();
  });

  it('is undefined in every moment but battle, even when the cause names the side', () => {
    for (const name of ['neutralised', 'incident', 'weather', 'carCare'] as const) {
      expect(battleRole(moment(name), OURS, 'behind')).toBeUndefined();
    }
  });

  it('is text (white bold) for the card and side the battle cause names', () => {
    expect(battleRole(moment(), OURS, 'behind')).toBe('text');
    expect(battleRole(moment('battle', { carId: 1, side: 'ahead', lapsToDrs: 1.5, gapMs: 1800 }), OURS, 'ahead')).toBe('text');
  });

  it('is undefined for the other side of the same card', () => {
    expect(battleRole(moment(), OURS, 'ahead')).toBeUndefined();
  });

  it('is undefined for another car\'s card, even on the named side', () => {
    expect(battleRole(moment(), carId(2), 'behind')).toBeUndefined();
  });

  it('is undefined when the cause carries no car or side', () => {
    expect(battleRole(moment('battle', {}), OURS, 'behind')).toBeUndefined();
  });

  it('does not look at laps or gap values: no threshold in the display', () => {
    expect(battleRole(moment('battle', { carId: 1, side: 'ahead', lapsToDrs: 99, gapMs: 99999 }), OURS, 'ahead')).toBe('text');
  });
});
