// The tower's presentation table (C66): `presentation.ts` maps the moments of `raceMoment.current` to the tower's
// emphasis, besides its situation rows (covered by test/presentation-completeness.test.ts and rows.test.ts). Each moment
// row's `emphasis` is the role the moment gives the rows it names: the amber left bar of the incident's cars in the
// incident moment, nothing in any other (`neutralised` stays a Moment and has its row).
import { describe, expect, it } from 'vitest';
import { incidentRole } from './emphasis.ts';
import { presentation } from './presentation.ts';

describe('the timing tower presentation table: moments', () => {
  it('lights only the incident moment, with the amber bar (warning)', () => {
    const lit = Object.entries(presentation.moments).filter(([, row]) => row.emphasis !== undefined);
    expect(lit).toEqual([['incident', { emphasis: 'warning' }]]);
  });

  it('has a row for neutralised, which lights nothing', () => {
    expect(presentation.moments.neutralised).toEqual({ emphasis: undefined });
  });

  it("the involved bar is the incident row's emphasis", () => {
    expect(incidentRole(true)).toBe(presentation.moments.incident.emphasis);
    expect(incidentRole(false)).toBeUndefined();
  });
});
