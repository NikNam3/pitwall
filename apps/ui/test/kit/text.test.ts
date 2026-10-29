import { describe, expect, it } from 'vitest';
import { alertGroups, unknownReason } from '../../src/kit/text.ts';
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
