// The crossing order's presentation table (C66; SP4.2 spec §4): `presentation.ts` exports `presentation`, a
// `PresentationTable` with one row per kind of `session-phase-race` (`situations['session-phase-race']`). A row is
// `{ active: 'span' | 'none' }`: `span` = the condition that is out is the span's `detail.car` (SC or VSC); only
// `neutralised` has it. The generic completeness test (test/presentation-completeness.test.ts) checks it as well.
// Contract assumed of `rows.ts`: `activeCondition(phase: MachineSpans): PitCondition | undefined`, the condition that is
// out now, by the table: an open span whose row is `span` gives its `detail.car` (`SC` → `sc`, `VSC` → `vsc`); else none.
import { SPAN_DECLARATIONS } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { neutralised, phases } from './fixtures.ts';
import { presentation } from './presentation.ts';
import { activeCondition } from './rows.ts';

const KINDS = SPAN_DECLARATIONS.find((d) => d.machine === 'session-phase-race')?.kinds ?? [];

describe('the crossing order presentation table', () => {
  it('has a row for every session-phase-race kind and reads no other machine', () => {
    expect(Object.keys(presentation.situations)).toEqual(['session-phase-race']);
    expect(Object.keys(presentation.situations['session-phase-race']).sort()).toEqual([...KINDS].sort());
  });

  it('makes neutralised name the condition that is out', () => {
    expect(presentation.situations['session-phase-race'].neutralised).toEqual({ active: 'span' });
  });

  it('makes every other kind name none', () => {
    for (const kind of KINDS.filter((k) => k !== 'neutralised')) {
      expect((presentation.situations['session-phase-race'] as Record<string, unknown>)[kind], kind).toEqual({ active: 'none' });
    }
  });

  it('reads no moment', () => {
    expect((presentation as { moments?: unknown }).moments).toBeUndefined();
  });
});

describe('activeCondition', () => {
  it('is none while racing', () => {
    expect(activeCondition(phases.racing)).toBeUndefined();
  });

  it('is none without an open span', () => {
    expect(activeCondition({ open: [] })).toBeUndefined();
  });

  it('is the VSC under a VSC neutralisation', () => {
    expect(activeCondition(neutralised('VSC'))).toBe('vsc');
  });

  it('is the SC under an SC neutralisation', () => {
    expect(activeCondition(neutralised('SC'))).toBe('sc');
  });
});
