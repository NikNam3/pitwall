import { describe, expect, it } from 'vitest';
import { alertGroups, unknownMark, unknownReason } from '../../src/kit/text.ts';
import { MINUS } from '../../src/kit/values/format.ts';
import { INSIGHT_CATEGORIES } from '../../src/kit/folds.ts';

describe('unknownReason.restricted', () => {
  // The game does not restrict it: the driver's telemetry setting hides the data (review note).
  it('names the driver\'s telemetry setting, not the game', () => {
    expect(unknownReason.restricted.toLowerCase()).toContain('telemetry setting');
    expect(unknownReason.restricted.toLowerCase()).not.toContain('by the game');
  });
});

describe('alertGroups: one set of words for muting, shared by the top bar and the alarm list', () => {
  it('names every category', () => {
    for (const c of INSIGHT_CATEGORIES) expect(alertGroups.category[c], c).toMatch(/\S/);
  });
  it('mute and unmute are the two actions of the toggle', () => {
    expect(alertGroups.mute).toBe('mute');
    expect(alertGroups.unmute).toBe('unmute');
  });
});

describe('unknownMark: the faint mark an unknown value shows in its cell (user ruling 2026-10-30, Task P)', () => {
  const REASONS = Object.keys(unknownReason) as Array<keyof typeof unknownReason>;
  it('has a mark for every reason the hover names, and no other', () => {
    expect(Object.keys(unknownMark).sort()).toEqual([...REASONS].sort());
  });
  it.each(REASONS)('%s: one visible character, never the minus of signed values', (reason) => {
    const mark = unknownMark[reason];
    expect([...mark]).toHaveLength(1);
    expect(mark.trim()).toBe(mark);
    expect(mark).not.toBe(MINUS);
    expect(mark).not.toBe('-');
  });
  it('a value still to come (measuring, not received) has one mark; a value hidden or not applicable another', () => {
    expect(unknownMark.notReceived).toBe(unknownMark.insufficientData);
    expect(unknownMark.restricted).toBe(unknownMark.notApplicable);
    expect(unknownMark.realism).toBe(unknownMark.notApplicable);
    expect(unknownMark.notApplicable).not.toBe(unknownMark.insufficientData);
  });
});
