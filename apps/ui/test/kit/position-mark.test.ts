// The position mark's text (spec 8.4, A.4). Contract of `positionMarkText(props)` in src/kit/values/position-mark.ts (pure):
//  - `{ change }`: positive = places gained, `▲2`; negative = places lost, `▼1`; zero = empty string;
//  - `{ from, to }`: `P7→P9`; an unknown `to` gives `P7→` (nothing after the arrow);
//  - `PositionMarkProps` (the union of both shapes, A.4) is exported from the same file.
import { known, unknown, type SessionTime } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { positionMarkText } from '../../src/kit/values/position-mark.ts';

describe('positionMarkText', () => {
  it('shows places gained as ▲n', () => {
    expect(positionMarkText({ change: 2 })).toBe('▲2');
    expect(positionMarkText({ change: 13 })).toBe('▲13');
  });
  it('shows places lost as ▼n', () => {
    expect(positionMarkText({ change: -1 })).toBe('▼1');
  });
  it('shows nothing for no change', () => {
    expect(positionMarkText({ change: 0 })).toBe('');
  });
  it('shows a before/after pair', () => {
    expect(positionMarkText({ from: 7, to: known(9, 0 as SessionTime) })).toBe('P7→P9');
    expect(positionMarkText({ from: 7, to: known(7, 0 as SessionTime) })).toBe('P7→P7');
  });
  it('leaves the target empty while it is unknown', () => {
    expect(positionMarkText({ from: 7, to: unknown('notReceived') })).toBe('P7→');
  });
});
