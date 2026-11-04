// The ERS budget's presentation table (C66): `presentation.ts` maps every moment of `raceMoment.current` to the
// emphasis of store, flow and "attack ready" (`emphasis`). Only the battle moment lights them, white bold (`text`);
// `neutralised` stays a Moment and has its row. `ersRole` follows the table.
import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { Moment, RaceMoment } from '@pitwall/domain';
import { ersRole } from './emphasis.ts';
import { presentation } from './presentation.ts';

const MOMENTS: Moment[] = ['neutralised', 'incident', 'weather', 'battle', 'carCare'];

const current = (moment: Moment) =>
  known<RaceMoment>({ moment, since: unknown('notApplicable'), cause: { rule: 'test', params: {} }, active: [moment] }, toSessionTime(10));

describe('the ERS budget presentation table: moments', () => {
  it('lights only the battle moment, white bold (text)', () => {
    const lit = Object.entries(presentation.moments).filter(([, row]) => row.emphasis !== undefined);
    expect(lit).toEqual([['battle', { emphasis: 'text' }]]);
  });

  it('has a row for neutralised, which lights nothing', () => {
    expect(presentation.moments.neutralised).toEqual({ emphasis: undefined });
  });

  it("ersRole is the current moment's row emphasis", () => {
    for (const m of MOMENTS) expect(ersRole(current(m)), m).toBe(presentation.moments[m].emphasis);
  });
});
