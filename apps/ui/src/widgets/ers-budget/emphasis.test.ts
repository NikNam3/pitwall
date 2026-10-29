import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { Moment, RaceMoment } from '@pitwall/domain';
import { ersRole } from './emphasis.ts';

const current = (moment: Moment, active: Moment[] = [moment]) =>
  known<RaceMoment>({ moment, since: unknown('notApplicable'), cause: { rule: 'test', params: {} }, active }, toSessionTime(10));

// 'text' is the white bold role: relevant in the current race moment, no hue.
describe('ersRole', () => {
  it('is text (white bold) while the battle moment is current', () => {
    expect(ersRole(current('battle'))).toBe('text');
  });

  it('is undefined in every other current moment, even when a battle is also active', () => {
    for (const moment of ['neutralised', 'incident', 'weather', 'carCare'] as const) {
      expect(ersRole(current(moment, [moment, 'battle']))).toBeUndefined();
    }
  });

  it('is undefined without raceMoment.current (the topic is optional)', () => {
    expect(ersRole(undefined)).toBeUndefined();
  });

  it('is undefined outside the race (notApplicable)', () => {
    expect(ersRole(unknown('notApplicable'))).toBeUndefined();
  });
});
