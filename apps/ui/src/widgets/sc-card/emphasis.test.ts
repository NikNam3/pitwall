// The sc-card's emphasis (C68; mockup docs/design/2026-11-07-sp4.2/sc-card.html): the condition that is out is named in
// the warning role (amber); its row is white bold (`text`, bold). Colour only to highlight: nothing else takes a role.
// Contract assumed of `emphasis.ts`: `stateRole(): Role` and `rowRole(active: boolean): Role | undefined`.
import { describe, expect, it } from 'vitest';
import { rowRole, stateRole } from './emphasis.ts';

describe('stateRole', () => {
  it('names the condition that is out in the warning role', () => {
    expect(stateRole()).toBe('warning');
  });
});

describe('rowRole', () => {
  it('makes the row of the condition that is out white (text)', () => {
    expect(rowRole(true)).toBe('text');
  });

  it('leaves every other row in the inherited colour', () => {
    expect(rowRole(false)).toBeUndefined();
  });
});
