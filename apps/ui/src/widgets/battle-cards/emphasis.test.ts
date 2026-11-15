import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import type { Known, Moment, RaceMoment } from '@pitwall/domain';
import { battleRole, passChanceRole } from './emphasis.ts';

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

// SP4.3c Task 15 (O13): the pass chance's role replaces the margin's. A likely pass (a chance of 25 % or more at a
// braking zone, the test agent's choice: about the curve's chance at 1 s a lap faster with DRS) is our chance ahead,
// bold white (`text`), and the car behind's chance against us, a warning; anything less is plain.
describe('passChanceRole', () => {
  it('ahead: text (bold white) from 25 %', () => {
    expect(passChanceRole('ahead', k(0.25))).toBe('text');
    expect(passChanceRole('ahead', k(0.31))).toBe('text');
    expect(passChanceRole('ahead', k(1))).toBe('text');
  });

  it('behind: warning from 25 %', () => {
    expect(passChanceRole('behind', k(0.25))).toBe('warning');
    expect(passChanceRole('behind', k(0.42))).toBe('warning');
  });

  it('is undefined below 25 %, at 0, for an unknown or missing chance', () => {
    for (const side of ['ahead', 'behind'] as const) {
      expect(passChanceRole(side, k(0.249))).toBeUndefined();
      expect(passChanceRole(side, k(0))).toBeUndefined();
      expect(passChanceRole(side, unknown('insufficientData'))).toBeUndefined();
      expect(passChanceRole(side, undefined)).toBeUndefined();
    }
  });
});
