import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import { positionMarkText, positionPairText } from './position-mark.ts';

describe('positionMarkText', () => {
  it('writes places gained or lost, and nothing for no change', () => {
    expect(positionMarkText({ change: 2 })).toBe('▲2');
    expect(positionMarkText({ change: -1 })).toBe('▼1');
    expect(positionMarkText({ change: 0 })).toBe('');
  });

  it('writes a before/after pair with the kit position format, P7→ while the target is unknown', () => {
    expect(positionMarkText({ from: 7, to: known(9, 0) })).toBe('P7→P9');
    expect(positionMarkText({ from: 7, to: unknown('notReceived') })).toBe('P7→');
    expect(positionPairText(5, known(5, 0))).toBe('—');
  });
});
