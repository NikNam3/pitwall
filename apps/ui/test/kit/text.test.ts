import { describe, expect, it } from 'vitest';
import { unknownReason } from '../../src/kit/text.ts';

describe('unknownReason.restricted', () => {
  // The game does not restrict it: the driver's telemetry setting hides the data (review note).
  it('names the driver\'s telemetry setting, not the game', () => {
    expect(unknownReason.restricted.toLowerCase()).toContain('telemetry setting');
    expect(unknownReason.restricted.toLowerCase()).not.toContain('by the game');
  });
});
