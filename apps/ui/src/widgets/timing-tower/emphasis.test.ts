import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { Moment, RaceMoment } from '@pitwall/domain';
import { ourCarRole, sectorStatusRole } from '../../emphasis/index.ts';
import { neighbourhoodRole } from './emphasis.ts';

const current = (moment: Moment, active: Moment[] = [moment]) =>
  known<RaceMoment>({ moment, since: unknown('notApplicable'), cause: { rule: 'test', params: {} }, active }, toSessionTime(10));

describe('neighbourhoodRole', () => {
  it('is warning for a car in the neighbourhood while the incident moment is current', () => {
    expect(neighbourhoodRole(current('incident'), true)).toBe('warning');
  });

  it('is undefined for a car outside the neighbourhood in the incident moment', () => {
    expect(neighbourhoodRole(current('incident'), false)).toBeUndefined();
  });

  it('is undefined in every other current moment, even when an incident is also active', () => {
    for (const moment of ['neutralised', 'weather', 'battle', 'carCare'] as const) {
      expect(neighbourhoodRole(current(moment, [moment, 'incident']), true)).toBeUndefined();
    }
  });

  it('is undefined without a moment (the topic is optional) or outside the race', () => {
    expect(neighbourhoodRole(undefined, true)).toBeUndefined();
    expect(neighbourhoodRole(unknown('notApplicable'), true)).toBeUndefined();
  });
});

describe('the kit roles the tower uses', () => {
  it('colours a session best purple for every car', () => {
    expect(sectorStatusRole('sessionBest', { ours: false })).toBe('best');
    expect(sectorStatusRole('sessionBest', { ours: true })).toBe('best');
  });

  it('colours a personal best green for our car only', () => {
    expect(sectorStatusRole('personalBest', { ours: true })).toBe('personalBest');
    expect(sectorStatusRole('personalBest', { ours: false })).toBeUndefined();
  });

  it('leaves an unranked time neutral', () => {
    expect(sectorStatusRole('none', { ours: true })).toBeUndefined();
  });

  it('marks our car with the own-car role and others with none', () => {
    expect(ourCarRole(true)).toBe('ownCar');
    expect(ourCarRole(false)).toBeUndefined();
  });
});
