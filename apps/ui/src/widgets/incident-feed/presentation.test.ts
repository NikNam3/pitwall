// The incident feed's presentation table (C66): `presentation.ts` maps every moment of `raceMoment.current` to the
// emphasis of the major entry the moment's cause names (`emphasis`). Only the incident moment lights it, amber
// (`warning`); `neutralised` stays a Moment and has its row. Minor entries stay dim in every moment (emphasis.test.ts).
// `incidentRole` follows the table.
import { describe, expect, it } from 'vitest';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { IncidentEntry, Known, Moment, RaceMoment } from '@pitwall/domain';
import { incidentRole } from './emphasis.ts';
import { presentation } from './presentation.ts';

const MOMENTS: Moment[] = ['neutralised', 'incident', 'weather', 'battle', 'carCare'];

const major: IncidentEntry = {
  id: 'a', at: toSessionTime(1000), lap: 3, kind: 'collision', severity: 'major', carIds: [carId(2)],
  timeLostMs: unknown('notApplicable'), forUs: [], where: { sector: unknown('notReceived'), turn: unknown('notApplicable'), fraction: unknown('notApplicable') },
};
/** Moment `name` whose cause names entry `a`. */
const moment = (name: Moment): Known<RaceMoment> =>
  known({ moment: name, since: unknown('notApplicable'), cause: { rule: name, params: { entryId: 'a' } }, active: [name] }, 0);

describe('the incident feed presentation table: moments', () => {
  it('lights only the incident moment, amber (warning)', () => {
    const lit = Object.entries(presentation.moments).filter(([, row]) => row.emphasis !== undefined);
    expect(lit).toEqual([['incident', { emphasis: 'warning' }]]);
  });

  it('has a row for neutralised, which lights nothing', () => {
    expect(presentation.moments.neutralised).toEqual({ emphasis: undefined });
  });

  it("incidentRole gives the named major entry the current moment's row emphasis", () => {
    for (const m of MOMENTS) expect(incidentRole(moment(m), major), m).toBe(presentation.moments[m].emphasis);
  });
});
