import { describe, expect, it } from 'vitest';
import { decodeUiAction } from '../src/ui/decode.ts';

describe('decodeUiAction alertGroup.mute', () => {
  it.each(['strategy', 'tyres', 'energy', 'car', 'damage', 'race', 'feed', 'system'])('accepts the %s category', (category) =>
    expect(decodeUiAction({ kind: 'alertGroup.mute', category, muted: true })).toEqual({ kind: 'alertGroup.mute', category, muted: true }));
  it('rejects an unknown category', () => expect(decodeUiAction({ kind: 'alertGroup.mute', category: 'brakes', muted: true })).toBeUndefined());
});
