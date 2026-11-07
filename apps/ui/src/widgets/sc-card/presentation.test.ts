// The sc-card's presentation table (C66; plan Task 12, "as Task 11's"): `presentation.ts` maps every kind of
// `session-phase-race` to `{ active }`: `neutralised` → `{ active: 'span' }` (the condition that is out is the span's
// `detail.car`), every other kind → `{ active: 'none' }`. Contract assumed of `presentation.ts`:
//  - `presentation`: `{ situations: { 'session-phase-race': Record<kind, { active: 'span' | 'none' }> } }`;
//  - `activeCondition(spans: MachineSpans | undefined): 'sc' | 'vsc' | undefined`: the condition the session's open span
//    names through its row (`span`: its `detail.car`, SC → `sc`, VSC → `vsc`), `undefined` for a `none` row, no open span
//    or no topic value. The machine decided the situation (C43); the display only maps it.
import { sessionPhaseRaceSpans } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { neutralised, phaseSpans, racing } from './fixtures.ts';
import { activeCondition, presentation } from './presentation.ts';

const KINDS = sessionPhaseRaceSpans.kinds;

describe('the sc-card presentation table: session-phase-race', () => {
  it('has a row for every kind of session-phase-race, and no other', () => {
    expect(Object.keys(presentation.situations['session-phase-race']).sort()).toEqual([...KINDS].sort());
  });

  it('names the span\'s condition only under neutralised', () => {
    const rows = presentation.situations['session-phase-race'] as Record<string, { active: string }>;
    expect(rows['neutralised']).toEqual({ active: 'span' });
    for (const kind of KINDS.filter((k) => k !== 'neutralised')) expect(rows[kind], kind).toEqual({ active: 'none' });
  });
});

describe('activeCondition', () => {
  it('is the SC under a neutralised span with car SC', () => {
    expect(activeCondition(neutralised('SC'))).toBe('sc');
  });

  it('is the VSC under a neutralised span with car VSC', () => {
    expect(activeCondition(neutralised('VSC'))).toBe('vsc');
  });

  it('is none under every other kind', () => {
    expect(activeCondition(racing)).toBeUndefined();
    for (const kind of KINDS.filter((k) => k !== 'neutralised')) expect(activeCondition(phaseSpans(kind)), kind).toBeUndefined();
  });

  it('is none without an open span or without the topic', () => {
    expect(activeCondition({ open: [] })).toBeUndefined();
    expect(activeCondition(undefined)).toBeUndefined();
  });
});
