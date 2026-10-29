import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, Known, Moment, RaceMoment } from '@pitwall/domain';
import { incidentRole } from './emphasis.ts';

const k = <T>(v: T): Known<T> => known(v, 0);

const entry = (id: string, severity: IncidentEntry['severity']): IncidentEntry => ({
  id, at: toSessionTime(1000), lap: 3, kind: severity === 'major' ? 'collision' : 'warning', severity, carIds: [carId(2)],
  timeLostMs: unknown('notApplicable'), forUs: [],
});
/** A moment whose cause names entry `entryId` (as race-moment's incident cause does). */
const moment = (name: Moment, entryId = 'a'): Known<RaceMoment> =>
  k({ moment: name, since: unknown('notApplicable'), cause: { rule: name, params: { entryId } }, active: [name] });

describe('incidentRole', () => {
  it('is warning (amber) for the entry the incident moment names', () => {
    expect(incidentRole(moment('incident'), entry('a', 'major'))).toBe('warning');
  });

  it('is undefined for another major entry in the incident moment: the display picks none itself', () => {
    expect(incidentRole(moment('incident'), entry('b', 'major'))).toBeUndefined();
  });

  it('is undefined outside the incident moment, even for an entry a cause names', () => {
    for (const name of ['neutralised', 'weather', 'battle', 'carCare'] as const) {
      expect(incidentRole(moment(name), entry('a', 'major'))).toBeUndefined();
    }
  });

  it('is undefined without a race moment (optional topic, or notApplicable)', () => {
    expect(incidentRole(undefined, entry('a', 'major'))).toBeUndefined();
    expect(incidentRole(unknown('notApplicable'), entry('a', 'major'))).toBeUndefined();
  });

  it('is textDim for a minor entry, in every moment and without one, even when the moment names it', () => {
    for (const m of [undefined, unknown('notApplicable'), moment('incident', 'w'), moment('battle')] as const) {
      expect(incidentRole(m, entry('w', 'minor'))).toBe('textDim');
    }
  });
});
