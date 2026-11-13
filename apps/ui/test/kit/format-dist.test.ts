// Kit formats of the strategy calls (SP4.3b2 Task 3; docs/design/2026-11-12-sp4.3b/README.md "Follow-ups", gen.mjs `FMT`;
// C68). Contracts assumed of `kit/values/format.ts`:
//  - `formatExpectedPlace(x)`: an expected place to two decimals, `7.523` -> `7.52`;
//  - `formatPlacesGained(x)`: places gained, signed, one decimal, the true minus (`MINUS`): `1.43` -> `+1.4`,
//    `-0.6` -> `−0.6`; zero, and a value that rounds to zero, is `+0.0` (no negative zero);
//  - `formatShare(p)`: a share 0…1 as a whole percent, `0.75` -> `75%`;
//  - `formatPoints(x)`: points to one decimal, `6.25` -> `6.3`;
//  - each returns '' for a non-finite value (as the kit's other formats).
import { describe, expect, it } from 'vitest';
import { formatExpectedPlace, formatPlacesGained, formatPoints, formatShare, MINUS } from '../../src/kit/values/format.ts';

describe('strategy formats', () => {
  it('formatExpectedPlace, formatPlacesGained, formatShare and formatPoints', () => {
    expect(formatExpectedPlace(7.523)).toBe('7.52');
    expect(formatExpectedPlace(12)).toBe('12.00');
    expect(formatPlacesGained(1.43)).toBe('+1.4');
    expect(formatPlacesGained(-0.6)).toBe(`${MINUS}0.6`);
    expect(formatPlacesGained(0)).toBe('+0.0');
    expect(formatPlacesGained(-0)).toBe('+0.0');
    expect(formatPlacesGained(-0.04)).toBe('+0.0');
    expect(formatShare(0.75)).toBe('75%');
    expect(formatShare(0)).toBe('0%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(0.004)).toBe('0%');
    expect(formatPoints(6.25)).toBe('6.3');
    expect(formatPoints(0)).toBe('0.0');
    for (const f of [formatExpectedPlace, formatPlacesGained, formatShare, formatPoints]) expect(f(Number.NaN)).toBe('');
  });
});
