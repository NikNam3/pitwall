// The battle cards' presentation table (C66): `presentation.ts` maps every moment of `raceMoment.current` to the cards'
// emphasis (`emphasis`: the role of the side the moment's cause names). Only the battle moment lights it, white bold
// (`text`); `neutralised` stays a Moment and has its row. `battleRole` follows the table.
import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import type { Known, Moment, RaceMoment } from '@pitwall/domain';
import { battleRole } from './emphasis.ts';
import { presentation } from './presentation.ts';

const MOMENTS: Moment[] = ['neutralised', 'incident', 'weather', 'battle', 'carCare'];

/** Moment `name` whose cause names our car's (1) side behind, as the battle cause does. */
const moment = (name: Moment): Known<RaceMoment> =>
  known({ moment: name, since: unknown('notApplicable'), cause: { rule: name, params: { carId: 1, side: 'behind' } }, active: [name] }, 0);

describe('the battle cards presentation table: moments', () => {
  it('lights only the battle moment, white bold (text)', () => {
    const lit = Object.entries(presentation.moments).filter(([, row]) => row.emphasis !== undefined);
    expect(lit).toEqual([['battle', { emphasis: 'text' }]]);
  });

  it('has a row for neutralised, which lights nothing', () => {
    expect(presentation.moments.neutralised).toEqual({ emphasis: undefined });
  });

  it('battleRole gives the named side the emphasis of the current moment\'s row', () => {
    for (const m of MOMENTS) expect(battleRole(moment(m), carId(1), 'behind'), m).toBe(presentation.moments[m].emphasis);
  });
});
