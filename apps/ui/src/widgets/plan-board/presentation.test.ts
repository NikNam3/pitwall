// The plan board's presentation table (C66; SP4.3d spec §6.2: a presentation table over `session-phase-race`): every
// kind of `session-phase-race` to whether the board offers its actions (save to a slot, activate, edit, remove). Once
// the race is finished (`finished`, `postSession`) a plan changes nothing: the rows stay, the actions are hidden; every
// other kind shows them. Contract assumed of `presentation.ts`:
//  - `presentation`: `{ situations: { 'session-phase-race': Record<kind, { actions: 'shown' | 'hidden' }> } }`;
//  - `actionsShown(spans: MachineSpans | undefined): boolean`: the row of the session's open span; `true` without an
//    open span or without the topic (it is optional). The machine decided the situation (C43); the display only maps it.
// Needs `presentation.ts` (implementation): fails at typecheck until it exists.
import { sessionPhaseRaceSpans } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { phaseSpans } from './fixtures.ts';
import { actionsShown, presentation } from './presentation.ts';

const KINDS = sessionPhaseRaceSpans.kinds;
const HIDDEN = ['finished', 'postSession'];

describe('the plan-board presentation table: session-phase-race', () => {
  it('has a row for every kind of session-phase-race, and no other', () => {
    expect(Object.keys(presentation.situations['session-phase-race']).sort()).toEqual([...KINDS].sort());
  });

  it('hides the actions once the race is finished; shows them under every other kind', () => {
    const rows = presentation.situations['session-phase-race'] as Record<string, { actions: string }>;
    for (const kind of KINDS) expect(rows[kind], kind).toEqual({ actions: HIDDEN.includes(kind) ? 'hidden' : 'shown' });
  });
});

describe('actionsShown', () => {
  it('follows the open span\'s row', () => {
    for (const kind of KINDS) expect(actionsShown(phaseSpans(kind)), kind).toBe(!HIDDEN.includes(kind));
  });

  it('shows them without an open span or without the topic', () => {
    expect(actionsShown({ open: [] })).toBe(true);
    expect(actionsShown(undefined)).toBe(true);
  });
});
