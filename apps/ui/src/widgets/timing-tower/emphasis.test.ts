import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { Moment, RaceMoment } from '@pitwall/domain';
import { ourCarRole, sectorStatusRole } from '../../emphasis/index.ts';
import { incidentRole, momentIncident, penaltyRole } from './emphasis.ts';
import { incidentEntry } from './fixtures.ts';

const current = (moment: Moment, active: Moment[] = [moment], entryId = 'a') =>
  known<RaceMoment>({ moment, since: unknown('notApplicable'), cause: { rule: 'test', params: { entryId } }, active }, toSessionTime(10));

describe('momentIncident', () => {
  const feed = [incidentEntry('a', 'major', [0]), incidentEntry('b', 'major', [2, 1])];

  it('is the entry the incident moment names, not the newest major one', () => {
    expect(momentIncident(current('incident', ['incident'], 'b'), feed)?.id).toBe('b');
  });

  it('is undefined when the named entry is not in the feed, or without the feed', () => {
    expect(momentIncident(current('incident', ['incident'], 'gone'), feed)).toBeUndefined();
    expect(momentIncident(current('incident', ['incident'], 'a'), undefined)).toBeUndefined();
  });

  it('is undefined in every other current moment, even when an incident is also active', () => {
    for (const moment of ['neutralised', 'weather', 'battle', 'carCare'] as const) {
      expect(momentIncident(current(moment, [moment, 'incident'], 'a'), feed)).toBeUndefined();
    }
  });

  it('is undefined without a moment (the topic is optional) or outside the race', () => {
    expect(momentIncident(undefined, feed)).toBeUndefined();
    expect(momentIncident(unknown('notApplicable'), feed)).toBeUndefined();
  });
});

describe('incidentRole', () => {
  it('is warning (the amber bar) for a car of the named incident, nothing otherwise', () => {
    expect(incidentRole(true)).toBe('warning');
    expect(incidentRole(false)).toBeUndefined();
  });
});

describe('penaltyRole', () => {
  it('is warning (amber) for a time penalty, nothing without one', () => {
    expect(penaltyRole(5000)).toBe('warning');
    expect(penaltyRole(0)).toBeUndefined();
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
