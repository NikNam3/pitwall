import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, Known, Moment, RaceMoment } from '@pitwall/domain';
import { incidentRole } from './emphasis.ts';

const k = <T>(v: T): Known<T> => known(v, 0);

const entry = (id: string, severity: IncidentEntry['severity']): IncidentEntry => ({
  id, at: toSessionTime(1000), lap: 3, kind: severity === 'major' ? 'collision' : 'warning', severity, carIds: [carId(2)],
  timeLostMs: unknown('notApplicable'), forUs: [],
});
const moment = (name: Moment): Known<RaceMoment> =>
  k({ moment: name, since: unknown('notApplicable'), cause: { rule: name, params: {} }, active: [name] });

describe('incidentRole', () => {
  it('is warning (amber) for the newest major entry in the incident moment', () => {
    expect(incidentRole(moment('incident'), entry('a', 'major'), 'a')).toBe('warning');
  });

  it('is undefined for an older major entry in the incident moment', () => {
    expect(incidentRole(moment('incident'), entry('b', 'major'), 'a')).toBeUndefined();
  });

  it('is undefined for the newest major entry outside the incident moment', () => {
    for (const name of ['neutralised', 'weather', 'battle', 'carCare'] as const) {
      expect(incidentRole(moment(name), entry('a', 'major'), 'a')).toBeUndefined();
    }
  });

  it('is undefined for the newest major entry without a race moment (optional topic, or notApplicable)', () => {
    expect(incidentRole(undefined, entry('a', 'major'), 'a')).toBeUndefined();
    expect(incidentRole(unknown('notApplicable'), entry('a', 'major'), 'a')).toBeUndefined();
  });

  it('is undefined for every major entry when no major entry exists (newestMajorId undefined)', () => {
    expect(incidentRole(moment('incident'), entry('a', 'major'), undefined)).toBeUndefined();
  });

  it('is textDim for a minor entry, in every moment and without one', () => {
    for (const m of [undefined, unknown('notApplicable'), moment('incident'), moment('battle')] as const) {
      expect(incidentRole(m, entry('w', 'minor'), 'a')).toBe('textDim');
    }
  });

  it('keeps a minor entry dim, never amber, even when its id is given as the newest major id', () => {
    expect(incidentRole(moment('incident'), entry('w', 'minor'), 'w')).toBe('textDim');
  });
});
